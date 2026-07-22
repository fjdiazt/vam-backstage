import { describe, expect, it, vi } from 'vitest'
import { recoverStorage } from './StorageGate.jsx'

describe('recoverStorage', () => {
  it('keeps the gate closed when storage is unavailable', async () => {
    const status = vi.fn().mockResolvedValue({ available: false, error: 'offline' })
    const scan = vi.fn()

    await expect(recoverStorage({ storage: { status }, scan: { start: scan } })).resolves.toEqual({
      available: false,
      error: 'offline',
    })
    expect(status).toHaveBeenCalledTimes(1)
    expect(scan).not.toHaveBeenCalled()
  })

  it('scans before returning recovered storage', async () => {
    const calls = []
    const status = vi
      .fn()
      .mockImplementationOnce(async () => {
        calls.push('check')
        return { available: true }
      })
      .mockImplementationOnce(async () => {
        calls.push('recheck')
        return { available: true, path: '/vam' }
      })
    const scan = vi.fn(async () => calls.push('scan'))

    await expect(recoverStorage({ storage: { status }, scan: { start: scan } })).resolves.toEqual({
      available: true,
      path: '/vam',
    })
    expect(calls).toEqual(['check', 'scan', 'recheck'])
  })
})
