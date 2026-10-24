import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './styles/theme.css'
import { App } from './App'
import { loadSettings } from './state/settings'
import { loadLibrary } from './state/library'
import { startAccountSync } from './state/account'

async function start() {
  await Promise.all([loadSettings(), loadLibrary()])
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
