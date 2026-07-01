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

// ── Design tokens ─────────────────────────────────────────────────────────────────
const T = {
  bgBase:     '#0C0E14',
  bgSurface:  '#141720',
  bgElevated: '#1C2030',
  border:     '#2A2F3F',
  accent:     '#2D6BE4',
  success:    '#1A9E6F',
  danger:     '#D63C3C',
  warning:    '#C47E1A',
  textPrimary:'#E8ECF4',
  textSecond: '#7A8299',
  textMuted:  '#3D4560',
} as const

const SEV_COLOR: Record<DiffSeverity, string> = {
  high:   '#D63C3C',
  medium: '#C47E1A',
  low:    '#2D6BE4',
}

const GROUP_COLOR: Record<string, string> = {
  Compliance:  '#D63C3C',
  Codes:       '#D63C3C',
  Text:        '#F59E0B',
  Visual:      '#2D6BE4',
  Dimensional: '#7C3AED',
}

const TYPE_LABEL: Partial<Record<DiffType, string>> = {
  text_changed:  'Text Changed',
  text_added:    'Text Added',
  text_removed:  'Text Removed',
  font_size:     'Font Size',
  font_style:    'Font Style',
  color:         'Colour',
  ean_changed:   'EAN / Barcode',
  pharmaCode:    'PharmaCode',
  visual:        'Visual',
  dimensional:   'Dimensional',
  compliance:    'Compliance',
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

const GROUP_ORDER = ['Compliance', 'Codes', 'Dimensional', 'Text', 'Visual']

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

function DiffHighlights({
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
        const color      = GROUP_COLOR[TYPE_GROUP[d.type] ?? 'Text']
        const arrowLeft  = r.left + r.width > 0.80
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
              background: isSelected ? `${color}40` : 'rgba(255,255,255,0.08)',
              border:     isSelected ? `2px solid ${color}DD` : '1px solid rgba(255,255,255,0.25)',
              borderRadius: 2,
              cursor: 'pointer',
              boxSizing: 'border-box',
              transition: 'background 0.12s, border-color 0.12s',
              zIndex: isSelected ? 2 : 1,
            }}
          >
            {isSelected && (
              <span style={{
                position:      'absolute',
                top:           '50%',
                ...(arrowLeft
                  ? { right: 'calc(100% + 6px)' }
                  : { left:  'calc(100% + 6px)' }),
                fontSize:      24,
                color,
                filter:        'drop-shadow(0 0 6px currentColor)',
                animation:     'starPulse 1.4s ease-in-out infinite',
                pointerEvents: 'none',
                lineHeight:    1,
                userSelect:    'none',
              }}>
                ✦
              </span>
            )}
          </div>
        )
      })}
    </>
  )
}

// ── Single page panel ─────────────────────────────────────────────────────────────

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
}: {
  imgUrl:     string | null
  label:      string
  page:       PageComparison
  zoom:       number
  rotation:   number
  selectedId: string | null
  onSelect:   (id: string) => void
  scrollRef:  React.RefObject<HTMLDivElement>
  onScroll:   () => void
}) {
  const [W, H]    = page.page_size_pts
  const isSwapped = rotation === 90 || rotation === 270

  const displayAR      = isSwapped ? `${H} / ${W}` : `${W} / ${H}`
  const innerWidthPct  = isSwapped ? (W / H) * 100 : 100
  const innerHeightPct = isSwapped ? (H / W) * 100 : 100

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      <div style={{
        padding: '6px 12px', flexShrink: 0,
        fontSize: 10, fontWeight: 700, color: T.textMuted,
        textTransform: 'uppercase', letterSpacing: '0.1em',
        background: T.bgSurface, borderBottom: `1px solid ${T.border}`,
      }}>
        {label}
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ flex: 1, overflow: 'auto', background: '#090B10' }}
      >
        <div style={{ padding: 16 }}>
          {imgUrl ? (
            <div style={{
              position:    'relative',
              width:       `${zoom}%`,
              minWidth:    120,
              aspectRatio: displayAR,
              overflow:    'hidden',
              margin:      '0 auto',
            }}>
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

              <DiffHighlights
                diffs={page.differences}
                pageSizePts={page.page_size_pts}
                rotation={rotation}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            </div>
          ) : (
            <div style={{
              width: `${zoom}%`, minWidth: 120, margin: '0 auto',
              aspectRatio: displayAR,
              background: T.bgSurface, border: `1px solid ${T.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: T.textMuted, fontSize: 12,
            }}>
              Page not available
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
      padding: '7px 16px',
      background: T.bgSurface,
      borderBottom: `1px solid ${T.border}`,
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0,
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: T.textSecond, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Review
      </span>

      <div style={{ display: 'flex', gap: 5 }}>
        {summary.pending > 0 && (
          <span style={{
            fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 700,
            background: `${T.warning}18`, color: T.warning, border: `1px solid ${T.warning}40`,
          }}>
            {summary.pending} pending
          </span>
        )}
        {summary.accepted > 0 && (
          <span style={{
            fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 700,
            background: `${T.success}18`, color: T.success, border: `1px solid ${T.success}40`,
          }}>
            {summary.accepted} accepted
          </span>
        )}
        {summary.rejected > 0 && (
          <span style={{
            fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 700,
            background: `${T.danger}18`, color: T.danger, border: `1px solid ${T.danger}40`,
          }}>
            {summary.rejected} rejected
          </span>
        )}
        <span style={{ fontSize: 10, color: T.textMuted }}>
          ({reviewed}/{summary.total} reviewed)
        </span>
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        {approvedAt ? (
          <span style={{ fontSize: 11, color: T.success, fontWeight: 700 }}>
            ✓ Approved {new Date(approvedAt).toLocaleString()}
          </span>
        ) : (
          <>
            <input
              value={reviewerEmail}
              onChange={e => onEmailChange(e.target.value)}
              placeholder="reviewer@company.com"
              title="Your email — required to record reviews"
              style={{
                background: T.bgElevated, border: `1px solid ${T.border}`,
                borderRadius: 5, color: T.textPrimary, fontSize: 11,
                padding: '3px 8px', outline: 'none', width: 190,
                fontFamily: 'inherit',
              }}
            />
            {summary.can_approve && (
              <button
                onClick={onApprove}
                disabled={approving || !reviewerEmail.trim()}
                title={!reviewerEmail.trim() ? 'Enter your reviewer email first' : undefined}
                style={{
                  padding: '5px 14px',
                  background: approving || !reviewerEmail.trim() ? T.bgElevated : (summary.has_rejections ? T.warning : T.success),
                  color: approving || !reviewerEmail.trim() ? T.textMuted : '#fff',
                  border: 'none', borderRadius: 6,
                  cursor: approving || !reviewerEmail.trim() ? 'not-allowed' : 'pointer',
                  fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
                  opacity: !reviewerEmail.trim() ? 0.5 : 1,
                }}
              >
                {approving
                  ? 'Approving…'
                  : summary.has_rejections
                    ? '⚠ Approve with Rejections'
                    : '✓ Approve Comparison'}
              </button>
            )}
          </>
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
  onMagnifyDiff,
  magnifierActive,
  reviews,
  submitting,
  onReview,
  reviewerEmailSet,
}: {
  page:             PageComparison
  selectedId:       string | null
  onSelect:         (id: string) => void
  onMagnifyDiff:    (diffId: string, bbox: [number,number,number,number], pageSizePts: [number,number]) => void
  magnifierActive:  boolean
  reviews:          Record<string, DifferenceReview>
  submitting:       Set<string>
  onReview:         (diffId: string, status: 'accepted' | 'rejected', comment: string) => void
  reviewerEmailSet: boolean
}) {
  const [editing, setEditing] = useState<{
    diffId:  string
    action:  'accepted' | 'rejected'
    comment: string
  } | null>(null)

  useEffect(() => { setEditing(null) }, [page])

  // Sequential number across all diffs on this page (order = page.differences)
  const diffIndex = new Map(page.differences.map((d, i) => [d.id, i + 1]))

  const grouped: Record<string, DiffEntry[]> = {}
  for (const d of page.differences) {
    const g = TYPE_GROUP[d.type] ?? 'Other'
    if (!grouped[g]) grouped[g] = []
    grouped[g].push(d)
  }
  const totalCount = page.differences.length

  const confirmReview = () => {
    if (!editing) return
    onReview(editing.diffId, editing.action, editing.comment)
    setEditing(null)
  }

  return (
    <div style={{
      width: 280, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      background: T.bgSurface, borderLeft: `1px solid ${T.border}`,
    }}>
      <div style={{
        padding: '10px 14px', borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.textSecond, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Differences
        </span>
        <span style={{
          padding: '2px 7px', borderRadius: 10,
          background: totalCount > 0 ? `${T.danger}20` : `${T.success}20`,
          color:      totalCount > 0 ? T.danger          : T.success,
          border:    `1px solid ${totalCount > 0 ? T.danger : T.success}40`,
          fontSize: 10, fontWeight: 700,
        }}>
          {totalCount}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {totalCount === 0 && (
          <div style={{ padding: '32px 14px', textAlign: 'center', color: T.textMuted, fontSize: 12 }}>
            No differences on this page
          </div>
        )}

        {GROUP_ORDER.filter(g => grouped[g]).map(groupName => (
          <div key={groupName}>
            <div style={{
              padding: '6px 14px 4px',
              fontSize: 9, fontWeight: 700, color: T.textMuted,
              textTransform: 'uppercase', letterSpacing: '0.12em',
              background: T.bgElevated, borderBottom: `1px solid ${T.border}`,
              position: 'sticky', top: 0,
            }}>
              {groupName} ({grouped[groupName].length})
            </div>

            {grouped[groupName].map(d => {
              const isSelected   = selectedId === d.id
              const color        = GROUP_COLOR[TYPE_GROUP[d.type] ?? 'Text']
              const review       = reviews[d.id]
              const isSub        = submitting.has(d.id)
              const isEditing    = editing?.diffId === d.id
              const reviewStatus = review?.status ?? 'pending'

              return (
                <div
                  key={d.id}
                  style={{
                    padding: '9px 14px',
                    background:   isSelected ? `${color}12` : 'transparent',
                    borderBottom: `1px solid ${T.border}`,
                    borderLeft:   `3px solid ${isSelected ? color : 'transparent'}`,
                  }}
                >
                  <div
                    onClick={e => {
                      e.stopPropagation()
                      onSelect(d.id)
                      if (magnifierActive) onMagnifyDiff(d.id, d.bbox as [number,number,number,number], page.page_size_pts)
                    }}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={e => {
                      if (!isSelected)
                        (e.currentTarget as HTMLDivElement).style.opacity = '0.85'
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLDivElement).style.opacity = '1'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: T.textPrimary, flexShrink: 0,
                      }}>
                        Change {diffIndex.get(d.id)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                      <span style={{
                        fontSize: 8, fontWeight: 700, color,
                        background: `${color}18`, border: `1px solid ${color}35`,
                        padding: '1px 5px', borderRadius: 3, textTransform: 'uppercase',
                        letterSpacing: '0.06em', flexShrink: 0,
                      }}>
                        {TYPE_LABEL[d.type] ?? d.type}
                      </span>
                      <span style={{ fontSize: 8, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {d.severity}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: T.textPrimary, lineHeight: 1.4, wordBreak: 'break-word' }}>
                      {d.description.length > 80 ? d.description.slice(0, 80) + '…' : d.description}
                    </div>
                    {(d.original_text || d.revised_text) && (
                      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {d.original_text && (
                          <div style={{ fontSize: 10, color: '#ff8888', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                            − {d.original_text.slice(0, 50)}{d.original_text.length > 50 ? '…' : ''}
                          </div>
                        )}
                        {d.revised_text && (
                          <div style={{ fontSize: 10, color: '#88ff99', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                            + {d.revised_text.slice(0, 50)}{d.revised_text.length > 50 ? '…' : ''}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Review section ── */}
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.border}40` }}>

                    {/* Current status badge (when reviewed and not editing) */}
                    {review && !isEditing && (
                      <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                          textTransform: 'uppercase', letterSpacing: '0.06em',
                          background: reviewStatus === 'accepted' ? `${T.success}20` : `${T.danger}20`,
                          color:      reviewStatus === 'accepted' ? T.success          : T.danger,
                          border:    `1px solid ${reviewStatus === 'accepted' ? T.success : T.danger}40`,
                        }}>
                          {reviewStatus === 'accepted' ? '✓ Accepted' : '✗ Rejected'}
                        </span>
                        {review.comment && (
                          <span style={{ fontSize: 9, color: T.textMuted, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            "{review.comment.slice(0, 40)}{review.comment.length > 40 ? '…' : ''}"
                          </span>
                        )}
                      </div>
                    )}

                    {/* Accept / Reject buttons */}
                    {!isEditing && (
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button
                          disabled={isSub || !reviewerEmailSet}
                          title={!reviewerEmailSet ? 'Enter your reviewer email above to begin reviewing' : (reviewStatus === 'accepted' ? 'Edit acceptance' : 'Accept this difference')}
                          onClick={e => {
                            e.stopPropagation()
                            setEditing({ diffId: d.id, action: 'accepted', comment: review?.comment ?? '' })
                          }}
                          style={{
                            flex: 1, padding: '4px 0', fontSize: 10, fontWeight: 700,
                            border:     `1px solid ${reviewStatus === 'accepted' ? T.success : T.border}`,
                            background: reviewStatus === 'accepted' ? `${T.success}25` : T.bgElevated,
                            color:      reviewStatus === 'accepted' ? T.success          : T.textSecond,
                            borderRadius: 4,
                            cursor: isSub || !reviewerEmailSet ? 'not-allowed' : 'pointer',
                            opacity: isSub || !reviewerEmailSet ? 0.45 : 1,
                            transition: 'background 0.1s, border-color 0.1s',
                          }}
                        >
                          ✓ Accept
                        </button>
                        <button
                          disabled={isSub || !reviewerEmailSet}
                          title={!reviewerEmailSet ? 'Enter your reviewer email above to begin reviewing' : (reviewStatus === 'rejected' ? 'Edit rejection' : 'Reject this difference')}
                          onClick={e => {
                            e.stopPropagation()
                            setEditing({ diffId: d.id, action: 'rejected', comment: review?.comment ?? '' })
                          }}
                          style={{
                            flex: 1, padding: '4px 0', fontSize: 10, fontWeight: 700,
                            border:     `1px solid ${reviewStatus === 'rejected' ? T.danger : T.border}`,
                            background: reviewStatus === 'rejected' ? `${T.danger}20` : T.bgElevated,
                            color:      reviewStatus === 'rejected' ? T.danger          : T.textSecond,
                            borderRadius: 4,
                            cursor: isSub || !reviewerEmailSet ? 'not-allowed' : 'pointer',
                            opacity: isSub || !reviewerEmailSet ? 0.45 : 1,
                            transition: 'background 0.1s, border-color 0.1s',
                          }}
                        >
                          ✗ Reject
                        </button>
                      </div>
                    )}

                    {/* Inline edit form */}
                    {isEditing && editing && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                            textTransform: 'uppercase',
                            background: editing.action === 'accepted' ? `${T.success}20` : `${T.danger}20`,
                            color:      editing.action === 'accepted' ? T.success          : T.danger,
                            border:    `1px solid ${editing.action === 'accepted' ? T.success : T.danger}40`,
                          }}>
                            {editing.action === 'accepted' ? '✓ Accept' : '✗ Reject'}
                          </span>
                          <span style={{ fontSize: 9, color: T.textMuted }}>Optional note</span>
                        </div>
                        <textarea
                          autoFocus
                          value={editing.comment}
                          onChange={e => setEditing(prev => prev ? { ...prev, comment: e.target.value } : prev)}
                          placeholder="Audit comment (optional)…"
                          rows={2}
                          style={{
                            width: '100%', boxSizing: 'border-box',
                            background: T.bgElevated, border: `1px solid ${T.border}`,
                            borderRadius: 4, color: T.textPrimary, fontSize: 11,
                            padding: '5px 7px', resize: 'vertical', outline: 'none',
                            fontFamily: 'inherit', lineHeight: 1.4,
                          }}
                        />
                        <div style={{ display: 'flex', gap: 5 }}>
                          <button
                            onClick={e => { e.stopPropagation(); confirmReview() }}
                            style={{
                              flex: 1, padding: '5px 0', fontSize: 10, fontWeight: 700,
                              background: editing.action === 'accepted' ? T.success : T.danger,
                              color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer',
                            }}
                          >
                            Confirm
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); setEditing(null) }}
                            style={{
                              flex: 1, padding: '5px 0', fontSize: 10, fontWeight: 700,
                              background: T.bgElevated, color: T.textSecond,
                              border: `1px solid ${T.border}`, borderRadius: 4, cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Submitting spinner */}
                    {isSub && (
                      <div style={{ fontSize: 9, color: T.textMuted, textAlign: 'center', marginTop: 4 }}>
                        Saving…
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
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
    }}>
      <div style={{ fontSize: 40, marginBottom: 4 }}>⚖️</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary }}>Run Artwork Comparison</div>
      <div style={{ fontSize: 12, color: T.textSecond, maxWidth: 420, textAlign: 'center', lineHeight: 1.6 }}>
        Upload the revised PDF from your design studio. The system will automatically
        detect text, code, visual, and dimensional differences.
      </div>

      {error && (
        <div style={{
          padding: '10px 16px', background: `${T.danger}18`,
          border: `1px solid ${T.danger}40`, borderRadius: 8,
          color: '#fca5a5', fontSize: 12, maxWidth: 400, textAlign: 'center',
        }}>{error}</div>
      )}

      <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }}
        onChange={e => setFile(e.target.files?.[0] ?? null)} />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={() => fileRef.current?.click()} style={{
          padding: '9px 18px', background: T.bgElevated,
          border: `1px solid ${T.border}`, borderRadius: 8,
          color: T.textSecond, cursor: 'pointer', fontSize: 12,
        }}>
          {file ? '↺ Change file' : '↑ Choose revised PDF'}
        </button>
        {file && <span style={{ fontSize: 11, color: T.success }}>✓ {file.name}</span>}
      </div>

      <button onClick={run} disabled={!file || running} style={{
        padding: '10px 28px',
        background: file && !running ? T.accent : T.bgElevated,
        color:      file && !running ? '#fff'   : T.textMuted,
        border: 'none', borderRadius: 8,
        cursor: file && !running ? 'pointer' : 'not-allowed',
        fontSize: 13, fontWeight: 700,
      }}>
        {running ? 'Analysing…' : 'Compare Artworks'}
      </button>
    </div>
  )
}

// ── Summary bar ───────────────────────────────────────────────────────────────────

function SummaryBar({ rec, onNew }: { rec: ComparisonRecord; onNew: () => void }) {
  const s = rec.result?.summary
  if (!s) return null
  const total = s.total_differences
  const pills = [
    { label: 'Text',        value: s.text_changes,         color: T.accent  },
    { label: 'Codes',       value: s.code_changes,         color: T.danger  },
    { label: 'Visual',      value: s.visual_changes,       color: T.warning },
    { label: 'Dimensional', value: s.dimensional_changes,  color: '#7C3AED' },
    { label: 'Compliance',  value: s.compliance_flags,     color: T.danger  },
  ].filter(p => p.value > 0)

  return (
    <div style={{
      padding: '8px 16px', background: T.bgSurface, borderBottom: `1px solid ${T.border}`,
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flexShrink: 0,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: total === 0 ? T.success : T.textPrimary }}>
        {total === 0 ? '✓ Identical' : `${total} difference${total !== 1 ? 's' : ''}`}
      </span>
      {pills.map(p => (
        <span key={p.label} style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 10,
          background: `${p.color}18`, color: p.color, border: `1px solid ${p.color}40`, fontWeight: 700,
        }}>
          {p.label}: {p.value}
        </span>
      ))}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: T.textMuted, fontFamily: 'monospace' }}>
          {new Date(rec.created_at).toLocaleString()}
        </span>
        <button onClick={onNew} style={{
          padding: '5px 12px', background: 'transparent', border: `1px solid ${T.border}`,
          borderRadius: 6, color: T.textSecond, cursor: 'pointer', fontSize: 11,
        }}>
          + New comparison
        </button>
      </div>
    </div>
  )
}

// ── View-controls toolbar ─────────────────────────────────────────────────────────

function ToolbarBtn({
  onClick, disabled, title, active, solidActive, children,
}: {
  onClick: () => void
  disabled?: boolean
  title?: string
  active?: boolean
  solidActive?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: solidActive ? T.accent : active ? `${T.accent}20` : 'none',
        border: solidActive ? `2px solid ${T.accent}` : active ? `1px solid ${T.accent}60` : `1px solid transparent`,
        color: disabled ? T.textMuted : (solidActive || active) ? (solidActive ? '#FFFFFF' : T.accent) : T.textSecond,
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: solidActive ? '3px 7px' : '4px 8px', borderRadius: 6,
        fontSize: 11, fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: 3,
        transition: 'color 0.12s, background 0.12s',
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={e => {
        if (!disabled && !active && !solidActive) {
          e.currentTarget.style.color      = T.textPrimary
          e.currentTarget.style.background = T.bgElevated
        }
      }}
      onMouseLeave={e => {
        if (!disabled && !active && !solidActive) {
          e.currentTarget.style.color      = T.textSecond
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
  magnifierActive,
  onToggleMagnifier,
}: {
  zoom:              number
  rotation:          number
  onZoom:            (z: number) => void
  onRotate:          () => void
  onFitWidth:        () => void
  magnifierActive:   boolean
  onToggleMagnifier: () => void
}) {
  const zoomIdx  = ZOOM_STEPS.indexOf(zoom)
  const canOut   = zoomIdx > 0
  const canIn    = zoomIdx < ZOOM_STEPS.length - 1
  const is100    = zoom === ZOOM_DEFAULT

  const zoomOut = () => { if (canOut)  onZoom(ZOOM_STEPS[zoomIdx - 1]) }
  const zoomIn  = () => { if (canIn)   onZoom(ZOOM_STEPS[zoomIdx + 1]) }

  return (
    <div style={{
      padding: '5px 12px', background: T.bgSurface, borderBottom: `1px solid ${T.border}`,
      display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
    }}>
      <ToolbarBtn onClick={onFitWidth} title="Fit to width (Ctrl+0)" active={is100}>
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="1" y="2" width="9" height="7" rx="1"/>
          <line x1="3" y1="5.5" x2="8" y2="5.5"/>
          <line x1="3" y1="3.5" x2="3" y2="7.5"/>
          <line x1="8" y1="3.5" x2="8" y2="7.5"/>
        </svg>
        Fit width
      </ToolbarBtn>

      <div style={{ width: 1, height: 16, background: T.border, margin: '0 2px' }} />

      <ToolbarBtn
        onClick={() => onZoom(ZOOM_STEPS[0])}
        disabled={zoomIdx === 0}
        title="Minimum zoom (25%)"
      >
        {ZOOM_STEPS[0]}%
      </ToolbarBtn>

      <ToolbarBtn onClick={zoomOut} disabled={!canOut} title="Zoom out (Ctrl+−)">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="5" cy="5" r="3.5"/>
          <line x1="7.5" y1="7.5" x2="10" y2="10"/>
          <line x1="3.5" y1="5" x2="6.5" y2="5"/>
        </svg>
      </ToolbarBtn>

      <span style={{
        minWidth: 42, textAlign: 'center',
        fontSize: 11, fontWeight: 700, color: T.textPrimary,
        fontFamily: 'monospace',
        padding: '3px 6px', background: T.bgElevated,
        border: `1px solid ${T.border}`, borderRadius: 5,
      }}>
        {zoom}%
      </span>

      <ToolbarBtn onClick={zoomIn} disabled={!canIn} title="Zoom in (Ctrl+=)">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="5" cy="5" r="3.5"/>
          <line x1="7.5" y1="7.5" x2="10" y2="10"/>
          <line x1="3.5" y1="5" x2="6.5" y2="5"/>
          <line x1="5" y1="3.5" x2="5" y2="6.5"/>
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

      <ToolbarBtn
        onClick={onToggleMagnifier}
        solidActive={magnifierActive}
        title={magnifierActive
          ? 'Magnifier ON — click a difference to zoom (click again to disable)'
          : 'Magnifier — activate then click a difference to zoom to it'}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="4.5" cy="4.5" r="3"/>
          <line x1="7" y1="7" x2="10" y2="10"/>
          <line x1="3" y1="4.5" x2="6" y2="4.5"/>
          <line x1="4.5" y1="3" x2="4.5" y2="6"/>
        </svg>
        Magnify
        {magnifierActive && (
          <span style={{
            fontSize: 8, fontWeight: 800, padding: '1px 4px', borderRadius: 3,
            background: 'rgba(255,255,255,0.25)', lineHeight: 1.4,
          }}>ON</span>
        )}
      </ToolbarBtn>

      <div style={{ width: 1, height: 16, background: T.border, margin: '0 2px' }} />

      <ToolbarBtn onClick={onRotate} title="Rotate 90° clockwise">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M2 5.5a3.5 3.5 0 107-0"/>
          <polyline points="7,2 9,4.5 6.5,4.5"/>
        </svg>
        Rotate
      </ToolbarBtn>

      {rotation !== 0 && (
        <span style={{ fontSize: 10, color: T.textSecond, fontFamily: 'monospace', marginLeft: 2 }}>
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
}

export default function ComparisonViewer({ processId, originalPdfPath }: Props) {
  const [comparisons, setComparisons] = useState<ComparisonRecord[]>([])
  const [activeRec,   setActiveRec]   = useState<ComparisonRecord | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [selectedId,  setSelectedId]  = useState<string | null>(null)
  const [showUpload,  setShowUpload]  = useState(false)
  const [loading,     setLoading]     = useState(true)

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

  // Magnifier toolbar button
  const [magnifierActive, setMagnifierActive] = useState(false)

  // Scroll refs — shared between both panels for sync
  const leftRef  = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const syncing  = useRef(false)

  // Captured scroll-centre fraction for zoom preservation
  const scrollFracRef = useRef<number>(0.5)

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

  // After zoom DOM update, restore fractional scroll centre.
  useLayoutEffect(() => {
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

  // ── Inject arrowPulse keyframes once at mount ─────────────────────────────────
  useEffect(() => {
    const id = 'cv-keyframes'
    if (!document.getElementById(id)) {
      const style = document.createElement('style')
      style.id = id
      style.textContent = `@keyframes starPulse {
        0%   { transform: translateY(-50%) scale(1.0) rotate(0deg);   opacity: 1;   }
        25%  { transform: translateY(-50%) scale(1.4) rotate(45deg);  opacity: 0.8; }
        50%  { transform: translateY(-50%) scale(1.0) rotate(90deg);  opacity: 1;   }
        75%  { transform: translateY(-50%) scale(1.3) rotate(135deg); opacity: 0.8; }
        100% { transform: translateY(-50%) scale(1.0) rotate(180deg); opacity: 1;   }
      }`
      document.head.appendChild(style)
    }
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
    setMagnifierActive(false)
  }

  // ── Magnifier: zoom to diff region from sidebar click ─────────────────────────
  const handleMagnifyDiff = useCallback((
    diffId: string,
    bbox: [number, number, number, number],
    pageSizePts: [number, number],
  ) => {
    const r = transformBbox(bbox, rotationRef.current, pageSizePts)
    setSelectedId(diffId)
    const panel = leftRef.current
    if (!panel) return
    const viewportH       = panel.clientHeight
    const viewportW       = panel.clientWidth
    const pageHeightAt100 = panel.scrollHeight / (zoom / 100)
    const pageWidthAt100  = panel.scrollWidth  / (zoom / 100)
    const zoomByH  = (0.5 * viewportH) / (r.height * pageHeightAt100) * 100
    const zoomByW  = (0.7 * viewportW) / (r.width  * pageWidthAt100)  * 100
    const targetZoom = Math.min(300, Math.max(150, Math.round(Math.min(zoomByH, zoomByW))))
    const snapped = ZOOM_STEPS.reduce((prev, curr) =>
      Math.abs(curr - targetZoom) < Math.abs(prev - targetZoom) ? curr : prev)
    const frac = r.top < 0.1
      ? 0.05
      : r.top + r.height > 0.9
        ? 0.95
        : r.top + r.height / 2
    console.log('MAGNIFY DIFF:', diffId, 'frac:', frac, 'zoom:', snapped)
    scrollFracRef.current = frac
    doZoom(snapped)
  }, [zoom, doZoom])

  const handleToggleMagnifier = useCallback(() => {
    setMagnifierActive(v => !v)
  }, [])

  // ── Render guards ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: 40, color: T.textMuted, fontSize: 12, fontFamily: 'monospace' }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Summary bar ── */}
      <SummaryBar rec={activeRec} onNew={() => setShowUpload(true)} />

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
          padding: '6px 16px', background: T.bgSurface, borderBottom: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <button
            onClick={() => { setCurrentPage(p => p - 1); setSelectedId(null) }}
            disabled={!hasPrev}
            style={{
              padding: '3px 10px', background: 'none', border: `1px solid ${T.border}`,
              borderRadius: 5, color: hasPrev ? T.textSecond : T.textMuted,
              cursor: hasPrev ? 'pointer' : 'not-allowed', fontSize: 12, opacity: hasPrev ? 1 : 0.3,
            }}
          >◀</button>

          <span style={{ fontSize: 11, color: T.textSecond }}>
            Page {currentPage + 1} of {pages.length}
          </span>

          <button
            onClick={() => { setCurrentPage(p => p + 1); setSelectedId(null) }}
            disabled={!hasNext}
            style={{
              padding: '3px 10px', background: 'none', border: `1px solid ${T.border}`,
              borderRadius: 5, color: hasNext ? T.accent : T.textMuted,
              cursor: hasNext ? 'pointer' : 'not-allowed', fontSize: 12, opacity: hasNext ? 1 : 0.3,
            }}
          >▶</button>

          <span style={{ fontSize: 10, color: T.textMuted, marginLeft: 4 }}>
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
        magnifierActive={magnifierActive}
        onToggleMagnifier={handleToggleMagnifier}
      />

      {/* ── Body: side-by-side panels + diff list ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        <PagePanel
          imgUrl={page.original_render_url}
          label="Original"
          page={page}
          zoom={zoom}
          rotation={rotation}
          selectedId={selectedId}
          onSelect={setSelectedId}
          scrollRef={leftRef}
          onScroll={() => syncScroll('left')}
        />

        <div style={{ width: 1, background: T.border, flexShrink: 0 }} />

        <PagePanel
          imgUrl={page.revised_render_url}
          label="Revised"
          page={page}
          zoom={zoom}
          rotation={rotation}
          selectedId={selectedId}
          onSelect={setSelectedId}
          scrollRef={rightRef}
          onScroll={() => syncScroll('right')}
        />

        <DiffListPanel
          page={page}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onMagnifyDiff={handleMagnifyDiff}
          magnifierActive={magnifierActive}
          reviews={reviews}
          submitting={submitting}
          onReview={handleReview}
          reviewerEmailSet={!!reviewerEmail.trim()}
        />
      </div>
    </div>
  )
}
