import { constants } from 'fs'
import { access, stat } from 'fs/promises'
import { join } from 'path'
import { ADDON_PACKAGES } from '@shared/paths.js'
import { isManualStorageMode } from './runtime-config.js'

let current = { required: false, mode: 'watch', available: true, path: null, error: null }

function message(error) {
  const detail = error?.message || String(error)
  return error?.code ? `${error.code}: ${detail}` : detail
}

export async function checkVamStorage(vamDir, { env = process.env, statFn = stat, accessFn = access } = {}) {
  if (!isManualStorageMode(env)) {
    current = { required: false, mode: 'watch', available: true, path: vamDir || null, error: null }
    return { ...current }
  }

  const path = vamDir || null
  if (!path) {
    current = { required: true, mode: 'manual', available: false, path, error: 'VAM_DIR is not configured' }
    return { ...current }
  }

  try {
    const root = await statFn(path)
    if (!root.isDirectory()) throw new Error(`${path} is not a directory`)
    const packages = await statFn(join(path, ADDON_PACKAGES))
    if (!packages.isDirectory()) throw new Error(`${join(path, ADDON_PACKAGES)} is not a directory`)
    await accessFn(path, constants.R_OK | constants.W_OK)
    current = { required: true, mode: 'manual', available: true, path, error: null }
  } catch (error) {
    current = { required: true, mode: 'manual', available: false, path, error: message(error) }
  }
  return { ...current }
}

export function getVamStorageStatus() {
  return { ...current }
}

const STORAGE_PREFIXES = ['packages:', 'contents:', 'scan:', 'integrity:', 'extract:', 'library-dirs:', 'thumbnails:']

export function storageChannelUsesVam(channel) {
  return typeof channel === 'string' && STORAGE_PREFIXES.some((prefix) => channel.startsWith(prefix))
}

export function storageUnavailableError(status = current) {
  const error = new Error(`VaM storage unavailable${status.path ? ` at ${status.path}` : ''}: ${status.error}`)
  error.code = 'VAM_STORAGE_UNAVAILABLE'
  return error
}
