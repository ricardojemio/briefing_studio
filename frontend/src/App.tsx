// src/App.tsx
import { useState } from 'react'
import Dashboard from './components/Dashboard'
import Studio    from './components/Studio'
import { useStore } from './store'
import type { Artwork } from './types'

type View = 'dashboard' | 'studio'

export default function App() {
  const [view,    setView]    = useState<View>('dashboard')
  const [artwork, setArtwork] = useState<Artwork | null>(null)
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

  return <Dashboard onOpenStudio={handleOpenStudio} />
}
