import { constants } from 'fs'
import { resolve } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { applyVamDirOverride, configureUserDataPath, isManualStorageMode } from './runtime-config.js'

describe('runtime config', () => {
  it('configures one writable Electron user-data root', () => {
    const app = { setPath: vi.fn() }
    const mkdir = vi.fn()
    const access = vi.fn()

    expect(configureUserDataPath(app, { VAM_USER_DATA: '/data' }, { mkdirSync: mkdir, accessSync: access })).toBe(
      resolve('/data'),
    )
    expect(mkdir).toHaveBeenCalledWith(resolve('/data'), { recursive: true })
    expect(access).toHaveBeenCalledWith(resolve('/data'), constants.R_OK | constants.W_OK)
    expect(app.setPath).toHaveBeenCalledWith('userData', resolve('/data'))
  })

  it('leaves normal Electron user data unchanged without an override', () => {
    const app = { setPath: vi.fn() }
    expect(configureUserDataPath(app, {})).toBeNull()
    expect(app.setPath).not.toHaveBeenCalled()
  })

  it('makes VAM_DIR authoritative and completes host setup', () => {
    const set = vi.fn()
    expect(applyVamDirOverride(set, { VAM_DIR: '/vam' })).toBe(resolve('/vam'))
    expect(set).toHaveBeenNthCalledWith(1, 'vam_dir', resolve('/vam'))
    expect(set).toHaveBeenNthCalledWith(2, 'initial_scan_done', '1')
  })

  it('selects manual mode only when explicitly configured', () => {
    expect(isManualStorageMode({ VAM_STORAGE_MODE: 'manual' })).toBe(true)
    expect(isManualStorageMode({ VAM_STORAGE_MODE: 'watch' })).toBe(false)
    expect(isManualStorageMode({})).toBe(false)
  })
})
