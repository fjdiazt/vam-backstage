import { ipcMain } from 'electron'
import { getSetting } from '../db.js'
import { syncBrowserAssistTags, browserAssistSettingsDirExists } from '../browser-assist.js'
import { notify } from '../notify.js'

/**
 * BrowserAssist tag sync + presence probe.
 *
 * Kept out of the `dev:` prefix so remote clients can invoke them — they run
 * against the host's VaM dir / DB, which is what a client managing that library
 * wants. Destructive `dev:*` channels stay local-only via channel-policy.
 */
export function registerBrowserAssistHandlers() {
  ipcMain.handle('browser-assist:dir-exists', () => {
    const vamDir = getSetting('vam_dir')
    return { exists: browserAssistSettingsDirExists(vamDir) }
  })

  ipcMain.handle('browser-assist:sync', async () => {
    const vamDir = getSetting('vam_dir')
    if (!vamDir) return { ok: false, error: 'VaM directory not configured' }
    try {
      const result = await syncBrowserAssistTags(vamDir)
      if ((result.labelsImported ?? 0) > 0 || (result.labelsRemoved ?? 0) > 0) notify('labels:updated')
      notify('contents:updated')
      notify('packages:updated')
      return { ok: true, ...result }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
}
