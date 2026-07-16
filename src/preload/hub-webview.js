import { ipcRenderer } from 'electron'

window.addEventListener(
  'mousedown',
  (event) => {
    const direction = event.button === 3 ? -1 : event.button === 4 ? 1 : 0
    if (!direction) return
    event.preventDefault()
    event.stopImmediatePropagation()
    ipcRenderer.sendToHost('hub-page-nav', direction)
  },
  true,
)
