import { useState, useEffect } from 'react'
import { useStore } from '../../store'
import { api } from '../../services/api'
import type { ActionType, ArtElement, Selection } from '../../types'

interface ActionPanelProps {
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

export default function ActionPanel({ artworkId, page, selection, element, multiElements, dragDelta, onClose, onSaved }: ActionPanelProps) {
  const { addAction } = useStore()
  const [actionType, setActionType] = useState<ActionType>('replace')
  const [newText,    setNewText]    = useState(element?.label || '')
  const [comment,    setComment]    = useState('')
  const [dxMm,       setDxMm]      = useState(dragDelta?.dx_mm || 0)
  const [dyMm,       setDyMm]      = useState(dragDelta?.dy_mm || 0)
  const [newFs,      setNewFs]      = useState(element?.font_size || 12)
  const [bold,       setBold]       = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  const isMulti = (multiElements?.length || 0) > 1

  useEffect(() => {
    if (element) { setNewText(element.label || ''); setNewFs(element.font_size || 12) }
    if (dragDelta) { setDxMm(dragDelta.dx_mm); setDyMm(dragDelta.dy_mm) }
  }, [element, dragDelta])

  const allowedTypes = isMulti
    ? ACTION_BTNS.filter(b => ['delete','move'].includes(b.type))
    : ACTION_BTNS.filter(b => (element?.allowed_actions || ['replace','delete','move','resize','bold']).includes(b.type))

  const handleSave = async () => {
    setSaving(true); setError(null)
    try {
      const targets = isMulti ? (multiElements || []) : (element ? [element] : [])
      for (const elem of targets) {
        const payload: any = {
          artwork_id: artworkId, page, action_type: actionType,
          element_id: elem?.elem_id, element_type: elem?.type,
          original_text: elem?.label, comment: comment || undefined, bold: bold || undefined,
          sel_x: selection.x, sel_y: selection.y, sel_w: selection.w, sel_h: selection.h,
        }
        if (actionType === 'replace') payload.new_text      = newText
        if (actionType === 'move')    { payload.dx_mm = dxMm; payload.dy_mm = dyMm }
        if (actionType === 'resize')  payload.new_font_size = newFs
        addAction(await api.createAction(payload))
      }
      setSaved(true)
      setTimeout(() => { setSaved(false); onSaved() }, 1200)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally { setSaving(false) }
  }

  const activeBtn = ACTION_BTNS.find(b => b.type === actionType) || ACTION_BTNS[0]

  return (
    <div style={{ position:'absolute', zIndex:200,
      left: Math.min(selection.x_px, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 340),
      top: selection.y_px + selection.h_px + 10,
      width:320, background:'#1a1a2e', border:'1px solid #333', borderRadius:12,
      boxShadow:'0 12px 40px rgba(0,0,0,0.6)', overflow:'hidden' }}>

      <div style={{ padding:'10px 14px', background:activeBtn.color, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <div style={{ color:'#fff', fontWeight:700, fontSize:13 }}>
            ⚡ {isMulti ? `${multiElements?.length} elementos selecionados` : 'Sugerir ação'}
          </div>
          {element && !isMulti && (
            <div style={{ color:'rgba(255,255,255,0.8)', fontSize:11, marginTop:2 }}>
              {element.type === 'text' ? '📝' : '🖼️'} {element.label?.slice(0,35)}
              {element.font_size && <span style={{ marginLeft:6, opacity:0.7 }}>{element.font_size.toFixed(1)}pt</span>}
            </div>
          )}
        </div>
        <button onClick={onClose} style={{ background:'none', border:'none', color:'#fff', cursor:'pointer', fontSize:18 }}>✕</button>
      </div>

      <div style={{ padding:14, display:'flex', flexDirection:'column', gap:12 }}>
        <div>
          <label style={lSt}>Tipo de ação</label>
          <div style={{ display:'grid', gridTemplateColumns:`repeat(${allowedTypes.length},1fr)`, gap:5 }}>
            {allowedTypes.map(b => (
              <button key={b.type} onClick={() => setActionType(b.type)} style={{
                padding:'7px 4px', background:actionType===b.type ? b.color : '#252540',
                color:'#fff', border:`1px solid ${actionType===b.type ? b.color : '#444'}`,
                borderRadius:7, cursor:'pointer', fontSize:11, fontWeight:actionType===b.type ? 700 : 400 }}>
                {b.icon}<br/><span style={{ fontSize:9 }}>{b.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label style={lSt}>Comentário para o estúdio</label>
          <input value={comment} onChange={e => setComment(e.target.value)}
            placeholder="Ex: Adaptar para versão espanhol..." style={iSt} />
        </div>

        {actionType === 'replace' && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
              <label style={lSt}>Novo texto</label>
              <button onClick={() => setBold(b => !b)} style={{ padding:'2px 8px',
                background:bold ? '#9C27B0' : '#252540', color:'#fff',
                border:`1px solid ${bold ? '#9C27B0' : '#444'}`, borderRadius:5, cursor:'pointer', fontSize:12, fontWeight:700 }}>
                𝐁 {bold ? 'ON' : 'OFF'}
              </button>
            </div>
            <textarea value={newText} onChange={e => setNewText(e.target.value)} rows={3}
              placeholder="Digite o texto substituto..."
              style={{ ...iSt, resize:'vertical', fontFamily:'inherit', fontWeight:bold ? 700 : 400 }} />
          </div>
        )}

        {actionType === 'delete' && (
          <div style={{ padding:10, background:'#2a1515', border:'1px solid #5a1515', borderRadius:8, fontSize:12, color:'#f88' }}>
            ⚠️ {isMulti ? `${multiElements?.length} elementos serão marcados para remoção.` : 'Este elemento será marcado para remoção no draft.'}
          </div>
        )}

        {actionType === 'move' && (
          <div>
            {dragDelta && (
              <div style={{ padding:8, background:'#0d1f15', border:'1px solid #1D9E75', borderRadius:6, fontSize:12, color:'#1D9E75', marginBottom:8 }}>
                ✅ Arrastado: Δx={dxMm.toFixed(1)}mm · Δy={dyMm.toFixed(1)}mm
              </div>
            )}
            <label style={lSt}>Deslocamento em milímetros</label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              <div><label style={{ ...lSt, marginBottom:2 }}>Δx (→)</label>
                <input type="number" value={dxMm} step={0.5} onChange={e => setDxMm(Number(e.target.value))} style={iSt} /></div>
              <div><label style={{ ...lSt, marginBottom:2 }}>Δy (↓)</label>
                <input type="number" value={dyMm} step={0.5} onChange={e => setDyMm(Number(e.target.value))} style={iSt} /></div>
            </div>
          </div>
        )}

        {actionType === 'resize' && element?.type === 'text' && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
              <label style={lSt}>Atual: <strong style={{ color:'#BA7517' }}>{element.font_size?.toFixed(1)}pt</strong></label>
              <button onClick={() => setBold(b => !b)} style={{ padding:'2px 8px',
                background:bold ? '#9C27B0' : '#252540', color:'#fff',
                border:`1px solid ${bold ? '#9C27B0' : '#444'}`, borderRadius:5, cursor:'pointer', fontSize:12, fontWeight:700 }}>
                𝐁 {bold ? 'ON' : 'OFF'}
              </button>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <input type="range" min={4} max={120} step={0.5} value={newFs}
                onChange={e => setNewFs(Number(e.target.value))} style={{ flex:1, accentColor:'#BA7517' }} />
              <input type="number" value={newFs} min={4} max={120} step={0.5}
                onChange={e => setNewFs(Number(e.target.value))} style={{ ...iSt, width:58, textAlign:'center' }} />
              <span style={{ color:'#888', fontSize:11 }}>pt</span>
            </div>
            <div style={{ textAlign:'center', marginTop:4, fontSize:11, color:'#BA7517' }}>
              {element.font_size?.toFixed(1)}pt → <strong>{newFs.toFixed(1)}pt</strong>{' '}
              ({newFs-(element.font_size||0) >= 0 ? '+' : ''}{(newFs-(element.font_size||0)).toFixed(1)}pt)
            </div>
          </div>
        )}

        {actionType === 'bold' && (
          <div style={{ padding:10, background:'#1a0d2e', border:'1px solid #9C27B0', borderRadius:8, fontSize:12, color:'#CE93D8' }}>
            𝐁 O texto será renderizado em <strong>negrito</strong> no draft.
          </div>
        )}

        {error && <div style={{ padding:8, background:'#2a1515', borderRadius:6, fontSize:12, color:'#f88' }}>⚠️ {error}</div>}

        <button onClick={handleSave} disabled={saving} style={{
          padding:'10px 0', background:saved ? '#1D9E75' : activeBtn.color,
          color:'#fff', border:'none', borderRadius:8,
          cursor:saving ? 'wait' : 'pointer', fontSize:13, fontWeight:700, transition:'background 0.2s' }}>
          {saving ? '⏳ Salvando...' : saved ? '✅ Salvo!' : '💾 Salvar ação'}
        </button>
      </div>
    </div>
  )
}

const lSt: React.CSSProperties = { display:'block', fontSize:10, fontWeight:700, color:'#888', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }
const iSt: React.CSSProperties = { width:'100%', padding:'7px 10px', background:'#252540', border:'1px solid #444', borderRadius:6, color:'#fff', fontSize:12, boxSizing:'border-box', fontFamily:'inherit' }
