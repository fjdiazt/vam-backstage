# Local View Page Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Hub-style top visual-page controls to Library and Content virtual scrolling.

**Architecture:** Keep Library and Content as virtual scrolling views. VirtualGrid and VirtualList report visible page metrics; views calculate target indexes and reuse existing `restoreIndex` / `restoreKey` scrolling. A small shared pager component renders the controls.

**Tech Stack:** React, Zustand, lucide-react, Vitest, electron-vite.

**Commit policy:** Do not commit unless the user asks. This plan intentionally omits commit steps.

---

## File Structure

- Create: `src/renderer/src/lib/local-page-nav.js`
  - Pure page math for local visual pages.
- Create: `src/renderer/src/lib/local-page-nav.test.js`
  - Unit tests for page count, current page, target index, and render gate.
- Create: `src/renderer/src/components/LocalPageNav.jsx`
  - Shared first/previous/input/next/last pager.
- Modify: `src/renderer/src/components/VirtualGrid.jsx`
  - Add optional `onPageMetricsChange` prop; report visual page size from columns, row height, and viewport height.
- Modify: `src/renderer/src/components/VirtualGrid.jsx`
  - Add optional `onPageMetricsChange` prop to `VirtualList`; report visual page size from row height and viewport height.
- Modify: `src/renderer/src/views/LibraryView.jsx`
  - Track first visible index and metrics; render centered local pager in normal toolbar; jump by setting transient restore index/key.
- Modify: `src/renderer/src/views/ContentView.jsx`
  - Same as Library for content items.
- Modify: `src/renderer/src/views/HubView.test.js` only if existing static import assumptions break; prefer no Hub change.

---

### Task 1: Add Local Page Math

**Files:**

- Create: `src/renderer/src/lib/local-page-nav.js`
- Create: `src/renderer/src/lib/local-page-nav.test.js`

- [ ] **Step 1: Write failing tests**

```js
import { describe, expect, it } from 'vitest'
import {
  getLocalPageCount,
  getLocalCurrentPage,
  getLocalPageTargetIndex,
  shouldRenderLocalPageNav,
} from './local-page-nav'

describe('local page nav math', () => {
  it('counts visual pages from total items and page size', () => {
    expect(getLocalPageCount(0, 20)).toBe(1)
    expect(getLocalPageCount(1, 20)).toBe(1)
    expect(getLocalPageCount(20, 20)).toBe(1)
    expect(getLocalPageCount(21, 20)).toBe(2)
  })

  it('resolves current page from the first visible index', () => {
    expect(getLocalCurrentPage(0, 20, 100)).toBe(1)
    expect(getLocalCurrentPage(19, 20, 100)).toBe(1)
    expect(getLocalCurrentPage(20, 20, 100)).toBe(2)
    expect(getLocalCurrentPage(999, 20, 100)).toBe(5)
  })

  it('clamps target indexes to the available list', () => {
    expect(getLocalPageTargetIndex(1, 20, 95)).toBe(0)
    expect(getLocalPageTargetIndex(3, 20, 95)).toBe(40)
    expect(getLocalPageTargetIndex(99, 20, 95)).toBe(80)
    expect(getLocalPageTargetIndex(-5, 20, 95)).toBe(0)
  })

  it('hides controls when only one visual page exists', () => {
    expect(shouldRenderLocalPageNav(20, 20)).toBe(false)
    expect(shouldRenderLocalPageNav(21, 20)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
npm test -- src/renderer/src/lib/local-page-nav.test.js
```

Expected: FAIL because `local-page-nav.js` does not exist.

- [ ] **Step 3: Implement minimal helper**

```js
export function getLocalPageCount(totalItems, pageSize) {
  const total = Math.max(0, Number(totalItems) || 0)
  const size = Math.max(1, Number(pageSize) || 1)
  return Math.max(1, Math.ceil(total / size))
}

export function getLocalCurrentPage(firstVisibleIndex, pageSize, totalItems) {
  const maxPage = getLocalPageCount(totalItems, pageSize)
  const size = Math.max(1, Number(pageSize) || 1)
  const index = Math.max(0, Number(firstVisibleIndex) || 0)
  return Math.min(maxPage, Math.floor(index / size) + 1)
}

export function getLocalPageTargetIndex(page, pageSize, totalItems) {
  const maxPage = getLocalPageCount(totalItems, pageSize)
  const targetPage = Math.min(maxPage, Math.max(1, Number(page) || 1))
  const size = Math.max(1, Number(pageSize) || 1)
  return Math.min(Math.max(0, totalItems - 1), (targetPage - 1) * size)
}

export function shouldRenderLocalPageNav(totalItems, pageSize) {
  return getLocalPageCount(totalItems, pageSize) > 1
}
```

- [ ] **Step 4: Verify helper tests pass**

Run:

```powershell
npm test -- src/renderer/src/lib/local-page-nav.test.js
```

Expected: PASS, 4 tests.

---

### Task 2: Add Shared Local Pager Component

**Files:**

- Create: `src/renderer/src/components/LocalPageNav.jsx`

- [ ] **Step 1: Create component**

```jsx
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

export function LocalPageNav({ page, pageCount, disabled = false, onPageChange }) {
  const [draft, setDraft] = useState(String(page))

  useEffect(() => {
    setDraft(String(page))
  }, [page])

  if (pageCount <= 1) return null

  const go = (nextPage) => {
    const n = Math.min(pageCount, Math.max(1, Number(nextPage) || 1))
    onPageChange(n)
  }

  const iconClass =
    'h-8 w-8 rounded flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-elevated disabled:opacity-30 cursor-pointer disabled:cursor-default'

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center justify-center gap-1">
      <button
        type="button"
        disabled={disabled || page <= 1}
        onClick={() => go(1)}
        title="First page"
        aria-label="First page"
        className={iconClass}
      >
        <ChevronsLeft size={17} />
      </button>
      <button
        type="button"
        disabled={disabled || page <= 1}
        onClick={() => go(page - 1)}
        title="Previous page"
        aria-label="Previous page"
        className={iconClass}
      >
        <ChevronLeft size={18} />
      </button>
      <span className="h-8 flex items-center gap-1 rounded px-2 text-xs text-text-tertiary">
        <span>Page</span>
        <input
          type="number"
          min="1"
          max={pageCount}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => go(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          aria-label="Page"
          className="h-6 w-16 rounded border border-input bg-elevated px-2 text-right text-xs tabular-nums text-text-primary outline-none focus:border-ring/50 disabled:opacity-50"
        />
        <span className="tabular-nums">of {pageCount.toLocaleString()}</span>
      </span>
      <button
        type="button"
        disabled={disabled || page >= pageCount}
        onClick={() => go(page + 1)}
        title="Next page"
        aria-label="Next page"
        className={iconClass}
      >
        <ChevronRight size={18} />
      </button>
      <button
        type="button"
        disabled={disabled || page >= pageCount}
        onClick={() => go(pageCount)}
        title="Last page"
        aria-label="Last page"
        className={iconClass}
      >
        <ChevronsRight size={17} />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Run lint on new component**

Run:

```powershell
npm run lint -- src/renderer/src/components/LocalPageNav.jsx
```

Expected: PASS.

---

### Task 3: Report Visual Page Metrics From Virtualizers

**Files:**

- Modify: `src/renderer/src/components/VirtualGrid.jsx`

- [ ] **Step 1: Add optional prop and metric refs**

In `VirtualGrid` props add:

```jsx
  onPageMetricsChange,
```

Near `onFirstVisibleIndexChangeRef` add:

```jsx
const lastPageMetricsRef = useRef(null)
```

- [ ] **Step 2: Add grid metric emitter**

Inside `VirtualGrid`, after `calcRowHeight`, add:

```jsx
const emitPageMetrics = useCallback(
  (el, cols, cellWidth) => {
    if (!onPageMetricsChange) return
    const rowH = calcRowHeight(cellWidth) + rowGap
    const visibleRows = Math.max(1, Math.floor(Math.max(1, el.clientHeight - padding * 2 + rowGap) / rowH))
    const pageSize = Math.max(1, visibleRows * Math.max(1, cols))
    const next = { pageSize }
    const prev = lastPageMetricsRef.current
    if (prev?.pageSize === next.pageSize) return
    lastPageMetricsRef.current = next
    onPageMetricsChange(next)
  },
  [calcRowHeight, onPageMetricsChange, padding, rowGap],
)
```

- [ ] **Step 3: Emit metrics during grid measure**

In `measure`, after destructuring `measured`, add:

```jsx
emitPageMetrics(el, newCols, newCellWidth)
```

Update the `measure` dependency array to include `emitPageMetrics`.

- [ ] **Step 4: Add optional prop and metric refs to `VirtualList`**

In `VirtualList` props add:

```jsx
  onPageMetricsChange,
```

Near `onFirstVisibleIndexChangeRef` add:

```jsx
const lastPageMetricsRef = useRef(null)
```

- [ ] **Step 5: Add list metric effect**

In `VirtualList`, after the `virtualizer.measure()` effect, add:

```jsx
useEffect(() => {
  if (!onPageMetricsChange) return
  const el = scrollRef.current
  if (!el) return
  const pageSize = Math.max(1, Math.floor(Math.max(1, el.clientHeight) / rowHeight))
  const next = { pageSize }
  const prev = lastPageMetricsRef.current
  if (prev?.pageSize === next.pageSize) return
  lastPageMetricsRef.current = next
  onPageMetricsChange(next)
}, [onPageMetricsChange, rowHeight])
```

- [ ] **Step 6: Verify existing scroll tests still pass**

Run:

```powershell
npm test -- src/renderer/src/lib/view-scroll-anchor.test.js src/renderer/src/stores/view-scroll-anchor.test.js
```

Expected: PASS.

---

### Task 4: Wire Library Toolbar Pager

**Files:**

- Modify: `src/renderer/src/views/LibraryView.jsx`

- [ ] **Step 1: Add imports**

Add imports:

```jsx
import { LocalPageNav } from '@/components/LocalPageNav'
import {
  getLocalCurrentPage,
  getLocalPageCount,
  getLocalPageTargetIndex,
  shouldRenderLocalPageNav,
} from '@/lib/local-page-nav'
```

- [ ] **Step 2: Add local pager state**

Near existing `gridLayout` / `restoreScrollKey` state add:

```jsx
const [firstVisibleIndex, setFirstVisibleIndex] = useState(0)
const [pageMetrics, setPageMetrics] = useState({ pageSize: 1 })
const [manualRestoreIndex, setManualRestoreIndex] = useState(null)
```

- [ ] **Step 3: Use manual restore index when present**

After `restoreIdx` add:

```jsx
const effectiveRestoreIdx = manualRestoreIndex ?? restoreIdx
const localPageCount = getLocalPageCount(filtered.length, pageMetrics.pageSize)
const localPage = getLocalCurrentPage(firstVisibleIndex, pageMetrics.pageSize, filtered.length)
const showLocalPageNav = statusFilter !== 'missing' && shouldRenderLocalPageNav(filtered.length, pageMetrics.pageSize)
```

Use `effectiveRestoreIdx` for both `VirtualGrid` and `VirtualList` `restoreIndex` props.

- [ ] **Step 4: Update first-visible handler**

Inside `handleFirstVisibleIndexChange`, before resolving `pkg`, add:

```jsx
setFirstVisibleIndex(index)
if (manualRestoreIndex != null) setManualRestoreIndex(null)
```

Add `manualRestoreIndex` to the dependency array.

- [ ] **Step 5: Add page jump handler**

Near `handleFirstVisibleIndexChange`, add:

```jsx
const handleLocalPageChange = useCallback(
  (nextPage) => {
    const targetIndex = getLocalPageTargetIndex(nextPage, pageMetrics.pageSize, filtered.length)
    const pkg = filtered[targetIndex]
    if (!pkg) return
    setManualRestoreIndex(targetIndex)
    setRestoreScrollKey(`local-page:${targetIndex}:${pkg.filename}:${++restoreNonceRef.current}`)
  },
  [filtered, pageMetrics.pageSize],
)
```

- [ ] **Step 6: Render centered pager in normal toolbar**

Replace the single flex spacer before right controls with:

```jsx
<div className="flex min-w-[220px] flex-1 items-center justify-center">
  {showLocalPageNav && (
    <LocalPageNav page={localPage} pageCount={localPageCount} onPageChange={handleLocalPageChange} />
  )}
</div>
```

Keep the existing right controls after this block.

- [ ] **Step 7: Pass page metrics callback**

On Library `VirtualGrid` and `VirtualList`, add:

```jsx
onPageMetricsChange = { setPageMetrics }
```

- [ ] **Step 8: Verify Library compiles**

Run:

```powershell
npm run lint -- src/renderer/src/views/LibraryView.jsx src/renderer/src/components/LocalPageNav.jsx
```

Expected: PASS.

---

### Task 5: Wire Content Toolbar Pager

**Files:**

- Modify: `src/renderer/src/views/ContentView.jsx`

- [ ] **Step 1: Add imports**

Add imports:

```jsx
import { LocalPageNav } from '@/components/LocalPageNav'
import {
  getLocalCurrentPage,
  getLocalPageCount,
  getLocalPageTargetIndex,
  shouldRenderLocalPageNav,
} from '@/lib/local-page-nav'
```

- [ ] **Step 2: Add local pager state**

Near existing `gridLayout` / `restoreScrollKey` state add:

```jsx
const [firstVisibleIndex, setFirstVisibleIndex] = useState(0)
const [pageMetrics, setPageMetrics] = useState({ pageSize: 1 })
const [manualRestoreIndex, setManualRestoreIndex] = useState(null)
```

- [ ] **Step 3: Derive page state**

After `restoreIdx` add:

```jsx
const effectiveRestoreIdx = manualRestoreIndex ?? restoreIdx
const localPageCount = getLocalPageCount(filtered.length, pageMetrics.pageSize)
const localPage = getLocalCurrentPage(firstVisibleIndex, pageMetrics.pageSize, filtered.length)
const showLocalPageNav = shouldRenderLocalPageNav(filtered.length, pageMetrics.pageSize)
```

Use `effectiveRestoreIdx` for both `VirtualGrid` and `VirtualList` `restoreIndex` props.

- [ ] **Step 4: Update first-visible handler**

Inside `handleFirstVisibleIndexChange`, before resolving `item`, add:

```jsx
setFirstVisibleIndex(index)
if (manualRestoreIndex != null) setManualRestoreIndex(null)
```

Add `manualRestoreIndex` to the dependency array.

- [ ] **Step 5: Add page jump handler**

Near `handleFirstVisibleIndexChange`, add:

```jsx
const handleLocalPageChange = useCallback(
  (nextPage) => {
    const targetIndex = getLocalPageTargetIndex(nextPage, pageMetrics.pageSize, filtered.length)
    const item = filtered[targetIndex]
    if (!item) return
    setManualRestoreIndex(targetIndex)
    setRestoreScrollKey(
      `local-page:${targetIndex}:${item.id}:${item.packageFilename ?? ''}:${++restoreNonceRef.current}`,
    )
  },
  [filtered, pageMetrics.pageSize],
)
```

- [ ] **Step 6: Render centered pager in normal toolbar**

Replace the single flex spacer before right controls with:

```jsx
<div className="flex min-w-[220px] flex-1 items-center justify-center">
  {showLocalPageNav && (
    <LocalPageNav page={localPage} pageCount={localPageCount} onPageChange={handleLocalPageChange} />
  )}
</div>
```

- [ ] **Step 7: Pass page metrics callback**

On Content `VirtualGrid` and `VirtualList`, add:

```jsx
onPageMetricsChange = { setPageMetrics }
```

- [ ] **Step 8: Verify Content compiles**

Run:

```powershell
npm run lint -- src/renderer/src/views/ContentView.jsx src/renderer/src/components/LocalPageNav.jsx
```

Expected: PASS.

---

### Task 6: Add Wiring Tests

**Files:**

- Modify: `src/renderer/src/lib/local-page-nav.test.js`

- [ ] **Step 1: Add static wiring tests**

Append:

```js
import { readFileSync } from 'fs'
import { resolve } from 'path'

const libraryView = readFileSync(resolve(import.meta.dirname, '../views/LibraryView.jsx'), 'utf8')
const contentView = readFileSync(resolve(import.meta.dirname, '../views/ContentView.jsx'), 'utf8')

describe('local page nav wiring', () => {
  it('wires LibraryView to LocalPageNav and virtual page metrics', () => {
    expect(libraryView).toContain('<LocalPageNav')
    expect(libraryView).toContain('onPageMetricsChange={setPageMetrics}')
    expect(libraryView).toContain('getLocalPageTargetIndex')
  })

  it('wires ContentView to LocalPageNav and virtual page metrics', () => {
    expect(contentView).toContain('<LocalPageNav')
    expect(contentView).toContain('onPageMetricsChange={setPageMetrics}')
    expect(contentView).toContain('getLocalPageTargetIndex')
  })
})
```

- [ ] **Step 2: Run focused tests**

Run:

```powershell
npm test -- src/renderer/src/lib/local-page-nav.test.js src/renderer/src/lib/view-scroll-anchor.test.js src/renderer/src/stores/view-scroll-anchor.test.js
```

Expected: PASS.

---

### Task 7: Final Verification

**Files:**

- No new files.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
npm test -- src/renderer/src/lib/local-page-nav.test.js src/renderer/src/lib/view-scroll-anchor.test.js src/renderer/src/stores/view-scroll-anchor.test.js
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```powershell
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Build**

Run:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 4: Manual runtime check**

Run:

```powershell
npm run start
```

Expected behavior:

- Library grid shows centered pager when filtered packages exceed one viewport.
- Library table shows centered pager when filtered packages exceed one viewport.
- Content grid shows centered pager when filtered items exceed one viewport.
- Content table shows centered pager when filtered items exceed one viewport.
- First/previous/next/last and typed page all scroll to the requested visual page.
- Scrolling normally updates the page number.
- Changing filters resets to the top through existing `scrollResetKey` behavior.
- Switching away and back still restores the last visible anchor.

---

## Self-Review

- Spec coverage: Covers Library and Content, top controls only, visual page size, no new persistence, no Hub API work.
- Placeholder scan: No placeholder markers.
- Type consistency: Uses `pageSize`, `firstVisibleIndex`, `manualRestoreIndex`, `restoreScrollKey`, and existing virtualizer props consistently.
- Scope: One feature, local UI only.
