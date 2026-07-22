import { constants } from 'fs'
import { describe, expect, it, vi } from 'vitest'
import { checkVamStorage, getVamStorageStatus, storageChannelUsesVam } from './vam-storage.js'

const directory = { isDirectory: () => true }

describe('VaM storage health', () => {
  it('does not impose a gate in normal watcher mode', async () => {
    await expect(checkVamStorage(null, { env: {} })).resolves.toEqual({
      required: false,
      mode: 'watch',
      available: true,
      path: null,
      error: null,
    })
  })

  it('accepts a readable and writable mounted VaM root', async () => {
    const stat = vi.fn().mockResolvedValue(directory)
    const access = vi.fn().mockResolvedValue()
    await expect(
      checkVamStorage('/vam', {
        env: { VAM_STORAGE_MODE: 'manual' },
        statFn: stat,
        accessFn: access,
      }),
    ).resolves.toMatchObject({ required: true, mode: 'manual', available: true, path: '/vam', error: null })
    expect(stat).toHaveBeenCalledTimes(2)
    expect(access).toHaveBeenCalledWith('/vam', constants.R_OK | constants.W_OK)
  })

  it('rejects the empty mountpoint left by an unavailable SMB share', async () => {
    const stat = vi
      .fn()
      .mockResolvedValueOnce(directory)
      .mockRejectedValueOnce(Object.assign(new Error('missing AddonPackages'), { code: 'ENOENT' }))
    const result = await checkVamStorage('/vam', {
      env: { VAM_STORAGE_MODE: 'manual' },
      statFn: stat,
      accessFn: vi.fn(),
    })
    expect(result).toMatchObject({ required: true, available: false, path: '/vam' })
    expect(result.error).toContain('missing AddonPackages')
    expect(getVamStorageStatus()).toEqual(result)
  })

  it('rejects an unreadable root', async () => {
    const result = await checkVamStorage('/vam', {
      env: { VAM_STORAGE_MODE: 'manual' },
      statFn: vi.fn().mockRejectedValue(Object.assign(new Error('share offline'), { code: 'EHOSTDOWN' })),
      accessFn: vi.fn(),
    })
    expect(result.available).toBe(false)
    expect(result.error).toContain('share offline')
  })

  it('rejects an unwritable share', async () => {
    const result = await checkVamStorage('/vam', {
      env: { VAM_STORAGE_MODE: 'manual' },
      statFn: vi.fn().mockResolvedValue(directory),
      accessFn: vi.fn().mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' })),
    })
    expect(result.available).toBe(false)
    expect(result.error).toContain('permission denied')
  })

  it('classifies VaM-backed RPC channels', () => {
    expect(storageChannelUsesVam('packages:list')).toBe(true)
    expect(storageChannelUsesVam('contents:toggle-favorite')).toBe(true)
    expect(storageChannelUsesVam('scan:start')).toBe(true)
    expect(storageChannelUsesVam('extract:run')).toBe(true)
    expect(storageChannelUsesVam('hub:search')).toBe(false)
    expect(storageChannelUsesVam('settings:get')).toBe(false)
    expect(storageChannelUsesVam('storage:status')).toBe(false)
  })
})
