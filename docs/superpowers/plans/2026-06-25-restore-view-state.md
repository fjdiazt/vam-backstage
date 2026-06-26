# Restore View State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and restore the last active app view, per-view filters, and last selected item so view switches and app relaunches resume where the user left off.

**Architecture:** Store small UI-state JSON blobs in the existing SQLite-backed `settings` API. Keep visited views mounted after first use so switching between Hub, Library, and Content does not reset scroll or local DOM state. On launch, hydrate filters before rendering views, restore the last view, then restore saved selections after each view's data is available.

**Tech Stack:** Electron, React 19, Zustand, Vitest, existing `window.api.settings.get/set`.

---

## File Structure

- Create `src/renderer/src/lib/view-state.js`: constants, JSON read/write helpers, debounced setting writer, and sanitizers for persisted view state.
- Create `src/renderer/src/lib/view-state.test.js`: focused Vitest tests for sanitizers and JSON fallback behavior.
- Modify `src/renderer/src/App.jsx`: hydrate UI state before first view render, persist `last_view`, and keep visited views mounted.
- Modify `src/renderer/src/stores/useHubStore.js`: expose hydrate/snapshot helpers and restore Hub detail by `resource_id`.
- Modify `src/renderer/src/stores/useLibraryStore.js`: expose hydrate/snapshot helpers and a pending restore filename.
- Modify `src/renderer/src/stores/useContentStore.js`: expose hydrate/snapshot helpers and a pending restore item key.
- Modify `src/renderer/src/views/HubView.jsx`: wait for hydrated state, persist Hub filters/detail, and restore detail.
- Modify `src/renderer/src/views/LibraryView.jsx`: select restored package after packages and filters are ready.
- Modify `src/renderer/src/views/ContentView.jsx`: select restored content after contents and filters are ready.
- Modify `src/renderer/src/components/VirtualGrid.jsx`: support one-shot scroll-to-index on relaunch for grid and list views.

## Persisted Keys

Use these exact setting keys:

```js
export const LAST_VIEW_KEY = 'ui:last_view'
export const HUB_STATE_KEY = 'ui:hub_state'
export const LIBRARY_STATE_KEY = 'ui:library_state'
export const CONTENT_STATE_KEY = 'ui:content_state'
```

Persisted JSON version is `1`. Invalid JSON, unknown view names, wrong primitive types, and stale item ids are ignored without a toast.

---

### Task 1: View State Helper

**Files:**

- Create: `src/renderer/src/lib/view-state.js`
- Create: `src/renderer/src/lib/view-state.test.js`

- [ ] **Step 1: Write failing tests**

Create `src/renderer/src/lib/view-state.test.js`:

```js
import { describe, expect, it, vi } from 'vitest'
import {
  sanitizeLastView,
  sanitizeHubState,
  sanitizeLibraryState,
  sanitizeContentState,
  readSettingJson,
  writeSettingJson,
} from './view-state'

describe('view-state sanitizers', () => {
  it('accepts known app views only', () => {
    expect(sanitizeLastView('hub')).toBe('hub')
    expect(sanitizeLastView('library')).toBe('library')
    expect(sanitizeLastView('content')).toBe('content')
    expect(sanitizeLastView('settings')).toBe('settings')
    expect(sanitizeLastView('downloads')).toBe('library')
    expect(sanitizeLastView(null)).toBe('library')
  })

  it('normalizes hub state', () => {
    expect(
      sanitizeHubState({
        v: 1,
        search: 'alice',
        selectedType: 'Looks',
        paidFilter: 'bad',
        authorSearch: 'bob',
        selectedHubTags: ['free', 7],
        sort: 'Latest Update',
        license: 'CC BY',
        hideInstalled: true,
        detailResourceId: 123,
      }),
    ).toEqual({
      search: 'alice',
      selectedType: 'Looks',
      paidFilter: 'all',
      authorSearch: 'bob',
      selectedHubTags: ['free'],
      sort: 'Latest Update',
      license: 'CC BY',
      hideInstalled: true,
      detailResourceId: '123',
    })
  })

  it('normalizes library and content restore ids', () => {
    expect(
      sanitizeLibraryState({ selectedFilename: 'A.B.1.var', selectedTypes: ['Looks'], selectedLabelIds: [1, 'x'] }),
    ).toMatchObject({ selectedFilename: 'A.B.1.var', selectedTypes: ['Looks'], selectedLabelIds: [1] })
    expect(
      sanitizeContentState({ selectedItemId: 42, selectedPackageFilename: 'A.B.1.var', visibilityFilter: 'hidden' }),
    ).toMatchObject({ selectedItemId: 42, selectedPackageFilename: 'A.B.1.var', visibilityFilter: 'hidden' })
  })
})

describe('view-state settings helpers', () => {
  it('returns fallback for invalid JSON', async () => {
    const api = { get: vi.fn().mockResolvedValue('{bad') }
    await expect(readSettingJson(api, 'k', { ok: true })).resolves.toEqual({ ok: true })
  })

  it('writes compact JSON strings', async () => {
    const api = { set: vi.fn().mockResolvedValue({ ok: true }) }
    await writeSettingJson(api, 'k', { a: 1 })
    expect(api.set).toHaveBeenCalledWith('k', '{"a":1}')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/renderer/src/lib/view-state.test.js
```

Expected: FAIL with an import error for `./view-state`.

- [ ] **Step 3: Implement helper**

Create `src/renderer/src/lib/view-state.js`:

```js
export const VIEW_STATE_VERSION = 1
export const LAST_VIEW_KEY = 'ui:last_view'
export const HUB_STATE_KEY = 'ui:hub_state'
export const LIBRARY_STATE_KEY = 'ui:library_state'
export const CONTENT_STATE_KEY = 'ui:content_state'

const VALID_VIEWS = new Set(['hub', 'library', 'content', 'settings'])
const VALID_PAID = new Set(['all', 'free', 'paid'])
const VALID_LIBRARY_STATUS = new Set(['direct', 'deps', 'missing', 'orphans', 'disabled', 'all', 'updates'])
const VALID_ENABLED = new Set(['all', 'enabled', 'disabled', 'offloaded'])
const VALID_PACKAGE_FILTER = new Set(['all', 'direct', 'deps', 'local'])
const VALID_PACKAGE_STATUS = new Set(['all', 'enabled', 'disabled', 'offloaded'])
const VALID_VISIBILITY = new Set(['all', 'visible', 'hidden', 'favorites'])

const s = (value, fallback = '') => (typeof value === 'string' ? value : fallback)
const b = (value) => value === true
const strings = (value) => (Array.isArray(value) ? value.filter((x) => typeof x === 'string') : [])
const ints = (value) => (Array.isArray(value) ? value.filter((x) => Number.isInteger(x)) : [])
const id = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value) : null)

export function sanitizeLastView(value) {
  return VALID_VIEWS.has(value) ? value : 'library'
}

export function sanitizeHubState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  return {
    search: s(r.search),
    selectedType: s(r.selectedType, 'All') || 'All',
    paidFilter: VALID_PAID.has(r.paidFilter) ? r.paidFilter : 'all',
    authorSearch: s(r.authorSearch),
    selectedHubTags: strings(r.selectedHubTags),
    sort: s(r.sort),
    license: s(r.license, 'Any') || 'Any',
    hideInstalled: b(r.hideInstalled),
    detailResourceId: id(r.detailResourceId),
  }
}

export function sanitizeLibraryState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  return {
    search: s(r.search),
    authorSearch: s(r.authorSearch),
    statusFilter: VALID_LIBRARY_STATUS.has(r.statusFilter) ? r.statusFilter : 'direct',
    enabledFilter: VALID_ENABLED.has(r.enabledFilter) ? r.enabledFilter : 'all',
    selectedTypes: strings(r.selectedTypes),
    selectedTags: strings(r.selectedTags),
    selectedLabelIds: ints(r.selectedLabelIds),
    primarySort: s(r.primarySort, 'Type') || 'Type',
    secondarySort: s(r.secondarySort, 'Recently installed') || 'Recently installed',
    license: s(r.license, 'Any') || 'Any',
    selectedFilename: s(r.selectedFilename, null),
  }
}

export function sanitizeContentState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  return {
    search: s(r.search),
    authorSearch: s(r.authorSearch),
    selectedTypes: strings(r.selectedTypes),
    selectedPackageTypes: strings(r.selectedPackageTypes),
    selectedTags: strings(r.selectedTags),
    selectedLabelIds: ints(r.selectedLabelIds),
    packageFilter: VALID_PACKAGE_FILTER.has(r.packageFilter) ? r.packageFilter : 'all',
    packageStatusFilter: VALID_PACKAGE_STATUS.has(r.packageStatusFilter) ? r.packageStatusFilter : 'enabled',
    visibilityFilter: VALID_VISIBILITY.has(r.visibilityFilter) ? r.visibilityFilter : 'visible',
    primarySort: s(r.primarySort, 'Type') || 'Type',
    secondarySort: s(r.secondarySort, 'Recently installed') || 'Recently installed',
    selectedItemId:
      typeof r.selectedItemId === 'number' || typeof r.selectedItemId === 'string' ? r.selectedItemId : null,
    selectedPackageFilename: s(r.selectedPackageFilename, null),
  }
}

export async function readSettingJson(settingsApi, key, fallback) {
  try {
    const raw = await settingsApi.get(key)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export async function writeSettingJson(settingsApi, key, value) {
  await settingsApi.set(key, JSON.stringify(value))
}

export function debounce(fn, delayMs = 300) {
  let timer = null
  return (...args) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, delayMs)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm run test -- src/renderer/src/lib/view-state.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/renderer/src/lib/view-state.js src/renderer/src/lib/view-state.test.js
git commit -m "add view state helpers"
```

---

### Task 2: Store Snapshots And Hydration

**Files:**

- Modify: `src/renderer/src/stores/useHubStore.js`
- Modify: `src/renderer/src/stores/useLibraryStore.js`
- Modify: `src/renderer/src/stores/useContentStore.js`

- [ ] **Step 1: Add Hub snapshot and restore methods**

In `src/renderer/src/stores/useHubStore.js`, import the sanitizer:

```js
import { sanitizeHubState } from '@/lib/view-state'
```

Add these methods inside the store object before `fetchFilters`:

```js
  getPersistedState: () => {
    const s = get()
    return {
      search: s.search,
      selectedType: s.selectedType,
      paidFilter: s.paidFilter,
      authorSearch: s.authorSearch,
      selectedHubTags: s.selectedHubTags,
      sort: s.sort,
      license: s.license,
      hideInstalled: s.hideInstalled,
      detailResourceId: s.detailData?.resource_id ?? s.detailResource?.resource_id ?? null,
    }
  },

  applyPersistedState: (raw) => {
    const saved = sanitizeHubState(raw)
    set({
      search: saved.search,
      selectedType: saved.selectedType,
      paidFilter: saved.paidFilter,
      authorSearch: saved.authorSearch,
      selectedHubTags: saved.selectedHubTags,
      sort: saved.sort,
      license: saved.license,
      hideInstalled: saved.hideInstalled,
      pendingDetailResourceId: saved.detailResourceId,
    })
  },

  openDetailById: async (resourceId) => {
    const rid = String(resourceId || '')
    if (!rid) return
    const known = get().resources.find((r) => String(r.resource_id) === rid)
    if (known) {
      await get().openDetail(known)
      return
    }
    set({ detailResource: { resource_id: rid }, detailData: null, detailLoading: true, followingDetailId: null })
    try {
      const detail = await window.api.hub.detail(rid)
      syncInstalledFromDetail(detail)
      set({ detailResource: detail, detailData: detail, detailLoading: false, pendingDetailResourceId: null })
    } catch (err) {
      toast(`Failed to restore hub detail: ${err.message}`)
      set({ detailResource: null, detailData: null, detailLoading: false, pendingDetailResourceId: null })
    }
  },
```

Also add this field near `detailLoading`:

```js
  pendingDetailResourceId: null,
```

- [ ] **Step 2: Add Library snapshot and restore methods**

In `src/renderer/src/stores/useLibraryStore.js`, import:

```js
import { sanitizeLibraryState } from '@/lib/view-state'
```

Add this field near `selectedDetail`:

```js
  pendingRestoreFilename: null,
```

Add these methods before `fetchPackages`:

```js
  getPersistedState: () => {
    const s = get()
    return {
      search: s.search,
      authorSearch: s.authorSearch,
      statusFilter: s.statusFilter,
      enabledFilter: s.enabledFilter,
      selectedTypes: s.selectedTypes,
      selectedTags: s.selectedTags,
      selectedLabelIds: s.selectedLabelIds,
      primarySort: s.primarySort,
      secondarySort: s.secondarySort,
      license: s.license,
      selectedFilename: s.selectedDetail?.filename ?? s.pendingRestoreFilename ?? null,
    }
  },

  applyPersistedState: (raw) => {
    const saved = sanitizeLibraryState(raw)
    set({
      search: saved.search,
      authorSearch: saved.authorSearch,
      statusFilter: saved.statusFilter,
      enabledFilter: saved.enabledFilter,
      selectedTypes: saved.selectedTypes,
      selectedTags: saved.selectedTags,
      selectedLabelIds: saved.selectedLabelIds,
      primarySort: saved.primarySort,
      secondarySort: saved.secondarySort,
      license: saved.license,
      pendingRestoreFilename: saved.selectedFilename,
    })
  },

  consumePendingRestoreFilename: () => {
    const filename = get().pendingRestoreFilename
    set({ pendingRestoreFilename: null })
    return filename
  },
```

- [ ] **Step 3: Add Content snapshot and restore methods**

In `src/renderer/src/stores/useContentStore.js`, import:

```js
import { sanitizeContentState } from '@/lib/view-state'
```

Add this field near `selectedPackage`:

```js
  pendingRestoreItem: null,
```

Add these methods before `fetchContents`:

```js
  getPersistedState: () => {
    const s = get()
    return {
      search: s.search,
      authorSearch: s.authorSearch,
      selectedTypes: s.selectedTypes,
      selectedPackageTypes: s.selectedPackageTypes,
      selectedTags: s.selectedTags,
      selectedLabelIds: s.selectedLabelIds,
      packageFilter: s.packageFilter,
      packageStatusFilter: s.packageStatusFilter,
      visibilityFilter: s.visibilityFilter,
      primarySort: s.primarySort,
      secondarySort: s.secondarySort,
      selectedItemId: s.selectedItem?.id ?? s.pendingRestoreItem?.selectedItemId ?? null,
      selectedPackageFilename: s.selectedItem?.packageFilename ?? s.pendingRestoreItem?.selectedPackageFilename ?? null,
    }
  },

  applyPersistedState: (raw) => {
    const saved = sanitizeContentState(raw)
    set({
      search: saved.search,
      authorSearch: saved.authorSearch,
      selectedTypes: saved.selectedTypes,
      selectedPackageTypes: saved.selectedPackageTypes,
      selectedTags: saved.selectedTags,
      selectedLabelIds: saved.selectedLabelIds,
      packageFilter: saved.packageFilter,
      packageStatusFilter: saved.packageStatusFilter,
      visibilityFilter: saved.visibilityFilter,
      primarySort: saved.primarySort,
      secondarySort: saved.secondarySort,
      pendingRestoreItem:
        saved.selectedItemId != null
          ? { selectedItemId: saved.selectedItemId, selectedPackageFilename: saved.selectedPackageFilename }
          : null,
    })
  },

  consumePendingRestoreItem: () => {
    const item = get().pendingRestoreItem
    set({ pendingRestoreItem: null })
    return item
  },
```

- [ ] **Step 4: Run syntax check**

Run:

```bash
node --check src/renderer/src/stores/useHubStore.js
node --check src/renderer/src/stores/useLibraryStore.js
node --check src/renderer/src/stores/useContentStore.js
```

Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/renderer/src/stores/useHubStore.js src/renderer/src/stores/useLibraryStore.js src/renderer/src/stores/useContentStore.js
git commit -m "persist view store snapshots"
```

---

### Task 3: App Hydration And Keep-Alive Views

**Files:**

- Modify: `src/renderer/src/App.jsx`

- [ ] **Step 1: Import view-state helpers**

Add to `src/renderer/src/App.jsx` imports:

```js
import {
  LAST_VIEW_KEY,
  HUB_STATE_KEY,
  LIBRARY_STATE_KEY,
  CONTENT_STATE_KEY,
  sanitizeLastView,
  readSettingJson,
  writeSettingJson,
  debounce,
} from '@/lib/view-state'
```

- [ ] **Step 2: Add UI hydration and visited view state**

Replace:

```js
const [view, setView] = useState('library')
```

with:

```js
const [view, setView] = useState('library')
const [uiHydrated, setUiHydrated] = useState(false)
const [visitedViews, setVisitedViews] = useState(() => new Set(['library']))
```

Add this helper inside `App` before effects:

```js
const activateView = useCallback((nextView) => {
  const safe = sanitizeLastView(nextView)
  setView(safe)
  setVisitedViews((prev) => {
    if (prev.has(safe)) return prev
    const next = new Set(prev)
    next.add(safe)
    return next
  })
  void window.api.settings.set(LAST_VIEW_KEY, safe)
}, [])
```

- [ ] **Step 3: Hydrate settings before first view render**

Inside the first `useEffect`, replace the three visual hydrate calls:

```js
useHubStore.getState().hydrateHubFilterPreferences()
useLibraryStore.getState().hydrateLibraryVisualPreferences()
useContentStore.getState().hydrateContentVisualPreferences()
```

with:

```js
;(async () => {
  const [lastView, hubState, libraryState, contentState] = await Promise.all([
    window.api.settings.get(LAST_VIEW_KEY),
    readSettingJson(window.api.settings, HUB_STATE_KEY, null),
    readSettingJson(window.api.settings, LIBRARY_STATE_KEY, null),
    readSettingJson(window.api.settings, CONTENT_STATE_KEY, null),
    useHubStore.getState().hydrateHubFilterPreferences(),
    useLibraryStore.getState().hydrateLibraryVisualPreferences(),
    useContentStore.getState().hydrateContentVisualPreferences(),
  ])
  useHubStore.getState().applyPersistedState(hubState)
  useLibraryStore.getState().applyPersistedState(libraryState)
  useContentStore.getState().applyPersistedState(contentState)
  const safeView = sanitizeLastView(lastView)
  setView(safeView)
  setVisitedViews(new Set(['library', safeView]))
  setUiHydrated(true)
})()
```

Move the `void useLibraryStore.getState().fetchPackages()` call so it runs after `setUiHydrated(true)` in the async block:

```js
void useLibraryStore.getState().fetchPackages()
```

- [ ] **Step 4: Subscribe to store snapshots**

Still inside the first `useEffect`, after event subscriptions are created, add:

```js
const saveHubState = debounce(() => {
  void writeSettingJson(window.api.settings, HUB_STATE_KEY, useHubStore.getState().getPersistedState())
})
const saveLibraryState = debounce(() => {
  void writeSettingJson(window.api.settings, LIBRARY_STATE_KEY, useLibraryStore.getState().getPersistedState())
})
const saveContentState = debounce(() => {
  void writeSettingJson(window.api.settings, CONTENT_STATE_KEY, useContentStore.getState().getPersistedState())
})
const cleanupHubPersist = useHubStore.subscribe(saveHubState)
const cleanupLibraryPersist = useLibraryStore.subscribe(saveLibraryState)
const cleanupContentPersist = useContentStore.subscribe(saveContentState)
```

Add these cleanups to the returned cleanup block:

```js
cleanupHubPersist()
cleanupLibraryPersist()
cleanupContentPersist()
```

- [ ] **Step 5: Use `activateView` everywhere**

In `navigateTo`, replace:

```js
setView(targetView)
```

with:

```js
activateView(targetView)
```

In ribbon click handlers, replace each `setView(...)` with `activateView(...)`.

- [ ] **Step 6: Block first render until UI state loads**

Replace:

```js
if (showWizard === null) {
  return <div className="h-full bg-base" />
}
```

with:

```js
if (showWizard === null || !uiHydrated) {
  return <div className="h-full bg-base" />
}
```

- [ ] **Step 7: Keep visited views mounted**

Replace the conditional view render block:

```jsx
{
  view === 'hub' && <HubView onNavigate={navigateTo} />
}
{
  view === 'library' && <LibraryView onNavigate={navigateTo} navContext={navContextRef} />
}
{
  view === 'content' && <ContentView onNavigate={navigateTo} navContext={navContextRef} />
}
{
  view === 'settings' && <SettingsView />
}
```

with:

```jsx
{
  visitedViews.has('hub') && (
    <div className={view === 'hub' ? 'h-full' : 'hidden'}>
      <HubView active={view === 'hub'} onNavigate={navigateTo} />
    </div>
  )
}
{
  visitedViews.has('library') && (
    <div className={view === 'library' ? 'h-full' : 'hidden'}>
      <LibraryView active={view === 'library'} onNavigate={navigateTo} navContext={navContextRef} />
    </div>
  )
}
{
  visitedViews.has('content') && (
    <div className={view === 'content' ? 'h-full' : 'hidden'}>
      <ContentView active={view === 'content'} onNavigate={navigateTo} navContext={navContextRef} />
    </div>
  )
}
{
  visitedViews.has('settings') && (
    <div className={view === 'settings' ? 'h-full' : 'hidden'}>
      <SettingsView />
    </div>
  )
}
```

- [ ] **Step 8: Run syntax check**

Run:

```bash
node --check src/renderer/src/App.jsx
```

Expected: no output, exit code 0.

- [ ] **Step 9: Commit**

Run:

```bash
git add src/renderer/src/App.jsx
git commit -m "restore last app view"
```

---

### Task 4: Library Selection Restore

**Files:**

- Modify: `src/renderer/src/views/LibraryView.jsx`

- [ ] **Step 1: Accept `active` prop**

Change the function signature:

```js
export default function LibraryView({ active, onNavigate, navContext }) {
```

- [ ] **Step 2: Restore saved package after filtered data is ready**

After `filtered` is computed and before keyboard handlers, add:

```js
const restoredLibraryRef = useRef(false)
useEffect(() => {
  if (!active || restoredLibraryRef.current || !packagesLoaded || bulkActive || statusFilter === 'missing') return
  const filename = useLibraryStore.getState().pendingRestoreFilename
  if (!filename) {
    restoredLibraryRef.current = true
    return
  }
  if (!packages.some((p) => p.filename === filename)) {
    useLibraryStore.getState().consumePendingRestoreFilename()
    restoredLibraryRef.current = true
    return
  }
  const visible = filtered.some((p) => p.filename === filename)
  useLibraryStore.getState().consumePendingRestoreFilename()
  restoredLibraryRef.current = true
  if (visible) void selectPackage(filename)
}, [active, packagesLoaded, bulkActive, statusFilter, packages, filtered, selectPackage])
```

- [ ] **Step 3: Avoid auto-select racing restore**

In the existing auto-selection effect that starts with:

```js
useEffect(() => {
  if (bulkActive || statusFilter === 'missing' || filtered.length === 0) {
```

insert at the top:

```js
if (!active || useLibraryStore.getState().pendingRestoreFilename) return
```

- [ ] **Step 4: Run syntax check**

Run:

```bash
node --check src/renderer/src/views/LibraryView.jsx
```

Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/renderer/src/views/LibraryView.jsx
git commit -m "restore library selection"
```

---

### Task 5: Content Selection Restore

**Files:**

- Modify: `src/renderer/src/views/ContentView.jsx`

- [ ] **Step 1: Accept `active` prop**

Change the function signature:

```js
export default function ContentView({ active, onNavigate, navContext }) {
```

- [ ] **Step 2: Restore saved content item after filtered data is ready**

After `filtered` is computed and before keyboard handlers, add:

```js
const restoredContentRef = useRef(false)
useEffect(() => {
  if (!active || restoredContentRef.current || bulkActive || contents.length === 0) return
  const pending = useContentStore.getState().pendingRestoreItem
  if (!pending) {
    restoredContentRef.current = true
    return
  }
  const wantedId = String(pending.selectedItemId)
  const visible = filtered.find((c) => String(c.id) === wantedId)
  const samePackage = pending.selectedPackageFilename
    ? contents.find((c) => String(c.id) === wantedId && c.packageFilename === pending.selectedPackageFilename)
    : contents.find((c) => String(c.id) === wantedId)
  useContentStore.getState().consumePendingRestoreItem()
  restoredContentRef.current = true
  if (visible) void selectItem(visible)
  else if (samePackage) void selectItem(samePackage)
}, [active, bulkActive, contents, filtered, selectItem])
```

- [ ] **Step 3: Avoid auto-select racing restore**

In the existing auto-selection effect that starts with:

```js
useEffect(() => {
  if (bulkActive || filtered.length === 0) {
```

insert at the top:

```js
if (!active || useContentStore.getState().pendingRestoreItem) return
```

- [ ] **Step 4: Run syntax check**

Run:

```bash
node --check src/renderer/src/views/ContentView.jsx
```

Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/renderer/src/views/ContentView.jsx
git commit -m "restore content selection"
```

---

### Task 6: Hub Filter And Detail Restore

**Files:**

- Modify: `src/renderer/src/views/HubView.jsx`

- [ ] **Step 1: Accept `active` prop**

Change the function signature:

```js
export default function HubView({ active, onNavigate }) {
```

- [ ] **Step 2: Gate initial Hub fetch to active view**

In the filter-change fetch effect, replace:

```js
if (!sort) return
```

with:

```js
if (!active || !sort) return
```

Add `active` to that effect dependency list.

- [ ] **Step 3: Restore saved detail once**

After the packages-updated effect, add:

```js
const restoredHubDetailRef = useRef(false)
useEffect(() => {
  if (!active || restoredHubDetailRef.current) return
  const rid = useHubStore.getState().pendingDetailResourceId
  if (!rid) {
    restoredHubDetailRef.current = true
    return
  }
  restoredHubDetailRef.current = true
  void useHubStore.getState().openDetailById(rid)
}, [active])
```

- [ ] **Step 4: Keep manual Hub nav behavior**

In `App.jsx`, keep this existing behavior unchanged:

```js
if (targetView === 'hub') {
  if (context?.openResource) {
    useHubStore.getState().openDetail(context.openResource)
  } else {
    useHubStore.getState().closeDetail()
  }
  navContextRef.current = null
}
```

Reason: explicit navigation to Hub without a resource should still show Hub gallery. Relaunch restore uses `pendingDetailResourceId`, not this path.

- [ ] **Step 5: Run syntax check**

Run:

```bash
node --check src/renderer/src/views/HubView.jsx
```

Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/renderer/src/views/HubView.jsx
git commit -m "restore hub filters and detail"
```

---

### Task 7: One-Shot Scroll To Restored Selection

**Files:**

- Modify: `src/renderer/src/components/VirtualGrid.jsx`
- Modify: `src/renderer/src/views/LibraryView.jsx`
- Modify: `src/renderer/src/views/ContentView.jsx`

- [ ] **Step 1: Extend `VirtualGrid` props**

Change the `VirtualGrid` signature to include:

```js
  restoreIndex = null,
  restoreKey = '',
```

Add this effect after `useLayoutEffect` that resets on `scrollResetKey`:

```js
useLayoutEffect(() => {
  if (restoreIndex == null || restoreIndex < 0) return
  const el = scrollRef.current
  if (!el) return
  const { cols, cellWidth } = layoutRef.current
  const rowH = calcRowHeight(cellWidth) + rowGap
  const row = Math.floor(restoreIndex / Math.max(1, cols))
  suppressAnchorRef.current = true
  el.scrollTop = padding + row * rowH
  anchorRef.current = row * cols
  requestAnimationFrame(() => {
    suppressAnchorRef.current = false
  })
}, [restoreIndex, restoreKey, calcRowHeight, rowGap, padding])
```

- [ ] **Step 2: Extend `VirtualList` props**

Change the `VirtualList` signature to include:

```js
export function VirtualList({
  items,
  rowHeight = 37,
  renderRow,
  className = '',
  overscan = 5,
  scrollResetKey,
  restoreIndex = null,
  restoreKey = '',
}) {
```

Add this effect after the `scrollResetKey` effect:

```js
useLayoutEffect(() => {
  if (restoreIndex == null || restoreIndex < 0) return
  const el = scrollRef.current
  if (!el) return
  el.scrollTop = restoreIndex * rowHeight
}, [restoreIndex, restoreKey, rowHeight])
```

- [ ] **Step 3: Pass restore index from Library**

In `LibraryView.jsx`, add:

```js
const [restoreScrollKey, setRestoreScrollKey] = useState('')
```

When saved package is visible and before `selectPackage(filename)`, add:

```js
setRestoreScrollKey(filename)
```

Pass these props to both Library `VirtualGrid` and `VirtualList`:

```jsx
restoreIndex = { selectedIdx }
restoreKey = { restoreScrollKey }
```

- [ ] **Step 4: Pass restore index from Content**

In `ContentView.jsx`, add:

```js
const [restoreScrollKey, setRestoreScrollKey] = useState('')
```

When saved content item is visible and before `selectItem(visible)`, add:

```js
setRestoreScrollKey(String(visible.id))
```

Pass these props to both Content `VirtualGrid` and `VirtualList`:

```jsx
restoreIndex = { selectedIdx }
restoreKey = { restoreScrollKey }
```

- [ ] **Step 5: Run syntax check**

Run:

```bash
node --check src/renderer/src/components/VirtualGrid.jsx
node --check src/renderer/src/views/LibraryView.jsx
node --check src/renderer/src/views/ContentView.jsx
```

Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/renderer/src/components/VirtualGrid.jsx src/renderer/src/views/LibraryView.jsx src/renderer/src/views/ContentView.jsx
git commit -m "scroll to restored selection"
```

---

### Task 8: Manual Verification And Regression Checks

**Files:**

- Verify: `src/renderer/src/App.jsx`
- Verify: `src/renderer/src/views/HubView.jsx`
- Verify: `src/renderer/src/views/LibraryView.jsx`
- Verify: `src/renderer/src/views/ContentView.jsx`
- Verify: `src/renderer/src/lib/view-state.test.js`

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm run test -- src/renderer/src/lib/view-state.test.js
```

Expected: PASS.

- [ ] **Step 2: Run project checks**

Run:

```bash
npm run lint
npm run format:check
npm run test
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Manual app check**

Run:

```bash
npm run start
```

Expected:

- App opens to last active view.
- Switch Library -> Hub -> Library without Library jumping to top.
- Change Library filters, select package, close app, run `npm run start`; Library filters and selected package restore.
- Change Content filters, select item, close app, run `npm run start`; Content filters and selected item restore.
- Change Hub filters, open detail, close app, run `npm run start`; Hub opens with saved filters and detail restored.
- Remove or hide the saved selected item through filters; app restores filters and shows no crash or stale detail.

- [ ] **Step 4: Final commit**

Run:

```bash
git status --short
git add src/renderer/src/lib/view-state.js src/renderer/src/lib/view-state.test.js src/renderer/src/App.jsx src/renderer/src/stores/useHubStore.js src/renderer/src/stores/useLibraryStore.js src/renderer/src/stores/useContentStore.js src/renderer/src/views/HubView.jsx src/renderer/src/views/LibraryView.jsx src/renderer/src/views/ContentView.jsx src/renderer/src/components/VirtualGrid.jsx
git commit -m "restore view state"
```

If earlier task commits were already made, this final commit should have no staged source changes.

---

## Self-Review

- Spec coverage: last active view, per-view filter persistence, selected item/detail restore, no jump on view switch, relaunch restore, and stale item fallback are covered by Tasks 2-8.
- Placeholder scan: no placeholder markers or incomplete implementation steps remain.
- Type consistency: persisted state uses `detailResourceId`, `selectedFilename`, `selectedItemId`, and `selectedPackageFilename` consistently across helper, stores, and views.
- Scope control: downloads panel restore, exact pixel scroll, and replaying arbitrary Hub pages are excluded to keep the first implementation small and testable.
