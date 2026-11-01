"""
backend/eval/export_report.py

Exports harness.py's aggregate results (per pair, per type, per subtipo,
one-letter-swap detection rate, overall) to CSV and JSON — for the thesis'
Table 2.

Numbers only: precision/recall/F1/tp/fp/fn counts and each pair's short
human-written description (e.g. "Dose sutil (1 caractere): ..." — a label,
not extracted artwork text). Deliberately leaves out the per-pair
false_negatives/false_positives/text_mismatches lists that harness.py's
own report.json carries, since those DO contain original_text/
revised_text snippets straight out of the compared PDFs — safe to keep in
report.json (today's pairs are all public ANVISA bulas), but not
something this export should propagate if the harness is ever pointed at
a real client pair. No PDF is read or copied by this script either.

Run inside Docker, from backend/:
    python -m eval.export_report              # eval/pairs (5 synthetic pairs)
    python -m eval.export_report --manual      # eval/manual_pairs (4 real-edit pairs)
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import eval.harness as harness

EXPORT_DIR = Path(__file__).parent / "exports"


def _write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def _per_pair_rows(report: dict) -> list[dict]:
    rows = []
    for pair_id, info in report["pairs"].items():
        row = {
            "pair_id": pair_id,
            "description": info["description"],
            "gabarito_provisorio": "PROVISÓRIO" in info.get("ground_truth_status", ""),
        }
        for m in harness.METRICS:
            stats = info["metrics"][m]
            for k, v in stats.items():
                row[f"{m}_{k}"] = v
        rows.append(row)
    return rows


def _by_key_rows(report: dict, report_key: str, label: str) -> list[dict]:
    rows = []
    for m in harness.METRICS:
        for key, stats in report[report_key][m].items():
            rows.append({label: key, "metrica": m, **stats})
    return rows


def _one_letter_rows(report: dict) -> list[dict]:
    return [{"metrica": m, **report["one_letter_swap_detection"][m]} for m in harness.METRICS]


def _overall_rows(report: dict) -> list[dict]:
    return [{"metrica": m, **report["overall"][m]} for m in harness.METRICS]


def export(report: dict, out_prefix: str) -> dict[str, Path]:
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)

    por_par      = _per_pair_rows(report)
    por_tipo     = _by_key_rows(report, "by_type", "tipo_interno")
    por_subtipo  = _by_key_rows(report, "by_subtipo", "subtipo")
    troca_1_letra = _one_letter_rows(report)
    agregado     = _overall_rows(report)

    paths = {
        "por_par":      EXPORT_DIR / f"{out_prefix}_por_par.csv",
        "por_tipo":     EXPORT_DIR / f"{out_prefix}_por_tipo.csv",
        "por_subtipo":  EXPORT_DIR / f"{out_prefix}_por_subtipo.csv",
        "troca_1_letra": EXPORT_DIR / f"{out_prefix}_troca_1_letra.csv",
        "agregado":     EXPORT_DIR / f"{out_prefix}_agregado.csv",
        "json":         EXPORT_DIR / f"{out_prefix}.json",
    }

    _write_csv(paths["por_par"],       por_par)
    _write_csv(paths["por_tipo"],      por_tipo)
    _write_csv(paths["por_subtipo"],   por_subtipo)
    _write_csv(paths["troca_1_letra"], troca_1_letra)
    _write_csv(paths["agregado"],      agregado)

    paths["json"].write_text(
        json.dumps({
            "por_par": por_par,
            "por_tipo": por_tipo,
            "por_subtipo": por_subtipo,
            "troca_1_letra": troca_1_letra,
            "agregado": agregado,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return paths


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manual", action="store_true",
        help="export eval/manual_pairs results instead of eval/pairs",
    )
    args = parser.parse_args()

    if args.manual:
        harness.PAIRS_DIR   = Path(__file__).parent / "manual_pairs"
        harness.RESULTS_DIR = Path(__file__).parent / "manual_pairs" / "results"
        prefix = "manual_pairs"
    else:
        prefix = "pairs"

    report = harness.run()
    out_paths = export(report, prefix)
    print(f"Exportado para {EXPORT_DIR}/:")
    for name, path in out_paths.items():
        print(f"  {name}: {path.name}")
