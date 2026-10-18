# Investigation: span-reordering cascade (fontdelta05pt)

Root-cause investigation and fix evidence for a bug found while testing
`compare_artworks()` against a real pair: `18078505_Mounjaro.pdf` (original)
vs `Bula-Mounjaro_VERSAO_B_fontdelta05pt.pdf` (revised — one bold label on
page 2 edited from 12.0pt to 11.5pt via `page.add_redact_annot()` +
`page.apply_redactions()` + `page.insert_text()`, nothing else touched).

**Symptom**: the UI reported 50 differences for a single real edit. Two
looked correct (the label got smaller, leaving extra space). The other 47
paired unrelated, unedited lines against each other — e.g. one diff's
`original_text` was `"MOUNJARO não foi estudado em pacientes com"` and its
`revised_text` was `"histórico de inflamação no pâncreas..."`, two real,
unedited sentences from the document, neither touched by the edit.

## Root cause

1. **Trigger**: `apply_redactions()` + `insert_text()` on an existing PDF
   page appends the reinserted text as a new block at the END of
   `page.get_text("dict")`'s extraction order — not at its original,
   visually-correct index. Confirmed directly: the edited label moved from
   index 6 to index 54 (last) out of 55 spans on page 2 (see
   `spans_version_a_page2.json` / `spans_version_b_page2.json`).

2. **Amplifying bug**: `compare_artworks()`'s span-matching loop (in
   `engines/pdf_comparator.py`, before the fix committed alongside this
   archive) was "first-candidate-wins": for each original span, it took the
   *first* revised span whose bbox fell within `TEXT_PROXIMITY_PT` (5pt) —
   not the best one. Since the edited label's true match was now scanned
   *last*, the loop instead grabbed the nearest unrelated neighbour (the
   adjacent span on the same line, touching at zero distance — well within
   the 5pt pad). That stole the neighbour's rightful match, which in turn
   stole the next span's, and so on down the rest of the page — a cascade
   triggered by exactly one out-of-order span.

## Fix

`_match_spans()` replaced the first-match loop with a best-overlap-first
assignment: every candidate pair within the existing tolerance is scored by
bbox IoU, sorted descending, and assigned greedily (highest score first,
skipping any span already taken). A span's true counterpart — wherever it
landed in the list — has near-total IoU; an adjacent-but-wrong neighbour
that only qualifies via the proximity pad has IoU ≈ 0 (no real intersection,
just close enough to pass the gate), so it only gets picked when nothing
better exists for either span — i.e. exactly the unambiguous case the old
algorithm already handled correctly. See the commit this README ships with
for the implementation.

## Files in this folder

| File | What it is |
|---|---|
| `raw_differences_before_fix.json` | Raw `differences` list `compare_artworks()` returned for the real Mounjaro pair, page 2, **before** the fix — all 50 entries, including the 47 spurious ones. |
| `raw_differences_after_fix.json` | Same real pair, same page, **after** the fix — 1 entry (the genuine visual effect of the smaller label). |
| `spans_version_a_page2.json` | `_spans_from_page()` output for page 2 of the original PDF — the edited label is at index 6, in natural reading order. |
| `spans_version_b_page2.json` | Same, for the revised PDF — the *same* label (now 11.5pt) is at index 54, the last span extracted, despite being visually near the top of the page. This is the concrete evidence for root cause #1 above. |
| `reproduce_real_pair_investigation.py` | Script used to produce the two files above: opens both PDFs, runs `compare_artworks()` directly (not through the API), dumps the raw differences and both span lists. Needs the two source PDFs (not included here — see "Reproducing" below) and must run inside the backend Docker image (needs `cv2`). |
| `isolation_test_script.py` | Minimal, self-contained reproduction: builds a trivial 4-line PDF, edits one line with the exact same redact+insert_text technique, and runs `compare_artworks()` on it. Confirms the bug is generic (not a quirk of the Mounjaro PDF). |
| `isolation_test_version_a.pdf` / `isolation_test_version_b.pdf` | The two PDFs `isolation_test_script.py` generates. |
| `isolation_test_differences_before_fix.json` | Isolation test result before the fix: 5 spurious differences from editing 1 line out of 4 (the cascade pattern, reproduced in miniature). |
| `isolation_test_differences_after_fix.json` | Same, after the fix: the text-cascade is gone (0 spurious text diffs). See "Known follow-up" below for what remains. |
| `isolation_test_version_a_render.png` / `isolation_test_version_b_render.png` | 150 DPI renders of the isolation test pages, for visual sanity-checking that the redaction technique itself behaves as intended (label visibly shrinks, nothing else moves). |

## Known follow-up (not fixed in this round, out of scope for this commit)

Fixing the matching bug uncovered a **separate, previously-hidden** issue on
the isolation test (not on the real Mounjaro pair, where it doesn't occur):
after the text cascade stopped masking them, `apply_redactions()` + resave
on the trivial 4-line test PDF produces small sub-pixel rendering
differences across lines that were never touched, each surfacing as its own
spurious `visual` diff (10 of them, see
`isolation_test_differences_after_fix.json`). Before the fix, these were
invisible only because the bogus `text_changed`/`text_removed` diff boxes
happened to blanket-suppress any visual diff that overlapped them. This is
a visual-diff threshold/suppression question (`VISUAL_THRESHOLD`,
`VISUAL_MIN_AREA_PX2`, `VISUAL_DILATE_PX` in `engines/pdf_comparator.py`),
unrelated to span matching, and was not investigated or touched here.

## Reproducing

The real Mounjaro pair (`18078505_Mounjaro.pdf` /
`Bula-Mounjaro_VERSAO_B_fontdelta05pt.pdf`) is not included in this
archive — only the public ANVISA-bula seed in `backend/eval/seed/` is
committed to this repo. To reproduce `raw_differences_*.json` and
`spans_version_*.json`, re-run `reproduce_real_pair_investigation.py`
against the two source PDFs (paths at the top of the script).
`isolation_test_script.py` is fully self-contained and needs no external
files.
