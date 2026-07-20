import { describe, expect, it, vi } from 'vitest'
import { createApi } from './api.js'

function setup() {
  const invoke = vi.fn().mockResolvedValue('result')
  const on = vi.fn(() => vi.fn())
  const runtime = { kind: 'web', capabilities: { embeddedHub: false } }
  const api = createApi({
    transport: { invoke, on, remote: { isRemote: true, url: 'ws://host', onStatus: vi.fn() } },
    runtime,
    getPathForFile: () => '',
    hubWebviewPreload: null,
  })
  return { api, invoke, on, runtime }
}

describe('createApi', () => {
  it('preserves request and event channel mappings', async () => {
    const { api, invoke, on } = setup()

    await api.packages.list({ direct: true })
    api.onPackagesUpdated(vi.fn())

    expect(invoke).toHaveBeenCalledWith('packages:list', { direct: true })
    expect(on).toHaveBeenCalledWith('packages:updated', expect.any(Function))
  })

  it('exposes runtime and platform adapters', () => {
    const { api, runtime } = setup()

    expect(api.runtime).toBe(runtime)
    expect(api.remote.isRemote).toBe(true)
    expect(api.remote.url).toBe('ws://host')
    expect(api.packages.getPathForFile({})).toBe('')
    expect(api.app.hubWebviewPreload).toBeNull()
  })

  it('retains every API domain', () => {
    const { api } = setup()
    const domains = [
      'packages',
      'contents',
      'labels',
      'thumbnails',
      'avatars',
      'hub',
      'wishlist',
      'downloads',
      'scan',
      'integrity',
      'startup',
      'wizard',
      'settings',
      'libraryDirs',
      'dev',
      'extract',
      'shell',
      'app',
      'updater',
      'remote',
    ]

    for (const domain of domains) expect(api[domain]).toBeTruthy()
    expect(api.hub.hidden).toBeTruthy()
  })
})
