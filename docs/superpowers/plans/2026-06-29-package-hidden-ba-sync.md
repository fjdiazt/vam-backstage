# Package Hidden BrowserAssist Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Library package hiding in Backstage and mirror it to BrowserAssist package prefs.

**Architecture:** Store package hidden state in Backstage SQLite for fast Library filtering. Read/write BrowserAssist-compatible `AddonPackagesUserPrefs/<Creator.Package>.prefs` JSON for interoperability, with BrowserAssist prefs winning conflicts during sync/rescan.

**Tech Stack:** Electron main IPC, SQLite via `better-sqlite3`, React/Zustand renderer, Vitest.

---

## File Structure

- Modify `src/main/db.js`: schema migration and package hidden helpers.
- Create `src/main/package-prefs.js`: BrowserAssist package prefs read/write helpers.
- Modify `src/main/browser-assist.js`: import package hidden from BA prefs during sync.
- Modify `src/main/ipc/packages.js`: IPC handler to set package hidden and write prefs.
- Modify `src/main/store.js`: expose `hidden` on package summaries.
- Modify `src/renderer/src/stores/useLibraryStore.js`: add `visibilityFilter` and `setPackageHidden`.
- Modify `src/renderer/src/views/LibraryView.jsx`: add Visibility filter and Hide/Unhide action.
- Add/update tests near touched modules.

---

### Task 1: DB Package Hidden State

**Files:**

- Modify: `src/main/db.js`
- Modify: `src/main/db.test.js`

- [ ] **Step 1: Write failing DB tests**

Add to `src/main/db.test.js`:

```js
import { getPackageHidden, setPackageHidden } from './db.js'

it('stores nullable package hidden state', () => {
  const db = getDb()
  db.prepare(
    `INSERT INTO packages (filename, creator, package_name, version, size_bytes, file_mtime, is_direct, storage_state, dep_refs)
     VALUES ('A.Pkg.1.var', 'A', 'A.Pkg', '1', 1, 0, 1, 'enabled', '[]')`,
  ).run()

  expect(getPackageHidden('A.Pkg.1.var')).toBe(null)
  setPackageHidden('A.Pkg.1.var', true)
  expect(getPackageHidden('A.Pkg.1.var')).toBe(true)
  setPackageHidden('A.Pkg.1.var', false)
  expect(getPackageHidden('A.Pkg.1.var')).toBe(false)
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
npm run test -- src/main/db.test.js
```

Expected: fail because helpers/column do not exist.

- [ ] **Step 3: Add migration and helpers**

In `src/main/db.js`:

```js
const SCHEMA_VERSION = 28
```

Add migration:

```js
function applyV28() {
  db.exec('ALTER TABLE packages ADD COLUMN hidden INTEGER')
}
```

Wire it into `migrate()` after v27:

```js
if (current < 28) applyV28()
```

Add helpers:

```js
export function getPackageHidden(filename) {
  const row = stmt('SELECT hidden FROM packages WHERE filename = ?').get(filename)
  if (!row || row.hidden == null) return null
  return !!row.hidden
}

export function setPackageHidden(filename, hidden) {
  const value = hidden == null ? null : hidden ? 1 : 0
  return stmt('UPDATE packages SET hidden = ? WHERE filename = ?').run(value, filename).changes
}
```

- [ ] **Step 4: Run DB tests**

Run:

```powershell
npm run test -- src/main/db.test.js
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add src/main/db.js src/main/db.test.js
git commit -m "feat: store package hidden state"
```

---

### Task 2: BrowserAssist Package Prefs Helper

**Files:**

- Create: `src/main/package-prefs.js`
- Create: `src/main/package-prefs.test.js`
- Modify: `src/shared/paths.js`

- [ ] **Step 1: Write failing prefs tests**

Create `src/main/package-prefs.test.js`:

```js
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { mkTempVamDir } from '../../test/fixtures/index.js'
import { packagePrefsPath, readPackageHiddenPrefs, writePackageHiddenPref } from './package-prefs.js'

describe('package-prefs', () => {
  it('reads missing package prefs as null', async () => {
    const tmp = await mkTempVamDir()
    try {
      await expect(readPackageHiddenPrefs(tmp.vamDir, 'A.Pkg')).resolves.toBe(null)
    } finally {
      await tmp.cleanup()
    }
  })

  it('preserves unknown fields when writing explicit hidden state', async () => {
    const tmp = await mkTempVamDir()
    try {
      const p = packagePrefsPath(tmp.vamDir, 'A.Pkg')
      await mkdir(join(tmp.vamDir, 'AddonPackagesUserPrefs'), { recursive: true })
      await writeFile(p, JSON.stringify({ customOptions: { preloadMorphs: true } }, null, 2))

      await writePackageHiddenPref(tmp.vamDir, 'A.Pkg', false)

      const json = JSON.parse(await readFile(p, 'utf8'))
      expect(json.customOptions.preloadMorphs).toBe(true)
      expect(json.hidden).toBe(false)
    } finally {
      await tmp.cleanup()
    }
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
npm run test -- src/main/package-prefs.test.js
```

Expected: fail because module does not exist.

- [ ] **Step 3: Add shared path constant**

In `src/shared/paths.js` add:

```js
export const ADDON_PACKAGES_USER_PREFS = 'AddonPackagesUserPrefs'
```

- [ ] **Step 4: Add helper implementation**

Create `src/main/package-prefs.js`:

```js
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
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
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
  await writeFile(tmp, JSON.stringify(json, null, 2) + '\n', 'utf8')
  await rename(tmp, path)
}
```

- [ ] **Step 5: Run prefs tests**

Run:

```powershell
npm run test -- src/main/package-prefs.test.js
```

Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add src/shared/paths.js src/main/package-prefs.js src/main/package-prefs.test.js
git commit -m "feat: read package hidden prefs"
```

---

### Task 3: Import BA Hidden Into Backstage

**Files:**

- Modify: `src/main/browser-assist.js`
- Modify: `src/main/browser-assist.test.js`

- [ ] **Step 1: Write failing import test**

In `src/main/browser-assist.test.js`, add helper-level tests for a pure conflict rule:

```js
import { applyBrowserAssistPackageHidden } from './browser-assist.js'

it('uses BrowserAssist package hidden as winner', () => {
  expect(applyBrowserAssistPackageHidden(null, true)).toBe(true)
  expect(applyBrowserAssistPackageHidden(false, true)).toBe(true)
  expect(applyBrowserAssistPackageHidden(true, false)).toBe(false)
  expect(applyBrowserAssistPackageHidden(true, null)).toBe(true)
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
npm run test -- src/main/browser-assist.test.js
```

Expected: fail because helper does not exist.

- [ ] **Step 3: Implement import rule**

In `src/main/browser-assist.js`:

```js
export function applyBrowserAssistPackageHidden(currentHidden, baHidden) {
  return typeof baHidden === 'boolean' ? baHidden : currentHidden
}
```

During `syncBrowserAssistTags(vamDir)`, after building package lookup, read `readPackageHiddenPrefs(vamDir, entry.packageName)` for package rows and call `setPackageHidden(filename, nextHidden)` when BA returns boolean and state differs.

The package row match key is the package group name, not version:

```js
function packageGroupName(pkg) {
  return pkg.package_name
}
```

Use that same name for `AddonPackagesUserPrefs/<Creator.Package>.prefs`.

Track count:

```js
let packagesHiddenImported = 0
```

Return it in result.

- [ ] **Step 4: Run BrowserAssist tests**

Run:

```powershell
npm run test -- src/main/browser-assist.test.js
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add src/main/browser-assist.js src/main/browser-assist.test.js
git commit -m "feat: import browserassist package hidden"
```

---

### Task 4: Package IPC Hide/Unhide

**Files:**

- Modify: `src/main/ipc/packages.js`
- Modify: `src/preload/index.js`
- Modify: `src/renderer/src/stores/useLibraryStore.js`

- [ ] **Step 1: Add IPC/preload contract**

In `src/preload/index.js`, add under `packages`:

```js
setHidden: (payload) => ipcRenderer.invoke('packages:set-hidden', payload),
```

In `src/main/ipc/packages.js`, add handler:

```js
ipcMain.handle('packages:set-hidden', async (_, { filename, hidden }) => {
  const pkg = getPackageIndex().get(filename)
  if (!pkg) throw new Error(`Package not found: ${filename}`)
  const vamDir = getSetting('vam_dir')
  if (!vamDir) throw new Error('VaM directory not configured')
  setPackageHidden(filename, !!hidden)
  await writePackageHiddenPref(vamDir, pkg.package_name, !!hidden)
  buildFromDb()
  notify('packages:updated')
  return { ok: true }
})
```

Import `setPackageHidden` and `writePackageHiddenPref`.

- [ ] **Step 2: Add store action**

In `src/renderer/src/stores/useLibraryStore.js`:

```js
setPackageHidden: async (filename, hidden) => {
  await window.api.packages.setHidden({ filename, hidden })
  await get().fetchPackages()
  await get().refreshDetail()
},
```

- [ ] **Step 3: Run lint**

Run:

```powershell
npm run lint -- src/main/ipc/packages.js src/preload/index.js src/renderer/src/stores/useLibraryStore.js
```

Expected: pass.

- [ ] **Step 4: Commit**

```powershell
git add src/main/ipc/packages.js src/preload/index.js src/renderer/src/stores/useLibraryStore.js
git commit -m "feat: toggle package hidden"
```

---

### Task 5: Library Visibility UI

**Files:**

- Modify: `src/renderer/src/views/LibraryView.jsx`
- Modify: `src/renderer/src/stores/useLibraryStore.js`
- Modify: `src/renderer/src/lib/view-state.js`

- [ ] **Step 1: Add persisted state key**

In `useLibraryStore`, add:

```js
visibilityFilter: 'visible',
setVisibilityFilter: (visibilityFilter) => set({ visibilityFilter }),
```

Include `visibilityFilter` in `getPersistedState()` and `applyPersistedState()`.

In `src/renderer/src/lib/view-state.js`, accept only:

```js
const LIBRARY_VISIBILITY_FILTERS = new Set(['all', 'visible', 'hidden'])
```

Default invalid values to `'visible'`.

- [ ] **Step 2: Filter packages**

In `LibraryView.jsx`, add helper:

```js
function filterPackagesByVisibility(items, visibilityFilter) {
  if (visibilityFilter === 'hidden') return items.filter((p) => p.hidden)
  if (visibilityFilter === 'all') return items
  return items.filter((p) => !p.hidden)
}
```

Apply it in `filtered`, `statusCounts`, `typeCounts`, `enabledFilterCounts`, and label option calculations.

- [ ] **Step 3: Add sidebar section**

In `sections`, add after Status:

```js
{
  key: 'visibility',
  label: 'Visibility',
  type: 'list',
  value: visibilityFilter,
  onChange: setVisibilityFilter,
  listCollapsible: false,
  items: [
    { value: 'visible', label: 'Visible', count: visibilityCounts.visible },
    { value: 'hidden', label: 'Hidden', count: visibilityCounts.hidden },
    { value: 'all', label: 'All', count: visibilityCounts.all },
  ],
}
```

- [ ] **Step 4: Add Hide/Unhide action**

Use existing card/row action pattern. Call:

```js
await useLibraryStore.getState().setPackageHidden(pkg.filename, !pkg.hidden)
```

Label action as `Hide` when visible, `Unhide` when hidden.

- [ ] **Step 5: Run renderer tests/lint**

Run:

```powershell
npm run test -- src/renderer/src/lib/view-state.test.js src/renderer/src/views/LibraryView.test.js
npm run lint -- src/renderer/src/views/LibraryView.jsx src/renderer/src/stores/useLibraryStore.js src/renderer/src/lib/view-state.js
```

Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add src/renderer/src/views/LibraryView.jsx src/renderer/src/stores/useLibraryStore.js src/renderer/src/lib/view-state.js src/renderer/src/lib/view-state.test.js src/renderer/src/views/LibraryView.test.js
git commit -m "feat: filter hidden library packages"
```

---

### Task 6: Final Verification

**Files:**

- No new files.

- [ ] **Step 1: Run focused tests**

```powershell
npm run test -- src/main/db.test.js src/main/package-prefs.test.js src/main/browser-assist.test.js src/renderer/src/lib/view-state.test.js src/renderer/src/views/LibraryView.test.js
```

Expected: all pass.

- [ ] **Step 2: Run full checks**

```powershell
npm run lint
npm run format:check
npm run build
```

Expected: all pass.

- [ ] **Step 3: Manual smoke**

Run app:

```powershell
npm run start
```

Check:

- Hide a Library package.
- It disappears from Visible.
- It appears under Hidden.
- `AddonPackagesUserPrefs/<Creator.Package>.prefs` contains `"hidden": true`.
- Unhide it.
- File keeps unrelated fields and contains `"hidden": false`.
- BrowserAssist sync imports a manually changed prefs file into Backstage.

- [ ] **Step 4: Final commit if smoke changed code**

```powershell
git status --short
```

Expected: clean or only intentional app data changes outside repo.
