"""
Minimal, self-contained reproduction of the fontdelta05pt span-reordering
cascade (see README.md in this folder). Builds a trivial 4-line PDF, edits
one line with the same redact+insert_text technique that triggered the bug
on the real Mounjaro pair, and runs compare_artworks() on the result.

No external files needed. Run inside the backend Docker image (needs
cv2/fitz), from the repo root:
    docker run --rm -v "$(pwd)/backend:/app" -w /app <backend-image> \
        python eval/investigations/cascade_span_reordering_fontdelta05pt/isolation_test_script.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))  # backend/

import fitz  # noqa: E402
from engines.pdf_comparator import compare_artworks, _spans_from_page  # noqa: E402

OUT_DIR = Path(__file__).parent
A_PATH  = OUT_DIR / "isolation_test_version_a_reproduced.pdf"
B_PATH  = OUT_DIR / "isolation_test_version_b_reproduced.pdf"

# ── Build Version A: 3 lines, line 1 has two spans (label + continuation) ──
doc = fitz.open()
page = doc.new_page(width=595, height=842)
page.insert_text((72, 100), "Label text here:", fontsize=12.0, fontname="Times-Bold", color=(0, 0, 0))
label_rect = page.search_for("Label text here:")[0]
page.insert_text((label_rect.x1, 100), " continuation text on same line", fontsize=12.0, color=(0, 0, 0))
page.insert_text((72, 120), "Second line of text unrelated to the edit.", fontsize=12.0, color=(0, 0, 0))
page.insert_text((72, 140), "Third line, also unrelated to the edit.", fontsize=12.0, color=(0, 0, 0))
doc.save(A_PATH)
doc.close()

# ── Build Version B: same doc, redact+reinsert the label at smaller size ──
doc = fitz.open(A_PATH)
page = doc[0]
rect = page.search_for("Label text here:")[0]
page.add_redact_annot(rect, fill=(1, 1, 1))
page.apply_redactions()
page.insert_text((rect.x0, rect.y1 - 0.2 * 11.5), "Label text here:", fontsize=11.5, fontname="Times-Bold", color=(0, 0, 0))
doc.save(B_PATH)
doc.close()

# ── Inspect span order in both ──
doc_a = fitz.open(A_PATH)
doc_b = fitz.open(B_PATH)
spans_a = _spans_from_page(doc_a[0])
spans_b = _spans_from_page(doc_b[0])

print("=== spans_a ===")
for i, s in enumerate(spans_a):
    print(f"  A[{i}] bbox={[round(v, 1) for v in s['bbox']]} text={s['text']!r}")
print("=== spans_b ===")
for i, s in enumerate(spans_b):
    print(f"  B[{i}] bbox={[round(v, 1) for v in s['bbox']]} text={s['text']!r}")

doc_a.close()
doc_b.close()

# ── Run compare_artworks() on the isolated pair ──
result = compare_artworks(str(A_PATH), str(B_PATH), dpi=150, preview_dir="/tmp/prev_iso", comparison_id="isolation")
diffs = result["pages"][0]["differences"]
print(f"\n=== compare_artworks() result: {len(diffs)} differences (expected: 1, just the label) ===")
for d in diffs:
    print(f"  type={d['type']:14s} old={d['original_text']!r} new={d['revised_text']!r}")

(OUT_DIR / "isolation_test_differences_reproduced.json").write_text(json.dumps({
    "spans_a": [{"text": s["text"], "bbox": s["bbox"]} for s in spans_a],
    "spans_b": [{"text": s["text"], "bbox": s["bbox"]} for s in spans_b],
    "differences": diffs,
}, ensure_ascii=False, indent=2))
