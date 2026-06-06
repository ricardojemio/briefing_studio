// src/components/canvas/StudioCanvas.tsx
<<<<<<< HEAD
// FIXES:
//   #1 - Zoom In/Out with coordinate matrix recalculation
//   #2 - Multiple selection with Shift key
//   #3 - Drag & Drop to move elements visually
//   #7 - Canvas rotation in 90° steps with transposed click coords

import { useEffect, useRef, useCallback, useState } from 'react'
=======
// Core canvas — renders artwork as background image (IMMUTABLE)
// Fabric.js is a pure overlay for selection and annotation only.
// RULES: No color changes, no vector edits, no dimension changes.

import { useEffect, useRef, useCallback } from 'react'
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
import { fabric } from 'fabric'
import { useStore } from '../../store'
import type { ArtElement, Selection } from '../../types'

interface StudioCanvasProps {
  previewUrl:  string
  width:       number
  height:      number
  elements:    ArtElement[]
  onSelection: (sel: Selection, nearestElem: ArtElement | null) => void
<<<<<<< HEAD
  onMultiSelection?: (elems: ArtElement[]) => void
  onDragMove?: (elemId: string, dx_mm: number, dy_mm: number) => void
}

const TYPE_COLOR:  Record<string, string> = {
=======
}

// Colors per element type
const TYPE_COLOR: Record<string, string> = {
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
  text:    'rgba(24,95,165,0.15)',
  image:   'rgba(29,158,117,0.15)',
  logo:    'rgba(186,117,23,0.15)',
  barcode: 'rgba(220,53,69,0.15)',
  vector:  'rgba(100,100,100,0.10)',
}
const TYPE_STROKE: Record<string, string> = {
  text:    '#185FA5',
  image:   '#1D9E75',
  logo:    '#BA7517',
  barcode: '#dc3545',
  vector:  '#888',
}

<<<<<<< HEAD
// FIX #1: zoom levels
const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0]

export default function StudioCanvas({
  previewUrl, width, height, elements, onSelection, onMultiSelection, onDragMove,
}: StudioCanvasProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const fabricRef   = useRef<fabric.Canvas | null>(null)
  const isDrawing   = useRef(false)
  const startPt     = useRef<{ x: number; y: number } | null>(null)
  const selRect     = useRef<fabric.Rect | null>(null)
  const elemObjs    = useRef<Map<string, fabric.Rect>>(new Map())
  const dragTarget  = useRef<{ elem: ArtElement; startX: number; startY: number } | null>(null)
  const shiftHeld   = useRef(false)
  const multiSel    = useRef<ArtElement[]>([])

  // FIX #1: zoom state
  const [zoomIdx,   setZoomIdx]   = useState(5)   // default = 1.0 (index 5)
  const zoom = ZOOM_LEVELS[zoomIdx]

  // FIX #7: rotation state (0, 90, 180, 270)
  const [rotation, setRotation] = useState(0)

  const { activeTool, actions, setHoveredElem, setSelectedElem } = useStore()

  // ── Init canvas ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return
=======
export default function StudioCanvas({
  previewUrl, width, height, elements, onSelection,
}: StudioCanvasProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const fabricRef  = useRef<fabric.Canvas | null>(null)
  const isDrawing  = useRef(false)
  const startPt    = useRef<{ x: number; y: number } | null>(null)
  const selRect    = useRef<fabric.Rect | null>(null)
  const elemObjs   = useRef<Map<string, fabric.Rect>>(new Map())

  const { activeTool, actions, setHoveredElem, setSelectedElem } = useStore()

  // ── Init canvas ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return

>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
    const canvas = new fabric.Canvas(canvasRef.current, {
      width, height,
      selection: false,
      preserveObjectStacking: true,
    })
    fabricRef.current = canvas
<<<<<<< HEAD
    loadBackground(canvas, previewUrl, width, height, rotation)
    return () => { canvas.dispose(); fabricRef.current = null }
  }, [previewUrl, width, height, rotation])

  // FIX #1: apply zoom — zoom canvas and recalculate all coords
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    canvas.setZoom(zoom)
    canvas.setWidth(width  * zoom)
    canvas.setHeight(height * zoom)
    canvas.renderAll()
  }, [zoom, width, height])

  // ── Keyboard: Shift for multi-select, +/- for zoom, R for rotate ────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftHeld.current = true
      // FIX #1: keyboard zoom
      if ((e.ctrlKey || e.metaKey) && e.key === '=') {
        e.preventDefault()
        setZoomIdx(i => Math.min(ZOOM_LEVELS.length - 1, i + 1))
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault()
        setZoomIdx(i => Math.max(0, i - 1))
      }
      // FIX #7: rotate with R key
      if (e.key === 'r' || e.key === 'R') {
        setRotation(r => (r + 90) % 360)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        shiftHeld.current = false
        // Finalize multi-selection
        if (multiSel.current.length > 1 && onMultiSelection) {
          onMultiSelection([...multiSel.current])
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup',   onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup',   onKeyUp)
    }
  }, [onMultiSelection])

  // ── Element overlays ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    elemObjs.current.forEach(obj => canvas.remove(obj))
    elemObjs.current.clear()

    elements.forEach(elem => {
      // FIX #7: transpose coords if rotated
      const { ex, ey, ew, eh } = transformCoords(
        elem.x_norm, elem.y_norm, elem.w_norm, elem.h_norm,
        rotation, width, height
      )
      const x  = ex * width,  y  = ey * height
      const w  = ew * width,  h  = eh * height
      const bg = TYPE_COLOR[elem.type]   || 'rgba(24,95,165,0.10)'
      const st = TYPE_STROKE[elem.type]  || '#185FA5'
=======

    // Load artwork as immutable background
    fabric.Image.fromURL(
      previewUrl,
      (img) => {
        img.set({ selectable: false, evented: false })
        img.scaleToWidth(width)
        canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas))
      },
      { crossOrigin: 'anonymous' }
    )

    return () => { canvas.dispose(); fabricRef.current = null }
  }, [previewUrl, width, height])

  // ── Overlay element boxes ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return

    // Remove old element overlays
    elemObjs.current.forEach((obj) => canvas.remove(obj))
    elemObjs.current.clear()

    elements.forEach((elem) => {
      const x  = elem.x_norm * width
      const y  = elem.y_norm * height
      const w  = elem.w_norm * width
      const h  = elem.h_norm * height
      const bg = TYPE_COLOR[elem.type]  || 'rgba(24,95,165,0.10)'
      const st = TYPE_STROKE[elem.type] || '#185FA5'
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e

      const rect = new fabric.Rect({
        left: x, top: y, width: w, height: h,
        fill: bg, stroke: st, strokeWidth: 1,
        strokeDashArray: [4, 3],
<<<<<<< HEAD
        selectable: false, evented: true, opacity: 0.6,
        data: { elemId: elem.elem_id, elem },
      })

=======
        selectable: false, evented: true,
        opacity: 0.6,
        data: { elemId: elem.elem_id, elem },
      })

      // Hover effect
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
      rect.on('mouseover', () => {
        rect.set({ opacity: 1, strokeWidth: 2 })
        canvas.renderAll()
        setHoveredElem(elem)
      })
      rect.on('mouseout', () => {
        rect.set({ opacity: 0.6, strokeWidth: 1 })
        canvas.renderAll()
        setHoveredElem(null)
      })
<<<<<<< HEAD

      // FIX #2: shift-click for multi-select
      rect.on('mousedown', (opt) => {
        if (shiftHeld.current) {
          if (!multiSel.current.find(e => e.elem_id === elem.elem_id)) {
            multiSel.current.push(elem)
            rect.set({ stroke: '#9C27B0', strokeWidth: 3 })
            canvas.renderAll()
          }
          return
        }
        multiSel.current = [elem]
        setSelectedElem(elem)
=======
      rect.on('mousedown', () => {
        setSelectedElem(elem)
        // Auto-create selection from element bounds
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
        const sel: Selection = {
          x: elem.x_norm, y: elem.y_norm,
          w: elem.w_norm, h: elem.h_norm,
          x_px: x, y_px: y, w_px: w, h_px: h,
        }
        onSelection(sel, elem)
      })

<<<<<<< HEAD
      // FIX #3: drag to move
      if (elem.allowed_actions.includes('move')) {
        rect.on('mousedown', (opt) => {
          if (activeTool !== 'select') return
          const ptr = canvas.getPointer(opt.e as MouseEvent)
          dragTarget.current = {
            elem,
            startX: ptr.x / zoom,
            startY: ptr.y / zoom,
          }
        })
      }

=======
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
      canvas.add(rect)
      elemObjs.current.set(elem.elem_id, rect)
    })

<<<<<<< HEAD
    // FIX #3: drag move handlers on canvas level
    const canvas2 = fabricRef.current!
    const onMouseMove = (opt: fabric.IEvent<MouseEvent>) => {
      if (!dragTarget.current) return
      const ptr = canvas2.getPointer(opt.e)
      const dx_px = ptr.x / zoom - dragTarget.current.startX
      const dy_px = ptr.y / zoom - dragTarget.current.startY
      // Live preview: move the rect
      const obj = elemObjs.current.get(dragTarget.current.elem.elem_id)
      if (obj) {
        obj.set({
          left: (dragTarget.current.elem.x_norm * width) + dx_px,
          top:  (dragTarget.current.elem.y_norm * height) + dy_px,
        })
        canvas2.renderAll()
      }
    }
    const onMouseUp = (opt: fabric.IEvent<MouseEvent>) => {
      if (!dragTarget.current) return
      const ptr  = canvas2.getPointer(opt.e)
      const dx_px = ptr.x / zoom - dragTarget.current.startX
      const dy_px = ptr.y / zoom - dragTarget.current.startY
      // Convert pixels → mm (assuming 150 DPI preview)
      const px_per_mm = 150 / 25.4
      const dx_mm = dx_px / px_per_mm
      const dy_mm = dy_px / px_per_mm
      if (Math.abs(dx_mm) > 0.5 || Math.abs(dy_mm) > 0.5) {
        onDragMove?.(dragTarget.current.elem.elem_id, dx_mm, dy_mm)
      }
      dragTarget.current = null
    }
    canvas2.on('mouse:move', onMouseMove)
    canvas2.on('mouse:up',   onMouseUp)

    canvas.renderAll()
    return () => {
      canvas2.off('mouse:move', onMouseMove)
      canvas2.off('mouse:up',   onMouseUp)
    }
  }, [elements, width, height, rotation, zoom, activeTool])

  // ── Action markers ───────────────────────────────────────────────────
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    canvas.getObjects()
      .filter((o: any) => o.data?.isAction)
      .forEach((o: fabric.Object) => canvas.remove(o))

    actions.forEach(action => {
      if (!action.sel_x) return
      const x = action.sel_x * width  * zoom
      const y = action.sel_y! * height * zoom
      const w = action.sel_w! * width  * zoom
      const h = action.sel_h! * height * zoom
      const color = { replace:'#1D9E75', delete:'#dc3545', move:'#185FA5', resize:'#BA7517', bold:'#9C27B0' }
        [action.action_type] || '#888'
      const marker = new fabric.Rect({
        left: x, top: y, width: w, height: h,
        fill: 'transparent', stroke: color, strokeWidth: 2,
        selectable: false, evented: false,
        data: { isAction: true },
      })
      const label = new fabric.Text(action.action_type.toUpperCase(), {
        left: x + 2, top: y + 2, fontSize: 9, fill: '#fff',
=======
    // Draw action markers on already-saved actions
    canvas.renderAll()
  }, [elements, width, height])

  // ── Highlight saved actions ────────────────────────────────────────────
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return

    // Remove old action markers (objects with data.isAction)
    canvas.getObjects().filter((o: fabric.Object) =>
      (o as any).data?.isAction
    ).forEach((o: fabric.Object) => canvas.remove(o))

    actions.forEach((action) => {
      if (!action.sel_x) return
      const x = action.sel_x * width
      const y = action.sel_y! * height
      const w = action.sel_w! * width
      const h = action.sel_h! * height

      const color = {
        replace: '#1D9E75', delete: '#dc3545',
        move:    '#185FA5', resize: '#BA7517',
      }[action.action_type] || '#888'

      const marker = new fabric.Rect({
        left: x, top: y, width: w, height: h,
        fill: 'transparent',
        stroke: color, strokeWidth: 2,
        selectable: false, evented: false,
        data: { isAction: true, actionId: action.id },
      })

      // Badge label
      const label = new fabric.Text(action.action_type.toUpperCase(), {
        left: x + 2, top: y + 2,
        fontSize: 9, fill: '#fff',
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
        backgroundColor: color,
        selectable: false, evented: false,
        data: { isAction: true },
      })
<<<<<<< HEAD
      canvas.add(marker, label)
    })
    canvas.renderAll()
  }, [actions, width, height, zoom])

  // ── Free-draw region selection ───────────────────────────────────────
=======

      canvas.add(marker, label)
    })
    canvas.renderAll()
  }, [actions, width, height])

  // ── Mouse events for free-draw region selection ────────────────────────
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return

    const onDown = (opt: fabric.IEvent<MouseEvent>) => {
      if (activeTool !== 'region') return
<<<<<<< HEAD
      // FIX #1: divide by zoom to get real canvas coordinates
      const ptr = canvas.getPointer(opt.e)
      const rx = ptr.x / zoom, ry = ptr.y / zoom
      isDrawing.current = true
      startPt.current   = { x: rx, y: ry }
      const rect = new fabric.Rect({
        left: rx * zoom, top: ry * zoom, width: 0, height: 0,
        fill: 'rgba(24,95,165,0.08)',
        stroke: '#185FA5', strokeWidth: 2, strokeDashArray: [6, 3],
        selectable: false, evented: false, data: { isSelection: true },
=======
      const ptr = canvas.getPointer(opt.e)
      isDrawing.current = true
      startPt.current   = { x: ptr.x, y: ptr.y }
      const rect = new fabric.Rect({
        left: ptr.x, top: ptr.y, width: 0, height: 0,
        fill: 'rgba(24,95,165,0.08)',
        stroke: '#185FA5', strokeWidth: 2,
        strokeDashArray: [6, 3],
        selectable: false, evented: false,
        data: { isSelection: true },
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
      })
      selRect.current = rect
      canvas.add(rect)
    }

    const onMove = (opt: fabric.IEvent<MouseEvent>) => {
      if (!isDrawing.current || !startPt.current || !selRect.current) return
      const ptr = canvas.getPointer(opt.e)
<<<<<<< HEAD
      const rx = ptr.x / zoom, ry = ptr.y / zoom
      const x = Math.min(rx, startPt.current.x)
      const y = Math.min(ry, startPt.current.y)
      const w = Math.abs(rx - startPt.current.x)
      const h = Math.abs(ry - startPt.current.y)
      selRect.current.set({ left: x * zoom, top: y * zoom, width: w * zoom, height: h * zoom })
=======
      const x = Math.min(ptr.x, startPt.current.x)
      const y = Math.min(ptr.y, startPt.current.y)
      const w = Math.abs(ptr.x - startPt.current.x)
      const h = Math.abs(ptr.y - startPt.current.y)
      selRect.current.set({ left: x, top: y, width: w, height: h })
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
      canvas.renderAll()
    }

    const onUp = (opt: fabric.IEvent<MouseEvent>) => {
      if (!isDrawing.current || !startPt.current || !selRect.current) return
      isDrawing.current = false
      const ptr = canvas.getPointer(opt.e)
<<<<<<< HEAD
      const rx = ptr.x / zoom, ry = ptr.y / zoom
      const x_px = Math.min(rx, startPt.current.x)
      const y_px = Math.min(ry, startPt.current.y)
      const w_px = Math.abs(rx - startPt.current.x)
      const h_px = Math.abs(ry - startPt.current.y)
=======
      const x_px = Math.min(ptr.x, startPt.current.x)
      const y_px = Math.min(ptr.y, startPt.current.y)
      const w_px = Math.abs(ptr.x - startPt.current.x)
      const h_px = Math.abs(ptr.y - startPt.current.y)
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e

      if (w_px < 5 || h_px < 5) {
        canvas.remove(selRect.current)
        selRect.current = null
        return
      }
<<<<<<< HEAD
      const sel: Selection = {
        x: x_px / width,  y: y_px / height,
        w: w_px / width,  h: h_px / height,
        x_px, y_px, w_px, h_px,
      }
      const nearest = findNearest(elements, sel)
=======

      const sel: Selection = {
        x: x_px / width, y: y_px / height,
        w: w_px / width, h: h_px / height,
        x_px, y_px, w_px, h_px,
      }

      // Find nearest element in the selection region
      const nearest = findNearestElement(elements, sel)
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
      onSelection(sel, nearest)
    }

    canvas.on('mouse:down', onDown)
    canvas.on('mouse:move', onMove)
    canvas.on('mouse:up',   onUp)
<<<<<<< HEAD
=======

>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
    return () => {
      canvas.off('mouse:down', onDown)
      canvas.off('mouse:move', onMove)
      canvas.off('mouse:up',   onUp)
    }
<<<<<<< HEAD
  }, [activeTool, elements, width, height, zoom, rotation, onSelection])

  // ── Cursor ───────────────────────────────────────────────────────────
=======
  }, [activeTool, elements, width, height, onSelection])

  // ── Cursor ────────────────────────────────────────────────────────────
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    canvas.defaultCursor = activeTool === 'region' ? 'crosshair' : 'default'
  }, [activeTool])

<<<<<<< HEAD
  // ── Zoom controls UI ─────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>

      {/* FIX #1: Zoom toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: '#1a1a2e', borderRadius: 8, padding: '4px 10px',
        border: '1px solid #333', marginBottom: 4,
      }}>
        <button onClick={() => setZoomIdx(i => Math.max(0, i - 1))}
          disabled={zoomIdx === 0}
          style={zoomBtn} title="Zoom Out (Ctrl/Cmd -)">
          🔍−
        </button>
        <span style={{ color: '#aaa', fontSize: 11, minWidth: 40, textAlign: 'center' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button onClick={() => setZoomIdx(i => Math.min(ZOOM_LEVELS.length - 1, i + 1))}
          disabled={zoomIdx === ZOOM_LEVELS.length - 1}
          style={zoomBtn} title="Zoom In (Ctrl/Cmd +)">
          🔍+
        </button>
        <div style={{ width: 1, height: 16, background: '#333', margin: '0 4px' }} />
        <button onClick={() => setZoomIdx(5)} style={zoomBtn} title="Reset zoom">
          ⊙
        </button>
        <div style={{ width: 1, height: 16, background: '#333', margin: '0 4px' }} />
        {/* FIX #7: Rotate button */}
        <button onClick={() => setRotation(r => (r + 90) % 360)}
          style={zoomBtn} title="Girar 90° (R)">
          🔄 {rotation}°
        </button>
      </div>

      {/* Canvas wrapper */}
      <div style={{
        overflow: 'auto', maxWidth: '100%', maxHeight: 'calc(100vh - 180px)',
        border: '1px solid #333', borderRadius: 4,
      }}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', boxShadow: '0 4px 32px rgba(0,0,0,0.5)' }}
        />
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────

function loadBackground(
  canvas: fabric.Canvas,
  url: string,
  width: number,
  height: number,
  rotation: number,
) {
  fabric.Image.fromURL(
    url,
    (img) => {
      img.set({ selectable: false, evented: false })
      // FIX #7: rotate image
      if (rotation !== 0) {
        img.rotate(rotation)
        if (rotation === 90 || rotation === 270) {
          img.scaleToHeight(width)
        } else {
          img.scaleToWidth(width)
        }
        img.set({
          left: rotation === 90  ? width  : rotation === 180 ? width  : 0,
          top:  rotation === 180 ? height : rotation === 270 ? height : 0,
        })
      } else {
        img.scaleToWidth(width)
      }
      canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas))
    },
    { crossOrigin: 'anonymous' }
  )
}

// FIX #7: transpose normalized coordinates based on rotation
function transformCoords(
  x: number, y: number, w: number, h: number,
  rotation: number, _W: number, _H: number,
): { ex: number; ey: number; ew: number; eh: number } {
  switch (rotation) {
    case 90:  return { ex: y,         ey: 1 - x - w, ew: h, eh: w }
    case 180: return { ex: 1 - x - w, ey: 1 - y - h, ew: w, eh: h }
    case 270: return { ex: 1 - y - h, ey: x,         ew: h, eh: w }
    default:  return { ex: x,         ey: y,          ew: w, eh: h }
  }
}

function findNearest(elements: ArtElement[], sel: Selection): ArtElement | null {
  const cx = sel.x + sel.w / 2, cy = sel.y + sel.h / 2
  let best: ArtElement | null = null, bestD = Infinity
  for (const e of elements) {
    const overlap =
      sel.x < e.x_norm + e.w_norm && sel.x + sel.w > e.x_norm &&
      sel.y < e.y_norm + e.h_norm && sel.y + sel.h > e.y_norm
    if (overlap) {
      const d = Math.hypot(cx - (e.x_norm + e.w_norm / 2), cy - (e.y_norm + e.h_norm / 2))
      if (d < bestD) { bestD = d; best = e }
=======
  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', boxShadow: '0 4px 32px rgba(0,0,0,0.5)' }}
    />
  )
}

// Find element whose center is closest to selection center
function findNearestElement(elements: ArtElement[], sel: Selection): ArtElement | null {
  const cx = sel.x + sel.w / 2
  const cy = sel.y + sel.h / 2
  let best: ArtElement | null = null
  let bestDist = Infinity
  for (const e of elements) {
    const ex = e.x_norm + e.w_norm / 2
    const ey = e.y_norm + e.h_norm / 2
    // Check overlap
    const overlap =
      sel.x < e.x_norm + e.w_norm &&
      sel.x + sel.w > e.x_norm &&
      sel.y < e.y_norm + e.h_norm &&
      sel.y + sel.h > e.y_norm
    if (overlap) {
      const d = Math.hypot(cx - ex, cy - ey)
      if (d < bestDist) { bestDist = d; best = e }
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
    }
  }
  return best
}
<<<<<<< HEAD

const zoomBtn: React.CSSProperties = {
  background: '#252540', border: '1px solid #444',
  color: '#ddd', borderRadius: 5, cursor: 'pointer',
  padding: '3px 8px', fontSize: 12,
}
=======
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
