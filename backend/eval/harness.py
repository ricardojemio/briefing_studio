"""
backend/eval/harness.py

Evaluation harness for the ArtReview comparison core.

Runs engines.pdf_comparator.compare_artworks() over every synthetic pair
produced by eval/synth_generator.py, matches detected differences against
each pair's ground_truth.json, and reports precision / recall / F1 per
difference type and in aggregate.

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


def _flatten_detections(result: dict) -> list[dict]:
    out = []
    for page in result["pages"]:
        for d in page["differences"]:
            out.append({"type": d["type"], "page": d["page"], "bbox": d["bbox"], "description": d["description"]})
    return out


def _match(expected: list[dict], detected: list[dict]) -> dict:
    """Greedy IoU matching, highest-overlap first, gated on type+page match.
    Returns {"tp": [...], "fn": [...], "fp": [...]} of the original dicts,
    each augmented with its counterpart when matched."""
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
        tp.append({"expected": expected[ei], "detected": detected[di], "iou": round(score, 3)})

    fn = [expected[i] for i in range(len(expected)) if i not in matched_e]
    fp = [detected[i] for i in range(len(detected)) if i not in matched_d]
    return {"tp": tp, "fn": fn, "fp": fp}


def _prf1(tp: int, fp: int, fn: int) -> dict:
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall    = tp / (tp + fn) if (tp + fn) else 0.0
    f1        = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    return {"precision": round(precision, 3), "recall": round(recall, 3), "f1": round(f1, 3),
            "tp": tp, "fp": fp, "fn": fn}


def run() -> dict:
    manifest_path = PAIRS_DIR / "manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"no pairs found — run synth_generator.py first (expected {manifest_path})")
    pair_ids = json.loads(manifest_path.read_text())

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    per_pair = {}
    all_tp_by_type: dict[str, int] = {}
    all_fp_by_type: dict[str, int] = {}
    all_fn_by_type: dict[str, int] = {}
    alignment_log = []

    with tempfile.TemporaryDirectory() as preview_dir:
        for pair_id in pair_ids:
            pair_dir = PAIRS_DIR / pair_id
            gt = json.loads((pair_dir / "ground_truth.json").read_text())
            expected = gt["expected_differences"]

            result = compare_artworks(
                original_pdf_path=str(PAIRS_DIR.parent / gt["original_pdf"]),
                revised_pdf_path=str(PAIRS_DIR.parent / gt["revised_pdf"]),
                dpi=150,
                preview_dir=preview_dir,
                comparison_id=pair_id,
            )
            for page in result["pages"]:
                alignment_log.append({"pair": pair_id, "page": page["page_num"], **page["alignment"]})

            detected = _flatten_detections(result)
            match = _match(expected, detected)

            for t in match["tp"]:
                typ = t["expected"]["type"]
                all_tp_by_type[typ] = all_tp_by_type.get(typ, 0) + 1
            for d in match["fp"]:
                all_fp_by_type[d["type"]] = all_fp_by_type.get(d["type"], 0) + 1
            for e in match["fn"]:
                all_fn_by_type[e["type"]] = all_fn_by_type.get(e["type"], 0) + 1

            pair_metrics = _prf1(len(match["tp"]), len(match["fp"]), len(match["fn"]))
            per_pair[pair_id] = {
                "description": gt["description"],
                "metrics": pair_metrics,
                "false_negatives": match["fn"],
                "false_positives": match["fp"],
            }

    types = sorted(set(all_tp_by_type) | set(all_fp_by_type) | set(all_fn_by_type))
    by_type = {
        t: _prf1(all_tp_by_type.get(t, 0), all_fp_by_type.get(t, 0), all_fn_by_type.get(t, 0))
        for t in types
    }
    overall = _prf1(sum(all_tp_by_type.values()), sum(all_fp_by_type.values()), sum(all_fn_by_type.values()))

    report = {
        "pairs": per_pair,
        "by_type": by_type,
        "overall": overall,
        "alignment": alignment_log,
    }
    (RESULTS_DIR / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    return report


def _print_report(report: dict) -> None:
    print("\n=== Alinhamento (ORB) por página ===")
    for a in report["alignment"]:
        print(f"  {a['pair']} p{a['page']}: method={a['method']} "
              f"kp_orig={a['keypoints_orig']} kp_rev={a['keypoints_rev']} "
              f"good_matches={a['good_matches']} inliers={a['inliers']}")

    print("\n=== Por par ===")
    for pair_id, info in report["pairs"].items():
        m = info["metrics"]
        print(f"  {pair_id:30s} P={m['precision']:.2f} R={m['recall']:.2f} F1={m['f1']:.2f} "
              f"(tp={m['tp']} fp={m['fp']} fn={m['fn']})  — {info['description']}")
        for fn in info["false_negatives"]:
            print(f"      MISSED  [{fn['type']}] p{fn['page']} {fn['description']}")
        for fp in info["false_positives"]:
            print(f"      SPURIOUS[{fp['type']}] p{fp['page']} {fp['description']}")

    print("\n=== Por tipo de divergência ===")
    for t, m in report["by_type"].items():
        print(f"  {t:15s} P={m['precision']:.2f} R={m['recall']:.2f} F1={m['f1']:.2f} "
              f"(tp={m['tp']} fp={m['fp']} fn={m['fn']})")

    o = report["overall"]
    print(f"\n=== Agregado ===\nP={o['precision']:.3f}  R={o['recall']:.3f}  F1={o['f1']:.3f} "
          f"(tp={o['tp']} fp={o['fp']} fn={o['fn']})")


if __name__ == "__main__":
    _print_report(run())
