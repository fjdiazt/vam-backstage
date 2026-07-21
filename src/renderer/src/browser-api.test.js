import { describe, expect, it, vi } from 'vitest'
import { browserWebSocketUrl, createBrowserApi } from './browser-api.js'

describe('browser API', () => {
  it('uses same-origin WebSocket URLs', () => {
    expect(browserWebSocketUrl({ protocol: 'http:', host: 'vam:42069' })).toBe('ws://vam:42069')
    expect(browserWebSocketUrl({ protocol: 'https:', host: 'vam' })).toBe('wss://vam')
  })

  it('provides web capabilities and safe stubs', async () => {
    const api = createBrowserApi({
      location: { protocol: 'http:', host: 'vam:42069' },
      createSocket: vi.fn(() => ({ readyState: 0, close: vi.fn() })),
      open: vi.fn(),
    })
    expect(api.runtime.kind).toBe('web')
    expect(api.runtime.capabilities.embeddedHub).toBe(true)
    expect(api.runtime.capabilities.hubAccountActions).toBe(true)
    await expect(api.wizard.browseVamDir()).resolves.toEqual({ cancelled: true })
    await expect(api.updater.check()).resolves.toMatchObject({ ok: false })
  })
})
