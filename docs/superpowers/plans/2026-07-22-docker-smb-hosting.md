# Docker SMB Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing Electron-backed VaM Backstage server in Docker on Ubuntu while reading and mutating a Windows-hosted VaM folder through a host-mounted SMB share.

**Architecture:** The packaged Linux Electron application runs under Xvfb in one unprivileged container and serves the existing React client, WebSocket RPC, and Hub proxy. Ubuntu mounts SMB at `/mnt/vam`; Compose bind-mounts it at `/vam`, while a separate `/data` volume owns SQLite, caches, and Electron session data. Explicit environment configuration selects the VaM root and manual-refresh mode; a shared storage status gate blocks browser use when the share is absent.

**Tech Stack:** JavaScript, Electron 39, React 19, Vitest, `better-sqlite3`, Docker, Docker Compose, Xvfb, Ubuntu CIFS.

## Global Constraints

- Keep the existing trusted-intranet, no-authentication model.
- Use one Backstage container; browsers are clients and no frontend container is added.
- Keep SQLite, thumbnail/avatar caches, and Hub session data under `/data`, never SMB.
- Mount SMB on Ubuntu and bind-mount `/mnt/vam:/vam:rw`; do not mount SMB inside the container.
- Use `VAM_SERVE=42069`, `VAM_DIR=/vam`, `VAM_USER_DATA=/data`, and `VAM_STORAGE_MODE=manual` in Docker.
- Publish app/WebSocket port `42069` and Hub proxy port `42070`.
- Disable `@parcel/watcher` only in explicit manual mode; desktop watcher behavior stays unchanged.
- Block the application when `/vam` or `/vam/AddonPackages` is unavailable; do not provide offline browsing in this POC.
- Reuse the existing scanner, notifications, status bar, Settings rescan, React application, and RPC protocol.
- Add no runtime JavaScript dependency.
- Keep JavaScript style: single quotes, no semicolons, 2-space indentation, `printWidth: 120`.

## File Structure

- Create `src/main/runtime-config.js`: parse and apply Docker environment configuration before Electron initializes user data and after SQLite opens.
- Create `src/main/runtime-config.test.js`: prove environment override and mode behavior without starting Electron.
- Create `src/main/vam-storage.js`: own current VaM storage status, live filesystem checks, unavailable errors, and storage-dependent RPC classification.
- Create `src/main/vam-storage.test.js`: prove mounted, empty, unreadable, unwritable, and desktop-watch behavior.
- Modify `src/main/index.js`: apply runtime paths, seed the configured VaM root, skip watcher work in manual mode, and avoid startup scans against an absent share.
- Modify `src/main/ipc/index.js`: expose `storage:status` through the existing captured IPC/RPC registry.
- Modify `src/main/ipc/scanner.js`: reuse storage checks for manual rescans and skip watcher restart in manual mode.
- Modify `src/main/remote/server.js`: turn storage-related handler failures into a shared `storage:changed` event and fast-fail while the known share state is unavailable.
- Modify `src/shared/api.js`: expose `storage.status()` and `onStorageChanged()` to Electron and browser renderers.
- Create `src/renderer/src/components/StorageGate.jsx`: block the application, report the mounted path/error, and retry with a full scan.
- Modify `src/renderer/src/App.jsx`: keep the connection gate mounted while putting the application shell behind `StorageGate`.
- Modify `src/renderer/src/components/StatusBar.jsx`: show a compact manual Rescan button only for browser/manual mode.
- Modify `src/renderer/src/views/SettingsView.jsx`: show the server-selected manual refresh mode beside library controls.
- Modify `src/renderer/src/runtime-ui.test.js`: verify storage blocker and manual refresh UI seams.
- Create `Dockerfile`: build the Linux unpacked application and run it under Xvfb as an unprivileged user.
- Create `.dockerignore`: exclude host build outputs, dependencies, Git data, and local VaM data.
- Create `docker-compose.yml`: publish both ports and mount `/vam` plus persistent `/data`.
- Create `docs/docker-smb-hosting.md`: document Windows sharing, Ubuntu CIFS mounting, permissions, Compose startup, recovery, and validation.
- Modify `README.md`: link the Docker/SMB deployment guide.

---

### Task 1: Runtime Environment Configuration

**Files:**

- Create: `src/main/runtime-config.js`
- Create: `src/main/runtime-config.test.js`
- Modify: `src/main/index.js`

**Interfaces:**

- Produces: `configureUserDataPath(electronApp, env) -> string|null`
- Produces: `applyVamDirOverride(setSettingFn, env) -> string|null`
- Produces: `isManualStorageMode(env) -> boolean`
- Consumes later: `isManualStorageMode()` in startup scanning, scanner IPC, and storage checks.

- [ ] **Step 1: Write failing runtime configuration tests**

```js
import { constants } from 'fs'
import { resolve } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { applyVamDirOverride, configureUserDataPath, isManualStorageMode } from './runtime-config.js'

describe('runtime config', () => {
  it('configures one writable Electron user-data root', () => {
    const app = { setPath: vi.fn() }
    const mkdir = vi.fn()
    const access = vi.fn()

    expect(configureUserDataPath(app, { VAM_USER_DATA: '/data' }, { mkdirSync: mkdir, accessSync: access })).toBe(
      resolve('/data'),
    )
    expect(mkdir).toHaveBeenCalledWith(resolve('/data'), { recursive: true })
    expect(access).toHaveBeenCalledWith(resolve('/data'), constants.R_OK | constants.W_OK)
    expect(app.setPath).toHaveBeenCalledWith('userData', resolve('/data'))
  })

  it('leaves normal Electron user data unchanged without an override', () => {
    const app = { setPath: vi.fn() }
    expect(configureUserDataPath(app, {})).toBeNull()
    expect(app.setPath).not.toHaveBeenCalled()
  })

  it('makes VAM_DIR authoritative and completes host setup', () => {
    const set = vi.fn()
    expect(applyVamDirOverride(set, { VAM_DIR: '/vam' })).toBe(resolve('/vam'))
    expect(set).toHaveBeenNthCalledWith(1, 'vam_dir', resolve('/vam'))
    expect(set).toHaveBeenNthCalledWith(2, 'initial_scan_done', '1')
  })

  it('selects manual mode only when explicitly configured', () => {
    expect(isManualStorageMode({ VAM_STORAGE_MODE: 'manual' })).toBe(true)
    expect(isManualStorageMode({ VAM_STORAGE_MODE: 'watch' })).toBe(false)
    expect(isManualStorageMode({})).toBe(false)
  })
})
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- src/main/runtime-config.test.js`

Expected: FAIL because `src/main/runtime-config.js` does not exist.

- [ ] **Step 3: Implement the runtime configuration module**

```js
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
```

- [ ] **Step 4: Wire configuration into Electron startup**

Import the helpers in `src/main/index.js`:

```js
import { applyVamDirOverride, configureUserDataPath, isManualStorageMode } from './runtime-config.js'
```

Replace the current development-only user-data override with:

```js
const configuredUserData = configureUserDataPath(app)
if (!configuredUserData && process.env.VAM_DEV_USERDATA) {
  app.setPath('userData', app.getPath('userData') + '-dev')
}
```

Immediately after `openDatabase()` in `initBackend()`, apply the authoritative VaM directory:

```js
openDatabase()
applyVamDirOverride(setSetting)
```

Skip watcher warm-up in manual mode:

```js
if (!IS_CLIENT && !isManualStorageMode()) warmFileWatcherBackend()
```

- [ ] **Step 5: Run the focused test and existing CLI tests**

Run: `npm test -- src/main/runtime-config.test.js src/main/remote/cli*.test.js`

Expected: runtime configuration tests PASS; any matched existing CLI tests PASS.

- [ ] **Step 6: Commit runtime configuration**

```text
git add src/main/runtime-config.js src/main/runtime-config.test.js src/main/index.js
git commit -m "feat: configure Docker runtime paths"
```

---

### Task 2: Storage Health, Scan Guard, and RPC Events

**Files:**

- Create: `src/main/vam-storage.js`
- Create: `src/main/vam-storage.test.js`
- Modify: `src/main/index.js`
- Modify: `src/main/ipc/index.js`
- Modify: `src/main/ipc/scanner.js`
- Modify: `src/main/remote/server.js`
- Modify: `src/main/remote/server.test.js`
- Modify: `src/shared/api.js`

**Interfaces:**

- Consumes: `isManualStorageMode(env)` from Task 1.
- Produces: `checkVamStorage(vamDir, options) -> Promise<{ required, mode, available, path, error }>`.
- Produces: `getVamStorageStatus() -> { required, mode, available, path, error }`.
- Produces: `storageChannelUsesVam(channel) -> boolean`.
- Produces: renderer API `window.api.storage.status()` and event `window.api.onStorageChanged(callback)`.

- [ ] **Step 1: Write failing storage health tests**

```js
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
```

- [ ] **Step 2: Run the storage tests and verify failure**

Run: `npm test -- src/main/vam-storage.test.js`

Expected: FAIL because `src/main/vam-storage.js` does not exist.

- [ ] **Step 3: Implement storage status and checks**

```js
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
```

- [ ] **Step 4: Expose live storage status through existing IPC/RPC**

In `src/main/ipc/index.js`, import `checkVamStorage` and register:

```js
ipcMain.handle('storage:status', async () => checkVamStorage(getSetting('vam_dir')))
```

In `src/shared/api.js`, add:

```js
storage: {
  status: () => invoke('storage:status'),
},
```

Add the event convenience method beside existing subscriptions:

```js
onStorageChanged: (cb) => transport.on('storage:changed', (data) => cb(data)),
```

- [ ] **Step 5: Guard rescans and watcher restart**

In `src/main/ipc/scanner.js`, import the storage helpers and manual-mode check. Before `runScan` in `scan:start`, run:

```js
import { checkVamStorage, storageUnavailableError } from '../vam-storage.js'
import { isManualStorageMode } from '../runtime-config.js'
```

```js
const storage = await checkVamStorage(vamDir)
if (!storage.available) {
  notify('storage:changed', storage)
  throw storageUnavailableError(storage)
}
```

Wrap the scan so a lost share updates the gate:

```js
let result
try {
  result = await runScan(vamDir, (progress) => notify('scan:progress', progress))
} catch (error) {
  const storage = await checkVamStorage(vamDir)
  if (!storage.available) notify('storage:changed', storage)
  throw error
}
```

Replace unconditional watcher restart with:

```js
if (!isManualStorageMode()) startWatcher(vamDir)
```

- [ ] **Step 6: Guard startup scanning and watcher creation**

In `startupScan()` in `src/main/index.js`, check manual storage before clearing rescan state or calling `runScan`:

Add the storage import beside the runtime configuration import:

```js
import { checkVamStorage } from './vam-storage.js'
```

```js
const storage = await checkVamStorage(vamDir)
if (!storage.available) {
  console.warn(`[storage] ${storage.error}`)
  return
}
```

In the `finally` block, start the watcher only in watch mode:

```js
if (vamDir && getSetting('initial_scan_done') && !isManualStorageMode()) branches.push(startWatcher(vamDir))
```

- [ ] **Step 7: Make remote handler failures update and enforce storage state**

In `src/main/remote/server.js`, import:

```js
import { checkVamStorage, getVamStorageStatus, storageChannelUsesVam, storageUnavailableError } from '../vam-storage.js'
import { isManualStorageMode } from '../runtime-config.js'
```

Before invoking a storage-backed handler in `handleMessage`, fast-fail only when the cached manual status is unavailable:

```js
if (isManualStorageMode() && storageChannelUsesVam(channel)) {
  const storage = getVamStorageStatus()
  if (!storage.available) {
    sendError(ws, id, storageUnavailableError(storage))
    return
  }
}
```

Inside the handler `catch`, recheck storage after a storage-backed failure and broadcast the result if unavailable:

```js
} catch (err) {
  if (isManualStorageMode() && storageChannelUsesVam(channel)) {
    const storage = await checkVamStorage(getSetting('vam_dir'))
    if (!storage.available) broadcast('storage:changed', storage)
  }
  sendError(ws, id, err)
  return
}
```

- [ ] **Step 8: Extend remote server source coverage**

Add assertions to `src/main/remote/server.test.js`:

```js
expect(source).toContain('storageChannelUsesVam(channel)')
expect(source).toContain("broadcast('storage:changed', storage)")
expect(source).toContain('storageUnavailableError(storage)')
```

- [ ] **Step 9: Run focused storage, scanner-adjacent, and server tests**

Run: `npm test -- src/main/vam-storage.test.js src/main/remote/server.test.js src/main/remote/channel-policy.test.js`

Expected: all focused tests PASS.

- [ ] **Step 10: Commit storage health**

```text
git add src/main/vam-storage.js src/main/vam-storage.test.js src/main/index.js src/main/ipc/index.js src/main/ipc/scanner.js src/main/remote/server.js src/main/remote/server.test.js src/shared/api.js
git commit -m "feat: gate unavailable VaM storage"
```

---

### Task 3: Browser Storage Blocker and Manual Rescan Controls

**Files:**

- Create: `src/renderer/src/components/StorageGate.jsx`
- Modify: `src/renderer/src/App.jsx`
- Modify: `src/renderer/src/components/StatusBar.jsx`
- Modify: `src/renderer/src/views/SettingsView.jsx`
- Modify: `src/renderer/src/runtime-ui.test.js`

**Interfaces:**

- Consumes: `window.api.storage.status()` and `window.api.onStorageChanged(callback)` from Task 2.
- Produces: `StorageGate({ children })`, which mounts children only when storage is usable or not required.
- Reuses: `window.api.scan.start()`, existing `scan:progress`, Settings scan behavior, `Button`, and status bar layout.

- [ ] **Step 1: Write failing UI seam tests**

In `src/renderer/src/runtime-ui.test.js`, read `components/StorageGate.jsx` and add:

```js
const storage = read('components/StorageGate.jsx')

it('blocks unavailable manual storage and retries with a scan', () => {
  expect(app).toContain('<StorageGate>')
  expect(storage).toContain('window.api.storage.status()')
  expect(storage).toContain('window.api.scan.start()')
  expect(storage).toContain('window.api.onStorageChanged')
  expect(storage).toContain('VaM storage unavailable')
  expect(storage).toContain('Retry')
})

it('shows manual rescan controls only for web manual mode', () => {
  expect(status).toContain("window.api.runtime.kind === 'web'")
  expect(status).toContain("storage?.mode === 'manual'")
  expect(status).toContain('Rescan shared VaM folder')
  expect(settings).toContain('Manual rescan')
})
```

- [ ] **Step 2: Run UI seam tests and verify failure**

Run: `npm test -- src/renderer/src/runtime-ui.test.js`

Expected: FAIL because `StorageGate.jsx` and manual controls do not exist.

- [ ] **Step 3: Implement the application storage gate**

Create `src/renderer/src/components/StorageGate.jsx`:

```jsx
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function StorageGate({ children }) {
  const [storage, setStorage] = useState(null)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState(null)

  const refreshStatus = useCallback(async () => {
    const next = await window.api.storage.status()
    setStorage(next)
    return next
  }, [])

  useEffect(() => {
    void refreshStatus().catch((error) => setRetryError(error.message))
    return window.api.onStorageChanged(setStorage)
  }, [refreshStatus])

  const retry = useCallback(async () => {
    if (retrying) return
    setRetrying(true)
    setRetryError(null)
    try {
      const next = await refreshStatus()
      if (!next.available) return
      await window.api.scan.start()
      await refreshStatus()
    } catch (error) {
      setRetryError(error.message)
    } finally {
      setRetrying(false)
    }
  }, [refreshStatus, retrying])

  if (storage && (!storage.required || storage.available)) return children

  return (
    <div className="h-full bg-base flex items-center justify-center p-6">
      {storage ? (
        <section className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 text-center shadow-xl">
          <AlertTriangle size={36} className="mx-auto mb-4 text-warning" aria-hidden />
          <h1 className="text-lg font-semibold text-text-primary">VaM storage unavailable</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Restore the Windows share mounted at <span className="font-mono select-text">{storage.path || '/vam'}</span>
            .
          </p>
          <p className="mt-2 text-xs text-error break-words select-text">{retryError || storage.error}</p>
          <Button className="mt-5" onClick={retry} disabled={retrying}>
            {retrying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {retrying ? 'Checking…' : 'Retry'}
          </Button>
        </section>
      ) : (
        <Loader2 size={22} className="animate-spin text-accent-blue" aria-label="Checking VaM storage" />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Put the existing application shell behind the gate**

In `src/renderer/src/App.jsx`, import `StorageGate`, rename the current component body to `AppShell`, and add this default wrapper:

```jsx
export default function App() {
  return (
    <>
      <RemoteGate />
      <StorageGate>
        <AppShell />
      </StorageGate>
    </>
  )
}

function AppShell() {
```

Remove the two existing `<RemoteGate />` instances from the loading branch and application shell so exactly one connection gate remains mounted outside `StorageGate`.

- [ ] **Step 5: Add compact status-bar rescan control**

In `StatusBar`, add storage state and load it once:

```jsx
const [storage, setStorage] = useState(null)
const [manualScanning, setManualScanning] = useState(false)

useEffect(() => {
  void window.api.storage
    .status()
    .then(setStorage)
    .catch(() => {})
  return window.api.onStorageChanged(setStorage)
}, [])
```

Add the handler:

```jsx
const handleManualRescan = async () => {
  if (manualScanning || scan) return
  setManualScanning(true)
  try {
    await window.api.scan.start()
  } catch (error) {
    toast(`Scan failed: ${error.message}`, 'error', 6000)
  } finally {
    setManualScanning(false)
  }
}
```

Before `RemoteStatusIndicator`, render:

```jsx
{
  window.api.runtime.kind === 'web' && storage?.mode === 'manual' && (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={handleManualRescan}
          disabled={manualScanning || !!scan}
          aria-label="Rescan shared VaM folder"
        >
          {manualScanning || scan ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Rescan
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">Rescan shared VaM folder</TooltipContent>
    </Tooltip>
  )
}
```

- [ ] **Step 6: Explain manual mode in Settings**

Add storage state beside the existing Settings state and subscribe to status changes:

```jsx
const [storage, setStorage] = useState(null)

useEffect(() => {
  void window.api.storage
    .status()
    .then(setStorage)
    .catch(() => {})
  return window.api.onStorageChanged(setStorage)
}, [])
```

Then render this line above the scan buttons:

```jsx
{
  storage?.mode === 'manual' && (
    <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
      <RefreshCw size={12} />
      Filesystem updates: Manual rescan (server configured)
    </div>
  )
}
```

Do not add a toggle; Docker configuration is authoritative.

- [ ] **Step 7: Run focused UI and shared API tests**

Run: `npm test -- src/renderer/src/runtime-ui.test.js src/renderer/src/browser-api.test.js src/shared/api.test.js`

Expected: all matched tests PASS.

- [ ] **Step 8: Commit storage UI**

```text
git add src/renderer/src/components/StorageGate.jsx src/renderer/src/App.jsx src/renderer/src/components/StatusBar.jsx src/renderer/src/views/SettingsView.jsx src/renderer/src/runtime-ui.test.js
git commit -m "feat: show manual storage recovery"
```

---

### Task 4: Docker Image and Compose Deployment

**Files:**

- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.yml`

**Interfaces:**

- Consumes: existing `npm run build:unpack`, Linux `dist/linux-unpacked/vam-backstage`, and Task 1 environment variables.
- Produces: one `vam-backstage` service exposing ports `42069` and `42070`, `/vam` bind mount, and `/data` named volume.

- [ ] **Step 1: Create a minimal Docker build context**

Create `.dockerignore`:

```text
.git
.github
.agents
.codex
.cursor
node_modules
dist
out
.eslintcache
VaM
*.log*
*.tar.gz
```

- [ ] **Step 2: Create the multi-stage Electron/Xvfb image**

Create `Dockerfile`:

```dockerfile
FROM node:24-bookworm AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:unpack

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        libasound2 \
        libatspi2.0-0 \
        libgbm1 \
        libgtk-3-0 \
        libnotify4 \
        libnss3 \
        libsecret-1-0 \
        libxss1 \
        libxtst6 \
        xauth \
        xdg-utils \
        xvfb \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 backstage \
    && mkdir -p /data /vam \
    && chown -R backstage:backstage /data /vam

COPY --from=build /app/dist/linux-unpacked /opt/vam-backstage

USER backstage
ENV VAM_SERVE=42069 \
    VAM_DIR=/vam \
    VAM_USER_DATA=/data \
    VAM_STORAGE_MODE=manual

EXPOSE 42069 42070
ENTRYPOINT ["xvfb-run", "-a", "/opt/vam-backstage/vam-backstage", "--no-sandbox"]
```

- [ ] **Step 3: Create Compose configuration**

Create `docker-compose.yml`:

```yaml
services:
  backstage:
    build: .
    restart: unless-stopped
    ports:
      - '42069:42069'
      - '42070:42070'
    volumes:
      - '${VAM_MOUNT:-/mnt/vam}:/vam:rw'
      - 'backstage-data:/data'

volumes:
  backstage-data:
```

- [ ] **Step 4: Validate Compose interpolation and Dockerfile formatting**

Run: `docker compose config`

Expected: one `backstage` service, published ports `42069` and `42070`, `/mnt/vam:/vam:rw`, and named volume mounted at `/data`.

Run: `docker build --check .`

Expected: build checks complete without Dockerfile warnings or errors.

- [ ] **Step 5: Build the container image**

Run: `docker compose build`

Expected: `npm ci`, `npm run build:unpack`, and the runtime image complete successfully with Linux unpacked Electron output copied to `/opt/vam-backstage`.

- [ ] **Step 6: Commit Docker deployment artifacts**

```text
git add Dockerfile .dockerignore docker-compose.yml
git commit -m "build: add Docker server image"
```

---

### Task 5: Ubuntu SMB Guide and End-to-End Verification

**Files:**

- Create: `docs/docker-smb-hosting.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: the Task 4 Compose service and fixed container UID/GID `1000:1000`.
- Produces: exact host setup, startup, recovery, log, update, backup, and smoke-test commands.

- [ ] **Step 1: Write the deployment guide**

Create `docs/docker-smb-hosting.md` with these exact sections and commands:

````markdown
# Docker with a Windows VaM Share

VaM stays on Windows. Ubuntu mounts the complete shared VaM folder, then Docker bind-mounts it into Backstage. Backstage metadata stays in a local Docker volume.

## 1. Share the VaM folder on Windows

Share the complete VaM directory with a Windows account that has read and write access. Record the Windows host name or IP, share name, username, password, and workgroup/domain.

## 2. Mount the share on Ubuntu

```bash
sudo apt update
sudo apt install cifs-utils
sudo mkdir -p /mnt/vam
sudo install -m 600 /dev/null /etc/samba/vam-backstage.credentials
sudo editor /etc/samba/vam-backstage.credentials
```

Credential file contents:

```text
username=WINDOWS_USERNAME
password=WINDOWS_PASSWORD
domain=WORKGROUP
```

Add one line to `/etc/fstab`, replacing the host and share:

```text
//WINDOWS_HOST/VAM_SHARE /mnt/vam cifs credentials=/etc/samba/vam-backstage.credentials,uid=1000,gid=1000,file_mode=0664,dir_mode=0775,vers=3.0,_netdev,nofail,x-systemd.automount 0 0
```

Activate and verify:

```bash
sudo systemctl daemon-reload
sudo mount /mnt/vam
test -d /mnt/vam/AddonPackages
test -r /mnt/vam/AddonPackages
test -w /mnt/vam
```

## 3. Start Backstage

From the repository checkout:

```bash
docker compose up -d --build
docker compose logs -f backstage
```

Open `http://UBUNTU_HOST:42069` from a LAN browser. Port `42070` must also be reachable for embedded Hub pages.

## 4. Refresh and recover

Backstage intentionally does not watch SMB. Press **Rescan** in the status bar after Windows-side file changes.

If the share disconnects, Backstage blocks the application. Restore the mount, verify `/mnt/vam/AddonPackages`, then press **Retry**. Retry validates the share and performs a full scan.

## 5. Operate the container

```bash
docker compose logs -f backstage
docker compose restart backstage
docker compose pull
docker compose up -d --build
docker compose down
```

`docker compose down` preserves the `backstage-data` volume. Do not use `docker compose down -v` unless deleting the Backstage database, caches, and Hub session is intended.

## 6. Back up Backstage data

Stop the service before copying the SQLite volume:

```bash
docker compose stop backstage
docker run --rm -v vam-backstage_backstage-data:/data -v "$PWD":/backup debian:bookworm-slim tar -C /data -czf /backup/backstage-data.tar.gz .
docker compose start backstage
```

The VaM files remain backed up separately on Windows.

## Security

This deployment has no authentication. Any device that can reach port `42069` can mutate the VaM library. Keep both published ports restricted to the trusted LAN and do not expose them to the public internet.
````

- [ ] **Step 2: Link the guide from README**

Add under the existing development/build documentation:

```markdown
For an Ubuntu Docker server using a VaM folder shared from Windows, see [Docker with a Windows VaM Share](docs/docker-smb-hosting.md).
```

- [ ] **Step 3: Run full repository verification**

Run:

```text
npm run lint
npm run format:check
npm run test
npm run build
docker compose config
docker compose build
```

Expected: every command exits `0`.

- [ ] **Step 4: Run local container smoke test with a disposable VaM-shaped bind mount**

Create an external disposable directory containing `AddonPackages`, `Saves`, and `Custom`, then run:

```text
$env:VAM_MOUNT='C:\tmp\vam-backstage-docker-vam'
docker compose up -d
Invoke-WebRequest http://localhost:42069 -UseBasicParsing
docker compose logs backstage
docker compose down
```

Expected: HTTP status `200`; logs show the remote server on `42069` and Hub proxy on `42070`; logs contain no fatal Electron, Xvfb, SQLite, or mount error.

- [ ] **Step 5: Manually verify unavailable-share recovery**

Start Compose with `VAM_MOUNT` pointing to an empty disposable directory. Open `http://localhost:42069` and confirm the blocking **VaM storage unavailable** screen names `/vam`. Add `AddonPackages`, `Saves`, and `Custom`, press **Retry**, and confirm the full application opens after scan completion.

- [ ] **Step 6: Commit deployment documentation**

```text
git add docs/docker-smb-hosting.md README.md
git commit -m "docs: explain Docker SMB hosting"
```

- [ ] **Step 7: Audit completion against the design**

Verify all of these from current files and command output:

```text
[ ] One Electron/Xvfb container serves client, RPC, and Hub proxy.
[ ] `/vam` is a read/write bind mount; `/data` is a separate persistent volume.
[ ] Docker environment overrides VaM and user-data paths.
[ ] Manual mode skips watcher warm-up, startup watcher, and rescan watcher restart.
[ ] Empty/unavailable share blocks the application and mutations.
[ ] Retry rechecks storage and performs a scan.
[ ] Status bar Rescan appears only in browser/manual mode.
[ ] Complete Content data and thumbnails use existing scanner/resolver flows.
[ ] Ports 42069 and 42070 are published.
[ ] SMB credentials stay on Ubuntu, outside container and Git.
[ ] Offline mode, auth, Node backend refactor, and separate frontend remain excluded.
```
