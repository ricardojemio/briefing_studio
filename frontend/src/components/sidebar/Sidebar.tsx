// src/components/sidebar/Sidebar.tsx
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

// ── Design tokens ────────────────────────────────────────────────
const T = {
  bgBase:      '#0C0E14',
  bgSurface:   '#141720',
  bgElevated:  '#1C2030',
  border:      '#2A2F3F',
  accent:      '#2D6BE4',
  success:     '#1A9E6F',
  danger:      '#D63C3C',
  warning:     '#C47E1A',
  purple:      '#7C3AED',
  textPrimary: '#E8ECF4',
  textSecond:  '#7A8299',
  textMuted:   '#3D4560',
} as const

const ACTION_META: Record<ActionType, { label: string; color: string; textOnly?: boolean }> = {
  replace: { label: 'Replace', color: T.success, textOnly: true },
  delete:  { label: 'Delete',  color: T.danger },
  move:    { label: 'Move',    color: T.accent },
  resize:  { label: 'Resize',  color: T.warning, textOnly: true },
  bold:    { label: 'Bold',    color: T.purple,  textOnly: true },
}

export default function Sidebar({ artworkId, page, totalPages, onPageChange, onRequestAction }: SidebarProps) {
  const { actions, removeAction, setError, selectedElem, setSelectedElem, addAction } = useStore()
  const [tab,         setTab]         = useState<'tools' | 'actions' | 'draft'>('tools')
  const [generating,  setGenerating]  = useState(false)
  const [draftResult, setDraftResult] = useState<any>(null)

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
      setError(e instanceof Error ? e.message : 'Error saving action')
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
      setError(e instanceof Error ? e.message : 'Error generating draft')
    } finally { setGenerating(false) }
  }

  const acMeta = activeAction ? ACTION_META[activeAction] : null

  return (
    <div style={{
      width: 256, background: T.bgSurface, borderLeft: `1px solid ${T.border}`,
      display: 'flex', flexDirection: 'column', height: '100%', flexShrink: 0,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        {(['tools', 'actions', 'draft'] as const).map(t => {
          const active = tab === t
          const badge  = t === 'actions' && pageActions.length > 0 ? pageActions.length : null
          const labels: Record<string, string> = { tools: 'Tools', actions: 'Actions', draft: 'Draft' }
          return (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '11px 4px', border: 'none',
              background: 'transparent',
              color: active ? T.textPrimary : T.textSecond,
              fontSize: 10, cursor: 'pointer',
              fontWeight: active ? 700 : 400,
              textTransform: 'uppercase', letterSpacing: '0.08em',
              borderBottom: `2px solid ${active ? T.accent : 'transparent'}`,
              transition: 'color 0.15s, border-color 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}>
              {labels[t]}
              {badge !== null && (
                <span style={{
                  background: T.accent, color: '#fff', borderRadius: 10,
                  padding: '1px 5px', fontSize: 9, fontWeight: 700,
                }}>{badge}</span>
              )}
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 0' }}>

        {/* ══════════ TOOLS ══════════ */}
        {tab === 'tools' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

            <SectionLabel>Element</SectionLabel>

            {selectedElem ? (
              <div style={{
                padding: '10px 12px', background: T.bgElevated,
                border: `1px solid ${T.accent}40`, borderRadius: 8,
              }}>
                <TypeBadge type={selectedElem.type} />
                <div style={{
                  marginTop: 6,
                  fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
                  fontSize: 11, color: T.textPrimary, lineHeight: 1.4, wordBreak: 'break-word',
                }}>
                  {selectedElem.label?.slice(0, 60)}{(selectedElem.label?.length || 0) > 60 ? '…' : ''}
                </div>
                {selectedElem.font_size && (
                  <div style={{ marginTop: 5, fontSize: 10, color: T.textSecond, fontFamily: 'monospace' }}>
                    {selectedElem.font_name?.split(',')[0].slice(0, 22)} · {selectedElem.font_size.toFixed(1)} pt
                  </div>
                )}
                <button onClick={() => { setSelectedElem(null); setActiveAction(null) }} style={{
                  marginTop: 8, width: '100%', padding: '4px 0',
                  background: 'transparent', border: `1px solid ${T.border}`,
                  borderRadius: 5, color: T.textMuted, cursor: 'pointer', fontSize: 10,
                  letterSpacing: '0.04em',
                }}>
                  Clear selection
                </button>
              </div>
            ) : (
              <div style={{
                padding: '20px 12px', background: T.bgElevated,
                borderRadius: 8, textAlign: 'center',
                border: `1px dashed ${T.border}`,
              }}>
                <div style={{ fontSize: 22, marginBottom: 6, opacity: 0.4 }}>◎</div>
                <div style={{ fontSize: 11, color: T.textSecond, lineHeight: 1.5 }}>
                  Click any highlighted element to select it
                </div>
              </div>
            )}

            <SectionLabel style={{ marginTop: 8 }}>Actions</SectionLabel>

            {!selectedElem ? (
              <div style={{
                padding: '10px 12px', borderRadius: 7,
                background: T.bgElevated, border: `1px dashed ${T.border}`,
                fontSize: 11, color: T.textMuted, textAlign: 'center',
              }}>
                Select an element to enable actions
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                {(Object.keys(ACTION_META) as ActionType[]).map(type => {
                  const meta     = ACTION_META[type]
                  const allowed  = selectedElem.allowed_actions.includes(type)
                  const textOnly = meta.textOnly && selectedElem.type !== 'text'
                  const enabled  = allowed && !textOnly
                  const isActive = activeAction === type
                  return (
                    <button key={type}
                      onClick={() => enabled && handleActionClick(type)}
                      disabled={!enabled}
                      title={!enabled ? (textOnly ? 'Text elements only' : 'Not available') : meta.label}
                      style={{
                        padding: '9px 8px', textAlign: 'left',
                        cursor: enabled ? 'pointer' : 'not-allowed',
                        background: isActive ? `${meta.color}22` : T.bgElevated,
                        border: `1px solid ${isActive ? meta.color : T.border}`,
                        borderRadius: 7, color: enabled ? T.textPrimary : T.textMuted,
                        opacity: enabled ? 1 : 0.4, transition: 'all 0.12s',
                      }}>
                      <div style={{ fontSize: 11, fontWeight: isActive ? 700 : 500, color: isActive ? meta.color : T.textPrimary }}>
                        {meta.label}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Inline action form */}
            {activeAction && selectedElem && acMeta && (
              <div style={{
                marginTop: 4, padding: 12, background: T.bgElevated,
                border: `1px solid ${acMeta.color}50`, borderRadius: 8,
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: acMeta.color,
                  letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10,
                }}>
                  {acMeta.label}
                </div>

                <FieldLabel>Studio note</FieldLabel>
                <input value={comment} onChange={e => setComment(e.target.value)}
                  placeholder="Instructions for the studio…"
                  style={inputSt} />

                {activeAction === 'replace' && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <FieldLabel>New text</FieldLabel>
                      <button onClick={() => setBold(b => !b)} style={{
                        padding: '2px 8px',
                        background: bold ? `${T.purple}33` : 'transparent',
                        color: bold ? T.purple : T.textSecond,
                        border: `1px solid ${bold ? T.purple : T.border}`,
                        borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                      }}>B</button>
                    </div>
                    <textarea value={newText} onChange={e => setNewText(e.target.value)}
                      rows={3} placeholder="Replacement text…"
                      style={{ ...inputSt, resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontWeight: bold ? 700 : 400 }} />
                  </div>
                )}

                {activeAction === 'move' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
                    <div>
                      <FieldLabel>Δx (mm)</FieldLabel>
                      <input type="number" value={dxMm} step={0.5}
                        onChange={e => setDxMm(Number(e.target.value))} style={inputSt} />
                    </div>
                    <div>
                      <FieldLabel>Δy (mm)</FieldLabel>
                      <input type="number" value={dyMm} step={0.5}
                        onChange={e => setDyMm(Number(e.target.value))} style={inputSt} />
                    </div>
                  </div>
                )}

                {activeAction === 'resize' && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <FieldLabel>Font size</FieldLabel>
                      <span style={{ fontSize: 10, color: T.textSecond, fontFamily: 'monospace' }}>
                        {selectedElem.font_size?.toFixed(1)} pt → <strong style={{ color: T.textPrimary }}>{newFs.toFixed(1)} pt</strong>
                      </span>
                    </div>
                    <input type="range" min={4} max={120} step={0.5} value={newFs}
                      onChange={e => setNewFs(Number(e.target.value))}
                      style={{ width: '100%', accentColor: T.warning, marginBottom: 6 }} />
                    <input type="number" value={newFs} min={4} max={120} step={0.5}
                      onChange={e => setNewFs(Number(e.target.value))}
                      style={{ ...inputSt, textAlign: 'center' }} />
                  </div>
                )}

                {activeAction === 'delete' && (
                  <div style={{
                    marginTop: 8, padding: '8px 10px', background: `${T.danger}18`,
                    border: `1px solid ${T.danger}40`, borderRadius: 6,
                    fontSize: 11, color: '#f99',
                  }}>
                    This element will be marked for removal in the draft.
                  </div>
                )}

                {activeAction === 'bold' && (
                  <div style={{
                    marginTop: 8, padding: '8px 10px', background: `${T.purple}18`,
                    border: `1px solid ${T.purple}40`, borderRadius: 6,
                    fontSize: 11, color: '#c4a0ff',
                  }}>
                    Text will be rendered in <strong>bold</strong> in the draft.
                  </div>
                )}

                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <button onClick={handleSave} disabled={saving} style={{
                    flex: 1, padding: '9px 0',
                    background: saved ? T.success : acMeta.color,
                    color: '#fff', border: 'none', borderRadius: 7,
                    cursor: saving ? 'wait' : 'pointer',
                    fontSize: 12, fontWeight: 700, transition: 'background 0.2s',
                    letterSpacing: '0.03em',
                  }}>
                    {saving ? 'Saving…' : saved ? 'Action saved' : 'Save action'}
                  </button>
                  <button onClick={() => setActiveAction(null)} style={{
                    padding: '9px 10px', background: 'transparent', color: T.textSecond,
                    border: `1px solid ${T.border}`, borderRadius: 7,
                    cursor: 'pointer', fontSize: 12,
                  }}>✕</button>
                </div>
              </div>
            )}

            <div style={{
              marginTop: 8, padding: '8px 10px', background: `${T.warning}10`,
              border: `1px solid ${T.warning}30`, borderRadius: 6,
            }}>
              <p style={{ fontSize: 10, color: T.warning, margin: 0, lineHeight: 1.6 }}>
                <strong>Out of scope:</strong> colours · vectors · Pantone · dimensions
              </p>
            </div>
          </div>
        )}

        {/* ══════════ ACTIONS ══════════ */}
        {tab === 'actions' && (
          <div>
            <SectionLabel>Actions — Page {page + 1}</SectionLabel>
            {pageActions.length === 0 ? (
              <EmptyState icon="◈" message="No actions yet. Select an element and choose an action to begin." />
            ) : pageActions.map(action => (
              <ActionCard key={action.id} action={action} onDelete={() => handleDeleteAction(action)} />
            ))}
          </div>
        )}

        {/* ══════════ DRAFT ══════════ */}
        {tab === 'draft' && (
          <div>
            <SectionLabel>Draft</SectionLabel>
            {draftResult ? (
              <div>
                <div style={{
                  padding: '10px 12px', background: `${T.success}15`,
                  border: `1px solid ${T.success}40`, borderRadius: 8, marginBottom: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ color: T.success, fontSize: 12, fontWeight: 700 }}>
                      Draft generated
                    </span>
                    {draftResult.engine === 'pdf_native' && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                        background: T.success, color: '#fff',
                        padding: '1px 6px', borderRadius: 10,
                      }}>PDF native</span>
                    )}
                    {draftResult.engine === 'raster' && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                        background: T.warning, color: '#fff',
                        padding: '1px 6px', borderRadius: 10,
                      }}>Raster</span>
                    )}
                  </div>
                  <div style={{ color: T.textSecond, fontSize: 11 }}>
                    {draftResult.actions_applied} applied
                    {draftResult.actions_skipped > 0 && (
                      <span style={{ color: T.textMuted }}> · {draftResult.actions_skipped} skipped</span>
                    )}
                    {draftResult.actions_failed > 0 && (
                      <span style={{ color: T.danger }}> · {draftResult.actions_failed} failed</span>
                    )}
                  </div>
                </div>
                <a
                  href={`${draftResult.draft_url}?t=${Date.now()}`}
                  target="_blank" rel="noreferrer"
                  style={{
                    display: 'block', padding: '9px 0',
                    background: T.accent, color: '#fff', borderRadius: 8,
                    textAlign: 'center', fontSize: 12, textDecoration: 'none',
                    fontWeight: 700, marginBottom: 8, letterSpacing: '0.03em',
                  }}>
                  Open draft PDF
                </a>
                <button onClick={handleGenerate} disabled={generating} style={{
                  width: '100%', padding: '8px 0', background: 'transparent',
                  color: T.textSecond, border: `1px solid ${T.border}`,
                  borderRadius: 8, cursor: 'pointer', fontSize: 12,
                }}>
                  {generating ? 'Regenerating…' : 'Regenerate'}
                </button>
              </div>
            ) : (
              <EmptyState icon="◱" message="Add actions then generate a draft to review your changes." />
            )}
          </div>
        )}
      </div>

      {/* ── Bottom bar ── */}
      <div style={{
        padding: '10px', borderTop: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0,
      }}>
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button disabled={page === 0} onClick={() => onPageChange(page - 1)}
              style={{ ...navBtn, opacity: page === 0 ? 0.3 : 1 }}>◀</button>
            <span style={{ flex: 1, textAlign: 'center', fontSize: 11, color: T.textSecond, fontFamily: 'monospace' }}>
              {page + 1} / {totalPages}
            </span>
            <button disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}
              style={{ ...navBtn, opacity: page >= totalPages - 1 ? 0.3 : 1 }}>▶</button>
          </div>
        )}
        <button
          onClick={handleGenerate}
          disabled={generating || pageActions.length === 0}
          style={{
            padding: '10px 0',
            background: pageActions.length > 0 ? T.accent : T.bgElevated,
            color: pageActions.length > 0 ? '#fff' : T.textMuted,
            border: 'none', borderRadius: 8,
            cursor: pageActions.length > 0 ? 'pointer' : 'not-allowed',
            fontSize: 13, fontWeight: 700, letterSpacing: '0.03em',
            transition: 'background 0.15s',
          }}>
          {generating
            ? 'Generating draft…'
            : pageActions.length > 0
              ? `Generate draft (${pageActions.length})`
              : 'Generate draft'}
        </button>
      </div>
    </div>
  )
}

// ── Shared sub-components ─────────────────────────────────────────

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <p style={{
      fontSize: 10, fontWeight: 700, color: T.textMuted,
      textTransform: 'uppercase', letterSpacing: '0.08em',
      margin: '2px 0 6px', ...style,
    }}>
      {children}
    </p>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label style={{
      display: 'block', fontSize: 10, fontWeight: 700, color: T.textSecond,
      textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
    }}>
      {children}
    </label>
  )
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    text: T.accent, image: T.success, logo: T.warning,
    barcode: T.danger, vector: T.textSecond,
  }
  const c = colors[type] || T.textSecond
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
      color: c, background: `${c}20`, border: `1px solid ${c}40`,
      padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase',
    }}>
      {type}
    </span>
  )
}

function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <div style={{
      textAlign: 'center', padding: '28px 10px', color: T.textMuted,
      borderRadius: 8, border: `1px dashed ${T.border}`,
    }}>
      <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.5 }}>{icon}</div>
      <div style={{ fontSize: 11, lineHeight: 1.6 }}>{message}</div>
    </div>
  )
}

const ACTION_COLOR_MAP: Record<string, string> = {
  replace: '#1A9E6F', delete: '#D63C3C',
  move: '#2D6BE4',    resize: '#C47E1A', bold: '#7C3AED',
}

function ActionCard({ action, onDelete }: { action: BriefingAction; onDelete: () => void }) {
  const color = ACTION_COLOR_MAP[action.action_type] || T.textSecond
  return (
    <div style={{
      marginBottom: 5, background: T.bgElevated,
      borderLeft: `3px solid ${color}`,
      borderRadius: '0 7px 7px 0', padding: '8px 10px',
      display: 'flex', justifyContent: 'space-between', gap: 6,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color,
          letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 3,
        }}>
          {action.action_type}
        </div>
        <div style={{
          fontSize: 11, color: T.textSecond, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontFamily: 'ui-monospace, monospace',
        }}>
          {action.original_text?.slice(0, 32) || '—'}
        </div>
        {action.new_text && (
          <div style={{ fontSize: 10, color: '#1A9E6F', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            → {action.new_text.slice(0, 28)}
          </div>
        )}
        {action.new_font_size && (
          <div style={{ fontSize: 10, color: '#C47E1A', marginTop: 2, fontFamily: 'monospace' }}>
            → {action.new_font_size} pt
          </div>
        )}
        {(action.dx_mm || action.dy_mm) && (
          <div style={{ fontSize: 10, color: '#2D6BE4', marginTop: 2, fontFamily: 'monospace' }}>
            Δx {action.dx_mm?.toFixed(1)} mm · Δy {action.dy_mm?.toFixed(1)} mm
          </div>
        )}
      </div>
      <button onClick={onDelete}
        onMouseEnter={e => (e.currentTarget.style.color = '#D63C3C')}
        onMouseLeave={e => (e.currentTarget.style.color = T.textMuted)}
        style={{
          background: 'none', border: 'none', color: T.textMuted,
          cursor: 'pointer', fontSize: 14, padding: '2px 4px',
          borderRadius: 4, transition: 'color 0.15s', flexShrink: 0,
        }}>✕</button>
    </div>
  )
}

const inputSt: React.CSSProperties = {
  width: '100%', padding: '7px 10px', background: T.bgBase,
  border: `1px solid ${T.border}`, borderRadius: 6,
  color: T.textPrimary, fontSize: 12, boxSizing: 'border-box', fontFamily: 'inherit',
}

const navBtn: React.CSSProperties = {
  background: T.bgElevated, border: `1px solid ${T.border}`,
  color: T.textPrimary, borderRadius: 6, cursor: 'pointer',
  padding: '4px 9px', fontSize: 12,
}
