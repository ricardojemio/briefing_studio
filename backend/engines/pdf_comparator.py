"""
backend/engines/pdf_comparator.py

Automated pharmaceutical artwork comparison engine.
Detects text, code (EAN, via digit-pattern matching on extracted text —
not real barcode decoding), visual (ORB + homography registration ahead
of pixel diffing), and dimensional differences between two PDF files.

DO NOT MODIFY: pdf_draft_engine.py, raster_engine_v3.py, draft_engine.py, detector.py
"""

from __future__ import annotations

import difflib
import re
import uuid
from pathlib import Path
from typing import Optional

import cv2
import fitz  # PyMuPDF
import numpy as np

# ── Constants ─────────────────────────────────────────────────────────────────────

PT_TO_MM = 0.352778          # 1 PDF point = 0.352778 mm

EAN_RE          = re.compile(r'\b(\d{8}|\d{13})\b')
# NOTE: PharmaCode detection is out of scope for the comparison core — a
# previous unused PHARMACODE_RE regex was removed rather than left dead.
# Real PharmaCode support needs barcode decoding (e.g. pyzbar), not a
# digit-count regex over extracted text.

MIN_FONT_PT          = 6.0   # compliance: text below this is flagged
TEXT_PROXIMITY_PT    = 5.0   # spans within this distance are candidate matches
TEXT_SIZE_DELTA_PT   = 0.5   # font size change threshold
COLOR_DE_THRESHOLD   = 2.0   # CIE76 Delta-E threshold for colour change
DIM_DELTA_MM         = 0.5   # page size change threshold in mm
VISUAL_THRESHOLD     = 30    # pixel intensity diff (0–255)
VISUAL_MIN_AREA_PX2  = 100   # min contour area (px²) to report as visual diff
VISUAL_DILATE_PX     = 5     # dilation kernel size for merging nearby diff pixels

# ── Line-level text diff (word-token based) ─────────────────────────────────────────
# Text content diffing is done on get_text("words") grouped into physical
# lines by y-coordinate — NOT on get_text("dict") spans grouped by their
# position in the extraction list. See _words_from_page/_group_words_into_lines
# for why: a redact()+insert_text() patch (the standard way to edit a
# single word/character in an existing PDF) can split one visual line into
# several spans and/or relocate the edited span far from its original
# index in PyMuPDF's extraction order, even though its on-page (x, y)
# position stays correct. Span-level matching handles the relocation fine
# (c7528fc fixed that), but it can't reassemble 2-3 disjoint span
# fragments back into "this together is the one line that changed" —
# geometrically they're disjoint boxes. Words are pre-tokenized at
# whitespace boundaries by PyMuPDF itself, so reassembling a line's text
# only needs position-based ordering + one gap check per adjacent pair
# (see _join_words) — no per-span spacing to guess.
LINE_Y_TOLERANCE_PT = 3.0   # pt: words within this y0 distance are the same physical line
WORD_GAP_MERGE_PT   = 1.0   # pt: a gap this small between adjacent word-tokens means they
                            # were one word split by the edit (e.g. "1"+"7" -> "17"), not
                            # two separate words — join with no space instead of one

# Minimum text similarity (see _text_similarity) required for two LINES to
# be matched by _best_iou_match, on top of its geometric gate. Pure
# geometric matching assumes an edit never shifts other content — true for
# a redact()+insert_text() patch, false for a real line removal that makes
# everything below it reflow upward: the line that reflows into the
# deleted line's old slot then has near-total bbox overlap with it, so
# geometry alone pairs them as a "change" and the actual removal is lost
# (see backend/eval/investigations/removal_not_reported_reflow/). Content
# similarity is the only signal that can tell "same line, lightly edited"
# apart from "unrelated line that moved here". Calibrated against real
# manual_pairs edits (0.67–0.98 word/char ratio) vs. an unrelated-line
# collision (0.00 word / 0.34 char ratio) — see that investigation note.
LINE_TEXT_SIM_MIN = 0.5

# ── Image registration (ORB + homography) ──────────────────────────────────────────
# ORB is used instead of SIFT/SURF because it is patent-free and ships in the
# opencv-python-headless "main" module (no opencv-contrib dependency needed).
ORB_N_FEATURES           = 5000
ORB_MIN_MATCHES          = 15   # below this, alignment is considered unreliable
ORB_LOWE_RATIO           = 0.75
ORB_RANSAC_REPROJ_THRESH = 5.0  # px, at the comparison DPI


# ── Internal helpers ──────────────────────────────────────────────────────────────

def _spans_from_page(page) -> list[dict]:
    """Extract all non-empty text spans from a PyMuPDF page."""
    spans: list[dict] = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text", "").strip()
                if not text:
                    continue
                spans.append({
                    "text":  text,
                    "bbox":  tuple(float(v) for v in span["bbox"]),
                    "size":  float(span.get("size", 0.0)),
                    "font":  span.get("font", ""),
                    "color": int(span.get("color", 0)),
                    "flags": int(span.get("flags", 0)),
                })
    return spans


def _bboxes_overlap(b1: tuple, b2: tuple, pad: float = TEXT_PROXIMITY_PT) -> bool:
    """True if two bboxes (x0,y0,x1,y1) overlap when each is expanded by pad."""
    return (
        b1[0] - pad <= b2[2] and b1[2] + pad >= b2[0] and
        b1[1] - pad <= b2[3] and b1[3] + pad >= b2[1]
    )


def _color_to_lab(color_int: int) -> tuple[float, float, float]:
    """Convert PyMuPDF 24-bit RGB integer to CIE Lab."""
    r = (color_int >> 16) & 0xFF
    g = (color_int >> 8)  & 0xFF
    b =  color_int        & 0xFF
    bgr = np.array([[[b, g, r]]], dtype=np.uint8)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    return (float(lab[0, 0, 0]), float(lab[0, 0, 1]), float(lab[0, 0, 2]))


def _delta_e(lab1: tuple, lab2: tuple) -> float:
    """CIE76 Delta-E (Euclidean distance in Lab space)."""
    return sum((a - b) ** 2 for a, b in zip(lab1, lab2)) ** 0.5


def _render_page_bgr(page, dpi: int) -> np.ndarray:
    """Render a PDF page to a BGR numpy array at the given DPI."""
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def _save_png(img: np.ndarray, path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(path, img)


def _next_id(counter: list[int]) -> str:
    counter[0] += 1
    return f"diff_{counter[0]:03d}"


def _font_bold(flags: int) -> bool:
    return bool(flags & (1 << 4))


def _font_italic(flags: int) -> bool:
    return bool(flags & (1 << 1))


_SPEC_PATTERNS = [
    r'^Body Text Size',
    r'^Smallest Text Size',
    r'^Material Spec',
    r'^Technical Drawing',
    r'^Studio Location',
    r'^Manufacturing Site',
    r'^Approving Market',
    r'^Component No',
    r'^AWP No',
]

def _is_regulatory_text(text: str) -> bool:
    t = text.strip()
    if not t: return False
    if re.match(r'^\d+%$', t): return False
    if re.match(r'^\d+(\.\d+)?$', t): return False
    if len(t) <= 2: return False
    if not re.search(r'[a-zA-ZÀ-ÿ]', t): return False
    if any(re.match(p, t) for p in _SPEC_PATTERNS): return False
    return True


def _fallback_resize(img_orig_bgr: np.ndarray, img_rev_bgr: np.ndarray) -> np.ndarray:
    """Naive resize to the original's shape. Used only when feature-based
    registration cannot find a reliable homography."""
    if img_orig_bgr.shape == img_rev_bgr.shape:
        return img_rev_bgr
    return cv2.resize(
        img_rev_bgr,
        (img_orig_bgr.shape[1], img_orig_bgr.shape[0]),
        interpolation=cv2.INTER_LINEAR,
    )


def _align_revised_to_original(
    img_orig_bgr: np.ndarray, img_rev_bgr: np.ndarray
) -> tuple[np.ndarray, dict]:
    """
    Register the revised page raster onto the original's pixel grid using
    ORB feature matching + a RANSAC-estimated homography, so that downstream
    pixel-diffing reflects genuine content changes rather than scan/print
    registration drift (translation, rotation, small scale differences).

    Falls back to a plain resize (previous behaviour) when there aren't
    enough reliable feature correspondences to trust a homography — e.g.
    near-blank pages, or pages so different that ORB can't find a
    consistent geometric transform.

    Returns (aligned_rev_bgr, info) where info documents which path was
    taken, for observability/debugging.
    """
    info = {"method": "resize_fallback", "keypoints_orig": 0, "keypoints_rev": 0,
            "good_matches": 0, "inliers": 0}

    gray_orig = cv2.cvtColor(img_orig_bgr, cv2.COLOR_BGR2GRAY)
    gray_rev  = cv2.cvtColor(img_rev_bgr,  cv2.COLOR_BGR2GRAY)

    orb = cv2.ORB_create(nfeatures=ORB_N_FEATURES)
    kp_o, des_o = orb.detectAndCompute(gray_orig, None)
    kp_r, des_r = orb.detectAndCompute(gray_rev, None)
    info["keypoints_orig"] = len(kp_o) if kp_o else 0
    info["keypoints_rev"]  = len(kp_r) if kp_r else 0

    if des_o is None or des_r is None or len(kp_o) < ORB_MIN_MATCHES or len(kp_r) < ORB_MIN_MATCHES:
        return _fallback_resize(img_orig_bgr, img_rev_bgr), info

    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    raw_matches = bf.knnMatch(des_r, des_o, k=2)
    good = [m for m, n in raw_matches if len(raw_matches) and m.distance < ORB_LOWE_RATIO * n.distance]
    info["good_matches"] = len(good)

    if len(good) < ORB_MIN_MATCHES:
        return _fallback_resize(img_orig_bgr, img_rev_bgr), info

    src_pts = np.float32([kp_r[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst_pts = np.float32([kp_o[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)

    H, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, ORB_RANSAC_REPROJ_THRESH)
    inliers = int(mask.sum()) if mask is not None else 0
    info["inliers"] = inliers

    if H is None or inliers < ORB_MIN_MATCHES:
        return _fallback_resize(img_orig_bgr, img_rev_bgr), info

    h, w = img_orig_bgr.shape[:2]
    aligned = cv2.warpPerspective(
        img_rev_bgr, H, (w, h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255),
    )
    info["method"] = "orb_homography"
    return aligned, info


def _bbox_overlap_ratio(a: tuple, b: tuple) -> float:
    """Fraction of bbox *a* that is covered by bbox *b*."""
    ix0 = max(a[0], b[0]); iy0 = max(a[1], b[1])
    ix1 = min(a[2], b[2]); iy1 = min(a[3], b[3])
    if ix1 <= ix0 or iy1 <= iy0: return 0.0
    overlap = (ix1 - ix0) * (iy1 - iy0)
    area_a  = (a[2] - a[0]) * (a[3] - a[1])
    return overlap / area_a if area_a > 0 else 0.0


def _bbox_iou(a: tuple, b: tuple) -> float:
    """Symmetric intersection-over-union of two (x0,y0,x1,y1) bboxes,
    0.0 when they don't actually intersect (ignores any matching pad)."""
    ix0 = max(a[0], b[0]); iy0 = max(a[1], b[1])
    ix1 = min(a[2], b[2]); iy1 = min(a[3], b[3])
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter   = (ix1 - ix0) * (iy1 - iy0)
    area_a  = (a[2] - a[0]) * (a[3] - a[1])
    area_b  = (b[2] - b[0]) * (b[3] - b[1])
    union   = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _text_similarity(a: str, b: str) -> float:
    """Word-level ratio first: robust against the noisy character-level
    overlap two short, unrelated lines can share by coincidence (shared
    stopwords like "e"/"de", a few common letters). Falls back to
    character-level ratio only when word-level has zero signal either way
    — a single-token line (e.g. a bare dose number) has no words to
    compare, but "750" vs "755" still shares 2 of 3 characters."""
    wa, wb = a.lower().split(), b.lower().split()
    word_ratio = difflib.SequenceMatcher(None, wa, wb, autojunk=False).ratio()
    if word_ratio > 0:
        return word_ratio
    return difflib.SequenceMatcher(None, a.lower(), b.lower(), autojunk=False).ratio()


def _best_iou_match(
    boxes_orig: list[tuple], boxes_rev: list[tuple], pad: float = TEXT_PROXIMITY_PT,
    texts_orig: Optional[list[str]] = None, texts_rev: Optional[list[str]] = None,
    min_text_sim: float = 0.0,
) -> dict[int, int]:
    """
    Pair original and revised items (spans, or lines of words — anything
    with a bbox) by best geometric overlap rather than
    first-candidate-within-tolerance.

    texts_orig/texts_rev + min_text_sim add an optional content-similarity
    gate on top of the geometric one — see LINE_TEXT_SIM_MIN. Only passed
    by the line-matching call site; span-matching (font attributes) stays
    purely geometric, since a span's content isn't what's being compared
    there.

    A pure "first item of *_rev within `pad` of *_orig[i]" match is
    vulnerable to a single out-of-order item stealing an unrelated
    neighbour's slot: PyMuPDF appends a freshly redact()+insert_text()'d
    block to the END of a page's text-extraction order, not its visual
    position, so a single edited line/span can land far from its original
    index. Once that item's true match is skipped over (it's scanned
    last), a first-match-wins loop greedily latches onto whatever
    adjacent-but-wrong item happens to fall within the proximity pad, and
    the mismatch cascades item-by-item for the rest of the page (the bug
    fixed in c7528fc).

    Candidate pairs are gated by _bboxes_overlap(pad) but assigned
    highest-IoU-first instead of first-found. An item's true counterpart,
    wherever it landed in the list, has near-total bbox overlap (IoU close
    to 1.0); a merely tolerance-adjacent neighbour (e.g. the next word on
    the same line, or the line below) has IoU 0 — they touch or sit within
    the pad, but don't actually intersect — so it only gets picked if
    nothing better exists for either item, which is exactly the
    unambiguous, single-candidate case a naive algorithm already handles
    correctly.
    """
    candidates: list[tuple[float, int, int]] = []
    for i, a in enumerate(boxes_orig):
        for j, b in enumerate(boxes_rev):
            if not _bboxes_overlap(a, b, pad=pad):
                continue
            if texts_orig is not None and texts_rev is not None:
                if _text_similarity(texts_orig[i], texts_rev[j]) < min_text_sim:
                    continue
            candidates.append((_bbox_iou(a, b), i, j))

    candidates.sort(key=lambda c: c[0], reverse=True)

    matched_orig: set[int] = set()
    matched_rev:  set[int] = set()
    match_map:    dict[int, int] = {}

    for _score, i, j in candidates:
        if i in matched_orig or j in matched_rev:
            continue
        matched_orig.add(i)
        matched_rev.add(j)
        match_map[i] = j

    return match_map


def _match_spans(
    spans_orig: list[dict], spans_rev: list[dict]
) -> dict[int, int]:
    """Span-level best-IoU matching — see _best_iou_match(). Used only for
    font_size/font_style/color comparison (compare_artworks section 2);
    text content is diffed at the word/line level instead (section 2')."""
    return _best_iou_match(
        [s["bbox"] for s in spans_orig], [s["bbox"] for s in spans_rev], pad=TEXT_PROXIMITY_PT
    )


def _words_from_page(page) -> list[dict]:
    """Extract words via PyMuPDF's own tokenizer (whitespace-aware). Unlike
    _spans_from_page, words are already split at natural boundaries, so
    reassembling a line's text only needs position-based ordering and one
    gap check per adjacent pair (_join_words) — no span-boundary spacing
    to reconstruct or guess, which is what made the span-concatenation
    approach lose spaces around a fragmented edit."""
    words = []
    for x0, y0, x1, y1, text, *_rest in page.get_text("words"):
        if text.strip():
            words.append({"text": text, "bbox": (float(x0), float(y0), float(x1), float(y1))})
    return words


def _join_words(words: list[dict]) -> str:
    """Joins word-tokens left-to-right, inserting a space only where the
    gap between adjacent bboxes is large enough to be a real word
    boundary. A near-zero gap means the edit technique split one word into
    two tokens (observed: "1" + "7" at zero gap, meant to read "17") —
    joining those without a space is what recovers the original word."""
    parts: list[str] = []
    for i, w in enumerate(words):
        if i > 0:
            gap = w["bbox"][0] - words[i - 1]["bbox"][2]
            if gap >= WORD_GAP_MERGE_PT:
                parts.append(" ")
        parts.append(w["text"])
    return "".join(parts)


def _group_words_into_lines(words: list[dict]) -> list[dict]:
    """Groups words into physical lines by y0 proximity ALONE — ignoring
    PyMuPDF's own block/line numbering, which (like span order) reflects
    extraction/content-stream structure and can misplace a relocated
    word's line index even though its y-coordinate is correct. Returns one
    dict per line: {"words": [...], "bbox": union, "text": joined}."""
    remaining = list(words)
    lines: list[dict] = []
    while remaining:
        seed = remaining.pop(0)
        group = [seed]
        rest = []
        for w in remaining:
            if abs(w["bbox"][1] - seed["bbox"][1]) <= LINE_Y_TOLERANCE_PT:
                group.append(w)
            else:
                rest.append(w)
        remaining = rest

        group.sort(key=lambda w: w["bbox"][0])
        x0 = min(w["bbox"][0] for w in group)
        y0 = min(w["bbox"][1] for w in group)
        x1 = max(w["bbox"][2] for w in group)
        y1 = max(w["bbox"][3] for w in group)
        lines.append({"words": group, "bbox": (x0, y0, x1, y1), "text": _join_words(group)})

    lines.sort(key=lambda ln: (ln["bbox"][1], ln["bbox"][0]))
    return lines


def _diff_line_words(words_orig: list[dict], words_rev: list[dict]) -> list[dict]:
    """Word-level diff within one matched original/revised line pair.
    Returns only the smallest contiguous changed word-run(s) — e.g. just
    "750" -> "755", not the whole surrounding sentence — using difflib's
    LCS-based opcodes, so unrelated unchanged words before/after the edit
    are never reported. Each entry's bbox is the union of the words
    actually involved (old side, new side, or both for a replace)."""
    texts_orig = [w["text"] for w in words_orig]
    texts_rev  = [w["text"] for w in words_rev]
    sm = difflib.SequenceMatcher(None, texts_orig, texts_rev, autojunk=False)

    out: list[dict] = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        old_words = words_orig[i1:i2]
        new_words = words_rev[j1:j2]
        bbox_words = old_words + new_words
        x0 = min(w["bbox"][0] for w in bbox_words)
        y0 = min(w["bbox"][1] for w in bbox_words)
        x1 = max(w["bbox"][2] for w in bbox_words)
        y1 = max(w["bbox"][3] for w in bbox_words)
        out.append({
            "tag":      tag,
            "old_text": _join_words(old_words),
            "new_text": _join_words(new_words),
            "bbox":     (x0, y0, x1, y1),
        })
    return out


# ── Public API ────────────────────────────────────────────────────────────────────

def compare_artworks(
    original_pdf_path: str,
    revised_pdf_path: str,
    dpi: int = 150,
    preview_dir: str = "previews",
    comparison_id: Optional[str] = None,
    include_compliance: bool = False,
) -> dict:
    """
    Compare two pharmaceutical artwork PDFs and return structured differences.

    Returns a dict with keys:
        comparison_id, summary, pages

    Each page entry contains:
        page_num, page_size_pts, differences[],
        original_render_url, revised_render_url, diff_render_url

    URL paths start with '/previews/' and are served by the FastAPI static mount.
    The actual PNG files are written to `preview_dir/`.
    """
    if comparison_id is None:
        comparison_id = uuid.uuid4().hex[:12]

    doc_orig = fitz.open(original_pdf_path)
    doc_rev  = fitz.open(revised_pdf_path)

    n_pages = min(len(doc_orig), len(doc_rev))
    counter = [0]
    page_results: list[dict] = []

    summary = {
        "total_differences": 0,
        "text_changes":       0,
        "code_changes":       0,
        "visual_changes":     0,
        "dimensional_changes":0,
        "compliance_flags":   0,
    }

    for page_idx in range(n_pages):
        page_orig = doc_orig[page_idx]
        page_rev  = doc_rev[page_idx]
        differences: list[dict] = []

        ow, oh = page_orig.rect.width, page_orig.rect.height
        rw, rh = page_rev.rect.width,  page_rev.rect.height

        # ── 1. Dimensional check ──────────────────────────────────────────────
        dw_mm = abs(ow - rw) * PT_TO_MM
        dh_mm = abs(oh - rh) * PT_TO_MM
        if dw_mm > DIM_DELTA_MM or dh_mm > DIM_DELTA_MM:
            differences.append({
                "id":            _next_id(counter),
                "type":          "dimensional",
                "severity":      "high",
                "original_text": f"W:{ow*PT_TO_MM:.2f}mm H:{oh*PT_TO_MM:.2f}mm",
                "revised_text":  f"W:{rw*PT_TO_MM:.2f}mm H:{rh*PT_TO_MM:.2f}mm",
                "bbox":          [0.0, 0.0, float(ow), float(oh)],
                "page":          page_idx + 1,
                "description":   (
                    f"Page size changed: {ow*PT_TO_MM:.2f}×{oh*PT_TO_MM:.2f}mm"
                    f" → {rw*PT_TO_MM:.2f}×{rh*PT_TO_MM:.2f}mm"
                ),
            })
            summary["dimensional_changes"] += 1

        # ── 2. Text content diff: word/line level, independent of span segmentation ──
        # See the LINE_Y_TOLERANCE_PT/WORD_GAP_MERGE_PT constants' comment for why:
        # span-level matching (still used below, for font attributes only) can't
        # reassemble an edit that PyMuPDF's redact()+insert_text() split across
        # several disjoint span fragments. Words/lines sidestep that entirely.
        lines_orig = _group_words_into_lines(_words_from_page(page_orig))
        lines_rev  = _group_words_into_lines(_words_from_page(page_rev))
        line_match = _best_iou_match(
            [ln["bbox"] for ln in lines_orig], [ln["bbox"] for ln in lines_rev], pad=TEXT_PROXIMITY_PT,
            texts_orig=[ln["text"] for ln in lines_orig], texts_rev=[ln["text"] for ln in lines_rev],
            min_text_sim=LINE_TEXT_SIM_MIN,
        )

        # Lines that had any text diff, at the WHOLE-LINE bbox rather than
        # the narrower per-word diff bbox. Reporting the tight word bbox is
        # correct for pinpointing an edit, but a redact()+insert_text()
        # patch can perturb rendering (sub-pixel antialiasing) anywhere
        # along the line it touched, not just at the edited word — so
        # visual-diff suppression below checks against this broader area,
        # not just each diff's own narrow bbox, to avoid flagging that
        # perturbation as a separate spurious "visual" difference.
        edited_line_bboxes: list[tuple] = []

        for li, line_o in enumerate(lines_orig):
            lj = line_match.get(li)
            if lj is None:
                # Whole line gone — nothing in the revised page overlaps it at all.
                differences.append({
                    "id":            _next_id(counter),
                    "type":          "text_removed",
                    "severity":      "high",
                    "original_text": line_o["text"],
                    "revised_text":  "",
                    "bbox":          list(line_o["bbox"]),
                    "page":          page_idx + 1,
                    "description":   f"Text removed: '{line_o['text']}'",
                })
                summary["text_changes"] += 1
                edited_line_bboxes.append(line_o["bbox"])
                continue

            line_r = lines_rev[lj]
            line_word_diffs = _diff_line_words(line_o["words"], line_r["words"])
            if line_word_diffs:
                edited_line_bboxes.append(line_o["bbox"])
            for wd in line_word_diffs:
                has_ean = bool(EAN_RE.search(wd["old_text"])) or bool(EAN_RE.search(wd["new_text"]))
                if wd["tag"] == "replace":
                    dtype, severity = ("ean_changed" if has_ean else "text_changed"), "high"
                    desc = f"Text changed: '{wd['old_text']}' → '{wd['new_text']}'"
                elif wd["tag"] == "delete":
                    dtype, severity = "text_removed", "high"
                    desc = f"Text removed: '{wd['old_text']}'"
                else:  # "insert"
                    dtype, severity = "text_added", "medium"
                    desc = f"Text added: '{wd['new_text']}'"
                cat_key = "code_changes" if has_ean else "text_changes"
                differences.append({
                    "id":            _next_id(counter),
                    "type":          dtype,
                    "severity":      severity,
                    "original_text": wd["old_text"],
                    "revised_text":  wd["new_text"],
                    "bbox":          list(wd["bbox"]),
                    "page":          page_idx + 1,
                    "description":   desc,
                })
                summary[cat_key] += 1

        matched_rev_lines = set(line_match.values())
        for lj, line_r in enumerate(lines_rev):
            if lj not in matched_rev_lines:
                differences.append({
                    "id":            _next_id(counter),
                    "type":          "text_added",
                    "severity":      "medium",
                    "original_text": "",
                    "revised_text":  line_r["text"],
                    "bbox":          list(line_r["bbox"]),
                    "page":          page_idx + 1,
                    "description":   f"Text added: '{line_r['text']}'",
                })
                summary["text_changes"] += 1
                edited_line_bboxes.append(line_r["bbox"])

        # ── 2'. Font attributes: span-level matching (unchanged from c7528fc) ──
        # Kept at span granularity deliberately: a span is, by construction, a
        # run of text sharing one font/size/colour, which is the natural unit
        # for comparing those attributes — word-level has no such guarantee
        # (a single word doesn't span a font-attribute boundary in practice,
        # but a span legitimately groups multiple words that do share one).
        # This path never reports text content (2a was removed above), so it
        # can't double-report or fragment an edit; it only adds font_size/
        # font_style/color diffs for spans matched with confidence.
        spans_orig = _spans_from_page(page_orig)
        spans_rev  = _spans_from_page(page_rev)
        span_match = _match_spans(spans_orig, spans_rev)

        for i, so in enumerate(spans_orig):
            j = span_match.get(i)
            if j is None:
                continue
            sr = spans_rev[j]

            # ── 2b. Font size change ──────────────────────────────────────────
            if abs(so["size"] - sr["size"]) > TEXT_SIZE_DELTA_PT:
                differences.append({
                    "id":            _next_id(counter),
                    "type":          "font_size",
                    "severity":      "medium",
                    "original_text": f"{so['size']:.1f}pt",
                    "revised_text":  f"{sr['size']:.1f}pt",
                    "bbox":          list(so["bbox"]),
                    "page":          page_idx + 1,
                    "description":   (
                        f"Font size changed on '{so['text']}': "
                        f"{so['size']:.1f}pt → {sr['size']:.1f}pt"
                    ),
                })
                summary["text_changes"] += 1

            # ── 2c. Font style change (bold / italic) ─────────────────────────
            bold_o, bold_r = _font_bold(so["flags"]),   _font_bold(sr["flags"])
            ital_o, ital_r = _font_italic(so["flags"]), _font_italic(sr["flags"])
            if bold_o != bold_r or ital_o != ital_r:
                def _style(bold: bool, ital: bool) -> str:
                    parts = (["bold"] if bold else []) + (["italic"] if ital else [])
                    return " ".join(parts) or "regular"
                differences.append({
                    "id":            _next_id(counter),
                    "type":          "font_style",
                    "severity":      "medium",
                    "original_text": _style(bold_o, ital_o),
                    "revised_text":  _style(bold_r, ital_r),
                    "bbox":          list(so["bbox"]),
                    "page":          page_idx + 1,
                    "description":   (
                        f"Font style changed on '{so['text']}': "
                        f"{_style(bold_o, ital_o)} → {_style(bold_r, ital_r)}"
                    ),
                })
                summary["text_changes"] += 1

            # ── 2d. Text colour change (Delta-E) ───────────────────────────────
            if so["color"] != sr["color"]:
                try:
                    de = _delta_e(_color_to_lab(so["color"]), _color_to_lab(sr["color"]))
                    if de > COLOR_DE_THRESHOLD:
                        differences.append({
                            "id":            _next_id(counter),
                            "type":          "color",
                            "severity":      "medium",
                            "original_text": f"#{so['color']:06X}",
                            "revised_text":  f"#{sr['color']:06X}",
                            "bbox":          list(so["bbox"]),
                            "page":          page_idx + 1,
                            "description":   (
                                f"Text colour changed on '{so['text']}': "
                                f"#{so['color']:06X} → #{sr['color']:06X}"
                                f" (ΔE={de:.1f})"
                            ),
                        })
                        summary["text_changes"] += 1
                except Exception:
                    pass

        # ── 3. EAN: full-page cross-check for codes that moved position ───────
        eans_orig = set(EAN_RE.findall(page_orig.get_text()))
        eans_rev  = set(EAN_RE.findall(page_rev.get_text()))
        for ean in eans_orig - eans_rev:
            # Only add if not already covered by a text_changed/ean_changed entry
            already = any(
                d["type"] in ("ean_changed", "text_changed") and ean in d["original_text"]
                for d in differences
            )
            if not already:
                differences.append({
                    "id":            _next_id(counter),
                    "type":          "ean_changed",
                    "severity":      "high",
                    "original_text": ean,
                    "revised_text":  "",
                    "bbox":          [0.0, 0.0, float(ow), float(oh)],
                    "page":          page_idx + 1,
                    "description":   f"EAN/barcode removed or changed: {ean}",
                })
                summary["code_changes"] += 1

        # ── 4. Compliance: minimum font size in revised PDF ───────────────────
        # Opt-in only (include_compliance) — this checks the revised PDF
        # against an absolute rule, not against the original, so it isn't a
        # "difference between versions" at all. Left on by default it can
        # generate hundreds of flags (seen: 510 of 528 total items on one
        # real artwork) that bury the actual version-to-version diffs.
        if include_compliance:
            # Detect the Artwork Information Panel top boundary so its spec text
            # (Body Text Size, colour swatches, etc.) is excluded from compliance.
            info_panel_y: float | None = None
            _PANEL_KEYWORDS = (
                "Artwork Information Panel",
                "Studio Location",
                "Total Number of Colours",
                "Total Special Finishes",
            )
            for _blk in page_rev.get_text("dict")["blocks"]:
                if _blk.get("type") != 0:
                    continue
                _blk_text = " ".join(
                    sp["text"]
                    for ln in _blk["lines"]
                    for sp in ln["spans"]
                )
                if any(kw in _blk_text for kw in _PANEL_KEYWORDS):
                    info_panel_y = float(_blk["bbox"][1])
                    break

            for s in _spans_from_page(page_rev):
                if info_panel_y is not None and s["bbox"][1] >= info_panel_y - 10:
                    continue
                if 0.0 < s["size"] < MIN_FONT_PT and _is_regulatory_text(s["text"]):
                    differences.append({
                        "id":            _next_id(counter),
                        "type":          "compliance",
                        "severity":      "high",
                        "original_text": "",
                        "revised_text":  f"{s['size']:.1f}pt",
                        "bbox":          list(s["bbox"]),
                        "page":          page_idx + 1,
                        "description":   (
                            f"Text below minimum 6pt: '{s['text']}' is {s['size']:.1f}pt"
                        ),
                    })
                    summary["compliance_flags"] += 1

        # ── 4b. Suppress font_size/font_style shadowed by text_changed ───────
        text_changed_bboxes = [
            tuple(d["bbox"]) for d in differences if d["type"] == "text_changed"
        ]
        if text_changed_bboxes:
            kept: list[dict] = []
            suppressed = 0
            for d in differences:
                if d["type"] in ("font_size", "font_style"):
                    if any(
                        _bbox_overlap_ratio(tuple(d["bbox"]), tc) > 0.5
                        for tc in text_changed_bboxes
                    ):
                        suppressed += 1
                        continue
                kept.append(d)
            differences = kept
            summary["text_changes"] -= suppressed

        # ── 5. Visual pixel diff (with geometric registration) ────────────────
        img_orig_bgr     = _render_page_bgr(page_orig, dpi)
        img_rev_bgr_raw  = _render_page_bgr(page_rev,  dpi)

        img_rev_bgr, align_info = _align_revised_to_original(img_orig_bgr, img_rev_bgr_raw)

        diff_abs = cv2.absdiff(img_orig_bgr, img_rev_bgr)
        gray     = cv2.cvtColor(diff_abs, cv2.COLOR_BGR2GRAY)
        _, mask  = cv2.threshold(gray, VISUAL_THRESHOLD, 255, cv2.THRESH_BINARY)

        kernel = cv2.getStructuringElement(
            cv2.MORPH_RECT, (VISUAL_DILATE_PX, VISUAL_DILATE_PX)
        )
        mask = cv2.dilate(mask, kernel, iterations=2)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        scale = dpi / 72.0  # px per PDF point

        for cnt in contours:
            if cv2.contourArea(cnt) < VISUAL_MIN_AREA_PX2:
                continue
            px, py, pw, ph_ = cv2.boundingRect(cnt)
            bbox_pts = [px / scale, py / scale, (px + pw) / scale, (py + ph_) / scale]

            # Suppress if already covered by a text or code diff, OR if it
            # falls within a line that had any text edit — a word-level
            # diff's reported bbox is intentionally tight (just the edited
            # word), but redact()+insert_text() can perturb rendering
            # anywhere along the line it touched (see edited_line_bboxes
            # above), not only at that word.
            already = any(
                d["type"] not in ("dimensional", "compliance", "visual")
                and _bboxes_overlap(tuple(bbox_pts), tuple(d["bbox"]), pad=4.0)
                for d in differences
            ) or any(
                _bboxes_overlap(tuple(bbox_pts), line_bbox, pad=4.0)
                for line_bbox in edited_line_bboxes
            )
            if already:
                continue

            differences.append({
                "id":            _next_id(counter),
                "type":          "visual",
                "severity":      "low",
                "original_text": "",
                "revised_text":  "",
                "bbox":          bbox_pts,
                "page":          page_idx + 1,
                "description":   (
                    f"Visual difference: {pw}×{ph_}px region at ({px},{py})"
                ),
            })
            summary["visual_changes"] += 1

        # ── Render outputs ────────────────────────────────────────────────────
        _pf = f"comp_{comparison_id}_p{page_idx}"

        # Diff overlay: greyscale original + coloured rectangles
        diff_img = cv2.cvtColor(
            cv2.cvtColor(img_orig_bgr, cv2.COLOR_BGR2GRAY),
            cv2.COLOR_GRAY2BGR,
        )
        SEV_COLOR = {"high": (0, 0, 220), "medium": (0, 140, 255), "low": (0, 210, 255)}
        for d in differences:
            bx0, by0, bx1, by1 = (int(v * scale) for v in d["bbox"])
            bx0 = max(0, bx0); by0 = max(0, by0)
            bx1 = min(img_orig_bgr.shape[1], bx1)
            by1 = min(img_orig_bgr.shape[0], by1)
            col = SEV_COLOR.get(d["severity"], (0, 210, 255))
            cv2.rectangle(diff_img, (bx0, by0), (bx1, by1), col, 2)

        _save_png(diff_img,      str(Path(preview_dir) / f"{_pf}_diff.png"))
        _save_png(img_orig_bgr,  str(Path(preview_dir) / f"{_pf}_orig.png"))
        _save_png(img_rev_bgr,   str(Path(preview_dir) / f"{_pf}_rev.png"))

        page_results.append({
            "page_num":          page_idx + 1,
            "page_size_pts":     [float(ow), float(oh)],
            "differences":       differences,
            "original_render_url": f"/previews/{_pf}_orig.png",
            "revised_render_url":  f"/previews/{_pf}_rev.png",
            "diff_render_url":     f"/previews/{_pf}_diff.png",
            "alignment":         align_info,
        })

    # Extra pages in revised (added pages)
    for page_idx in range(n_pages, len(doc_rev)):
        page_results.append({
            "page_num":          page_idx + 1,
            "page_size_pts":     [float(doc_rev[page_idx].rect.width), float(doc_rev[page_idx].rect.height)],
            "differences":       [{
                "id":            _next_id(counter),
                "type":          "text_added",
                "severity":      "medium",
                "original_text": "",
                "revised_text":  f"(page {page_idx + 1})",
                "bbox":          [0.0, 0.0, float(doc_rev[page_idx].rect.width), float(doc_rev[page_idx].rect.height)],
                "page":          page_idx + 1,
                "description":   f"New page {page_idx + 1} added in revised PDF",
            }],
            "original_render_url": None,
            "revised_render_url":  None,
            "diff_render_url":     None,
        })
        summary["text_changes"] += 1

    doc_orig.close()
    doc_rev.close()

    # compliance_flags is intentionally excluded: it's a count of regulatory
    # rule violations in the revised PDF alone, not a difference between the
    # two versions, so it must never inflate "total differences". It stays
    # its own field in `summary`, shown separately.
    summary["total_differences"] = (
        summary["text_changes"]
        + summary["code_changes"]
        + summary["visual_changes"]
        + summary["dimensional_changes"]
    )

    return {
        "comparison_id": comparison_id,
        "summary":        summary,
        "pages":          page_results,
    }
