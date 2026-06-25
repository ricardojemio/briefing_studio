import type {
  ArtworkProcess,
  AssignmentRole,
  ComparisonRecord,
  ProcessAssignment,
  ProcessComponent,
  ProcessStatus,
} from '../types/process'

const BASE = '/api/v1'

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({ detail: r.statusText }))
    throw new Error(e.detail || 'API error')
  }
  return r.json()
}

export const processApi = {
  // ── Processes ────────────────────────────────────────────────────────────────
  list: () =>
    req<ArtworkProcess[]>('/processes/'),

  create: (data: { project_name: string; project_description?: string; created_by?: string }) =>
    req<ArtworkProcess>('/processes/', { method: 'POST', body: JSON.stringify(data) }),

  get: (id: string) =>
    req<ArtworkProcess>(`/processes/${id}`),

  updateStatus: (id: string, status: ProcessStatus) =>
    req<ArtworkProcess>(`/processes/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  delete: (id: string) =>
    req<{ deleted: string }>(`/processes/${id}`, { method: 'DELETE' }),

  // ── Components ───────────────────────────────────────────────────────────────
  listComponents: (id: string) =>
    req<ProcessComponent[]>(`/processes/${id}/components`),

  addComponent: async (id: string, formData: FormData): Promise<ProcessComponent> => {
    const r = await fetch(`${BASE}/processes/${id}/components`, {
      method: 'POST',
      body: formData,
    })
    if (!r.ok) {
      const e = await r.json().catch(() => ({ detail: r.statusText }))
      throw new Error(e.detail || 'API error')
    }
    return r.json()
  },

  // ── Assignments ──────────────────────────────────────────────────────────────
  listAssignments: (id: string) =>
    req<ProcessAssignment[]>(`/processes/${id}/assignments`),

  addAssignment: (id: string, data: { role: AssignmentRole; assignee_email: string }) =>
    req<ProcessAssignment>(`/processes/${id}/assignments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // ── Comparisons ──────────────────────────────────────────────────────────────
  listComparisons: (id: string) =>
    req<ComparisonRecord[]>(`/processes/${id}/comparisons`),

  getComparison: (id: string, cid: string) =>
    req<ComparisonRecord>(`/processes/${id}/comparisons/${cid}`),

  runComparison: async (
    processId: string,
    revisedFile: File,
    originalPdfPath?: string,
  ): Promise<ComparisonRecord> => {
    const fd = new FormData()
    fd.append('file', revisedFile)
    if (originalPdfPath) fd.append('original_pdf_path', originalPdfPath)
    const r = await fetch(`${BASE}/processes/${processId}/comparison`, {
      method: 'POST',
      body: fd,
    })
    if (!r.ok) {
      const e = await r.json().catch(() => ({ detail: r.statusText }))
      throw new Error(e.detail || 'API error')
    }
    return r.json()
  },
}
