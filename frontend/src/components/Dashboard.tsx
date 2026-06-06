// src/components/Dashboard.tsx
import { useState, useEffect, useRef } from 'react'
import { api } from '../services/api'
import { useStore } from '../store'
import type { Project, Artwork } from '../types'

interface DashboardProps {
  onOpenStudio: (artwork: Artwork) => void
}

const COMPONENT_ICON: Record<string, string> = {
  carton: '📦', blister: '💊', label: '🏷️', leaflet: '📄',
}

export default function Dashboard({ onOpenStudio }: DashboardProps) {
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
      setError(e instanceof Error ? e.message : 'Erro ao criar projeto')
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
      setError(e instanceof Error ? e.message : 'Erro ao fazer upload')
    } finally {
      setUploading(null)
    }
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0d0d1a' }}>

      {/* Top bar */}
      <div style={{ height: 56, background: '#12121f', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', padding: '0 24px', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>✏️</span>
          <div>
            <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>Briefing Studio</div>
            <div style={{ color: '#555', fontSize: 10 }}>Artwork Lifecycle Platform</div>
          </div>
        </div>
        <button onClick={() => setShowForm(true)}
          style={{ padding: '8px 16px', background: '#185FA5', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
          + Novo projeto
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <h2 style={{ color: '#ddd', margin: '0 0 20px', fontSize: 18 }}>Projetos de arte</h2>

        {error && (
          <div style={{ padding: '10px 14px', background: '#1a0808', border: '1px solid #5a1010', borderRadius: 8, color: '#f88', fontSize: 13, marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
            ⚠️ {error}
            <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#f88', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* New project form */}
        {showForm && (
          <div style={{ background: '#12121f', border: '1px solid #333', borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <h3 style={{ color: '#ddd', margin: '0 0 16px', fontSize: 14 }}>Novo projeto</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { key: 'name',   label: 'Nome *',    ph: 'CLIENT_PRODUCT XTRA Forte Carton' },
                { key: 'sku',    label: 'SKU *',     ph: 'SKU_CODE' },
                { key: 'market', label: 'Mercado *', ph: 'MARKET_CODE' },
                { key: 'brand',  label: 'Marca',     ph: 'CLIENT_PRODUCT / CLIENT_BRAND' },
              ].map(f => (
                <div key={f.key}>
                  <label style={labelSt}>{f.label}</label>
                  <input value={(form as any)[f.key]} placeholder={f.ph}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    style={inputSt} />
                </div>
              ))}
              <div>
                <label style={labelSt}>Componente</label>
                <select value={form.component} onChange={e => setForm(p => ({ ...p, component: e.target.value }))} style={inputSt}>
                  <option value="carton">📦 Carton</option>
                  <option value="blister">💊 Blister</option>
                  <option value="label">🏷️ Label</option>
                  <option value="leaflet">📄 Leaflet (bula)</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={handleCreate} disabled={!form.name || !form.sku || !form.market}
                style={{ padding: '8px 16px', background: '#185FA5', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
                Criar projeto
              </button>
              <button onClick={() => setShowForm(false)}
                style={{ padding: '8px 16px', background: '#1a1a2e', color: '#888', border: '1px solid #333', borderRadius: 8, cursor: 'pointer' }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {loading && <p style={{ color: '#555' }}>Carregando projetos...</p>}

        {/* Project grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {projects.map(project => (
            <div key={project.id} style={{
              background: '#12121f', border: '1px solid #222',
              borderRadius: 12, padding: 18, transition: 'border-color 0.15s',
            }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#333')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#222')}
            >
              <div style={{ fontSize: 32, marginBottom: 10 }}>
                {COMPONENT_ICON[project.component || 'carton'] || '📦'}
              </div>
              <div style={{ color: '#fff', fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{project.name}</div>
              <div style={{ color: '#555', fontSize: 11, marginBottom: 14 }}>{project.sku} · {project.market}</div>

              {/* Upload PDF button */}
              <input
                ref={el => { fileRefs.current[project.id] = el }}
                type="file" accept=".pdf" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(project.id, f) }}
              />
              <button
                onClick={() => fileRefs.current[project.id]?.click()}
                disabled={uploading === project.id}
                style={{
                  width: '100%', padding: '9px 0',
                  background: uploading === project.id ? '#1a1a2e' : '#185FA5',
                  color: uploading === project.id ? '#555' : '#fff',
                  border: 'none', borderRadius: 8,
                  cursor: uploading === project.id ? 'wait' : 'pointer',
                  fontSize: 12, fontWeight: 700,
                }}>
                {uploading === project.id ? '⏳ Enviando...' : '📄 Upload PDF e abrir'}
              </button>
            </div>
          ))}

          {!loading && projects.length === 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#333', padding: 60 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📦</div>
              <p>Nenhum projeto ainda. Crie o primeiro!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const labelSt: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700, color: '#555',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
}
const inputSt: React.CSSProperties = {
  width: '100%', padding: '8px 10px', background: '#0d0d1a',
  border: '1px solid #333', borderRadius: 6, color: '#ddd',
  fontSize: 12, boxSizing: 'border-box',
}
