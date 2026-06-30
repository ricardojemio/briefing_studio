"""
backend/tests/test_comparator.py

Tests for the pdf_comparator engine.
All tests are self-contained: synthetic PDFs are created with PyMuPDF so
no external fixture files are required.

Run inside Docker:
    docker compose exec backend python -m pytest tests/test_comparator.py -v
"""

import os
import sys
import tempfile
from pathlib import Path

import fitz  # PyMuPDF
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from engines.pdf_comparator import compare_artworks, EAN_RE, _spans_from_page

# ── Helpers ───────────────────────────────────────────────────────────────────────

def _make_pdf(
    text: str,
    font_size: float = 12.0,
    page_w: float = 595.0,
    page_h: float = 842.0,
    text_y: float = 100.0,
) -> str:
    """Create a minimal single-page PDF with one line of text. Returns temp path."""
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)
    doc  = fitz.open()
    page = doc.new_page(width=page_w, height=page_h)
    page.insert_text((72, text_y), text, fontsize=font_size, color=(0, 0, 0))
    doc.save(path)
    doc.close()
    return path


def _run(orig: str, rev: str) -> dict:
    """Run compare_artworks with a temp preview dir. Returns result."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        return compare_artworks(
            original_pdf_path=orig,
            revised_pdf_path=rev,
            dpi=72,                # low DPI for speed in tests
            preview_dir=tmp_dir,
        )


# ── Tests ─────────────────────────────────────────────────────────────────────────

class TestComparator:

    def test_compare_identical_pdfs_returns_zero_differences(self):
        """
        Comparing a PDF with itself must report total_differences = 0.
        No text, code, visual, dimensional, or compliance differences expected.
        """
        pdf = _make_pdf("INGREDIENT_A 500mg", font_size=12)
        try:
            result = _run(pdf, pdf)
            s = result["summary"]
            assert s["total_differences"] == 0, (
                f"Expected 0 differences when comparing PDF with itself, got {s}"
            )
            assert s["text_changes"]        == 0
            assert s["code_changes"]        == 0
            assert s["visual_changes"]      == 0
            assert s["dimensional_changes"] == 0
            assert s["compliance_flags"]    == 0
        finally:
            Path(pdf).unlink(missing_ok=True)


    def test_text_change_detected(self):
        """
        A text content change between original and revised must be captured
        as a 'text_changed' (or 'ean_changed') difference with severity high.
        """
        orig = _make_pdf("INGREDIENT_A 325mg")
        rev  = _make_pdf("INGREDIENT_A 400mg")
        try:
            result = _run(orig, rev)
            diffs  = result["pages"][0]["differences"]

            changed = [d for d in diffs if d["type"] in ("text_changed", "ean_changed")]
            assert len(changed) >= 1, (
                f"Expected at least one text_changed diff, got: {[d['type'] for d in diffs]}"
            )
            # Must capture both old and new text
            hit = changed[0]
            assert "325" in hit["original_text"] or "325" in hit["description"], (
                f"Original text not found in diff: {hit}"
            )
            assert "400" in hit["revised_text"] or "400" in hit["description"], (
                f"Revised text not found in diff: {hit}"
            )
            assert hit["severity"] == "high"
        finally:
            Path(orig).unlink(missing_ok=True)
            Path(rev).unlink(missing_ok=True)


    def test_ean_detection_finds_barcode_numbers(self):
        """
        When an EAN-13 code changes between versions, the comparison must
        report an 'ean_changed' difference (not just a generic text_changed).
        """
        orig = _make_pdf("Barcode: 1234567890128")   # valid EAN-13 format
        rev  = _make_pdf("Barcode: 1234567890135")   # different EAN-13
        try:
            result = _run(orig, rev)
            diffs  = result["pages"][0]["differences"]

            ean_diffs = [d for d in diffs if d["type"] == "ean_changed"]
            assert len(ean_diffs) >= 1, (
                f"Expected ean_changed diff; got types: {[d['type'] for d in diffs]}"
            )
            # Confirm the EAN regex fires on raw text
            assert EAN_RE.search("Barcode: 1234567890128") is not None
            assert EAN_RE.search("Barcode: 1234567890135") is not None
        finally:
            Path(orig).unlink(missing_ok=True)
            Path(rev).unlink(missing_ok=True)


    def test_dimensional_check_detects_size_change(self):
        """
        PDFs with different MediaBox sizes must produce a 'dimensional'
        difference with severity 'high'.
        The size difference is 14pt × 14pt ≈ 4.9mm × 4.9mm > 0.5mm threshold.
        """
        orig = _make_pdf("Page size test", page_w=595, page_h=842)
        rev  = _make_pdf("Page size test", page_w=609, page_h=856)   # A4 + 14pt
        try:
            result = _run(orig, rev)
            diffs  = result["pages"][0]["differences"]
            dim_diffs = [d for d in diffs if d["type"] == "dimensional"]
            assert len(dim_diffs) >= 1, (
                f"Expected dimensional diff; got: {[d['type'] for d in diffs]}"
            )
            assert dim_diffs[0]["severity"] == "high"
            assert result["summary"]["dimensional_changes"] >= 1
        finally:
            Path(orig).unlink(missing_ok=True)
            Path(rev).unlink(missing_ok=True)


    def test_minimum_font_size_compliance(self):
        """
        Text below 6pt in the revised PDF must be flagged as a 'compliance'
        difference with severity 'high'.
        The original has normal 12pt text; the revised adds 3pt text (below limit).
        """
        orig = _make_pdf("Lot: A12345",  font_size=12)
        rev  = _make_pdf("Lot: A12345 *see conditions below",  font_size=3)
        try:
            result = _run(orig, rev)
            diffs  = result["pages"][0]["differences"]
            compliance = [d for d in diffs if d["type"] == "compliance"]
            assert len(compliance) >= 1, (
                f"Expected compliance diff for sub-6pt text; "
                f"got: {[(d['type'], d.get('revised_text')) for d in diffs]}"
            )
            assert compliance[0]["severity"] == "high"
            assert result["summary"]["compliance_flags"] >= 1
        finally:
            Path(orig).unlink(missing_ok=True)
            Path(rev).unlink(missing_ok=True)

    def test_compliance_excludes_info_panel_text(self):
        """
        Text inside the V8 Artwork Information Panel (below the panel header)
        must NOT be flagged as a compliance violation even when sub-6pt.
        """
        fd, path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)
        try:
            doc  = fitz.open()
            page = doc.new_page(width=595.0, height=842.0)
            # Regulatory text at top — large enough, should NOT trigger compliance
            page.insert_text((72, 100), "Lot: A12345", fontsize=12, color=(0, 0, 0))
            # Info panel header — marks the exclusion boundary
            page.insert_text(
                (72, 700), "Artwork Information Panel",
                fontsize=8, color=(0, 0, 0),
            )
            # Spec text below the panel header — sub-6pt, should be EXCLUDED
            page.insert_text(
                (72, 720), "Body Text Size: 6pt",
                fontsize=4, color=(0, 0, 0),
            )
            page.insert_text(
                (72, 735), "Smallest Text Size: 4pt",
                fontsize=4, color=(0, 0, 0),
            )
            doc.save(path)
            doc.close()

            result = _run(path, path)   # compare identical PDFs (no text diffs)
            compliance = [
                d for d in result["pages"][0]["differences"]
                if d["type"] == "compliance"
            ]
            assert compliance == [], (
                f"Info-panel spec text should not be flagged; got: {compliance}"
            )
            assert result["summary"]["compliance_flags"] == 0
        finally:
            Path(path).unlink(missing_ok=True)
