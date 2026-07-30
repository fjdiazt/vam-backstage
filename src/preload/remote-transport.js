import { ipcRenderer } from 'electron'
import { createRemoteTransport as createSharedRemoteTransport } from '@shared/remote-transport.js'

/**
 * Electron adapter for shared remote WebSocket transport. Machine-local work
 * stays in this client's main process; host-path operations use stable stubs.
 */

const LOCAL_CHANNELS = new Set([
  'app:version',
  'dev:is-dev',
  // Machine-scoped prefs: the client unlocks its *own* developer options rather
  // than flipping the host's flag (which also gates the host's version gate).
  'dev:get-unlocked',
  'dev:set-unlocked',
  'updater:install',
  'updater:check',
  'updater:getChannel',
  'updater:setChannel',
  'shell:openExternal',
  'hub:isLoggedIn',
  'hub:resourceUserState',
  'hub:toggleFavorite',
  'hub:toggleBookmark',
  'hub:toggleRate',
  'hub:toggleLike',
  'wishlist:import-collect',
])

const STUBS = {
  'library-dirs:browse': { cancelled: true },
  'wizard:browse-vam-dir': { cancelled: true },
  'wizard:detect-vam-dir': { path: null, varCount: 0, source: null },
  'shell:showItemInFolder': undefined,
  'dev:nuke-database': { ok: false, error: 'not supported in remote mode' },
}

export function createRemoteTransport(url) {
  return createSharedRemoteTransport(url, {
    identify: async () => {
      const [version, dev] = await Promise.all([ipcRenderer.invoke('app:version'), ipcRenderer.invoke('dev:is-dev')])
      return { version, dev: !!dev }
    },
    isLocalChannel: (channel) => channel.startsWith('remote:') || LOCAL_CHANNELS.has(channel),
    localInvoke: (channel, args) => ipcRenderer.invoke(channel, ...args),
    localSubscribe: (channel, callback) => {
      const handler = (_event, ...args) => callback(...args)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    stubs: STUBS,
    reload: () => window.location.reload(),
  })
}
