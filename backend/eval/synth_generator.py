"""
backend/eval/synth_generator.py

Builds a small ground-truth test set for the ArtReview comparison core
(engines/pdf_comparator.py) from a single **public** seed document: the
ANVISA patient package insert (bula) for Sonridor Dor e Febre 750 mg,
downloaded from the Bulario Eletronico (public domain regulatory content,
no proprietary/company material involved).

For each pair, "Version A" is the seed PDF (optionally with one earlier
pair's edits already baked in — see PAIRS below) and "Version B" is a copy
of A with a small, deterministic, fully-documented set of edits applied
via PyMuPDF (redact + reinsert for text, redact + insert_image for the
visual case). Every edit is recorded in a ground_truth.json using the same
difference "type" vocabulary compare_artworks() already produces
(text_changed, text_removed, text_added, font_size, font_style, visual),
so the harness (eval/harness.py) can match detections against it directly.

Run (needs only PyMuPDF, no cv2 — safe to run outside Docker):
    python3 eval/synth_generator.py
"""

from __future__ import annotations

import json
from pathlib import Path

import fitz  # PyMuPDF

SEED_PDF = Path(__file__).parent / "seed" / "bula_sonridor_dor_e_febre_750mg.pdf"
OUT_DIR  = Path(__file__).parent / "pairs"


# ── Text-edit helpers ────────────────────────────────────────────────────────────

def _font_for(span: dict, *, bold: bool | None = None, italic: bool | None = None) -> str:
    """Map an extracted PDF span to a PyMuPDF base-14 Times variant.

    The seed uses embedded TrueType Times New Roman; we don't need a
    pixel-perfect font match for synthetic ground truth, just a
    deterministic, visually equivalent stand-in with correct bold/italic
    flags (which is what compare_artworks' font_style check reads).
    """
    is_bold   = bold   if bold   is not None else bool(span["flags"] & (1 << 4))
    is_italic = italic if italic is not None else bool(span["flags"] & (1 << 1))
    if is_bold and is_italic:
        return "Times-BoldItalic"
    if is_bold:
        return "Times-Bold"
    if is_italic:
        return "Times-Italic"
    return "Times-Roman"


def _find_span(page: fitz.Page, needle: str) -> dict:
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                if needle in span["text"]:
                    return span
    raise ValueError(f"span not found on page {page.number}: {needle!r}")


def replace_text(page: fitz.Page, old: str, new: str, *, clip=None,
                  fontsize: float | None = None, bold: bool | None = None,
                  italic: bool | None = None) -> fitz.Rect:
    """Redact `old` and insert `new` in its place, keeping (or overriding)
    the original size/weight/slant. Returns the redacted rect."""
    span = _find_span(page, old)
    rects = page.search_for(old, clip=clip)
    if not rects:
        raise ValueError(f"text not found on page {page.number}: {old!r}")
    rect = rects[0]
    size = fontsize if fontsize is not None else span["size"]
    font = _font_for(span, bold=bold, italic=italic)
    page.add_redact_annot(rect, fill=(1, 1, 1))
    page.apply_redactions()
    if new:
        page.insert_text((rect.x0, rect.y1 - size * 0.2), new, fontsize=size, fontname=font, color=(0, 0, 0))
    return rect


def remove_text(page: fitz.Page, text: str, *, clip=None) -> fitz.Rect:
    rects = page.search_for(text, clip=clip)
    if not rects:
        raise ValueError(f"text not found on page {page.number}: {text!r}")
    rect = rects[0]
    page.add_redact_annot(rect, fill=(1, 1, 1))
    page.apply_redactions()
    return rect


def add_text(page: fitz.Page, text: str, origin: tuple[float, float],
              fontsize: float = 10.0) -> fitz.Rect:
    page.insert_text(origin, text, fontsize=fontsize, fontname="Times-Roman", color=(0, 0, 0))
    rects = page.search_for(text)
    return rects[0] if rects else fitz.Rect(origin[0], origin[1] - fontsize, origin[0] + 200, origin[1] + 2)


def move_page_image(page: fitz.Page, new_rect: fitz.Rect) -> tuple[fitz.Rect, fitz.Rect]:
    """Erase the page's (single) embedded image and reinsert it at
    new_rect. Returns (old_rect, new_rect)."""
    imgs = page.get_images(full=True)
    if not imgs:
        raise ValueError(f"no embedded image on page {page.number}")
    xref = imgs[0][0]
    old_rect = page.get_image_rects(xref)[0]
    pix = fitz.Pixmap(page.parent, xref)
    img_bytes = pix.tobytes("png")
    page.add_redact_annot(old_rect, fill=(1, 1, 1))
    page.apply_redactions()
    page.insert_image(new_rect, stream=img_bytes)
    return old_rect, new_rect


def _rect_list(r: fitz.Rect) -> list:
    return [round(r.x0, 2), round(r.y0, 2), round(r.x1, 2), round(r.y1, 2)]


def _gt(type_: str, page_1idx: int, rect: fitz.Rect, description: str) -> dict:
    return {"type": type_, "page": page_1idx, "bbox": _rect_list(rect), "description": description}


# ── Pair definitions ─────────────────────────────────────────────────────────────
# Page indices below are 0-based (fitz); ground truth "page" is 1-based to
# match compare_artworks' own output convention.

def build_pair_1(doc: fitz.Document) -> list[dict]:
    """Dose changed on the cover page: pure text_changed."""
    page = doc[0]
    rect = replace_text(page, "paracetamol 750 mg", "paracetamol 500 mg")
    return [_gt("text_changed", 1, rect, "Dose alterada de 750 mg para 500 mg na capa")]


def build_pair_2(doc: fitz.Document) -> list[dict]:
    """Font-only edits on page 2 (index 1): font_style + font_size."""
    page = doc[1]
    r1 = replace_text(page, "USO ADULTO E PEDIÁTRICO ACIMA DE 12 ANOS",
                       "USO ADULTO E PEDIÁTRICO ACIMA DE 12 ANOS", bold=False)
    r2 = replace_text(page, "COMPOSIÇÃO", "COMPOSIÇÃO", fontsize=14.0)
    return [
        _gt("font_style", 2, r1, "Título de seção deixou de ser negrito"),
        _gt("font_size", 2, r2, "Título 'COMPOSIÇÃO' aumentado de 10pt para 14pt"),
    ]


def build_pair_3(doc: fitz.Document) -> list[dict]:
    """Pure visual edit: the recycling logo on page 4 (index 3) moved and
    resized (33.75x28.5pt -> 54x45.6pt, shifted ~+295pt/+51pt)."""
    page = doc[3]
    old_rect, new_rect = move_page_image(page, fitz.Rect(380, 420, 434, 465.6))
    return [
        _gt("visual", 4, old_rect, "Selo/logo removido da posição original"),
        _gt("visual", 4, new_rect, "Selo/logo reaparece deslocado e redimensionado"),
    ]


def build_pair_4(doc: fitz.Document) -> list[dict]:
    """Text add/remove/change combo on page 2 (index 1)."""
    page = doc[1]
    r1 = replace_text(
        page, "Comprimidos de 750 mg: embalagens com 20 e 50 comprimidos.",
        "Comprimidos de 500 mg: embalagens com 20 e 50 comprimidos.",
    )
    r2 = remove_text(page, "USO ORAL")
    r3 = add_text(page, "Contraindicado para gestantes no primeiro trimestre.", (85, 800))
    return [
        _gt("text_changed", 2, r1, "Dose alterada de 750 mg para 500 mg nas apresentações"),
        _gt("text_removed", 2, r2, "Aviso 'USO ORAL' removido"),
        _gt("text_added", 2, r3, "Frase de contraindicação adicionada sem previsão no original"),
    ]


def build_pair_5(doc: fitz.Document) -> list[dict]:
    """Combined case: text + font + visual together in one comparison."""
    gt = []
    p0 = doc[0]
    r0 = replace_text(p0, "paracetamol 750 mg", "paracetamol 500 mg")
    gt.append(_gt("text_changed", 1, r0, "Dose alterada de 750 mg para 500 mg na capa"))

    p1 = doc[1]
    r1 = replace_text(p1, "COMPOSIÇÃO", "COMPOSIÇÃO", fontsize=14.0)
    gt.append(_gt("font_size", 2, r1, "Título 'COMPOSIÇÃO' aumentado de 10pt para 14pt"))

    p3 = doc[3]
    old_rect, new_rect = move_page_image(p3, fitz.Rect(380, 420, 434, 465.6))
    gt.append(_gt("visual", 4, old_rect, "Selo/logo removido da posição original"))
    gt.append(_gt("visual", 4, new_rect, "Selo/logo reaparece deslocado e redimensionado"))
    return gt


PAIRS = {
    "pair1_dose_text_change":     ("Alteração de dose (texto puro)",            build_pair_1),
    "pair2_font_changes":         ("Mudança de negrito e tamanho de fonte",     build_pair_2),
    "pair3_visual_image_move":    ("Selo/logo movido e redimensionado (visual puro)", build_pair_3),
    "pair4_text_add_remove":      ("Texto alterado, removido e adicionado",     build_pair_4),
    "pair5_combined":             ("Texto + fonte + visual combinados",          build_pair_5),
}


def main() -> None:
    if not SEED_PDF.exists():
        raise SystemExit(f"seed PDF not found: {SEED_PDF}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []

    for pair_id, (description, builder) in PAIRS.items():
        pair_dir = OUT_DIR / pair_id
        pair_dir.mkdir(exist_ok=True)

        a_path = pair_dir / "A.pdf"
        b_path = pair_dir / "B.pdf"

        doc_a = fitz.open(SEED_PDF)
        doc_a.save(a_path)
        doc_a.close()

        doc_b = fitz.open(SEED_PDF)
        expected = builder(doc_b)
        doc_b.save(b_path)
        doc_b.close()

        gt = {
            "pair_id": pair_id,
            "description": description,
            "seed_pdf": "Bulário Eletrônico ANVISA — Sonridor Dor e Febre 750 mg (domínio público)",
            "original_pdf": str(a_path.relative_to(OUT_DIR.parent)),
            "revised_pdf": str(b_path.relative_to(OUT_DIR.parent)),
            "expected_differences": expected,
        }
        (pair_dir / "ground_truth.json").write_text(json.dumps(gt, ensure_ascii=False, indent=2))
        manifest.append(pair_id)
        print(f"[ok] {pair_id}: {len(expected)} expected difference(s) -> {pair_dir}")

    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\n{len(manifest)} pares gerados em {OUT_DIR}")


if __name__ == "__main__":
    main()
