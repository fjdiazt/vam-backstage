# Intranet Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve existing VaM Backstage renderer to desktop browsers on trusted intranet while preserving Electron desktop behavior.

**Architecture:** Keep one `out/renderer` artifact and one `window.api` contract. Electron preload and browser bootstrap build that contract from IPC or shared WebSocket transports; backend serves renderer files and WebSocket upgrades from one HTTP listener.

**Tech Stack:** JavaScript, Electron 39, React 19, Vite/electron-vite, Node `http`/`fs`/`path`, `ws`, Vitest.

## Global Constraints

- JavaScript only; no TypeScript or new runtime dependencies.
- Trusted intranet only; no authentication or TLS.
- Reuse exact `out/renderer`; no separate frontend.
- Desktop Chrome, Edge, Firefox only; no responsive redesign.
- Preserve Electron local and remote-client behavior.
- Web omits embedded Hub, Hub account actions, native dialogs, Explorer reveal, updater, server controls, developer tools.
- Web `.var` import uses existing chunked upload.
- HTTP and WebSocket share port `42069`.

---

### Task 1: Browser-safe codec and shared WebSocket transport

**Files:**

- Create: `src/shared/net-codec.test.js`
- Create: `src/shared/remote-transport.js`
- Create: `src/shared/remote-transport.test.js`
- Modify: `src/shared/net-codec.js`
- Modify: `src/preload/remote-transport.js`

**Interfaces:**

- Produces `createRemoteTransport(url, { createSocket, identify, isLocalChannel, localInvoke, localSubscribe, stubs, reload })`.
- Returns current `{ invoke, on, remote }` contract.
- Preload wrapper retains `createRemoteTransport(url)` signature.

- [ ] **Step 1: Write browser-codec failing test**

```js
import { afterEach, describe, expect, it } from 'vitest'
import { decode, encode } from './net-codec.js'

const nodeBuffer = globalThis.Buffer
afterEach(() => (globalThis.Buffer = nodeBuffer))

describe('browser codec', () => {
  it('round-trips binary without Node Buffer', () => {
    globalThis.Buffer = undefined
    const bytes = Uint8Array.from([0, 1, 127, 128, 254, 255])
    expect(decode(encode({ bytes }))).toEqual({ bytes })
  })
})
```

- [ ] **Step 2: Verify codec test fails**

Run: `npm run test -- src/shared/net-codec.test.js`

Expected: FAIL at `Buffer.from`.

- [ ] **Step 3: Add browser-safe base64**

```js
function bytesToBase64(value) {
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (globalThis.Buffer) return globalThis.Buffer.from(bytes).toString('base64')
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return globalThis.btoa(binary)
}

function base64ToBytes(value) {
  if (globalThis.Buffer) return Uint8Array.from(globalThis.Buffer.from(value, 'base64'))
  return Uint8Array.from(globalThis.atob(value), (char) => char.charCodeAt(0))
}
```

Use helpers in `encodeVal` and `decodeVal`.

- [ ] **Step 4: Write shared-transport failing tests**

```js
import { describe, expect, it, vi } from 'vitest'
import { createRemoteTransport } from './remote-transport.js'

class FakeSocket {
  readyState = 1
  sent = []
  send(frame) {
    this.sent.push(JSON.parse(frame))
  }
  close() {}
  receive(frame) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
}

function setup(options = {}) {
  let socket
  const transport = createRemoteTransport('ws://host:42069', {
    createSocket: () => (socket = new FakeSocket()),
    identify: async () => ({ version: '0.4.0', dev: false }),
    reload: vi.fn(),
    ...options,
  })
  return { transport, socket: () => socket }
}

describe('remote transport', () => {
  it('queues RPC until hello and resolves response', async () => {
    const { transport, socket } = setup()
    const pending = transport.invoke('packages:list', { direct: true })
    await vi.waitFor(() => expect(socket()).toBeTruthy())
    socket().receive({ t: 'hello', version: '0.4.0', dev: false })
    expect(socket().sent[0]).toMatchObject({ t: 'rpc', channel: 'packages:list' })
    socket().receive({ t: 'ok', id: socket().sent[0].id, result: ['ok'] })
    await expect(pending).resolves.toEqual(['ok'])
  })

  it('routes local channels and stubs', async () => {
    const localInvoke = vi.fn().mockResolvedValue('local')
    const { transport } = setup({
      isLocalChannel: (channel) => channel === 'app:version',
      localInvoke,
      stubs: { 'wizard:browse-vam-dir': { cancelled: true } },
    })
    await expect(transport.invoke('app:version')).resolves.toBe('local')
    await expect(transport.invoke('wizard:browse-vam-dir')).resolves.toEqual({ cancelled: true })
    expect(localInvoke).toHaveBeenCalledWith('app:version', [])
  })
})
```

- [ ] **Step 5: Verify transport test fails**

Run: `npm run test -- src/shared/remote-transport.test.js`

Expected: FAIL because module is absent.

- [ ] **Step 6: Extract Electron-free transport**

Move current socket/RPC state machine into `src/shared/remote-transport.js`. Replace Electron calls with adapters:

```js
export function createRemoteTransport(url, options = {}) {
  const {
    createSocket = (target) => new WebSocket(target),
    identify = async () => ({ version: null, dev: false }),
    isLocalChannel = () => false,
    localInvoke,
    localSubscribe,
    stubs = {},
    reload = () => globalThis.location?.reload(),
  } = options

  function invoke(channel, ...args) {
    if (isLocalChannel(channel)) return localInvoke(channel, args)
    if (Object.hasOwn(stubs, channel)) {
      const value = stubs[channel]
      return Promise.resolve(typeof value === 'function' ? value(...args) : value)
    }
    return remoteInvoke(channel, args)
  }

  function on(channel, callback) {
    let subs = eventSubs.get(channel)
    if (!subs) eventSubs.set(channel, (subs = new Set()))
    subs.add(callback)
    const offLocal = localSubscribe?.(channel, callback) || (() => {})
    return () => {
      subs.delete(callback)
      offLocal()
    }
  }

  Promise.resolve(identify())
    .then(({ version, dev }) => {
      localVersion = version
      localDev = !!dev
    })
    .finally(connect)

  return { invoke, on, remote: { isRemote: true, url, onStatus } }
}
```

Begin with a verbatim copy of `rebuildError` plus the full current `createRemoteTransport` body from `src/preload/remote-transport.js:48`. Remove only Electron import/use, replace socket/local/identity/reload seams with adapters shown above, and use `readyState === 1`. This preserves queue, pending-map, codec, version gate, backoff, event dispatch, and reconnect reload exactly.

Replace preload transport with Electron wrapper:

```js
import { ipcRenderer } from 'electron'
import { createRemoteTransport as createSharedRemoteTransport } from '@shared/remote-transport.js'

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
```

Keep existing `LOCAL_CHANNELS` and `STUBS` unchanged.

- [ ] **Step 7: Verify and commit**

Run: `npm run test -- src/shared/net-codec.test.js src/shared/remote-transport.test.js src/main/remote/channel-policy.test.js`

Expected: PASS.

```bash
git add src/shared/net-codec.js src/shared/net-codec.test.js src/shared/remote-transport.js src/shared/remote-transport.test.js src/preload/remote-transport.js
git commit -m "refactor: share remote transport"
```

---

### Task 2: Shared API facade and Electron adapter

**Files:**

- Create: `src/shared/api.js`
- Create: `src/shared/api.test.js`
- Modify: `src/preload/index.js`

**Interfaces:**

- Produces `createApi({ transport, runtime, getPathForFile, hubWebviewPreload })`.
- Returns all current `window.api` domains plus `runtime`.
- Consumes Task 1 `{ invoke, on, remote }` transport.

- [ ] **Step 1: Write facade failing test**

```js
import { describe, expect, it, vi } from 'vitest'
import { createApi } from './api.js'

describe('createApi', () => {
  it('preserves channel mappings and adapters', async () => {
    const invoke = vi.fn().mockResolvedValue('result')
    const on = vi.fn(() => vi.fn())
    const runtime = { kind: 'web', capabilities: { embeddedHub: false } }
    const api = createApi({
      transport: { invoke, on, remote: { isRemote: true, url: 'ws://host', onStatus: vi.fn() } },
      runtime,
      getPathForFile: () => '',
      hubWebviewPreload: null,
    })
    await api.packages.list({ direct: true })
    api.onPackagesUpdated(vi.fn())
    expect(invoke).toHaveBeenCalledWith('packages:list', { direct: true })
    expect(on).toHaveBeenCalledWith('packages:updated', expect.any(Function))
    expect(api.runtime).toBe(runtime)
    expect(api.packages.getPathForFile({})).toBe('')
    expect(api.app.hubWebviewPreload).toBeNull()
  })
})
```

- [ ] **Step 2: Verify failure**

Run: `npm run test -- src/shared/api.test.js`

Expected: FAIL because module is absent.

- [ ] **Step 3: Move API object into factory**

Create `src/shared/api.js` by moving the complete API object literal from `src/preload/index.js:28` through its closing brace before the main-log section. Wrap that literal in:

```js
export function createApi({ transport, runtime, getPathForFile, hubWebviewPreload }) {
  const invoke = transport.invoke
  const api = /* exact moved object literal */
  return { ...api, runtime }
}
```

The comment marks a mechanical cut/paste location in this plan, not generated source. Actual source contains the complete literal there with no comment. Default `getPathForFile` to `() => ''` and `hubWebviewPreload` to `null` in the parameter destructuring. Make only four substitutions inside the literal:

- `webUtils.getPathForFile(file)` becomes `getPathForFile(file)`.
- computed Hub preload URL becomes `hubWebviewPreload`.
- `transport.remote` continues supplying `isRemote`, `url`, and `onStatus`.
- `transport.on` continues supplying every event helper.

No domain, method signature, invoke channel, argument shape, or convenience event method changes.

Update preload:

```js
import { createApi } from '@shared/api.js'

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
```

Keep log forwarding, online notification, and `contextBridge` exposure in preload.

- [ ] **Step 4: Verify and commit**

Run: `npm run test -- src/shared/api.test.js src/shared/remote-transport.test.js`

Run: `npm run build`

Expected: PASS.

```bash
git add src/shared/api.js src/shared/api.test.js src/preload/index.js
git commit -m "refactor: share renderer api"
```

---

### Task 3: Same-port HTTP renderer and WebSocket listener

**Files:**

- Create: `src/main/remote/http-server.js`
- Create: `src/main/remote/http-server.test.js`
- Modify: `src/main/remote/server.js`

**Interfaces:**

- Produces `createRemoteHttpServer(rendererRoot)` returning `{ server, wss }`.
- `startServer(port, { rendererRoot } = {})` retains existing callers.
- `getStatus()` reports actual port for test port `0`.

- [ ] **Step 1: Write failing HTTP/WebSocket tests**

Use temporary renderer files and a port-0 listener:

```js
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createRemoteHttpServer } from './http-server.js'

let root
let server
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'vam-backstage-web-'))
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'index.html'), '<main>backstage</main>')
  await writeFile(join(root, 'assets/app.js'), 'export default true')
})
afterEach(async () => {
  await new Promise((resolve) => server?.close(resolve))
  await rm(root, { recursive: true, force: true })
})

async function start() {
  const created = createRemoteHttpServer(root)
  server = created.server
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { ...created, port: server.address().port }
}

describe('remote HTTP listener', () => {
  it('serves index, asset, HEAD, cache, and SPA fallback', async () => {
    const { port } = await start()
    const base = `http://127.0.0.1:${port}`
    expect(await (await fetch(`${base}/`)).text()).toContain('backstage')
    const asset = await fetch(`${base}/assets/app.js`)
    expect(asset.headers.get('content-type')).toContain('javascript')
    expect(asset.headers.get('cache-control')).toContain('immutable')
    expect((await fetch(`${base}/library`)).status).toBe(200)
    expect((await fetch(`${base}/`, { method: 'HEAD' })).status).toBe(200)
  })

  it('rejects bad methods, missing assets, and traversal', async () => {
    const { port } = await start()
    const base = `http://127.0.0.1:${port}`
    expect((await fetch(base, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404)
    expect((await fetch(`${base}/%5c..%5csecret.txt`)).status).toBe(403)
  })

  it('accepts WebSocket on same listener', async () => {
    const { port, wss } = await start()
    const connected = new Promise((resolve) => wss.once('connection', resolve))
    const socket = new WebSocket(`ws://127.0.0.1:${port}`)
    await connected
    socket.close()
  })
})
```

Also test absent renderer root returns `503`.

- [ ] **Step 2: Verify failure**

Run: `npm run test -- src/main/remote/http-server.test.js`

Expected: FAIL because module is absent.

- [ ] **Step 3: Implement listener**

Create `src/main/remote/http-server.js` with Node `createServer`, `stat`, `createReadStream`, path containment, MIME map, and:

```js
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { createServer } from 'http'
import { extname, resolve, sep } from 'path'
import { WebSocketServer } from 'ws'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

export function createRemoteHttpServer(rendererRoot) {
  const root = resolve(rendererRoot)
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end()
      return
    }

    let pathname
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    } catch {
      response.writeHead(400).end('Bad request')
      return
    }

    const relative = pathname.replace(/^\/+/, '').replaceAll('/', sep) || 'index.html'
    let target = resolve(root, relative)
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end('Forbidden')
      return
    }

    let info
    try {
      info = await stat(target)
    } catch {
      if (extname(relative)) {
        response.writeHead(404).end('Not found')
        return
      }
      target = resolve(root, 'index.html')
      try {
        info = await stat(target)
      } catch {
        response.writeHead(503).end('Renderer build unavailable. Run npm run build.')
        return
      }
    }

    if (!info.isFile()) {
      response.writeHead(404).end('Not found')
      return
    }

    response.setHeader('Content-Type', TYPES[extname(target).toLowerCase()] || 'application/octet-stream')
    response.setHeader('Content-Length', info.size)
    response.setHeader(
      'Cache-Control',
      relative.startsWith(`assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    )
    response.writeHead(200)
    if (request.method === 'HEAD') response.end()
    else
      createReadStream(target)
        .on('error', () => response.destroy())
        .pipe(response)
  })

  return { server, wss: new WebSocketServer({ server }) }
}
```

MIME map: html, js, css, json, png, jpg/jpeg, svg, ico, woff, woff2, map; unknown uses `application/octet-stream`.

- [ ] **Step 4: Integrate existing server lifecycle**

In `server.js`, call `createRemoteHttpServer(join(__dirname, '../renderer'))`, attach current connection callback to returned `wss`, then call `server.listen(port, '0.0.0.0')`. Store both `httpServer` and `wss`. On listening, set `currentPort = server.address().port`. `stopServer()` closes clients, WSS, HTTP listener, then clears state.

- [ ] **Step 5: Verify and commit**

Run: `npm run test -- src/main/remote/http-server.test.js src/main/remote/channel-policy.test.js`

Expected: PASS.

```bash
git add src/main/remote/http-server.js src/main/remote/http-server.test.js src/main/remote/server.js
git commit -m "feat: serve renderer over intranet"
```

---

### Task 4: Browser API bootstrap

**Files:**

- Create: `src/renderer/src/browser-api.js`
- Create: `src/renderer/src/browser-api.test.js`
- Modify: `src/renderer/src/main.jsx`

**Interfaces:**

- Produces `browserWebSocketUrl(location)` and `createBrowserApi(options)`.
- Consumes Tasks 1-2 shared transport/API.
- Installs `window.api` before React mounts.

- [ ] **Step 1: Write failing browser-adapter test**

```js
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
    expect(Object.values(api.runtime.capabilities)).not.toContain(true)
    await expect(api.wizard.browseVamDir()).resolves.toEqual({ cancelled: true })
    await expect(api.hub.isLoggedIn()).resolves.toBe(false)
    await expect(api.updater.check()).resolves.toMatchObject({ ok: false })
  })
})
```

- [ ] **Step 2: Verify failure**

Run: `npm run test -- src/renderer/src/browser-api.test.js`

Expected: FAIL because module is absent.

- [ ] **Step 3: Implement browser API**

```js
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
    'hub:isLoggedIn': false,
    'hub:resourceUserState': null,
    'hub:toggleFavorite': unavailable,
    'hub:toggleBookmark': unavailable,
    'hub:toggleRate': unavailable,
    'hub:toggleLike': unavailable,
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
        embeddedHub: false,
        hubAccountActions: false,
        nativeDialogs: false,
        revealInFolder: false,
        updater: false,
        serverControl: false,
        developerTools: false,
      },
    },
  })
}
```

- [ ] **Step 4: Bootstrap before React**

Refactor `main.jsx`:

```jsx
async function start() {
  if (!window.api) {
    const { createBrowserApi } = await import('./browser-api.js')
    window.api = createBrowserApi()
  }
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

start().catch((error) => {
  console.error(error)
  document.getElementById('root').textContent = `VaM Backstage failed to start: ${error.message}`
})
```

- [ ] **Step 5: Verify and commit**

Run: `npm run test -- src/renderer/src/browser-api.test.js src/shared/api.test.js src/shared/remote-transport.test.js`

Run: `npm run build`

Expected: PASS; renderer resolves no Electron module.

```bash
git add src/renderer/src/browser-api.js src/renderer/src/browser-api.test.js src/renderer/src/main.jsx
git commit -m "feat: bootstrap browser client"
```

---

### Task 5: Capability-gated renderer

**Files:**

- Create: `src/renderer/src/runtime-ui.test.js`
- Modify: `src/renderer/src/App.jsx`
- Modify: `src/renderer/src/components/HubDetail.jsx`
- Modify: `src/renderer/src/components/StatusBar.jsx`
- Modify: `src/renderer/src/components/FileTreeDialog.jsx`
- Modify: `src/renderer/src/views/ContentView.jsx`
- Modify: `src/renderer/src/views/SettingsView.jsx`

**Interfaces:**

- Consumes `window.api.runtime.capabilities`.
- Desktop true branches retain current behavior and JSX.

- [ ] **Step 1: Write failing source-level gate test**

```js
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const read = (path) => readFileSync(resolve(import.meta.dirname, path), 'utf8')
const app = read('App.jsx')
const hub = read('components/HubDetail.jsx')
const status = read('components/StatusBar.jsx')
const settings = read('views/SettingsView.jsx')
const files = read('components/FileTreeDialog.jsx')
const content = read('views/ContentView.jsx')

describe('runtime gates', () => {
  it('gates setup, escape, and Hub', () => {
    expect(app).toContain('capabilities.nativeDialogs')
    expect(app).toContain('capabilities.serverControl')
    expect(app).toContain('Complete setup on the host desktop')
    expect(hub).toContain('capabilities.embeddedHub')
    expect(hub).toContain('capabilities.hubAccountActions')
    expect(hub).toContain('Open Hub page')
  })

  it('gates updater, settings, developer, and reveal actions', () => {
    expect(status).toContain('capabilities.updater')
    expect(settings).toContain('capabilities.nativeDialogs')
    expect(settings).toContain('capabilities.serverControl')
    expect(settings).toContain('capabilities.developerTools')
    expect(files).toContain('capabilities.revealInFolder')
    expect(content).toContain('capabilities.revealInFolder')
  })
})
```

- [ ] **Step 2: Verify failure**

Run: `npm run test -- src/renderer/src/runtime-ui.test.js`

Expected: FAIL.

- [ ] **Step 3: Gate App startup and escape**

Read `const capabilities = window.api.runtime.capabilities`. Render current `FirstRun` only with `nativeDialogs`; otherwise render a blocking `HostSetupRequired` modal saying “Complete setup on the host desktop” with Reload. In `RemoteGate`, show “Switch to local mode” only with `serverControl`.

- [ ] **Step 4: Gate Hub account and webview behavior**

In `HubDetail`:

```js
const { embeddedHub, hubAccountActions } = window.api.runtime.capabilities
const interactions = useHubInteractions(resourceId, {
  enabled: HUB_INTERACTIONS_ENABLED && hubAccountActions,
})
```

When `hubAccountActions` is false, keep rating/like counts as plain non-interactive values; hide favorite/bookmark controls and sign-in hints. Wrap the existing JSX block beginning at `/* Right: Webview browser` and ending before the outer detail-panel closing tags in an `embeddedHub` conditional. Preserve that block verbatim as the true branch; use this exact false branch:

```jsx
<div className="flex-1 flex items-center justify-center bg-base p-8">
  <div className="max-w-sm text-center space-y-4">
    <Globe size={32} className="mx-auto text-text-tertiary" />
    <div className="text-sm font-medium text-text-primary">Hub page opens in your browser</div>
    <Button onClick={() => void window.api.shell.openExternal(fullBrowserUrl)}>
      <ExternalLink size={14} /> Open Hub page
    </Button>
  </div>
</div>
```

- [ ] **Step 5: Gate updater and reveal actions**

`StatusBar`: skip updater subscriptions/calls when `updater` is false; show plain version label. `FileTreeDialog` and `ContentView`: render reveal buttons only with `revealInFolder`.

- [ ] **Step 6: Gate Settings**

Bind `const capabilities = window.api.runtime.capabilities`, then:

- Call updater/developer/Hub-session APIs only when corresponding capability is true.
- Show VaM Browse and Add Folder only with `nativeDialogs`.
- Show remote preference and Remote Access only with `serverControl`.
- Define `showDevSection = capabilities.developerTools && (isDev || developerUnlocked)`.
- Show application-folder reveal only with `revealInFolder`.
- Preserve safe host-backed settings, scans, integrity, library rows, labels, UI preferences.

- [ ] **Step 7: Verify and commit**

Run: `npm run test -- src/renderer/src/runtime-ui.test.js src/renderer/src/lib/mouse-page-nav.test.js`

Run: `npm run build`

Expected: PASS.

```bash
git add src/renderer/src/App.jsx src/renderer/src/components/HubDetail.jsx src/renderer/src/components/StatusBar.jsx src/renderer/src/components/FileTreeDialog.jsx src/renderer/src/views/ContentView.jsx src/renderer/src/views/SettingsView.jsx src/renderer/src/runtime-ui.test.js
git commit -m "feat: adapt ui for browser runtime"
```

---

### Task 6: Documentation and completion verification

**Files:**

- Modify: `README.md`
- Modify: `docs/Implementation.md`
- Modify design spec only if implemented names differ.

**Interfaces:**

- Documents browser URL, supported scope, lifecycle, and trust model.

- [ ] **Step 1: Document browser use**

Add:

```markdown
### Intranet browser access

Enable Remote Access in Settings and start the server. Open `http://<host-ip>:42069` in a desktop browser on the same trusted network. The desktop app may stay open as the host, or the packaged executable may run headlessly with `--serve`.

Browser clients support library/content management, scans, downloads, labels, Hub search/install, and `.var` upload. Hub pages open in a normal tab. Native folder selection, Explorer reveal, updates, server controls, developer tools, and Hub account actions remain in Electron.

Remote Access has no authentication. Every device reaching the port can modify the library; use only on a trusted intranet.
```

Update `docs/Implementation.md` architecture and remote sections: shared HTTP/WebSocket listener, shared API factory, runtime capabilities, browser exclusions.

- [ ] **Step 2: Run source checks**

Run: `rg -n "http://<host-ip>:42069|no authentication|runtime capabilities|HTTP" README.md docs/Implementation.md`

Run: `git diff --check`

Expected: relevant hits; no whitespace errors.

- [ ] **Step 3: Run full automated verification**

```bash
npm run lint
npm run format:check
npm run test
npm run build
```

Expected: every command exits 0.

- [ ] **Step 4: Smoke windowed host**

Start Electron with Remote Access enabled. Open reported HTTP URL in Chrome or Edge. Verify same Library data, navigation, labels, scans, Hub search/install, downloads/events, normal-tab Hub page, hidden native controls, and reconnect reload.

- [ ] **Step 5: Smoke headless host**

Run packaged/unpacked executable with `--serve`. Open HTTP URL. Verify site without Electron window, Library/download events, chunked `.var` import, and port release after shutdown.

- [ ] **Step 6: Commit docs**

```bash
git add README.md docs/Implementation.md docs/superpowers/specs/2026-07-20-intranet-web-ui-design.md
git commit -m "docs: explain intranet browser access"
```

- [ ] **Step 7: Completion audit**

```bash
git status --short --branch
git log --oneline --decorate -10
```

Expected: clean `feature/intranet-web-ui`; implementation commits follow design/plan commits. Check every Included item and manual-smoke row in design spec against current source and direct command/runtime evidence. Missing evidence means incomplete.
