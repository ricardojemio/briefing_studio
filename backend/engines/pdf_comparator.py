"""
backend/engines/pdf_comparator.py

Automated pharmaceutical artwork comparison engine.
Detects text, code (EAN, via digit-pattern matching on extracted text —
not real barcode decoding), visual (ORB + homography registration ahead
of pixel diffing), and dimensional differences between two PDF files.

DO NOT MODIFY: pdf_draft_engine.py, raster_engine_v3.py, draft_engine.py, detector.py
"""

from __future__ import annotations

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


def _match_spans(
    spans_orig: list[dict], spans_rev: list[dict]
) -> tuple[set[int], set[int], dict[int, int]]:
    """
    Pair original and revised spans by best geometric overlap rather than
    first-candidate-within-tolerance.

    A pure "first span of spans_rev within TEXT_PROXIMITY_PT of spans_orig[i]"
    match is vulnerable to a single out-of-order span stealing an unrelated
    neighbour's slot: PyMuPDF appends a freshly redact()+insert_text()'d
    block to the END of a page's text-extraction order, not its visual
    position, so a single edited line can land far from its original index.
    Once that line's true match is skipped over (it's scanned last), the
    first-match-wins loop greedily latches onto whatever adjacent-but-wrong
    span happens to fall within the proximity pad, and the mismatch cascades
    span-by-span for the rest of the page.

    Candidate pairs are still gated by _bboxes_overlap() — same tolerance,
    same admitted pairs as before — but are assigned highest-IoU-first
    instead of first-found. A span's true counterpart, wherever it landed in
    the list, has near-total bbox overlap (IoU close to 1.0); a merely
    tolerance-adjacent neighbour (e.g. the next word on the same line, or
    the line below) has IoU 0 — they touch or sit within the pad, but don't
    actually intersect — so it only gets picked if nothing better exists for
    either span, which is exactly the unambiguous, single-candidate case the
    original algorithm already handled correctly.
    """
    candidates: list[tuple[float, int, int]] = []
    for i, so in enumerate(spans_orig):
        for j, sr in enumerate(spans_rev):
            if _bboxes_overlap(so["bbox"], sr["bbox"]):
                candidates.append((_bbox_iou(so["bbox"], sr["bbox"]), i, j))

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

    return matched_orig, matched_rev, match_map


# ── Public API ────────────────────────────────────────────────────────────────────

def compare_artworks(
    original_pdf_path: str,
    revised_pdf_path: str,
    dpi: int = 150,
    preview_dir: str = "previews",
    comparison_id: Optional[str] = None,
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

        # ── 2. Text span extraction and matching ──────────────────────────────
        spans_orig = _spans_from_page(page_orig)
        spans_rev  = _spans_from_page(page_rev)

        matched_orig, matched_rev, match_map = _match_spans(spans_orig, spans_rev)

        for i, so in enumerate(spans_orig):
            j = match_map.get(i)
            if j is None:
                continue
            sr = spans_rev[j]

            # ── 2a. Text content change ───────────────────────────────────────
            if so["text"] != sr["text"]:
                # Promote to ean_changed if either span contains EAN
                has_ean = bool(EAN_RE.search(so["text"])) or bool(EAN_RE.search(sr["text"]))
                dtype    = "ean_changed" if has_ean else "text_changed"
                cat_key  = "code_changes" if has_ean else "text_changes"
                differences.append({
                    "id":            _next_id(counter),
                    "type":          dtype,
                    "severity":      "high",
                    "original_text": so["text"],
                    "revised_text":  sr["text"],
                    "bbox":          list(so["bbox"]),
                    "page":          page_idx + 1,
                    "description":   f"Text changed: '{so['text']}' → '{sr['text']}'",
                })
                summary[cat_key] += 1

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

        # ── 2e. Unmatched original spans = text removed ───────────────────────
        for i, so in enumerate(spans_orig):
            if i not in matched_orig:
                differences.append({
                    "id":            _next_id(counter),
                    "type":          "text_removed",
                    "severity":      "high",
                    "original_text": so["text"],
                    "revised_text":  "",
                    "bbox":          list(so["bbox"]),
                    "page":          page_idx + 1,
                    "description":   f"Text removed: '{so['text']}'",
                })
                summary["text_changes"] += 1

        # ── 2f. Unmatched revised spans = text added ──────────────────────────
        for j, sr in enumerate(spans_rev):
            if j not in matched_rev:
                differences.append({
                    "id":            _next_id(counter),
                    "type":          "text_added",
                    "severity":      "medium",
                    "original_text": "",
                    "revised_text":  sr["text"],
                    "bbox":          list(sr["bbox"]),
                    "page":          page_idx + 1,
                    "description":   f"Text added: '{sr['text']}'",
                })
                summary["text_changes"] += 1

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

            # Suppress if already covered by a text or code diff
            already = any(
                d["type"] not in ("dimensional", "compliance", "visual")
                and _bboxes_overlap(tuple(bbox_pts), tuple(d["bbox"]), pad=4.0)
                for d in differences
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

    summary["total_differences"] = (
        summary["text_changes"]
        + summary["code_changes"]
        + summary["visual_changes"]
        + summary["dimensional_changes"]
        + summary["compliance_flags"]
    )

    return {
        "comparison_id": comparison_id,
        "summary":        summary,
        "pages":          page_results,
    }
