// src/App.tsx
import { useState } from 'react'
import Dashboard         from './components/Dashboard'
import Studio            from './components/Studio'
import StartScreen       from './pages/StartScreen'
import ProcessListPage   from './pages/ProcessListPage'
import NewProcessPage    from './pages/NewProcessPage'
import ProcessDetailPage from './pages/ProcessDetailPage'
import { useStore } from './store'
import type { Artwork } from './types'

type View = 'start' | 'dashboard' | 'studio' | 'processes' | 'process-new' | 'process-detail'

export default function App() {
  // ArtReview (PDF artwork version comparison) is the primary tool and the
  // default landing view. The legacy Dashboard/Studio (annotation-driven
  // draft generation) flow is kept intact in code but unlinked from
  // navigation — out of scope for the comparison-focused product.
  //
  // The Kanban ('processes') and the "New Process" form ('process-new') are
  // kept in code below, unreachable, by product decision: the start screen
  // replaces both (direct upload-and-compare, plus a project list with
  // search). Kanban also showed process-stage UI (columns, forward/back
  // arrows, "1/5") which the product no longer surfaces anywhere, so nothing
  // sets `view` to either of these two states any more.
  const [view,              setView]              = useState<View>('start')
  const [artwork,           setArtwork]           = useState<Artwork | null>(null)
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null)
  const { setPage, setElements, setActions, setPagePreview } = useStore()

  const handleOpenStudio = (a: Artwork) => {
    setArtwork(a)
    setPage(0)
    setElements([])
    setActions([])
    setPagePreview(null)
    setView('studio')
  }

  const handleBack = () => {
    setView('dashboard')
    setArtwork(null)
  }

  if (view === 'studio' && artwork) {
    return <Studio artwork={artwork} onBack={handleBack} />
  }

  if (view === 'start') {
    return (
      <StartScreen
        onOpenProject={(id) => { setSelectedProcessId(id); setView('process-detail') }}
      />
    )
  }

  // Unreachable — see comment above the `view` state declaration.
  if (view === 'processes') {
    return (
      <ProcessListPage
        onNew={() => setView('process-new')}
        onSelect={(id) => { setSelectedProcessId(id); setView('process-detail') }}
      />
    )
  }

  // Unreachable — see comment above the `view` state declaration.
  if (view === 'process-new') {
    return (
      <NewProcessPage
        onBack={() => setView('processes')}
        onCreated={() => setView('processes')}
      />
    )
  }

  if (view === 'process-detail' && selectedProcessId) {
    return (
      <ProcessDetailPage
        processId={selectedProcessId}
        onBack={() => setView('start')}
      />
    )
  }

  return (
    <Dashboard
      onOpenStudio={handleOpenStudio}
      onNavigateProcesses={() => setView('processes')}
    />
  )
}
