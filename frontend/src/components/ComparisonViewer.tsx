import { useState, useEffect, useRef, useCallback } from 'react'
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

// ── Highlight overlay ─────────────────────────────────────────────────────────────

function DiffHighlights({
  diffs,
  pageSizePts,
  selectedId,
  onSelect,
  muted = false,
}: {
  diffs:       DiffEntry[]
  pageSizePts: [number, number]
  selectedId:  string | null
  onSelect:    (id: string) => void
  muted?:      boolean
}) {
  const [pw, ph] = pageSizePts
  return (
    <>
      {diffs.map(d => {
        const [x0, y0, x1, y1] = d.bbox
        const left   = `${(x0 / pw) * 100}%`
        const top    = `${(y0 / ph) * 100}%`
        const width  = `${((x1 - x0) / pw) * 100}%`
        const height = `${((y1 - y0) / ph) * 100}%`
        const isSelected = selectedId === d.id
        const color = SEV_COLOR[d.severity]
        return (
          <div
            key={d.id}
            title={d.description}
            onClick={() => onSelect(d.id)}
            style={{
              position: 'absolute',
              left, top, width, height,
              minWidth:  4,
              minHeight: 4,
              background: isSelected
                ? `${color}40`
                : muted ? `${color}18` : `${color}28`,
              border: `${isSelected ? 2 : 1}px solid ${color}${isSelected ? 'DD' : '88'}`,
              borderRadius: 2,
              cursor: 'pointer',
              boxSizing: 'border-box',
              transition: 'background 0.12s, border 0.12s',
              zIndex: isSelected ? 2 : 1,
            }}
          />
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
  selectedId,
  onSelect,
  scrollRef,
  onScroll,
}: {
  imgUrl:     string | null
  label:      string
  page:       PageComparison
  selectedId: string | null
  onSelect:   (id: string) => void
  scrollRef:  React.RefObject<HTMLDivElement>
  onScroll:   () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      {/* Label */}
      <div style={{
        padding: '6px 12px',
        fontSize: 10, fontWeight: 700, color: T.textMuted,
        textTransform: 'uppercase', letterSpacing: '0.1em',
        background: T.bgSurface, borderBottom: `1px solid ${T.border}`,
      }}>
        {label}
      </div>

      {/* Scrollable page */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', background: '#090B10' }}
      >
        <div style={{ padding: 16 }}>
          {imgUrl ? (
            <div style={{
              position: 'relative',
              aspectRatio: `${page.page_size_pts[0]} / ${page.page_size_pts[1]}`,
              width: '100%',
              maxWidth: 700,
              margin: '0 auto',
            }}>
              <img
                src={imgUrl}
                alt={label}
                style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }}
                draggable={false}
              />
              <DiffHighlights
                diffs={page.differences}
                pageSizePts={page.page_size_pts}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            </div>
          ) : (
            <div style={{
              width: '100%', maxWidth: 700, margin: '0 auto',
              aspectRatio: `${page.page_size_pts[0]} / ${page.page_size_pts[1]}`,
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
      {/* Header */}
      <div style={{
        padding: '10px 14px', borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.textSecond, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Differences
        </span>
        <span style={{
          padding: '2px 7px', borderRadius: 10,
          background: totalCount > 0 ? `${T.danger}20` : `${T.success}20`,
          color: totalCount > 0 ? T.danger : T.success,
          border: `1px solid ${totalCount > 0 ? T.danger : T.success}40`,
          fontSize: 10, fontWeight: 700,
        }}>
          {totalCount}
        </span>
      </div>

      {/* List */}
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
                    background: isSelected ? `${color}12` : 'transparent',
                    borderBottom: `1px solid ${T.border}`,
                    cursor: 'pointer',
                    borderLeft: `3px solid ${isSelected ? color : 'transparent'}`,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => {
                    if (!isSelected)
                      (e.currentTarget as HTMLDivElement).style.background = `${T.bgElevated}`
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
                    <span style={{
                      fontSize: 8, color: T.textMuted, textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}>
                      {d.severity}
                    </span>
                  </div>
                  <div style={{
                    fontSize: 11, color: T.textPrimary, lineHeight: 1.4,
                    wordBreak: 'break-word',
                  }}>
                    {d.description.length > 80
                      ? d.description.slice(0, 80) + '…'
                      : d.description}
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
  const [file,     setFile]     = useState<File | null>(null)
  const [running,  setRunning]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const run = async () => {
    if (!file) return
    setRunning(true)
    setError(null)
    try {
      const rec = await processApi.runComparison(
        processId,
        file,
        originalPdfPath ?? undefined,
      )
      onComplete(rec)
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
      <div style={{ fontSize: 14, fontWeight: 700, color: T.textPrimary }}>
        Run Artwork Comparison
      </div>
      <div style={{ fontSize: 12, color: T.textSecond, maxWidth: 420, textAlign: 'center', lineHeight: 1.6 }}>
        Upload the revised PDF from your design studio. The system will automatically
        detect text, code, visual, and dimensional differences.
      </div>

      {error && (
        <div style={{
          padding: '10px 16px', background: `${T.danger}18`,
          border: `1px solid ${T.danger}40`, borderRadius: 8,
          color: '#fca5a5', fontSize: 12, maxWidth: 400, textAlign: 'center',
        }}>
          {error}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".pdf"
        style={{ display: 'none' }}
        onChange={e => setFile(e.target.files?.[0] ?? null)}
      />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          onClick={() => fileRef.current?.click()}
          style={{
            padding: '9px 18px', background: T.bgElevated,
            border: `1px solid ${T.border}`, borderRadius: 8,
            color: T.textSecond, cursor: 'pointer', fontSize: 12,
          }}
        >
          {file ? '↺ Change file' : '↑ Choose revised PDF'}
        </button>
        {file && (
          <span style={{ fontSize: 11, color: T.success }}>✓ {file.name}</span>
        )}
      </div>

      <button
        onClick={run}
        disabled={!file || running}
        style={{
          padding: '10px 28px',
          background: file && !running ? T.accent : T.bgElevated,
          color: file && !running ? '#fff' : T.textMuted,
          border: 'none', borderRadius: 8, cursor: file && !running ? 'pointer' : 'not-allowed',
          fontSize: 13, fontWeight: 700,
        }}
      >
        {running ? 'Analysing…' : 'Compare Artworks'}
      </button>
    </div>
  )
}

// ── Summary bar ───────────────────────────────────────────────────────────────────

function SummaryBar({
  rec,
  onNew,
}: {
  rec:   ComparisonRecord
  onNew: () => void
}) {
  const s = rec.result?.summary
  if (!s) return null

  const pills: { label: string; value: number; color: string }[] = [
    { label: 'Text',        value: s.text_changes,        color: T.accent  },
    { label: 'Codes',       value: s.code_changes,        color: T.danger  },
    { label: 'Visual',      value: s.visual_changes,      color: T.warning },
    { label: 'Dimensional', value: s.dimensional_changes,  color: '#7C3AED' },
    { label: 'Compliance',  value: s.compliance_flags,    color: T.danger  },
  ].filter(p => p.value > 0)

  const total = s.total_differences

  return (
    <div style={{
      padding: '8px 16px', background: T.bgSurface,
      borderBottom: `1px solid ${T.border}`,
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    }}>
      <span style={{
        fontSize: 11, fontWeight: 700,
        color: total === 0 ? T.success : T.textPrimary,
      }}>
        {total === 0 ? '✓ Identical' : `${total} difference${total !== 1 ? 's' : ''}`}
      </span>

      {pills.map(p => (
        <span key={p.label} style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 10,
          background: `${p.color}18`, color: p.color,
          border: `1px solid ${p.color}40`, fontWeight: 700,
        }}>
          {p.label}: {p.value}
        </span>
      ))}

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: T.textMuted, fontFamily: 'monospace' }}>
          {new Date(rec.created_at).toLocaleString()}
        </span>
        <button
          onClick={onNew}
          style={{
            padding: '5px 12px', background: 'transparent',
            border: `1px solid ${T.border}`, borderRadius: 6,
            color: T.textSecond, cursor: 'pointer', fontSize: 11,
          }}
        >
          + New comparison
        </button>
      </div>
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

  // Synchronized scrolling refs
  const leftRef  = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const syncing  = useRef(false)

  const syncScroll = useCallback((source: 'left' | 'right') => {
    if (syncing.current) return
    syncing.current = true
    const src  = source === 'left' ? leftRef.current  : rightRef.current
    const dest = source === 'left' ? rightRef.current : leftRef.current
    if (src && dest) dest.scrollTop = src.scrollTop
    requestAnimationFrame(() => { syncing.current = false })
  }, [])

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
  }

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

      {/* Summary bar */}
      <SummaryBar rec={activeRec} onNew={() => setShowUpload(true)} />

      {/* Page navigation */}
      {pages.length > 1 && (
        <div style={{
          padding: '6px 16px', background: T.bgSurface,
          borderBottom: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <button
            onClick={() => { setCurrentPage(p => p - 1); setSelectedId(null) }}
            disabled={!hasPrev}
            style={{
              padding: '3px 10px', background: 'none',
              border: `1px solid ${T.border}`, borderRadius: 5,
              color: hasPrev ? T.textSecond : T.textMuted, cursor: hasPrev ? 'pointer' : 'not-allowed',
              fontSize: 12, opacity: hasPrev ? 1 : 0.3,
            }}
          >◀</button>

          <span style={{ fontSize: 11, color: T.textSecond }}>
            Page {currentPage + 1} of {pages.length}
          </span>

          <button
            onClick={() => { setCurrentPage(p => p + 1); setSelectedId(null) }}
            disabled={!hasNext}
            style={{
              padding: '3px 10px', background: 'none',
              border: `1px solid ${T.border}`, borderRadius: 5,
              color: hasNext ? T.accent : T.textMuted, cursor: hasNext ? 'pointer' : 'not-allowed',
              fontSize: 12, opacity: hasNext ? 1 : 0.3,
            }}
          >▶</button>

          <span style={{ fontSize: 10, color: T.textMuted, marginLeft: 4 }}>
            {page.differences.length} difference{page.differences.length !== 1 ? 's' : ''} on this page
          </span>
        </div>
      )}

      {/* Body: side-by-side panels + diff list */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left: Original */}
        <PagePanel
          imgUrl={page.original_render_url}
          label="Original"
          page={page}
          selectedId={selectedId}
          onSelect={setSelectedId}
          scrollRef={leftRef}
          onScroll={() => syncScroll('left')}
        />

        {/* Divider */}
        <div style={{ width: 1, background: T.border, flexShrink: 0 }} />

        {/* Right: Revised */}
        <PagePanel
          imgUrl={page.revised_render_url}
          label="Revised"
          page={page}
          selectedId={selectedId}
          onSelect={setSelectedId}
          scrollRef={rightRef}
          onScroll={() => syncScroll('right')}
        />

        {/* Diff list sidebar */}
        <DiffListPanel
          page={page}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
    </div>
  )
}
