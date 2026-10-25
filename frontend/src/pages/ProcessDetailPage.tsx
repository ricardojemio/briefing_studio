import { useState, useEffect } from 'react'
import { processApi } from '../services/processApi'
import type { ArtworkProcess, AssignmentRole } from '../types/process'
import { ROLE_LABELS, STATUS_ORDER } from '../types/process'
import ComparisonViewer from '../components/ComparisonViewer'

// ── Design tokens ────────────────────────────────────────────────────────────────
const T = {
  bgBase:     '#0C0E14',
  bgSurface:  '#141720',
  bgElevated: '#1C2030',
  border:     '#2A2F3F',
  accent:     '#2D6BE4',
  success:    '#1A9E6F',
  danger:     '#D63C3C',
  warning:    '#C47E1A',
  purple:     '#7C3AED',
  textPrimary:'#E8ECF4',
  textSecond: '#7A8299',
  textMuted:  '#3D4560',
} as const

const STATUS_COLOR: Record<string, string> = {
  draft:            '#7A8299',
  briefing:         '#2D6BE4',
  artwork_creation: '#C47E1A',
  approval:         '#E47E2D',
  ready:            '#1A9E6F',
}

const STATUS_LABEL: Record<string, string> = {
  draft:            'Initiate',
  briefing:         'Briefing',
  artwork_creation: 'Artwork Creation',
  approval:         'Approval',
  ready:            'Ready',
}

type Tab = 'overview' | 'briefing' | 'comparison' | 'timeline'

// 'briefing' (annotation-driven draft generation, built on raster_engine_v3 /
// pdf_draft_engine) is out of scope for the comparison-focused product and
// hidden from navigation below. The tab and its placeholder content are kept
// in code, unreachable, so this is reversible without re-threading state.
const VISIBLE_TABS: Tab[] = ['overview', 'comparison', 'timeline']

interface Props {
  processId: string
  onBack:    () => void
}

export default function ProcessDetailPage({ processId, onBack }: Props) {
  const [proc,    setProc]    = useState<ArtworkProcess | null>(null)
  const [tab,     setTab]     = useState<Tab>('comparison')
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [moving,  setMoving]  = useState(false)

  // ── Assignment form state ────────────────────────────────────────────────────
  const [showAssignForm,  setShowAssignForm]  = useState(false)
  const [assignRole,      setAssignRole]      = useState<AssignmentRole>('marketing')
  const [assignEmail,     setAssignEmail]     = useState('')
  const [savingAssign,    setSavingAssign]    = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const data = await processApi.get(processId)
        if (!cancelled) setProc(data)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load process')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [processId])

  const moveStatus = async (direction: 'forward' | 'back') => {
    if (!proc) return
    const idx     = STATUS_ORDER.indexOf(proc.status)
    const nextIdx = direction === 'forward' ? idx + 1 : idx - 1
    if (nextIdx < 0 || nextIdx >= STATUS_ORDER.length) return
    setMoving(true)
    try {
      const updated = await processApi.updateStatus(proc.id, STATUS_ORDER[nextIdx])
      setProc(prev => prev ? { ...prev, ...updated } : prev)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status')
    } finally {
      setMoving(false)
    }
  }

  const handleAddAssignment = async () => {
    if (!proc || !assignEmail.trim()) return
    setSavingAssign(true)
    try {
      const a = await processApi.addAssignment(proc.id, {
        role:           assignRole,
        assignee_email: assignEmail.trim(),
      })
      setProc(prev => prev ? { ...prev, assignments: [...(prev.assignments ?? []), a] } : prev)
      setShowAssignForm(false)
      setAssignEmail('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add assignment')
    } finally {
      setSavingAssign(false)
    }
  }

  if (loading) {
    return (
      <PageShell onBack={onBack} title="Loading…">
        <div style={{ padding: 40, color: T.textMuted, fontFamily: 'monospace', fontSize: 13 }}>
          Loading process…
        </div>
      </PageShell>
    )
  }

  if (!proc) {
    return (
      <PageShell onBack={onBack} title="Not found">
        <div style={{ padding: 40, color: T.danger, fontSize: 13 }}>
          {error ?? 'Process not found.'}
        </div>
      </PageShell>
    )
  }

  const statusColor = STATUS_COLOR[proc.status] ?? T.textSecond
  const statusIdx   = STATUS_ORDER.indexOf(proc.status)
  const canForward  = statusIdx < STATUS_ORDER.length - 1
  const canBack     = statusIdx > 0

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: T.bgBase, fontFamily: 'system-ui, -apple-system, sans-serif',
      overflow: 'hidden',
    }}>

      {/* ── Top bar ── */}
      <div style={{
        height: 56, background: T.bgSurface, borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', padding: '0 24px', gap: 12, flexShrink: 0,
      }}>
        <button onClick={onBack} style={{
          background: 'none', border: `1px solid ${T.border}`,
          color: T.textSecond, cursor: 'pointer', padding: '5px 10px',
          borderRadius: 6, fontSize: 13,
        }}>←</button>
        <div style={{ width: 1, height: 24, background: T.border }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            color: T.textPrimary, fontSize: 13, fontWeight: 700,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {proc.project_name}
          </div>
          <div style={{ color: T.textMuted, fontSize: 10, fontFamily: 'monospace', marginTop: 1 }}>
            ArtReview Process
          </div>
        </div>

        {/* Status badge + move buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => moveStatus('back')}
            disabled={!canBack || moving}
            style={{
              background: 'none', border: `1px solid ${T.border}`,
              color: canBack ? T.textSecond : T.textMuted, borderRadius: 5,
              cursor: canBack ? 'pointer' : 'not-allowed',
              padding: '4px 9px', fontSize: 11, opacity: canBack ? 1 : 0.3,
            }}
          >◀</button>

          <span style={{
            padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
            color: statusColor, background: `${statusColor}18`,
            border: `1px solid ${statusColor}40`,
          }}>
            {STATUS_LABEL[proc.status] ?? proc.status}
          </span>

          <button
            onClick={() => moveStatus('forward')}
            disabled={!canForward || moving}
            style={{
              background: 'none', border: `1px solid ${T.border}`,
              color: canForward ? T.accent : T.textMuted, borderRadius: 5,
              cursor: canForward ? 'pointer' : 'not-allowed',
              padding: '4px 9px', fontSize: 11, opacity: canForward ? 1 : 0.3,
            }}
          >▶</button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div style={{
          padding: '8px 24px', background: `${T.danger}18`,
          borderBottom: `1px solid ${T.danger}40`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 12, color: '#fca5a5', flexShrink: 0,
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
      )}

      {/* ── Tab bar ── */}
      <div style={{
        display: 'flex', borderBottom: `1px solid ${T.border}`,
        background: T.bgSurface, flexShrink: 0,
        padding: '0 24px',
      }}>
        {VISIBLE_TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '12px 16px', border: 'none', background: 'transparent',
              color: tab === t ? T.textPrimary : T.textSecond,
              fontSize: 12, fontWeight: tab === t ? 700 : 400, cursor: 'pointer',
              borderBottom: `3px solid ${tab === t ? T.accent : 'transparent'}`,
              textTransform: 'capitalize', letterSpacing: '0.02em',
              transition: 'color 0.12s, border-color 0.12s',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div style={{
        flex: 1,
        overflowY: tab === 'comparison' ? 'hidden' : 'auto',
        padding:   tab === 'comparison' ? 0 : 24,
        display:   tab === 'comparison' ? 'flex' : 'block',
        flexDirection: 'column',
      }}>
        {tab === 'overview' && (
          <OverviewTab
            proc={proc}
            showAssignForm={showAssignForm}
            setShowAssignForm={setShowAssignForm}
            assignRole={assignRole}
            setAssignRole={setAssignRole}
            assignEmail={assignEmail}
            setAssignEmail={setAssignEmail}
            savingAssign={savingAssign}
            onAddAssignment={handleAddAssignment}
          />
        )}

        {tab === 'comparison' && (
          <ComparisonViewer
            processId={proc.id}
            originalPdfPath={proc.components?.[0]?.pdf_path ?? null}
          />
        )}

        {(tab === 'briefing' || tab === 'timeline') && (
          <PlaceholderTab name={tab} />
        )}
      </div>
    </div>
  )
}

// ── Overview tab ─────────────────────────────────────────────────────────────────

function OverviewTab({
  proc, showAssignForm, setShowAssignForm,
  assignRole, setAssignRole, assignEmail, setAssignEmail,
  savingAssign, onAddAssignment,
}: {
  proc: ArtworkProcess
  showAssignForm: boolean
  setShowAssignForm: (v: boolean) => void
  assignRole: AssignmentRole
  setAssignRole: (r: AssignmentRole) => void
  assignEmail: string
  setAssignEmail: (e: string) => void
  savingAssign: boolean
  onAddAssignment: () => void
}) {
  return (
    <div style={{ maxWidth: 800, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Project info ── */}
      <Card title="Project">
        <InfoRow label="Name"        value={proc.project_name} />
        <InfoRow label="Description" value={proc.project_description ?? '—'} />
        <InfoRow label="Created by"  value={proc.created_by} />
        <InfoRow label="Created"     value={new Date(proc.created_at).toLocaleString()} />
        <InfoRow label="Updated"     value={new Date(proc.updated_at).toLocaleString()} />
      </Card>

      {/* ── Components ── */}
      <Card title={`Components (${proc.components?.length ?? 0})`}>
        {(proc.components ?? []).length === 0 ? (
          <p style={{ fontSize: 12, color: '#3D4560', margin: 0 }}>No components added.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(proc.components ?? []).map(c => (
              <div key={c.id} style={{
                padding: '10px 14px', background: '#0C0E14',
                border: '1px solid #2A2F3F', borderRadius: 8,
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px',
              }}>
                <InfoRow label="Code"   value={c.component_code} mono />
                <InfoRow label="Market" value={c.market} />
                {c.sku && <InfoRow label="SKU" value={c.sku} mono />}
                {c.manufacturing_site && <InfoRow label="Site" value={c.manufacturing_site} />}
                {c.is_new_sku && (
                  <div style={{
                    gridColumn: '1/-1', marginTop: 2,
                    fontSize: 10, color: '#C47E1A',
                    background: '#C47E1A15', border: '1px solid #C47E1A40',
                    padding: '2px 6px', borderRadius: 4, display: 'inline-block',
                  }}>
                    New SKU
                  </div>
                )}
                {c.pdf_path && (
                  <div style={{ gridColumn: '1/-1', fontSize: 11, color: '#1A9E6F', marginTop: 2 }}>
                    ✓ PDF attached
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Assignments ── */}
      <Card title={`Team Assignments (${proc.assignments?.length ?? 0})`}>
        {(proc.assignments ?? []).length === 0 ? (
          <p style={{ fontSize: 12, color: '#3D4560', margin: 0, marginBottom: 12 }}>No team members assigned yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            {(proc.assignments ?? []).map(a => (
              <div key={a.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', background: '#0C0E14',
                border: '1px solid #2A2F3F', borderRadius: 7,
              }}>
                <div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: '#2D6BE4',
                    background: '#2D6BE418', border: '1px solid #2D6BE440',
                    padding: '2px 6px', borderRadius: 4, marginRight: 8,
                  }}>
                    {ROLE_LABELS[a.role] ?? a.role}
                  </span>
                  <span style={{ fontSize: 12, color: '#E8ECF4' }}>{a.assignee_email}</span>
                </div>
                <span style={{ fontSize: 10, color: '#3D4560', fontFamily: 'monospace' }}>
                  {new Date(a.assigned_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Add assignment */}
        {showAssignForm ? (
          <div style={{
            padding: 14, background: '#1C2030',
            border: '1px solid #2A2F3F', borderRadius: 8,
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#7A8299', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Role</label>
                <select
                  value={assignRole}
                  onChange={e => setAssignRole(e.target.value as AssignmentRole)}
                  style={{ width: '100%', padding: '8px 10px', background: '#0C0E14', border: '1px solid #2A2F3F', borderRadius: 6, color: '#E8ECF4', fontSize: 12, boxSizing: 'border-box' as const }}
                >
                  {(Object.entries(ROLE_LABELS) as [AssignmentRole, string][]).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#7A8299', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Email</label>
                <input
                  type="email"
                  value={assignEmail}
                  onChange={e => setAssignEmail(e.target.value)}
                  placeholder="person@example.com"
                  style={{ width: '100%', padding: '8px 10px', background: '#0C0E14', border: '1px solid #2A2F3F', borderRadius: 6, color: '#E8ECF4', fontSize: 12, boxSizing: 'border-box' as const, fontFamily: 'inherit' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={onAddAssignment}
                disabled={!assignEmail.trim() || savingAssign}
                style={{
                  padding: '8px 14px', background: '#2D6BE4', color: '#fff',
                  border: 'none', borderRadius: 6, cursor: 'pointer',
                  fontSize: 12, fontWeight: 700,
                }}
              >
                {savingAssign ? 'Saving…' : 'Assign'}
              </button>
              <button
                onClick={() => { setShowAssignForm(false); setAssignEmail('') }}
                style={{
                  padding: '8px 12px', background: 'transparent',
                  color: '#7A8299', border: '1px solid #2A2F3F',
                  borderRadius: 6, cursor: 'pointer', fontSize: 12,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAssignForm(true)}
            style={{
              padding: '8px 14px', background: 'transparent',
              color: '#7A8299', border: '1px solid #2A2F3F',
              borderRadius: 7, cursor: 'pointer', fontSize: 12,
              transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#E8ECF4'; e.currentTarget.style.borderColor = '#4A5070' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#7A8299'; e.currentTarget.style.borderColor = '#2A2F3F' }}
          >
            + Add team member
          </button>
        )}
      </Card>
    </div>
  )
}

// ── Placeholder tab ───────────────────────────────────────────────────────────────

function PlaceholderTab({ name }: { name: string }) {
  const meta: Record<string, { icon: string; description: string; color: string }> = {
    briefing: {
      icon:        '📋',
      description: 'Manage change annotations: mark text for deletion, specify replacements, add move and resize instructions, and attach rationale comments.',
      color:       '#2D6BE4',
    },
    comparison: {
      icon:        '⚖️',
      description: 'Upload revised artwork and run a visual diff against the original. See exactly which pixels changed and get a machine-readable change report.',
      color:       '#C47E1A',
    },
    timeline: {
      icon:        '📅',
      description: 'Full audit trail: status transitions, assignments, annotations, and comparisons — all timestamped and attributed.',
      color:       '#7C3AED',
    },
  }

  const m = meta[name] ?? { icon: '🚧', description: 'Coming soon.', color: '#7A8299' }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '80px 40px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{m.icon}</div>
      <div style={{
        fontSize: 10, fontWeight: 700, color: m.color,
        textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10,
      }}>
        Phase 2 — Coming Soon
      </div>
      <div style={{
        fontSize: 14, fontWeight: 700, color: '#E8ECF4',
        textTransform: 'capitalize', marginBottom: 12,
      }}>
        {name}
      </div>
      <div style={{
        fontSize: 13, color: '#7A8299', lineHeight: 1.65,
        maxWidth: 420,
      }}>
        {m.description}
      </div>
      <div style={{
        marginTop: 28, padding: '12px 20px',
        background: `${m.color}10`, border: `1px solid ${m.color}30`,
        borderRadius: 8, fontSize: 11, color: m.color,
      }}>
        This section will be built on top of the existing Briefing Studio engine.
      </div>
    </div>
  )
}

// ── Layout helpers ────────────────────────────────────────────────────────────────

function PageShell({ onBack, title, children }: { onBack: () => void; title: string; children: React.ReactNode }) {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0C0E14', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ height: 56, background: '#141720', borderBottom: '1px solid #2A2F3F', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 12 }}>
        <button onClick={onBack} style={{ background: 'none', border: '1px solid #2A2F3F', color: '#7A8299', cursor: 'pointer', padding: '5px 10px', borderRadius: 6, fontSize: 13 }}>←</button>
        <span style={{ color: '#E8ECF4', fontSize: 14, fontWeight: 700 }}>{title}</span>
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#141720', border: '1px solid #2A2F3F', borderRadius: 12, padding: '16px 20px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#3D4560', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 11, color: '#7A8299', minWidth: 90, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: '#E8ECF4', fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}
