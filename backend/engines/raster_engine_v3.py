"""
backend/engines/raster_engine_v3.py

Engine V3 — raster-first draft pipeline.

Renders the PDF page to a high-resolution PNG ONCE (cached on disk),
then performs all edits as raster operations (cv2.INPAINT_TELEA for
erasing, PIL ImageDraw for text insertion) and composites the result
into a single-page PDF.

Eliminates content-stream / transparency-group / CFF-font issues
entirely — after the initial flatten, the PDF's internal structure
is never touched again.

The original uploaded PDF is NEVER modified.
Existing engines (pdf_draft_engine, draft_engine) and detector.py
are unchanged — this module adds alongside them.

Coordinate system:
    Same as pdf_draft_engine.py — PyMuPDF screen coords, y=0 at top.
    PDF pt (x, y) → pixel (x * dpi/72, y * dpi/72). No y-flip needed.
"""

from __future__ import annotations

import io
import uuid
import time
import logging
from pathlib import Path

import cv2
import fitz
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from core.config import settings

log = logging.getLogger(__name__)

_BACKEND_DIR = Path(__file__).parent.parent
CACHE_DIR = _BACKEND_DIR / "cache" / "base_images"

_FONT_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]


def _get_font(size_px: int) -> ImageFont.FreeTypeFont:
    for path in _FONT_PATHS:
        try:
            return ImageFont.truetype(path, max(6, size_px))
        except Exception:
            continue
    return ImageFont.load_default()


def _hex_to_rgb_255(hex_str: str) -> tuple[int, int, int]:
    h = (hex_str or "#000000").lstrip("#").ljust(6, "0")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _normalize_color(color_rgb: tuple) -> tuple[int, int, int]:
    """Accept (0.0-1.0) floats or (0-255) ints; always return 0-255 ints."""
    if color_rgb and isinstance(color_rgb[0], float) and max(color_rgb) <= 1.0:
        return tuple(int(c * 255) for c in color_rgb)
    return tuple(int(c) for c in color_rgb)


# ── Base image cache ──────────────────────────────────────────────────────────

def get_or_create_base_image(
    pdf_path: str,
    artwork_id: str,
    page_num: int,
    dpi: int = 300,
) -> str:
    """
    Render the PDF page to a high-res PNG and cache it on disk.
    Returns the cache file path. Second call returns immediately (mtime unchanged).

    This image is the IMMUTABLE BASE — every draft generation starts
    fresh from this file, never from a previously-edited copy.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / f"{artwork_id}_{page_num}_{dpi}.png"
    if cache_file.exists():
        return str(cache_file)
    doc = fitz.open(pdf_path)
    page = doc[page_num]
    scale = dpi / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    doc.close()
    pix.save(str(cache_file))
    log.info("Cached base image: %s (%dx%d px)", cache_file.name, pix.width, pix.height)
    return str(cache_file)


def invalidate_base_image(artwork_id: str, page_num: int, dpi: int = 300) -> None:
    """Remove cached base image so the next call to get_or_create_base_image re-renders."""
    cache_file = CACHE_DIR / f"{artwork_id}_{page_num}_{dpi}.png"
    cache_file.unlink(missing_ok=True)


# ── Core raster operations ────────────────────────────────────────────────────

def _load_base_as_array(base_image_path: str) -> np.ndarray:
    """Load the cached base PNG as an RGB numpy array (always a fresh copy)."""
    return np.array(Image.open(base_image_path).convert("RGB"))


def _pdf_rect_to_px(rect_pts: tuple, dpi: int) -> tuple[int, int, int, int]:
    """
    Convert a PDF-space rect (x0, y0, x1, y1 in points, y=0 at top)
    to pixel-space at the given DPI. Same coordinate convention as
    pdf_draft_engine.py — no y-flip needed.
    """
    x0, y0, x1, y1 = rect_pts
    scale = dpi / 72.0
    return int(x0 * scale), int(y0 * scale), int(x1 * scale), int(y1 * scale)


def _clamp_rect(
    rect_px: tuple[int, int, int, int],
    img_shape: tuple,
) -> tuple[int, int, int, int]:
    h, w = img_shape[:2]
    x0, y0, x1, y1 = rect_px
    return max(0, x0), max(0, y0), min(w, x1), min(h, y1)


def _clip_patch_against_neighbors(
    px0: int, py0: int, px1: int, py1: int,
    rx0: int, ry0: int, rx1: int, ry1: int,
    neighbors: list[tuple],
) -> tuple[int, int, int, int]:
    """
    Shrink the inpainting patch (px0,py0,px1,py1) so it never crosses
    into any neighbor's bbox.  Only clips on the sides where the patch
    has EXPANDED beyond the target rect (rx0,ry0,rx1,ry1).

    Skips a neighbor if it overlaps the target rect (same element or
    intentionally co-located content).
    """
    for nx0, ny0, nx1, ny1 in neighbors:
        # Skip if neighbor doesn't intersect with the expanded patch at all
        if nx1 <= px0 or nx0 >= px1 or ny1 <= py0 or ny0 >= py1:
            continue
        # Skip if the neighbor's CENTER is inside the target rect — that means
        # this neighbor IS the target element (or a fully-contained sub-span).
        # Using centroid avoids false-skips when a nearby element has a tiny
        # bbox overlap with the target due to tight spacing.
        ncx = (nx0 + nx1) * 0.5
        ncy = (ny0 + ny1) * 0.5
        if rx0 <= ncx <= rx1 and ry0 <= ncy <= ry1:
            continue
        # Clip the patch on whichever side(s) the neighbor falls outside the target.
        if ncy < ry0 and py0 < ny1:    # neighbor center above target → clip top
            py0 = max(py0, ny1)
        if ncy > ry1 and py1 > ny0:    # neighbor center below target → clip bottom
            py1 = min(py1, ny0)
        if ncx < rx0 and px0 < nx1:    # neighbor center left of target → clip left
            px0 = max(px0, nx1)
        if ncx > rx1 and px1 > nx0:    # neighbor center right of target → clip right
            px1 = min(px1, nx0)
    return px0, py0, px1, py1


def _erase_region(
    img: np.ndarray,
    rect_px: tuple,
    all_element_bboxes_px: list[tuple] | None = None,
) -> np.ndarray:
    """
    Inpaint the region using cv2.INPAINT_TELEA — same algorithm as
    Phase 2's _inpaint_cover, adapted to work directly on an in-memory
    array (no PDF round-trip).

    A margin of max(15px, 50% of rect dimensions) provides enough
    surrounding context to reconstruct gradients and textures.

    When all_element_bboxes_px is provided, the expanded patch is
    clipped against each neighbor's bbox so inpainting never overwrites
    pixels belonging to a different element on the same page.
    """
    h, w = img.shape[:2]
    x0, y0, x1, y1 = _clamp_rect(rect_px, img.shape)
    if x1 <= x0 or y1 <= y0:
        return img

    rect_w = x1 - x0
    rect_h = y1 - y0
    margin = max(15, int(rect_w * 0.5), int(rect_h * 0.5))

    px0 = max(0, x0 - margin)
    py0 = max(0, y0 - margin)
    px1 = min(w, x1 + margin)
    py1 = min(h, y1 + margin)

    # Clip expanded patch against neighboring element bboxes so the
    # inpainting context region never crosses into a neighbor's area.
    if all_element_bboxes_px:
        px0, py0, px1, py1 = _clip_patch_against_neighbors(
            px0, py0, px1, py1, x0, y0, x1, y1, all_element_bboxes_px
        )

    if px1 <= px0 or py1 <= py0:
        return img  # patch collapsed entirely — skip

    patch = img[py0:py1, px0:px1].copy()

    mask = np.zeros(patch.shape[:2], dtype=np.uint8)
    mx0 = max(0, (x0 - px0) - 2)
    my0 = max(0, (y0 - py0) - 2)
    mx1 = min(patch.shape[1], (x1 - px0) + 2)
    my1 = min(patch.shape[0], (y1 - py0) + 2)
    mask[my0:my1, mx0:mx1] = 255

    inpainted = cv2.inpaint(patch, mask, inpaintRadius=5, flags=cv2.INPAINT_TELEA)

    result = img.copy()
    result[py0:py1, px0:px1] = inpainted
    return result


def _draw_text(
    img: np.ndarray,
    rect_px: tuple,
    text: str,
    font_size_pt: float,
    dpi: int,
    color_rgb: tuple,
) -> np.ndarray:
    """
    Draw text into the region using PIL ImageDraw + a TrueType font.
    Baseline at rect.height * 0.8 from the top — the same formula
    validated in Phase 1.5. If text overflows the rect width, applies
    basic word-wrapping within the rect height.
    """
    x0, y0, x1, y1 = _clamp_rect(rect_px, img.shape)
    rect_h = y1 - y0
    rect_w = x1 - x0
    if rect_h <= 0 or rect_w <= 0:
        return img

    font_size_px = max(6, int(font_size_pt * dpi / 72))
    font = _get_font(font_size_px)
    color_int = _normalize_color(color_rgb)

    pil_img = Image.fromarray(img)
    draw = ImageDraw.Draw(pil_img)

    # Baseline at rect.height * 0.8 (Phase 1.5 formula, converted to px)
    baseline_y = y0 + int(rect_h * 0.8)

    try:
        text_w = int(draw.textlength(text, font=font))
    except Exception:
        text_w = len(text) * font_size_px

    def _place(t: str, by: int) -> None:
        try:
            draw.text((x0, by), t, font=font, fill=color_int, anchor="ls")
        except TypeError:
            ascender_est = int(font_size_px * 0.75)
            draw.text((x0, by - ascender_est), t, font=font, fill=color_int)

    if text_w <= rect_w:
        _place(text, baseline_y)
    else:
        words = text.split()
        lines: list[str] = []
        current = ""
        for word in words:
            candidate = (current + " " + word).strip()
            try:
                cw = int(draw.textlength(candidate, font=font))
            except Exception:
                cw = len(candidate) * font_size_px
            if cw <= rect_w or not current:
                current = candidate
            else:
                lines.append(current)
                current = word
        if current:
            lines.append(current)

        line_h = int(font_size_px * 1.2)
        for i, line in enumerate(lines):
            _place(line, baseline_y + i * line_h)

    return np.array(pil_img)


def _move_region(
    img: np.ndarray,
    src_rect_px: tuple,
    dst_rect_px: tuple,
    all_element_bboxes_px: list[tuple] | None = None,
) -> np.ndarray:
    """
    Erase src_rect_px (inpaint), then paste the original src content
    at dst_rect_px. Resizes the crop if src and dst dimensions differ.
    """
    sx0, sy0, sx1, sy1 = _clamp_rect(src_rect_px, img.shape)
    if sx1 <= sx0 or sy1 <= sy0:
        return img

    crop = img[sy0:sy1, sx0:sx1].copy()
    result = _erase_region(img, (sx0, sy0, sx1, sy1), all_element_bboxes_px)

    dx0, dy0, dx1, dy1 = _clamp_rect(dst_rect_px, result.shape)
    dh = dy1 - dy0
    dw = dx1 - dx0
    if dh <= 0 or dw <= 0:
        return result

    src_h, src_w = crop.shape[:2]
    if (src_h, src_w) != (dh, dw):
        crop = np.array(Image.fromarray(crop).resize((dw, dh), Image.LANCZOS))

    result[dy0:dy1, dx0:dx1] = crop
    return result


def _resize_region(
    img: np.ndarray,
    rect_px: tuple,
    old_font_size_pt: float,
    new_font_size_pt: float,
    text: str,
    dpi: int,
    color_rgb: tuple,
    all_element_bboxes_px: list[tuple] | None = None,
) -> np.ndarray:
    """
    Erase the region (inpaint background), then redraw the same text
    at the new font size using the same baseline anchor as _draw_text.
    """
    result = _erase_region(img, rect_px, all_element_bboxes_px)
    return _draw_text(result, rect_px, text, new_font_size_pt, dpi, color_rgb)


def _draw_watermark(img: np.ndarray) -> np.ndarray:
    """Add 'DRAFT — NOT FOR PRODUCTION' banner at the bottom of the image."""
    h, w = img.shape[:2]
    font_size_px = max(12, w // 60)
    font = _get_font(font_size_px)

    pil_img = Image.fromarray(img)
    draw = ImageDraw.Draw(pil_img)
    text = "DRAFT — NOT FOR PRODUCTION"

    try:
        text_w = int(draw.textlength(text, font=font))
    except Exception:
        text_w = len(text) * font_size_px // 2

    x = max(0, (w - text_w) // 2)
    baseline_y = h - font_size_px

    draw.rectangle(
        [x - 4, baseline_y - font_size_px - 4, x + text_w + 4, baseline_y + 4],
        fill=(255, 238, 238),
    )
    try:
        draw.text((x, baseline_y), text, font=font, fill=(199, 20, 20), anchor="ls")
    except TypeError:
        draw.text((x, baseline_y - font_size_px), text, font=font, fill=(199, 20, 20))

    return np.array(pil_img)


def _img_to_pdf(
    img: np.ndarray,
    orig_pdf_path: str,
    page_num: int,
    draft_path: str,
) -> None:
    """Composite the numpy RGB image into a single-page PDF at the original page dimensions."""
    doc_orig = fitz.open(orig_pdf_path)
    w_pts = doc_orig[page_num].rect.width
    h_pts = doc_orig[page_num].rect.height
    doc_orig.close()

    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format="PNG")

    new_doc = fitz.open()
    new_page = new_doc.new_page(width=w_pts, height=h_pts)
    new_page.insert_image(new_page.rect, stream=buf.getvalue())
    new_doc.save(draft_path, garbage=4, deflate=True)
    new_doc.close()


# ── Orchestrator ──────────────────────────────────────────────────────────────

def generate_raster_draft(
    pdf_path: str,
    artwork_id: str,
    page_num: int,
    actions: list[dict],
    output_dir: str | None = None,
    dpi: int = 300,
    extra_neighbor_bboxes_pts: list[tuple] | None = None,
) -> dict:
    """
    1. Load (or create) the cached base PNG for this artwork+page.
    2. Make an in-memory copy — base image is never mutated.
    3. For each action, resolve target rect/font/color from action['_element']
       (injected by routes.py, same convention as pdf_draft_engine.py Phase 1).
    4. Apply the appropriate raster operation.
    5. Composite final image into a single-page PDF and save to previews/.
    6. Return the same response shape as generate_pdf_draft().

    extra_neighbor_bboxes_pts: optional list of (x0, y0, x1, y1) tuples in PDF
    points for elements that detect_elements() cannot find (e.g. vector/Form XObject
    logos). These are appended to the detected element list and used by _erase_region
    to prevent inpainting from crossing into those areas.
    """
    from engines.pdf_draft_engine import _measure_text_width
    from engines.detector import detect_elements as _detect_elements

    preview_dir = Path(output_dir or settings.PREVIEW_DIR)
    preview_dir.mkdir(exist_ok=True)
    t0 = time.time()

    doc = fitz.open(pdf_path)
    pw_pts = doc[page_num].rect.width
    ph_pts = doc[page_num].rect.height
    doc.close()

    # Build pixel-space bbox list for ALL detected elements on this page.
    # Passed to every _erase_region call so the inpainting patch never
    # crosses into a neighboring element's area.
    _all_elems = _detect_elements(pdf_path, page_num)
    all_bboxes_px: list[tuple] = [
        _pdf_rect_to_px(
            (e["x_pts"], e["y_pts"], e["x_pts"] + e["w_pts"], e["y_pts"] + e["h_pts"]),
            dpi,
        )
        for e in _all_elems
    ]
    # Append caller-supplied bboxes for vector/Form XObject elements that
    # detect_elements() cannot pick up (e.g. the CLIENT_BRAND logo on the CLIENT_PRODUCT carton).
    if extra_neighbor_bboxes_pts:
        all_bboxes_px.extend(_pdf_rect_to_px(b, dpi) for b in extra_neighbor_bboxes_pts)

    base_path = get_or_create_base_image(pdf_path, artwork_id, page_num, dpi)
    img = _load_base_as_array(base_path)

    applied = 0
    failed = 0
    skipped = 0
    overflow_warnings: list[dict] = []

    for action in actions:
        action_type = str(action.get("action_type", "")).lower()
        elem = action.get("_element")

        if elem:
            rect_pts = (
                elem["x_norm"] * pw_pts,
                elem["y_norm"] * ph_pts,
                (elem["x_norm"] + elem["w_norm"]) * pw_pts,
                (elem["y_norm"] + elem["h_norm"]) * ph_pts,
            )
            font_size_pt = float(elem.get("font_size") or 12)
            color_rgb = _hex_to_rgb_255(elem.get("color_rgb") or "#000000")
        else:
            sx = float(action.get("sel_x") or 0)
            sy = float(action.get("sel_y") or 0)
            sw = float(action.get("sel_w") or 0)
            sh = float(action.get("sel_h") or 0)
            rect_pts = (sx * pw_pts, sy * ph_pts, (sx + sw) * pw_pts, (sy + sh) * ph_pts)
            font_size_pt = 12.0
            color_rgb = (0, 0, 0)

        rect_px = _pdf_rect_to_px(rect_pts, dpi)

        try:
            if action_type == "delete":
                img = _erase_region(img, rect_px, all_bboxes_px)
                applied += 1

            elif action_type == "replace":
                new_text = (action.get("new_text") or "").strip()
                if not new_text:
                    log.error("Replace action missing new_text — skipping")
                    failed += 1
                    continue

                rect_w_pts = rect_pts[2] - rect_pts[0]
                required_w = _measure_text_width(new_text, font_size_pt, "raster")
                overflow_warnings.append({
                    "fits": required_w <= rect_w_pts,
                    "available_width_pts": round(rect_w_pts, 2),
                    "required_width_pts": round(required_w, 2),
                    "overflow_width_pts": round(max(0.0, required_w - rect_w_pts), 2),
                    "overflow_percentage": round(
                        max(0.0, (required_w - rect_w_pts) / rect_w_pts * 100), 1
                    ),
                })
                img = _erase_region(img, rect_px, all_bboxes_px)
                img = _draw_text(img, rect_px, new_text, font_size_pt, dpi, color_rgb)
                applied += 1

            elif action_type == "move":
                dx_mm = float(action.get("dx_mm") or 0)
                dy_mm = float(action.get("dy_mm") or 0)
                dx_pts = dx_mm * 72 / 25.4
                dy_pts = dy_mm * 72 / 25.4
                x0, y0, x1, y1 = rect_pts
                dst_pts = (x0 + dx_pts, y0 + dy_pts, x1 + dx_pts, y1 + dy_pts)
                dst_px = _pdf_rect_to_px(dst_pts, dpi)
                img = _move_region(img, rect_px, dst_px, all_bboxes_px)
                applied += 1

            elif action_type == "resize":
                orig_text = (action.get("original_text") or "").strip()
                new_fs = float(action.get("new_font_size") or font_size_pt)
                if not orig_text:
                    log.warning("Resize action missing original_text — skipping")
                    skipped += 1
                    continue
                img = _resize_region(img, rect_px, font_size_pt, new_fs, orig_text, dpi, color_rgb, all_bboxes_px)
                applied += 1

            else:
                log.warning("Unsupported action type '%s' in raster_v3", action_type)
                skipped += 1

        except Exception as exc:
            log.error("raster_v3 action '%s' failed: %s", action_type, exc)
            failed += 1

    img = _draw_watermark(img)

    name = f"draft_v3_{uuid.uuid4().hex[:8]}_{int(time.time())}.pdf"
    draft_path = str(preview_dir / name)
    _img_to_pdf(img, pdf_path, page_num, draft_path)

    return {
        "draft_url": f"/previews/{name}",
        "draft_path": draft_path,
        "actions_applied": applied,
        "actions_failed": failed,
        "actions_skipped": skipped,
        "engine": "raster_v3",
        "pages_modified": [page_num] if applied > 0 else [],
        "overflow_warnings": overflow_warnings,
        "collisions": [],
        "generation_time_s": round(time.time() - t0, 2),
    }
