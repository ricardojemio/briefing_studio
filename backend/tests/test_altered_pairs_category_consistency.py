"""
backend/tests/test_altered_pairs_category_consistency.py

Regression test for the by_category attribution rule in
eval/run_altered_pairs.py (see
eval/investigations/altered_pairs_category_consistency/README.md): tp/fn
count in the EXPECTED category, fp counts in the DETECTED category, and
a TP's expected/detected category divergence is recorded only in
category_confusion, never as an extra fp/fn. This is what guarantees
sum(by_category[m][*].values()) == overall[m] for every metric — this
test checks that invariant holds on the real artigo pairs, plus that
every reported precision/recall is exactly reproducible from its own
tp/fp/fn (catches a transcription/rounding bug even if the sums happen
to still match).

Skips gracefully when backend/eval/fixtures_alterados/ (gitignored, real
client artwork) isn't present locally — same pattern as
test_pdf_draft_engine.py.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import eval.harness as harness
import eval.run_altered_pairs as altered

FIXTURES_DIR = Path(__file__).parent.parent / "eval" / "fixtures_alterados"
GABARITO = FIXTURES_DIR / "gabarito_alteracoes.json"

skip_no_fixtures = pytest.mark.skipif(
    not GABARITO.exists(),
    reason=f"No gabarito at {GABARITO} — real altered-pairs fixtures not present locally",
)

ARTIGO_PRODUCTS = {"Domperidona", "Buscopan", "Albendazol", "SaldeFruta", "CodigoMS"}


@pytest.fixture(scope="module")
def artigo_report() -> dict:
    return altered.run(GABARITO, FIXTURES_DIR, only_products=ARTIGO_PRODUCTS)


@skip_no_fixtures
def test_category_sums_match_overall(artigo_report):
    for m in harness.METRICS:
        by_cat = artigo_report["by_category"][m]
        tp = sum(v["tp"] for v in by_cat.values())
        fp = sum(v["fp"] for v in by_cat.values())
        fn = sum(v["fn"] for v in by_cat.values())
        overall = artigo_report["overall"][m]
        assert (tp, fp, fn) == (overall["tp"], overall["fp"], overall["fn"]), (
            f"metric={m}: sum(by_category)={(tp, fp, fn)} != overall={(overall['tp'], overall['fp'], overall['fn'])}"
        )


@skip_no_fixtures
def test_category_precision_recall_reproducible(artigo_report):
    for m in harness.METRICS:
        for cat, stats in artigo_report["by_category"][m].items():
            recomputed = harness._prf1(stats["tp"], stats["fp"], stats["fn"])
            assert stats["precision"] == recomputed["precision"], (
                f"{m}/{cat}: precision={stats['precision']} but tp/fp/fn={stats['tp']}/{stats['fp']}/{stats['fn']} implies {recomputed['precision']}"
            )
            assert stats["recall"] == recomputed["recall"], (
                f"{m}/{cat}: recall={stats['recall']} but tp/fp/fn={stats['tp']}/{stats['fp']}/{stats['fn']} implies {recomputed['recall']}"
            )
            assert stats["f1"] == recomputed["f1"]


@skip_no_fixtures
def test_category_confusion_never_inflates_fp(artigo_report):
    """A TP with diverging expected/detected categories must show up only
    in category_confusion, never as an extra fp anywhere — total fp
    across by_category must equal the raw unmatched-detection count
    (never more, which would mean a divergence got double-counted as a
    spurious FP on top of the TP it belongs to)."""
    for m in harness.METRICS:
        fp_total = sum(v["fp"] for v in artigo_report["by_category"][m].values())
        fn_total = sum(v["fn"] for v in artigo_report["by_category"][m].values())
        # Every fp/fn must come from either a genuine lenient-unmatched
        # detection/expectation, or a strict text-mismatch demotion (which
        # contributes exactly one fp AND one fn together) — so fp_total
        # and fn_total can never differ by more than the metric's own
        # lenient-level fp/fn imbalance; a confusion-driven extra fp with
        # no paired fn would break that symmetry at the strict metrics
        # relative to their lenient counterpart.
        kind, strict = harness.METRIC_SPECS[m]
        lenient_m = "lenient" if kind == "exact" else "lenient_normalized"
        lenient_fp = sum(v["fp"] for v in artigo_report["by_category"][lenient_m].values())
        lenient_fn = sum(v["fn"] for v in artigo_report["by_category"][lenient_m].values())
        demotions = fp_total - lenient_fp
        assert demotions == fn_total - lenient_fn, (
            f"metric={m}: fp grew by {demotions} over {lenient_m} but fn grew by "
            f"{fn_total - lenient_fn} — a demotion must always add exactly one fp AND one fn"
        )
