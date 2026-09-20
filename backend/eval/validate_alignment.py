"""
backend/eval/validate_alignment.py

Standalone proof that ORB+homography registration in pdf_comparator is
doing real geometric work, not a disguised resize.

Builds a synthetic "scanned/reprinted" version of the seed bula: same
content, but every page is re-embedded with a small rigid drift
(translation + uniform scale) typical of a print/scan misregistration.
Because both pages end up with IDENTICAL pixel dimensions, the *old*
`if shapes differ: resize` guard never fires — the old code path applied
zero correction here. This script proves the new code path does.

It runs compare_artworks() twice on the same drifted pair: once normally
(alignment active) and once with alignment monkey-patched out (forcing the
old fallback-resize behaviour), and reports the spurious visual-diff count
each produces. Needs opencv (via pdf_comparator) — run inside Docker.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path
from unittest import mock

import fitz  # PyMuPDF

sys.path.insert(0, str(Path(__file__).parent.parent))

import engines.pdf_comparator as pdf_comparator  # noqa: E402

SEED_PDF = Path(__file__).parent / "seed" / "bula_sonridor_dor_e_febre_750mg.pdf"

# Typical small print/scan drift: a few points of shift plus ~0.6% scale.
DRIFT_TX, DRIFT_TY = 3.0, -2.0
DRIFT_SX, DRIFT_SY = 1.006, 1.006


def build_drifted_copy(src_path: Path) -> fitz.Document:
    src = fitz.open(src_path)
    out = fitz.open()
    for pno in range(len(src)):
        w, h = src[pno].rect.width, src[pno].rect.height
        newpage = out.new_page(width=w, height=h)
        drifted_rect = fitz.Rect(DRIFT_TX, DRIFT_TY, DRIFT_TX + w * DRIFT_SX, DRIFT_TY + h * DRIFT_SY)
        newpage.show_pdf_page(drifted_rect, src, pno)
    return out


def count_visual_diffs(result: dict) -> int:
    return sum(1 for page in result["pages"] for d in page["differences"] if d["type"] == "visual")


def raw_pixel_disagreement(img_a, img_b) -> dict:
    """Pixel-level error, independent of the contour/dilation post-processing
    (whose count can be a misleading proxy — see note in main())."""
    import cv2
    diff = cv2.absdiff(img_a, img_b)
    gray = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
    pct_above = float((gray > pdf_comparator.VISUAL_THRESHOLD).mean() * 100)
    return {"mean_abs_diff": round(float(gray.mean()), 3), "pct_pixels_above_threshold": round(pct_above, 3)}


def main() -> None:
    if not SEED_PDF.exists():
        raise SystemExit(f"seed PDF not found: {SEED_PDF}")

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        a_path = tmp / "A.pdf"
        b_path = tmp / "B.pdf"

        fitz.open(SEED_PDF).save(a_path)
        build_drifted_copy(SEED_PDF).save(b_path)

        print(f"Drift applied: translate=({DRIFT_TX},{DRIFT_TY})pt scale=({DRIFT_SX},{DRIFT_SY}) "
              f"— content is otherwise byte-for-byte the same artwork.\n")

        # 1. Normal run: ORB + homography active.
        result_aligned = pdf_comparator.compare_artworks(
            str(a_path), str(b_path), dpi=150, preview_dir=str(tmp / "prev_aligned"),
            comparison_id="drift_aligned",
        )
        methods = {p["alignment"]["method"] for p in result_aligned["pages"]}
        n_visual_aligned = count_visual_diffs(result_aligned)
        print(f"[com alinhamento ORB]   métodos usados por página: {sorted(methods)}")
        print(f"[com alinhamento ORB]   contornos 'visual' reportados: {n_visual_aligned}")

        # 2. Ablation: force the pre-existing naive-resize behaviour by
        #    monkey-patching the registration step out.
        with mock.patch.object(
            pdf_comparator, "_align_revised_to_original",
            side_effect=lambda o, r: (pdf_comparator._fallback_resize(o, r),
                                       {"method": "resize_fallback (forced)", "keypoints_orig": 0,
                                        "keypoints_rev": 0, "good_matches": 0, "inliers": 0}),
        ):
            result_naive = pdf_comparator.compare_artworks(
                str(a_path), str(b_path), dpi=150, preview_dir=str(tmp / "prev_naive"),
                comparison_id="drift_naive",
            )
        n_visual_naive = count_visual_diffs(result_naive)
        print(f"[resize antigo (forçado)] contornos 'visual' reportados: {n_visual_naive}")

        print("\nContagem de contornos é uma proxy enganosa aqui: um erro grande e "
              "coerente (shift sistemático) tende a formar poucos blobs grandes após a "
              "dilatação; um erro residual pequeno e disperso (borda de cada glifo) forma "
              "muitos blobs pequenos. A métrica que realmente importa é o desacordo bruto "
              "de pixels ANTES do threshold/contorno — medido por página abaixo:\n")

        doc_a = fitz.open(a_path)
        doc_b_raw = fitz.open(b_path)
        for pno in range(len(doc_a)):
            img_a = pdf_comparator._render_page_bgr(doc_a[pno], 150)
            img_b_raw = pdf_comparator._render_page_bgr(doc_b_raw[pno], 150)
            aligned, info = pdf_comparator._align_revised_to_original(img_a, img_b_raw)

            raw_stats     = raw_pixel_disagreement(img_a, img_b_raw)
            aligned_stats = raw_pixel_disagreement(img_a, aligned)
            print(f"  página {pno + 1}: sem correção -> {raw_stats}")
            print(f"              ORB ({info['method']}, inliers={info['inliers']}) -> {aligned_stats}")


if __name__ == "__main__":
    main()
