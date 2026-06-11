"""
Generate comparison screenshots: original crop vs 4-replacement drafts.
"""
import sys, os, fitz
from pathlib import Path

sys.path.insert(0, "/app")
os.environ.setdefault("DATABASE_URL", "postgresql://briefing:briefing123@db/briefing_db")

from engines.pdf_draft_engine import generate_pdf_draft, _get_page_spans

PDFS = {
    "CLIENT_PRODUCT_carton": "/app/uploads/3e1f89674b4045638f15b987275e5995_SKU_CODE_CLIENT_PRODUCT_DURA_4 pc_Carton.pdf",
    "CLIENT_PRODUCT_2_leaflet": "/app/uploads/14167ce2495a423ea1406487478b009b_PA_62000000217710_CLIENT_PRODUCT_2_CLIENT_PRODUCT_2_NA_Leaflet.pdf",
    "CLIENT_PRODUCT_2_foil": "/app/uploads/foil_test.pdf",
}

MULTIPLIERS = [1.0, 1.25, 2.0, 4.0]
MULT_LABELS = ["same", "+25pct", "+100pct", "+300pct"]
OUT_DIR = Path("/app/previews/validation")
OUT_DIR.mkdir(exist_ok=True)
DPI = 150
SCALE = DPI / 72.0
PAD_PT = 30  # padding around span in pts

def pick_target_span(pdf_path):
    doc = fitz.open(pdf_path)
    page = doc[0]
    spans = _get_page_spans(page)
    doc.close()
    for span in spans:
        t = span.get("text", "").strip()
        bx0, by0, bx1, by1 = span["bbox"]
        width = bx1 - bx0
        if len(t) >= 4 and width > 10:
            return span
    return spans[0] if spans else None

def crop_region(pdf_path, span_bbox, pad=PAD_PT):
    doc = fitz.open(pdf_path)
    page = doc[0]
    pw, ph = page.rect.width, page.rect.height
    x0, y0, x1, y1 = span_bbox
    cx0 = max(0, x0 - pad)
    cy0 = max(0, y0 - pad)
    cx1 = min(pw, x1 + pad)
    cy1 = min(ph, y1 + pad)
    clip = fitz.Rect(cx0, cy0, cx1, cy1)
    mat  = fitz.Matrix(SCALE, SCALE)
    pix  = page.get_pixmap(matrix=mat, clip=clip, alpha=False)
    doc.close()
    return pix, (cx0, cy0, cx1, cy1)

for pdf_key, pdf_path in PDFS.items():
    if not Path(pdf_path).exists():
        print(f"SKIP: {pdf_key}")
        continue

    doc = fitz.open(pdf_path)
    page = doc[0]
    pw, ph = page.rect.width, page.rect.height
    doc.close()

    target = pick_target_span(pdf_path)
    if not target:
        continue

    orig_text = target.get("text", "").strip()
    orig_len  = len(orig_text)
    tx0, ty0, tx1, ty1 = target["bbox"]

    # Save original crop
    orig_pix, crop_rect = crop_region(pdf_path, target["bbox"])
    orig_png = str(OUT_DIR / f"{pdf_key}_original.png")
    orig_pix.save(orig_png)
    print(f"Saved original: {orig_png}")

    for mult, label in zip(MULTIPLIERS, MULT_LABELS):
        n_chars  = max(1, int(orig_len * mult))
        new_text = ((orig_text + " ") * 20)[:n_chars]

        action = {
            "action_type": "replace",
            "sel_x": tx0 / pw,
            "sel_y": ty0 / ph,
            "sel_w": (tx1 - tx0) / pw,
            "sel_h": (ty1 - ty0) / ph,
            "new_text": new_text,
            "element_id": None,
        }

        try:
            result = generate_pdf_draft(
                pdf_path=pdf_path,
                actions=[action],
                page_number=0,
            )
            draft_path = result.get("draft_path", "")
            if not draft_path or not Path(draft_path).exists():
                print(f"  {label}: no draft produced")
                continue

            # Crop the same region from the draft
            cx0, cy0, cx1, cy1 = crop_rect
            doc_d = fitz.open(draft_path)
            pg_d  = doc_d[0]
            clip  = fitz.Rect(cx0, cy0, cx1, cy1)
            mat   = fitz.Matrix(SCALE, SCALE)
            pix_d = pg_d.get_pixmap(matrix=mat, clip=clip, alpha=False)
            doc_d.close()
            out_png = str(OUT_DIR / f"{pdf_key}_{label}.png")
            pix_d.save(out_png)
            print(f"  {label}: {out_png}")

            # Cleanup draft
            Path(draft_path).unlink(missing_ok=True)

        except Exception as e:
            print(f"  {label}: ERROR {e}")

print("\nAll screenshots saved to /app/previews/validation/")
