// src/components/Studio.tsx
// INTEGRATION: drag callback, multi-select, zoom, rotation all wired up

import { useState, useCallback, useEffect, useRef } from 'react'
import StudioCanvas  from './canvas/StudioCanvas'
import ActionPanel   from './toolbar/ActionPanel'
import Sidebar       from './sidebar/Sidebar'
import { useStore }  from '../store'
import { api }       from '../services/api'
import type { Artwork, ArtElement, Selection } from '../types'

interface StudioProps {
  artwork: Artwork
  onBack:  () => void
}

export default function Studio({ artwork, onBack }: StudioProps) {
  const {
    page, setPage, pagePreview, setPagePreview,
    elements, setElements, actions, setActions,
    activeTool, setActiveTool, error, setError, loading, setLoading,
  } = useStore()

  const [selection,     setSelection]     = useState<Selection | null>(null)
  const [nearestElem,   setNearestElem]   = useState<ArtElement | null>(null)
  const [multiElems,    setMultiElems]    = useState<ArtElement[]>([])
  const [showPanel,     setShowPanel]     = useState(false)
  // FIX #3: drag delta state — pre-fills Move action with drag result
  const [dragDelta,     setDragDelta]     = useState<{ dx_mm: number; dy_mm: number } | null>(null)

  // Load page on mount / page change
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
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erro ao carregar')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [artwork.id, page])

  // Called when user clicks or draws a region on the canvas
  const handleSelection = useCallback((sel: Selection, elem: ArtElement | null) => {
    setSelection(sel)
    setNearestElem(elem)
    setMultiElems([])
    setDragDelta(null)
    setShowPanel(true)
  }, [])

  // FIX #2: multi-select callback
  const handleMultiSelection = useCallback((elems: ArtElement[]) => {
    setMultiElems(elems)
    if (elems.length > 0) {
      // Build a bounding selection that covers all elements
      const minX = Math.min(...elems.map(e => e.x_norm))
      const minY = Math.min(...elems.map(e => e.y_norm))
      const maxX = Math.max(...elems.map(e => e.x_norm + e.w_norm))
      const maxY = Math.max(...elems.map(e => e.y_norm + e.h_norm))
      const pw   = pagePreview?.width_px  || 800
      const ph   = pagePreview?.height_px || 1000
      setSelection({
        x: minX, y: minY, w: maxX - minX, h: maxY - minY,
        x_px: minX * pw, y_px: minY * ph,
        w_px: (maxX - minX) * pw, h_px: (maxY - minY) * ph,
      })
      setNearestElem(elems[0])
      setShowPanel(true)
    }
  }, [pagePreview])

  // FIX #3: drag & drop move — opens action panel pre-filled
  const handleDragMove = useCallback((elemId: string, dx_mm: number, dy_mm: number) => {
    const elem = elements.find(e => e.elem_id === elemId)
    if (!elem || !pagePreview) return
    const pw = pagePreview.width_px, ph = pagePreview.height_px
    setNearestElem(elem)
    setMultiElems([])
    setDragDelta({ dx_mm, dy_mm })
    setSelection({
      x: elem.x_norm, y: elem.y_norm,
      w: elem.w_norm, h: elem.h_norm,
      x_px: elem.x_norm * pw, y_px: elem.y_norm * ph,
      w_px: elem.w_norm * pw, h_px: elem.h_norm * ph,
    })
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

  const topBtn: React.CSSProperties = {
    background: 'transparent', border: 'none', color: '#aaa',
    cursor: 'pointer', padding: '6px 8px', borderRadius: 6, fontSize: 14,
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0d0d1a' }}>

      {/* ── Top bar ── */}
      <div style={{
        height: 50, background: '#12121f', borderBottom: '1px solid #222',
        display: 'flex', alignItems: 'center', padding: '0 12px', gap: 10, flexShrink: 0,
      }}>
        <button onClick={onBack} style={{ ...topBtn, fontSize: 18 }}>←</button>
        <div style={{ width: 1, height: 24, background: '#333' }} />
        <div>
          <div style={{ color: '#fff', fontSize: 13, fontWeight: 600, lineHeight: 1 }}>{artwork.filename}</div>
          <div style={{ color: '#555', fontSize: 10, marginTop: 1 }}>
            {artwork.total_pages} pág. · {artwork.page_width_pts?.toFixed(0)} × {artwork.page_height_pts?.toFixed(0)} pts
          </div>
        </div>
        <div style={{ flex: 1 }} />

        {/* Tool selector */}
        <div style={{ display: 'flex', gap: 4, background: '#1a1a2e', borderRadius: 8, padding: 3 }}>
          {[
            { id: 'select', icon: '↖️', label: 'Selecionar' },
            { id: 'region', icon: '⬜', label: 'Região livre' },
          ].map(t => (
            <button key={t.id} onClick={() => setActiveTool(t.id as any)} title={t.label}
              style={{ padding: '5px 10px', border: 'none', borderRadius: 6,
                background: activeTool === t.id ? '#185FA5' : 'transparent',
                color: '#fff', cursor: 'pointer', fontSize: 12 }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Multi-select hint */}
        {multiElems.length > 1 && (
          <div style={{ padding: '4px 10px', background: '#1a0d2e', border: '1px solid #9C27B0', borderRadius: 6, fontSize: 11, color: '#CE93D8' }}>
            🟣 {multiElems.length} elementos selecionados
          </div>
        )}

        {error && (
          <div style={{ padding: '4px 10px', background: '#2a1010', border: '1px solid #5a1010', borderRadius: 6, fontSize: 11, color: '#f88', maxWidth: 200 }}>
            ⚠️ {error.slice(0, 40)}
            <button onClick={() => setError(null)} style={{ marginLeft: 6, background: 'none', border: 'none', color: '#f88', cursor: 'pointer' }}>✕</button>
          </div>
        )}
        {loading && <div style={{ color: '#555', fontSize: 12 }}>⏳ Carregando...</div>}
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Canvas area */}
        <div style={{
          flex: 1, overflow: 'auto', background: '#1a1a2e',
          display: 'flex', justifyContent: 'center',
          alignItems: 'flex-start', padding: 32, position: 'relative',
        }}>
          {pagePreview ? (
            <>
              <StudioCanvas
                previewUrl       = {pagePreview.preview_url}
                width            = {pagePreview.width_px}
                height           = {pagePreview.height_px}
                elements         = {elements}
                onSelection      = {handleSelection}
                onMultiSelection = {handleMultiSelection}
                onDragMove       = {handleDragMove}
              />

              {/* Action panel */}
              {showPanel && selection && (
                <ActionPanel
                  artworkId      = {artwork.id}
                  page           = {page}
                  selection      = {selection}
                  element        = {nearestElem}
                  multiElements  = {multiElems.length > 1 ? multiElems : undefined}
                  dragDelta      = {dragDelta || undefined}
                  onClose        = {() => { setShowPanel(false); setSelection(null); setDragDelta(null) }}
                  onSaved        = {handleActionSaved}
                />
              )}

              {/* Element hover tooltip */}
              <ElementTooltip />
            </>
          ) : loading ? (
            <div style={{ color: '#555', fontSize: 14, marginTop: 80 }}>⏳ Renderizando arte...</div>
          ) : (
            <div style={{ color: '#555', fontSize: 14, marginTop: 80 }}>Selecione uma página</div>
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
  const { hoveredElem } = useStore()
  if (!hoveredElem) return null
  return (
    <div style={{
      position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
      background: '#1a1a2e', border: '1px solid #333', borderRadius: 8,
      padding: '6px 14px', fontSize: 12, color: '#ddd',
      pointerEvents: 'none', zIndex: 300, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
    }}>
      {hoveredElem.type === 'text' ? '📝' : '🖼️'}{' '}
      <strong>{hoveredElem.type.toUpperCase()}</strong>
      {hoveredElem.font_size && ` · ${hoveredElem.font_size.toFixed(1)}pt`}
      {hoveredElem.font_name && ` · ${hoveredElem.font_name.slice(0, 20)}`}
      {' · '}<span style={{ color: '#888' }}>{hoveredElem.label?.slice(0, 50)}</span>
    </div>
  )
}
