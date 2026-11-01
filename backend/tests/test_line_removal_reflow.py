"""
backend/tests/test_line_removal_reflow.py

Regression test for a pure line removal that reflows — a deleted line's
neighbours shift up to close the gap, as a real layout tool does (unlike
a redact()+insert_text() patch, which edits in place and never reflows).

Root cause (see the LINE_TEXT_SIM_MIN comment in engines/pdf_comparator.py):
line matching in compare_artworks used pure geometric bbox IoU
(_best_iou_match). When a line is deleted and the next line reflows
upward into its old slot, the reflowed line's bbox now overlaps the
deleted line's old bbox almost perfectly — geometry alone then pairs them
as a "changed" line, and the actual removal is lost (reported as an
unrelated text_changed instead of a text_removed). Fixed by adding an
optional content-similarity gate to _best_iou_match, used for line
matching only (span/font matching is unaffected — deliberately kept
geometry-only, since it doesn't compare text content).

Run inside Docker:
    docker compose exec backend python -m pytest tests/test_line_removal_reflow.py -v
"""

import os
import sys
import tempfile
from pathlib import Path

import fitz  # PyMuPDF

sys.path.insert(0, str(Path(__file__).parent.parent))

from engines.pdf_comparator import compare_artworks

# ── Helpers ───────────────────────────────────────────────────────────────────────

def _make_multiline_pdf(lines: list[tuple[str, float]]) -> str:
    """Create a single-page PDF with one line of text per (text, y) pair."""
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)
    doc  = fitz.open()
    page = doc.new_page(width=300, height=200)
    for text, y in lines:
        page.insert_text((20, y), text, fontsize=12, color=(0, 0, 0))
    doc.save(path)
    doc.close()
    return path


def _run(orig: str, rev: str) -> dict:
    with tempfile.TemporaryDirectory() as tmp_dir:
        return compare_artworks(
            original_pdf_path=orig,
            revised_pdf_path=rev,
            dpi=72,
            preview_dir=tmp_dir,
        )


# ── Tests ─────────────────────────────────────────────────────────────────────────

class TestLineRemovalReflow:

    def test_deleted_middle_line_reports_as_removed_even_with_reflow(self):
        """
        Original: 3 lines. Revised: the middle line is gone and the third
        line shifted up to the gap's position (a real "delete and reflow"
        edit, not a redact()-style patch that would leave the third line
        where it was). The middle line's text must still appear as a
        text_removed diff — not be swallowed into a misleading
        text_changed against the unrelated line that moved into its slot.
        """
        orig = _make_multiline_pdf([
            ("Linha um de texto",      50),
            ("INGREDIENT_A e INGREDIENT_C", 80),
            ("Linha tres de texto",    110),
        ])
        rev = _make_multiline_pdf([
            ("Linha um de texto",   50),
            ("Linha tres de texto", 80),   # reflowed up into the deleted line's slot
        ])
        try:
            result = _run(orig, rev)
            diffs = result["pages"][0]["differences"]

            removed_texts = {
                d["original_text"] for d in diffs if d["type"] == "text_removed"
            }
            assert "INGREDIENT_A e INGREDIENT_C" in removed_texts, (
                f"Expected the deleted line to be reported as text_removed, "
                f"got diffs: {[(d['type'], d.get('original_text'), d.get('revised_text')) for d in diffs]}"
            )

            # The bug this guards against: the deleted line's text ending up
            # as the *old* side of a text_changed pair instead (silently
            # losing the removal).
            changed_from_deleted_line = [
                d for d in diffs
                if d["type"] == "text_changed" and d["original_text"] == "INGREDIENT_A e INGREDIENT_C"
            ]
            assert changed_from_deleted_line == [], (
                f"Deleted line was paired into a text_changed instead of reported "
                f"as removed: {changed_from_deleted_line}"
            )
        finally:
            os.remove(orig)
            os.remove(rev)

    def test_in_place_edit_without_reflow_still_reports_as_changed(self):
        """
        Guard against overcorrecting: a line edited in place (no reflow,
        same position, most of the text retained) must still be reported
        as a single text_changed — not split into a spurious remove+add
        just because the content-similarity gate exists now.
        """
        orig = _make_multiline_pdf([("INGREDIENT_A 750 mg", 80)])
        rev  = _make_multiline_pdf([("INGREDIENT_A 755 mg", 80)])
        try:
            result = _run(orig, rev)
            diffs = result["pages"][0]["differences"]
            types = [d["type"] for d in diffs]
            assert "text_changed" in types, f"Expected a text_changed diff, got: {diffs}"
            assert "text_removed" not in types, f"In-place edit wrongly split into removal: {diffs}"
        finally:
            os.remove(orig)
            os.remove(rev)
