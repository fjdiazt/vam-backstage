# BrowserAssist Label Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Backstage Labels and BrowserAssist user tags sync bidirectionally without either side blindly overwriting the other.

**Architecture:** Backstage remains the only place with sync metadata. BrowserAssist stays unchanged; Backstage reads and writes BrowserAssist `.userData` files using normal `Tags[]` entries with `tagCategory: "User"`. A new SQLite source ledger records whether each content-label assignment came from Backstage, BrowserAssist, or both, so untagging on one side only removes that side's ownership.

**Tech Stack:** Electron main process, better-sqlite3, BrowserAssist `.userData` JSON shards, existing IPC/dev settings path, Vitest.

---

## Scope

In scope:

- Content-level Backstage Labels ↔ BrowserAssist `User` category tags.
- Backstage package labels sync outward to BA resources as inherited labels.
- BA `User` tags import into Backstage as content labels.
- Untagging works for content labels with source tracking.

Out of scope:

- Hub metadata tags.
- BrowserAssist non-`User` categories, unless later proven useful.
- Package-label deletion driven by BA. BA has no package-level concept.
- BrowserAssist plugin code changes.
- Stable rename tracking. Rename is treated as remove old + add new.

Source mask constants must stay near the DB helper exports with comments for AI/code search discoverability:

```js
// Label sync source bits for label_content_sources.source_mask.
// 1 means the assignment is owned by Backstage UI.
// 2 means the assignment was imported from BrowserAssist User tags.
// 3 means both sides currently own the assignment.
export const LABEL_SOURCE_BACKSTAGE = 1
export const LABEL_SOURCE_BROWSERASSIST = 2
export const LABEL_SOURCE_BOTH = LABEL_SOURCE_BACKSTAGE | LABEL_SOURCE_BROWSERASSIST
```

## File Structure

- Modify `src/main/db.js`: schema v26, source constants, label source helpers.
- Modify `src/main/db.test.js`: migration/helper tests.
- Modify `src/main/store.js`: expose content label source maps for sync.
- Modify `src/main/browser-assist.js`: replace one-way label rewrite with source-aware merge/import/export.
- Modify `src/main/ipc/labels.js`: mark Backstage-origin when user applies/removes content labels.
- Modify `src/main/ipc/dev.js`: keep same `dev:sync-browser-assist` IPC.
- Modify `src/renderer/src/views/SettingsView.jsx`: rename button/copy from one-way sync to bidirectional label sync.

---

### Task 1: Label Source Ledger

**Files:**

- Modify: `src/main/db.js`
- Modify: `src/main/db.test.js`

- [ ] **Step 1: Write failing DB tests**

Add imports in `src/main/db.test.js`:

```js
  LABEL_SOURCE_BACKSTAGE,
  LABEL_SOURCE_BROWSERASSIST,
  LABEL_SOURCE_BOTH,
  findOrCreateLabel,
  deleteLabel,
  getLabelContentSource,
  setLabelContentSource,
  clearLabelContentSource,
  listLabelContentSources,
```

Append:

```js
describe('label content sources', () => {
  beforeEach(async () => {
    tmp = await mkTempVamDir()
    await openTestDatabase(tmp.dbPath)
  })

  it('creates source ledger in the current schema', () => {
    const row = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'label_content_sources'")
      .get()
    expect(row.name).toBe('label_content_sources')
  })

  it('stores and clears source masks per content label assignment', () => {
    const label = findOrCreateLabel('Synced')
    setLabelContentSource(label.id, 'Creator.Package.1.var', 'Saves/scene/Demo.json', LABEL_SOURCE_BACKSTAGE)
    expect(getLabelContentSource(label.id, 'Creator.Package.1.var', 'Saves/scene/Demo.json')).toBe(
      LABEL_SOURCE_BACKSTAGE,
    )

    setLabelContentSource(label.id, 'Creator.Package.1.var', 'Saves/scene/Demo.json', LABEL_SOURCE_BOTH)
    expect(listLabelContentSources()).toEqual([
      {
        label_id: label.id,
        package_filename: 'Creator.Package.1.var',
        internal_path: 'Saves/scene/Demo.json',
        source_mask: LABEL_SOURCE_BOTH,
      },
    ])

    clearLabelContentSource(label.id, 'Creator.Package.1.var', 'Saves/scene/Demo.json')
    expect(getLabelContentSource(label.id, 'Creator.Package.1.var', 'Saves/scene/Demo.json')).toBe(0)
  })

  it('cascades source rows when labels are deleted', () => {
    const label = findOrCreateLabel('Delete Me')
    setLabelContentSource(label.id, 'Creator.Package.1.var', 'Saves/scene/Demo.json', LABEL_SOURCE_BROWSERASSIST)

    deleteLabel(label.id)

    expect(listLabelContentSources()).toEqual([])
  })
})
```

Run:

```bash
npm run test -- src/main/db.test.js
```

Expected: fail because constants/helpers/table do not exist.

- [ ] **Step 2: Add schema and helpers**

In `src/main/db.js`, bump:

```js
const SCHEMA_VERSION = 26
```

Add migration after v25:

```js
if (current < 26) applyV26()
```

Add schema:

```js
function labelContentSourcesSchemaSql() {
  return `
    CREATE TABLE IF NOT EXISTS label_content_sources (
      label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      package_filename TEXT NOT NULL REFERENCES packages(filename) ON DELETE CASCADE,
      internal_path TEXT NOT NULL,
      source_mask INTEGER NOT NULL,
      PRIMARY KEY (label_id, package_filename, internal_path)
    );
    CREATE INDEX IF NOT EXISTS idx_label_content_sources_pkgpath
      ON label_content_sources(package_filename, internal_path);
  `
}

function applyV26() {
  db.exec(labelContentSourcesSchemaSql())
}
```

Include `${labelContentSourcesSchemaSql()}` in `createSchema()` after `label_contents`.

Add helpers near label DB helpers:

```js
// Label sync source bits for label_content_sources.source_mask.
// 1 means the assignment is owned by Backstage UI.
// 2 means the assignment was imported from BrowserAssist User tags.
// 3 means both sides currently own the assignment.
export const LABEL_SOURCE_BACKSTAGE = 1
export const LABEL_SOURCE_BROWSERASSIST = 2
export const LABEL_SOURCE_BOTH = LABEL_SOURCE_BACKSTAGE | LABEL_SOURCE_BROWSERASSIST

function validLabelSourceMask(mask) {
  const n = Number(mask)
  return Number.isInteger(n) && n > 0 ? n : 0
}

export function setLabelContentSource(labelId, packageFilename, internalPath, sourceMask) {
  const mask = validLabelSourceMask(sourceMask)
  if (!mask) return 0
  stmt(
    `INSERT INTO label_content_sources (label_id, package_filename, internal_path, source_mask)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(label_id, package_filename, internal_path) DO UPDATE SET
       source_mask = excluded.source_mask`,
  ).run(labelId, packageFilename, internalPath, mask)
  return mask
}

export function getLabelContentSource(labelId, packageFilename, internalPath) {
  const row = stmt(
    `SELECT source_mask FROM label_content_sources
     WHERE label_id = ? AND package_filename = ? AND internal_path = ?`,
  ).get(labelId, packageFilename, internalPath)
  return row?.source_mask ?? 0
}

export function clearLabelContentSource(labelId, packageFilename, internalPath) {
  return stmt(
    `DELETE FROM label_content_sources
     WHERE label_id = ? AND package_filename = ? AND internal_path = ?`,
  ).run(labelId, packageFilename, internalPath).changes
}

export function listLabelContentSources() {
  return stmt('SELECT label_id, package_filename, internal_path, source_mask FROM label_content_sources').all()
}
```

Run:

```bash
npm run test -- src/main/db.test.js
```

Expected: pass.

- [ ] **Step 3: Commit DB ledger**

```bash
git add src/main/db.js src/main/db.test.js
git commit -m "feat: track label sync sources"
```

---

### Task 2: Mark Backstage-Origin Content Label Edits

**Files:**

- Modify: `src/main/ipc/labels.js`
- Modify: `src/main/db.test.js`

- [ ] **Step 1: Write DB helper behavior test**

Add to the `label content sources` describe:

```js
it('can downgrade source ownership after one side removes an assignment', () => {
  const label = findOrCreateLabel('Both')
  setLabelContentSource(label.id, 'Creator.Package.1.var', 'Saves/scene/Demo.json', LABEL_SOURCE_BOTH)

  const nextMask =
    getLabelContentSource(label.id, 'Creator.Package.1.var', 'Saves/scene/Demo.json') & ~LABEL_SOURCE_BACKSTAGE
  setLabelContentSource(label.id, 'Creator.Package.1.var', 'Saves/scene/Demo.json', nextMask)

  expect(getLabelContentSource(label.id, 'Creator.Package.1.var', 'Saves/scene/Demo.json')).toBe(
    LABEL_SOURCE_BROWSERASSIST,
  )
})
```

Run:

```bash
npm run test -- src/main/db.test.js
```

Expected: pass after Task 1.

- [ ] **Step 2: Mark content label IPC mutations**

In `src/main/ipc/labels.js`, import:

```js
  LABEL_SOURCE_BACKSTAGE,
  getLabelContentSource,
  setLabelContentSource,
  clearLabelContentSource,
```

In `labels:apply-contents`, after `dbApplyLabelToContents(...)`, update sources:

```js
for (const item of items || []) {
  const current = getLabelContentSource(id, item.packageFilename, item.internalPath)
  if (applied) {
    setLabelContentSource(id, item.packageFilename, item.internalPath, current | LABEL_SOURCE_BACKSTAGE)
  } else {
    const next = current & ~LABEL_SOURCE_BACKSTAGE
    if (next) setLabelContentSource(id, item.packageFilename, item.internalPath, next)
    else clearLabelContentSource(id, item.packageFilename, item.internalPath)
  }
}
```

Do not mark package labels. Package labels are Backstage-owned and only export to BA.

Run:

```bash
npm run lint -- src/main/ipc/labels.js src/main/db.js src/main/db.test.js
```

Expected: pass.

- [ ] **Step 3: Commit source marking**

```bash
git add src/main/ipc/labels.js src/main/db.test.js
git commit -m "feat: mark backstage label source"
```

---

### Task 3: Source-Aware BrowserAssist Merge

**Files:**

- Modify: `src/main/browser-assist.js`
- Modify: `src/main/store.js`
- Test: create `src/main/browser-assist.test.js`

- [ ] **Step 1: Export pure helpers for tests**

Refactor `src/main/browser-assist.js` so pure BA user-tag merge logic is exported:

```js
const BA_USER_TAG_CATEGORY = 'User'

export function browserAssistUserTagNames(tags) {
  const arr = Array.isArray(tags) ? tags : []
  return new Set(
    arr
      .filter(
        (t) => t && typeof t === 'object' && t.tagCategory === BA_USER_TAG_CATEGORY && typeof t.tagName === 'string',
      )
      .map((t) => t.tagName.trim())
      .filter(Boolean),
  )
}

export function mergeBrowserAssistUserTags(tags, labelNames) {
  const arr = Array.isArray(tags) ? tags : []
  const wanted = new Set(labelNames.filter(Boolean))
  const filtered = arr.filter((t) => !(t && typeof t === 'object' && t.tagCategory === BA_USER_TAG_CATEGORY))
  return [
    ...filtered,
    ...[...wanted]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map((n) => ({ tagName: n, tagCategory: BA_USER_TAG_CATEGORY })),
  ]
}
```

Keep scene tag merge unchanged.

- [ ] **Step 2: Write helper tests**

Create `src/main/browser-assist.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { browserAssistUserTagNames, mergeBrowserAssistUserTags } from './browser-assist.js'

describe('BrowserAssist user tag helpers', () => {
  it('reads only User category tags', () => {
    expect([
      ...browserAssistUserTagNames([
        { tagName: 'Favorite', tagCategory: 'User' },
        { tagName: 'fixed', tagCategory: 'Scene' },
        { tagName: '', tagCategory: 'User' },
      ]),
    ]).toEqual(['Favorite'])
  })

  it('rewrites only User category tags', () => {
    expect(
      mergeBrowserAssistUserTags(
        [
          { tagName: 'fixed', tagCategory: 'Scene' },
          { tagName: 'Old', tagCategory: 'User' },
        ],
        ['New', 'Favorite'],
      ),
    ).toEqual([
      { tagName: 'fixed', tagCategory: 'Scene' },
      { tagName: 'Favorite', tagCategory: 'User' },
      { tagName: 'New', tagCategory: 'User' },
    ])
  })
})
```

Run:

```bash
npm run test -- src/main/browser-assist.test.js
```

Expected: pass.

- [ ] **Step 3: Build source-aware lookup**

Modify `buildContentLookup()` to return:

```js
{
  packageFilename,
  internalPath,
  sceneType,
  packageLabelNames: Set<string>,
  contentLabels: Map<string, { id: number, sourceMask: number }>
}
```

Use:

- `labelsByPackage` for inherited package labels.
- `labelsByContent` for content labels.
- new store getter `getLabelContentSourcesMap()` keyed by `${package_filename}\0${internal_path}\0${label_id}`.

In `src/main/store.js`, add:

```js
let labelContentSources = new Map()

export function getLabelContentSourcesMap() {
  return labelContentSources
}
```

Inside label index rebuild, populate:

```js
labelContentSources = new Map()
for (const row of listLabelContentSources()) {
  labelContentSources.set(`${row.package_filename}\0${row.internal_path}\0${row.label_id}`, row.source_mask)
}
```

Import `listLabelContentSources` from `db.js`.

- [ ] **Step 4: Merge algorithm**

In each matched BA resource:

```js
const baLabels = browserAssistUserTagNames(res.Tags)
const nextContentLabels = new Map(entry.contentLabels)

for (const name of baLabels) {
  const label = findOrCreateLabel(name)
  const existing = nextContentLabels.get(label.name)
  const currentMask = existing?.sourceMask ?? 0
  nextContentLabels.set(label.name, { id: label.id, sourceMask: currentMask | LABEL_SOURCE_BROWSERASSIST })
  applyLabelToContents(label.id, [{ packageFilename: entry.packageFilename, internalPath: entry.internalPath }])
  setLabelContentSource(label.id, entry.packageFilename, entry.internalPath, currentMask | LABEL_SOURCE_BROWSERASSIST)
}

for (const [name, info] of entry.contentLabels) {
  if (info.sourceMask & LABEL_SOURCE_BROWSERASSIST && !baLabels.has(name)) {
    const nextMask = info.sourceMask & ~LABEL_SOURCE_BROWSERASSIST
    if (nextMask) {
      setLabelContentSource(info.id, entry.packageFilename, entry.internalPath, nextMask)
      nextContentLabels.set(name, { ...info, sourceMask: nextMask })
    } else {
      removeLabelFromContents(info.id, [{ packageFilename: entry.packageFilename, internalPath: entry.internalPath }])
      clearLabelContentSource(info.id, entry.packageFilename, entry.internalPath)
      nextContentLabels.delete(name)
    }
  }
}

const outboundNames = new Set(entry.packageLabelNames)
for (const [name, info] of nextContentLabels) {
  if (info.sourceMask & LABEL_SOURCE_BACKSTAGE || info.sourceMask & LABEL_SOURCE_BROWSERASSIST) outboundNames.add(name)
}
nextTags = mergeBrowserAssistUserTags(nextTags, [...outboundNames])
```

Required imports from `src/main/db.js`:

```js
  LABEL_SOURCE_BACKSTAGE,
  LABEL_SOURCE_BROWSERASSIST,
  findOrCreateLabel,
  applyLabelToContents,
  removeLabelFromContents,
  setLabelContentSource,
  clearLabelContentSource,
```

Package labels:

- Always added to BA outbound `User` tags.
- Never removed from Backstage because BA tag missing.

- [ ] **Step 5: Return better sync counts**

Extend result object from `syncBrowserAssistTags`:

```js
labelsImported
labelsRemoved
labelsExported
```

Increment:

- `labelsImported` when a BA user tag creates/applies a Backstage content label.
- `labelsRemoved` when BA absence removes/downgrades a BrowserAssist-origin content label.
- `labelsExported` when outbound `User` tags change in BA JSON.

- [ ] **Step 6: Run focused tests**

```bash
npm run test -- src/main/browser-assist.test.js src/main/db.test.js
npm run lint -- src/main/browser-assist.js src/main/browser-assist.test.js src/main/store.js src/main/db.js
```

Expected: pass.

- [ ] **Step 7: Commit sync engine**

```bash
git add src/main/browser-assist.js src/main/browser-assist.test.js src/main/store.js src/main/db.js src/main/db.test.js
git commit -m "feat: sync browserassist labels both ways"
```

---

### Task 4: Settings Copy And Result Summary

**Files:**

- Modify: `src/renderer/src/views/SettingsView.jsx`

- [ ] **Step 1: Update Settings wording**

Change Settings > Developer Options copy from one-way:

```jsx
<div className="text-xs text-text-primary font-medium">Sync with BrowserAssist</div>
<div className="text-[11px] text-text-tertiary mt-0.5">
  Sync Backstage Labels with BrowserAssist user tags. Adds and removes assignments according to source tracking;
  Hub tags and non-user BrowserAssist categories are not changed.
</div>
```

Button text:

```jsx
{
  baSyncing ? 'Syncing…' : 'Sync labels'
}
```

Result summary should include new counters:

```jsx
{
  baSyncResult.labelsImported != null && (
    <div>
      {baSyncResult.labelsImported} imported · {baSyncResult.labelsExported} exported · {baSyncResult.labelsRemoved}{' '}
      removed
    </div>
  )
}
```

- [ ] **Step 2: Run focused lint**

```bash
npm run lint -- src/renderer/src/views/SettingsView.jsx
```

Expected: pass.

- [ ] **Step 3: Commit UI copy**

```bash
git add src/renderer/src/views/SettingsView.jsx
git commit -m "chore: clarify browserassist label sync"
```

---

### Task 5: Final Verification

**Files:**

- No new files.

- [ ] Run DB + BrowserAssist tests:

```bash
npm run test -- src/main/db.test.js src/main/browser-assist.test.js
```

Expected: pass.

- [ ] Run full lint:

```bash
npm run lint
```

Expected: pass.

- [ ] Run build:

```bash
npm run build
```

Expected: pass.

- [ ] Manual smoke test:

1. Create a Backstage label on one Content item.
2. Run Settings > Sync labels.
3. Confirm BA resource `.userData` gets `{ "tagName": "<label>", "tagCategory": "User" }`.
4. Add a BA user tag manually or in BA.
5. Run Settings > Sync labels.
6. Confirm Backstage content item gets matching label.
7. Remove BA-imported tag in BA, sync, confirm Backstage removes only BrowserAssist-origin ownership.
8. Remove Backstage-origin label in Backstage, sync, confirm BA removes only Backstage-origin copy.

Do not test destructive cleanup. None exists in this scope.
