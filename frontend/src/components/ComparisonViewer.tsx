import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { processApi } from '../services/processApi'
import type {
  ComparisonRecord,
  DiffEntry,
  DiffSeverity,
  DiffType,
  DifferenceReview,
  PageComparison,
  ReviewSummary,
} from '../types/process'
import { theme, FOCUSABLE_CLASS, MIN_TOUCH_TARGET, injectComparisonGlobalStyles } from '../styles/comparisonTheme'
import { comparisonStrings as S } from '../i18n/comparisonStrings'

// ── Design tokens ─────────────────────────────────────────────────────────────────
// T is the legacy name kept so the diff below stays readable; it now
// re-exports the shared light theme instead of the old dark-theme values.
const T = theme

const SEV_COLOR: Record<DiffSeverity, string> = {
  high:   T.reject,
  medium: T.highlight,
  low:    T.accent,
}

// Diff "group" colours used for chips and page highlights. Text and
// Visual match the exact colours the spec calls out; the remaining groups
// (which the spec doesn't give colours for) reuse the neutral/secondary
// palette so they don't invent new hues that clash with the two that are
// specified.
const GROUP_COLOR: Record<string, string> = {
  Compliance:  T.reject,
  Codes:       T.reject,
  Text:        T.highlight,
  Visual:      T.visualChipText,
  Dimensional: T.textSecondary,
}

const GROUP_CHIP_BG: Record<string, string> = {
  Compliance:  T.rejectBg,
  Codes:       T.rejectBg,
  Text:        T.highlightChipBg,
  Visual:      T.visualChipBg,
  Dimensional: T.surfaceAlt,
}

const TYPE_LABEL: Partial<Record<DiffType, string>> = {
  text_changed:  S.diffCard.typeText,
  text_added:    S.diffCard.typeText,
  text_removed:  S.diffCard.typeText,
  font_size:     S.diffCard.typeFontSize,
  font_style:    S.diffCard.typeFontStyle,
  color:         S.diffCard.typeColor,
  ean_changed:   S.diffCard.typeCode,
  pharmaCode:    S.diffCard.typeCode,
  visual:        S.diffCard.typeVisual,
  dimensional:   S.diffCard.typeDimensional,
  compliance:    S.diffCard.typeCompliance,
}

const TYPE_GROUP: Record<string, string> = {
  text_changed:  'Text',
  text_added:    'Text',
  text_removed:  'Text',
  font_size:     'Text',
  font_style:    'Text',
  color:         'Text',
  ean_changed:   'Codes',
  pharmaCode:    'Codes',
  visual:        'Visual',
  dimensional:   'Dimensional',
  compliance:    'Compliance',
}

// ── Zoom ──────────────────────────────────────────────────────────────────────────
const ZOOM_STEPS = [25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400]
const ZOOM_DEFAULT = 100

// ── Rotation helpers ──────────────────────────────────────────────────────────────

interface DisplayRect { left: number; top: number; width: number; height: number }

/**
 * Convert a PDF-coordinate bbox [x0,y0,x1,y1] (in pts) to a fractional
 * display-space rect (0..1) after applying CW rotation.
 */
function transformBbox(
  bbox:        [number, number, number, number],
  rotation:    number,
  pageSizePts: [number, number],
): DisplayRect {
  const [x0, y0, x1, y1] = bbox
  const [W, H] = pageSizePts
  const fx0 = x0 / W, fy0 = y0 / H
  const fx1 = x1 / W, fy1 = y1 / H

  switch (rotation) {
    case 90:
      return { left: fy0, top: 1 - fx1, width: fy1 - fy0, height: fx1 - fx0 }
    case 180:
      return { left: 1 - fx1, top: 1 - fy1, width: fx1 - fx0, height: fy1 - fy0 }
    case 270:
      return { left: 1 - fy1, top: fx0, width: fy1 - fy0, height: fx1 - fx0 }
    default: // 0°
      return { left: fx0, top: fy0, width: fx1 - fx0, height: fy1 - fy0 }
  }
}

// ── Highlight overlay ─────────────────────────────────────────────────────────────

// Translucent click targets over the PDF — must stay inside the clipped/
// rotated image layer (their percentages are already rotation-aware via
// transformBbox), since that's what keeps them aligned to the page.
// mix-blend-mode: multiply lets the text underneath show through instead of
// being covered; no backdrop-filter per spec.
function DiffHighlightBoxes({
  diffs,
  pageSizePts,
  rotation,
  selectedId,
  onSelect,
}: {
  diffs:       DiffEntry[]
  pageSizePts: [number, number]
  rotation:    number
  selectedId:  string | null
  onSelect:    (id: string) => void
}) {
  return (
    <>
      {diffs.map(d => {
        const r          = transformBbox(d.bbox, rotation, pageSizePts)
        const isSelected = selectedId === d.id
        return (
          <div
            key={d.id}
            title={d.description}
            onClick={e => { e.stopPropagation(); onSelect(d.id) }}
            style={{
              position:  'absolute',
              left:      `${r.left   * 100}%`,
              top:       `${r.top    * 100}%`,
              width:     `${r.width  * 100}%`,
              height:    `${r.height * 100}%`,
              minWidth:  4,
              minHeight: 4,
              background: isSelected ? T.highlightFillSel : T.highlightFillLight,
              mixBlendMode: 'multiply',
              border:     isSelected ? `3px solid ${T.highlight}` : `1.5px dashed ${T.highlight}`,
              borderRadius: 2,
              cursor: 'pointer',
              boxSizing: 'border-box',
              transition: 'background 0.12s, border-color 0.12s',
              zIndex: isSelected ? 2 : 1,
            }}
          />
        )
      })}
    </>
  )
}

// Numbered circle + star markers, rendered in a separate overlay that is a
// *sibling* of the clipped/rotated image layer (not a descendant) so a
// marker next to an excerpt near the page edge is never cut off by that
// layer's overflow: hidden. Rendered after the boxes in DOM order, with no
// z-index of its own, so every marker always sits above every box.
function DiffMarkers({
  diffs,
  pageSizePts,
  rotation,
  selectedId,
}: {
  diffs:       DiffEntry[]
  pageSizePts: [number, number]
  rotation:    number
  selectedId:  string | null
}) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {diffs.map((d, i) => {
        const r          = transformBbox(d.bbox, rotation, pageSizePts)
        const isSelected = selectedId === d.id
        const arrowLeft  = r.left + r.width > 0.80
        return (
          <div
            key={d.id}
            style={{
              position:  'absolute',
              left:      `${r.left   * 100}%`,
              top:       `${r.top    * 100}%`,
              width:     `${r.width  * 100}%`,
              height:    `${r.height * 100}%`,
            }}
          >
            {/* Numbered marker — same number as the card in the panel,
                shown above the highlighted region for every diff (not
                just the selected one), so a designer can see at a glance
                which change is which without opening the panel. */}
            <span style={{
              position:   'absolute',
              top:        -22,
              left:       0,
              width:      20, height: 20, borderRadius: '50%',
              background: T.highlight, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700,
              border: '2px solid #fff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
              userSelect: 'none',
            }}>
              {i + 1}
            </span>

            {/* Star marker — bigger/solid/pulsing when selected, small
                and muted otherwise. Never relies on colour alone: the
                numbered circle above identifies the diff regardless. */}
            <span style={{
              position:      'absolute',
              top:           '50%',
              ...(arrowLeft
                ? { right: 'calc(100% + 6px)' }
                : { left:  'calc(100% + 6px)' }),
              fontSize:      isSelected ? 22 : 13,
              color:         T.highlight,
              opacity:       isSelected ? 1 : 0.55,
              filter:        isSelected ? 'drop-shadow(0 0 6px currentColor)' : 'none',
              WebkitTextStroke: isSelected ? '1px #fff' : undefined,
              animation:     isSelected ? 'starPulse 1.4s ease-in-out infinite' : undefined,
              lineHeight:    1,
              userSelect:    'none',
              transform:     'translateY(-50%)',
            }}>
              ✦
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Single page panel ─────────────────────────────────────────────────────────────

function PageThumbnailRail({
  pages,
  currentPage,
  onSelectPage,
}: {
  pages:        PageComparison[]
  currentPage:  number
  onSelectPage: (index: number) => void
}) {
  if (pages.length <= 1) return null
  return (
    <div style={{
      width: 108, flexShrink: 0, overflowY: 'auto',
      background: T.thumbStripBg, borderRight: `1px solid ${T.thumbStripBorder}`,
      padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{
        fontSize: 12, fontWeight: 700, color: T.textSecondary,
        textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 2px 2px',
      }}>
        {S.thumbnails.heading}
      </div>
      {pages.map((pg, i) => {
        const isCurrent = i === currentPage
        const diffCount = pg.differences.length
        return (
          <button
            key={i}
            onClick={() => onSelectPage(i)}
            className={FOCUSABLE_CLASS}
            style={{
              position: 'relative', display: 'block', width: '100%',
              padding: 0, border: isCurrent ? `3px solid ${T.accent}` : `1px solid ${T.thumbStripBorder}`,
              borderRadius: 6, background: T.surface, cursor: 'pointer',
              boxShadow: isCurrent ? '0 2px 8px rgba(36,71,197,0.35)' : 'none',
              overflow: 'hidden',
            }}
          >
            <div style={{ position: 'relative', width: '100%', aspectRatio: `${pg.page_size_pts[0]} / ${pg.page_size_pts[1]}`, background: T.surfaceAlt }}>
              {pg.original_render_url ? (
                <img
                  src={pg.original_render_url}
                  alt={S.pageLabels.pageOf(i + 1, pages.length)}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  draggable={false}
                />
              ) : null}
              {diffCount > 0 && (
                <span style={{
                  position: 'absolute', top: 4, right: 4,
                  minWidth: 18, height: 18, borderRadius: 9, padding: '0 4px',
                  background: T.highlight, color: '#fff',
                  fontSize: 11, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
                }}>
                  {diffCount}
                </span>
              )}
            </div>
            <div style={{
              fontSize: 12, fontWeight: 600, color: T.text, textAlign: 'center',
              padding: '4px 0', background: T.surface,
            }}>
              {i + 1}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function PagePanel({
  imgUrl,
  label,
  page,
  zoom,
  rotation,
  selectedId,
  onSelect,
  scrollRef,
  onScroll,
  zoomMode,
  onZoomClick,
}: {
  imgUrl:      string | null
  label:       string
  page:        PageComparison
  zoom:        number
  rotation:    number
  selectedId:  string | null
  onSelect:    (id: string) => void
  scrollRef:   React.RefObject<HTMLDivElement>
  onScroll:    () => void
  zoomMode:    'select' | 'zoomin' | 'zoomout'
  onZoomClick: (fracX: number, fracY: number) => void
}) {
  const [W, H]    = page.page_size_pts
  const isSwapped = rotation === 90 || rotation === 270

  const displayAR      = isSwapped ? `${H} / ${W}` : `${W} / ${H}`
  const innerWidthPct  = isSwapped ? (W / H) * 100 : 100
  const innerHeightPct = isSwapped ? (H / W) * 100 : 100

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      {/* Label sits in its own white strip — the workspace behind the PDF
          is a coloured gradient, so plain text there would fail contrast. */}
      <div style={{
        padding: '6px 12px', flexShrink: 0,
        fontSize: 12, fontWeight: 700, color: T.textSecondary,
        textTransform: 'uppercase', letterSpacing: '0.08em',
        background: T.surface, borderBottom: `1px solid ${T.border}`,
      }}>
        {label}
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        onClick={e => {
          if (zoomMode === 'select') return
          const scrollEl = e.currentTarget
          const imgEl = scrollEl.querySelector('img')
          if (!imgEl) return
          const imgRect = imgEl.getBoundingClientRect()
          onZoomClick(
            Math.max(0, Math.min(1, (e.clientX - imgRect.left) / imgRect.width)),
            Math.max(0, Math.min(1, (e.clientY - imgRect.top)  / imgRect.height)),
          )
        }}
        style={{
          flex: 1, overflow: 'auto',
          background: T.workspaceGradient,
          cursor: zoomMode === 'zoomin'  ? 'zoom-in'
                : zoomMode === 'zoomout' ? 'zoom-out'
                : 'default',
        }}
      >
        <div style={{ padding: 16 }}>
          {imgUrl ? (
            <div
              style={{
                position:    'relative',
                width:       `${zoom}%`,
                minWidth:    120,
                aspectRatio: displayAR,
                margin:      '0 auto',
                boxShadow:   '0 4px 24px rgba(0,0,0,0.35)',
              }}
            >
              {/* Clipped layer: rotated image + click-target boxes. Boxes are
                  safe to clip here (their coordinates never exceed the page
                  rectangle); only the markers below must escape this clip. */}
              <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
                <div style={{
                  position:        'absolute',
                  top:             '50%',
                  left:            '50%',
                  width:           `${innerWidthPct}%`,
                  height:          `${innerHeightPct}%`,
                  transform:       `translate(-50%, -50%) rotate(${rotation}deg)`,
                  transformOrigin: 'center center',
                }}>
                  <img
                    src={imgUrl}
                    alt={label}
                    style={{ width: '100%', height: '100%', display: 'block' }}
                    draggable={false}
                  />
                </div>

                <DiffHighlightBoxes
                  diffs={page.differences}
                  pageSizePts={page.page_size_pts}
                  rotation={rotation}
                  selectedId={selectedId}
                  onSelect={onSelect}
                />
              </div>

              {/* Unclipped overlay: numbered circles + stars, always fully visible. */}
              <DiffMarkers
                diffs={page.differences}
                pageSizePts={page.page_size_pts}
                rotation={rotation}
                selectedId={selectedId}
              />
            </div>
          ) : (
            <div style={{
              width: `${zoom}%`, minWidth: 120, margin: '0 auto',
              aspectRatio: displayAR,
              background: T.surface, border: `1px solid ${T.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: T.textSecondary, fontSize: 13,
            }}>
              {S.pageLabels.notAvailable}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Review status bar ─────────────────────────────────────────────────────────────

function ReviewStatusBar({
  summary,
  reviewerEmail,
  onEmailChange,
  onApprove,
  approving,
  approvedAt,
}: {
  summary:       ReviewSummary | null
  reviewerEmail: string
  onEmailChange: (v: string) => void
  onApprove:     () => void
  approving:     boolean
  approvedAt:    string | null
}) {
  if (!summary || summary.total === 0) return null

  const reviewed = summary.accepted + summary.rejected

  return (
    <div style={{
      padding: '8px 16px',
      background: T.surface,
      borderBottom: `1px solid ${T.border}`,
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0,
    }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: T.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {S.reviewBar.heading}
      </span>

      <div style={{ display: 'flex', gap: 6 }}>
        {summary.pending > 0 && (
          <span style={{
            fontSize: 12, padding: '2px 8px', borderRadius: 10, fontWeight: 700,
            background: T.surfaceAlt, color: T.statusPending, border: `1px solid ${T.border}`,
          }}>
            {S.reviewBar.pending(summary.pending)}
          </span>
        )}
        {summary.accepted > 0 && (
          <span style={{
            fontSize: 12, padding: '2px 8px', borderRadius: 10, fontWeight: 700,
            background: T.acceptBg, color: T.accept, border: `1px solid ${T.accept}40`,
          }}>
            {S.reviewBar.accepted(summary.accepted)}
          </span>
        )}
        {summary.rejected > 0 && (
          <span style={{
            fontSize: 12, padding: '2px 8px', borderRadius: 10, fontWeight: 700,
            background: T.rejectBg, color: T.reject, border: `1px solid ${T.reject}40`,
          }}>
            {S.reviewBar.rejected(summary.rejected)}
          </span>
        )}
        <span style={{ fontSize: 12, color: T.textSecondary }}>
          {S.reviewBar.reviewedOf(reviewed, summary.total)}
        </span>
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        {approvedAt ? (
          <span style={{ fontSize: 13, color: T.accept, fontWeight: 700 }}>
            ✓ {S.reviewBar.approvedAt(new Date(approvedAt).toLocaleString())}
          </span>
        ) : (
          <>
            <input
              value={reviewerEmail}
              onChange={e => onEmailChange(e.target.value)}
              placeholder={S.reviewBar.emailPlaceholder}
              title={S.reviewBar.emailTitle}
              className={FOCUSABLE_CLASS}
              style={{
                background: T.surfaceAlt, border: `1px solid ${T.border}`,
                borderRadius: 6, color: T.text, fontSize: 13,
                padding: '6px 10px', outline: 'none', width: 200,
                fontFamily: 'inherit',
              }}
            />
            {summary.can_approve && (
              <button
                onClick={onApprove}
                disabled={approving || !reviewerEmail.trim()}
                title={!reviewerEmail.trim() ? 'Enter your reviewer email first' : undefined}
                className={FOCUSABLE_CLASS}
                style={{
                  padding: '8px 16px', minHeight: MIN_TOUCH_TARGET,
                  background: approving || !reviewerEmail.trim() ? T.surfaceAlt : (summary.has_rejections ? T.highlight : T.accept),
                  color: approving || !reviewerEmail.trim() ? T.textSecondary : '#fff',
                  border: 'none', borderRadius: 7,
                  cursor: approving || !reviewerEmail.trim() ? 'not-allowed' : 'pointer',
                  fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
                  opacity: !reviewerEmail.trim() ? 0.6 : 1,
                }}
              >
                {approving
                  ? S.reviewBar.approving
                  : summary.has_rejections
                    ? `⚠ ${S.reviewBar.approveWithRejections}`
                    : `✓ ${S.reviewBar.approve}`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Diff card (single card in the panel) ────────────────────────────────────────

function DiffCard({
  d,
  index,
  isSelected,
  onSelect,
  review,
  isSub,
  onReview,
  reviewerEmailSet,
}: {
  d:                DiffEntry
  index:            number
  isSelected:       boolean
  onSelect:         (id: string) => void
  review:           DifferenceReview | undefined
  isSub:            boolean
  onReview:         (diffId: string, status: 'accepted' | 'rejected', comment: string) => void
  reviewerEmailSet: boolean
}) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [note,     setNote]     = useState(review?.comment ?? '')
  useEffect(() => { setNote(review?.comment ?? ''); setNoteOpen(false) }, [review?.comment, d.id])

  const group        = TYPE_GROUP[d.type] ?? 'Text'
  const color        = GROUP_COLOR[group]
  const chipBg       = GROUP_CHIP_BG[group]
  const chipLabel    = group === 'Visual' ? S.diffCard.typeVisual : (TYPE_LABEL[d.type] ?? d.type)
  const reviewStatus = review?.status ?? 'pending'

  const statusMeta = {
    pending:  { label: S.diffCard.statusPending,  color: T.statusPending,  bg: T.surfaceAlt },
    accepted: { label: S.diffCard.statusAccepted, color: T.statusAccepted, bg: T.acceptBg },
    rejected: { label: S.diffCard.statusRejected, color: T.statusRejected, bg: T.rejectBg },
  }[reviewStatus]

  // Accept ⇄ Reject switches freely (just a PATCH with the other status).
  // Clicking the already-active button again is a no-op: the review API
  // only accepts 'accepted' | 'rejected' (PATCH, upsert) and has no way to
  // clear a review back to 'pending' — no DELETE route, no 'pending'
  // value it accepts. The spec asks for "click again undoes, back to
  // Pending"; that's not implementable without a backend change, which is
  // out of scope this round. Reported in the final summary.
  const handleToggle = (action: 'accepted' | 'rejected') => {
    if (reviewStatus === action) return
    onReview(d.id, action, note)
  }

  return (
    <div
      style={{
        margin: '8px 10px',
        background: T.surface,
        border:     isSelected ? `2px solid ${T.accent}` : `1px solid ${T.border}`,
        borderRadius: 10,
        boxShadow: isSelected ? '0 2px 10px rgba(36,71,197,0.18)' : 'none',
        overflow: 'hidden',
      }}
    >
      {/* ── Header row — clickable, selects + scrolls to this diff ── */}
      <button
        className={FOCUSABLE_CLASS}
        onClick={() => onSelect(d.id)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', background: isSelected ? T.surfaceAlt : 'transparent',
          border: 'none', borderBottom: `1px solid ${T.border}`, cursor: 'pointer',
          textAlign: 'left', fontFamily: 'inherit',
        }}
      >
        <span style={{
          flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
          background: T.highlight, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700,
        }}>
          {index}
        </span>
        <span style={{
          fontSize: 12, fontWeight: 700, color,
          background: chipBg, border: `1px solid ${color}40`,
          padding: '2px 8px', borderRadius: 4,
        }}>
          {chipLabel}
        </span>
        <span style={{ fontSize: 13, color: T.textSecondary, flexShrink: 0 }}>
          {S.diffCard.page(d.page)}
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 12, fontWeight: 700, flexShrink: 0,
          color: statusMeta.color, background: statusMeta.bg,
          padding: '2px 9px', borderRadius: 10, border: `1px solid ${statusMeta.color}40`,
        }}>
          {statusMeta.label}
        </span>
      </button>

      {/* ── Body ── */}
      <div style={{ padding: '10px 12px 12px' }}>
        {d.original_text && (
          <div style={{
            display: 'flex', gap: 6, fontSize: 14, color: T.reject, background: T.rejectBg,
            padding: '5px 8px', borderRadius: 5, marginBottom: 4,
            textDecoration: 'line-through', wordBreak: 'break-word',
          }}>
            <span style={{ flexShrink: 0, fontWeight: 700 }}>−</span>
            <span>{d.original_text}</span>
          </div>
        )}
        {d.revised_text && (
          <div style={{
            display: 'flex', gap: 6, fontSize: 14, fontWeight: 700, color: T.accept, background: T.acceptBg,
            padding: '5px 8px', borderRadius: 5, marginBottom: 4, wordBreak: 'break-word',
          }}>
            <span style={{ flexShrink: 0 }}>+</span>
            <span>{d.revised_text}</span>
          </div>
        )}
        {/* Context sentence: only shown when the backend provides one —
            DiffEntry has no such field today (see summary at end of task),
            so this intentionally never renders yet. */}
        {!d.original_text && !d.revised_text && (
          <div style={{ fontSize: 14, color: T.text, lineHeight: 1.4 }}>
            {d.description}
          </div>
        )}

        {/* ── Accept / Reject — immediate toggle, click again undoes ── */}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button
            disabled={isSub || !reviewerEmailSet}
            aria-pressed={reviewStatus === 'accepted'}
            title={!reviewerEmailSet ? 'Enter your reviewer email above to begin reviewing' : undefined}
            className={FOCUSABLE_CLASS}
            onClick={() => handleToggle('accepted')}
            style={{
              flex: 1, minHeight: MIN_TOUCH_TARGET, display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 6, fontSize: 14, fontWeight: 700,
              border: `1.5px solid ${T.accept}`,
              background: reviewStatus === 'accepted' ? T.accept : T.surface,
              color:      reviewStatus === 'accepted' ? '#fff'  : T.accept,
              borderRadius: 8,
              cursor: isSub || !reviewerEmailSet ? 'not-allowed' : 'pointer',
              opacity: isSub || !reviewerEmailSet ? 0.5 : 1,
            }}
          >
            ✓ {S.diffCard.accept}
          </button>
          <button
            disabled={isSub || !reviewerEmailSet}
            aria-pressed={reviewStatus === 'rejected'}
            title={!reviewerEmailSet ? 'Enter your reviewer email above to begin reviewing' : undefined}
            className={FOCUSABLE_CLASS}
            onClick={() => handleToggle('rejected')}
            style={{
              flex: 1, minHeight: MIN_TOUCH_TARGET, display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 6, fontSize: 14, fontWeight: 700,
              border: `1.5px solid ${T.reject}`,
              background: reviewStatus === 'rejected' ? T.reject : T.surface,
              color:      reviewStatus === 'rejected' ? '#fff'  : T.reject,
              borderRadius: 8,
              cursor: isSub || !reviewerEmailSet ? 'not-allowed' : 'pointer',
              opacity: isSub || !reviewerEmailSet ? 0.5 : 1,
            }}
          >
            ✗ {S.diffCard.reject}
          </button>
        </div>

        {isSub && (
          <div style={{ fontSize: 12, color: T.textSecondary, textAlign: 'center', marginTop: 6 }}>
            {S.diffCard.saving}
          </div>
        )}

        {/* ── Optional audit note — secondary, doesn't block the toggle ── */}
        {reviewStatus !== 'pending' && !isSub && (
          <div style={{ marginTop: 8 }}>
            {!noteOpen ? (
              <button
                className={FOCUSABLE_CLASS}
                onClick={() => setNoteOpen(true)}
                style={{
                  background: 'none', border: 'none', color: T.textSecondary,
                  fontSize: 12, cursor: 'pointer', padding: '2px 0', textDecoration: 'underline',
                }}
              >
                {review?.comment ? `"${review.comment.slice(0, 40)}${review.comment.length > 40 ? '…' : ''}"` : `+ ${S.diffCard.noteLabel}`}
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <textarea
                  autoFocus
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder={S.diffCard.notePlaceholder}
                  rows={2}
                  className={FOCUSABLE_CLASS}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: T.surfaceAlt, border: `1px solid ${T.border}`,
                    borderRadius: 5, color: T.text, fontSize: 13,
                    padding: '6px 8px', resize: 'vertical', outline: 'none',
                    fontFamily: 'inherit', lineHeight: 1.4,
                  }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className={FOCUSABLE_CLASS}
                    onClick={() => { onReview(d.id, reviewStatus as 'accepted' | 'rejected', note); setNoteOpen(false) }}
                    style={{
                      padding: '5px 12px', fontSize: 12, fontWeight: 700,
                      background: T.accent, color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer',
                    }}
                  >
                    {S.diffCard.confirm}
                  </button>
                  <button
                    className={FOCUSABLE_CLASS}
                    onClick={() => { setNote(review?.comment ?? ''); setNoteOpen(false) }}
                    style={{
                      padding: '5px 12px', fontSize: 12, fontWeight: 700,
                      background: 'none', color: T.textSecondary, border: `1px solid ${T.border}`, borderRadius: 5, cursor: 'pointer',
                    }}
                  >
                    {S.diffCard.cancel}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Diff list sidebar ─────────────────────────────────────────────────────────────

function DiffListPanel({
  page,
  selectedId,
  onSelect,
  reviews,
  submitting,
  onReview,
  reviewerEmailSet,
  onApprove,
  approving,
}: {
  page:             PageComparison
  selectedId:       string | null
  onSelect:         (id: string) => void
  reviews:          Record<string, DifferenceReview>
  submitting:       Set<string>
  onReview:         (diffId: string, status: 'accepted' | 'rejected', comment: string) => void
  reviewerEmailSet: boolean
  onApprove:        () => void
  approving:        boolean
}) {
  const diffs      = page.differences
  const totalCount = diffs.length
  const reviewedCount = diffs.filter(d => {
    const s = reviews[d.id]?.status
    return s === 'accepted' || s === 'rejected'
  }).length
  const allReviewed = totalCount > 0 && reviewedCount === totalCount

  const goToOffset = (offset: 1 | -1) => {
    if (totalCount === 0) return
    const curIdx = diffs.findIndex(d => d.id === selectedId)
    const nextIdx = curIdx === -1
      ? (offset === 1 ? 0 : totalCount - 1)
      : (curIdx + offset + totalCount) % totalCount
    onSelect(diffs[nextIdx].id)
  }

  return (
    <div style={{
      width: 320, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      background: T.surfaceAlt, borderLeft: `1px solid ${T.border}`,
    }}>
      <div style={{
        padding: '12px 14px', borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, background: T.surface,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {S.diffPanel.heading}
        </span>
        <span style={{
          padding: '2px 8px', borderRadius: 10,
          background: totalCount > 0 ? T.rejectBg : T.acceptBg,
          color:      totalCount > 0 ? T.reject   : T.accept,
          border:    `1px solid ${totalCount > 0 ? T.reject : T.accept}40`,
          fontSize: 12, fontWeight: 700,
        }}>
          {totalCount}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {totalCount === 0 && (
          <div style={{ padding: '32px 14px', textAlign: 'center', color: T.textSecondary, fontSize: 13 }}>
            {S.diffPanel.empty}
          </div>
        )}

        {diffs.map((d, i) => (
          <DiffCard
            key={d.id}
            d={d}
            index={i + 1}
            isSelected={selectedId === d.id}
            onSelect={onSelect}
            review={reviews[d.id]}
            isSub={submitting.has(d.id)}
            onReview={onReview}
            reviewerEmailSet={reviewerEmailSet}
          />
        ))}
      </div>

      {/* ── Fixed footer: Previous / Next + Complete review ── */}
      {totalCount > 0 && (
        <div style={{
          flexShrink: 0, padding: 10, background: T.surface,
          borderTop: `1px solid ${T.border}`,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={FOCUSABLE_CLASS}
              onClick={() => goToOffset(-1)}
              style={{
                flex: 1, minHeight: MIN_TOUCH_TARGET, fontSize: 13, fontWeight: 700,
                background: T.surface, color: T.textSecondary, border: `1px solid ${T.border}`,
                borderRadius: 7, cursor: 'pointer',
              }}
            >
              ◀ {S.diffPanel.previous}
            </button>
            <button
              className={FOCUSABLE_CLASS}
              onClick={() => goToOffset(1)}
              style={{
                flex: 1, minHeight: MIN_TOUCH_TARGET, fontSize: 13, fontWeight: 700,
                background: T.surface, color: T.accent, border: `1px solid ${T.border}`,
                borderRadius: 7, cursor: 'pointer',
              }}
            >
              {S.diffPanel.next} ▶
            </button>
          </div>
          <button
            className={FOCUSABLE_CLASS}
            disabled={!allReviewed || !reviewerEmailSet || approving}
            onClick={onApprove}
            style={{
              minHeight: MIN_TOUCH_TARGET, fontSize: 14, fontWeight: 700,
              background: allReviewed && reviewerEmailSet ? T.accent : T.surfaceAlt,
              color:      allReviewed && reviewerEmailSet ? '#fff'  : T.textSecondary,
              border: 'none', borderRadius: 8,
              cursor: allReviewed && reviewerEmailSet && !approving ? 'pointer' : 'not-allowed',
              opacity: allReviewed ? 1 : 0.7,
            }}
          >
            {approving ? S.reviewBar.approving : S.diffPanel.complete(reviewedCount, totalCount)}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Upload form ───────────────────────────────────────────────────────────────────

function UploadForm({
  processId,
  originalPdfPath,
  onComplete,
}: {
  processId:       string
  originalPdfPath: string | null
  onComplete:      (rec: ComparisonRecord) => void
}) {
  const [file,    setFile]    = useState<File | null>(null)
  const [running, setRunning] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const run = async () => {
    if (!file) return
    setRunning(true); setError(null)
    try {
      onComplete(await processApi.runComparison(processId, file, originalPdfPath ?? undefined))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Comparison failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '60px 40px', gap: 20,
      background: T.surface, height: '100%', fontFamily: T.fontFamily,
    }}>
      <div style={{ fontSize: 40, marginBottom: 4 }}>⚖️</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{S.upload.heading}</div>
      <div style={{ fontSize: 14, color: T.textSecondary, maxWidth: 420, textAlign: 'center', lineHeight: 1.6 }}>
        {S.upload.description}
      </div>

      {error && (
        <div style={{
          padding: '10px 16px', background: T.rejectBg,
          border: `1px solid ${T.reject}40`, borderRadius: 8,
          color: T.reject, fontSize: 13, maxWidth: 400, textAlign: 'center',
        }}>{error}</div>
      )}

      <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }}
        onChange={e => setFile(e.target.files?.[0] ?? null)} />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={() => fileRef.current?.click()} className={FOCUSABLE_CLASS} style={{
          padding: '10px 18px', minHeight: MIN_TOUCH_TARGET, background: T.surfaceAlt,
          border: `1px solid ${T.border}`, borderRadius: 8,
          color: T.textSecondary, cursor: 'pointer', fontSize: 14,
        }}>
          {file ? `↺ ${S.upload.changeFile}` : `↑ ${S.upload.chooseFile}`}
        </button>
        {file && <span style={{ fontSize: 13, color: T.accept }}>✓ {file.name}</span>}
      </div>

      <button onClick={run} disabled={!file || running} className={FOCUSABLE_CLASS} style={{
        padding: '12px 28px', minHeight: MIN_TOUCH_TARGET,
        background: file && !running ? T.accent : T.surfaceAlt,
        color:      file && !running ? '#fff'   : T.textSecondary,
        border: 'none', borderRadius: 8,
        cursor: file && !running ? 'pointer' : 'not-allowed',
        fontSize: 14, fontWeight: 700,
      }}>
        {running ? S.upload.comparing : S.upload.compare}
      </button>
    </div>
  )
}

// ── Summary bar ───────────────────────────────────────────────────────────────────

function SummaryBar({
  rec, onNew, reviewSummary,
}: {
  rec:           ComparisonRecord
  onNew:         () => void
  reviewSummary: ReviewSummary | null
}) {
  const s = rec.result?.summary
  if (!s) return null
  const total = s.total_differences
  const pills = [
    { label: 'Text',        value: s.text_changes,         color: T.highlight },
    { label: 'Codes',       value: s.code_changes,         color: T.reject  },
    { label: 'Visual',      value: s.visual_changes,       color: T.visualChipText },
    { label: 'Dimensional', value: s.dimensional_changes,  color: T.textSecondary },
    { label: 'Compliance',  value: s.compliance_flags,     color: T.reject  },
  ].filter(p => p.value > 0)

  const reviewed = reviewSummary ? reviewSummary.accepted + reviewSummary.rejected : 0
  const reviewTotal = reviewSummary?.total ?? 0
  const progressPct = reviewTotal > 0 ? Math.round((reviewed / reviewTotal) * 100) : 0

  return (
    <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
      <div style={{
        padding: '10px 16px 6px',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: total === 0 ? T.accept : T.text }}>
          {total === 0 ? `✓ ${S.summaryBar.identical}` : S.summaryBar.differences(total)}
        </span>
        {pills.map(p => (
          <span key={p.label} style={{
            fontSize: 12, padding: '2px 9px', borderRadius: 10,
            background: T.surfaceAlt, color: p.color, border: `1px solid ${p.color}40`, fontWeight: 700,
          }}>
            {p.label}: {p.value}
          </span>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: T.textSecondary, fontFamily: 'monospace' }}>
            {new Date(rec.created_at).toLocaleString()}
          </span>
          <button onClick={onNew} className={FOCUSABLE_CLASS} style={{
            padding: '6px 14px', minHeight: 36, background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: 6, color: T.textSecondary, cursor: 'pointer', fontSize: 13,
          }}>
            + {S.upload.newComparison}
          </button>
        </div>
      </div>

      {reviewTotal > 0 && (
        <div style={{ padding: '2px 16px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            role="progressbar"
            aria-valuenow={reviewed}
            aria-valuemin={0}
            aria-valuemax={reviewTotal}
            aria-label={S.summaryBar.reviewedProgress(reviewed, reviewTotal)}
            style={{
              flex: 1, height: 8, borderRadius: 4, background: T.surfaceAlt,
              border: `1px solid ${T.border}`, overflow: 'hidden',
            }}
          >
            <div style={{
              width: `${progressPct}%`, height: '100%', background: T.accept,
              borderRadius: 4, transition: 'width 0.2s ease',
            }} />
          </div>
          <span style={{ fontSize: 13, color: T.textSecondary, flexShrink: 0, fontWeight: 600 }}>
            {S.summaryBar.reviewedProgress(reviewed, reviewTotal)}
          </span>
        </div>
      )}
    </div>
  )
}

// ── View-controls toolbar ─────────────────────────────────────────────────────────

function ToolbarBtn({
  onClick, disabled, title, active, children,
}: {
  onClick:   () => void
  disabled?: boolean
  title?:    string
  active?:   boolean
  children:  React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={FOCUSABLE_CLASS}
      style={{
        background: active ? `${T.accent}18` : 'none',
        border:     active ? `1px solid ${T.accent}60` : `1px solid transparent`,
        color:      disabled ? T.textSecondary : active ? T.accent : T.textSecondary,
        cursor:     disabled ? 'not-allowed' : 'pointer',
        padding:    '6px 10px', borderRadius: 6, minHeight: 32,
        fontSize: 13, fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: 4,
        transition: 'color 0.12s, background 0.12s',
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={e => {
        if (!disabled && !active) {
          e.currentTarget.style.color      = T.text
          e.currentTarget.style.background = T.surfaceAlt
        }
      }}
      onMouseLeave={e => {
        if (!disabled && !active) {
          e.currentTarget.style.color      = T.textSecondary
          e.currentTarget.style.background = 'none'
        }
      }}
    >
      {children}
    </button>
  )
}

function ViewToolbar({
  zoom,
  rotation,
  onZoom,
  onRotate,
  onFitWidth,
  zoomMode,
  onZoomModeToggle,
}: {
  zoom:             number
  rotation:         number
  onZoom:           (z: number) => void
  onRotate:         () => void
  onFitWidth:       () => void
  zoomMode:         'select' | 'zoomin' | 'zoomout'
  onZoomModeToggle: (mode: 'zoomin' | 'zoomout') => void
}) {
  const zoomIdx = ZOOM_STEPS.indexOf(zoom)
  const is100   = zoom === ZOOM_DEFAULT

  return (
    <div style={{
      padding: '6px 12px', background: T.surface, borderBottom: `1px solid ${T.border}`,
      display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
    }}>
      <ToolbarBtn onClick={onFitWidth} title="Fit to width (Ctrl+0)" active={is100}>
        <svg width="12" height="12" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="1" y="2" width="9" height="7" rx="1"/>
          <line x1="3" y1="5.5" x2="8" y2="5.5"/>
          <line x1="3" y1="3.5" x2="3" y2="7.5"/>
          <line x1="8" y1="3.5" x2="8" y2="7.5"/>
        </svg>
        {S.toolbar.fitWidth}
      </ToolbarBtn>

      <div style={{ width: 1, height: 16, background: T.border, margin: '0 2px' }} />

      <ToolbarBtn
        onClick={() => onZoom(ZOOM_STEPS[0])}
        disabled={zoomIdx === 0}
        title="Minimum zoom (25%)"
      >
        {ZOOM_STEPS[0]}%
      </ToolbarBtn>

      <ToolbarBtn
        onClick={() => onZoomModeToggle('zoomin')}
        active={zoomMode === 'zoomin'}
        title={zoomMode === 'zoomin' ? 'Zoom in active — click again to deactivate' : 'Zoom in — click on PDF to zoom in (Ctrl+=)'}
      >
        <svg width="12" height="12" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="4.5" cy="4.5" r="3"/>
          <line x1="7" y1="7" x2="10" y2="10"/>
          <line x1="3" y1="4.5" x2="6" y2="4.5"/>
          <line x1="4.5" y1="3" x2="4.5" y2="6"/>
        </svg>
      </ToolbarBtn>

      <span style={{
        minWidth: 46, textAlign: 'center',
        fontSize: 13, fontWeight: 700, color: T.text,
        fontFamily: 'monospace',
        padding: '4px 6px', background: T.surfaceAlt,
        border: `1px solid ${T.border}`, borderRadius: 5,
      }}>
        {zoom}%
      </span>

      <ToolbarBtn
        onClick={() => onZoomModeToggle('zoomout')}
        active={zoomMode === 'zoomout'}
        title={zoomMode === 'zoomout' ? 'Zoom out active — click again to deactivate' : 'Zoom out — click on PDF to zoom out (Ctrl+−)'}
      >
        <svg width="12" height="12" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="4.5" cy="4.5" r="3"/>
          <line x1="7" y1="7" x2="10" y2="10"/>
          <line x1="3" y1="4.5" x2="6" y2="4.5"/>
        </svg>
      </ToolbarBtn>

      <ToolbarBtn
        onClick={() => onZoom(ZOOM_STEPS[ZOOM_STEPS.length - 1])}
        disabled={zoomIdx === ZOOM_STEPS.length - 1}
        title="Maximum zoom (400%)"
      >
        {ZOOM_STEPS[ZOOM_STEPS.length - 1]}%
      </ToolbarBtn>

      <div style={{ width: 1, height: 16, background: T.border, margin: '0 2px' }} />

      <ToolbarBtn onClick={onRotate} title="Rotate 90° clockwise">
        <svg width="12" height="12" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M2 5.5a3.5 3.5 0 107-0"/>
          <polyline points="7,2 9,4.5 6.5,4.5"/>
        </svg>
        {S.toolbar.rotate}
      </ToolbarBtn>

      {rotation !== 0 && (
        <span style={{ fontSize: 12, color: T.textSecondary, fontFamily: 'monospace', marginLeft: 2 }}>
          {rotation}°
        </span>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────────

interface Props {
  processId:       string
  originalPdfPath: string | null
  // Bumping this (to any new value) opens the upload screen, even while a
  // comparison is already active. Lets a parent header button ("Nova
  // comparação") trigger the same flow as the in-panel "+ New comparison"
  // button without this component handing its showUpload state up.
  requestUploadSignal?: number
}

export default function ComparisonViewer({ processId, originalPdfPath, requestUploadSignal }: Props) {
  const [comparisons, setComparisons] = useState<ComparisonRecord[]>([])
  const [activeRec,   setActiveRec]   = useState<ComparisonRecord | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [selectedId,  setSelectedId]  = useState<string | null>(null)
  const [showUpload,  setShowUpload]  = useState(false)
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    if (requestUploadSignal !== undefined) setShowUpload(true)
  }, [requestUploadSignal])

  // View controls
  const [zoom,     setZoom]     = useState<number>(ZOOM_DEFAULT)
  const [rotation, setRotation] = useState<number>(0)

  // Reviews
  const [reviews,       setReviews]       = useState<Record<string, DifferenceReview>>({})
  const [reviewSummary, setReviewSummary] = useState<ReviewSummary | null>(null)
  const [submitting,    setSubmitting]    = useState<Set<string>>(new Set())
  const [approving,     setApproving]     = useState(false)
  const [reviewerEmail, setReviewerEmail] = useState(
    () => localStorage.getItem('bs_reviewer_email') ?? ''
  )

  // Zoom tool mode
  const [zoomMode, setZoomMode] = useState<'select' | 'zoomin' | 'zoomout'>('select')

  // Scroll refs — shared between both panels for sync
  const leftRef  = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const syncing  = useRef(false)

  // Captured scroll-centre fraction for zoom preservation
  const scrollFracRef = useRef<number>(0.5)

  // Click-point fraction for click-to-zoom centering (takes priority over scrollFracRef)
  const clickFracRef = useRef<{ x: number; y: number } | null>(null)

  // Ref to current rotation for scroll-to-diff effect (avoids stale closure)
  const rotationRef = useRef(rotation)
  useEffect(() => { rotationRef.current = rotation }, [rotation])

  // ── Synchronized scrolling ────────────────────────────────────────────────────
  const syncScroll = useCallback((source: 'left' | 'right') => {
    if (syncing.current) return
    syncing.current = true
    const src  = source === 'left' ? leftRef.current  : rightRef.current
    const dest = source === 'left' ? rightRef.current : leftRef.current
    if (src && dest) {
      dest.scrollTop  = src.scrollTop
      dest.scrollLeft = src.scrollLeft
    }
    requestAnimationFrame(() => { syncing.current = false })
  }, [])

  // ── Zoom with scroll-centre preservation ──────────────────────────────────────
  const doZoom = useCallback((newZoom: number) => {
    const el = leftRef.current
    if (el && el.scrollHeight > el.clientHeight) {
      const centre = el.scrollTop + el.clientHeight / 2
      scrollFracRef.current = centre / el.scrollHeight
    }
    setZoom(newZoom)
  }, [])

  // After zoom DOM update — center on the clicked point, or restore fractional scroll centre.
  useLayoutEffect(() => {
    if (clickFracRef.current) {
      const { x, y } = clickFracRef.current
      clickFracRef.current = null
      for (const ref of [leftRef, rightRef]) {
        const el = ref.current
        if (!el) continue
        const PADDING = 16
        const imageH = el.scrollHeight - PADDING * 2
        const imageW = el.scrollWidth  - PADDING * 2
        el.scrollTop  = Math.max(0, PADDING + y * imageH - el.clientHeight  / 2)
        el.scrollLeft = Math.max(0, PADDING + x * imageW - el.clientWidth   / 2)
      }
      return
    }
    const frac = scrollFracRef.current
    for (const ref of [leftRef, rightRef]) {
      const el = ref.current
      if (!el) continue
      el.scrollTop = Math.max(0, frac * el.scrollHeight - el.clientHeight / 2)
    }
  }, [zoom])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key === '=') {
        e.preventDefault()
        setZoom(z => {
          const i = ZOOM_STEPS.indexOf(z)
          if (i < 0) return z
          const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, i + 1)]
          const el = leftRef.current
          if (el && el.scrollHeight > el.clientHeight)
            scrollFracRef.current = (el.scrollTop + el.clientHeight / 2) / el.scrollHeight
          return next
        })
      } else if (e.key === '-') {
        e.preventDefault()
        setZoom(z => {
          const i = ZOOM_STEPS.indexOf(z)
          if (i < 0) return z
          const next = ZOOM_STEPS[Math.max(0, i - 1)]
          const el = leftRef.current
          if (el && el.scrollHeight > el.clientHeight)
            scrollFracRef.current = (el.scrollTop + el.clientHeight / 2) / el.scrollHeight
          return next
        })
      } else if (e.key === '0') {
        e.preventDefault()
        scrollFracRef.current = 0.5
        setZoom(ZOOM_DEFAULT)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // ── Rotation ──────────────────────────────────────────────────────────────────
  const rotate = useCallback(() => setRotation(r => (r + 90) % 360), [])

  // ── Zoom tool mode ────────────────────────────────────────────────────────────
  const handleZoomModeToggle = useCallback((mode: 'zoomin' | 'zoomout') => {
    setZoomMode(prev => prev === mode ? 'select' : mode)
  }, [])

  const handleZoomClick = useCallback((fracX: number, fracY: number) => {
    setZoom(z => {
      const newZoom = zoomMode === 'zoomin'
        ? Math.min(400, z + 25)
        : Math.max(25,  z - 25)
      if (newZoom === z) return z
      clickFracRef.current = { x: fracX, y: fracY }
      // Capture current scroll centre as fallback (doZoom path not taken here)
      const el = leftRef.current
      if (el && el.scrollHeight > el.clientHeight)
        scrollFracRef.current = (el.scrollTop + el.clientHeight / 2) / el.scrollHeight
      return newZoom
    })
  }, [zoomMode])

  // ── Inject shared keyframes + focus-ring stylesheet once at mount ─────────────
  useEffect(() => {
    injectComparisonGlobalStyles()
  }, [])

  // ── Scroll both panels to centre the selected diff ────────────────────────────
  useEffect(() => {
    if (!selectedId || !activeRec?.result) return
    const pg   = activeRec.result.pages[currentPage]
    const diff = pg?.differences.find(d => d.id === selectedId)
    if (!diff) return
    const r = transformBbox(
      diff.bbox as [number, number, number, number],
      rotationRef.current,
      pg.page_size_pts,
    )
    requestAnimationFrame(() => {
      for (const ref of [leftRef, rightRef]) {
        const el = ref.current
        if (!el) continue
        const pageH    = el.scrollHeight - 32
        const centrePx = 16 + (r.top + r.height / 2) * pageH
        el.scrollTo({ top: centrePx - el.clientHeight / 2, behavior: 'smooth' })
      }
    })
  }, [selectedId, currentPage])

  // ── Auto-select the first difference whenever none is selected ────────────────
  // (initial open, or after navigating to a page whose previous selection no
  // longer applies) so the panel and the on-page highlight are never both blank.
  useEffect(() => {
    if (!activeRec?.result) return
    const pg = activeRec.result.pages[currentPage]
    if (!pg || pg.differences.length === 0) return
    if (selectedId && pg.differences.some(d => d.id === selectedId)) return
    setSelectedId(pg.differences[0].id)
  }, [activeRec, currentPage, selectedId])

  // ── Data loading ──────────────────────────────────────────────────────────────
  useEffect(() => {
    processApi.listComparisons(processId)
      .then(recs => {
        setComparisons(recs)
        if (recs.length > 0) setActiveRec(recs[0])
        else setShowUpload(true)
      })
      .catch(() => setShowUpload(true))
      .finally(() => setLoading(false))
  }, [processId])

  // ── Load reviews when active comparison changes ───────────────────────────────
  useEffect(() => {
    if (!activeRec) { setReviews({}); setReviewSummary(null); return }
    Promise.all([
      processApi.listDiffReviews(processId, activeRec.id),
      processApi.getReviewSummary(processId, activeRec.id),
    ])
      .then(([revList, summary]) => {
        setReviews(Object.fromEntries(revList.map(r => [r.diff_id, r])))
        setReviewSummary(summary)
      })
      .catch(() => {})
  }, [activeRec?.id, processId])

  // ── Review handlers ───────────────────────────────────────────────────────────
  const handleReviewerEmailChange = (email: string) => {
    setReviewerEmail(email)
    localStorage.setItem('bs_reviewer_email', email)
  }

  const handleReview = async (
    diffId: string,
    status: 'accepted' | 'rejected',
    comment: string,
  ) => {
    if (!activeRec || !reviewerEmail.trim()) return
    setSubmitting(s => new Set(s).add(diffId))
    try {
      const updated = await processApi.reviewDifference(processId, activeRec.id, diffId, {
        status,
        reviewer_email: reviewerEmail.trim(),
        comment: comment.trim() || undefined,
      })
      setReviews(r => ({ ...r, [updated.diff_id]: updated }))
      const summary = await processApi.getReviewSummary(processId, activeRec.id)
      setReviewSummary(summary)
    } catch {
      // Error is silent; the UI doesn't change so the user can retry
    } finally {
      setSubmitting(s => { const n = new Set(s); n.delete(diffId); return n })
    }
  }

  const handleApprove = async () => {
    if (!activeRec || !reviewerEmail.trim()) return
    setApproving(true)
    try {
      const result = await processApi.approveComparison(processId, activeRec.id, {
        approved_by: reviewerEmail.trim(),
      })
      setActiveRec(r => r ? { ...r, approved_by: result.approved_by, approved_at: result.approved_at } : r)
    } catch {
      // Silent — review summary still shows pending
    } finally {
      setApproving(false)
    }
  }

  const handleNewComparison = (rec: ComparisonRecord) => {
    setComparisons(prev => [rec, ...prev])
    setActiveRec(rec)
    setShowUpload(false)
    setCurrentPage(0)
    setSelectedId(null)
    setZoom(ZOOM_DEFAULT)
    setRotation(0)
    setReviews({})
    setReviewSummary(null)
    setZoomMode('select')
  }

  // ── Render guards ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: 40, color: T.textSecondary, fontSize: 13, fontFamily: T.fontFamily, background: T.surface, height: '100%' }}>
        Loading comparisons…
      </div>
    )
  }

  if (showUpload || !activeRec || !activeRec.result) {
    return (
      <UploadForm
        processId={processId}
        originalPdfPath={originalPdfPath}
        onComplete={handleNewComparison}
      />
    )
  }

  const pages   = activeRec.result.pages
  const page    = pages[currentPage]
  const hasPrev = currentPage > 0
  const hasNext = currentPage < pages.length - 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', fontFamily: T.fontFamily }}>

      {/* ── Summary bar ── */}
      <SummaryBar rec={activeRec} onNew={() => setShowUpload(true)} reviewSummary={reviewSummary} />

      {/* ── Review status bar ── */}
      <ReviewStatusBar
        summary={reviewSummary}
        reviewerEmail={reviewerEmail}
        onEmailChange={handleReviewerEmailChange}
        onApprove={handleApprove}
        approving={approving}
        approvedAt={activeRec.approved_at ?? null}
      />

      {/* ── Page navigation (only when multi-page) ── */}
      {pages.length > 1 && (
        <div style={{
          padding: '8px 16px', background: T.surface, borderBottom: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <button
            onClick={() => { setCurrentPage(p => p - 1); setSelectedId(null) }}
            disabled={!hasPrev}
            className={FOCUSABLE_CLASS}
            style={{
              padding: '4px 12px', minHeight: 32, background: 'none', border: `1px solid ${T.border}`,
              borderRadius: 6, color: hasPrev ? T.textSecondary : T.textSecondary,
              cursor: hasPrev ? 'pointer' : 'not-allowed', fontSize: 13, opacity: hasPrev ? 1 : 0.4,
            }}
          >◀</button>

          <span style={{ fontSize: 13, color: T.textSecondary }}>
            {S.pageLabels.pageOf(currentPage + 1, pages.length)}
          </span>

          <button
            onClick={() => { setCurrentPage(p => p + 1); setSelectedId(null) }}
            disabled={!hasNext}
            className={FOCUSABLE_CLASS}
            style={{
              padding: '4px 12px', minHeight: 32, background: 'none', border: `1px solid ${T.border}`,
              borderRadius: 6, color: hasNext ? T.accent : T.textSecondary,
              cursor: hasNext ? 'pointer' : 'not-allowed', fontSize: 13, opacity: hasNext ? 1 : 0.4,
            }}
          >▶</button>

          <span style={{ fontSize: 12, color: T.textSecondary, marginLeft: 4 }}>
            {page.differences.length} difference{page.differences.length !== 1 ? 's' : ''} on this page
          </span>
        </div>
      )}

      {/* ── View controls toolbar ── */}
      <ViewToolbar
        zoom={zoom}
        rotation={rotation}
        onZoom={doZoom}
        onRotate={rotate}
        onFitWidth={() => doZoom(ZOOM_DEFAULT)}
        zoomMode={zoomMode}
        onZoomModeToggle={handleZoomModeToggle}
      />

      {/* ── Body: page thumbnails + side-by-side panels + diff list ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        <PageThumbnailRail
          pages={pages}
          currentPage={currentPage}
          onSelectPage={i => { setCurrentPage(i); setSelectedId(null) }}
        />

        <PagePanel
          imgUrl={page.original_render_url}
          label={S.pageLabels.original}
          page={page}
          zoom={zoom}
          rotation={rotation}
          selectedId={selectedId}
          onSelect={setSelectedId}
          scrollRef={leftRef}
          onScroll={() => syncScroll('left')}
          zoomMode={zoomMode}
          onZoomClick={handleZoomClick}
        />

        <div style={{ width: 1, background: T.border, flexShrink: 0 }} />

        <PagePanel
          imgUrl={page.revised_render_url}
          label={S.pageLabels.revised}
          page={page}
          zoom={zoom}
          rotation={rotation}
          selectedId={selectedId}
          onSelect={setSelectedId}
          scrollRef={rightRef}
          onScroll={() => syncScroll('right')}
          zoomMode={zoomMode}
          onZoomClick={handleZoomClick}
        />

        <DiffListPanel
          page={page}
          selectedId={selectedId}
          onSelect={setSelectedId}
          reviews={reviews}
          submitting={submitting}
          onReview={handleReview}
          reviewerEmailSet={!!reviewerEmail.trim()}
          onApprove={handleApprove}
          approving={approving}
        />
      </div>
    </div>
  )
}
