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

// ── Comparison types ──────────────────────────────────────────────────────────────

export type DiffSeverity = 'high' | 'medium' | 'low'

export type DiffType =
  | 'text_changed'
  | 'text_added'
  | 'text_removed'
  | 'font_size'
  | 'font_style'
  | 'color'
  | 'ean_changed'
  | 'pharmaCode'
  | 'visual'
  | 'dimensional'
  | 'compliance'

export interface DiffEntry {
  id:            string
  type:          DiffType
  severity:      DiffSeverity
  original_text: string
  revised_text:  string
  bbox:          [number, number, number, number]  // x0,y0,x1,y1 in PDF points
  page:          number
  description:   string
}

export interface PageComparison {
  page_num:            number
  page_size_pts:       [number, number]  // [width, height] in PDF points
  differences:         DiffEntry[]
  original_render_url: string | null
  revised_render_url:  string | null
  diff_render_url:     string | null
}

export interface ComparisonSummary {
  total_differences:    number
  text_changes:         number
  code_changes:         number
  visual_changes:       number
  dimensional_changes:  number
  compliance_flags:     number
}

export interface ComparisonRecord {
  id:                string
  process_id:        string
  original_pdf_path: string
  revised_pdf_path:  string
  created_at:        string
  created_by:        string
  approved_by:       string | null
  approved_at:       string | null
  result: {
    comparison_id: string
    summary:       ComparisonSummary
    pages:         PageComparison[]
  } | null
}

// ── Difference review types ───────────────────────────────────────────────────────

export type DiffReviewStatus = 'pending' | 'accepted' | 'rejected'

export interface DifferenceReview {
  diff_id:        string
  status:         DiffReviewStatus
  reviewer_email: string
  comment:        string | null
  reviewed_at:    string | null
}

export interface ReviewSummary {
  total:          number
  accepted:       number
  rejected:       number
  pending:        number
  can_approve:    boolean
  has_rejections: boolean
}

export interface ApproveResult {
  approved_by: string
  approved_at: string
}
