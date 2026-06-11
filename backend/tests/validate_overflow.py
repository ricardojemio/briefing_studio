"""
Cross-PDF overflow + bleed validation probe.
Runs generate_pdf_draft() against 3 PDFs × 4 replacement-length multipliers.
Reports: overflow_warnings accuracy, false positives, false negatives,
         redaction bleed incidents.
No code is modified.
"""
import sys, os, json, fitz
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
MULT_LABELS = ["1× (same)", "1.25× (+25%)", "2× (+100%)", "4× (+300%)"]

# ── helpers ─────────────────────────────────────────────────────────────────

def pick_target_span(pdf_path: str) -> dict | None:
    """Pick first readable alpha span with length ≥ 4 chars."""
    doc = fitz.open(pdf_path)
    page = doc[0]
    spans = _get_page_spans(page)
    doc.close()
    for span in spans:
        t = span.get("text", "").strip()
        if len(t) >= 4 and t.isascii() and not t.isspace():
            return span
    return spans[0] if spans else None


def span_to_action(span: dict, new_text: str, pw: float, ph: float) -> dict:
    """Convert a raw span dict to a normalised replace action."""
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


def check_bleed(original_pdf: str, draft_path: str,
                target_span: dict, page_spans: list) -> list[str]:
    """
    Check neighbouring spans for content loss after redaction.
    Returns list of incident descriptions.
    """
    doc_draft = fitz.open(draft_path)
    page_draft = doc_draft[0]
    draft_spans = {s["text"]: s for s in _get_page_spans(page_draft)}
    doc_draft.close()

    tx0, ty0, tx1, ty1 = target_span["bbox"]
    incidents = []
    for span in page_spans:
        if span is target_span:
            continue
        sx0, sy0, sx1, sy1 = span["bbox"]
        # Only check horizontal neighbours on adjacent lines
        horiz_overlap = min(tx1, sx1) - max(tx0, sx0)
        if horiz_overlap <= 0:
            continue
        vert_dist = min(abs(ty0 - sy1), abs(ty1 - sy0))
        if vert_dist > 6:  # more than 6pt apart — not adjacent
            continue
        orig_text = span.get("text", "").strip()
        if not orig_text:
            continue
        # Is this span present in the draft?
        if orig_text not in draft_spans:
            incidents.append(f"BLEED: '{orig_text}' disappeared from draft")
        else:
            ds = draft_spans[orig_text]
            # Check if its bbox changed significantly
            dsx0, dsy0, dsx1, dsy1 = ds["bbox"]
            dx = abs(dsx0 - sx0)
            dw = abs((dsx1 - dsx0) - (sx1 - sx0))
            if dw > 3 or dx > 3:
                incidents.append(
                    f"BLEED: '{orig_text}' bbox shifted — "
                    f"orig_w={sx1-sx0:.1f}pt draft_w={dsx1-dsx0:.1f}pt Δ={dw:.1f}pt"
                )
    return incidents


# ── main validation loop ─────────────────────────────────────────────────────

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

    print(f"\n{'='*70}")
    print(f"PDF: {pdf_label}")
    print(f"Page: {pw:.0f}×{ph:.0f}pt  |  Target span: '{orig_text}' ({orig_len} chars, {available_w:.1f}pt wide)")

    for mult, label in zip(MULTIPLIERS, MULT_LABELS):
        n_chars  = max(1, int(orig_len * mult))
        new_text = (orig_text * 10)[:n_chars]   # repeat/truncate to exact length

        action = span_to_action(target, new_text, pw, ph)

        try:
            result = generate_pdf_draft(
                pdf_path=pdf_path,
                actions=[action],
                elements=[],
                page_number=0,
            )
        except Exception as e:
            print(f"  [{label}] ERROR: {e}")
            continue

        ow = result.get("overflow_warnings", [])
        warn = ow[0] if ow else {}

        fits    = warn.get("fits", None)
        avail_w = warn.get("available_width_pts", available_w)
        req_w   = warn.get("required_width_pts", 0)
        ov_pct  = warn.get("overflow_percentage", 0)

        # Ground truth: measure with fitz directly
        fontname = target.get("font", "helv").split("+")[-1]
        fontsize = target.get("size", 12)
        actual_w = _measure_text_width(new_text, fontname, fontsize)
        gt_fits  = actual_w <= avail_w

        # Classification
        false_positive = (not fits) and gt_fits     # system says overflow, really fits
        false_negative = fits and (not gt_fits)      # system says fits, really overflows

        # Bleed check
        draft_path = result.get("draft_path", "")
        bleed_incidents = []
        if draft_path and Path(draft_path).exists():
            bleed_incidents = check_bleed(pdf_path, draft_path, target, page_spans)
            # cleanup
            Path(draft_path).unlink(missing_ok=True)

        verdict = "OK"
        if false_positive: verdict = "FALSE-POS"
        if false_negative: verdict = "FALSE-NEG"

        bleed_str = "; ".join(bleed_incidents) if bleed_incidents else "none"

        print(f"  [{label}] new='{new_text[:20]}{'...' if len(new_text)>20 else ''}'")
        print(f"    fits={fits} | avail={avail_w:.1f}pt req={req_w:.1f}pt overflow={ov_pct:.1f}%")
        print(f"    gt_fits={gt_fits} | verdict={verdict}")
        print(f"    bleed: {bleed_str}")

        results.append({
            "pdf": pdf_label,
            "multiplier": label,
            "orig_text": orig_text,
            "new_text": new_text[:40],
            "fits": fits,
            "gt_fits": gt_fits,
            "verdict": verdict,
            "avail_w": avail_w,
            "req_w": req_w,
            "overflow_pct": ov_pct,
            "bleed": bleed_incidents,
        })

# ── summary ──────────────────────────────────────────────────────────────────
print(f"\n{'='*70}")
print("SUMMARY")
print(f"{'='*70}")
total = len(results)
fp = sum(1 for r in results if r["verdict"] == "FALSE-POS")
fn = sum(1 for r in results if r["verdict"] == "FALSE-NEG")
ok = sum(1 for r in results if r["verdict"] == "OK")
total_bleed = sum(len(r["bleed"]) for r in results)
print(f"Total test cases   : {total}")
print(f"Correct (OK)       : {ok}")
print(f"False positives    : {fp}  (system→overflow, reality→fits)")
print(f"False negatives    : {fn}  (system→fits, reality→overflow)")
print(f"Bleed incidents    : {total_bleed}")
