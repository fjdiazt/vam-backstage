import { accessSync, constants, mkdirSync } from 'fs'
import { resolve } from 'path'

export function configureUserDataPath(electronApp, env = process.env, fs = { mkdirSync, accessSync }) {
  const configured = String(env.VAM_USER_DATA || '').trim()
  if (!configured) return null
  const path = resolve(configured)
  fs.mkdirSync(path, { recursive: true })
  fs.accessSync(path, constants.R_OK | constants.W_OK)
  electronApp.setPath('userData', path)
  return path
}

export function applyVamDirOverride(set, env = process.env) {
  const configured = String(env.VAM_DIR || '').trim()
  if (!configured) return null
  const path = resolve(configured)
  set('vam_dir', path)
  set('initial_scan_done', '1')
  return path
}

export function isManualStorageMode(env = process.env) {
  return (
    String(env.VAM_STORAGE_MODE || '')
      .trim()
      .toLowerCase() === 'manual'
  )
}
