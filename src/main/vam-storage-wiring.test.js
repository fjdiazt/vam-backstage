import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('manual storage wiring', () => {
  it('checks startup storage and never starts a watcher in manual mode', () => {
    const source = read('./index.js')
    expect(source).toContain('await checkVamStorage(vamDir)')
    expect(source).toContain('!isManualStorageMode()) branches.push(startWatcher(vamDir))')
  })

  it('checks rescans and skips watcher restart in manual mode', () => {
    const source = read('./ipc/scanner.js')
    expect(source).toContain('await checkVamStorage(vamDir)')
    expect(source).toContain("notify('storage:changed', storage)")
    expect(source).toContain('if (!isManualStorageMode()) startWatcher(vamDir)')
  })

  it('registers storage status on the shared IPC registry', () => {
    expect(read('./ipc/index.js')).toContain("ipcMain.handle('storage:status'")
  })
})
