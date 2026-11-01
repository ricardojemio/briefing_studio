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


def _run(orig: str, rev: str, include_compliance: bool = False) -> dict:
    """Run compare_artworks with a temp preview dir. Returns result."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        return compare_artworks(
            original_pdf_path=orig,
            revised_pdf_path=rev,
            dpi=72,                # low DPI for speed in tests
            preview_dir=tmp_dir,
            include_compliance=include_compliance,
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
            result = _run(orig, rev, include_compliance=True)
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

    def test_compliance_is_opt_in_and_excluded_from_total(self):
        """
        include_compliance defaults to False: the same sub-6pt text that
        test_minimum_font_size_compliance flags when opted in must produce
        no compliance diffs and compliance_flags == 0 by default. And even
        when opted in, compliance_flags must never be folded into
        total_differences — it's a count of revised-PDF-alone rule
        violations, not a version-to-version difference.
        """
        orig = _make_pdf("Lot: A12345",  font_size=12)
        rev  = _make_pdf("Lot: A12345 *see conditions below",  font_size=3)
        try:
            off = _run(orig, rev)   # include_compliance defaults to False
            assert off["summary"]["compliance_flags"] == 0, off["summary"]
            assert [d for d in off["pages"][0]["differences"] if d["type"] == "compliance"] == []

            on = _run(orig, rev, include_compliance=True)
            assert on["summary"]["compliance_flags"] >= 1
            assert on["summary"]["total_differences"] == (
                on["summary"]["text_changes"]
                + on["summary"]["code_changes"]
                + on["summary"]["visual_changes"]
                + on["summary"]["dimensional_changes"]
            ), "compliance_flags leaked into total_differences"
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

            result = _run(path, path, include_compliance=True)   # compare identical PDFs (no text diffs)
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

    def test_reinserted_span_does_not_cascade_false_positives(self):
        """
        Regression test for the "fontdelta05pt" cascade bug.

        page.add_redact_annot() + apply_redactions() + insert_text() — the
        standard PyMuPDF technique for patching a single line of text in an
        existing PDF — appends the reinserted span to the END of the page's
        get_text() extraction order, not its visual position. The matching
        loop used to take the *first* span of spans_rev within
        TEXT_PROXIMITY_PT of each spans_orig[i] rather than the *best*
        match; since the reinserted span was scanned last, an unrelated
        adjacent span (same line, or the line below) was picked up first and
        "stole" the match, and every subsequent span cascaded one slot out
        of alignment for the rest of the page.

        Here only line 1's label is edited (text content changes, not just
        size, so a correct match must show the real old/new text). Lines 2
        and 3 are untouched. Before the fix this produced spurious
        text_changed/removed/added diffs whose old/new text came from lines
        2 and 3 — content that was never touched.
        """
        fd, path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)
        try:
            doc  = fitz.open()
            page = doc.new_page(width=595.0, height=842.0)
            page.insert_text((72, 100), "Dose: 10mg:", fontsize=12, fontname="Times-Bold", color=(0, 0, 0))
            label_rect = page.search_for("Dose: 10mg:")[0]
            page.insert_text((label_rect.x1, 100), " see table below", fontsize=12, color=(0, 0, 0))
            page.insert_text((72, 120), "Second line of text unrelated to the edit.", fontsize=12, color=(0, 0, 0))
            page.insert_text((72, 140), "Third line, also unrelated to the edit.", fontsize=12, color=(0, 0, 0))
            doc.save(path)
            doc.close()

            doc = fitz.open(path)
            page = doc[0]
            rect = page.search_for("Dose: 10mg:")[0]
            page.add_redact_annot(rect, fill=(1, 1, 1))
            page.apply_redactions()
            page.insert_text((rect.x0, rect.y1 - 2.4), "Dose: 12mg:", fontsize=12, fontname="Times-Bold", color=(0, 0, 0))
            fd2, rev_path = tempfile.mkstemp(suffix=".pdf")
            os.close(fd2)
            doc.save(rev_path)
            doc.close()

            # Sanity check on the root cause itself: the reinserted span
            # must land away from its original index for this test to be
            # exercising the real bug, not a no-op.
            doc_a = fitz.open(path)
            doc_b = fitz.open(rev_path)
            spans_a = _spans_from_page(doc_a[0])
            spans_b = _spans_from_page(doc_b[0])
            idx_a = next(i for i, s in enumerate(spans_a) if s["text"] == "Dose: 10mg:")
            idx_b = next(i for i, s in enumerate(spans_b) if s["text"] == "Dose: 12mg:")
            assert idx_b != idx_a, (
                "Expected PyMuPDF to reorder the reinserted span (known redact+insert_text "
                "side effect) — if this no longer reorders, the regression scenario changed."
            )
            doc_a.close()
            doc_b.close()

            result = _run(path, rev_path)
            diffs = result["pages"][0]["differences"]

            text_diffs = [d for d in diffs if d["type"] in ("text_changed", "text_removed", "text_added")]

            untouched_markers = ["Second line", "Third line", "unrelated to the edit"]
            leaked = [
                d for d in text_diffs
                if any(m in d["original_text"] or m in d["revised_text"] for m in untouched_markers)
            ]
            assert leaked == [], (
                f"Untouched lines leaked into text diffs — cascade bug reintroduced: {leaked}"
            )

            # The one real edit must be reported correctly, not swallowed
            # by a cascade elsewhere — and at word granularity ('10mg:' ->
            # '12mg:'), not the whole surrounding line, now that text
            # content is diffed at the word level (see
            # engines/pdf_comparator.py's _diff_line_words).
            label_diffs = [
                d for d in text_diffs
                if d["original_text"] == "10mg:" and d["revised_text"] == "12mg:"
            ]
            assert len(label_diffs) == 1, (
                f"Expected exactly one correct text_changed for the edited word; "
                f"got text diffs: {[(d['type'], d['original_text'], d['revised_text']) for d in text_diffs]}"
            )
        finally:
            Path(path).unlink(missing_ok=True)
            Path(rev_path).unlink(missing_ok=True)

    def test_substring_redaction_fragments_span_but_diff_stays_minimal(self):
        """
        Regression for the fragmentation documented in
        backend/eval/manual_pairs/par1_sonridor_dose_755mg/: redacting only
        a substring ("750") within a longer line ("paracetamol 750 mg")
        splits the line into multiple spans in the revised PDF (confirmed
        below) — e.g. "paracetamol" / "755 mg" as two separate spans,
        neither of which is "paracetamol 750 mg" nor "paracetamol 755 mg".
        Word-level diffing must still report just the one word that
        changed, not leak the untouched "paracetamol"/"mg" as spurious
        diffs, and not depend on how the span happened to split.
        """
        fd, path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)
        try:
            doc  = fitz.open()
            page = doc.new_page(width=595.0, height=842.0)
            page.insert_text((72, 100), "paracetamol 750 mg", fontsize=12, color=(0, 0, 0))
            doc.save(path)
            doc.close()

            doc = fitz.open(path)
            page = doc[0]
            rect = page.search_for("750")[0]
            page.add_redact_annot(rect, fill=(1, 1, 1))
            page.apply_redactions()
            page.insert_text((rect.x0, rect.y1 - 2.4), "755", fontsize=12, color=(0, 0, 0))
            fd2, rev_path = tempfile.mkstemp(suffix=".pdf")
            os.close(fd2)
            doc.save(rev_path)
            doc.close()

            # Sanity check: confirm the span actually fragmented (not a no-op test).
            doc_b = fitz.open(rev_path)
            span_texts_b = [
                sp.get("text", "").strip()
                for block in doc_b[0].get_text("dict")["blocks"] if block.get("type") == 0
                for line in block["lines"] for sp in line["spans"] if sp.get("text", "").strip()
            ]
            doc_b.close()
            assert "paracetamol 755 mg" not in span_texts_b, (
                f"Expected the revised line to be split into multiple spans, not one "
                f"clean span — got {span_texts_b}; redaction technique no longer fragments."
            )

            result = _run(path, rev_path)
            diffs = result["pages"][0]["differences"]
            text_diffs = [d for d in diffs if d["type"] in ("text_changed", "text_removed", "text_added")]

            assert len(text_diffs) == 1, (
                f"Expected exactly one minimal diff for the dose change; got: "
                f"{[(d['type'], d['original_text'], d['revised_text']) for d in text_diffs]}"
            )
            d = text_diffs[0]
            assert d["type"] == "text_changed"
            assert d["original_text"] == "750"
            assert d["revised_text"] == "755"
        finally:
            Path(path).unlink(missing_ok=True)
            Path(rev_path).unlink(missing_ok=True)

    def test_deleted_character_with_orphan_insertion_stays_minimal(self):
        """
        Regression for the fragmentation documented in
        backend/eval/manual_pairs/par2_mounjaro_dose_17mg/: deleting one
        digit ("5" out of "15") leaves the surrounding sentence as a single
        span with a gap, while the newly inserted digit ("7") lands as its
        own disjoint span positioned at zero gap from where the deleted
        digit was — reconstructing "17" requires recognizing that
        zero-gap adjacency, not just concatenating spans with a space.
        """
        fd, path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)
        try:
            doc  = fitz.open()
            page = doc.new_page(width=595.0, height=842.0)
            page.insert_text((72, 100), "MOUNJARO maximum dose is 15 mg weekly.", fontsize=12, color=(0, 0, 0))
            doc.save(path)
            doc.close()

            doc = fitz.open(path)
            page = doc[0]
            rect = page.search_for("15 mg")[0]
            page.add_redact_annot(rect, fill=(1, 1, 1))
            page.apply_redactions()
            page.insert_text((rect.x0, rect.y1 - 2.4), "1  mg", fontsize=12, color=(0, 0, 0))
            # Insert the replacement digit flush against the end of "1" —
            # the exact zero-gap adjacency observed in the real par2 pair.
            one_end_x = next(w[2] for w in page.get_text("words") if w[4] == "1")
            page.insert_text((one_end_x, rect.y1 - 2.4), "7", fontsize=12, color=(0, 0, 0))
            fd2, rev_path = tempfile.mkstemp(suffix=".pdf")
            os.close(fd2)
            doc.save(rev_path)
            doc.close()

            result = _run(path, rev_path)
            diffs = result["pages"][0]["differences"]
            text_diffs = [d for d in diffs if d["type"] in ("text_changed", "text_removed", "text_added")]

            assert len(text_diffs) == 1, (
                f"Expected exactly one minimal diff for the dose change; got: "
                f"{[(d['type'], d['original_text'], d['revised_text']) for d in text_diffs]}"
            )
            d = text_diffs[0]
            assert d["type"] == "text_changed"
            assert d["original_text"] == "15"
            assert d["revised_text"] == "17", (
                f"Expected the orphan '7' to merge with '1' into '17' (zero-gap adjacency); "
                f"got {d['revised_text']!r} — spacing reconstruction regressed."
            )
        finally:
            Path(path).unlink(missing_ok=True)
            Path(rev_path).unlink(missing_ok=True)

    def test_hyphenated_multiline_edit_isolates_first_line_only(self):
        """
        Regression for the fragmentation documented in
        backend/eval/manual_pairs/par4_mounjaro_multilinha/: editing one
        word within the first of two physically-wrapped, hyphenated lines
        ("...ou cirurgião-" / "dentista.") must report only that word's
        change, and must not touch or report anything for the second
        (untouched) physical line.
        """
        fd, path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)
        try:
            doc  = fitz.open()
            page = doc.new_page(width=595.0, height=842.0)
            page.insert_text((72, 100), "Em caso de duvidas, procure orientacao do farmaceutico ou cirurgiao-",
                              fontsize=12, fontname="Times-Bold", color=(0, 0, 0))
            page.insert_text((72, 120), "dentista.", fontsize=12, fontname="Times-Bold", color=(0, 0, 0))
            doc.save(path)
            doc.close()

            doc = fitz.open(path)
            page = doc[0]
            rect = page.search_for("farmaceutico")[0]
            page.add_redact_annot(rect, fill=(1, 1, 1))
            page.apply_redactions()
            page.insert_text((rect.x0, rect.y1 - 2.4), "farmaceutica", fontsize=12, fontname="Times-Bold", color=(0, 0, 0))
            fd2, rev_path = tempfile.mkstemp(suffix=".pdf")
            os.close(fd2)
            doc.save(rev_path)
            doc.close()

            result = _run(path, rev_path)
            diffs = result["pages"][0]["differences"]
            text_diffs = [d for d in diffs if d["type"] in ("text_changed", "text_removed", "text_added")]

            assert len(text_diffs) == 1, (
                f"Expected exactly one minimal diff for the word change; got: "
                f"{[(d['type'], d['original_text'], d['revised_text']) for d in text_diffs]}"
            )
            d = text_diffs[0]
            assert d["type"] == "text_changed"
            assert d["original_text"] == "farmaceutico"
            assert d["revised_text"] == "farmaceutica"

            leaked = [dd for dd in text_diffs if "dentista" in dd["original_text"] or "dentista" in dd["revised_text"]]
            assert leaked == [], f"Second (untouched) physical line leaked into diffs: {leaked}"
        finally:
            Path(path).unlink(missing_ok=True)
            Path(rev_path).unlink(missing_ok=True)
