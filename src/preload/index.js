import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { createApi } from '@shared/api.js'
import { createRemoteTransport } from './remote-transport.js'
import { join } from 'path'
import { pathToFileURL } from 'url'

// `--connect=<url>` is forwarded here via webPreferences.additionalArguments in
// client mode. It must be read synchronously to pick the transport before any
// api method runs. Without it, the transport is a thin passthrough to IPC, so
// the normal local app is behaviourally unchanged.
const connectArg = process.argv.find((a) => a.startsWith('--connect='))
const connectUrl = connectArg ? connectArg.slice('--connect='.length) : null

const transport = connectUrl
  ? createRemoteTransport(connectUrl)
  : {
      invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
      on: (channel, callback) => {
        const handler = (_e, ...args) => callback(...args)
        ipcRenderer.on(channel, handler)
        return () => ipcRenderer.removeListener(channel, handler)
      },
      remote: { isRemote: false },
    }

const api = createApi({
  transport,
  runtime: {
    kind: 'electron',
    capabilities: {
      embeddedHub: true,
      hubAccountActions: true,
      nativeDialogs: !connectUrl,
      revealInFolder: !connectUrl,
      updater: true,
      serverControl: true,
      developerTools: true,
    },
  },
  getPathForFile: (file) => webUtils.getPathForFile(file),
  hubWebviewPreload: pathToFileURL(join(__dirname, 'hub-webview.js')).toString(),
})
// Mirror main-process logs into the renderer DevTools console. Errors sent
// from the main process arrive as { __mainLogError, name, message, stack };
// rehydrate to a real Error so DevTools renders them with a clickable stack.
ipcRenderer.on('main:log', (_e, payload) => {
  if (!payload) return
  const { level, args } = payload
  const fn = console[level] || console.log
  const restored = (args || []).map((a) => {
    if (a && typeof a === 'object' && a.__mainLogError) {
      const err = new Error(a.message)
      err.name = a.name || 'Error'
      err.stack = a.stack
      return err
    }
    return a
  })
  fn('%c[main]', 'color:#888', ...restored)
})

// When the browser detects network recovery, notify the (possibly remote)
// download manager so downloads waiting on retry backoff can resume immediately.
window.addEventListener('online', () => {
  transport.invoke('downloads:network-online').catch(() => {})
})

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
