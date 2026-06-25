export type ProcessStatus =
  | 'draft'
  | 'briefing'
  | 'artwork_creation'
  | 'approval'
  | 'ready'

export type AssignmentRole =
  | 'artwork_coordinator'
  | 'marketing'
  | 'regulatory'
  | 'manufacturing_site'
  | 'external_studio'

export type AnnotationActionType = 'delete' | 'replace' | 'move' | 'resize'

export interface ArtworkProcess {
  id: string
  project_name: string
  project_description?: string
  status: ProcessStatus
  is_active: boolean
  created_by: string
  created_at: string
  updated_at: string
  components?: ProcessComponent[]
  assignments?: ProcessAssignment[]
}

export interface ProcessComponent {
  id: string
  process_id: string
  component_code: string
  sku?: string
  is_new_sku: boolean
  pdf_path?: string
  market: string
  manufacturing_site?: string
}

export interface ProcessAssignment {
  id: string
  process_id: string
  role: AssignmentRole
  assignee_email: string
  assigned_at: string
}

// ── Fixed reference lists (mirrored from backend/domain/models.py) ───────────────

export const MARKETS: string[] = [
  'South America',
  'North America',
  'Central America',
  'Caribbean',
  'Europe',
  'Asia',
  'Russia',
  'Oceania',
]

export const MANUFACTURING_SITES: string[] = Array.from(
  { length: 20 },
  (_, i) => `Manufacturing Site ${i + 1}`,
)

export const ROLE_LABELS: Record<AssignmentRole, string> = {
  artwork_coordinator: 'Artwork Coordinator',
  marketing:           'Marketing',
  regulatory:          'Regulatory',
  manufacturing_site:  'Manufacturing Site',
  external_studio:     'External Studio',
}

// Status progression order (for forward/backward Kanban navigation)
export const STATUS_ORDER: ProcessStatus[] = [
  'draft',
  'briefing',
  'artwork_creation',
  'approval',
  'ready',
]
