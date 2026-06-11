"""
Cross-PDF overflow + bleed validation probe — v2.
"""
import sys, os, fitz
from pathlib import Path

sys.path.insert(0, "/app")
os.environ.setdefault("DATABASE_URL", "postgresql://briefing:briefing123@db/briefing_db")

from engines.pdf_draft_engine import (
    generate_pdf_draft,
    _get_page_spans,
    _measure_text_width,
)

PDFS = {
    "CLIENT_PRODUCT Carton": "/app/uploads/3e1f89674b4045638f15b987275e5995_SKU_CODE_CLIENT_PRODUCT_DURA_4 pc_Carton.pdf",
    "CLIENT_PRODUCT_2 Leaflet": "/app/uploads/14167ce2495a423ea1406487478b009b_PA_62000000217710_CLIENT_PRODUCT_2_CLIENT_PRODUCT_2_NA_Leaflet.pdf",
    "CLIENT_PRODUCT_2 Foil": "/app/uploads/foil_test.pdf",
}

MULTIPLIERS = [1.0, 1.25, 2.0, 4.0]
MULT_LABELS = ["1x_same", "1.25x_+25pct", "2x_+100pct", "4x_+300pct"]

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

def span_to_action(span, new_text, pw, ph):
    bx0, by0, bx1, by1 = span["bbox"]
    return {
        "action_type": "replace",
        "sel_x": bx0 / pw,
        "sel_y": by0 / ph,
        "sel_w": (bx1 - bx0) / pw,
        "sel_h": (by1 - by0) / ph,
        "new_text": new_text,
        "element_id": None,
    }

def check_bleed(original_pdf, draft_path, target_span, page_spans):
    """Returns list of bleed incident strings."""
    doc_draft = fitz.open(draft_path)
    page_draft = doc_draft[0]
    draft_texts = set()
    for s in _get_page_spans(page_draft):
        draft_texts.add(s.get("text", "").strip())
    doc_draft.close()

    tx0, ty0, tx1, ty1 = target_span["bbox"]
    incidents = []
    for span in page_spans:
        if span is target_span:
            continue
        sx0, sy0, sx1, sy1 = span["bbox"]
        horiz_overlap = min(tx1, sx1) - max(tx0, sx0)
        if horiz_overlap <= 0:
            continue
        vert_dist = min(abs(ty0 - sy1), abs(ty1 - sy0))
        if vert_dist > 8:
            continue
        orig_text = span.get("text", "").strip()
        if not orig_text:
            continue
        if orig_text not in draft_texts:
            incidents.append(f"'{orig_text}' vanished from draft")
    return incidents

results = []

for pdf_label, pdf_path in PDFS.items():
    if not Path(pdf_path).exists():
        print(f"  SKIP (not found): {pdf_label}")
        continue

    doc = fitz.open(pdf_path)
    page = doc[0]
    pw, ph = page.rect.width, page.rect.height
    page_spans = _get_page_spans(page)
    doc.close()

    target = pick_target_span(pdf_path)
    if not target:
        print(f"  SKIP (no spans): {pdf_label}")
        continue

    orig_text = target.get("text", "").strip()
    orig_len  = len(orig_text)
    tx0, ty0, tx1, ty1 = target["bbox"]
    available_w = tx1 - tx0
    fontname = target.get("font", "helv").split("+")[-1]
    fontsize  = float(target.get("size", 12))

    print(f"\n{'='*70}")
    print(f"PDF: {pdf_label}")
    print(f"  Page size : {pw:.0f}×{ph:.0f}pt")
    print(f"  Target    : '{orig_text}' ({orig_len} chars, {available_w:.1f}pt wide, font={fontname}, {fontsize:.1f}pt)")

    for mult, label in zip(MULTIPLIERS, MULT_LABELS):
        n_chars  = max(1, int(orig_len * mult))
        new_text = (orig_text + " ") * 20
        new_text = new_text[:n_chars]

        action = span_to_action(target, new_text, pw, ph)

        try:
            result = generate_pdf_draft(
                pdf_path=pdf_path,
                actions=[action],
                page_number=0,
            )
        except Exception as e:
            print(f"  [{label}] ERROR: {e}")
            continue

        ow   = result.get("overflow_warnings", [])
        warn = ow[0] if ow else {}

        fits    = warn.get("fits", None)
        avail_w = warn.get("available_width_pts", available_w)
        req_w   = warn.get("required_width_pts", 0.0)
        ov_w    = warn.get("overflow_width_pts", 0.0)
        ov_pct  = warn.get("overflow_percentage", 0.0)

        # Ground truth: re-measure independently  
        actual_req_w = _measure_text_width(new_text, fontname, fontsize)
        gt_fits      = actual_req_w <= avail_w

        fp = (not fits) and gt_fits
        fn = fits and (not gt_fits)
        verdict = "FALSE-POS" if fp else ("FALSE-NEG" if fn else "OK")

        # Bleed check
        draft_path = result.get("draft_path", "")
        bleed_incidents = []
        if draft_path and Path(draft_path).exists():
            bleed_incidents = check_bleed(pdf_path, draft_path, target, page_spans)
            Path(draft_path).unlink(missing_ok=True)

        bleed_str = "; ".join(bleed_incidents) if bleed_incidents else "none"

        print(f"\n  [{label}]")
        print(f"    new_text  : '{new_text[:30]}{'...' if len(new_text)>30 else ''}'")
        print(f"    warning   : fits={fits}  avail={avail_w:.1f}pt  req={req_w:.1f}pt  overflow={ov_pct:.1f}%")
        print(f"    ground_tr : gt_fits={gt_fits}  actual_req={actual_req_w:.1f}pt")
        print(f"    verdict   : {verdict}")
        print(f"    bleed     : {bleed_str}")

        results.append({
            "pdf": pdf_label,
            "mult": label,
            "fits": fits,
            "gt_fits": gt_fits,
            "verdict": verdict,
            "bleed": bleed_incidents,
        })

print(f"\n{'='*70}")
print("SUMMARY TABLE")
print(f"{'PDF':<20} {'Mult':<15} {'fits':>6} {'gt_fits':>8} {'verdict':<12} {'bleed':>6}")
print("-"*70)
for r in results:
    bleed_ct = len(r["bleed"])
    print(f"{r['pdf']:<20} {r['mult']:<15} {str(r['fits']):>6} {str(r['gt_fits']):>8} {r['verdict']:<12} {bleed_ct:>6}")

total    = len(results)
fp_total = sum(1 for r in results if r["verdict"] == "FALSE-POS")
fn_total = sum(1 for r in results if r["verdict"] == "FALSE-NEG")
ok_total = sum(1 for r in results if r["verdict"] == "OK")
b_total  = sum(len(r["bleed"]) for r in results)
print(f"\nTotal={total}  OK={ok_total}  FP={fp_total}  FN={fn_total}  Bleed={b_total}")
