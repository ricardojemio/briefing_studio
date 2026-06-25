// src/App.tsx
import { useState } from 'react'
import Dashboard         from './components/Dashboard'
import Studio            from './components/Studio'
import ProcessListPage   from './pages/ProcessListPage'
import NewProcessPage    from './pages/NewProcessPage'
import ProcessDetailPage from './pages/ProcessDetailPage'
import { useStore } from './store'
import type { Artwork } from './types'

type View = 'dashboard' | 'studio' | 'processes' | 'process-new' | 'process-detail'

export default function App() {
  const [view,              setView]              = useState<View>('dashboard')
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

  if (view === 'processes') {
    return (
      <ProcessListPage
        onBack={() => setView('dashboard')}
        onNew={() => setView('process-new')}
        onSelect={(id) => { setSelectedProcessId(id); setView('process-detail') }}
      />
    )
  }

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
        onBack={() => setView('processes')}
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
