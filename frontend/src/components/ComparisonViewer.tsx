import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { processApi } from '../services/processApi'
import type {
  ComparisonRecord,
  DiffEntry,
  DiffSeverity,
  DiffType,
  PageComparison,
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
 *
 * PDF origin: top-left, y increases down.
 * Each rotation is clockwise. Fractions are relative to the OUTER display
 * container which already accounts for the axis swap at 90°/270°.
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
      // CW 90°: PDF x→display y (from bottom), PDF y→display x
      return { left: fy0, top: 1 - fx1, width: fy1 - fy0, height: fx1 - fx0 }
    case 180:
      return { left: 1 - fx1, top: 1 - fy1, width: fx1 - fx0, height: fy1 - fy0 }
    case 270:
      // CW 270°: PDF x→display y (from top), PDF y→display x (from right)
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
        const r = transformBbox(d.bbox, rotation, pageSizePts)
        const isSelected = selectedId === d.id
        const color      = SEV_COLOR[d.severity]
        return (
          <div
            key={d.id}
            title={d.description}
            onClick={() => onSelect(d.id)}
            style={{
              position: 'absolute',
              left:   `${r.left   * 100}%`,
              top:    `${r.top    * 100}%`,
              width:  `${r.width  * 100}%`,
              height: `${r.height * 100}%`,
              minWidth:  4,
              minHeight: 4,
              background: isSelected ? `${color}40` : `${color}28`,
              border: `${isSelected ? 2 : 1}px solid ${color}${isSelected ? 'DD' : '88'}`,
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

// ── Single page panel ─────────────────────────────────────────────────────────────

/**
 * The image display uses a two-layer approach for rotation:
 *
 *   OUTER div (position:relative, overflow:hidden)
 *     - dimensions = DISPLAY dimensions (axes swapped at 90°/270°)
 *     - width = zoom% of the scroll-viewport content width
 *     - aspect-ratio reflects the post-rotation shape
 *     - diff highlights are absolutely positioned here (display space)
 *
 *   INNER div (position:absolute, centered, rotated)
 *     - sized so that AFTER rotate(Ndeg) its visual footprint
 *       exactly fills the outer
 *     - for 90°/270°: inner_width = (W/H)*100% of outer, inner_height = (H/W)*100% of outer_height
 *     - for 0°/180°: inner is 100%×100% of outer
 *
 *   IMG fills the inner div 100%×100%.
 */
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

  // Outer display aspect-ratio: swapped when 90°/270°
  const displayAR = isSwapped ? `${H} / ${W}` : `${W} / ${H}`

  // Inner image dimensions (as % of outer) so that after CSS rotate it fills outer
  const innerWidthPct  = isSwapped ? (W / H) * 100 : 100
  const innerHeightPct = isSwapped ? (H / W) * 100 : 100

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      {/* Column label */}
      <div style={{
        padding: '6px 12px', flexShrink: 0,
        fontSize: 10, fontWeight: 700, color: T.textMuted,
        textTransform: 'uppercase', letterSpacing: '0.1em',
        background: T.bgSurface, borderBottom: `1px solid ${T.border}`,
      }}>
        {label}
      </div>

      {/* Scrollable viewport */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ flex: 1, overflow: 'auto', background: '#090B10' }}
      >
        <div style={{ padding: 16 }}>
          {imgUrl ? (
            /* OUTER: display-space container, zoom-scaled width */
            <div style={{
              position:    'relative',
              width:       `${zoom}%`,
              minWidth:    120,
              aspectRatio: displayAR,
              overflow:    'hidden',
              margin:      '0 auto',
            }}>
              {/* INNER: pre-rotation image, centered then rotated */}
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

              {/* Highlights: absolute in OUTER (display space, no rotation) */}
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

// ── Diff list sidebar ─────────────────────────────────────────────────────────────

function DiffListPanel({
  page,
  selectedId,
  onSelect,
}: {
  page:       PageComparison
  selectedId: string | null
  onSelect:   (id: string) => void
}) {
  const grouped: Record<string, DiffEntry[]> = {}
  for (const d of page.differences) {
    const g = TYPE_GROUP[d.type] ?? 'Other'
    if (!grouped[g]) grouped[g] = []
    grouped[g].push(d)
  }
  const totalCount = page.differences.length

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
              const isSelected = selectedId === d.id
              const color      = SEV_COLOR[d.severity]
              return (
                <div
                  key={d.id}
                  onClick={() => onSelect(d.id)}
                  style={{
                    padding: '9px 14px',
                    background:  isSelected ? `${color}12` : 'transparent',
                    borderBottom: `1px solid ${T.border}`,
                    cursor: 'pointer',
                    borderLeft: `3px solid ${isSelected ? color : 'transparent'}`,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => {
                    if (!isSelected)
                      (e.currentTarget as HTMLDivElement).style.background = T.bgElevated
                  }}
                  onMouseLeave={e => {
                    if (!isSelected)
                      (e.currentTarget as HTMLDivElement).style.background = 'transparent'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
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
  onClick, disabled, title, active, children,
}: {
  onClick: () => void
  disabled?: boolean
  title?: string
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: active ? `${T.accent}20` : 'none',
        border: active ? `1px solid ${T.accent}60` : `1px solid transparent`,
        color: disabled ? T.textMuted : active ? T.accent : T.textSecond,
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: '4px 8px', borderRadius: 6,
        fontSize: 11, fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: 3,
        transition: 'color 0.12s, background 0.12s',
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={e => {
        if (!disabled && !active) {
          e.currentTarget.style.color      = T.textPrimary
          e.currentTarget.style.background = T.bgElevated
        }
      }}
      onMouseLeave={e => {
        if (!disabled && !active) {
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
}: {
  zoom:       number
  rotation:   number
  onZoom:     (z: number) => void
  onRotate:   () => void
  onFitWidth: () => void
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
      {/* Fit to width */}
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

      {/* Min zoom jump */}
      <ToolbarBtn
        onClick={() => onZoom(ZOOM_STEPS[0])}
        disabled={zoomIdx === 0}
        title="Minimum zoom (25%)"
      >
        {ZOOM_STEPS[0]}%
      </ToolbarBtn>

      {/* Zoom out */}
      <ToolbarBtn onClick={zoomOut} disabled={!canOut} title="Zoom out (Ctrl+−)">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="5" cy="5" r="3.5"/>
          <line x1="7.5" y1="7.5" x2="10" y2="10"/>
          <line x1="3.5" y1="5" x2="6.5" y2="5"/>
        </svg>
      </ToolbarBtn>

      {/* Zoom level display */}
      <span style={{
        minWidth: 42, textAlign: 'center',
        fontSize: 11, fontWeight: 700, color: T.textPrimary,
        fontFamily: 'monospace',
        padding: '3px 6px', background: T.bgElevated,
        border: `1px solid ${T.border}`, borderRadius: 5,
      }}>
        {zoom}%
      </span>

      {/* Zoom in */}
      <ToolbarBtn onClick={zoomIn} disabled={!canIn} title="Zoom in (Ctrl+=)">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="5" cy="5" r="3.5"/>
          <line x1="7.5" y1="7.5" x2="10" y2="10"/>
          <line x1="3.5" y1="5" x2="6.5" y2="5"/>
          <line x1="5" y1="3.5" x2="5" y2="6.5"/>
        </svg>
      </ToolbarBtn>

      {/* Max zoom jump */}
      <ToolbarBtn
        onClick={() => onZoom(ZOOM_STEPS[ZOOM_STEPS.length - 1])}
        disabled={zoomIdx === ZOOM_STEPS.length - 1}
        title="Maximum zoom (400%)"
      >
        {ZOOM_STEPS[ZOOM_STEPS.length - 1]}%
      </ToolbarBtn>

      <div style={{ width: 1, height: 16, background: T.border, margin: '0 2px' }} />

      {/* Rotate CW */}
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

  // Scroll refs — shared between both panels for sync
  const leftRef  = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const syncing  = useRef(false)

  // Captured scroll-centre fraction for zoom preservation
  const scrollFracRef = useRef<number>(0.5)

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

  // After zoom DOM update, restore both panels to the same fractional centre
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
          // Capture scroll state inline since doZoom isn't accessible here
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

  const handleNewComparison = (rec: ComparisonRecord) => {
    setComparisons(prev => [rec, ...prev])
    setActiveRec(rec)
    setShowUpload(false)
    setCurrentPage(0)
    setSelectedId(null)
    setZoom(ZOOM_DEFAULT)
    setRotation(0)
  }

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
        />
      </div>
    </div>
  )
}
