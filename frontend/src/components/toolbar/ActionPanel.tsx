// src/components/toolbar/ActionPanel.tsx
<<<<<<< HEAD
// FIXES:
//   #2 - Shows multi-selection mode when multiple elements selected
//   #3 - Drag info feedback (dx/dy shown after drag)
//   #6 - Bold toggle button added to Replace and Resize actions
=======
// Floating panel that appears after selecting a region or element.
// Allows: Replace text, Delete, Move (drag delta), Resize font.
// FORBIDDEN: color changes, vector edits, dimension changes.
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e

import { useState, useEffect } from 'react'
import { useStore } from '../../store'
import { api } from '../../services/api'
import type { ActionType, ArtElement, Selection } from '../../types'

interface ActionPanelProps {
<<<<<<< HEAD
  artworkId:      string
  page:           number
  selection:      Selection
  element:        ArtElement | null
  multiElements?: ArtElement[]
  dragDelta?:     { dx_mm: number; dy_mm: number }
  onClose:        () => void
  onSaved:        () => void
}

const ACTION_BTNS = [
  { type: 'replace' as ActionType, icon: '✏️', label: 'Replace', color: '#1D9E75' },
  { type: 'delete'  as ActionType, icon: '🗑️', label: 'Delete',  color: '#dc3545' },
  { type: 'move'    as ActionType, icon: '↗️', label: 'Move',    color: '#185FA5' },
  { type: 'resize'  as ActionType, icon: '🔡', label: 'Resize',  color: '#BA7517' },
  { type: 'bold'    as ActionType, icon: '𝐁',  label: 'Bold',    color: '#9C27B0' },
]

export default function ActionPanel({
  artworkId, page, selection, element, multiElements, dragDelta, onClose, onSaved,
=======
  artworkId:   string
  page:        number
  selection:   Selection
  element:     ArtElement | null
  onClose:     () => void
  onSaved:     () => void
}

const ACTION_BTNS: { type: ActionType; icon: string; label: string; color: string }[] = [
  { type: 'replace', icon: '✏️', label: 'Replace', color: '#1D9E75' },
  { type: 'delete',  icon: '🗑️', label: 'Delete',  color: '#dc3545' },
  { type: 'move',    icon: '↗️', label: 'Move',    color: '#185FA5' },
  { type: 'resize',  icon: '🔡', label: 'Resize',  color: '#BA7517' },
]

export default function ActionPanel({
  artworkId, page, selection, element, onClose, onSaved,
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
}: ActionPanelProps) {
  const { addAction } = useStore()
  const [actionType, setActionType] = useState<ActionType>('replace')
  const [newText,    setNewText]    = useState(element?.label || '')
  const [comment,    setComment]    = useState('')
<<<<<<< HEAD
  const [dxMm,       setDxMm]      = useState(dragDelta?.dx_mm || 0)
  const [dyMm,       setDyMm]      = useState(dragDelta?.dy_mm || 0)
  const [newFs,      setNewFs]      = useState(element?.font_size || 12)
  const [bold,       setBold]       = useState(false)
=======
  const [dxMm,       setDxMm]      = useState(0)
  const [dyMm,       setDyMm]      = useState(0)
  const [newFs,      setNewFs]      = useState(element?.font_size || 12)
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [error,      setError]      = useState<string | null>(null)

<<<<<<< HEAD
  const isMulti = (multiElements?.length || 0) > 1

  useEffect(() => {
    if (element) { setNewText(element.label || ''); setNewFs(element.font_size || 12) }
    if (dragDelta) { setDxMm(dragDelta.dx_mm); setDyMm(dragDelta.dy_mm) }
  }, [element, dragDelta])

  // For multi-selection, only allow delete and move
  const allowedTypes = isMulti
    ? ACTION_BTNS.filter(b => ['delete','move'].includes(b.type))
    : ACTION_BTNS.filter(b => (element?.allowed_actions || ['replace','delete','move','resize','bold']).includes(b.type))
=======
  // Update fields when element changes
  useEffect(() => {
    if (element) {
      setNewText(element.label || '')
      setNewFs(element.font_size || 12)
    }
  }, [element])

  // Filter allowed actions for this element type
  const allowedTypes = element?.allowed_actions || ['replace','delete','move','resize']
  const visibleBtns  = ACTION_BTNS.filter(b => allowedTypes.includes(b.type))
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e

  const handleSave = async () => {
    setSaving(true); setError(null)
    try {
<<<<<<< HEAD
      const targets = isMulti ? (multiElements || []) : (element ? [element] : [])
      for (const elem of targets) {
        const payload: any = {
          artwork_id: artworkId, page, action_type: actionType,
          element_id: elem?.elem_id, element_type: elem?.type,
          original_text: elem?.label,
          comment: comment || undefined,
          bold: bold || undefined,
          sel_x: selection.x, sel_y: selection.y,
          sel_w: selection.w, sel_h: selection.h,
        }
        if (actionType === 'replace') payload.new_text      = newText
        if (actionType === 'move')    { payload.dx_mm = dxMm; payload.dy_mm = dyMm }
        if (actionType === 'resize')  payload.new_font_size = newFs
        const saved = await api.createAction(payload)
        addAction(saved)
      }
=======
      const payload: any = {
        artwork_id:    artworkId,
        page,
        action_type:   actionType,
        element_id:    element?.elem_id,
        element_type:  element?.type,
        original_text: element?.label,
        comment:       comment || undefined,
        sel_x: selection.x, sel_y: selection.y,
        sel_w: selection.w, sel_h: selection.h,
      }
      if (actionType === 'replace') payload.new_text      = newText
      if (actionType === 'move')    { payload.dx_mm = dxMm; payload.dy_mm = dyMm }
      if (actionType === 'resize')  payload.new_font_size = newFs

      const saved = await api.createAction(payload)
      addAction(saved)
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
      setSaved(true)
      setTimeout(() => { setSaved(false); onSaved() }, 1200)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
<<<<<<< HEAD
    } finally { setSaving(false) }
  }

  const activeBtn = ACTION_BTNS.find(b => b.type === actionType) || ACTION_BTNS[0]
=======
    } finally {
      setSaving(false)
    }
  }

  const activeBtn = ACTION_BTNS.find(b => b.type === actionType)!
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e

  return (
    <div style={{
      position: 'absolute', zIndex: 200,
<<<<<<< HEAD
      left: Math.min(selection.x_px, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 340),
      top:  selection.y_px + selection.h_px + 10,
      width: 320, background: '#1a1a2e',
      border: '1px solid #333', borderRadius: 12,
      boxShadow: '0 12px 40px rgba(0,0,0,0.6)', overflow: 'hidden',
    }}>

      {/* Header */}
      <div style={{ padding: '10px 14px', background: activeBtn.color, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>
            ⚡ {isMulti ? `${multiElements?.length} elementos selecionados` : 'Sugerir ação'}
          </div>
          {element && !isMulti && (
            <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 2 }}>
              {element.type === 'text' ? '📝' : '🖼️'} {element.label?.slice(0, 35)}
              {element.font_size && <span style={{ marginLeft: 6, opacity: 0.7 }}>{element.font_size.toFixed(1)}pt</span>}
            </div>
          )}
          {isMulti && (
            <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 10, marginTop: 2 }}>
              Shift+Click para selecionar · somente Delete e Move disponíveis
            </div>
          )}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 18 }}>✕</button>
=======
      left: Math.min(selection.x_px, window.innerWidth - 340),
      top:  selection.y_px + selection.h_px + 10,
      width: 320,
      background: '#1a1a2e',
      border: '1px solid #333',
      borderRadius: 12,
      boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
      overflow: 'hidden',
    }}>

      {/* Header */}
      <div style={{ padding: '10px 14px', background: activeBtn?.color || '#185FA5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>
            ⚡ Sugerir ação
          </div>
          {element && (
            <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 2 }}>
              {element.type === 'text' ? '📝' : '🖼️'} {element.label?.slice(0, 35)}
            </div>
          )}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
      </div>

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Action type buttons */}
        <div>
          <label style={labelSt}>Tipo de ação</label>
<<<<<<< HEAD
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${allowedTypes.length}, 1fr)`, gap: 5 }}>
            {allowedTypes.map(b => (
              <button key={b.type} onClick={() => setActionType(b.type)} style={{
                padding: '7px 4px',
                background: actionType === b.type ? b.color : '#252540',
                color: '#fff', border: `1px solid ${actionType === b.type ? b.color : '#444'}`,
                borderRadius: 7, cursor: 'pointer', fontSize: 11,
                fontWeight: actionType === b.type ? 700 : 400, transition: 'all 0.15s',
              }}>
                {b.icon}<br /><span style={{ fontSize: 9 }}>{b.label}</span>
=======
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${visibleBtns.length}, 1fr)`, gap: 6 }}>
            {visibleBtns.map(b => (
              <button key={b.type} onClick={() => setActionType(b.type)}
                style={{
                  padding: '8px 4px',
                  background: actionType === b.type ? b.color : '#252540',
                  color: '#fff', border: `1px solid ${actionType === b.type ? b.color : '#444'}`,
                  borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: actionType === b.type ? 700 : 400,
                  transition: 'all 0.15s',
                }}>
                {b.icon}<br /><span style={{ fontSize: 10 }}>{b.label}</span>
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
              </button>
            ))}
          </div>
        </div>

        {/* Comment */}
        <div>
          <label style={labelSt}>Comentário para o estúdio</label>
          <input value={comment} onChange={e => setComment(e.target.value)}
            placeholder="Ex: Adaptar para versão espanhol..."
            style={inputSt} />
        </div>

        {/* REPLACE */}
        {actionType === 'replace' && (
          <div>
<<<<<<< HEAD
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <label style={labelSt}>Novo texto</label>
              {/* FIX #6: Bold toggle */}
              <button onClick={() => setBold(b => !b)} style={{
                padding: '2px 8px', background: bold ? '#9C27B0' : '#252540',
                color: '#fff', border: `1px solid ${bold ? '#9C27B0' : '#444'}`,
                borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 700,
              }} title="Aplicar negrito">
                𝐁 {bold ? 'ON' : 'OFF'}
              </button>
            </div>
            <textarea value={newText} onChange={e => setNewText(e.target.value)}
              rows={3} placeholder="Digite o texto substituto..."
              style={{ ...inputSt, resize: 'vertical', fontFamily: 'inherit',
                       fontWeight: bold ? 700 : 400 }} />
=======
            <label style={labelSt}>Novo texto</label>
            <textarea value={newText} onChange={e => setNewText(e.target.value)}
              rows={3} placeholder="Digite o texto substituto..."
              style={{ ...inputSt, resize: 'vertical', fontFamily: 'inherit' }} />
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
          </div>
        )}

        {/* DELETE */}
        {actionType === 'delete' && (
          <div style={{ padding: 10, background: '#2a1515', border: '1px solid #5a1515', borderRadius: 8, fontSize: 12, color: '#f88' }}>
<<<<<<< HEAD
            ⚠️ {isMulti
              ? `${multiElements?.length} elementos serão marcados para remoção.`
              : 'Este elemento será marcado para remoção no draft.'}
            <br /><span style={{ opacity: 0.7 }}>Cores, vetores e dimensões não serão alterados.</span>
          </div>
        )}

        {/* MOVE — FIX #3: shows drag result or manual input */}
        {actionType === 'move' && (
          <div>
            {dragDelta ? (
              <div style={{ padding: 8, background: '#0d1f15', border: '1px solid #1D9E75', borderRadius: 6, fontSize: 12, color: '#1D9E75', marginBottom: 8 }}>
                ✅ Arrastado: Δx={dxMm.toFixed(1)}mm · Δy={dyMm.toFixed(1)}mm
              </div>
            ) : (
              <p style={{ fontSize: 10, color: '#555', marginBottom: 6 }}>
                💡 Dica: Arraste o elemento diretamente na arte, ou use os campos abaixo.
              </p>
            )}
=======
            ⚠️ Este elemento será marcado para remoção no draft. Cores, vetores e dimensões não serão alterados.
          </div>
        )}

        {/* MOVE */}
        {actionType === 'move' && (
          <div>
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
            <label style={labelSt}>Deslocamento em milímetros</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ ...labelSt, marginBottom: 2 }}>Δx (→)</label>
                <input type="number" value={dxMm} step={0.5}
                  onChange={e => setDxMm(Number(e.target.value))} style={inputSt} />
              </div>
              <div>
                <label style={{ ...labelSt, marginBottom: 2 }}>Δy (↓)</label>
                <input type="number" value={dyMm} step={0.5}
                  onChange={e => setDyMm(Number(e.target.value))} style={inputSt} />
              </div>
            </div>
<<<<<<< HEAD
          </div>
        )}

        {/* RESIZE — FIX #4: slider + FIX #6: bold toggle */}
        {actionType === 'resize' && element?.type === 'text' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <label style={labelSt}>
                Atual: <strong style={{ color: '#BA7517' }}>{element.font_size?.toFixed(1)}pt</strong>
              </label>
              <button onClick={() => setBold(b => !b)} style={{
                padding: '2px 8px', background: bold ? '#9C27B0' : '#252540',
                color: '#fff', border: `1px solid ${bold ? '#9C27B0' : '#444'}`,
                borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 700,
              }}>𝐁 {bold ? 'ON' : 'OFF'}</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="range" min={4} max={120} step={0.5}
                value={newFs} onChange={e => setNewFs(Number(e.target.value))}
                style={{ flex: 1, accentColor: '#BA7517' }} />
              <input type="number" value={newFs} min={4} max={120} step={0.5}
                onChange={e => setNewFs(Number(e.target.value))}
                style={{ ...inputSt, width: 58, textAlign: 'center' }} />
              <span style={{ color: '#888', fontSize: 11 }}>pt</span>
            </div>
            <div style={{ textAlign: 'center', marginTop: 4, fontSize: 11, color: '#BA7517' }}>
              {element.font_size?.toFixed(1)}pt →{' '}
              <strong>{newFs.toFixed(1)}pt</strong>{' '}
              ({newFs - (element.font_size || 0) >= 0 ? '+' : ''}{(newFs - (element.font_size || 0)).toFixed(1)}pt)
=======
            <p style={{ color: '#666', fontSize: 10, marginTop: 4 }}>
              ℹ️ Apenas posição — cores e dimensões não são alteradas.
            </p>
          </div>
        )}

        {/* RESIZE */}
        {actionType === 'resize' && element?.type === 'text' && (
          <div>
            <label style={labelSt}>
              Tamanho atual: <strong style={{ color: '#BA7517' }}>{element.font_size?.toFixed(1)}pt</strong>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
              <input type="range" min={6} max={72} step={0.5}
                value={newFs} onChange={e => setNewFs(Math.max(6, Math.min(72, Number(e.target.value))))}
                style={{ flex: 1, accentColor: '#BA7517' }} />
              <input type="number" value={newFs} min={6} max={72} step={0.5}
                onChange={e => setNewFs(Math.max(6, Math.min(72, Number(e.target.value))))}
                style={{ ...inputSt, width: 60, textAlign: 'center' }} />
              <span style={{ color: '#888', fontSize: 11 }}>pt</span>
            </div>
            {/* ✅ Enhanced visual feedback for resize direction */}
            <div style={{ textAlign: 'center', marginTop: 4, fontSize: 11 }}>
              <div style={{
                color: newFs > (element.font_size || 0) ? '#60b040' : newFs < (element.font_size || 0) ? '#d87430' : '#888',
                fontWeight: 700,
                marginBottom: 4
              }}>
                {newFs > (element.font_size || 0) ? '↑ AUMENTANDO' : newFs < (element.font_size || 0) ? '↓ DIMINUINDO' : '= SEM MUDANÇA'}
              </div>
              <span style={{ color: '#BA7517' }}>
                {element.font_size?.toFixed(1)}pt → <strong>{newFs.toFixed(1)}pt</strong>{' '}
                <span style={{
                  color: newFs > (element.font_size || 0) ? '#60b040' : newFs < (element.font_size || 0) ? '#d87430' : '#888'
                }}>
                  ({newFs - (element.font_size || 0) >= 0 ? '+' : ''}{(newFs - (element.font_size || 0)).toFixed(1)}pt)
                </span>
              </span>
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
            </div>
          </div>
        )}

<<<<<<< HEAD
        {/* BOLD */}
        {actionType === 'bold' && (
          <div style={{ padding: 10, background: '#1a0d2e', border: '1px solid #9C27B0', borderRadius: 8, fontSize: 12, color: '#CE93D8' }}>
            𝐁 O texto será renderizado em <strong>negrito</strong> no draft,
            usando a variante bold da fonte original.
          </div>
        )}

=======
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
        {/* Error */}
        {error && (
          <div style={{ padding: 8, background: '#2a1515', borderRadius: 6, fontSize: 12, color: '#f88' }}>
            ⚠️ {error}
          </div>
        )}

<<<<<<< HEAD
        {/* Save */}
        <button onClick={handleSave} disabled={saving} style={{
          padding: '10px 0',
          background: saved ? '#1D9E75' : activeBtn.color,
          color: '#fff', border: 'none', borderRadius: 8,
          cursor: saving ? 'wait' : 'pointer',
          fontSize: 13, fontWeight: 700, transition: 'background 0.2s',
        }}>
=======
        {/* Save button */}
        <button onClick={handleSave} disabled={saving}
          style={{
            padding: '10px 0',
            background: saved ? '#1D9E75' : (activeBtn?.color || '#185FA5'),
            color: '#fff', border: 'none', borderRadius: 8,
            cursor: saving ? 'wait' : 'pointer',
            fontSize: 13, fontWeight: 700,
            transition: 'background 0.2s',
          }}>
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
          {saving ? '⏳ Salvando...' : saved ? '✅ Salvo!' : '💾 Salvar ação'}
        </button>
      </div>
    </div>
  )
}

const labelSt: React.CSSProperties = {
<<<<<<< HEAD
  display: 'block', fontSize: 10, fontWeight: 700, color: '#888',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
}
const inputSt: React.CSSProperties = {
  width: '100%', padding: '7px 10px', background: '#252540',
  border: '1px solid #444', borderRadius: 6, color: '#fff',
  fontSize: 12, boxSizing: 'border-box', fontFamily: 'inherit',
=======
  display: 'block', fontSize: 10, fontWeight: 700,
  color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
}
const inputSt: React.CSSProperties = {
  width: '100%', padding: '7px 10px',
  background: '#252540', border: '1px solid #444',
  borderRadius: 6, color: '#fff', fontSize: 12,
  boxSizing: 'border-box', fontFamily: 'inherit',
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
}
