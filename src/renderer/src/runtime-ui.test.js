import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const read = (path) => readFileSync(resolve(import.meta.dirname, path), 'utf8')
const index = read('../index.html')
const app = read('App.jsx')
const hub = read('components/HubDetail.jsx')
const status = read('components/StatusBar.jsx')
const settings = read('views/SettingsView.jsx')
const files = read('components/FileTreeDialog.jsx')
const content = read('views/ContentView.jsx')
const storage = read('components/StorageGate.jsx')

describe('runtime gates', () => {
  it('gates setup, escape, and Hub', () => {
    expect(app).toContain('capabilities.nativeDialogs')
    expect(app).toContain('capabilities.serverControl')
    expect(app).toContain('Complete setup on the host desktop')
    expect(hub).toContain('capabilities.embeddedHub')
    expect(hub).toContain('capabilities.hubAccountActions')
    expect(hub).toContain('Open Hub page')
    expect(hub).toContain("runtime.kind === 'web'")
    expect(hub).toContain('<iframe')
  })

  it('allows the isolated Hub proxy iframe', () => {
    expect(index).toContain("frame-src 'self' http:")
  })

  it('gates updater, settings, developer, and reveal actions', () => {
    expect(status).toContain('capabilities.updater')
    expect(settings).toContain('capabilities.nativeDialogs')
    expect(settings).toContain('capabilities.serverControl')
    expect(settings).toContain('capabilities.developerTools')
    expect(files).toContain('capabilities.revealInFolder')
    expect(content).toContain('capabilities.revealInFolder')
  })

  it('blocks unavailable manual storage and retries with a scan', () => {
    expect(app).toContain('<StorageGate>')
    expect(storage).toContain('api.storage.status()')
    expect(storage).toContain('api.scan.start()')
    expect(storage).toContain('window.api.onStorageChanged')
    expect(storage).toContain('VaM storage unavailable')
    expect(storage).toContain('Retry')
  })

  it('shows manual rescan controls only for web manual mode', () => {
    expect(status).toContain("window.api.runtime.kind === 'web'")
    expect(status).toContain("storage?.mode === 'manual'")
    expect(status).toContain('Rescan shared VaM folder')
    expect(settings).toContain('Manual rescan')
  })
})
