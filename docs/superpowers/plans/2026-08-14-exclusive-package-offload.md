# Exclusive Package Offload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent Library checkbox that offloads every other installed package before enabling the selected package and its installed transitive dependency tree.

**Architecture:** A pure main-process helper computes the keep/offload sets and sequences two storage-state phases. The package IPC handler validates the configured offload target, then reuses the existing storage-state worker with cascade disabled because the helper supplies complete explicit sets. The Library detail panel persists the checkbox through the existing Zustand view-state schema and calls the new IPC operation only from its primary package state action.

**Tech Stack:** Electron IPC, Node.js filesystem operations, React 19, Zustand 5 persistence, Vitest 4.

## Global Constraints

- JavaScript only; 2-space indentation, single quotes, no semicolons.
- Add no dependency, database migration, profile system, or new settings key.
- Checkbox label is exactly `Offload all other packages`; action label is exactly `Enable only`.
- Checkbox defaults off and persists as `offloadOthersOnEnable` in `library-view` localStorage state.
- Exclusive mode requires `disable_behavior=move-to:<auxDirId>` and a currently registered auxiliary directory.
- Keep set is the selected package plus every installed resolved transitive dependency.
- Missing dependencies are not downloaded; `__local__` is never moved.
- Offload phase finishes before enable phase starts.
- Enabled and VaM-disabled packages outside the keep set move to the configured offload directory; already-offloaded packages remain where they are.
- Per-package failures continue; keep-set enabling still runs after offload failures.
- Normal Disable, bulk actions, Library context-menu actions, and Content-view actions remain unchanged.

---

## File Structure

- Create `src/main/exclusive-enable.js`: pure package-set planning, phase sequencing, and result summarization.
- Create `src/main/exclusive-enable.test.js`: dependency closure, exclusions, ordering, and partial-failure coverage.
- Modify `src/main/storage-state.js`: map an explicit `offload` intent to the configured auxiliary target.
- Modify `src/main/storage-state.test.js`: cover offload intent state transitions.
- Modify `src/main/ipc/packages.js`: validate configuration, allow no-cascade storage batches, and register `packages:enable-exclusive`.
- Modify `src/shared/api.js`: expose `packages.enableExclusive(filename)`.
- Modify `src/renderer/src/stores/useLibraryStore.js`: persist the checkbox boolean and setter.
- Modify `src/renderer/src/views/LibraryView.jsx`: render/gate the checkbox and route the detail action.
- Create `src/renderer/src/views/LibraryView.test.js`: focused source-contract coverage for persistence and UI/API wiring.

---

### Task 1: Exclusive Package Planner And Sequencer

**Files:**

- Create: `src/main/exclusive-enable.js`
- Create: `src/main/exclusive-enable.test.js`

**Interfaces:**

- Consumes: `getTransitiveDeps(filename, forwardDeps)` and `isLocalPackage(filename)`.
- Produces: `planExclusiveEnable(filename, packageIndex, forwardDeps) -> { keep: Set<string>, offload: Set<string> }`.
- Produces: `runExclusiveEnable({ filename, packageIndex, forwardDeps, applyPhase }) -> Promise<{ ok, keepCount, offloadedCount, enabledCount, errors }>`.
- `applyPhase(filenames, intent)` receives `intent` as `'offload'` first and `'enable'` second, returning the existing single result or `{ ok, results }` batch envelope.

- [ ] **Step 1: Write failing planner and sequencing tests**

Create `src/main/exclusive-enable.test.js`:

```js
import { describe, expect, it, vi } from 'vitest'
import { LOCAL_PACKAGE_FILENAME } from '@shared/local-package.js'
import { planExclusiveEnable, runExclusiveEnable } from './exclusive-enable.js'

const row = (storageState = 'enabled') => ({ storage_state: storageState })

function fixture() {
  const packageIndex = new Map([
    ['A.Main.1.var', row()],
    ['B.Lib.1.var', row('disabled')],
    ['C.Core.1.var', row('offloaded')],
    ['X.Other.1.var', row()],
    ['Y.Other.1.var', row('disabled')],
    ['Z.Other.1.var', row('offloaded')],
    [LOCAL_PACKAGE_FILENAME, row()],
  ])
  const forwardDeps = new Map([
    ['A.Main.1.var', [{ resolved: 'B.Lib.1.var', resolution: 'exact' }]],
    ['B.Lib.1.var', [{ resolved: 'C.Core.1.var', resolution: 'exact' }]],
    ['C.Core.1.var', []],
  ])
  return { packageIndex, forwardDeps }
}

describe('planExclusiveEnable', () => {
  it('keeps the selected package and transitive dependencies only', () => {
    const { packageIndex, forwardDeps } = fixture()
    const plan = planExclusiveEnable('A.Main.1.var', packageIndex, forwardDeps)

    expect(plan.keep).toEqual(new Set(['A.Main.1.var', 'B.Lib.1.var', 'C.Core.1.var']))
    expect(plan.offload).toEqual(new Set(['X.Other.1.var', 'Y.Other.1.var', 'Z.Other.1.var']))
    expect(plan.offload.has(LOCAL_PACKAGE_FILENAME)).toBe(false)
  })

  it('handles a dependency cycle without removing the selected package', () => {
    const packageIndex = new Map([
      ['A.var', row()],
      ['B.var', row()],
      ['X.var', row()],
    ])
    const forwardDeps = new Map([
      ['A.var', [{ resolved: 'B.var', resolution: 'exact' }]],
      ['B.var', [{ resolved: 'A.var', resolution: 'exact' }]],
    ])

    expect(planExclusiveEnable('A.var', packageIndex, forwardDeps)).toEqual({
      keep: new Set(['A.var', 'B.var']),
      offload: new Set(['X.var']),
    })
  })
})

describe('runExclusiveEnable', () => {
  it('finishes offload before enable and reports partial failures', async () => {
    const { packageIndex, forwardDeps } = fixture()
    const applyPhase = vi.fn(async (filenames, intent) => {
      if (intent === 'offload') {
        return {
          ok: true,
          results: filenames.map((filename) =>
            filename === 'Y.Other.1.var'
              ? { ok: false, filename, error: 'locked' }
              : filename === 'Z.Other.1.var'
                ? { ok: true, filename, unchanged: true }
                : { ok: true, filename, storageState: 'offloaded' },
          ),
        }
      }
      return {
        ok: true,
        results: filenames.map((filename) => ({ ok: true, filename, storageState: 'enabled' })),
      }
    })

    const result = await runExclusiveEnable({
      filename: 'A.Main.1.var',
      packageIndex,
      forwardDeps,
      applyPhase,
    })

    expect(applyPhase.mock.calls.map(([, intent]) => intent)).toEqual(['offload', 'enable'])
    expect(result).toEqual({
      ok: false,
      keepCount: 3,
      offloadedCount: 1,
      enabledCount: 3,
      errors: [{ filename: 'Y.Other.1.var', phase: 'offload', error: 'locked' }],
    })
  })
})
```

- [ ] **Step 2: Run tests and verify the missing-module failure**

```powershell
npm run test -- src/main/exclusive-enable.test.js
```

Expected: FAIL because `src/main/exclusive-enable.js` does not exist.

- [ ] **Step 3: Implement the pure planner and sequencer**

Create `src/main/exclusive-enable.js`:

```js
import { isLocalPackage } from '@shared/local-package.js'
import { getTransitiveDeps } from './scanner/graph.js'

function resultRows(result) {
  if (!result) return []
  return Array.isArray(result.results) ? result.results : [result]
}

function summarizePhase(result, phase) {
  const rows = resultRows(result)
  return {
    changed: rows.filter((row) => row.ok && !row.unchanged).length,
    errors: rows.filter((row) => !row.ok).map((row) => ({ filename: row.filename, phase, error: row.error })),
  }
}

export function planExclusiveEnable(filename, packageIndex, forwardDeps) {
  if (!packageIndex.has(filename) || isLocalPackage(filename)) {
    throw new Error(`Package not found: ${filename}`)
  }

  const keep = new Set([filename, ...getTransitiveDeps(filename, forwardDeps)])
  const offload = new Set()
  for (const packageFilename of packageIndex.keys()) {
    if (!keep.has(packageFilename) && !isLocalPackage(packageFilename)) offload.add(packageFilename)
  }
  return { keep, offload }
}

export async function runExclusiveEnable({ filename, packageIndex, forwardDeps, applyPhase }) {
  const { keep, offload } = planExclusiveEnable(filename, packageIndex, forwardDeps)
  const offloadSummary = summarizePhase(await applyPhase([...offload], 'offload'), 'offload')
  const enableSummary = summarizePhase(await applyPhase([...keep], 'enable'), 'enable')
  const errors = [...offloadSummary.errors, ...enableSummary.errors]

  return {
    ok: errors.length === 0,
    keepCount: keep.size,
    offloadedCount: offloadSummary.changed,
    enabledCount: enableSummary.changed,
    errors,
  }
}
```

- [ ] **Step 4: Run focused tests**

```powershell
npm run test -- src/main/exclusive-enable.test.js src/main/scanner/graph.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the pure operation**

```powershell
git add src/main/exclusive-enable.js src/main/exclusive-enable.test.js
git commit -m "add exclusive package planner"
```

---

### Task 2: Storage Intent And IPC Operation

**Files:**

- Modify: `src/main/storage-state.js:249`
- Modify: `src/main/storage-state.test.js:28`
- Modify: `src/main/ipc/packages.js:187-322,547-573`
- Modify: `src/shared/api.js:4-46`

**Interfaces:**

- Consumes: `runExclusiveEnable(...)` from Task 1.
- Extends: `nextStorageStateForIntent({ current, intent, disableTarget })` with `intent: 'offload'`.
- Extends: internal `applyStorageStateChange(filenames, intentFn, { cascade = true } = {})`.
- Produces: `window.api.packages.enableExclusive(filename)` invoking `packages:enable-exclusive`.

- [ ] **Step 1: Write failing offload-intent tests**

Add inside `describe('nextStorageStateForIntent', ...)` in `src/main/storage-state.test.js`:

```js
it('offloads enabled and disabled packages to the configured target', () => {
  expect(nextStorageStateForIntent({ current: 'enabled', intent: 'offload', disableTarget: offloadTarget })).toEqual(
    offloadTarget,
  )
  expect(nextStorageStateForIntent({ current: 'disabled', intent: 'offload', disableTarget: offloadTarget })).toEqual(
    offloadTarget,
  )
})

it('leaves already-offloaded packages in their current directory', () => {
  expect(
    nextStorageStateForIntent({ current: 'offloaded', intent: 'offload', disableTarget: offloadTarget }),
  ).toBeNull()
})

it('rejects offload intent without an offload target', () => {
  expect(nextStorageStateForIntent({ current: 'enabled', intent: 'offload' })).toBeNull()
  expect(nextStorageStateForIntent({ current: 'enabled', intent: 'offload', disableTarget: suffixTarget })).toBeNull()
})
```

- [ ] **Step 2: Run the storage-state test and verify failure**

```powershell
npm run test -- src/main/storage-state.test.js
```

Expected: FAIL because `offload` currently returns `null` as an unknown intent.

- [ ] **Step 3: Implement explicit offload intent**

In `nextStorageStateForIntent` in `src/main/storage-state.js`, insert after the enable branch:

```js
if (intent === 'offload') {
  if (current === 'offloaded' || disableTarget?.storageState !== 'offloaded') return null
  return disableTarget
}
```

Update the function comment to list `enable`, `disable`, and `offload`. Keep normal disable semantics unchanged.

- [ ] **Step 4: Allow explicit no-cascade batches**

Change the internal worker signature in `src/main/ipc/packages.js`:

```js
async function applyStorageStateChange(filenames, intentFn, { cascade = true } = {}) {
```

Replace the cascade selection with:

```js
const cascadeSet =
  cascade && intent === 'enable'
    ? computeCascadeEnable(filename, getPackageIndex(), getForwardDeps())
    : cascade && intent === 'disable'
      ? computeCascadeDisable(filename, getPackageIndex(), getForwardDeps(), getReverseDeps())
      : new Set()
```

Update the worker comment so `intentFn` documents `'enable' | 'disable' | 'offload'` and `{ cascade: false }` documents complete explicit batches.

- [ ] **Step 5: Register the exclusive IPC handler**

Update imports in `src/main/ipc/packages.js`:

```js
import { LOCAL_PACKAGE_FILENAME, isLocalPackage } from '@shared/local-package.js'
import { pkgVarPath, resolveContentPath, getMainLibraryDirPath, getLibraryDirPath } from '../library-dirs.js'
import { runExclusiveEnable } from '../exclusive-enable.js'
```

Add after `packages:enable-deps`:

```js
ipcMain.handle('packages:enable-exclusive', async (_, filename) => {
  if (!getSetting('vam_dir')) throw new Error('VaM directory not configured')
  if (!getPackageIndex().has(filename) || isLocalPackage(filename)) {
    throw new Error(`Package not found: ${filename}`)
  }

  const behavior = parseDisableBehavior(getSetting('disable_behavior'))
  if (behavior.kind !== 'move-to' || !getLibraryDirPath(behavior.auxDirId)) {
    throw new Error('Configure an offload directory in Settings')
  }

  return runExclusiveEnable({
    filename,
    packageIndex: getPackageIndex(),
    forwardDeps: getForwardDeps(),
    applyPhase: (filenames, intent) => applyStorageStateChange(filenames, () => intent, { cascade: false }),
  })
})
```

This preflight occurs before `runExclusiveEnable`, so invalid configuration cannot partially move packages.

- [ ] **Step 6: Expose the shared renderer API**

Add after `enableDeps` in `src/shared/api.js`:

```js
      enableExclusive: (filename) => invoke('packages:enable-exclusive', filename),
```

- [ ] **Step 7: Run focused backend tests and lint**

```powershell
npm run test -- src/main/exclusive-enable.test.js src/main/storage-state.test.js src/main/scanner/graph.test.js
npm run lint -- src/main/exclusive-enable.js src/main/ipc/packages.js src/main/storage-state.js src/shared/api.js
```

Expected: PASS.

- [ ] **Step 8: Commit backend wiring**

```powershell
git add src/main/storage-state.js src/main/storage-state.test.js src/main/ipc/packages.js src/shared/api.js
git commit -m "add exclusive package enable"
```

---

### Task 3: Persistent Library Checkbox

**Files:**

- Modify: `src/renderer/src/stores/useLibraryStore.js:151-241,474-488`
- Modify: `src/renderer/src/views/LibraryView.jsx:1-116,1864-2240`
- Create: `src/renderer/src/views/LibraryView.test.js`

**Interfaces:**

- Consumes: `window.api.settings.get('disable_behavior')` and `parseDisableBehavior(value)`.
- Consumes: `window.api.packages.enableExclusive(filename)` from Task 2.
- Produces: persisted state `offloadOthersOnEnable: boolean` and `setOffloadOthersOnEnable(value)`.
- Produces: Library detail checkbox and `Enable only` action; no other action surface consumes this state.

- [ ] **Step 1: Write the failing renderer source-contract test**

Create `src/renderer/src/views/LibraryView.test.js`:

```js
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const viewSource = readFileSync(resolve(import.meta.dirname, 'LibraryView.jsx'), 'utf8')
const storeSource = readFileSync(resolve(import.meta.dirname, '../stores/useLibraryStore.js'), 'utf8')
const apiSource = readFileSync(resolve(import.meta.dirname, '../../../shared/api.js'), 'utf8')

describe('Library exclusive package enable', () => {
  it('persists the checkbox and routes the detail action through exclusive IPC', () => {
    expect(storeSource).toContain('offloadOthersOnEnable: false')
    expect(storeSource).toContain('offloadOthersOnEnable: asBool')
    expect(apiSource).toContain("enableExclusive: (filename) => invoke('packages:enable-exclusive', filename)")
    expect(viewSource).toContain('Offload all other packages')
    expect(viewSource).toContain("parseDisableBehavior(value).kind === 'move-to'")
    expect(viewSource).toContain('checked={exclusiveMode}')
    expect(viewSource).toContain('disabled={!offloadTargetAvailable || exclusiveWorking}')
    expect(viewSource).toContain('window.api.packages.enableExclusive(pkg.filename)')
    expect(viewSource).toContain("'Enable only'")
  })
})
```

- [ ] **Step 2: Run the renderer test and verify failure**

```powershell
npm run test -- src/renderer/src/views/LibraryView.test.js
```

Expected: FAIL on the first missing store/API/UI contract.

- [ ] **Step 3: Add persisted store state**

In `useLibraryStore` initial state, add:

```js
      offloadOthersOnEnable: false,
```

Add beside the simple view setters:

```js
      setOffloadOthersOnEnable: (offloadOthersOnEnable) => set({ offloadOthersOnEnable }),
```

Add to the `persistViewState('library-view', ...)` schema:

```js
      offloadOthersOnEnable: asBool,
```

- [ ] **Step 4: Load and gate the configured offload target**

Import in `LibraryView.jsx`:

```js
import { parseDisableBehavior } from '@shared/disable-behavior.js'
```

Inside `LibraryDetailPanel`, add:

```js
const offloadOthersOnEnable = useLibraryStore((s) => s.offloadOthersOnEnable)
const setOffloadOthersOnEnable = useLibraryStore((s) => s.setOffloadOthersOnEnable)
const [offloadTargetAvailable, setOffloadTargetAvailable] = useState(false)
const [exclusiveWorking, setExclusiveWorking] = useState(false)

useEffect(() => {
  let cancelled = false
  window.api.settings
    .get('disable_behavior')
    .then((value) => {
      if (cancelled) return
      const available = parseDisableBehavior(value).kind === 'move-to'
      setOffloadTargetAvailable(available)
      if (!available) setOffloadOthersOnEnable(false)
    })
    .catch(() => {
      if (cancelled) return
      setOffloadTargetAvailable(false)
      setOffloadOthersOnEnable(false)
    })
  return () => {
    cancelled = true
  }
}, [setOffloadOthersOnEnable])

const exclusiveMode = offloadTargetAvailable && offloadOthersOnEnable
```

Availability is renderer guidance only. The IPC handler remains authoritative.
Move the existing `showDisableDialog` declaration below `exclusiveMode` so it never reads that constant before initialization.

- [ ] **Step 5: Add the exclusive action handler**

Add beside `handleToggleEnabled`:

```js
const handleEnableExclusive = async () => {
  if (exclusiveWorking) return
  setExclusiveWorking(true)
  try {
    const res = await window.api.packages.enableExclusive(pkg.filename)
    if (res.ok) {
      toast(
        `Enabled ${res.keepCount} package${res.keepCount === 1 ? '' : 's'}; offloaded ${res.offloadedCount}`,
        'success',
      )
    } else {
      toast(`Exclusive enable finished with ${res.errors.length} failure${res.errors.length === 1 ? '' : 's'}`)
    }
  } catch (err) {
    toast(`Failed to enable package exclusively: ${err.message}`)
  } finally {
    setExclusiveWorking(false)
  }
}

const packageStateAction = exclusiveMode ? handleEnableExclusive : handleToggleEnabled
const packageStateLabel = exclusiveMode ? 'Enable only' : isPackageActive(pkg.storageState) ? 'Disable' : 'Enable'
```

Change the existing confirmation condition to:

```js
const showDisableDialog = !exclusiveMode && packageNeedsDisableConfirmation(pkg, suppressDisablePackageWarning)
```

- [ ] **Step 6: Render the checkbox and route both detail button variants**

Immediately before the `pkg.isDirect` action branch, render:

```jsx
<label
  className={`flex items-center gap-2 px-0.5 py-1 text-[10px] ${offloadTargetAvailable ? 'text-text-secondary' : 'text-text-tertiary opacity-60'}`}
  title={offloadTargetAvailable ? undefined : 'Configure an offload directory in Settings'}
>
  <input
    type="checkbox"
    checked={exclusiveMode}
    onChange={(event) => setOffloadOthersOnEnable(event.target.checked)}
    disabled={!offloadTargetAvailable || exclusiveWorking}
    className="h-3.5 w-3.5 accent-accent-blue"
  />
  <span>Offload all other packages</span>
</label>
```

In both direct-package and dependency-package state button branches:

- render the disable confirmation only when `!exclusiveMode && isPackageActive(...) && showDisableDialog`;
- use `onClick={packageStateAction}`;
- use `disabled={exclusiveWorking}`;
- render `<Loader2 size={11} className="animate-spin" />` while working, otherwise `<Power size={11} />`;
- render `{exclusiveWorking ? 'Enabling...' : packageStateLabel}`.

Do not modify `LibraryPackageContextMenu.jsx`, `ContentView.jsx`, or bulk action handlers.

- [ ] **Step 7: Run renderer tests, lint, and formatting**

```powershell
npm run test -- src/renderer/src/views/LibraryView.test.js src/main/exclusive-enable.test.js src/main/storage-state.test.js
npm run lint -- src/renderer/src/views/LibraryView.jsx src/renderer/src/views/LibraryView.test.js src/renderer/src/stores/useLibraryStore.js
npx prettier --check src/renderer/src/views/LibraryView.jsx src/renderer/src/views/LibraryView.test.js src/renderer/src/stores/useLibraryStore.js
```

Expected: PASS.

- [ ] **Step 8: Commit renderer behavior**

```powershell
git add src/renderer/src/stores/useLibraryStore.js src/renderer/src/views/LibraryView.jsx src/renderer/src/views/LibraryView.test.js
git commit -m "add exclusive offload checkbox"
```

---

### Task 4: Full Verification And Local Handoff

**Files:**

- No new files.

**Interfaces:**

- Consumes: completed backend, shared API, store, and Library detail behavior from Tasks 1-3.
- Produces: a clean, locally verified feature branch ready for user runtime testing; no push or PR.

- [ ] **Step 1: Run all focused tests**

```powershell
npm run test -- src/main/exclusive-enable.test.js src/main/storage-state.test.js src/main/scanner/graph.test.js src/renderer/src/views/LibraryView.test.js
```

Expected: PASS.

- [ ] **Step 2: Run repository validation**

```powershell
npm run lint
npm run format:check
npm run test
npm run build
```

Expected: all commands pass. If an unrelated pre-existing full-suite failure appears, record its exact test and error while keeping the focused suites passing.

- [ ] **Step 3: Inspect the Electron UI without moving the real library**

```powershell
npm run dev
```

Verify in the Library detail panel:

- with no `move-to` behavior, the checkbox is disabled and unchecked;
- with a registered `move-to` behavior, the checkbox can be checked;
- selecting another package preserves the checked state;
- checked mode changes the action to `Enable only`, including for an already-enabled package;
- unchecked mode restores existing Enable/Disable labels and confirmation behavior;
- package context menus, Content view actions, and bulk controls are unchanged.

Do not click `Enable only` against the user's real VaM library during automated verification. The user performs that destructive runtime smoke after reviewing the package set.

- [ ] **Step 4: Confirm final branch state**

```powershell
git status --short --branch
git log --oneline upstream/master..HEAD
```

Expected: clean worktree and only this feature's design, plan, and implementation commits ahead of `upstream/master`. Do not push, merge to `develop`, or open an upstream PR until requested.
