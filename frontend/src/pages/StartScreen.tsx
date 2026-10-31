// src/pages/StartScreen.tsx
//
// New landing screen (replaces the Kanban as the app's entry point): upload
// the original and revised PDF, compare them directly, and browse existing
// projects. Reuses the comparison screen's light theme (comparisonTheme.ts)
// so the whole product reads as one visual system.

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { processApi } from '../services/processApi'
import type { ArtworkProcess } from '../types/process'
import { theme as T, MIN_TOUCH_TARGET, FOCUSABLE_CLASS, injectComparisonGlobalStyles } from '../styles/comparisonTheme'
import { startScreenStrings as S } from '../i18n/startScreenStrings'

// Fixed, neutral placeholder values for backend fields this screen doesn't
// collect (Component Code, Market used to be asked on the old "New Process"
// form). This screen hides all product metadata by design, so these must
// never be derived from the uploaded file and are never displayed anywhere.
const NEUTRAL_COMPONENT_DEFAULTS = {
  component_code: 'N/A',
  market:         'N/A',
} as const

interface ProjectCardData {
  process:          ArtworkProcess
  lastComparisonAt: string | null
  pendingCount:     number | null
  thumbnails:       string[]
}

interface Props {
  onOpenProject: (id: string) => void
}

export default function StartScreen({ onOpenProject }: Props) {
  const [originalFile, setOriginalFile] = useState<File | null>(null)
  const [revisedFile,  setRevisedFile]  = useState<File | null>(null)
  const [comparing,    setComparing]    = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)

  const [cards,   setCards]   = useState<ProjectCardData[]>([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')

  useEffect(() => { injectComparisonGlobalStyles() }, [])

  // No aggregate endpoint exists for "latest comparison + pending count per
  // process", so this fans out per card: list() then, per process,
  // listComparisons() and (if one exists) getReviewSummary(). For the small
  // number of real projects in this app that's fine; a future
  // GET /processes/?include=latest_comparison_summary would remove the fan-out.
  const loadProjects = useCallback(async () => {
    setLoading(true)
    try {
      const processes = await processApi.list()
      const enriched = await Promise.all(processes.map(async (process): Promise<ProjectCardData> => {
        try {
          const comparisons = await processApi.listComparisons(process.id)
          if (comparisons.length === 0) {
            return { process, lastComparisonAt: null, pendingCount: null, thumbnails: [] }
          }
          const latest = [...comparisons].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
          const thumbnails = (latest.result?.pages ?? [])
            .slice(0, 3)
            .map(p => p.original_render_url)
            .filter((u): u is string => !!u)

          let pendingCount: number | null = null
          try {
            const summary = await processApi.getReviewSummary(process.id, latest.id)
            pendingCount = summary.pending
          } catch {
            pendingCount = null
          }
          return { process, lastComparisonAt: latest.created_at, pendingCount, thumbnails }
        } catch {
          return { process, lastComparisonAt: null, pendingCount: null, thumbnails: [] }
        }
      }))
      setCards(enriched)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadProjects() }, [loadProjects])

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return cards
    return cards.filter(c => c.process.project_name.toLowerCase().includes(q))
  }, [cards, search])

  const canCompare = !!originalFile && !!revisedFile && !comparing

  const handleCompare = async () => {
    if (!originalFile || !revisedFile) return
    setComparing(true)
    setCompareError(null)
    const projectName = originalFile.name.replace(/\.pdf$/i, '')

    try {
      const proc = await processApi.create({ project_name: projectName })

      let component
      try {
        const fd = new FormData()
        fd.append('component_code', NEUTRAL_COMPONENT_DEFAULTS.component_code)
        fd.append('market',         NEUTRAL_COMPONENT_DEFAULTS.market)
        fd.append('file', originalFile)
        component = await processApi.addComponent(proc.id, fd)
      } catch {
        setCompareError(S.errors.addOriginalFailed(projectName))
        return
      }

      try {
        await processApi.runComparison(proc.id, revisedFile, component.pdf_path ?? undefined)
      } catch {
        setCompareError(S.errors.runComparisonFailed(projectName))
        return
      }

      onOpenProject(proc.id)
    } catch {
      setCompareError(S.errors.createProcessFailed)
    } finally {
      setComparing(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: T.surfaceAlt, fontFamily: T.fontFamily }}>
      <Header />

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '48px 32px' }}>
        <Hero />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginTop: 32 }}>
          <UploadBox
            label={S.upload.labelOriginal}
            labelBg={T.uploadLabelOriginalBg}
            labelColor={T.text}
            dragText={S.upload.dragOriginal}
            file={originalFile}
            onFile={setOriginalFile}
          />
          <UploadBox
            label={S.upload.labelRevised}
            labelBg={T.text}
            labelColor="#fff"
            dragText={S.upload.dragRevised}
            file={revisedFile}
            onFile={setRevisedFile}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 24, flexWrap: 'wrap' }}>
          <button
            onClick={handleCompare}
            disabled={!canCompare}
            className={FOCUSABLE_CLASS}
            style={{
              height: 52, padding: '0 28px', minHeight: MIN_TOUCH_TARGET, boxSizing: 'border-box',
              background: canCompare ? T.accent : T.border,
              color:      canCompare ? '#fff'   : T.textSecondary,
              border: 'none', borderRadius: 12,
              fontSize: 15, fontWeight: 600,
              cursor: canCompare ? 'pointer' : 'not-allowed',
            }}
          >
            {comparing ? S.compare.loading : S.compare.button}
          </button>
          <span style={{ fontSize: 14, color: T.textSecondary }}>{S.compare.helper}</span>
        </div>

        {compareError && (
          <div style={{
            marginTop: 16, padding: '12px 16px', background: T.rejectBg,
            border: `1px solid ${T.reject}40`, borderRadius: 8,
            color: T.reject, fontSize: 14, maxWidth: 720,
          }}>
            {compareError}
          </div>
        )}

        <section style={{ marginTop: 56 }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 16, flexWrap: 'wrap', marginBottom: 20,
          }}>
            <h2 style={{ fontSize: 22, fontWeight: 600, color: T.text, margin: 0 }}>
              {S.projects.heading}
            </h2>
            <div style={{ minWidth: 240 }}>
              <label htmlFor="start-project-search" style={{
                position: 'absolute', width: 1, height: 1, overflow: 'hidden',
                clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap',
              }}>
                {S.projects.searchLabel}
              </label>
              <input
                id="start-project-search"
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={S.projects.searchPlaceholder}
                className={FOCUSABLE_CLASS}
                style={{
                  width: '100%', height: 44, minHeight: MIN_TOUCH_TARGET, boxSizing: 'border-box',
                  padding: '0 14px', fontSize: 14, borderRadius: 8,
                  border: `1px solid ${T.border}`, background: T.surface, color: T.text,
                }}
              />
            </div>
          </div>

          {loading ? (
            <div style={{ color: T.textSecondary, fontSize: 14 }}>Carregando…</div>
          ) : filteredCards.length === 0 ? (
            <div style={{ color: T.textSecondary, fontSize: 14 }}>
              {cards.length === 0 ? S.projects.emptyNoSearch : S.projects.empty}
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              {filteredCards.map(c => (
                <ProjectCard key={c.process.id} data={c} onOpen={() => onOpenProject(c.process.id)} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

// ── Header ───────────────────────────────────────────────────────────────────────

function Header() {
  return (
    <header style={{
      height: 64, background: T.surface, borderBottom: `1px solid ${T.border}`,
      display: 'flex', alignItems: 'center', padding: '0 32px', gap: 10, flexShrink: 0,
    }}>
      <svg width="30" height="26" viewBox="0 0 30 26" aria-hidden="true" style={{ flexShrink: 0 }}>
        <rect x="9" y="3" width="16" height="20" rx="2" fill={T.logoAccent} stroke="#1B1B1A" strokeWidth="2" />
        <rect x="3" y="1" width="16" height="20" rx="2" fill="#fff" stroke="#1B1B1A" strokeWidth="2" />
      </svg>
      <span style={{ fontSize: 20, fontWeight: 600, color: T.text }}>{S.header.productName}</span>
    </header>
  )
}

// ── Hero ─────────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <div>
      <h1 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', color: T.text, margin: 0 }}>
        {S.hero.title}
      </h1>
      <p style={{ fontSize: 17, color: T.heroSubtitleText, maxWidth: 720, marginTop: 12, lineHeight: 1.5 }}>
        {S.hero.subtitle}
      </p>
    </div>
  )
}

// ── Upload box ───────────────────────────────────────────────────────────────────

function UploadBox({
  label, labelBg, labelColor, dragText, file, onFile,
}: {
  label:      string
  labelBg:    string
  labelColor: string
  dragText:   string
  file:       File | null
  onFile:     (f: File | null) => void
}) {
  const [dragOver,  setDragOver]  = useState(false)
  const [typeError, setTypeError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const acceptFile = (f: File | null) => {
    if (!f) return
    const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      setTypeError(true)
      return
    }
    setTypeError(false)
    onFile(f)
  }

  return (
    <div
      style={{
        flex: '1 1 320px', minWidth: 280, boxSizing: 'border-box',
        border: `2px dashed ${dragOver ? T.accent : T.uploadBoxBorder}`,
        borderRadius: 16, background: T.surface, minHeight: 176,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 10, padding: '28px 20px 24px', position: 'relative', textAlign: 'center',
        transition: 'border-color 0.12s',
      }}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault()
        setDragOver(false)
        acceptFile(e.dataTransfer.files?.[0] ?? null)
      }}
    >
      <span style={{
        position: 'absolute', top: 14, left: 14,
        background: labelBg, color: labelColor,
        fontSize: 12, fontWeight: 700, letterSpacing: '0.04em',
        padding: '4px 10px', borderRadius: 999,
      }}>
        {label}
      </span>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        style={{ display: 'none' }}
        onChange={e => acceptFile(e.target.files?.[0] ?? null)}
      />

      {file ? (
        <>
          <span style={{ fontSize: 14, color: T.text, fontWeight: 600, wordBreak: 'break-word', maxWidth: '90%' }}>
            ✓ {file.name}
          </span>
          <button
            onClick={() => inputRef.current?.click()}
            className={FOCUSABLE_CLASS}
            style={{
              minHeight: MIN_TOUCH_TARGET, padding: '0 16px',
              background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 8,
              color: T.textSecondary, fontSize: 13, cursor: 'pointer',
            }}
          >
            {S.upload.changeFile}
          </button>
        </>
      ) : (
        <>
          <span style={{ fontSize: 14, color: T.textSecondary, maxWidth: 260 }}>{dragText}</span>
          <button
            onClick={() => inputRef.current?.click()}
            className={FOCUSABLE_CLASS}
            style={{
              minHeight: MIN_TOUCH_TARGET, padding: '0 18px',
              background: T.accent, border: 'none', borderRadius: 8,
              color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {S.upload.chooseFile}
          </button>
        </>
      )}

      {typeError && (
        <span style={{ fontSize: 12, color: T.reject }}>{S.upload.invalidFileType}</span>
      )}
    </div>
  )
}

// ── Project card ─────────────────────────────────────────────────────────────────

function ProjectCard({ data, onOpen }: { data: ProjectCardData; onOpen: () => void }) {
  const { process, lastComparisonAt, pendingCount, thumbnails } = data
  return (
    <a
      href="#"
      onClick={e => { e.preventDefault(); onOpen() }}
      className={FOCUSABLE_CLASS}
      style={{
        flex: '1 1 300px', maxWidth: 380, boxSizing: 'border-box',
        border: `1px solid ${T.border}`, borderRadius: 16, padding: 20,
        background: T.surface, textDecoration: 'none', color: 'inherit',
        display: 'flex', flexDirection: 'column', gap: 10, cursor: 'pointer',
      }}
    >
      {thumbnails.length > 0 && (
        <div style={{ display: 'flex', gap: 6 }}>
          {thumbnails.map((url, i) => (
            <img
              key={i} src={url} alt=""
              style={{
                width: 44, height: 58, objectFit: 'cover', borderRadius: 4,
                border: `1px solid ${T.border}`, flexShrink: 0,
              }}
            />
          ))}
        </div>
      )}

      <div style={{ fontSize: 18, fontWeight: 600, color: T.text, lineHeight: 1.3 }}>
        {process.project_name}
      </div>

      {lastComparisonAt && (
        <div style={{ fontSize: 13, color: T.textSecondary }}>
          {S.projects.lastComparison(formatDateBR(lastComparisonAt))}
        </div>
      )}

      {pendingCount !== null && (
        <span style={{
          alignSelf: 'flex-start',
          background: T.highlightChipBg, color: T.highlightChipText,
          fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
        }}>
          {S.projects.pendingDiffs(pendingCount)}
        </span>
      )}
    </a>
  )
}

function formatDateBR(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}
