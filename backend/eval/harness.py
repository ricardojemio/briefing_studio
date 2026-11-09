"""
backend/eval/harness.py

Evaluation harness for the ArtReview comparison core.

Runs engines.pdf_comparator.compare_artworks() over every pair in a
manifest, matches detected differences against each pair's
ground_truth.json (never edited to match the detector's output — the
ground truth is the ground truth), and reports precision / recall / F1 per
difference type and in aggregate, under four metrics:

- lenient: a detection counts as a true positive if its type matches and
  its bbox overlaps the expected one (IoU >= IOU_MATCH_THRESHOLD). This is
  the original (and only) metric this harness had before.
- strict ("exata"): additionally requires the reported original_text/
  revised_text (normalized for whitespace only) to match the ground
  truth's EXACTLY. A lenient TP whose reported text doesn't match counts
  as a strict FP (the detection exists but says the wrong thing) *and* a
  strict FN (the real edit's correct content was never actually reported)
  — not just a lesser TP.
- lenient_normalized / strict_normalized ("normalizada"): same two ideas,
  but with the bbox and text comparisons both normalized for *granularity*
  — see CONTAINMENT_THRESHOLD and _minimal_edit below. This exists because
  the ground truth and the detector can correctly describe the same real
  edit at different granularities (a whole sentence vs. just the one word
  that changed) without either one being wrong, and "exata" alone can't
  tell that apart from a genuine content error. "exata" is kept exactly as
  it was BEFORE this normalization was added (commit 52a80a3), reported
  side by side with "normalizada" for transparency, specifically so the
  effect of normalizing for granularity is visible rather than hidden
  inside a single changed number — see eval/README.md.

Needs opencv (via pdf_comparator) — run inside the backend Docker image:
    docker compose exec backend python -m eval.harness
or, from the repo root, with the image built locally:
    docker run --rm -v "$(pwd)/backend:/app" -w /app <backend-image> \
        python -m eval.harness
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from engines.pdf_comparator import compare_artworks, _taxonomy  # noqa: E402

PAIRS_DIR   = Path(__file__).parent / "pairs"
RESULTS_DIR = Path(__file__).parent / "results"

IOU_MATCH_THRESHOLD = 0.10  # generous: dilated pixel-diff contours rarely
                             # tightly bound the original vector shape

# A ground-truth bbox and a detected bbox can legitimately describe the
# same edit at different granularities (a whole sentence vs. just the one
# word the detector isolated inside it) — IoU alone penalizes this pairing
# heavily, because the two boxes can differ enormously in area even though
# the small one sits entirely inside the large one. CONTAINMENT_THRESHOLD
# accepts a match when at least half of the DETECTED box's own area falls
# inside the EXPECTED box: generous enough to tolerate a detector that
# (correctly) narrows to a sub-span of a coarser ground truth, but still
# requires most of the detected region to genuinely be inside the expected
# one — a detection that only grazes a corner, or sits mostly outside it,
# still fails. 0.5 was chosen as "more inside than outside"; it is not
# derived from the observed cases, since this rule must apply uniformly
# to every pair, not be tuned to make any specific one pass.
CONTAINMENT_THRESHOLD = 0.5

METRICS = ("lenient", "lenient_normalized", "strict", "strict_normalized")


def _iou(a: list, b: list) -> float:
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _bbox_contained_ratio(inner: list, outer: list) -> float:
    """Fraction of *inner*'s own area that falls inside *outer*. Not
    symmetric — _iou() already covers the symmetric case."""
    ix0, iy0 = max(inner[0], outer[0]), max(inner[1], outer[1])
    ix1, iy1 = min(inner[2], outer[2]), min(inner[3], outer[3])
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    area_inner = (inner[2] - inner[0]) * (inner[3] - inner[1])
    return inter / area_inner if area_inner > 0 else 0.0


def _normalize_text(s: str) -> str:
    """Whitespace-insensitive comparison only — a run of spaces/newlines
    collapses to one space, leading/trailing stripped. Deliberately does
    NOT fix missing/extra characters: 'MOUNJARO é 1  mg' (double space
    where a digit was dropped) must NOT normalize to match '17 mg'."""
    return " ".join((s or "").split())


def _is_textless_type(expected: dict) -> bool:
    """visual (and dimensional/compliance) diffs never carry
    original_text/revised_text — compare_artworks always emits "" for
    them (pixel/page-size/font-size comparisons, not text extraction).
    The strict text-match criterion only makes sense for diff types the
    system actually fills text in for; applying it to a textless type
    would just measure whether a gabarito author happened to write a
    descriptive label (e.g. "caixa laranja 60x16 pt") into the same
    field the system always leaves blank — region (IoU) + page is the
    only meaningful match criterion for these."""
    return expected.get("type") in ("visual", "dimensional", "compliance")


def _text_matches(expected: dict, detected: dict) -> bool:
    if _is_textless_type(expected):
        return True
    return (
        _normalize_text(expected.get("original_text", "")) == _normalize_text(detected.get("original_text", ""))
        and _normalize_text(expected.get("revised_text", "")) == _normalize_text(detected.get("revised_text", ""))
    )


def _minimal_edit(old_text: str, new_text: str) -> tuple[str, str]:
    """Reduces an (old, new) text pair to its minimal word-level edit by
    stripping the longest common leading and trailing word-runs. Two
    differently-granular descriptions of the same real edit normalize to
    the same core: ("paracetamol 750 mg", "paracetamol 500 mg") and
    ("750", "500") both reduce to ("750", "500"), because "paracetamol"
    and "mg" are common prefix/suffix words around the one word that
    actually changed. A genuine content error still fails: ("15", "17")
    vs ("15", "1") reduce to ("", "17") vs ("", "1") — different cores,
    correctly not a match."""
    old_words = _normalize_text(old_text).split()
    new_words = _normalize_text(new_text).split()

    i = 0
    while i < len(old_words) and i < len(new_words) and old_words[i] == new_words[i]:
        i += 1

    j = 0
    max_suffix = min(len(old_words), len(new_words)) - i
    while (j < max_suffix
           and old_words[len(old_words) - 1 - j] == new_words[len(new_words) - 1 - j]):
        j += 1

    old_core = old_words[i: len(old_words) - j]
    new_core = new_words[i: len(new_words) - j]
    return " ".join(old_core), " ".join(new_core)


def _text_matches_minimal_edit(expected: dict, detected: dict) -> bool:
    if _is_textless_type(expected):
        return True
    exp_old, exp_new = _minimal_edit(expected.get("original_text", ""), expected.get("revised_text", ""))
    det_old, det_new = _minimal_edit(detected.get("original_text", ""), detected.get("revised_text", ""))
    return exp_old == det_old and exp_new == det_new


def _flatten_detections(result: dict) -> list[dict]:
    out = []
    for page in result["pages"]:
        for d in page["differences"]:
            out.append({
                "type": d["type"], "page": d["page"], "bbox": d["bbox"],
                "original_text": d.get("original_text", ""), "revised_text": d.get("revised_text", ""),
                "description": d["description"],
            })
    return out


def _match(expected: list[dict], detected: list[dict]) -> dict:
    """Greedy IoU matching, highest-overlap first, gated on type+page match
    (the lenient criterion). Returns {"tp": [...], "fn": [...], "fp": [...]}
    of the original dicts. Each "tp" entry also carries "text_match": bool
    — whether the reported original_text/revised_text (normalized for
    whitespace) match the ground truth's — which is what the strict metric
    additionally requires."""
    candidates = []
    for ei, e in enumerate(expected):
        for di, d in enumerate(detected):
            if e["type"] != d["type"] or e["page"] != d["page"]:
                continue
            score = _iou(e["bbox"], d["bbox"])
            if score >= IOU_MATCH_THRESHOLD:
                candidates.append((score, ei, di))
    candidates.sort(reverse=True)

    matched_e, matched_d = set(), set()
    tp = []
    for score, ei, di in candidates:
        if ei in matched_e or di in matched_d:
            continue
        matched_e.add(ei)
        matched_d.add(di)
        tp.append({
            "expected": expected[ei], "detected": detected[di], "iou": round(score, 3),
            "text_match": _text_matches(expected[ei], detected[di]),
        })

    fn = [expected[i] for i in range(len(expected)) if i not in matched_e]
    fp = [detected[i] for i in range(len(detected)) if i not in matched_d]
    return {"tp": tp, "fn": fn, "fp": fp}


def _match_normalized(expected: list[dict], detected: list[dict]) -> dict:
    """Same greedy highest-score-first assignment as _match(), but:
    (a) the admission gate additionally accepts a detected bbox mostly
        contained in the expected one (CONTAINMENT_THRESHOLD), not just
        IoU >= IOU_MATCH_THRESHOLD — see that constant's docstring;
    (b) "text_match" is computed via _text_matches_minimal_edit() instead
        of the exact _text_matches().
    Both normalizations apply uniformly to every pair — nothing here is
    conditioned on which pair is being scored."""
    candidates = []
    for ei, e in enumerate(expected):
        for di, d in enumerate(detected):
            if e["type"] != d["type"] or e["page"] != d["page"]:
                continue
            iou = _iou(e["bbox"], d["bbox"])
            containment = _bbox_contained_ratio(d["bbox"], e["bbox"])
            if iou >= IOU_MATCH_THRESHOLD or containment >= CONTAINMENT_THRESHOLD:
                candidates.append((max(iou, containment), ei, di))
    candidates.sort(reverse=True)

    matched_e, matched_d = set(), set()
    tp = []
    for score, ei, di in candidates:
        if ei in matched_e or di in matched_d:
            continue
        matched_e.add(ei)
        matched_d.add(di)
        tp.append({
            "expected": expected[ei], "detected": detected[di], "score": round(score, 3),
            "text_match": _text_matches_minimal_edit(expected[ei], detected[di]),
        })

    fn = [expected[i] for i in range(len(expected)) if i not in matched_e]
    fp = [detected[i] for i in range(len(detected)) if i not in matched_d]
    return {"tp": tp, "fn": fn, "fp": fp}


def _counts(match: dict, strict: bool) -> tuple[int, int, int]:
    """(tp, fp, fn) under the lenient or strict criterion. Strict demotes
    every lenient TP whose text didn't match into one FP *and* one FN."""
    if not strict:
        return len(match["tp"]), len(match["fp"]), len(match["fn"])
    mismatched = sum(1 for t in match["tp"] if not t["text_match"])
    return (
        len(match["tp"]) - mismatched,
        len(match["fp"]) + mismatched,
        len(match["fn"]) + mismatched,
    )


def _prf1(tp: int, fp: int, fn: int) -> dict:
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall    = tp / (tp + fn) if (tp + fn) else 0.0
    f1        = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    return {"precision": round(precision, 3), "recall": round(recall, 3), "f1": round(f1, 3),
            "tp": tp, "fp": fp, "fn": fn}


#   metric name          -> (which match dict to use, strict text check?)
METRIC_SPECS = {
    "lenient":            ("exact",      False),
    "lenient_normalized": ("normalized", False),
    "strict":             ("exact",      True),
    "strict_normalized":  ("normalized", True),
}


def _bump_type_counts(by_type: dict, match: dict, metric: str, strict: bool) -> None:
    tp_d, fp_d, fn_d = by_type[metric]["tp"], by_type[metric]["fp"], by_type[metric]["fn"]
    for t in match["tp"]:
        typ = t["expected"]["type"]
        if not strict or t["text_match"]:
            tp_d[typ] = tp_d.get(typ, 0) + 1
        else:
            fp_d[typ] = fp_d.get(typ, 0) + 1
            fn_d[typ] = fn_d.get(typ, 0) + 1
    for d in match["fp"]:
        fp_d[d["type"]] = fp_d.get(d["type"], 0) + 1
    for e in match["fn"]:
        fn_d[e["type"]] = fn_d.get(e["type"], 0) + 1


def _bump_subtipo_counts(by_subtipo: dict, match: dict, metric: str, strict: bool) -> None:
    """Same as _bump_type_counts, but keyed by the subtipo taxonomy
    (_taxonomy in pdf_comparator.py) instead of the internal `type` — e.g.
    separates a dose/measure edit ("Medida/dose") from a general word
    substitution ("Substituição"), which `type` alone can't (both are
    text_changed).

    RULE (shared with run_altered_pairs.py's by_category): tp/fn always
    key off the EXPECTED side's subtipo; fp (no expected side to key off
    of) keys off the DETECTED side's. This is what keeps
    sum(by_subtipo[m][*].values()) == by_type[m]'s equivalent sum == the
    overall tp/fp/fn for every m, by construction — see
    investigations/altered_pairs_category_consistency/README.md."""
    tp_d, fp_d, fn_d = by_subtipo[metric]["tp"], by_subtipo[metric]["fp"], by_subtipo[metric]["fn"]
    for t in match["tp"]:
        sub = _taxonomy(t["expected"])[1]
        if not strict or t["text_match"]:
            tp_d[sub] = tp_d.get(sub, 0) + 1
        else:
            fp_d[sub] = fp_d.get(sub, 0) + 1
            fn_d[sub] = fn_d.get(sub, 0) + 1
    for d in match["fp"]:
        sub = _taxonomy(d)[1]
        fp_d[sub] = fp_d.get(sub, 0) + 1
    for e in match["fn"]:
        sub = _taxonomy(e)[1]
        fn_d[sub] = fn_d.get(sub, 0) + 1


def _is_one_letter_swap(old: str, new: str) -> bool:
    """A same-length word pair differing in exactly one character — a
    1-letter typo (e.g. "lactose" -> "lactoze"), as opposed to a longer
    edit, an insertion/deletion, or a multi-word change."""
    old, new = (old or "").strip(), (new or "").strip()
    if not old or len(old) != len(new):
        return False
    return sum(1 for a, b in zip(old, new) if a != b) == 1


def run(pairs_dir: Path | None = None) -> dict:
    pairs_dir = pairs_dir or PAIRS_DIR
    manifest_path = pairs_dir / "manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"no pairs found — run synth_generator.py first (expected {manifest_path})")
    manifest_data = json.loads(manifest_path.read_text())
    # manifest.json is either a plain list of pair ids (eval/pairs/) or an
    # object with a "pairs" list plus metadata, e.g. a ground_truth_status
    # note (eval/manual_pairs/, whose ground truth is reconstructed by
    # inspection rather than supplied, pending the real ones).
    pair_ids = manifest_data["pairs"] if isinstance(manifest_data, dict) else manifest_data

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    per_pair = {}
    by_type    = {m: {"tp": {}, "fp": {}, "fn": {}} for m in METRICS}
    by_subtipo = {m: {"tp": {}, "fp": {}, "fn": {}} for m in METRICS}
    one_letter_total = {m: 0 for m in METRICS}
    one_letter_tp    = {m: 0 for m in METRICS}
    alignment_log = []

    with tempfile.TemporaryDirectory() as preview_dir:
        for pair_id in pair_ids:
            pair_dir = pairs_dir / pair_id
            gt = json.loads((pair_dir / "ground_truth.json").read_text())
            expected = gt["expected_differences"]

            result = compare_artworks(
                original_pdf_path=str(pairs_dir.parent / gt["original_pdf"]),
                revised_pdf_path=str(pairs_dir.parent / gt["revised_pdf"]),
                dpi=150,
                preview_dir=preview_dir,
                comparison_id=pair_id,
            )
            for page in result["pages"]:
                alignment_log.append({"pair": pair_id, "page": page["page_num"], **page["alignment"]})

            detected = _flatten_detections(result)
            matches = {
                "exact":      _match(expected, detected),
                "normalized": _match_normalized(expected, detected),
            }

            swap_expected = [
                e for e in expected
                if _is_one_letter_swap(e.get("original_text", ""), e.get("revised_text", ""))
            ]
            for m in METRICS:
                kind, strict = METRIC_SPECS[m]
                _bump_type_counts(by_type, matches[kind], m, strict)
                _bump_subtipo_counts(by_subtipo, matches[kind], m, strict)

                tp_ids = {
                    id(t["expected"]) for t in matches[kind]["tp"]
                    if (not strict or t["text_match"])
                }
                for e in swap_expected:
                    one_letter_total[m] += 1
                    if id(e) in tp_ids:
                        one_letter_tp[m] += 1

            metrics = {m: _prf1(*_counts(matches[METRIC_SPECS[m][0]], strict=METRIC_SPECS[m][1])) for m in METRICS}
            per_pair[pair_id] = {
                "description": gt["description"],
                "ground_truth_status": gt.get("ground_truth_status", "fornecido/gerado — não provisório"),
                "metrics": metrics,
                "false_negatives_exact": matches["exact"]["fn"],
                "false_positives_exact": matches["exact"]["fp"],
                "false_negatives_normalized": matches["normalized"]["fn"],
                "false_positives_normalized": matches["normalized"]["fp"],
                "text_mismatches_exact": [
                    {"expected": t["expected"], "detected": t["detected"]}
                    for t in matches["exact"]["tp"] if not t["text_match"]
                ],
                "text_mismatches_normalized": [
                    {"expected": t["expected"], "detected": t["detected"]}
                    for t in matches["normalized"]["tp"] if not t["text_match"]
                ],
            }

    types = sorted(set(by_type["lenient"]["tp"]) | set(by_type["lenient"]["fp"]) | set(by_type["lenient"]["fn"]))
    by_type_report = {
        m: {t: _prf1(by_type[m]["tp"].get(t, 0), by_type[m]["fp"].get(t, 0), by_type[m]["fn"].get(t, 0))
            for t in types}
        for m in METRICS
    }
    subtipos = sorted(set(by_subtipo["lenient"]["tp"]) | set(by_subtipo["lenient"]["fp"]) | set(by_subtipo["lenient"]["fn"]))
    by_subtipo_report = {
        m: {s: _prf1(by_subtipo[m]["tp"].get(s, 0), by_subtipo[m]["fp"].get(s, 0), by_subtipo[m]["fn"].get(s, 0))
            for s in subtipos}
        for m in METRICS
    }
    overall = {
        m: _prf1(sum(by_type[m]["tp"].values()), sum(by_type[m]["fp"].values()), sum(by_type[m]["fn"].values()))
        for m in METRICS
    }
    one_letter_swap_report = {
        m: {
            "tp": one_letter_tp[m], "total": one_letter_total[m],
            "detection_rate": round(one_letter_tp[m] / one_letter_total[m], 3) if one_letter_total[m] else None,
        }
        for m in METRICS
    }

    report = {
        "pairs": per_pair,
        "by_type": by_type_report,
        "by_subtipo": by_subtipo_report,
        "one_letter_swap_detection": one_letter_swap_report,
        "overall": overall,
        "alignment": alignment_log,
    }
    (RESULTS_DIR / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    return report


def _fmt(m: dict) -> str:
    return f"P={m['precision']:.2f} R={m['recall']:.2f} F1={m['f1']:.2f} (tp={m['tp']} fp={m['fp']} fn={m['fn']})"


def _print_report(report: dict) -> None:
    print("\n=== Alinhamento (ORB) por página ===")
    for a in report["alignment"]:
        print(f"  {a['pair']} p{a['page']}: method={a['method']} "
              f"kp_orig={a['keypoints_orig']} kp_rev={a['keypoints_rev']} "
              f"good_matches={a['good_matches']} inliers={a['inliers']}")

    print("\n=== Por par — leniente / leniente_normalizado / estrita(exata) / estrita_normalizada ===")
    for pair_id, info in report["pairs"].items():
        status = info["ground_truth_status"]
        print(f"  {pair_id} — {info['description']}")
        if "PROVISÓRIO" in status:
            print(f"      [{status}]")
        m = info["metrics"]
        print(f"      leniente            : {_fmt(m['lenient'])}")
        print(f"      leniente_normalizado: {_fmt(m['lenient_normalized'])}")
        print(f"      estrita (exata)     : {_fmt(m['strict'])}")
        print(f"      estrita_normalizada : {_fmt(m['strict_normalized'])}")
        for fn in info["false_negatives_normalized"]:
            print(f"      MISSED   (normalizado) [{fn['type']}] p{fn['page']} {fn['description']}")
        for fp in info["false_positives_normalized"]:
            print(f"      SPURIOUS (normalizado) [{fp['type']}] p{fp['page']} {fp['description']}")
        for tm in info["text_mismatches_normalized"]:
            e, d = tm["expected"], tm["detected"]
            print(f"      TEXT MISMATCH (normalizado) [{e['type']}] p{e['page']}: "
                  f"expected old={e.get('original_text','')!r} new={e.get('revised_text','')!r} "
                  f"| got old={d.get('original_text','')!r} new={d.get('revised_text','')!r}")

    print("\n=== Por tipo de divergência ===")
    types = sorted(report["by_type"]["lenient"])
    for t in types:
        bt = report["by_type"]
        print(f"  {t:15s} leniente            : {_fmt(bt['lenient'][t])}")
        print(f"  {'':15s} leniente_normalizado: {_fmt(bt['lenient_normalized'][t])}")
        print(f"  {'':15s} estrita (exata)     : {_fmt(bt['strict'][t])}")
        print(f"  {'':15s} estrita_normalizada : {_fmt(bt['strict_normalized'][t])}")

    print("\n=== Por subtipo (taxonomia) ===")
    subtipos = sorted(report["by_subtipo"]["lenient"])
    for s in subtipos:
        bs = report["by_subtipo"]
        print(f"  {s:17s} leniente            : {_fmt(bs['lenient'][s])}")
        print(f"  {'':17s} leniente_normalizado: {_fmt(bs['lenient_normalized'][s])}")
        print(f"  {'':17s} estrita (exata)     : {_fmt(bs['strict'][s])}")
        print(f"  {'':17s} estrita_normalizada : {_fmt(bs['strict_normalized'][s])}")

    print("\n=== Taxa de detecção — trocas de 1 letra (erro ortográfico) ===")
    for m in METRICS:
        s = report["one_letter_swap_detection"][m]
        rate = f"{s['detection_rate']:.0%}" if s["detection_rate"] is not None else "n/a (nenhum caso no gabarito)"
        print(f"  {m:20s}: {s['tp']}/{s['total']} detectadas ({rate})")

    o = report["overall"]
    print("\n=== Agregado ===")
    print(f"  leniente            : {_fmt(o['lenient'])}")
    print(f"  leniente_normalizado: {_fmt(o['lenient_normalized'])}")
    print(f"  estrita (exata)     : {_fmt(o['strict'])}")
    print(f"  estrita_normalizada : {_fmt(o['strict_normalized'])}")
    print(f"\n  diferença (normalizada - exata): "
          f"ΔP={o['strict_normalized']['precision'] - o['strict']['precision']:+.3f} "
          f"ΔR={o['strict_normalized']['recall'] - o['strict']['recall']:+.3f} "
          f"ΔF1={o['strict_normalized']['f1'] - o['strict']['f1']:+.3f}")


if __name__ == "__main__":
    _print_report(run())
