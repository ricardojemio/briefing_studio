"""
backend/engines/draft_engine.py
FIXES APPLIED:
  #4 - Resize bug: / 1.3 → * 1.3 (inversão corrigida)
  #5 - Replace: mantém fonte/cor, reflow de texto com quebra de linha
  #6 - Bold: detecta variante bold da fonte original
"""
import fitz, io, uuid, time
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
from core.config import settings


def _font(size_px: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """Load font — tries bold variant first if requested."""
    size_px = max(6, size_px)
    candidates = []
    if bold:
        candidates += [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        ]
    candidates += [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for p in candidates:
        try:
            return ImageFont.truetype(p, size_px)
        except Exception:
            pass
    return ImageFont.load_default()


def _bg(img: Image.Image, x0, y0, x1, y1) -> tuple:
    """Sample background color using median of a strip above the element.

    Uses median (not mean) to resist outlier pixels from logos or borders.
    Handles both RGB and RGBA images safely.
    """
    arr = np.array(img)
    # Take only the first 3 channels so RGBA PDFs don't crash reshape(-1,3)
    arr = arr[:, :, :3]
    strip = arr[max(0, y0 - 4):max(1, y0), max(0, x0):min(arr.shape[1], x1)]
    if strip.size == 0:
        strip = arr[y0:min(y0 + 4, arr.shape[0]), max(0, x0):min(arr.shape[1], x1)]
    if strip.size == 0:
        return (255, 255, 255)
    m = np.median(strip.reshape(-1, 3), axis=0)
    return (int(m[0]), int(m[1]), int(m[2]))


def _hex_rgb(h: str) -> tuple:
    h = (h or "#000000").lstrip('#')
    if len(h) < 6:
        h = h.ljust(6, '0')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def _wrap_text(text: str, font: ImageFont.FreeTypeFont,
               max_width: int) -> list[str]:
    """Wrap text into lines that fit within max_width pixels."""
    words = text.split()
    lines, current = [], ""
    for word in words:
        test = (current + " " + word).strip()
        try:
            w = font.getlength(test)
        except AttributeError:
            w = len(test) * (font.size // 2)
        if w <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [text]


def _pts_to_px(pts: float, scale: float) -> int:
    return int(pts * scale)


def generate_draft(pdf_path, actions, elements, page_number=0, dpi=None):
    dpi   = dpi or settings.PDF_DPI_HIGH
    scale = dpi / 72.0

    doc  = fitz.open(pdf_path)
    page = doc[page_number]
    pix  = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    img  = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    doc.close()

    draw = ImageDraw.Draw(img)
    img_w, img_h = img.size

    # Element map — index by both id and elem_id
    emap = {}
    for e in elements:
        emap[e["id"]]                     = e
        emap[e.get("elem_id", e["id"])]   = e

    applied = failed = 0

    for action in actions:
        try:
            at  = str(
                action.get("action_type", "") if isinstance(action, dict)
                else getattr(action, "action_type", "")
            ).lower()

            eid  = (action.get("element_id") if isinstance(action, dict)
                    else getattr(action, "element_id", None))
            elem = emap.get(str(eid) if eid else "")

            if elem:
                x0 = int(elem["x_norm"] * img_w)
                y0 = int(elem["y_norm"] * img_h)
                x1 = int((elem["x_norm"] + elem["w_norm"]) * img_w)
                y1 = int((elem["y_norm"] + elem["h_norm"]) * img_h)
                fs = elem.get("font_size") or 12
                oc = _hex_rgb(elem.get("color") or "#000000")
            else:
                sx = float(action.get("sel_x") if isinstance(action, dict) else getattr(action, "sel_x", 0) or 0)
                sy = float(action.get("sel_y") if isinstance(action, dict) else getattr(action, "sel_y", 0) or 0)
                sw = float(action.get("sel_w") if isinstance(action, dict) else getattr(action, "sel_w", 0) or 0)
                sh = float(action.get("sel_h") if isinstance(action, dict) else getattr(action, "sel_h", 0) or 0)
                x0, y0 = int(sx * img_w), int(sy * img_h)
                x1, y1 = int((sx + sw) * img_w), int((sy + sh) * img_h)
                fs, oc = 12, (0, 0, 0)

            w = max(1, x1 - x0)
            h = max(1, y1 - y0)
            bg = _bg(img, x0, y0, x1, y1)

            # ── FIX #4: RESIZE — correct scale direction ──────────────────
            # BUG WAS: int(fs * scale / 1.3)  ← dividing made small fonts huge
            # FIX IS:  int(fs * scale / 72 * dpi_factor) using proper pt→px
            def pt_to_px(pt: float) -> int:
                # Correct formula: pt * DPI / 72
                return max(6, int(pt * dpi / 72))

            fpx = pt_to_px(fs)
            is_bold = (action.get("bold") if isinstance(action, dict)
                       else getattr(action, "bold", False)) or False
            fnt = _font(fpx, bold=bool(is_bold))

            str_at = str(at)

            # ── REPLACE ───────────────────────────────────────────────────
            if "replace" in str_at:
                nt = (action.get("new_text") if isinstance(action, dict)
                      else getattr(action, "new_text", "")) or ""
                if not nt:
                    continue

                lines = _wrap_text(nt, fnt, w)
                line_h = fpx + 2

                erase_h = max(h, line_h * len(lines) + 4)
                draw.rectangle([x0 - 2, y0 - 2, x1 + 2, y0 + erase_h + 4],
                                fill=bg)

                # Draw each line
                for i, line in enumerate(lines):
                    draw.text((x0, y0 + i * line_h), line,
                               fill=oc, font=fnt)

                # Green border = replaced
                draw.rectangle([x0 - 2, y0 - 2,
                                 x1 + 2, y0 + erase_h + 2],
                                outline=(29, 158, 117), width=2)

            # ── DELETE ────────────────────────────────────────────────────
            elif "delete" in str_at:
                draw.rectangle([x0, y0, x1, y1], fill=bg)
                draw.rectangle([x0 - 2, y0 - 2, x1 + 2, y1 + 2],
                                outline=(220, 50, 50), width=2)
                sm = _font(max(8, fpx // 2))
                draw.text((x0, max(0, y0 - 12)),
                           "[DELETED]", fill=(220, 50, 50), font=sm)

            # ── MOVE ──────────────────────────────────────────────────────
            elif "move" in str_at:
                dx_mm = float(action.get("dx_mm") if isinstance(action, dict)
                              else getattr(action, "dx_mm", 0) or 0)
                dy_mm = float(action.get("dy_mm") if isinstance(action, dict)
                              else getattr(action, "dy_mm", 0) or 0)
                # FIX: use correct pts-per-mm conversion at current DPI
                dx_px = int(dx_mm * dpi / 25.4)
                dy_px = int(dy_mm * dpi / 25.4)

                region = img.crop((x0, y0, x1, y1))
                draw.rectangle([x0, y0, x1, y1], fill=bg)
                nx, ny = x0 + dx_px, y0 + dy_px
                # Clamp to image bounds
                nx = max(0, min(img_w - w, nx))
                ny = max(0, min(img_h - h, ny))
                img.paste(region, (nx, ny))
                draw = ImageDraw.Draw(img)
                draw.rectangle([nx - 2, ny - 2, nx + w + 2, ny + h + 2],
                                outline=(24, 95, 165), width=2)
                draw.line([(x0 + w // 2, y0 + h // 2),
                            (nx + w // 2, ny + h // 2)],
                           fill=(24, 95, 165), width=1)

            # ── RESIZE ────────────────────────────────────────────────────
            elif "resize" in str_at:
                nfs = (action.get("new_font_size") if isinstance(action, dict)
                       else getattr(action, "new_font_size", None))
                if not nfs or nfs <= 0:
                    continue

                # FIX #4: correct pt → px conversion (was inverted)
                new_px  = pt_to_px(float(nfs))
                fnt_new = _font(new_px, bold=bool(is_bold))

                orig_text = (action.get("original_text") if isinstance(action, dict)
                             else getattr(action, "original_text", "")) or ""

                lines  = _wrap_text(orig_text, fnt_new, w)
                line_h  = new_px + 2
                text_h  = line_h * len(lines)       # actual rendered text height
                erase_h = max(h, text_h + 4)        # fill zone clears original bbox too

                draw.rectangle([x0 - 2, y0 - 2, x1 + 2, y0 + erase_h + 4],
                                fill=bg)
                for i, line in enumerate(lines):
                    draw.text((x0, y0 + i * line_h), line,
                               fill=oc, font=fnt_new)
                # Outline bounds the text only — not the erase zone
                draw.rectangle([x0 - 2, y0 - 2, x1 + 2, y0 + text_h + 2],
                                outline=(186, 117, 23), width=2)

                delta = float(nfs) - fs
                sign  = "+" if delta >= 0 else ""
                sm    = _font(max(8, fpx // 2))
                draw.text((x1 + 4, y0),
                           f"[{sign}{delta:.0f}pt → {nfs:.0f}pt]",
                           fill=(186, 117, 23), font=sm)

            # ── BOLD ──────────────────────────────────────────────────────
            elif "bold" in str_at:
                orig_text = (action.get("original_text") if isinstance(action, dict)
                             else getattr(action, "original_text", "")) or ""
                fnt_bold  = _font(fpx, bold=True)
                lines     = _wrap_text(orig_text, fnt_bold, w)
                line_h    = fpx + 2
                erase_h   = max(h, line_h * len(lines) + 4)

                draw.rectangle([x0 - 2, y0 - 2, x1 + 2, y0 + erase_h + 4],
                                fill=bg)
                for i, line in enumerate(lines):
                    draw.text((x0, y0 + i * line_h), line,
                               fill=oc, font=fnt_bold)
                draw.rectangle([x0 - 2, y0 - 2, x1 + 2, y0 + erase_h + 2],
                                outline=(94, 53, 177), width=2)
                sm = _font(max(8, fpx // 2))
                draw.text((x1 + 4, y0), "[BOLD]",
                           fill=(94, 53, 177), font=sm)

            applied += 1

        except Exception as e:
            print(f"Action failed: {e}")
            failed += 1

    # Watermark
    ww, wh = img.size
    wfnt = _font(18)
    draw.rectangle([ww - 390, wh - 36, ww - 8, wh - 8],
                   fill=(255, 235, 235), outline=(200, 50, 50), width=2)
    draw.text((ww - 386, wh - 32),
               "DRAFT — NOT FOR PRODUCTION",
               fill=(200, 50, 50), font=wfnt)

    preview_dir = Path(settings.PREVIEW_DIR)
    preview_dir.mkdir(exist_ok=True)
    name = f"draft_{uuid.uuid4().hex[:8]}_{int(time.time())}.pdf"
    path = str(preview_dir / name)
    img.convert("RGB").save(path, "PDF", resolution=dpi)

    return {
        "draft_url":       f"/previews/{name}",
        "draft_path":      path,
        "actions_applied": applied,
        "actions_failed":  failed,
    }
