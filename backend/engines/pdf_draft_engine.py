from __future__ import annotations

"""
backend/engines/pdf_draft_engine.py

Phase 1 PDF-native draft engine.

Handles Delete and Replace via PyMuPDF add_redact_annot + apply_redactions
+ insert_text.  Move / Resize / Bold remain on the raster path (Phase 2).

CRITICAL: The original PDF is NEVER modified.
          fitz.open(pdf_path) is read-only in memory; the result is saved
          to a new file at draft_path.  No shutil.copy needed.

Coordinate system (confirmed by spike):
    get_text("rawdict") → span["origin"] is in screen coords (y=0 at top)
    insert_text(point)  → PDF coords (y=0 at bottom)
    Conversion: pdf_y = page_height_pts - screen_origin_y

Font strategy (permanent for pharma PDFs):
    All CFF/Type1 subsets return empty bytes from extract_font().
    Fallback is Helvetica ("helv").  The font cache avoids repeated
    extract_font() calls for the same xref within one generation run.
"""

import fitz
import uuid
import time
import logging
from collections import defaultdict
from pathlib import Path
from core.config import settings

log = logging.getLogger(__name__)

PDF_NATIVE_TYPES = {"delete", "replace"}


# ── Font helpers ───────────────────────────────────────────────────────────────

def _extract_fontname(doc: fitz.Document, xref: int,
                      font_cache: dict) -> str:
    """
    Try to extract the embedded font bytes for xref.
    Returns "helv" for all CFF/Type1 subsets (proven non-extractable).
    Results are cached in font_cache to avoid redundant extract_font calls.
    """
    if xref in font_cache:
        return font_cache[xref]
    try:
        font_data, _ = doc.extract_font(xref)
        fontname = "helv" if not font_data else f"_f{xref}"
    except Exception:
        fontname = "helv"
    font_cache[xref] = fontname
    return fontname


def _build_font_map(doc: fitz.Document, page_num: int) -> dict[str, int]:
    """
    Returns {short_font_name: xref, full_subset_name: xref} for every font
    on the page.  Used to resolve a span's font name to its xref.
    """
    font_map: dict[str, int] = {}
    for f in doc.get_page_fonts(page_num, full=True):
        xref, _ext, _ftype, basefont, _name, *_ = f
        font_map[basefont] = xref
        if "+" in basefont:
            font_map[basefont.split("+", 1)[1]] = xref
    return font_map


# ── Span finder ────────────────────────────────────────────────────────────────

def _get_page_spans(page: fitz.Page) -> list[dict]:
    """
    Return all non-empty text spans from page using "dict" mode.
    "dict" mode guarantees a "text" key; "rawdict" only provides "chars"
    and omits "text" in some PyMuPDF builds.
    Both modes include: bbox, origin, color, size, font.
    """
    spans = []
    for block in page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                if span.get("text", "").strip():
                    spans.append(span)
    return spans


def _find_best_span(page: fitz.Page, rect: fitz.Rect) -> dict | None:
    """
    Return the text span with the largest bbox overlap with rect.
    Falls back to centre-point containment if no intersection found.
    Must be called BEFORE apply_redactions() on the page.
    """
    best_span: dict | None = None
    best_area: float = 0.0
    all_spans = _get_page_spans(page)

    for span in all_spans:
        sr = fitz.Rect(span["bbox"])
        inter = sr & rect
        area = abs(inter)
        if area > best_area:
            best_area = area
            best_span = span

    if best_span is None:
        # Centre-point fallback
        cx = (rect.x0 + rect.x1) / 2
        cy = (rect.y0 + rect.y1) / 2
        for span in all_spans:
            sx0, sy0, sx1, sy1 = span["bbox"]
            if sx0 <= cx <= sx1 and sy0 <= cy <= sy1:
                return span

    return best_span


# ── Color helpers ──────────────────────────────────────────────────────────────

def _int_to_rgb(color_int: int) -> tuple[float, float, float]:
    return (
        ((color_int >> 16) & 0xFF) / 255.0,
        ((color_int >> 8)  & 0xFF) / 255.0,
        (color_int & 0xFF) / 255.0,
    )


def _hex_to_rgb(hex_str: str) -> tuple[float, float, float]:
    h = (hex_str or "#000000").lstrip("#").ljust(6, "0")
    return int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255


# ── Per-action helpers ─────────────────────────────────────────────────────────

def _action_rect(action: dict, pw: float, ph: float) -> fitz.Rect | None:
    """Convert normalised action selection to a pts Rect. Returns None if degenerate."""
    sx = float(action.get("sel_x") or 0)
    sy = float(action.get("sel_y") or 0)
    sw = float(action.get("sel_w") or 0)
    sh = float(action.get("sel_h") or 0)
    if sw <= 0 or sh <= 0:
        return None
    return fitz.Rect(sx * pw, sy * ph, (sx + sw) * pw, (sy + sh) * ph)


def _resolve_insert_params(
    span: dict | None,
    rect: fitz.Rect,
    ph: float,
    new_text: str,
    doc: fitz.Document,
    page_num: int,
    font_map: dict[str, int],
    font_cache: dict,
) -> dict:
    """
    Build the kwargs dict for page.insert_text() from span metrics.
    If no matching span was found, falls back to bbox-derived estimates.
    """
    if span:
        origin = span.get("origin", [rect.x0, rect.y1])
        pdf_x = float(origin[0])
        pdf_y = ph - float(origin[1])   # screen → PDF y-flip (spike-confirmed)
        fontsize = float(span.get("size") or 12)
        color = _int_to_rgb(int(span.get("color") or 0))

        # Resolve font xref → extract or fall back to helv
        span_font = span.get("font", "")
        short_name = span_font.split("+", 1)[-1] if "+" in span_font else span_font
        xref = font_map.get(span_font) or font_map.get(short_name)
        fontname = _extract_fontname(doc, xref, font_cache) if xref else "helv"
    else:
        # No span found — estimate from selection bbox
        pdf_x = rect.x0
        # Baseline at ~80 % from top of bbox
        pdf_y = ph - (rect.y0 + rect.height * 0.80)
        fontsize = max(6.0, min(rect.height * 0.75, 72.0))
        color = (0.0, 0.0, 0.0)
        fontname = "helv"

    return {
        "point":    fitz.Point(pdf_x, pdf_y),
        "text":     new_text,
        "fontname": fontname,
        "fontsize": fontsize,
        "color":    color,
    }


# ── Watermark ──────────────────────────────────────────────────────────────────

def _add_watermark(page: fitz.Page) -> None:
    """
    Add a DRAFT watermark as a FreeText annotation (not burned into content
    stream).  Falls back to insert_text if the annotation API fails.
    """
    wm_rect = fitz.Rect(
        10,
        page.rect.height - 35,
        page.rect.width - 10,
        page.rect.height - 10,
    )
    try:
        annot = page.add_freetext_annot(
            wm_rect,
            "DRAFT — NOT FOR PRODUCTION",
            fontsize=9,
            text_color=(0.78, 0.08, 0.08),
            fill_color=(1.0, 0.93, 0.93),
            border_color=(0.78, 0.08, 0.08),
        )
        annot.update()
    except Exception as exc:
        log.warning("FreeText watermark failed (%s) — using insert_text", exc)
        page.insert_text(
            fitz.Point(12, page.rect.height - 18),
            "DRAFT — NOT FOR PRODUCTION",
            fontsize=9,
            color=(0.78, 0.08, 0.08),
        )


# ── QA helper (used by tests) ──────────────────────────────────────────────────

def measure_surgical_precision(
    original_path: str,
    draft_path: str,
    target_bbox_pts: tuple[float, float, float, float],
    dpi: int = 150,
) -> dict:
    """
    Quantify the actual content change vs render noise.

    Methodology (proven in Phase 1 spike):
      apply_redactions() rewrites the content stream, causing ~7.7% pixel
      diff even for a null redaction.  To isolate true content change we
      compare the draft against a null-redact baseline (a copy of the
      original that has been through apply_redactions() with no real edits).

    Returns:
        total_px, noise_px (null-redact diff), content_px (actual change),
        content_pct, target_bbox_pct
    """
    import numpy as np

    scale = dpi / 72.0

    def _render(path: str) -> "np.ndarray":
        doc = fitz.open(path)
        pix = doc[0].get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        doc.close()
        import io
        from PIL import Image
        return np.array(Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB"))

    # Null-redact baseline: open original, apply_redactions with nothing queued,
    # save to temp, then compare with original.
    import tempfile, shutil
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        null_path = tmp.name
    try:
        shutil.copy(original_path, null_path)
        # Open original for the null-redact, save to a SEPARATE temp path
        null_out_path = null_path + ".rendered.pdf"
        ndoc = fitz.open(null_path)
        # Redact a 1×1 pt blank area (outside content) to trigger content stream rewrite
        ndoc[0].add_redact_annot(fitz.Rect(0, 0, 1, 1))
        ndoc[0].apply_redactions()
        ndoc.save(null_out_path, garbage=4, deflate=True)
        ndoc.close()

        orig_arr  = _render(original_path)
        null_arr  = _render(null_out_path)
        draft_arr = _render(draft_path)

        total_px   = orig_arr.size // 3
        noise_arr  = np.abs(null_arr.astype(int) - orig_arr.astype(int)).max(axis=2)
        diff_arr   = np.abs(draft_arr.astype(int) - null_arr.astype(int)).max(axis=2)

        noise_px   = int((noise_arr > 5).sum())
        content_px = int((diff_arr > 5).sum())

        # Pixels in target bbox
        ph_px = orig_arr.shape[0]
        pw_px = orig_arr.shape[1]
        x0, y0, x1, y1 = target_bbox_pts
        bx0 = max(0, int(x0 * scale))
        by0 = max(0, int(y0 * scale))
        bx1 = min(pw_px, int(x1 * scale))
        by1 = min(ph_px, int(y1 * scale))
        target_px = int((diff_arr[by0:by1, bx0:bx1] > 5).sum())

        return {
            "total_px":       total_px,
            "noise_px":       noise_px,
            "noise_pct":      round(noise_px / total_px * 100, 3),
            "content_px":     content_px,
            "content_pct":    round(content_px / total_px * 100, 3),
            "target_bbox_px": target_px,
        }
    finally:
        import os
        for p in (null_path, null_path + ".rendered.pdf"):
            try:
                os.unlink(p)
            except OSError:
                pass


# ── Main entry point ───────────────────────────────────────────────────────────

def generate_pdf_draft(
    pdf_path: str,
    actions: list[dict],
    page_number: int = 0,
    output_dir: str | None = None,
) -> dict:
    """
    Open the original PDF read-only, apply all Delete/Replace actions in
    memory, save to a new draft file.  Move/Resize/Bold are logged and
    skipped (Phase 2).

    Returns the same shape as generate_draft() plus:
        engine          : "pdf_native"
        actions_skipped : int
        pages_modified  : [int]
    """
    preview_dir = Path(output_dir or settings.PREVIEW_DIR)
    preview_dir.mkdir(exist_ok=True)
    name = f"draft_{uuid.uuid4().hex[:8]}_{int(time.time())}.pdf"
    draft_path = str(preview_dir / name)

    # Open original in read-only mode (never writes to original)
    doc = fitz.open(pdf_path)

    applied  = 0
    failed   = 0
    skipped  = 0
    pages_modified: set[int] = set()

    # Group actions by page
    by_page: dict[int, list] = defaultdict(list)
    for a in actions:
        by_page[int(a.get("page", page_number))].append(a)

    for pg, page_actions in by_page.items():
        if pg >= len(doc):
            log.warning("Page %d out of range (doc has %d pages) — skipping", pg, len(doc))
            skipped += len(page_actions)
            continue

        page = doc[pg]
        pw   = page.rect.width
        ph   = page.rect.height

        # Build per-page helpers (needed before any redactions)
        font_map:   dict[str, int] = _build_font_map(doc, pg)
        font_cache: dict[int, str] = {}

        # Separate actions by type
        deletes  = [a for a in page_actions
                    if str(a.get("action_type", "")).lower() == "delete"]
        replaces = [a for a in page_actions
                    if str(a.get("action_type", "")).lower() == "replace"]
        others   = [a for a in page_actions
                    if str(a.get("action_type", "")).lower() not in PDF_NATIVE_TYPES]

        for a in others:
            log.warning(
                "Action type '%s' skipped on page %d — not yet supported in pdf_native engine (Phase 2)",
                a.get("action_type"), pg,
            )
        skipped += len(others)

        # ── Phase A: collect span metadata & queue all redact annotations ────
        # IMPORTANT: _find_best_span must be called before apply_redactions,
        # as apply_redactions rewrites the content stream.

        insert_queue: list[dict] = []  # insert_text kwargs for each replace
        redact_count = 0

        for action in replaces:
            new_text = (action.get("new_text") or "").strip()
            if not new_text:
                log.error("Replace action missing new_text — skipping")
                failed += 1
                continue

            rect = _action_rect(action, pw, ph)
            if rect is None:
                log.error("Replace action has zero-size selection — skipping")
                failed += 1
                continue

            span = _find_best_span(page, rect)
            if span is None:
                log.warning(
                    "No text span found in selection rect %s — using bbox estimates", rect
                )

            params = _resolve_insert_params(
                span, rect, ph, new_text, doc, pg, font_map, font_cache
            )
            page.add_redact_annot(rect)
            redact_count += 1
            insert_queue.append(params)

        for action in deletes:
            rect = _action_rect(action, pw, ph)
            if rect is None:
                log.error("Delete action has zero-size selection — skipping")
                failed += 1
                continue
            page.add_redact_annot(rect)
            redact_count += 1

        # ── Phase B: flush all redactions in one pass ────────────────────────
        if redact_count == 0:
            # No native actions were queued — others already counted above
            continue

        try:
            page.apply_redactions()
            pages_modified.add(pg)
            applied += len(deletes)  # deletes are complete after apply_redactions
        except Exception as exc:
            log.error("apply_redactions failed on page %d: %s", pg, exc)
            failed += len(deletes) + len(insert_queue)
            continue

        # ── Phase C: insert replacement texts ───────────────────────────────
        for params in insert_queue:
            try:
                chars = page.insert_text(
                    params["point"],
                    params["text"],
                    fontname=params["fontname"],
                    fontsize=params["fontsize"],
                    color=params["color"],
                )
                if chars >= 0:
                    applied += 1
                else:
                    log.error(
                        "insert_text returned %d for text %r", chars, params["text"][:20]
                    )
                    failed += 1
            except Exception as exc:
                log.error("insert_text failed: %s", exc)
                failed += 1

    # ── Watermark each modified page (annotation, not content stream) ────────
    for pg in sorted(pages_modified):
        _add_watermark(doc[pg])

    # ── Save to new file — original is NEVER written to ─────────────────────
    doc.save(draft_path, garbage=4, deflate=True)
    doc.close()

    return {
        "draft_url":       f"/previews/{name}",
        "draft_path":      draft_path,
        "actions_applied": applied,
        "actions_failed":  failed,
        "actions_skipped": skipped,
        "engine":          "pdf_native",
        "pages_modified":  sorted(pages_modified),
    }
