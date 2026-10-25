import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './styles/theme.css'
import { App } from './App'
import { installRendererLog } from './lib/rendererLog'
import { loadSettings } from './state/settings'
import { loadLibrary } from './state/library'
import { loadMusic } from './state/music'
import { loadParental } from './state/parental'
import { startAccountSync } from './state/account'

async function start() {
  installRendererLog()
  // Parental controls first: the core configuration sent by loadSettings includes restricted mode.
  await loadParental()
  await Promise.all([loadSettings(), loadLibrary(), loadMusic()])
  startAccountSync()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>,
  )
}

void start()
