# Hub Paged Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Hub browsing-mode toggle so infinite scroll remains default, paged mode restores exact page, and users can switch modes from the Hub toolbar.

**Architecture:** Extend the existing Hub store and view-state JSON with `browseMode` and `page`. Keep Hub API calls unchanged; paged mode fetches one page into `resources`, infinite mode appends pages. The toolbar owns mode switching and compact pagination controls.

**Tech Stack:** Electron renderer, React, Zustand, Vitest, lucide-react.

---

### Task 1: Persist Hub Browse Mode And Page

**Files:**

- Modify: `src/renderer/src/lib/view-state.js`
- Modify: `src/renderer/src/lib/view-state.test.js`

- [ ] **Step 1: Add failing sanitizer coverage**

Add to `normalizes hub state` input:

```js
browseMode: 'paged',
page: 7,
```

Add to expected output:

```js
browseMode: 'paged',
page: 7,
```

Add invalid checks:

```js
expect(sanitizeHubState({ browseMode: 'bad', page: -3 })).toMatchObject({ browseMode: 'infinite', page: 1 })
```

- [ ] **Step 2: Run focused test to see failure**

Run: `npm run test -- src/renderer/src/lib/view-state.test.js`

Expected: fails because `browseMode` and `page` are missing.

- [ ] **Step 3: Implement sanitizer fields**

In `view-state.js`, add:

```js
const VALID_HUB_BROWSE_MODE = new Set(['infinite', 'paged'])
const page = (value) => {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 ? n : 1
}
```

In `sanitizeHubState`, add:

```js
browseMode: VALID_HUB_BROWSE_MODE.has(r.browseMode) ? r.browseMode : 'infinite',
page: page(r.page),
```

- [ ] **Step 4: Verify focused test passes**

Run: `npm run test -- src/renderer/src/lib/view-state.test.js`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/view-state.js src/renderer/src/lib/view-state.test.js
git commit -m "persist hub browse mode"
```

### Task 2: Add Store Support For Paged Fetching

**Files:**

- Modify: `src/renderer/src/stores/useHubStore.js`

- [ ] **Step 1: Add Hub store mode and page snapshot**

Add state:

```js
browseMode: 'infinite',
```

Add actions:

```js
setBrowseMode: (browseMode) => set({ browseMode: browseMode === 'paged' ? 'paged' : 'infinite' }),
goToPage: (page) => get().fetchResources(true, { page }),
```

Add to `getPersistedState`:

```js
browseMode: s.browseMode,
page: s.page,
```

Add to `applyPersistedState`:

```js
browseMode: saved.browseMode,
page: saved.page,
```

- [ ] **Step 2: Make `fetchResources` page-aware**

Replace page selection and resource merge logic with:

```js
const requestedPage = Math.max(1, Number(opts?.page ?? (resetPage ? 1 : state.page)) || 1)
const append = opts?.append === true
if (state.page !== requestedPage) set({ page: requestedPage })
set({ loading: true, error: null, ...(append ? {} : { resources: [] }) })
```

Use API params:

```js
const params = { page: requestedPage, perpage: 30 }
```

Set results:

```js
resources: append ? [...get().resources, ...incoming] : incoming,
```

- [ ] **Step 3: Make infinite next-page fetch explicit**

Replace `fetchNextPage` with:

```js
fetchNextPage: () => {
  const { page, totalPages, loading } = get()
  if (loading || page >= totalPages) return
  void get().fetchResources(false, { page: page + 1, append: true })
},
```

- [ ] **Step 4: Reset mode-safe filters**

In `resetFilters`, add:

```js
page: 1,
```

Do not change `browseMode` on reset.

- [ ] **Step 5: Syntax check and commit**

Run: `node --check src/renderer/src/stores/useHubStore.js`

Expected: exit code 0.

```bash
git add src/renderer/src/stores/useHubStore.js
git commit -m "add hub paged fetch support"
```

### Task 3: Add Hub Toolbar Mode Toggle And Paging Controls

**Files:**

- Modify: `src/renderer/src/views/HubView.jsx`

- [ ] **Step 1: Import icons and store fields**

Add lucide imports:

```js
Infinity,
BookOpen,
ChevronLeft,
```

Read store fields/actions:

```js
browseMode,
setBrowseMode,
goToPage,
setPage,
```

- [ ] **Step 2: Replace automatic page-effect fetch**

Remove the page-change effect:

```js
const pageRef = useRef(page)
useEffect(() => {
  if (!active) return
  if (pageRef.current === page) return
  pageRef.current = page
  useHubStore.getState().fetchResources()
}, [active, page])
```

- [ ] **Step 3: Make initial/filter fetch mode-aware**

Add before the filter effect:

```js
const firstFetchRef = useRef(true)
```

Use this effect body:

```js
if (!active) return
if (!sort) return
if (fetchedFilterKeyRef.current === hubFetchKey) return
const firstFetch = firstFetchRef.current
firstFetchRef.current = false
fetchedFilterKeyRef.current = hubFetchKey
const targetPage = firstFetch && browseMode === 'paged' ? page : 1
useHubStore.getState().fetchResources(true, { page: targetPage })
```

- [ ] **Step 4: Add top-visible page helper**

Add:

```js
const topVisiblePage = useCallback(() => {
  const root = galleryRef.current
  if (!root) return page
  const rootTop = root.getBoundingClientRect().top
  const cards = root.querySelectorAll('[data-hub-resource-index]')
  for (const card of cards) {
    if (card.getBoundingClientRect().bottom <= rootTop + 8) continue
    const index = Number(card.dataset.hubResourceIndex)
    return Number.isInteger(index) ? Math.floor(index / 30) + 1 : page
  }
  return page
}, [page])
```

- [ ] **Step 5: Add mode toggle handler**

Add:

```js
const toggleBrowseMode = useCallback(() => {
  const store = useHubStore.getState()
  if (browseMode === 'infinite') {
    const nextPage = topVisiblePage()
    setBrowseMode('paged')
    galleryRef.current?.scrollTo({ top: 0 })
    void store.fetchResources(true, { page: nextPage })
  } else {
    setBrowseMode('infinite')
    galleryRef.current?.scrollTo({ top: 0 })
    void store.fetchResources(true, { page: 1 })
  }
}, [browseMode, setBrowseMode, topVisiblePage])
```

- [ ] **Step 6: Add page controls**

Add helper:

```js
const goPagedPage = useCallback(
  (nextPage) => {
    galleryRef.current?.scrollTo({ top: 0 })
    goToPage(nextPage)
  },
  [goToPage],
)
```

Add near the thumbnail-size slider and card-size buttons:

```jsx
;<button
  type="button"
  onClick={toggleBrowseMode}
  title={browseMode === 'infinite' ? 'Infinite scroll' : 'Paged browsing'}
  className="p-1.5 rounded cursor-pointer text-text-tertiary hover:text-text-primary hover:bg-elevated"
>
  {browseMode === 'infinite' ? <Infinity size={14} /> : <BookOpen size={14} />}
</button>
{
  browseMode === 'paged' && (
    <div className="flex items-center gap-1 text-[11px] text-text-tertiary">
      <button
        type="button"
        disabled={loading || page <= 1}
        onClick={() => goPagedPage(page - 1)}
        className="p-1 rounded disabled:opacity-30 hover:bg-elevated"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="tabular-nums whitespace-nowrap">
        {page} / {Math.max(totalPages, 1)}
      </span>
      <button
        type="button"
        disabled={loading || page >= totalPages}
        onClick={() => goPagedPage(page + 1)}
        className="p-1 rounded disabled:opacity-30 hover:bg-elevated"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  )
}
```

- [ ] **Step 7: Add data index and gate infinite sentinel**

Wrap HubCard map item:

```jsx
{visibleResources.map((r, i) => (
<div key={r.resource_id} data-hub-resource-index={browseMode === 'infinite' ? i : (page - 1) * 30 + i}>
  <HubCard ... />
</div>
))}
```

Render sentinel/loading-more only in infinite mode:

```jsx
{browseMode === 'infinite' && page < totalPages && <div ref={sentinelRef} className="h-1" />}
{browseMode === 'infinite' && loading && resources.length > 0 && (...)}
```

- [ ] **Step 8: Lint and commit**

Run: `npx eslint src/renderer/src/views/HubView.jsx`

Expected: exit code 0.

```bash
git add src/renderer/src/views/HubView.jsx
git commit -m "add hub paging controls"
```

### Task 4: Verify Full Feature

**Files:**

- Verify: all changed files

- [ ] **Step 1: Run focused tests**

Run: `npm run test -- src/renderer/src/lib/view-state.test.js`

Expected: pass.

- [ ] **Step 2: Run full checks**

Run:

```bash
npm test
npm run lint
npm run format:check
npm run build
```

Expected: all pass.

- [ ] **Step 3: Inspect branch diff**

Run:

```bash
git status --short --branch
git diff --stat feature/restore-view-state..HEAD
```

Expected: clean worktree; diff only supports Hub paged mode.
