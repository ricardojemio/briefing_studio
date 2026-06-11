// src/components/sidebar/Sidebar.tsx
// FIXED: action buttons now work directly when element is selected
import { useState } from 'react'
import { useStore } from '../../store'
import { api } from '../../services/api'
import type { BriefingAction, ActionType } from '../../types'

interface SidebarProps {
  artworkId:    string
  page:         number
  totalPages:   number
  onPageChange: (p: number) => void
  onRequestAction?: (type: ActionType) => void
}

const ACTION_COLORS: Record<string, string> = {
  replace: '#1D9E75', delete: '#dc3545',
  move: '#185FA5',    resize: '#BA7517', bold: '#9C27B0',
}
const ACTION_ICONS: Record<string, string> = {
  replace: '✏️', delete: '🗑️', move: '↗️', resize: '🔡', bold: '𝐁',
}

export default function Sidebar({ artworkId, page, totalPages, onPageChange, onRequestAction }: SidebarProps) {
  const { actions, removeAction, setError, activeTool, setActiveTool,
          selectedElem, setSelectedElem, addAction } = useStore()
  const [tab,         setTab]         = useState<'tools' | 'actions' | 'draft'>('tools')
  const [generating,  setGenerating]  = useState(false)
  const [draftResult, setDraftResult] = useState<any>(null)

  // Inline action state
  const [activeAction, setActiveAction] = useState<ActionType | null>(null)
  const [newText,   setNewText]   = useState('')
  const [dxMm,      setDxMm]      = useState(0)
  const [dyMm,      setDyMm]      = useState(0)
  const [newFs,     setNewFs]     = useState(selectedElem?.font_size || 12)
  const [bold,      setBold]      = useState(false)
  const [comment,   setComment]   = useState('')
  const [saving,    setSaving]    = useState(false)
  const [saved,     setSaved]     = useState(false)

  const pageActions = actions.filter(a => a.page === page)

  const handleActionClick = (type: ActionType) => {
    setActiveAction(type)
    setTab('tools')
    if (selectedElem) {
      setNewText(selectedElem.label || '')
      setNewFs(selectedElem.font_size || 12)
    }
    onRequestAction?.(type)
  }

  const handleSave = async () => {
    if (!selectedElem || !activeAction) return
    setSaving(true)
    try {
      const payload: any = {
        artwork_id: artworkId, page,
        action_type: activeAction,
        element_id: selectedElem.elem_id,
        element_type: selectedElem.type,
        original_text: selectedElem.label,
        comment: comment || undefined,
        bold: bold || undefined,
        sel_x: selectedElem.x_norm, sel_y: selectedElem.y_norm,
        sel_w: selectedElem.w_norm, sel_h: selectedElem.h_norm,
      }
      if (activeAction === 'replace') payload.new_text      = newText
      if (activeAction === 'move')    { payload.dx_mm = dxMm; payload.dy_mm = dyMm }
      if (activeAction === 'resize')  payload.new_font_size = newFs

      const action = await api.createAction(payload)
      addAction(action)
      setSaved(true)
      setTimeout(() => {
        setSaved(false); setActiveAction(null)
        setComment(''); setNewText(''); setBold(false)
        setTab('actions')
      }, 1200)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally { setSaving(false) }
  }

  const handleDeleteAction = async (action: BriefingAction) => {
    try { await api.deleteAction(action.id); removeAction(action.id) }
    catch (e) { console.error(e) }
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const result = await api.generateDraft(artworkId, page)
      setDraftResult(result); setTab('draft')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar draft')
    } finally { setGenerating(false) }
  }

  const acColor = activeAction ? ACTION_COLORS[activeAction] : '#185FA5'

  return (
    <div style={{ width: 240, background: '#12121f', borderLeft: '1px solid #222',
      display: 'flex', flexDirection: 'column', height: '100%', flexShrink: 0 }}>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #222' }}>
        {(['tools', 'actions', 'draft'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '10px 4px', border: 'none',
            background: tab === t ? '#1a1a2e' : 'transparent',
            color: tab === t ? '#fff' : '#555', fontSize: 10, cursor: 'pointer',
            fontWeight: tab === t ? 700 : 400, textTransform: 'uppercase',
            letterSpacing: '0.05em',
            borderBottom: tab === t ? '2px solid #185FA5' : '2px solid transparent',
          }}>
            {t === 'tools' ? '🛠' : t === 'actions' ? '📋' : '📄'}<br />{t}
            {t === 'actions' && pageActions.length > 0 && (
              <span style={{ marginLeft: 3, background: '#185FA5', borderRadius: 10, padding: '0 4px', fontSize: 9 }}>
                {pageActions.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>

        {/* ── TOOLS ── */}
        {tab === 'tools' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

            {/* Selected element info */}
            {selectedElem ? (
              <div style={{ padding: '8px 10px', background: '#1a1a2e',
                border: '1px solid #185FA5', borderRadius: 8, marginBottom: 4 }}>
                <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  Elemento selecionado
                </div>
                <div style={{ fontSize: 12, color: '#7ab3ff', fontWeight: 600 }}>
                  {selectedElem.type === 'text' ? '📝' : '🖼️'} {selectedElem.label?.slice(0, 30)}
                </div>
                {selectedElem.font_size && (
                  <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>
                    {selectedElem.font_name?.slice(0,20)} · {selectedElem.font_size.toFixed(1)}pt
                  </div>
                )}
                <button onClick={() => setSelectedElem(null)}
                  style={{ marginTop: 6, width: '100%', padding: '4px', background: 'transparent',
                    border: '1px solid #333', borderRadius: 5, color: '#555', cursor: 'pointer', fontSize: 10 }}>
                  ✕ Limpar seleção
                </button>
              </div>
            ) : (
              <div style={{ padding: '10px', background: '#1a1a2e', borderRadius: 8, marginBottom: 4, textAlign: 'center' }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>👆</div>
                <div style={{ fontSize: 11, color: '#555', lineHeight: 1.5 }}>
                  Clique num elemento na arte para selecionar
                </div>
              </div>
            )}

            {/* Action buttons */}
            <p style={secLbl}>Ações</p>
            {[
              { type: 'replace' as ActionType, icon: '✏️', label: 'Replace', desc: 'Substituir texto' },
              { type: 'delete'  as ActionType, icon: '🗑️', label: 'Delete',  desc: 'Remover elemento' },
              { type: 'move'    as ActionType, icon: '↗️', label: 'Move',    desc: 'Mover posição (mm)' },
              { type: 'resize'  as ActionType, icon: '🔡', label: 'Resize',  desc: 'Alterar tamanho da fonte' },
              { type: 'bold'    as ActionType, icon: '𝐁',  label: 'Bold',    desc: 'Aplicar negrito' },
            ].map(a => (
              <button key={a.type}
                onClick={() => handleActionClick(a.type)}
                disabled={!selectedElem}
                style={{
                  padding: '10px', textAlign: 'left', cursor: selectedElem ? 'pointer' : 'not-allowed',
                  background: activeAction === a.type ? ACTION_COLORS[a.type] : '#1a1a2e',
                  border: `1px solid ${activeAction === a.type ? ACTION_COLORS[a.type] : '#333'}`,
                  borderRadius: 8, color: selectedElem ? '#fff' : '#444',
                  opacity: selectedElem ? 1 : 0.5, transition: 'all 0.15s',
                }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{a.icon} {a.label}</div>
                <div style={{ fontSize: 10, color: activeAction === a.type ? 'rgba(255,255,255,0.7)' : '#555', marginTop: 2 }}>
                  {a.desc}
                </div>
              </button>
            ))}

            {/* Inline action form */}
            {activeAction && selectedElem && (
              <div style={{ marginTop: 8, padding: 12, background: '#1a1a2e',
                border: `1px solid ${acColor}`, borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: acColor, marginBottom: 10 }}>
                  {ACTION_ICONS[activeAction]} {activeAction.toUpperCase()}
                </div>

                <div style={{ marginBottom: 8 }}>
                  <label style={lSt}>Comentário</label>
                  <input value={comment} onChange={e => setComment(e.target.value)}
                    placeholder="Instrução para o estúdio..."
                    style={iSt} />
                </div>

                {activeAction === 'replace' && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <label style={lSt}>Novo texto</label>
                      <button onClick={() => setBold(b => !b)} style={{
                        padding: '1px 6px', background: bold ? '#9C27B0' : '#252540',
                        color: '#fff', border: `1px solid ${bold ? '#9C27B0' : '#444'}`,
                        borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                        𝐁
                      </button>
                    </div>
                    <textarea value={newText} onChange={e => setNewText(e.target.value)}
                      rows={3} style={{ ...iSt, resize: 'vertical' }} />
                  </div>
                )}

                {activeAction === 'move' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                    <div>
                      <label style={lSt}>Δx (mm)</label>
                      <input type="number" value={dxMm} step={0.5}
                        onChange={e => setDxMm(Number(e.target.value))} style={iSt} />
                    </div>
                    <div>
                      <label style={lSt}>Δy (mm)</label>
                      <input type="number" value={dyMm} step={0.5}
                        onChange={e => setDyMm(Number(e.target.value))} style={iSt} />
                    </div>
                  </div>
                )}

                {activeAction === 'resize' && (
                  <div style={{ marginBottom: 8 }}>
                    <label style={lSt}>
                      Atual: <strong style={{ color: '#BA7517' }}>{selectedElem.font_size?.toFixed(1)}pt</strong>
                      {' → '}
                      <strong style={{ color: '#fff' }}>{newFs.toFixed(1)}pt</strong>
                    </label>
                    <input type="range" min={4} max={120} step={0.5} value={newFs}
                      onChange={e => setNewFs(Number(e.target.value))}
                      style={{ width: '100%', accentColor: '#BA7517', margin: '6px 0' }} />
                    <input type="number" value={newFs} min={4} max={120} step={0.5}
                      onChange={e => setNewFs(Number(e.target.value))}
                      style={{ ...iSt, textAlign: 'center' }} />
                  </div>
                )}

                {activeAction === 'delete' && (
                  <div style={{ padding: 8, background: '#2a1515', borderRadius: 6, fontSize: 11, color: '#f88', marginBottom: 8 }}>
                    ⚠️ Elemento será removido no draft.
                  </div>
                )}

                {activeAction === 'bold' && (
                  <div style={{ padding: 8, background: '#1a0d2e', borderRadius: 6, fontSize: 11, color: '#CE93D8', marginBottom: 8 }}>
                    𝐁 Texto será renderizado em negrito.
                  </div>
                )}

                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={handleSave} disabled={saving} style={{
                    flex: 1, padding: '8px', background: saved ? '#1D9E75' : acColor,
                    color: '#fff', border: 'none', borderRadius: 7,
                    cursor: saving ? 'wait' : 'pointer', fontSize: 12, fontWeight: 700 }}>
                    {saving ? '⏳...' : saved ? '✅ Salvo!' : '💾 Salvar'}
                  </button>
                  <button onClick={() => setActiveAction(null)} style={{
                    padding: '8px 10px', background: '#252540', color: '#888',
                    border: '1px solid #444', borderRadius: 7, cursor: 'pointer', fontSize: 12 }}>
                    ✕
                  </button>
                </div>
              </div>
            )}

            <div style={{ marginTop: 8, padding: 8, background: '#1a1208',
              border: '1px solid #3a2a08', borderRadius: 6 }}>
              <p style={{ fontSize: 10, color: '#BA7517', margin: 0, lineHeight: 1.5 }}>
                🚫 <strong>Não permitido:</strong><br />
                Cores · Vetores · Dimensões · Pantone
              </p>
            </div>
          </div>
        )}

        {/* ── ACTIONS ── */}
        {tab === 'actions' && (
          <div>
            <p style={secLbl}>Ações — Página {page + 1}</p>
            {pageActions.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#444', padding: '24px 8px', fontSize: 12 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                Selecione um elemento e aplique uma ação.
              </div>
            ) : pageActions.map((action, i) => (
              <div key={action.id} style={{ marginBottom: 6, background: '#1a1a2e',
                borderLeft: `3px solid ${ACTION_COLORS[action.action_type] || '#888'}`,
                borderRadius: '0 8px 8px 0', padding: '8px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: ACTION_COLORS[action.action_type], marginBottom: 2 }}>
                      {ACTION_ICONS[action.action_type]} {action.action_type.toUpperCase()}
                    </div>
                    <div style={{ fontSize: 11, color: '#aaa' }}>{action.original_text?.slice(0, 30) || '—'}</div>
                    {action.new_text      && <div style={{ fontSize: 10, color: '#1D9E75', marginTop: 2 }}>→ {action.new_text.slice(0, 25)}</div>}
                    {action.new_font_size && <div style={{ fontSize: 10, color: '#BA7517', marginTop: 2 }}>→ {action.new_font_size}pt</div>}
                    {(action.dx_mm || action.dy_mm) && <div style={{ fontSize: 10, color: '#185FA5', marginTop: 2 }}>Δx={action.dx_mm?.toFixed(1)}mm Δy={action.dy_mm?.toFixed(1)}mm</div>}
                  </div>
                  <button onClick={() => handleDeleteAction(action)}
                    style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, padding: 2 }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── DRAFT ── */}
        {tab === 'draft' && (
          <div>
            <p style={secLbl}>Draft</p>
            {draftResult ? (
              <div>
                <div style={{ padding: 10, background: '#0d1f15', border: '1px solid #1D9E75', borderRadius: 8, marginBottom: 8 }}>
                  <p style={{ color: '#1D9E75', fontSize: 12, fontWeight: 700, margin: 0 }}>✅ Draft gerado</p>
                  <p style={{ color: '#888', fontSize: 11, margin: '4px 0 0' }}>
                    {draftResult.actions_applied} ações · {draftResult.actions_failed > 0 ? `${draftResult.actions_failed} falharam` : 'sem erros'}
                  </p>
                </div>
                <a href={`${draftResult.draft_url}?t=${Date.now()}`} target="_blank" rel="noreferrer"
                  style={{ display: 'block', padding: 8, background: '#185FA5', color: '#fff',
                    borderRadius: 8, textAlign: 'center', fontSize: 12, textDecoration: 'none', fontWeight: 700, marginBottom: 8 }}>
                  📄 Abrir draft PDF
                </a>
                <button onClick={handleGenerate} disabled={generating}
                  style={{ width: '100%', padding: 8, background: '#252540', color: '#888',
                    border: '1px solid #333', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                  🔄 Regenerar
                </button>
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: '#444', padding: '24px 8px', fontSize: 12 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                Adicione ações e gere o draft.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom */}
      <div style={{ padding: 10, borderTop: '1px solid #222', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <button disabled={page === 0} onClick={() => onPageChange(page - 1)}
              style={{ ...navBtn, opacity: page === 0 ? 0.3 : 1 }}>◀</button>
            <span style={{ flex: 1, textAlign: 'center', fontSize: 11, color: '#888' }}>{page + 1} / {totalPages}</span>
            <button disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}
              style={{ ...navBtn, opacity: page >= totalPages - 1 ? 0.3 : 1 }}>▶</button>
          </div>
        )}
        <button onClick={handleGenerate} disabled={generating || pageActions.length === 0}
          style={{ padding: '10px 0', background: pageActions.length > 0 ? '#185FA5' : '#252540',
            color: pageActions.length > 0 ? '#fff' : '#444', border: 'none', borderRadius: 8,
            cursor: pageActions.length > 0 ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700 }}>
          {generating ? '⏳ Gerando...' : `🚀 Gerar draft${pageActions.length > 0 ? ` (${pageActions.length})` : ''}`}
        </button>
      </div>
    </div>
  )
}

const secLbl: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '4px 0 8px' }
const lSt:    React.CSSProperties = { display: 'block', fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }
const iSt:    React.CSSProperties = { width: '100%', padding: '7px 10px', background: '#0d0d1a', border: '1px solid #333', borderRadius: 6, color: '#ddd', fontSize: 12, boxSizing: 'border-box', fontFamily: 'inherit' }
const navBtn: React.CSSProperties = { background: '#1a1a2e', border: '1px solid #333', color: '#fff', borderRadius: 6, cursor: 'pointer', padding: '4px 8px', fontSize: 12 }
