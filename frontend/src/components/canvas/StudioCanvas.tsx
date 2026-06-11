import { useEffect, useRef, useCallback, useState } from 'react'
import { fabric } from 'fabric'
import { useStore } from '../../store'
import type { ArtElement, Selection } from '../../types'

interface StudioCanvasProps {
  previewUrl:       string
  width:            number
  height:           number
  elements:         ArtElement[]
  dpi?:             number
  onSelection:      (sel: Selection, nearestElem: ArtElement | null) => void
  onMultiSelection?: (elems: ArtElement[]) => void
  onDragMove?:      (elemId: string, dx_mm: number, dy_mm: number) => void
}

// Design tokens (mirrors Sidebar)
const T = {
  border:     '#2A2F3F',
  accent:     '#2D6BE4',
  bgElevated: '#1C2030',
  textSecond: '#7A8299',
  textPrimary:'#E8ECF4',
} as const

const TYPE_FILL: Record<string, string> = {
  text:    'rgba(45,107,228,0.08)',
  image:   'rgba(26,158,111,0.08)',
  logo:    'rgba(196,126,26,0.08)',
  barcode: 'rgba(214,60,60,0.08)',
  vector:  'rgba(100,100,100,0.06)',
}
const TYPE_STROKE: Record<string, string> = {
  text:    '#2D6BE4',
  image:   '#1A9E6F',
  logo:    '#C47E1A',
  barcode: '#D63C3C',
  vector:  '#555',
}

const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0]

export default function StudioCanvas({
  previewUrl, width, height, elements, dpi = 150,
  onSelection, onMultiSelection, onDragMove,
}: StudioCanvasProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const fabricRef  = useRef<fabric.Canvas | null>(null)
  const isDrawing  = useRef(false)
  const startPt    = useRef<{ x: number; y: number } | null>(null)
  const selRect    = useRef<fabric.Rect | null>(null)
  const elemObjs   = useRef<Map<string, fabric.Rect>>(new Map())
  const dragTarget = useRef<{ elem: ArtElement; startX: number; startY: number } | null>(null)
  const shiftHeld  = useRef(false)
  const multiSel   = useRef<ArtElement[]>([])

  const [zoomIdx,  setZoomIdx]  = useState(5)
  const [rotation, setRotation] = useState(0)
  const zoom = ZOOM_LEVELS[zoomIdx]

  const { activeTool, actions, setHoveredElem, setSelectedElem } = useStore()

  // Canvas init + background image
  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = new fabric.Canvas(canvasRef.current, {
      width, height, selection: false, preserveObjectStacking: true,
    })
    fabricRef.current = canvas
    fabric.Image.fromURL(previewUrl, (img) => {
      img.set({ selectable: false, evented: false })
      if (rotation !== 0) {
        img.rotate(rotation)
        if (rotation === 90 || rotation === 270) img.scaleToHeight(width)
        else img.scaleToWidth(width)
        img.set({
          left: rotation === 90 ? width : rotation === 180 ? width : 0,
          top:  rotation === 180 ? height : rotation === 270 ? height : 0,
        })
      } else {
        img.scaleToWidth(width)
      }
      canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas))
    }, { crossOrigin: 'anonymous' })
    return () => { canvas.dispose(); fabricRef.current = null }
  }, [previewUrl, width, height, rotation])

  // Zoom
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    canvas.setZoom(zoom)
    canvas.setWidth(width * zoom)
    canvas.setHeight(height * zoom)
    canvas.renderAll()
  }, [zoom, width, height])

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftHeld.current = true
      if ((e.ctrlKey || e.metaKey) && e.key === '=') { e.preventDefault(); setZoomIdx(i => Math.min(ZOOM_LEVELS.length-1, i+1)) }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); setZoomIdx(i => Math.max(0, i-1)) }
      if (e.key === 'r' || e.key === 'R') setRotation(r => (r + 90) % 360)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        shiftHeld.current = false
        if (multiSel.current.length > 1 && onMultiSelection) onMultiSelection([...multiSel.current])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp) }
  }, [onMultiSelection])

  // Element overlays
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    elemObjs.current.forEach(obj => canvas.remove(obj))
    elemObjs.current.clear()

    elements.forEach(elem => {
      const ex = elem.x_norm * width, ey = elem.y_norm * height
      const ew = elem.w_norm * width, eh = elem.h_norm * height
      const fill   = TYPE_FILL[elem.type]   || 'rgba(45,107,228,0.08)'
      const stroke = TYPE_STROKE[elem.type] || T.accent

      const rect = new fabric.Rect({
        left: ex, top: ey, width: ew, height: eh,
        fill, stroke, strokeWidth: 1,
        strokeDashArray: [4, 3], selectable: false, evented: true, opacity: 0.5,
        data: { elemId: elem.elem_id, elem },
      })

      rect.on('mouseover', () => {
        rect.set({ opacity: 1, strokeWidth: 2, strokeDashArray: [] })
        canvas.renderAll()
        setHoveredElem(elem)
      })
      rect.on('mouseout', () => {
        rect.set({ opacity: 0.5, strokeWidth: 1, strokeDashArray: [4, 3] })
        canvas.renderAll()
        setHoveredElem(null)
      })
      rect.on('mousedown', (opt: any) => {
        if (shiftHeld.current) {
          if (!multiSel.current.find(e => e.elem_id === elem.elem_id)) {
            multiSel.current.push(elem)
            rect.set({ stroke: '#7C3AED', strokeWidth: 2, strokeDashArray: [] })
            canvas.renderAll()
          }
          return
        }
        multiSel.current = [elem]
        setSelectedElem(elem)
        onSelection({ x: elem.x_norm, y: elem.y_norm, w: elem.w_norm, h: elem.h_norm,
          x_px: ex, y_px: ey, w_px: ew, h_px: eh }, elem)
        if (elem.allowed_actions.includes('move') && activeTool === 'select') {
          const ptr = canvas.getPointer(opt.e)
          dragTarget.current = { elem, startX: ptr.x / zoom, startY: ptr.y / zoom }
        }
      })

      canvas.add(rect)
      elemObjs.current.set(elem.elem_id, rect)
    })

    const onMouseMove = (opt: fabric.IEvent<MouseEvent>) => {
      if (!dragTarget.current) return
      const ptr = canvas.getPointer(opt.e)
      const dx = ptr.x / zoom - dragTarget.current.startX
      const dy = ptr.y / zoom - dragTarget.current.startY
      const obj = elemObjs.current.get(dragTarget.current.elem.elem_id)
      if (obj) {
        obj.set({
          left: dragTarget.current.elem.x_norm * width + dx,
          top:  dragTarget.current.elem.y_norm * height + dy,
        })
        canvas.renderAll()
      }
    }
    const onMouseUp = (opt: fabric.IEvent<MouseEvent>) => {
      if (!dragTarget.current) return
      const ptr = canvas.getPointer(opt.e)
      const dx_px = ptr.x / zoom - dragTarget.current.startX
      const dy_px = ptr.y / zoom - dragTarget.current.startY
      const px_per_mm = dpi / 25.4
      const dx_mm = dx_px / px_per_mm, dy_mm = dy_px / px_per_mm
      if (Math.abs(dx_mm) > 0.5 || Math.abs(dy_mm) > 0.5)
        onDragMove?.(dragTarget.current.elem.elem_id, dx_mm, dy_mm)
      dragTarget.current = null
    }
    canvas.on('mouse:move', onMouseMove)
    canvas.on('mouse:up', onMouseUp)
    canvas.renderAll()
    return () => { canvas.off('mouse:move', onMouseMove); canvas.off('mouse:up', onMouseUp) }
  }, [elements, width, height, rotation, zoom, activeTool, dpi])

  // Action badges — positioned in canvas coords (Fabric applies zoom automatically)
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    canvas.getObjects().filter((o: any) => o.data?.isAction).forEach((o: fabric.Object) => canvas.remove(o))
    actions.forEach(action => {
      if (!action.sel_x) return
      const x = action.sel_x * width, y = (action.sel_y || 0) * height
      const w = (action.sel_w || 0) * width, h = (action.sel_h || 0) * height
      const color = ({
        replace: '#1A9E6F', delete: '#D63C3C',
        move: '#2D6BE4', resize: '#C47E1A', bold: '#7C3AED',
      } as any)[action.action_type] || '#888'
      canvas.add(new fabric.Rect({
        left: x, top: y, width: w, height: h,
        fill: 'transparent', stroke: color, strokeWidth: 1,
        strokeDashArray: [5, 3], selectable: false, evented: false, opacity: 0.8,
        data: { isAction: true },
      }))
      canvas.add(new fabric.Text(action.action_type.toUpperCase(), {
        left: x + 3, top: y + 3, fontSize: 8,
        fill: '#fff', backgroundColor: color,
        selectable: false, evented: false,
        data: { isAction: true },
      }))
    })
    canvas.renderAll()
  }, [actions, width, height])

  // Region draw tool
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    const onDown = (opt: fabric.IEvent<MouseEvent>) => {
      if (activeTool !== 'region') return
      const ptr = canvas.getPointer(opt.e)
      const rx = ptr.x / zoom, ry = ptr.y / zoom
      isDrawing.current = true; startPt.current = { x: rx, y: ry }
      const rect = new fabric.Rect({
        left: rx * zoom, top: ry * zoom, width: 0, height: 0,
        fill: 'rgba(45,107,228,0.06)', stroke: T.accent, strokeWidth: 1,
        strokeDashArray: [6, 3], selectable: false, evented: false, data: { isSelection: true },
      })
      selRect.current = rect; canvas.add(rect)
    }
    const onMove = (opt: fabric.IEvent<MouseEvent>) => {
      if (!isDrawing.current || !startPt.current || !selRect.current) return
      const ptr = canvas.getPointer(opt.e)
      const rx = ptr.x / zoom, ry = ptr.y / zoom
      selRect.current.set({
        left:   Math.min(rx, startPt.current.x) * zoom,
        top:    Math.min(ry, startPt.current.y) * zoom,
        width:  Math.abs(rx - startPt.current.x) * zoom,
        height: Math.abs(ry - startPt.current.y) * zoom,
      })
      canvas.renderAll()
    }
    const onUp = (opt: fabric.IEvent<MouseEvent>) => {
      if (!isDrawing.current || !startPt.current || !selRect.current) return
      isDrawing.current = false
      const ptr = canvas.getPointer(opt.e)
      const rx = ptr.x / zoom, ry = ptr.y / zoom
      const x_px = Math.min(rx, startPt.current.x), y_px = Math.min(ry, startPt.current.y)
      const w_px = Math.abs(rx - startPt.current.x), h_px = Math.abs(ry - startPt.current.y)
      if (w_px < 5 || h_px < 5) { canvas.remove(selRect.current); selRect.current = null; return }
      const sel: Selection = { x: x_px / width, y: y_px / height, w: w_px / width, h: h_px / height, x_px, y_px, w_px, h_px }
      onSelection(sel, findNearest(elements, sel))
    }
    canvas.on('mouse:down', onDown); canvas.on('mouse:move', onMove); canvas.on('mouse:up', onUp)
    return () => { canvas.off('mouse:down', onDown); canvas.off('mouse:move', onMove); canvas.off('mouse:up', onUp) }
  }, [activeTool, elements, width, height, zoom, onSelection])

  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    canvas.defaultCursor = activeTool === 'region' ? 'crosshair' : 'default'
  }, [activeTool])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, position: 'relative' }}>
      {/* Canvas viewport */}
      <div style={{
        overflow: 'auto', maxWidth: '100%',
        maxHeight: 'calc(100vh - 160px)',
        border: `1px solid ${T.border}`, borderRadius: 6,
        boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
      }}>
        <canvas ref={canvasRef} style={{ display: 'block' }} />
      </div>

      {/* Floating zoom bar — bottom-center of canvas */}
      <div style={{
        marginTop: 10,
        display: 'flex', alignItems: 'center', gap: 4,
        background: T.bgElevated, borderRadius: 10,
        padding: '5px 10px', border: `1px solid ${T.border}`,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      }}>
        <ZoomBtn onClick={() => setZoomIdx(i => Math.max(0, i-1))} disabled={zoomIdx === 0} title="Zoom out (⌘−)">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="5" cy="5" r="4"/><line x1="8.5" y1="8.5" x2="11" y2="11"/><line x1="3" y1="5" x2="7" y2="5"/></svg>
        </ZoomBtn>
        <span style={{ color: T.textPrimary, fontSize: 11, minWidth: 38, textAlign: 'center', fontFamily: 'monospace', fontWeight: 600 }}>
          {Math.round(zoom * 100)}%
        </span>
        <ZoomBtn onClick={() => setZoomIdx(i => Math.min(ZOOM_LEVELS.length-1, i+1))} disabled={zoomIdx === ZOOM_LEVELS.length - 1} title="Zoom in (⌘+)">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="5" cy="5" r="4"/><line x1="8.5" y1="8.5" x2="11" y2="11"/><line x1="3" y1="5" x2="7" y2="5"/><line x1="5" y1="3" x2="5" y2="7"/></svg>
        </ZoomBtn>
        <div style={{ width: 1, height: 14, background: T.border, margin: '0 2px' }} />
        <ZoomBtn onClick={() => setZoomIdx(5)} title="Reset zoom (100%)">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="2" width="8" height="8" rx="1.5"/><path d="M4.5 6h3M6 4.5v3"/></svg>
        </ZoomBtn>
        <div style={{ width: 1, height: 14, background: T.border, margin: '0 2px' }} />
        <ZoomBtn onClick={() => setRotation(r => (r + 90) % 360)} title="Rotate 90° (R)">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 6a4 4 0 108-0"/><polyline points="8,2 10,5 7,5"/></svg>
        </ZoomBtn>
        {rotation !== 0 && (
          <span style={{ color: T.textSecond, fontSize: 10, fontFamily: 'monospace', marginLeft: 2 }}>
            {rotation}°
          </span>
        )}
      </div>
    </div>
  )
}

function ZoomBtn({ onClick, disabled, title, children }: {
  onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick} disabled={disabled} title={title}
      style={{
        background: 'none', border: 'none',
        color: disabled ? '#3D4560' : '#7A8299',
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: '4px 6px', borderRadius: 6, display: 'flex', alignItems: 'center',
        transition: 'color 0.12s',
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.color = '#E8ECF4' }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.color = '#7A8299' }}
    >
      {children}
    </button>
  )
}

function findNearest(elements: ArtElement[], sel: Selection): ArtElement | null {
  const cx = sel.x + sel.w / 2, cy = sel.y + sel.h / 2
  let best: ArtElement | null = null, bestD = Infinity
  for (const e of elements) {
    if (sel.x < e.x_norm + e.w_norm && sel.x + sel.w > e.x_norm &&
        sel.y < e.y_norm + e.h_norm && sel.y + sel.h > e.y_norm) {
      const d = Math.hypot(cx - (e.x_norm + e.w_norm / 2), cy - (e.y_norm + e.h_norm / 2))
      if (d < bestD) { bestD = d; best = e }
    }
  }
  return best
}
