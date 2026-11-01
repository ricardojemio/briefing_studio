"""
backend/tests/test_word_diff_granularity.py

Regression tests for the two opposite granularity bugs in
_diff_line_words's word-level opcode handling, and the two false-positive
guards added while fixing them. See EQUAL_GAP_MERGE_MAX_TOKENS and
WORD_SUBST_SIM_MIN in engines/pdf_comparator.py, and
backend/eval/investigations/granularity_opcode_refinement/README.md.

1. Fragmentation (Buscopan "6 a 8 horas" -> "4 a 6 horas"): a reused short
   token ("6" moves from first number to second number) spuriously
   anchors difflib's LCS as "equal" and splits one edit into several
   opcodes. Fixed by _merge_fragmented_opcodes.
2. Fusion (Albendazol "albendazol não" -> "albendasol"): two independent,
   adjacent edits (a 1-letter typo + an unrelated deletion) share no
   token to anchor a split, so difflib reports one oversized "replace".
   Fixed by _split_fused_replace.
3. Guard against over-splitting: a leftover word touching the matched
   window with a near-zero gap is a token the extraction split in two
   (e.g. "1"+"7" meant to read "17", "mg/dia"+")" meant to read
   "mg/dia)") — not an independent edit. Found as real regressions on
   Domperidona and on the existing par2_mounjaro_dose_17mg manual pair
   while fixing #2; both must stay a single clean diff.

Run inside Docker:
    docker compose exec backend python -m pytest tests/test_word_diff_granularity.py -v
"""

import os
import sys
import tempfile
from pathlib import Path

import fitz  # PyMuPDF

sys.path.insert(0, str(Path(__file__).parent.parent))

from engines.pdf_comparator import compare_artworks

# ── Helpers ───────────────────────────────────────────────────────────────────────

def _make_pdf(text: str, y: float = 100.0) -> str:
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)
    doc  = fitz.open()
    page = doc.new_page(width=400, height=200)
    page.insert_text((20, y), text, fontsize=12, color=(0, 0, 0))
    doc.save(path)
    doc.close()
    return path


def _make_pdf_with_split_token(first: str, second: str, y: float = 100.0) -> str:
    """Writes `first` then `second` as two separate insert_text calls,
    positioned with a near-zero gap — reproducing the real-world artifact
    where an edit tool's text extraction splits one token into two
    (e.g. "17" -> "1" + "7", or "mg/dia)" -> "mg/dia" + ")")."""
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)
    doc  = fitz.open()
    page = doc.new_page(width=400, height=200)
    page.insert_text((20, y), first, fontsize=12, color=(0, 0, 0))
    width = fitz.get_text_length(first, fontsize=12)
    page.insert_text((20 + width, y), second, fontsize=12, color=(0, 0, 0))
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


def _text_diffs(result: dict) -> list[dict]:
    return [d for d in result["pages"][0]["differences"] if d["type"] in ("text_changed", "text_added", "text_removed")]


# ── Tests ─────────────────────────────────────────────────────────────────────────

class TestWordDiffGranularity:

    def test_reused_number_in_range_is_one_diff(self):
        """Buscopan case: "6 a 8 horas." -> "4 a 6 horas." — "6" reappears
        at a different position; must still be ONE diff, not fragmented."""
        orig = _make_pdf("O efeito dura por 6 a 8 horas.")
        rev  = _make_pdf("O efeito dura por 4 a 6 horas.")
        try:
            diffs = _text_diffs(_run(orig, rev))
            assert len(diffs) == 1, f"Expected exactly 1 diff, got {len(diffs)}: {diffs}"
            d = diffs[0]
            # "horas." is identical on both sides and may legitimately be
            # excluded as unchanged — what matters is the whole "6 a 8" ->
            # "4 a 6" edit lands in one diff, not several.
            assert "6" in d["original_text"] and "8" in d["original_text"]
            assert "4" in d["revised_text"] and "6" in d["revised_text"]
        finally:
            Path(orig).unlink(missing_ok=True)
            Path(rev).unlink(missing_ok=True)

    def test_adjacent_typo_and_deletion_are_two_diffs(self):
        """Albendazol case: "albendazol não" -> "albendasol" — a 1-letter
        typo immediately followed by an unrelated deleted word; must
        become a substitution + a removal, not one fused replace."""
        orig = _make_pdf("O albendazol não deve ser usado.")
        rev  = _make_pdf("O albendasol deve ser usado.")
        try:
            diffs = _text_diffs(_run(orig, rev))
            assert len(diffs) == 2, f"Expected exactly 2 diffs, got {len(diffs)}: {diffs}"
            substitutions = [d for d in diffs if d["type"] == "text_changed"]
            removals      = [d for d in diffs if d["type"] == "text_removed"]
            assert len(substitutions) == 1 and substitutions[0]["original_text"].strip() == "albendazol"
            assert substitutions[0]["revised_text"].strip() == "albendasol"
            assert len(removals) == 1 and removals[0]["original_text"].strip() == "não"
        finally:
            Path(orig).unlink(missing_ok=True)
            Path(rev).unlink(missing_ok=True)

    def test_split_digit_token_not_treated_as_independent_addition(self):
        """Regression guard: par2_mounjaro_dose_17mg's real failure mode —
        "15" -> "17" where the revised extraction splits "17" into "1"+"7"
        at near-zero gap. Must stay a single clean diff, not
        "15"->"1" plus a spurious insert of "7"."""
        orig = _make_pdf("MOUNJARO e 15 mg uma vez por semana.")
        rev  = _make_pdf_with_split_token(
            "MOUNJARO e 1", "7 mg uma vez por semana.",
        )
        try:
            diffs = _text_diffs(_run(orig, rev))
            assert len(diffs) == 1, f"Expected exactly 1 diff, got {len(diffs)}: {diffs}"
            d = diffs[0]
            assert d["original_text"].strip() == "15"
            assert d["revised_text"].strip() == "17"
        finally:
            Path(orig).unlink(missing_ok=True)
            Path(rev).unlink(missing_ok=True)

    def test_split_punctuation_token_not_treated_as_independent_addition(self):
        """Regression guard: the real Domperidona failure mode —
        "30 mg/dia)" -> "50 mg/dia)" where the revised extraction splits
        "mg/dia)" into "mg/dia"+")" at near-zero gap. Must stay a single
        clean diff, not a substitution plus a spurious insert of ")"."""
        orig = _make_pdf("dose tipicamente 30 mg/dia) e pode")
        rev  = _make_pdf_with_split_token(
            "dose tipicamente 50 mg/dia", ") e pode",
        )
        try:
            diffs = _text_diffs(_run(orig, rev))
            assert len(diffs) == 1, f"Expected exactly 1 diff, got {len(diffs)}: {diffs}"
            d = diffs[0]
            # "mg/dia)" is identical on both sides (once the split-token
            # fragments are recognized as the same word) and may
            # legitimately be excluded as unchanged — what matters is no
            # spurious extra diff for the lone ")" fragment.
            assert d["original_text"].strip() == "30"
            assert d["revised_text"].strip() == "50"
        finally:
            Path(orig).unlink(missing_ok=True)
            Path(rev).unlink(missing_ok=True)
