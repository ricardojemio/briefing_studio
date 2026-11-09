"""
backend/eval/run_altered_pairs.py

Runs compare_artworks() against the "pares alterados" (real client
artwork pairs, under backend/eval/fixtures_alterados/ — gitignored,
never committed) and scores it against gabarito_alteracoes.json, reusing
harness.py's exact matching/scoring logic (IoU threshold, greedy
assignment, lenient/normalized/strict text matching, P/R/F1) completely
unchanged — same as run_manual_pairs.py does for the 4 manual pairs.

gabarito_alteracoes.json uses a DIFFERENT schema from the harness's own
ground_truth.json (keys: tipo, tipo_diff_esperado, pagina, original,
revisado, bbox_pt per product, not expected_differences[]). This script
converts it to harness's expected-difference shape, assigning each
converted entry the internal `type` compare_artworks would itself use
(so _match's type-equality gate is meaningful) and then classifying both
expected and detected differences with pdf_comparator._taxonomy() for a
per-category (Texto/Medida-dose/Código/Imagem) breakdown — the SAME
taxonomy function used everywhere else in this project.

PDF pairing: scans --pairs-dir for "*_Original.pdf" / "*_ALTERADO.pdf",
pairs them by base name, then maps each base name to a gabarito product
key by normalized substring match (e.g. "DomperidonaRanbaxy" ->
"Domperidona"). No filename needs to match exactly.

Neither the PDFs nor gabarito_alteracoes.json are ever committed to this
repo (real client artwork) — backend/eval/fixtures_alterados/ is in
.gitignore.

Run inside Docker, from backend/:
    python -m eval.run_altered_pairs \\
        --gabarito eval/fixtures_alterados/gabarito_alteracoes.json \\
        --pairs-dir eval/fixtures_alterados
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import eval.harness as harness
from engines.pdf_comparator import EAN_RE, compare_artworks, _taxonomy

# ── Gabarito -> harness expected-difference conversion ──────────────────────────────

def _internal_type_for(entry: dict) -> str:
    """Which compare_artworks `type` a gabarito entry would show up as —
    needed because _match()/_match_normalized() gate on type equality."""
    tipo = entry["tipo"]
    original, revisado = entry.get("original", ""), entry.get("revisado", "")
    if tipo == "ALTERACAO_VISUAL":
        return "visual"
    if tipo == "REMOCAO" or (revisado == "" and original != ""):
        return "text_removed"
    if tipo in ("SUBSTITUICAO_NUMERO", "ERRO_ORTOGRAFICO", "ALTERACAO_CODIGO"):
        if EAN_RE.search(original) or EAN_RE.search(revisado):
            return "ean_changed"
        return "text_changed"
    return "text_changed"


def _to_expected(entry: dict) -> dict:
    internal_type = _internal_type_for(entry)
    original, revisado = entry.get("original", ""), entry.get("revisado", "")
    # Visual diffs are never backed by extracted text -- compare_artworks
    # always emits original_text="" / revised_text="" for a "visual" diff
    # (pixel comparison, not text extraction). The gabarito's own
    # original/revisado fields for an ALTERACAO_VISUAL entry are a
    # human-written description ("(area em branco)" -> "caixa laranja
    # 60x16 pt"), not text the system could ever produce, so comparing
    # it as text would always fail regardless of how correct the
    # detection is. Keep the description, drop it as a text comparand
    # (harness._is_textless_type() also guards this independently).
    if internal_type == "visual":
        original_text, revised_text = "", ""
    else:
        original_text, revised_text = original, revisado
    return {
        "type":          internal_type,
        "page":          entry["pagina"],
        "bbox":          entry["bbox_pt"],
        "original_text": original_text,
        "revised_text":  revised_text,
        "description":   f"{entry['tipo']}: {original!r} -> {revisado!r}",
        "gabarito_tipo": entry["tipo"],
    }


# ── Category grouping for the report (Texto / Medida-dose / Código / Imagem) ────────

def _category(d: dict) -> str:
    """Groups pdf_comparator._taxonomy()'s 8 subtipos into the 4 top-level
    categories this report is organised by. This is what the comparator's
    DETECTED output actually looks like -- used for the detected side
    (false positives, and the detected half of the confusion matrix).
    It is NOT used for the expected/gabarito side anymore; see
    _expected_category_from_gabarito_tipo()."""
    _, subtipo = _taxonomy(d)
    if subtipo in ("Visual", "Imagem"):
        return "Imagem"
    if subtipo == "Código":
        return "Código"
    if subtipo == "Medida/dose":
        return "Medida/dose"
    return "Texto"  # Substituição, Ausência, Adição, Estilo da fonte, Conformidade, Outro


_GABARITO_TIPO_TO_CATEGORY = {
    "SUBSTITUICAO_NUMERO": "Medida/dose",
    "ERRO_ORTOGRAFICO":    "Texto",
    "REMOCAO":             "Texto",
    "ALTERACAO_VISUAL":    "Imagem",
    "ALTERACAO_CODIGO":    "Código",
}


def _expected_category_from_gabarito_tipo(gabarito_tipo: str) -> str:
    """Expected-side category, read directly off the gabarito's own
    "tipo" field -- NOT re-inferred from its (often phrase-level) text via
    _taxonomy()'s MEASURE_RE heuristic. MEASURE_RE only recognises a bare
    number plus a short, fixed unit list; most real dose/quantity
    gabarito entries ("6 a 8 horas", "20 comprimidos", "durante 3 dias")
    don't match it and were falling back to "Texto" even though the
    gabarito itself labels them SUBSTITUICAO_NUMERO. Using the gabarito's
    own label instead removes that undercount without touching the
    gabarito file or any comparator threshold -- see item 1's diagnosis
    (investigations/altered_pairs_category_mismatch/README.md). The
    detected side keeps using _category()/_taxonomy(), since that's what
    the comparator itself actually produced; divergences between the two
    are reported separately as a confusion matrix, not folded into this
    mapping."""
    return _GABARITO_TIPO_TO_CATEGORY[gabarito_tipo]


# ── PDF discovery: pair *_Original.pdf with *_ALTERADO.pdf by base name ─────────────

def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _discover_pairs(pairs_dir: Path) -> dict[str, tuple[Path, Path]]:
    originals = {p.name[: -len("_Original.pdf")]: p for p in pairs_dir.glob("*_Original.pdf")}
    altered   = {p.name[: -len("_ALTERADO.pdf")]: p for p in pairs_dir.glob("*_ALTERADO.pdf")}
    return {base: (orig, altered[base]) for base, orig in originals.items() if base in altered}


def _match_product_key(base_name: str, gabarito_keys: list[str]) -> str | None:
    norm_base = _norm(base_name)
    for key in gabarito_keys:
        norm_key = _norm(key)
        if norm_key in norm_base or norm_base in norm_key:
            return key
    return None


# ── Main evaluation ──────────────────────────────────────────────────────────────────

def run(gabarito_path: Path, pairs_dir: Path, only_products: set[str] | None = None) -> dict:
    """only_products restricts which gabarito keys are processed at all
    (by_category/overall are computed only over them) — used to produce
    a "4 bulas" aggregate and a separate CLIENT_PRODUCT_2 Foil (proprietary, not in
    the article) aggregate from the same gabarito without double-counting."""
    gabarito = json.loads(gabarito_path.read_text(encoding="utf-8"))
    if only_products is not None:
        gabarito = {k: v for k, v in gabarito.items() if k in only_products}
    discovered = _discover_pairs(pairs_dir)

    key_to_paths: dict[str, tuple[Path, Path]] = {}
    unmatched_files: list[str] = []
    for base_name, paths in discovered.items():
        key = _match_product_key(base_name, list(gabarito.keys()))
        if key:
            key_to_paths[key] = paths
        else:
            unmatched_files.append(base_name)

    per_pair: dict[str, dict] = {}
    by_category = {m: {"tp": {}, "fp": {}, "fn": {}} for m in harness.METRICS}
    category_confusion: dict[str, dict[str, int]] = {}
    skipped: list[str] = []

    with tempfile.TemporaryDirectory() as preview_dir:
        for product, data in gabarito.items():
            if product not in key_to_paths:
                skipped.append(product)
                continue
            orig_path, alt_path = key_to_paths[product]

            expected = [_to_expected(e) for e in data["mudancas_esperadas"]]
            result = compare_artworks(
                original_pdf_path=str(orig_path),
                revised_pdf_path=str(alt_path),
                dpi=150,
                preview_dir=preview_dir,
                comparison_id=product,
            )
            detected = harness._flatten_detections(result)
            matches = {
                "exact":      harness._match(expected, detected),
                "normalized": harness._match_normalized(expected, detected),
            }

            # RULE (by_category attribution): TP and FN always count in the
            # EXPECTED category (the gabarito's own "tipo") — an FN has no
            # detected side to begin with, and a TP's correctness is about
            # whether the real edit was found, not about which category
            # label the comparator's own output happens to carry. FP (a
            # detection with no matching expected change) counts in the
            # DETECTED category — there IS no expected side for it.
            # A TP whose expected and detected categories diverge (e.g.
            # CodigoMS's "MS 1.0367.0013"->"MS 1.0367.0031": gabarito says
            # Código, but the comparator's word-level diff drops the "MS "
            # prefix and reports a bare number that doesn't match EAN_RE,
            # so _taxonomy() calls it Texto) still counts as ONE tp in the
            # expected category — never as an extra fp in the detected one
            # — and the divergence is recorded separately in
            # category_confusion (below), never folded into tp/fp/fn.
            # Only a genuine TEXT mismatch under strict/strict_normalized
            # demotes a TP into 1 fp + 1 fn, and that demotion also stays
            # in the EXPECTED category (strict is about whether the right
            # content was reported for the right edit, not a second
            # categorization event).
            #
            # This keeps sum(by_category[m][*].values()) == overall[m] by
            # construction, for every m in harness.METRICS — see the
            # consistency test in
            # tests/test_altered_pairs_category_consistency.py and
            # investigations/altered_pairs_category_consistency/README.md.
            for m in harness.METRICS:
                kind, strict = harness.METRIC_SPECS[m]
                match = matches[kind]
                tp_d, fp_d, fn_d = by_category[m]["tp"], by_category[m]["fp"], by_category[m]["fn"]
                for t in match["tp"]:
                    cat = _expected_category_from_gabarito_tipo(t["expected"]["gabarito_tipo"])
                    if not strict or t["text_match"]:
                        tp_d[cat] = tp_d.get(cat, 0) + 1
                    else:
                        fp_d[cat] = fp_d.get(cat, 0) + 1
                        fn_d[cat] = fn_d.get(cat, 0) + 1
                for d in match["fp"]:
                    fp_d[_category(d)] = fp_d.get(_category(d), 0) + 1
                for e in match["fn"]:
                    fn_d[_expected_category_from_gabarito_tipo(e["gabarito_tipo"])] = (
                        fn_d.get(_expected_category_from_gabarito_tipo(e["gabarito_tipo"]), 0) + 1
                    )

            # Confusion matrix: expected category (gabarito's own "tipo")
            # vs. detected category (_taxonomy() on what the comparator
            # actually produced), computed once over lenient_normalized's
            # TPs (bbox+page+type match regardless of text) -- reported
            # separately from the P/R/F1 table above, never folded into
            # it, per item 2.
            for t in matches["normalized"]["tp"]:
                exp_cat = _expected_category_from_gabarito_tipo(t["expected"]["gabarito_tipo"])
                det_cat = _category(t["detected"])
                if exp_cat != det_cat:
                    row = category_confusion.setdefault(exp_cat, {})
                    row[det_cat] = row.get(det_cat, 0) + 1

            metrics = {
                m: harness._prf1(*harness._counts(matches[harness.METRIC_SPECS[m][0]], strict=harness.METRIC_SPECS[m][1]))
                for m in harness.METRICS
            }
            per_pair[product] = {
                "n_expected": len(expected),
                "n_detected": len(detected),
                "metrics": metrics,
                "false_negatives": [
                    {**e, "categoria": _expected_category_from_gabarito_tipo(e["gabarito_tipo"])}
                    for e in matches["normalized"]["fn"]
                ],
                "false_positives": [
                    {**d, "categoria": _category(d)} for d in matches["normalized"]["fp"]
                ],
                # Strict-only: bbox matched (lenient_normalized TP) but text
                # didn't — _counts() demotes each of these into one FP + one
                # FN for the strict metrics, so they belong in this report
                # too, not just the lenient-unmatched lists above.
                "text_mismatches": [
                    {
                        "categoria":    _expected_category_from_gabarito_tipo(t["expected"]["gabarito_tipo"]),
                        "page":         t["expected"]["page"],
                        "original_text": t["expected"].get("original_text", ""),
                        "revised_text":  t["expected"].get("revised_text", ""),
                        "detected_original_text": t["detected"].get("original_text", ""),
                        "detected_revised_text":  t["detected"].get("revised_text", ""),
                    }
                    for t in matches["normalized"]["tp"] if not t["text_match"]
                ],
            }

    categories = sorted(set(by_category["lenient"]["tp"]) | set(by_category["lenient"]["fp"]) | set(by_category["lenient"]["fn"]))
    by_category_report = {
        m: {c: harness._prf1(by_category[m]["tp"].get(c, 0), by_category[m]["fp"].get(c, 0), by_category[m]["fn"].get(c, 0))
            for c in categories}
        for m in harness.METRICS
    }
    overall = {
        m: harness._prf1(sum(by_category[m]["tp"].values()), sum(by_category[m]["fp"].values()), sum(by_category[m]["fn"].values()))
        for m in harness.METRICS
    }

    return {
        "pairs": per_pair, "by_category": by_category_report, "overall": overall,
        "category_confusion": category_confusion,
        "skipped": skipped, "unmatched_files": unmatched_files,
    }


def _guess_cause_fn(categoria: str) -> str:
    if categoria == "Imagem":
        return "possível supressão por linha de texto próxima, ou abaixo do limiar de área/contraste do diff de pixels"
    if categoria == "Código":
        return "número pode não bater o padrão EAN-8/13 da regex, ou mudou fora do padrão esperado"
    return "edição não reconstruída pelo diff de linha/palavra (ver granularidade, item A) ou página/posição não bate"


def _guess_cause_fp(categoria: str) -> str:
    if categoria == "Imagem":
        return "ruído de registro/antialiasing do diff de pixels, não suprimido por estar longe de qualquer edição de texto"
    return "fragmento de edição de texto não coberto pelo gabarito (ex. efeito colateral de uma correção em outro ponto da linha)"


def _print_report(report: dict) -> None:
    if report["skipped"]:
        print(f"\n⚠ pares do gabarito sem PDF correspondente: {report['skipped']}")
    if report["unmatched_files"]:
        print(f"⚠ pares de PDF encontrados sem chave no gabarito: {report['unmatched_files']}")

    print("\n=== Por par ===")
    for product, info in report["pairs"].items():
        print(f"  {product}: {info['n_expected']} esperadas, {info['n_detected']} detectadas")
        for m in harness.METRICS:
            print(f"    {m:20s}: {harness._fmt(info['metrics'][m])}")
        for fn in info["false_negatives"]:
            print(f"    FN [{fn['categoria']}] p{fn['page']} {fn.get('original_text','')!r}->{fn.get('revised_text','')!r}"
                  f" | causa provável: {_guess_cause_fn(fn['categoria'])}")
        for fp in info["false_positives"]:
            print(f"    FP [{fp['categoria']}] p{fp['page']} {fp.get('original_text','')!r}->{fp.get('revised_text','')!r}"
                  f" | causa provável: {_guess_cause_fp(fp['categoria'])}")
        for tm in info["text_mismatches"]:
            print(f"    TEXT MISMATCH (estrita) [{tm['categoria']}] p{tm['page']}: "
                  f"esperado {tm['original_text']!r}->{tm['revised_text']!r} | "
                  f"detectado {tm['detected_original_text']!r}->{tm['detected_revised_text']!r} "
                  f"| causa provável: bbox bateu mas o texto exato divergiu — granularidade/normalização (item A)")

    print("\n=== Por categoria (Texto / Medida-dose / Código / Imagem) ===")
    for cat in sorted(report["by_category"]["lenient"]):
        for m in harness.METRICS:
            print(f"  {cat:12s} {m:20s}: {harness._fmt(report['by_category'][m][cat])}")

    print("\n=== Agregado ===")
    for m in harness.METRICS:
        print(f"  {m:20s}: {harness._fmt(report['overall'][m])}")

    print("\n=== Matriz de confusão por categoria (esperado x detectado, só onde divergem) ===")
    if not report["category_confusion"]:
        print("  (nenhuma divergência — categoria detectada bate com a esperada em todos os TPs)")
    for exp_cat, row in sorted(report["category_confusion"].items()):
        for det_cat, count in sorted(row.items()):
            print(f"  esperado={exp_cat:12s} detectado={det_cat:12s} n={count}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gabarito", required=True, type=Path)
    parser.add_argument("--pairs-dir", required=True, type=Path)
    args = parser.parse_args()

    report = run(args.gabarito, args.pairs_dir)
    _print_report(report)

    # This report's false_negatives/false_positives/text_mismatches carry
    # raw original_text/revised_text straight from real client artwork —
    # it must NEVER be written inside this repo (backend/eval/exports/ is
    # committed to git). Written next to the gabarito instead, outside the
    # repo, for local debugging only. The numbers-only CSV/JSON meant for
    # the article's Table 2 comes from eval/export_report.py's sanitized
    # output, not from this file.
    out_path = args.gabarito.parent / "altered_pairs_report_DETAILED_DO_NOT_COMMIT.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nRelatório detalhado (com texto real, NÃO versionar) em {out_path}")
