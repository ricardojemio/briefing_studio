import fitz, io
from pathlib import Path
from core.config import settings

# Increment whenever detection granularity or logic changes so that the
# routes layer knows to delete and re-detect stale stored Elements.
DETECTION_VERSION = 2

def detect_elements(pdf_path: str, page_number: int = 0) -> list:
    doc = fitz.open(pdf_path)
    page = doc[page_number]
    pw, ph = page.rect.width, page.rect.height
    elements = []
    eid = 0

    # TEXT — one Element per PDF *line* (all spans on the same baseline merged).
    # PyMuPDF's line dict groups spans that share the same baseline direction,
    # so iterating at line granularity gives the correct visual unit.
    for block in page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = [s for s in line.get("spans", []) if s.get("text", "").strip()]
            if not spans:
                continue

            # Union bbox across all spans on this line
            x0 = min(s["bbox"][0] for s in spans)
            y0 = min(s["bbox"][1] for s in spans)
            x1 = max(s["bbox"][2] for s in spans)
            y1 = max(s["bbox"][3] for s in spans)

            line_text = "".join(s.get("text", "") for s in spans).strip()
            if not line_text:
                continue

            # Dominant span (largest area) provides font_size, font_name, color
            dominant = max(
                spans,
                key=lambda s: (s["bbox"][2] - s["bbox"][0]) * (s["bbox"][3] - s["bbox"][1]),
            )
            ci = dominant.get("color", 0)
            r, g, b = (ci >> 16) & 0xFF, (ci >> 8) & 0xFF, ci & 0xFF

            elements.append({
                "id": f"text_{eid}", "type": "text", "label": line_text,
                "font_name": dominant.get("font", ""),
                "font_size": round(dominant.get("size", 12), 2),
                "color": f"#{r:02x}{g:02x}{b:02x}",
                "x_pts": x0, "y_pts": y0, "w_pts": x1 - x0, "h_pts": y1 - y0,
                "x_norm": x0/pw, "y_norm": y0/ph,
                "w_norm": (x1-x0)/pw, "h_norm": (y1-y0)/ph,
                "page": page_number,
                "allowed_actions": ["replace", "delete", "move", "resize"],
                "extra": {"dv": DETECTION_VERSION},
            })
            eid += 1

    # IMAGES
    for img_info in page.get_images(full=True):
        xref = img_info[0]
        for rect in page.get_image_rects(xref):
            x0, y0, x1, y1 = rect.x0, rect.y0, rect.x1, rect.y1
            area = ((x1-x0)*(y1-y0))*(25.4/72)**2
            elements.append({
                "id": f"img_{eid}", "type": "image",
                "label": "Logo / Ícone" if area < 500 else "Imagem",
                "font_name": None, "font_size": None, "color": None,
                "x_pts": x0, "y_pts": y0, "w_pts": x1-x0, "h_pts": y1-y0,
                "x_norm": x0/pw, "y_norm": y0/ph,
                "w_norm": (x1-x0)/pw, "h_norm": (y1-y0)/ph,
                "page": page_number,
                "allowed_actions": ["move", "delete"],
                "extra": {"w_px": img_info[2], "h_px": img_info[3], "dv": DETECTION_VERSION},
            })
            eid += 1

    doc.close()
    return elements

def render_page(pdf_path: str, page_number: int = 0, dpi: int = None) -> dict:
    dpi = dpi or settings.PDF_DPI
    doc = fitz.open(pdf_path)
    page = doc[page_number]
    scale = dpi / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(scale,scale), alpha=False)
    preview_dir = Path(settings.PREVIEW_DIR)
    preview_dir.mkdir(exist_ok=True)
    fname = f"{Path(pdf_path).stem}_p{page_number}_{dpi}dpi.png"
    path  = str(preview_dir / fname)
    pix.save(path)
    w_pts, h_pts = page.rect.width, page.rect.height
    doc.close()
    return {"preview_url":f"/previews/{fname}","preview_path":path,
            "width_px":pix.width,"height_px":pix.height,
            "width_pts":w_pts,"height_pts":h_pts,"scale_factor":scale,"dpi":dpi,"page_number":page_number}

def get_pdf_info(pdf_path: str) -> dict:
    doc = fitz.open(pdf_path)
    pages = [{"page":i,"width_pts":round(p.rect.width,2),"height_pts":round(p.rect.height,2),
              "width_mm":round(p.rect.width*25.4/72,2),"height_mm":round(p.rect.height*25.4/72,2)}
             for i,p in enumerate(doc)]
    doc.close()
    return {"total_pages":len(pages),"pages":pages}
