import { useState, useCallback, useEffect } from 'react'
import StudioCanvas from './canvas/StudioCanvas'
import ActionPanel   from './toolbar/ActionPanel'
import Sidebar       from './sidebar/Sidebar'
import { useStore }  from '../store'
import { api }       from '../services/api'
import type { Artwork, ArtElement, Selection } from '../types'

interface StudioProps {
  artwork: Artwork
  onBack:  () => void
}

// ── Design tokens ─────────────────────────────────────────────────
const T = {
  bgBase:     '#0C0E14',
  bgSurface:  '#141720',
  border:     '#2A2F3F',
  accent:     '#2D6BE4',
  textPrimary:'#E8ECF4',
  textSecond: '#7A8299',
  textMuted:  '#3D4560',
  danger:     '#D63C3C',
  success:    '#1A9E6F',
} as const

export default function Studio({ artwork, onBack }: StudioProps) {
  const {
    page, setPage, pagePreview, setPagePreview,
    elements, setElements, actions, setActions,
    activeTool, setActiveTool, error, setError, loading, setLoading,
  } = useStore()

  const [selection,   setSelection]   = useState<Selection | null>(null)
  const [nearestElem, setNearestElem] = useState<ArtElement | null>(null)
  const [multiElems,  setMultiElems]  = useState<ArtElement[]>([])
  const [showPanel,   setShowPanel]   = useState(false)
  const [dragDelta,   setDragDelta]   = useState<{ dx_mm: number; dy_mm: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const [preview, elems, acts] = await Promise.all([
          api.getPage(artwork.id, page),
          api.getElements(artwork.id, page),
          api.listActions(artwork.id, page),
        ])
        if (!cancelled) {
          setPagePreview(preview)
          setElements(elems)
          setActions(acts)
          setSelection(null)
          setShowPanel(false)
          setDragDelta(null)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error loading page')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [artwork.id, page])

  const handleSelection = useCallback((sel: Selection, elem: ArtElement | null) => {
    setSelection(sel)
    setNearestElem(elem)
    setMultiElems([])
    setDragDelta(null)
    setShowPanel(true)
  }, [])

  const handleMultiSelection = useCallback((elems: ArtElement[]) => {
    setMultiElems(elems)
    if (elems.length > 0 && pagePreview) {
      const minX = Math.min(...elems.map(e => e.x_norm))
      const minY = Math.min(...elems.map(e => e.y_norm))
      const maxX = Math.max(...elems.map(e => e.x_norm + e.w_norm))
      const maxY = Math.max(...elems.map(e => e.y_norm + e.h_norm))
      const pw = pagePreview.width_px, ph = pagePreview.height_px
      setSelection({ x: minX, y: minY, w: maxX-minX, h: maxY-minY,
        x_px: minX*pw, y_px: minY*ph, w_px: (maxX-minX)*pw, h_px: (maxY-minY)*ph })
      setNearestElem(elems[0])
      setShowPanel(true)
    }
  }, [pagePreview])

  const handleDragMove = useCallback((elemId: string, dx_mm: number, dy_mm: number) => {
    const elem = elements.find(e => e.elem_id === elemId)
    if (!elem || !pagePreview) return
    const pw = pagePreview.width_px, ph = pagePreview.height_px
    setNearestElem(elem)
    setMultiElems([])
    setDragDelta({ dx_mm, dy_mm })
    setSelection({ x: elem.x_norm, y: elem.y_norm, w: elem.w_norm, h: elem.h_norm,
      x_px: elem.x_norm*pw, y_px: elem.y_norm*ph, w_px: elem.w_norm*pw, h_px: elem.h_norm*ph })
    setShowPanel(true)
  }, [elements, pagePreview])

  const handleActionSaved = useCallback(async () => {
    setShowPanel(false)
    setSelection(null)
    setDragDelta(null)
    setMultiElems([])
    const acts = await api.listActions(artwork.id, page)
    setActions(acts)
  }, [artwork.id, page])

  // mm dimensions for display
  const wMm = pagePreview
    ? (pagePreview.width_pts  * 25.4 / 72).toFixed(0)
    : artwork.page_width_pts  ? (artwork.page_width_pts  * 25.4 / 72).toFixed(0) : null
  const hMm = pagePreview
    ? (pagePreview.height_pts * 25.4 / 72).toFixed(0)
    : artwork.page_height_pts ? (artwork.page_height_pts * 25.4 / 72).toFixed(0) : null

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: T.bgBase }}>

      {/* ── Top bar ── */}
      <div style={{
        height: 52, background: T.bgSurface, borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', padding: '0 14px', gap: 12, flexShrink: 0,
      }}>
        {/* Back */}
        <button onClick={onBack} title="Back to projects" style={{
          background: 'none', border: `1px solid ${T.border}`,
          color: T.textSecond, cursor: 'pointer', padding: '5px 8px',
          borderRadius: 6, fontSize: 14, lineHeight: 1, transition: 'color 0.12s, border-color 0.12s',
        }}
          onMouseEnter={e => { e.currentTarget.style.color = T.textPrimary; e.currentTarget.style.borderColor = '#4A5070' }}
          onMouseLeave={e => { e.currentTarget.style.color = T.textSecond;  e.currentTarget.style.borderColor = T.border }}
        >←</button>

        <div style={{ width: 1, height: 24, background: T.border }} />

        {/* Artwork info */}
        <div style={{ minWidth: 0 }}>
          <div style={{
            color: T.textPrimary, fontSize: 13, fontWeight: 600,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280,
          }}>
            {artwork.filename}
          </div>
          <div style={{ color: T.textMuted, fontSize: 10, fontFamily: 'monospace', marginTop: 1 }}>
            {artwork.total_pages} {artwork.total_pages === 1 ? 'page' : 'pages'}
            {wMm && hMm ? ` · ${wMm} × ${hMm} mm` : ''}
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Multi-select indicator */}
        {multiElems.length > 1 && (
          <div style={{
            padding: '4px 10px', background: '#7C3AED18',
            border: '1px solid #7C3AED50', borderRadius: 6,
            fontSize: 11, color: '#a78bfa', fontWeight: 600,
          }}>
            {multiElems.length} selected
          </div>
        )}

        {/* Error toast */}
        {error && (
          <div style={{
            padding: '4px 10px', background: '#D63C3C18',
            border: '1px solid #D63C3C50', borderRadius: 6,
            fontSize: 11, color: '#fca5a5',
            display: 'flex', alignItems: 'center', gap: 6, maxWidth: 280,
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {error.slice(0, 50)}
            </span>
            <button onClick={() => setError(null)} style={{
              background: 'none', border: 'none', color: '#fca5a5',
              cursor: 'pointer', padding: 0, fontSize: 13, flexShrink: 0,
            }}>✕</button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ color: T.textMuted, fontSize: 11 }}>Loading…</div>
        )}

        {/* Tool switcher */}
        <div style={{
          display: 'flex', gap: 2, background: T.bgBase,
          borderRadius: 8, padding: 3, border: `1px solid ${T.border}`,
        }}>
          {[
            { id: 'select', label: 'Select', title: 'Select (V)' },
            { id: 'region', label: 'Region', title: 'Draw region (R)' },
          ].map(t => (
            <button key={t.id} onClick={() => setActiveTool(t.id as any)} title={t.title} style={{
              padding: '5px 12px', border: 'none', borderRadius: 6,
              background: activeTool === t.id ? T.accent : 'transparent',
              color: activeTool === t.id ? '#fff' : T.textSecond,
              cursor: 'pointer', fontSize: 11, fontWeight: 600,
              letterSpacing: '0.03em', transition: 'all 0.12s',
            }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Canvas area */}
        <div style={{
          flex: 1, overflow: 'auto', background: '#101318',
          display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
          padding: '32px 32px 80px', position: 'relative',
        }}>
          {pagePreview ? (
            <>
              <StudioCanvas
                previewUrl       = {pagePreview.preview_url}
                width            = {pagePreview.width_px}
                height           = {pagePreview.height_px}
                elements         = {elements}
                dpi              = {pagePreview.dpi}
                onSelection      = {handleSelection}
                onMultiSelection = {handleMultiSelection}
                onDragMove       = {handleDragMove}
              />
              {showPanel && selection && (
                <ActionPanel
                  artworkId     = {artwork.id}
                  page          = {page}
                  selection     = {selection}
                  element       = {nearestElem}
                  multiElements = {multiElems.length > 1 ? multiElems : undefined}
                  dragDelta     = {dragDelta || undefined}
                  onClose       = {() => { setShowPanel(false); setSelection(null); setDragDelta(null) }}
                  onSaved       = {handleActionSaved}
                />
              )}
              <ElementTooltip />
            </>
          ) : loading ? (
            <div style={{ color: T.textMuted, fontSize: 13, marginTop: 80, fontFamily: 'monospace' }}>
              Rendering artwork…
            </div>
          ) : (
            <div style={{ color: T.textMuted, fontSize: 13, marginTop: 80 }}>
              Select a page
            </div>
          )}
        </div>

        {/* Sidebar */}
        <Sidebar
          artworkId    = {artwork.id}
          page         = {page}
          totalPages   = {artwork.total_pages}
          onPageChange = {(p) => { setPage(p); setShowPanel(false); setDragDelta(null) }}
        />
      </div>
    </div>
  )
}

function ElementTooltip() {
  const { hoveredElem } = useStore() as any
  if (!hoveredElem) return null

  const typeColors: Record<string, string> = {
    text: '#2D6BE4', image: '#1A9E6F', logo: '#C47E1A',
    barcode: '#D63C3C', vector: '#7A8299',
  }
  const color = typeColors[hoveredElem.type] || '#7A8299'

  return (
    <div style={{
      position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
      background: '#1C2030', border: '1px solid #2A2F3F',
      borderRadius: 8, padding: '6px 14px',
      fontSize: 11, color: '#E8ECF4',
      pointerEvents: 'none', zIndex: 300,
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', gap: 8,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color,
        background: `${color}20`, border: `1px solid ${color}40`,
        padding: '2px 5px', borderRadius: 3, textTransform: 'uppercase',
      }}>
        {hoveredElem.type}
      </span>
      {hoveredElem.font_size && (
        <span style={{ color: '#7A8299', fontFamily: 'monospace', fontSize: 10 }}>
          {hoveredElem.font_size.toFixed(1)} pt
        </span>
      )}
      <span style={{ color: '#7A8299', fontFamily: 'ui-monospace, monospace', fontSize: 10 }}>
        {hoveredElem.label?.slice(0, 55)}{(hoveredElem.label?.length || 0) > 55 ? '…' : ''}
      </span>
    </div>
  )
}
