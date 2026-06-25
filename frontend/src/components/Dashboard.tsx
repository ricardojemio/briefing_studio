// src/components/Dashboard.tsx
import { useState, useEffect, useRef } from 'react'
import { api } from '../services/api'
import { useStore } from '../store'
import type { Project, Artwork } from '../types'

interface DashboardProps {
  onOpenStudio:          (artwork: Artwork) => void
  onNavigateProcesses?:  () => void
}

// ── Design tokens ─────────────────────────────────────────────────
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

const COMPONENT_LABELS: Record<string, string> = {
  carton: 'Carton', blister: 'Blister', label: 'Label', leaflet: 'Leaflet',
}

export default function Dashboard({ onOpenStudio, onNavigateProcesses }: DashboardProps) {
  const [projects,  setProjects]  = useState<Project[]>([])
  const [loading,   setLoading]   = useState(true)
  const [showForm,  setShowForm]  = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [error,     setError]     = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', sku: '', market: '', brand: '', component: 'carton' })
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const { setProject } = useStore()

  useEffect(() => {
    api.listProjects()
      .then(setProjects)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const handleCreate = async () => {
    if (!form.name || !form.sku || !form.market) return
    try {
      const p = await api.createProject({ ...form, created_by: 'user' })
      setProjects(prev => [p, ...prev])
      setShowForm(false)
      setForm({ name: '', sku: '', market: '', brand: '', component: 'carton' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error creating project')
    }
  }

  const handleUpload = async (projectId: string, file: File) => {
    setUploading(projectId)
    setError(null)
    try {
      const artwork = await api.uploadArtwork(projectId, file)
      const project = projects.find(p => p.id === projectId)
      if (project) setProject(project)
      onOpenStudio(artwork)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error uploading artwork')
    } finally {
      setUploading(null)
    }
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: T.bgBase, fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>

      {/* ── Top bar ── */}
      <div style={{
        height: 56, background: T.bgSurface, borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', padding: '0 24px',
        justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Logo mark */}
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: T.accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.8">
              <rect x="2" y="2" width="12" height="14" rx="1.5"/>
              <line x1="5" y1="6" x2="11" y2="6"/>
              <line x1="5" y1="9" x2="11" y2="9"/>
              <line x1="5" y1="12" x2="8" y2="12"/>
            </svg>
          </div>
          <div>
            <div style={{ color: T.textPrimary, fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em' }}>
              Briefing Studio
            </div>
            <div style={{ color: T.textMuted, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Artwork Lifecycle Platform
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onNavigateProcesses && (
            <button onClick={onNavigateProcesses} style={{
              padding: '7px 14px', background: 'transparent', color: T.textSecond,
              border: `1px solid ${T.border}`, borderRadius: 7, cursor: 'pointer',
              fontSize: 12, fontWeight: 600, letterSpacing: '0.02em', transition: 'color 0.15s, border-color 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.color = T.textPrimary; e.currentTarget.style.borderColor = '#4A5070' }}
              onMouseLeave={e => { e.currentTarget.style.color = T.textSecond;  e.currentTarget.style.borderColor = T.border }}
            >
              ArtReview
            </button>
          )}
          <button onClick={() => setShowForm(s => !s)} style={{
            padding: '7px 14px', background: T.accent, color: '#fff',
            border: 'none', borderRadius: 7, cursor: 'pointer',
            fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
            transition: 'opacity 0.15s',
          }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            + New project
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 24px' }}>

        {/* Error */}
        {error && (
          <div style={{
            padding: '10px 14px', background: `${T.danger}18`,
            border: `1px solid ${T.danger}40`, borderRadius: 8,
            color: '#fca5a5', fontSize: 12, marginBottom: 20,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} style={{
              background: 'none', border: 'none', color: '#fca5a5',
              cursor: 'pointer', fontSize: 14, padding: 0,
            }}>✕</button>
          </div>
        )}

        {/* New project form */}
        {showForm && (
          <div style={{
            background: T.bgSurface, border: `1px solid ${T.border}`,
            borderRadius: 12, padding: 20, marginBottom: 24,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: T.textMuted,
              textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16,
            }}>
              New project
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { key: 'name',   label: 'Project name *', ph: 'CLIENT_PRODUCT XTRA Forte Carton' },
                { key: 'sku',    label: 'SKU *',           ph: 'SKU_CODE' },
                { key: 'market', label: 'Market *',        ph: 'MARKET_CODE' },
                { key: 'brand',  label: 'Brand',           ph: 'CLIENT_PRODUCT / CLIENT_BRAND' },
              ].map(f => (
                <div key={f.key}>
                  <FieldLabel>{f.label}</FieldLabel>
                  <input
                    value={(form as any)[f.key]}
                    placeholder={f.ph}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    style={inputSt}
                  />
                </div>
              ))}
              <div>
                <FieldLabel>Component</FieldLabel>
                <select
                  value={form.component}
                  onChange={e => setForm(p => ({ ...p, component: e.target.value }))}
                  style={inputSt}
                >
                  <option value="carton">Carton</option>
                  <option value="blister">Blister</option>
                  <option value="label">Label</option>
                  <option value="leaflet">Leaflet (PIL)</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                onClick={handleCreate}
                disabled={!form.name || !form.sku || !form.market}
                style={{
                  padding: '8px 16px',
                  background: form.name && form.sku && form.market ? T.accent : T.bgElevated,
                  color: form.name && form.sku && form.market ? '#fff' : T.textMuted,
                  border: 'none', borderRadius: 7, cursor: 'pointer',
                  fontWeight: 700, fontSize: 12, letterSpacing: '0.02em',
                }}>
                Create project
              </button>
              <button onClick={() => setShowForm(false)} style={{
                padding: '8px 14px', background: 'transparent', color: T.textSecond,
                border: `1px solid ${T.border}`, borderRadius: 7, cursor: 'pointer', fontSize: 12,
              }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Section header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{
            color: T.textPrimary, margin: 0, fontSize: 16, fontWeight: 700,
            letterSpacing: '-0.01em',
          }}>
            Projects
          </h2>
          {projects.length > 0 && (
            <span style={{ fontSize: 11, color: T.textMuted, fontFamily: 'monospace' }}>
              {projects.length} project{projects.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {loading && (
          <p style={{ color: T.textMuted, fontSize: 12, fontFamily: 'monospace' }}>
            Loading projects…
          </p>
        )}

        {/* Project grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {projects.map(project => (
            <ProjectCard
              key={project.id}
              project={project}
              uploading={uploading === project.id}
              onUpload={(file) => handleUpload(project.id, file)}
              fileRef={(el) => { fileRefs.current[project.id] = el }}
              onFileClick={() => fileRefs.current[project.id]?.click()}
            />
          ))}

          {!loading && projects.length === 0 && (
            <div style={{
              gridColumn: '1 / -1', textAlign: 'center',
              padding: '60px 20px', color: T.textMuted,
            }}>
              <div style={{ marginBottom: 16 }}>
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke={T.textMuted} strokeWidth="1.5">
                  <rect x="4" y="4" width="32" height="36" rx="3"/>
                  <line x1="12" y1="14" x2="28" y2="14"/>
                  <line x1="12" y1="20" x2="28" y2="20"/>
                  <line x1="12" y1="26" x2="20" y2="26"/>
                </svg>
              </div>
              <p style={{ fontSize: 13, marginBottom: 8 }}>No projects yet</p>
              <p style={{ fontSize: 11 }}>Create your first project to get started</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── ProjectCard ───────────────────────────────────────────────────

function ProjectCard({ project, uploading, onUpload, fileRef, onFileClick }: {
  project:      Project
  uploading:    boolean
  onUpload:     (file: File) => void
  fileRef:      (el: HTMLInputElement | null) => void
  onFileClick:  () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: T.bgSurface,
        border: `1px solid ${hovered ? T.borderHover : T.border}`,
        borderRadius: 10, padding: 16,
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: hovered ? '0 4px 20px rgba(0,0,0,0.3)' : 'none',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            color: T.textPrimary, fontSize: 13, fontWeight: 700,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginBottom: 3,
          }}>
            {project.name}
          </div>
          <div style={{ color: T.textSecond, fontSize: 11, fontFamily: 'monospace' }}>
            {project.sku}
          </div>
        </div>
        <ComponentBadge component={project.component} />
      </div>

      {/* Meta */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <MetaChip>{project.market}</MetaChip>
        {project.brand && <MetaChip>{project.brand}</MetaChip>}
      </div>

      {/* Upload button */}
      <input
        ref={fileRef}
        type="file" accept=".pdf" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f) }}
      />
      <button
        onClick={onFileClick}
        disabled={uploading}
        style={{
          width: '100%', padding: '9px 0',
          background: uploading ? T.bgElevated : T.accent,
          color: uploading ? T.textMuted : '#fff',
          border: 'none', borderRadius: 7,
          cursor: uploading ? 'wait' : 'pointer',
          fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={e => { if (!uploading) e.currentTarget.style.opacity = '0.85' }}
        onMouseLeave={e => { if (!uploading) e.currentTarget.style.opacity = '1' }}
      >
        {uploading ? 'Uploading…' : 'Upload PDF artwork'}
      </button>
    </div>
  )
}

function ComponentBadge({ component }: { component?: string }) {
  const colorMap: Record<string, string> = {
    carton: '#2D6BE4', blister: '#1A9E6F', label: '#C47E1A', leaflet: '#7C3AED',
  }
  const c = component ? (colorMap[component] || T.textSecond) : T.textSecond
  const label = component ? (COMPONENT_LABELS[component] || component) : '—'
  return (
    <span style={{
      flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
      color: c, background: `${c}18`, border: `1px solid ${c}35`,
      padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase',
    }}>
      {label}
    </span>
  )
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 10, color: T.textSecond,
      background: T.bgElevated, border: `1px solid ${T.border}`,
      padding: '2px 7px', borderRadius: 4,
    }}>
      {children}
    </span>
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

const inputSt: React.CSSProperties = {
  width: '100%', padding: '8px 10px', background: T.bgBase,
  border: `1px solid ${T.border}`, borderRadius: 6,
  color: T.textPrimary, fontSize: 12, boxSizing: 'border-box',
  fontFamily: 'inherit',
}
