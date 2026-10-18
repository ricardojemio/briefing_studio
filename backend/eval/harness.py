"""
backend/eval/harness.py

Evaluation harness for the ArtReview comparison core.

Runs engines.pdf_comparator.compare_artworks() over every pair in a
manifest, matches detected differences against each pair's
ground_truth.json, and reports precision / recall / F1 per difference type
and in aggregate — under two metrics:

- lenient: a detection counts as a true positive if its type matches and
  its bbox overlaps the expected one (IoU >= IOU_MATCH_THRESHOLD). This is
  the original (and only) metric this harness had before.
- strict: additionally requires the reported original_text/revised_text
  (normalized for whitespace) to match the ground truth's. A lenient TP
  whose reported text doesn't match counts as a strict FP (the detection
  exists but says the wrong thing) *and* a strict FN (the real edit's
  correct content was never actually reported) — not just a lesser TP.
  This catches cases like a text_changed diff whose bbox and type are
  right but whose text is corrupted (e.g. a digit dropped by span
  fragmentation): lenient treats it as a full match, strict does not.

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

from engines.pdf_comparator import compare_artworks  # noqa: E402

PAIRS_DIR   = Path(__file__).parent / "pairs"
RESULTS_DIR = Path(__file__).parent / "results"

IOU_MATCH_THRESHOLD = 0.10  # generous: dilated pixel-diff contours rarely
                             # tightly bound the original vector shape

METRICS = ("lenient", "strict")


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


def _normalize_text(s: str) -> str:
    """Whitespace-insensitive comparison only — a run of spaces/newlines
    collapses to one space, leading/trailing stripped. Deliberately does
    NOT fix missing/extra characters: 'MOUNJARO é 1  mg' (double space
    where a digit was dropped) must NOT normalize to match '17 mg'."""
    return " ".join((s or "").split())


def _text_matches(expected: dict, detected: dict) -> bool:
    return (
        _normalize_text(expected.get("original_text", "")) == _normalize_text(detected.get("original_text", ""))
        and _normalize_text(expected.get("revised_text", "")) == _normalize_text(detected.get("revised_text", ""))
    )


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


def _bump_type_counts(by_type: dict, match: dict, metric: str) -> None:
    tp_d, fp_d, fn_d = by_type[metric]["tp"], by_type[metric]["fp"], by_type[metric]["fn"]
    for t in match["tp"]:
        typ = t["expected"]["type"]
        if metric == "lenient" or t["text_match"]:
            tp_d[typ] = tp_d.get(typ, 0) + 1
        else:
            fp_d[typ] = fp_d.get(typ, 0) + 1
            fn_d[typ] = fn_d.get(typ, 0) + 1
    for d in match["fp"]:
        fp_d[d["type"]] = fp_d.get(d["type"], 0) + 1
    for e in match["fn"]:
        fn_d[e["type"]] = fn_d.get(e["type"], 0) + 1


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
    by_type = {m: {"tp": {}, "fp": {}, "fn": {}} for m in METRICS}
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
            match = _match(expected, detected)

            for m in METRICS:
                _bump_type_counts(by_type, match, m)

            metrics = {m: _prf1(*_counts(match, strict=(m == "strict"))) for m in METRICS}
            per_pair[pair_id] = {
                "description": gt["description"],
                "ground_truth_status": gt.get("ground_truth_status", "fornecido/gerado — não provisório"),
                "metrics": metrics,
                "false_negatives": match["fn"],
                "false_positives": match["fp"],
                "text_mismatches": [
                    {"expected": t["expected"], "detected": t["detected"]}
                    for t in match["tp"] if not t["text_match"]
                ],
            }

    types = sorted(set(by_type["lenient"]["tp"]) | set(by_type["lenient"]["fp"]) | set(by_type["lenient"]["fn"]))
    by_type_report = {
        m: {t: _prf1(by_type[m]["tp"].get(t, 0), by_type[m]["fp"].get(t, 0), by_type[m]["fn"].get(t, 0))
            for t in types}
        for m in METRICS
    }
    overall = {
        m: _prf1(sum(by_type[m]["tp"].values()), sum(by_type[m]["fp"].values()), sum(by_type[m]["fn"].values()))
        for m in METRICS
    }

    report = {
        "pairs": per_pair,
        "by_type": by_type_report,
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

    print("\n=== Por par (leniente vs. estrita) ===")
    for pair_id, info in report["pairs"].items():
        status = info["ground_truth_status"]
        print(f"  {pair_id} — {info['description']}")
        if "PROVISÓRIO" in status:
            print(f"      [{status}]")
        print(f"      leniente: {_fmt(info['metrics']['lenient'])}")
        print(f"      estrita : {_fmt(info['metrics']['strict'])}")
        for fn in info["false_negatives"]:
            print(f"      MISSED   [{fn['type']}] p{fn['page']} {fn['description']}")
        for fp in info["false_positives"]:
            print(f"      SPURIOUS [{fp['type']}] p{fp['page']} {fp['description']}")
        for tm in info["text_mismatches"]:
            e, d = tm["expected"], tm["detected"]
            print(f"      TEXT MISMATCH [{e['type']}] p{e['page']}: "
                  f"expected old={e.get('original_text','')!r} new={e.get('revised_text','')!r} "
                  f"| got old={d.get('original_text','')!r} new={d.get('revised_text','')!r}")

    print("\n=== Por tipo de divergência (leniente vs. estrita) ===")
    types = sorted(report["by_type"]["lenient"])
    for t in types:
        print(f"  {t:15s} leniente: {_fmt(report['by_type']['lenient'][t])}")
        print(f"  {'':15s} estrita : {_fmt(report['by_type']['strict'][t])}")

    print("\n=== Agregado ===")
    print(f"  leniente: {_fmt(report['overall']['lenient'])}")
    print(f"  estrita : {_fmt(report['overall']['strict'])}")


if __name__ == "__main__":
    _print_report(run())
