import './assets/main.css'

// Suppress benign webview navigation abort noise from Electron's internal IPC layer
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || ''
  if (
    msg.includes('GUEST_VIEW_MANAGER_CALL') &&
    (msg.includes('ERR_ABORTED') || msg.includes('ERR_FAILED') || /\(-[23]\)/.test(msg))
  ) {
    e.preventDefault()
  }
})

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

async function start() {
  if (!window.api) {
    const { createBrowserApi } = await import('./browser-api.js')
    window.api = createBrowserApi()
  }
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

start().catch((error) => {
  console.error(error)
  document.getElementById('root').textContent = `VaM Backstage failed to start: ${error.message}`
})
