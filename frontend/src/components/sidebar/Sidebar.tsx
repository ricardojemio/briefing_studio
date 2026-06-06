// src/components/sidebar/Sidebar.tsx
import { useState } from 'react'
import { useStore } from '../../store'
import { api } from '../../services/api'
import type { BriefingAction } from '../../types'

interface SidebarProps {
  artworkId: string
  page:      number
  totalPages: number
  onPageChange: (p: number) => void
}

const ACTION_COLORS: Record<string, string> = {
  replace: '#1D9E75', delete: '#dc3545',
  move:    '#185FA5', resize: '#BA7517',
}
const ACTION_ICONS: Record<string, string> = {
  replace: '✏️', delete: '🗑️', move: '↗️', resize: '🔡',
}

export default function Sidebar({ artworkId, page, totalPages, onPageChange }: SidebarProps) {
  const { actions, removeAction, setDraftUrl, setError, activeTool, setActiveTool } = useStore()
  const [tab,        setTab]        = useState<'tools' | 'actions' | 'draft'>('tools')
  const [generating, setGenerating] = useState(false)
  const [draftResult, setDraftResult] = useState<any>(null)

  const pageActions = actions.filter(a => a.page === page)

  const handleDelete = async (action: BriefingAction) => {
    try {
      await api.deleteAction(action.id)
      removeAction(action.id)
    } catch (e) {
      console.error(e)
    }
  }

  const handleGenerate = async () => {
    if (!artworkId) return
    setGenerating(true)
    try {
      const result = await api.generateDraft(artworkId, page)
      setDraftUrl(result.draft_url)
      setDraftResult(result)
      setTab('draft')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar draft')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div style={{
      width: 220, background: '#12121f',
      borderLeft: '1px solid #222', display: 'flex',
      flexDirection: 'column', height: '100%', flexShrink: 0,
    }}>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #222' }}>
        {(['tools', 'actions', 'draft'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '10px 4px', border: 'none',
            background: tab === t ? '#1a1a2e' : 'transparent',
            color: tab === t ? '#fff' : '#555',
            fontSize: 10, cursor: 'pointer',
            fontWeight: tab === t ? 700 : 400,
            textTransform: 'uppercase', letterSpacing: '0.05em',
            borderBottom: tab === t ? '2px solid #185FA5' : '2px solid transparent',
          }}>
            {t === 'tools' ? '🛠' : t === 'actions' ? '📋' : '📄'}
            <br />{t}
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
            <p style={sectionLabel}>Ferramentas</p>

            {[
              { id: 'select',    icon: '↖️', label: 'Selecionar elemento', desc: 'Clique num elemento detectado' },
              { id: 'region',    icon: '⬜', label: 'Selecionar região',    desc: 'Arraste para delimitar área' },
            ].map(tool => (
              <button key={tool.id}
                onClick={() => setActiveTool(tool.id as any)}
                style={{
                  padding: '10px 10px', background: activeTool === tool.id ? '#185FA5' : '#1a1a2e',
                  border: `1px solid ${activeTool === tool.id ? '#185FA5' : '#333'}`,
                  borderRadius: 8, cursor: 'pointer', textAlign: 'left', color: '#fff',
                }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{tool.icon} {tool.label}</div>
                <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{tool.desc}</div>
              </button>
            ))}

            <p style={{ ...sectionLabel, marginTop: 12 }}>Ações permitidas</p>
            {[
              { icon: '✏️', label: 'Replace',  desc: 'Substituir texto' },
              { icon: '🗑️', label: 'Delete',   desc: 'Remover elemento' },
              { icon: '↗️', label: 'Move',     desc: 'Mover posição (mm)' },
              { icon: '🔡', label: 'Resize',   desc: 'Alterar tamanho da fonte' },
            ].map(a => (
              <div key={a.label} style={{ padding: '6px 8px', background: '#1a1a2e', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>{a.icon}</span>
                <div>
                  <div style={{ fontSize: 11, color: '#ddd', fontWeight: 600 }}>{a.label}</div>
                  <div style={{ fontSize: 10, color: '#555' }}>{a.desc}</div>
                </div>
              </div>
            ))}

            <div style={{ marginTop: 8, padding: 8, background: '#1a1208', border: '1px solid #3a2a08', borderRadius: 6 }}>
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
            <p style={sectionLabel}>Ações — Página {page + 1}</p>
            {pageActions.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#444', padding: '24px 8px', fontSize: 12 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                Selecione um elemento na arte para adicionar ações.
              </div>
            ) : (
              pageActions.map((action, i) => (
                <div key={action.id} style={{
                  marginBottom: 6, background: '#1a1a2e',
                  borderLeft: `3px solid ${ACTION_COLORS[action.action_type] || '#888'}`,
                  borderRadius: '0 8px 8px 0', padding: '8px 10px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: ACTION_COLORS[action.action_type], marginBottom: 2 }}>
                        {ACTION_ICONS[action.action_type]} {action.action_type.toUpperCase()}
                      </div>
                      <div style={{ fontSize: 11, color: '#aaa' }}>
                        {action.original_text?.slice(0, 30) || action.element_id || '—'}
                      </div>
                      {action.new_text && (
                        <div style={{ fontSize: 10, color: '#1D9E75', marginTop: 2 }}>→ {action.new_text.slice(0, 25)}</div>
                      )}
                      {action.new_font_size && (
                        <div style={{ fontSize: 10, color: '#BA7517', marginTop: 2 }}>→ {action.new_font_size}pt</div>
                      )}
                      {(action.dx_mm || action.dy_mm) && (
                        <div style={{ fontSize: 10, color: '#185FA5', marginTop: 2 }}>
                          Δx={action.dx_mm?.toFixed(1)}mm Δy={action.dy_mm?.toFixed(1)}mm
                        </div>
                      )}
                      {action.comment && (
                        <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{action.comment.slice(0,35)}</div>
                      )}
                    </div>
                    <button onClick={() => handleDelete(action)}
                      style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, padding: 2, flexShrink: 0 }}
                      title="Remover ação">✕</button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── DRAFT ── */}
        {tab === 'draft' && (
          <div>
            <p style={sectionLabel}>Draft</p>

            {draftResult ? (
              <div>
                <div style={{ padding: 10, background: '#0d1f15', border: '1px solid #1D9E75', borderRadius: 8, marginBottom: 8 }}>
                  <p style={{ color: '#1D9E75', fontSize: 12, fontWeight: 700, margin: 0 }}>✅ Draft gerado</p>
                  <p style={{ color: '#888', fontSize: 11, margin: '4px 0 0' }}>
                    {draftResult.actions_applied} ações aplicadas
                    {draftResult.actions_failed > 0 && ` · ${draftResult.actions_failed} falharam`}
                  </p>
                </div>
                <a href={`${draftResult.draft_url}?t=${Date.now()}`}
                  target="_blank" rel="noreferrer"
                  style={{ display: 'block', padding: 8, background: '#185FA5', color: '#fff', borderRadius: 8, textAlign: 'center', fontSize: 12, textDecoration: 'none', fontWeight: 700, marginBottom: 8 }}>
                  📄 Abrir draft PDF
                </a>
                <button onClick={handleGenerate} disabled={generating}
                  style={{ width: '100%', padding: 8, background: '#252540', color: '#888', border: '1px solid #333', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                  🔄 Regenerar
                </button>
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: '#444', padding: '24px 8px', fontSize: 12 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
                Adicione ações e gere o draft para ver o resultado.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom actions */}
      <div style={{ padding: 10, borderTop: '1px solid #222', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Page navigation */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <button disabled={page === 0} onClick={() => onPageChange(page - 1)}
              style={{ ...navBtn, opacity: page === 0 ? 0.3 : 1 }}>◀</button>
            <span style={{ flex: 1, textAlign: 'center', fontSize: 11, color: '#888' }}>
              {page + 1} / {totalPages}
            </span>
            <button disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}
              style={{ ...navBtn, opacity: page >= totalPages - 1 ? 0.3 : 1 }}>▶</button>
          </div>
        )}

        <button onClick={handleGenerate} disabled={generating || pageActions.length === 0}
          style={{
            padding: '10px 0', background: pageActions.length > 0 ? '#185FA5' : '#252540',
            color: pageActions.length > 0 ? '#fff' : '#444',
            border: 'none', borderRadius: 8,
            cursor: pageActions.length > 0 ? 'pointer' : 'not-allowed',
            fontSize: 13, fontWeight: 700,
          }}>
          {generating
            ? '⏳ Gerando...'
            : `🚀 Gerar draft${pageActions.length > 0 ? ` (${pageActions.length})` : ''}`}
        </button>
      </div>
    </div>
  )
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#555',
  textTransform: 'uppercase', letterSpacing: '0.06em',
  margin: '4px 0 8px',
}
const navBtn: React.CSSProperties = {
  background: '#1a1a2e', border: '1px solid #333',
  color: '#fff', borderRadius: 6, cursor: 'pointer',
  padding: '4px 8px', fontSize: 12,
}
