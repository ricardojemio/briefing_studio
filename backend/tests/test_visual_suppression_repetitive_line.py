"""
backend/tests/test_visual_suppression_repetitive_line.py

Regression tests for the CLIENT_PRODUCT_2 Foil visual-merge investigation (see
backend/eval/investigations/CLIENT_PRODUCT_2_foil_visual_merge/README.md).

Root cause: visual-diff suppression treats a whole edited line's bbox as
a safety margin (a redact()+insert_text() patch can perturb rendering
anywhere along the line it touched, confirmed real on a synthetic pair
where the perturbation landed at the opposite end of the line from the
edited word). That's correct for a normal prose line, but a real foil
artwork prints a short phrase repeated many times across the sheet width
(security/registration micro-text) — correctly grouped as one physical
"line" by y-coordinate, but hundreds of points wide as a result. Using
that whole line as the suppression margin swallowed two genuinely
unrelated visual changes elsewhere on it. _is_repetitive_line detects
this specific degenerate shape and falls back to a tight pad around just
the edited word(s) instead — but only for lines that are actually
repetitive, so the normal case (and the "perturbation at the far end of
a normal line" case) keeps the full-line margin.

Run inside Docker:
    docker compose exec backend python -m pytest tests/test_visual_suppression_repetitive_line.py -v
"""

import os
import sys
import tempfile
from pathlib import Path

import fitz  # PyMuPDF

sys.path.insert(0, str(Path(__file__).parent.parent))

from engines.pdf_comparator import compare_artworks, _is_repetitive_line

# ── Helpers ───────────────────────────────────────────────────────────────────────

def _make_pdf(text: str, rect_xyxy: tuple[float, float, float, float], rect_color: tuple[float, float, float]) -> str:
    """One line of text plus one filled rectangle elsewhere on the page."""
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)
    doc  = fitz.open()
    page = doc.new_page(width=400, height=300)
    page.insert_text((20, 100), text, fontsize=10, color=(0, 0, 0))
    page.draw_rect(fitz.Rect(*rect_xyxy), color=rect_color, fill=rect_color)
    doc.save(path)
    doc.close()
    return path


def _run(orig: str, rev: str) -> dict:
    with tempfile.TemporaryDirectory() as tmp_dir:
        return compare_artworks(original_pdf_path=orig, revised_pdf_path=rev, dpi=100, preview_dir=tmp_dir)


# ── Tests ─────────────────────────────────────────────────────────────────────────

class TestRepetitiveLineDetection:

    def test_detects_known_repetitive_patterns(self):
        assert _is_repetitive_line([{"text": t} for t in ["Marcas"] * 6]) is True
        assert _is_repetitive_line([{"text": t} for t in ["CLIENT_BRAND"] * 6 + ["PHARMA"]]) is True
        assert _is_repetitive_line(
            [{"text": t} for t in ["licenciadas", "Dungarvan", "PARACETAMOL"] * 6]
        ) is True

    def test_does_not_flag_normal_prose(self):
        assert _is_repetitive_line(
            [{"text": t} for t in "Comprimidos de 750 mg: embalagens com 20 e 50".split()]
        ) is False
        assert _is_repetitive_line(
            [{"text": t} for t in "O albendazol não deve ser usado.".split()]
        ) is False


class TestVisualSuppressionRepetitiveLine:

    def test_repetitive_line_does_not_suppress_nearby_visual_change(self):
        """A visual change near a repeated-microtext "line" (CLIENT_PRODUCT_2's real
        failure mode) must still be reported, not swallowed."""
        # "Marcas" repeated 8x sits around x=20-250,y~100-112; the colour
        # swap rectangle sits just below it, close enough to have been
        # wrongly suppressed by the old whole-line margin.
        rect = (40.0, 120.0, 70.0, 135.0)
        orig = _make_pdf("Marcas " * 8, rect, (1.0, 1.0, 1.0))  # white
        rev  = _make_pdf("Marcas " * 8, rect, (1.0, 0.5, 0.0))  # orange
        try:
            diffs = _run(orig, rev)["pages"][0]["differences"]
            visual = [d for d in diffs if d["type"] == "visual"]
            assert len(visual) >= 1, f"Expected the colour change to survive as a visual diff, got: {diffs}"
        finally:
            Path(orig).unlink(missing_ok=True)
            Path(rev).unlink(missing_ok=True)

    def test_normal_line_still_suppresses_nearby_visual_perturbation(self):
        """Regression guard: a normal (non-repetitive) edited line must
        keep using its full bbox as the suppression margin — a visual
        blip near it (simulating redact()+insert_text() antialiasing
        elsewhere on the same line) must stay suppressed, as before."""
        text_o = "Comprimido de 750 mg texto extra para ocupar espaco"
        text_r = "Comprimido de 950 mg texto extra para ocupar espaco"
        # Rectangle sits under "Comprimido" (far left), well outside
        # EDIT_PERTURBATION_PAD_PT from "750"/"950" but still within the
        # whole line's bbox — the scenario the whole-line margin exists for.
        rect = (20.0, 102.0, 50.0, 112.0)
        orig = _make_pdf(text_o, rect, (1.0, 1.0, 1.0))
        rev  = _make_pdf(text_r, rect, (0.95, 0.95, 0.95))  # subtle, perturbation-like
        try:
            diffs = _run(orig, rev)["pages"][0]["differences"]
            visual = [d for d in diffs if d["type"] == "visual"]
            assert visual == [], f"Expected the near-line blip to stay suppressed, got: {visual}"
        finally:
            Path(orig).unlink(missing_ok=True)
            Path(rev).unlink(missing_ok=True)
