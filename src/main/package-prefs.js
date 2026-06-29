import { existsSync } from 'fs'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { ADDON_PACKAGES_USER_PREFS } from '@shared/paths.js'
import { recordOwnedPath } from './watcher.js'

export function packagePrefsPath(vamDir, packageName) {
  return join(vamDir, ADDON_PACKAGES_USER_PREFS, `${packageName}.prefs`)
}

async function readJsonObject(path) {
  if (!existsSync(path)) return {}
  try {
    const json = JSON.parse(await readFile(path, 'utf8'))
    return json && typeof json === 'object' && !Array.isArray(json) ? json : {}
  } catch {
    return {}
  }
}

export async function readPackageHiddenPrefs(vamDir, packageName) {
  const json = await readJsonObject(packagePrefsPath(vamDir, packageName))
  return typeof json.hidden === 'boolean' ? json.hidden : null
}

export async function writePackageHiddenPref(vamDir, packageName, hidden) {
  const path = packagePrefsPath(vamDir, packageName)
  const json = await readJsonObject(path)
  json.hidden = !!hidden
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  recordOwnedPath(path)
  recordOwnedPath(tmp)
  await writeFile(tmp, `${JSON.stringify(json, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}
