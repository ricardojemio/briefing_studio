import { useState, useRef } from 'react'
import { processApi } from '../services/processApi'
import { MARKETS, MANUFACTURING_SITES } from '../types/process'

// ── Design tokens ────────────────────────────────────────────────────────────────
const T = {
  bgBase:     '#0C0E14',
  bgSurface:  '#141720',
  bgElevated: '#1C2030',
  border:     '#2A2F3F',
  accent:     '#2D6BE4',
  success:    '#1A9E6F',
  danger:     '#D63C3C',
  textPrimary:'#E8ECF4',
  textSecond: '#7A8299',
  textMuted:  '#3D4560',
} as const

const inputSt: React.CSSProperties = {
  width: '100%', padding: '9px 12px',
  background: T.bgBase, border: `1px solid ${T.border}`,
  borderRadius: 7, color: T.textPrimary, fontSize: 13,
  boxSizing: 'border-box', fontFamily: 'inherit',
  outline: 'none', transition: 'border-color 0.15s',
}

const labelSt: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700,
  color: T.textSecond, textTransform: 'uppercase',
  letterSpacing: '0.06em', marginBottom: 5,
}

interface Props {
  onBack:    () => void
  onCreated: () => void
}

export default function NewProcessPage({ onBack, onCreated }: Props) {
  // ── Project fields ───────────────────────────────────────────────────────────
  const [projectName, setProjectName]   = useState('')
  const [description, setDescription]  = useState('')

  // ── Component fields ─────────────────────────────────────────────────────────
  const [componentCode,      setComponentCode]      = useState('')
  const [sku,                setSku]                = useState('')
  const [isNewSku,           setIsNewSku]           = useState(false)
  const [market,             setMarket]             = useState(MARKETS[0])
  const [manufacturingSite,  setManufacturingSite]  = useState('')
  const [pdfFile,            setPdfFile]            = useState<File | null>(null)

  // ── Assignment fields ────────────────────────────────────────────────────────
  const [coordinatorEmail, setCoordinatorEmail] = useState('')

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const canSubmit = projectName.trim() !== '' && componentCode.trim() !== '' && market !== ''

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSaving(true)
    setError(null)

    try {
      // 1. Create process
      const proc = await processApi.create({
        project_name:        projectName.trim(),
        project_description: description.trim() || undefined,
      })

      // 2. Add component (always at least one)
      const fd = new FormData()
      fd.append('component_code', componentCode.trim())
      if (sku.trim())            fd.append('sku', sku.trim())
      fd.append('is_new_sku',    String(isNewSku))
      fd.append('market',        market)
      if (manufacturingSite)     fd.append('manufacturing_site', manufacturingSite)
      if (pdfFile)               fd.append('file', pdfFile)
      await processApi.addComponent(proc.id, fd)

      // 3. Assign artwork coordinator (optional)
      if (coordinatorEmail.trim()) {
        await processApi.addAssignment(proc.id, {
          role:            'artwork_coordinator',
          assignee_email:  coordinatorEmail.trim(),
        })
      }

      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create process')
    } finally {
      setSaving(false)
    }
  }

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
        <div style={{ color: T.textPrimary, fontSize: 14, fontWeight: 700 }}>New Process</div>
        <div style={{ color: T.textMuted, fontSize: 12 }}>—</div>
        <div style={{ color: T.textSecond, fontSize: 12 }}>ArtReview</div>
      </div>

      {/* ── Scrollable form body ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 0' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 24px' }}>

          {error && (
            <div style={{
              padding: '10px 14px', marginBottom: 20,
              background: `${T.danger}18`, border: `1px solid ${T.danger}40`,
              borderRadius: 8, color: '#fca5a5', fontSize: 12,
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>{error}</span>
              <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
            </div>
          )}

          {/* ── Section: Project ── */}
          <Section label="Project">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
              <Field label="Project Name *">
                <input
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  placeholder="e.g. CLIENT_PRODUCT Forte Carton — Colombia"
                  style={inputSt}
                />
              </Field>
              <Field label="Description">
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Brief summary of the change request…"
                  rows={3}
                  style={{ ...inputSt, resize: 'vertical' }}
                />
              </Field>
            </div>
          </Section>

          {/* ── Section: Component ── */}
          <Section label="Component">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Component Code *">
                <input
                  value={componentCode}
                  onChange={e => setComponentCode(e.target.value)}
                  placeholder="e.g. SKU_CODE"
                  style={inputSt}
                />
              </Field>
              <Field label="SKU">
                <input
                  value={sku}
                  onChange={e => setSku(e.target.value)}
                  placeholder="e.g. 01234567"
                  style={inputSt}
                />
              </Field>
              <Field label="Market *">
                <select value={market} onChange={e => setMarket(e.target.value)} style={inputSt}>
                  {MARKETS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Manufacturing Site">
                <select value={manufacturingSite} onChange={e => setManufacturingSite(e.target.value)} style={inputSt}>
                  <option value="">— Select site —</option>
                  {MANUFACTURING_SITES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>

            {/* New SKU checkbox */}
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8, marginTop: 12,
              cursor: 'pointer', fontSize: 12, color: T.textSecond,
            }}>
              <input
                type="checkbox"
                checked={isNewSku}
                onChange={e => setIsNewSku(e.target.checked)}
                style={{ accentColor: T.accent, width: 14, height: 14 }}
              />
              This is a New SKU
            </label>

            {/* PDF upload */}
            <div style={{ marginTop: 14 }}>
              <label style={labelSt}>Artwork PDF</label>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf"
                style={{ display: 'none' }}
                onChange={e => setPdfFile(e.target.files?.[0] ?? null)}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={() => fileRef.current?.click()}
                  style={{
                    padding: '8px 14px', background: T.bgElevated,
                    border: `1px solid ${T.border}`, borderRadius: 7,
                    color: T.textSecond, cursor: 'pointer', fontSize: 12,
                  }}
                >
                  {pdfFile ? '↺ Change file' : '↑ Choose PDF'}
                </button>
                {pdfFile && (
                  <span style={{ fontSize: 12, color: T.success }}>
                    ✓ {pdfFile.name}
                  </span>
                )}
                {!pdfFile && (
                  <span style={{ fontSize: 11, color: T.textMuted }}>
                    Optional — can be added later
                  </span>
                )}
              </div>
            </div>
          </Section>

          {/* ── Section: Team ── */}
          <Section label="Team Assignment">
            <Field label="Artwork Coordinator Email">
              <input
                type="email"
                value={coordinatorEmail}
                onChange={e => setCoordinatorEmail(e.target.value)}
                placeholder="coordinator@example.com"
                style={inputSt}
              />
            </Field>
            <p style={{ fontSize: 11, color: T.textMuted, marginTop: 8 }}>
              Additional roles (Marketing, Regulatory, Studio) can be assigned from the process detail page.
            </p>
          </Section>

          {/* ── Submit ── */}
          <div style={{ display: 'flex', gap: 10, marginTop: 8, paddingBottom: 40 }}>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || saving}
              style={{
                flex: 1, padding: '12px 0',
                background: canSubmit && !saving ? T.accent : T.bgElevated,
                color:      canSubmit && !saving ? '#fff'  : T.textMuted,
                border: 'none', borderRadius: 8,
                cursor: canSubmit && !saving ? 'pointer' : 'not-allowed',
                fontSize: 13, fontWeight: 700, letterSpacing: '0.03em',
                transition: 'background 0.15s',
              }}
            >
              {saving ? 'Creating…' : 'Create Process'}
            </button>
            <button
              onClick={onBack}
              style={{
                padding: '12px 20px', background: 'transparent',
                color: T.textSecond, border: `1px solid ${T.border}`,
                borderRadius: 8, cursor: 'pointer', fontSize: 13,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Small layout helpers ──────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      marginBottom: 28, padding: '20px 20px 20px',
      background: '#141720', border: `1px solid #2A2F3F`,
      borderRadius: 12,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#3D4560',
        textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16,
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelSt}>{label}</label>
      {children}
    </div>
  )
}
