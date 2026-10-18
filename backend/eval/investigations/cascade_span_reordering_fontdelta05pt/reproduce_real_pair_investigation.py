"""
Root-cause investigation script for the fontdelta05pt span-reordering
cascade (see README.md in this folder). Read-only: imports
compare_artworks()/_spans_from_page() as-is, applies no patch.

The real Mounjaro pair that triggered this isn't included in the repo
(see README.md "Reproducing"). Point ORIGINAL_PDF/REVISED_PDF at your own
copies to reproduce raw_differences_*.json and spans_version_*.json.

Run inside the backend Docker image (needs cv2/fitz), from the repo root:
    docker run --rm -v "$(pwd)/backend:/app" -w /app <backend-image> \
        python eval/investigations/cascade_span_reordering_fontdelta05pt/reproduce_real_pair_investigation.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))  # backend/

from engines.pdf_comparator import compare_artworks, _spans_from_page  # noqa: E402
import fitz  # noqa: E402

ORIGINAL_PDF = "18078505_Mounjaro.pdf"
REVISED_PDF  = "Bula-Mounjaro_VERSAO_B_fontdelta05pt.pdf"
OUT_DIR      = Path(__file__).parent

# ── Step 1: run compare_artworks() directly, dump raw differences ──────────
result = compare_artworks(ORIGINAL_PDF, REVISED_PDF, dpi=150, preview_dir="/tmp/prev",
                           comparison_id="investigate_fontdelta05pt")

page2 = next(p for p in result["pages"] if p["page_num"] == 2)
diffs = page2["differences"]
print(f"Total differences on page 2: {len(diffs)}")
print(f"Total differences all pages: {sum(len(p['differences']) for p in result['pages'])}")
print(f"Summary: {result['summary']}\n")

(OUT_DIR / "raw_differences_reproduced.json").write_text(json.dumps(diffs, ensure_ascii=False, indent=2))

print("=== All differences (page 2), old vs new text, identical? ===")
for idx, d in enumerate(diffs, 1):
    old, new = d.get("original_text", ""), d.get("revised_text", "")
    print(f"[{idx}] type={d['type']:14s} identical_text={old == new!s:5s} bbox={[round(v, 1) for v in d['bbox']]}")
    print(f"      old={old!r}")
    print(f"      new={new!r}")

# ── Step 2: inspect span order on page 2 of both versions ──────────────────
doc_a = fitz.open(ORIGINAL_PDF)
doc_b = fitz.open(REVISED_PDF)
spans_a = _spans_from_page(doc_a[1])  # page 2 = index 1
spans_b = _spans_from_page(doc_b[1])

print(f"\n=== Span count page 2: A={len(spans_a)} B={len(spans_b)} ===")


def _dump(spans):
    return [{"idx": i, "text": s["text"][:60], "bbox": [round(v, 1) for v in s["bbox"]], "size": s["size"]}
            for i, s in enumerate(spans)]


(OUT_DIR / "spans_version_a_page2_reproduced.json").write_text(json.dumps(_dump(spans_a), ensure_ascii=False, indent=2))
(OUT_DIR / "spans_version_b_page2_reproduced.json").write_text(json.dumps(_dump(spans_b), ensure_ascii=False, indent=2))

for label, spans in (("A", spans_a), ("B", spans_b)):
    print(f"\n=== Spans {label} (index: bbox, text) ===")
    for i, s in enumerate(spans):
        print(f"  {label}[{i:3d}] y0={s['bbox'][1]:7.2f} size={s['size']:5.2f} text={s['text'][:55]!r}")

doc_a.close()
doc_b.close()
