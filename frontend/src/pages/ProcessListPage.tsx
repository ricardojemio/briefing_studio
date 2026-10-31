// Unreachable by product decision: the start screen (StartScreen.tsx) is now
// the landing page and project browser (cards + search). This Kanban also
// surfaced process-stage UI (columns, forward/back arrows, "1/5") that the
// product no longer shows anywhere, so it's not linked from App.tsx either.
// Kept in code, not deleted.
import { useState, useEffect, useCallback } from 'react'
import { processApi } from '../services/processApi'
import type { ArtworkProcess, ProcessStatus } from '../types/process'
import { STATUS_ORDER } from '../types/process'

// ── Design tokens (matches existing dark theme) ──────────────────────────────────
const T = {
  bgBase:      '#0C0E14',
  bgSurface:   '#141720',
  bgElevated:  '#1C2030',
  border:      '#2A2F3F',
  borderHover: '#3D4560',
  accent:      '#2D6BE4',
  success:     '#1A9E6F',
  danger:      '#D63C3C',
  warning:     '#C47E1A',
  textPrimary: '#E8ECF4',
  textSecond:  '#7A8299',
  textMuted:   '#3D4560',
} as const

// ── Column definitions ────────────────────────────────────────────────────────────
interface Column {
  id: string
  label: string
  statuses: ProcessStatus[]
  color: string
  accent: string
}

const COLUMNS: Column[] = [
  { id: 'initiate',         label: 'Initiate',         statuses: ['draft'],                          color: '#3D4560', accent: '#7A8299' },
  { id: 'briefing',         label: 'Briefing',          statuses: ['briefing'],                       color: '#1A3A7A', accent: '#2D6BE4' },
  { id: 'artwork_creation', label: 'Artwork Creation',  statuses: ['artwork_creation', 'approval'],  color: '#5A3A00', accent: '#C47E1A' },
  { id: 'ready',            label: 'Ready',             statuses: ['ready'],                          color: '#0A3A25', accent: '#1A9E6F' },
]

const STATUS_LABELS: Record<ProcessStatus, string> = {
  draft:            'Initiate',
  briefing:         'Briefing',
  artwork_creation: 'Artwork Creation',
  approval:         'Approval',
  ready:            'Ready',
}

// ── Props ─────────────────────────────────────────────────────────────────────────
interface Props {
  onNew:    () => void
  onSelect: (id: string) => void
  onBack?:  () => void
}

export default function ProcessListPage({ onNew, onSelect, onBack }: Props) {
  const [processes, setProcesses] = useState<ArtworkProcess[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [moving,    setMoving]    = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setProcesses(await processApi.list())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load processes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const moveCard = async (process: ArtworkProcess, direction: 'forward' | 'back') => {
    const idx = STATUS_ORDER.indexOf(process.status)
    const nextIdx = direction === 'forward' ? idx + 1 : idx - 1
    if (nextIdx < 0 || nextIdx >= STATUS_ORDER.length) return

    setMoving(process.id)
    try {
      const updated = await processApi.updateStatus(process.id, STATUS_ORDER[nextIdx])
      setProcesses(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to move card')
    } finally {
      setMoving(null)
    }
  }

  const cardsForColumn = (col: Column) =>
    processes.filter(p => col.statuses.includes(p.status))

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: T.bgBase, fontFamily: 'system-ui, -apple-system, sans-serif',
      overflow: 'hidden',
    }}>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div style={{
        height: 56, background: T.bgSurface, borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', padding: '0 24px',
        justifyContent: 'space-between', flexShrink: 0, gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {onBack && (
            <>
              <button onClick={onBack} style={{
                background: 'none', border: `1px solid ${T.border}`,
                color: T.textSecond, cursor: 'pointer', padding: '5px 10px',
                borderRadius: 6, fontSize: 13, transition: 'color 0.12s, border-color 0.12s',
              }}
                onMouseEnter={e => { e.currentTarget.style.color = T.textPrimary; e.currentTarget.style.borderColor = '#4A5070' }}
                onMouseLeave={e => { e.currentTarget.style.color = T.textSecond;  e.currentTarget.style.borderColor = T.border }}
              >←</button>
              <div style={{ width: 1, height: 24, background: T.border }} />
            </>
          )}

          {/* Logo mark */}
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg, #1A9E6F 0%, #2D6BE4 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.8">
              <rect x="1" y="2" width="4" height="12" rx="1"/>
              <rect x="6" y="5" width="4" height="9" rx="1"/>
              <rect x="11" y="1" width="4" height="13" rx="1"/>
            </svg>
          </div>

          <div>
            <div style={{ color: T.textPrimary, fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em' }}>
              ArtReview
            </div>
            <div style={{ color: T.textMuted, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              PDF Artwork Version Comparison
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {loading && (
            <span style={{ fontSize: 11, color: T.textMuted, fontFamily: 'monospace' }}>
              Loading…
            </span>
          )}
          {!loading && (
            <span style={{ fontSize: 11, color: T.textMuted, fontFamily: 'monospace' }}>
              {processes.length} process{processes.length !== 1 ? 'es' : ''}
            </span>
          )}
          <button onClick={onNew} style={{
            padding: '7px 14px', background: T.accent, color: '#fff',
            border: 'none', borderRadius: 7, cursor: 'pointer',
            fontSize: 12, fontWeight: 700, letterSpacing: '0.02em', transition: 'opacity 0.15s',
          }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            + New Process
          </button>
        </div>
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────────── */}
      {error && (
        <div style={{
          padding: '8px 24px', background: `${T.danger}18`,
          borderBottom: `1px solid ${T.danger}40`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 12, color: '#fca5a5', flexShrink: 0,
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{
            background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 14,
          }}>✕</button>
        </div>
      )}

      {/* ── Kanban board ─────────────────────────────────────────────────────── */}
      <div style={{
        flex: 1, overflowX: 'auto', overflowY: 'hidden',
        display: 'flex', gap: 0,
        padding: '20px 20px 20px',
      }}>
        {COLUMNS.map((col, colIdx) => {
          const cards = cardsForColumn(col)
          return (
            <div key={col.id} style={{
              flex: '1 0 260px', minWidth: 220, maxWidth: 380,
              display: 'flex', flexDirection: 'column',
              borderRight: colIdx < COLUMNS.length - 1 ? `1px solid ${T.border}` : 'none',
              paddingRight: colIdx < COLUMNS.length - 1 ? 16 : 0,
              paddingLeft: colIdx > 0 ? 16 : 0,
            }}>
              {/* Column header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
                paddingBottom: 10, borderBottom: `2px solid ${col.accent}30`,
              }}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%', background: col.accent, flexShrink: 0,
                }} />
                <span style={{
                  fontSize: 11, fontWeight: 700, color: col.accent,
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                }}>
                  {col.label}
                </span>
                <span style={{
                  marginLeft: 'auto',
                  background: `${col.accent}20`, color: col.accent,
                  border: `1px solid ${col.accent}40`,
                  borderRadius: 10, padding: '1px 7px',
                  fontSize: 10, fontWeight: 700,
                }}>
                  {cards.length}
                </span>
              </div>

              {/* Cards */}
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {cards.length === 0 && (
                  <div style={{
                    padding: '24px 16px', textAlign: 'center',
                    border: `1px dashed ${T.border}`, borderRadius: 8,
                    color: T.textMuted, fontSize: 11,
                  }}>
                    No processes
                  </div>
                )}

                {cards.map(proc => {
                  const statusIdx  = STATUS_ORDER.indexOf(proc.status)
                  const canForward = statusIdx < STATUS_ORDER.length - 1
                  const canBack    = statusIdx > 0
                  const isMoving   = moving === proc.id
                  const firstComp  = proc.components?.[0]
                  const coordAssign = proc.assignments?.find(a => a.role === 'artwork_coordinator')

                  return (
                    <div
                      key={proc.id}
                      onClick={() => !isMoving && onSelect(proc.id)}
                      style={{
                        background: T.bgSurface,
                        border: `1px solid ${T.border}`,
                        borderLeft: `3px solid ${col.accent}`,
                        borderRadius: '0 8px 8px 0',
                        padding: '12px 12px 10px',
                        cursor: 'pointer',
                        opacity: isMoving ? 0.6 : 1,
                        transition: 'border-color 0.15s, box-shadow 0.15s',
                      }}
                      onMouseEnter={e => {
                        if (!isMoving) {
                          (e.currentTarget as HTMLDivElement).style.borderColor = T.borderHover
                          ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)'
                        }
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLDivElement).style.borderColor = T.border
                        ;(e.currentTarget as HTMLDivElement).style.boxShadow = 'none'
                      }}
                    >
                      {/* Card header: name + status badge */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
                        <div style={{
                          flex: 1, fontSize: 12, fontWeight: 700, color: T.textPrimary,
                          lineHeight: 1.35, wordBreak: 'break-word',
                        }}>
                          {proc.project_name}
                        </div>
                        <span style={{
                          flexShrink: 0,
                          fontSize: 8, fontWeight: 700, letterSpacing: '0.08em',
                          color: col.accent, background: `${col.accent}18`,
                          border: `1px solid ${col.accent}35`,
                          padding: '2px 5px', borderRadius: 4, textTransform: 'uppercase',
                        }}>
                          {STATUS_LABELS[proc.status]}
                        </span>
                      </div>

                      {/* Component & market meta */}
                      {firstComp && (
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
                          <span style={{
                            fontSize: 10, color: T.textSecond,
                            background: T.bgElevated, border: `1px solid ${T.border}`,
                            padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace',
                          }}>
                            {firstComp.component_code}
                          </span>
                          <span style={{
                            fontSize: 10, color: T.textSecond,
                            background: T.bgElevated, border: `1px solid ${T.border}`,
                            padding: '1px 6px', borderRadius: 4,
                          }}>
                            {firstComp.market}
                          </span>
                          {firstComp.is_new_sku && (
                            <span style={{
                              fontSize: 10, color: T.warning,
                              background: `${T.warning}15`, border: `1px solid ${T.warning}40`,
                              padding: '1px 6px', borderRadius: 4,
                            }}>
                              New SKU
                            </span>
                          )}
                        </div>
                      )}
                      {(proc.components?.length ?? 0) > 1 && (
                        <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 6 }}>
                          +{(proc.components?.length ?? 0) - 1} more component{(proc.components?.length ?? 0) > 2 ? 's' : ''}
                        </div>
                      )}

                      {/* Coordinator */}
                      {coordAssign && (
                        <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 8 }}>
                          📧 {coordAssign.assignee_email}
                        </div>
                      )}

                      {/* Navigation arrows */}
                      <div
                        style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}
                        onClick={e => e.stopPropagation()}
                      >
                        <button
                          onClick={() => moveCard(proc, 'back')}
                          disabled={!canBack || isMoving}
                          title="Move back"
                          style={{
                            background: 'none', border: `1px solid ${T.border}`,
                            color: canBack ? T.textSecond : T.textMuted,
                            borderRadius: 5, cursor: canBack ? 'pointer' : 'not-allowed',
                            padding: '3px 8px', fontSize: 11,
                            opacity: canBack ? 1 : 0.3, transition: 'all 0.12s',
                          }}
                          onMouseEnter={e => { if (canBack) e.currentTarget.style.color = T.textPrimary }}
                          onMouseLeave={e => { if (canBack) e.currentTarget.style.color = T.textSecond }}
                        >
                          ◀
                        </button>

                        <span style={{ fontSize: 10, color: T.textMuted, alignSelf: 'center', fontFamily: 'monospace' }}>
                          {statusIdx + 1}/{STATUS_ORDER.length}
                        </span>

                        <button
                          onClick={() => moveCard(proc, 'forward')}
                          disabled={!canForward || isMoving}
                          title="Move forward"
                          style={{
                            background: 'none', border: `1px solid ${T.border}`,
                            color: canForward ? col.accent : T.textMuted,
                            borderRadius: 5, cursor: canForward ? 'pointer' : 'not-allowed',
                            padding: '3px 8px', fontSize: 11,
                            opacity: canForward ? 1 : 0.3, transition: 'all 0.12s',
                          }}
                          onMouseEnter={e => { if (canForward) e.currentTarget.style.background = `${col.accent}15` }}
                          onMouseLeave={e => { if (canForward) e.currentTarget.style.background = 'none' }}
                        >
                          ▶
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
