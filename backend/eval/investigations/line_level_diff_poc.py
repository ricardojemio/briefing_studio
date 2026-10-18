"""
backend/eval/investigations/line_level_diff_poc.py

Proof of concept, NOT wired into engines/pdf_comparator.py: does grouping
spans into physical lines (by y-coordinate, not extraction-list order)
before diffing eliminate the span-fragmentation problem documented in
par1/par2/par4 of eval/manual_pairs/?

Root cause recap (see conversation / investigation notes): when a PDF is
patched in place (redact a word/character + insert_text its replacement),
PyMuPDF's get_text() extraction can split what was visually one line into
several spans, and/or place the newly inserted span far from its original
position in the EXTRACTION-ORDER list. _match_spans()'s span-level IoU
matching handles the reordering fine (it doesn't care about list order),
but it cannot reassemble 3 separate B-spans into "this together is the one
line that changed" — geometrically they're 3 disjoint boxes, so the best
it can do is match each one individually, scattering what is semantically
one edit into up to 3 reported diffs (1 text_changed + up to 2 text_added).

The fragments' Y-COORDINATES stay correct even when their LIST INDEX
doesn't (confirmed per pair below). This script groups spans by y-range
(ignoring extraction order entirely), concatenates each group into one
line of text, matches LINES between A and B by bbox IoU (reusing the same
scoring idea as _match_spans, just applied to the union bbox of each
line's spans), and diffs the line text directly — producing one diff per
edited line instead of N fragments.

Needs cv2 only via the pdf_comparator import; run inside Docker, from
backend/:
    python -m eval.investigations.line_level_diff_poc
"""
from __future__ import annotations

import difflib
from pathlib import Path

import fitz

from engines.pdf_comparator import _spans_from_page, _bboxes_overlap, _bbox_iou

Y_GROUP_TOLERANCE = 2.0   # pt: spans whose y0 differs by less than this are the same physical line
X_GAP_FOR_SPACE    = 1.5  # pt: gap between adjacent spans' bboxes that implies a word-space


def _group_into_lines(spans: list[dict]) -> list[dict]:
    """Groups spans by y0 proximity, ignoring their order in the input
    list entirely. Returns one dict per line: text (x-ordered, with a
    space inserted at visible gaps), bbox (union), member span indices."""
    remaining = list(enumerate(spans))
    lines = []
    while remaining:
        seed_idx, seed = remaining.pop(0)
        group = [(seed_idx, seed)]
        rest = []
        for idx, s in remaining:
            if abs(s["bbox"][1] - seed["bbox"][1]) <= Y_GROUP_TOLERANCE:
                group.append((idx, s))
            else:
                rest.append((idx, s))
        remaining = rest

        group.sort(key=lambda pair: pair[1]["bbox"][0])  # x-order
        text_parts = []
        for i, (idx, s) in enumerate(group):
            if i > 0:
                prev_x1 = group[i - 1][1]["bbox"][2]
                gap = s["bbox"][0] - prev_x1
                if gap > X_GAP_FOR_SPACE:
                    text_parts.append(" ")
            text_parts.append(s["text"])
        x0 = min(s["bbox"][0] for _, s in group)
        y0 = min(s["bbox"][1] for _, s in group)
        x1 = max(s["bbox"][2] for _, s in group)
        y1 = max(s["bbox"][3] for _, s in group)
        lines.append({
            "text": "".join(text_parts),
            "bbox": (x0, y0, x1, y1),
            "member_indices": [idx for idx, _ in group],
        })
    lines.sort(key=lambda ln: ln["bbox"][1])
    return lines


def _match_lines(lines_a: list[dict], lines_b: list[dict]) -> dict[int, int]:
    """Same best-IoU-first greedy assignment as _match_spans(), applied to
    line union-bboxes instead of individual span bboxes."""
    candidates = []
    for i, la in enumerate(lines_a):
        for j, lb in enumerate(lines_b):
            if _bboxes_overlap(la["bbox"], lb["bbox"]):
                candidates.append((_bbox_iou(la["bbox"], lb["bbox"]), i, j))
    candidates.sort(key=lambda c: c[0], reverse=True)

    matched_a, matched_b, match_map = set(), set(), {}
    for _score, i, j in candidates:
        if i in matched_a or j in matched_b:
            continue
        matched_a.add(i)
        matched_b.add(j)
        match_map[i] = j
    return match_map


def diff_lines(pdf_a: str, pdf_b: str, page_1idx: int) -> list[dict]:
    doc_a, doc_b = fitz.open(pdf_a), fitz.open(pdf_b)
    spans_a = _spans_from_page(doc_a[page_1idx - 1])
    spans_b = _spans_from_page(doc_b[page_1idx - 1])
    doc_a.close(); doc_b.close()

    lines_a = _group_into_lines(spans_a)
    lines_b = _group_into_lines(spans_b)
    match_map = _match_lines(lines_a, lines_b)

    diffs = []
    for i, la in enumerate(lines_a):
        j = match_map.get(i)
        if j is None:
            diffs.append({"type": "text_removed", "old": la["text"], "new": "", "bbox": la["bbox"]})
            continue
        lb = lines_b[j]
        if la["text"] != lb["text"]:
            diffs.append({"type": "text_changed", "old": la["text"], "new": lb["text"], "bbox": la["bbox"]})
    matched_b_idxs = set(match_map.values())
    for j, lb in enumerate(lines_b):
        if j not in matched_b_idxs:
            diffs.append({"type": "text_added", "old": "", "new": lb["text"], "bbox": lb["bbox"]})
    return diffs


if __name__ == "__main__":
    BASE = Path(__file__).resolve().parents[1] / "manual_pairs"
    CASES = [
        ("par1_sonridor_dose_755mg", 1, "750 mg" ),
        ("par2_mounjaro_dose_17mg",  4, "15 mg"),
        ("par4_mounjaro_multilinha", 4, "farmac"),
    ]
    for pair_id, page, needle in CASES:
        pdir = BASE / pair_id
        diffs = diff_lines(str(pdir / "A.pdf"), str(pdir / "B.pdf"), page)
        relevant = [d for d in diffs if needle.split()[0].lower() in (d["old"] + d["new"]).lower()]
        print(f"\n=== {pair_id} (page {page}) — line-level diffs touching {needle!r} ===")
        for d in relevant:
            print(f"  [{d['type']}] old={d['old']!r}")
            print(f"              new={d['new']!r}")
        print(f"  -> {len(relevant)} diff(s) for this edit (span-level comparator reported "
              f"3 fragments for par1/par4, 2 for par2 — see investigation)")
