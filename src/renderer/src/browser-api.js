import { createApi } from '@shared/api.js'
import { normalizeExternalUrl } from '@shared/external-url.js'
import { createRemoteTransport } from '@shared/remote-transport.js'

const unavailable = { ok: false, error: 'not supported in web mode' }

export function browserWebSocketUrl(location) {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
}

export function createBrowserApi({ location = window.location, createSocket, open = window.open.bind(window) } = {}) {
  const stubs = {
    'library-dirs:browse': { cancelled: true },
    'wizard:browse-vam-dir': { cancelled: true },
    'wizard:detect-vam-dir': { path: null, varCount: 0, source: null },
    'shell:showItemInFolder': undefined,
    'settings:getDatabasePath': null,
    'wishlist:import-collect': unavailable,
    'dev:is-dev': false,
    'dev:nuke-database': unavailable,
    'dev:count-deleted-data': unavailable,
    'dev:forget-deleted-data': unavailable,
    'dev:browser-assist-dir-exists': false,
    'dev:sync-browser-assist': unavailable,
    'updater:install': unavailable,
    'updater:check': unavailable,
    'updater:getChannel': 'stable',
    'updater:setChannel': unavailable,
    'remote:status': unavailable,
    'remote:local-ips': { primary: null, all: [] },
    'remote:get-autoconnect': { url: null },
    'remote:set-autoconnect': unavailable,
    'remote:start': unavailable,
    'remote:stop': unavailable,
    'remote:relaunch-connect': unavailable,
    'remote:relaunch-disconnect': unavailable,
    'shell:openExternal': (url) => {
      const target = normalizeExternalUrl(url)
      if (!target) return { ok: false, error: 'invalid_url' }
      open(target, '_blank', 'noopener,noreferrer')
      return { ok: true }
    },
  }
  const transportOptions = { stubs }
  if (createSocket) transportOptions.createSocket = createSocket
  const transport = createRemoteTransport(browserWebSocketUrl(location), transportOptions)
  return createApi({
    transport,
    runtime: {
      kind: 'web',
      capabilities: {
        embeddedHub: true,
        hubAccountActions: true,
        nativeDialogs: false,
        revealInFolder: false,
        updater: false,
        serverControl: false,
        developerTools: false,
      },
    },
  })
}
