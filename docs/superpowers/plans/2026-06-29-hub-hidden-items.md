# Hub Hidden Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users permanently hide Hub resources from normal browsing and restore or clear them from Settings.

**Architecture:** Reuse the existing wishlist-style path but store only `resource_id` and `title`. Main owns SQLite and IPC. Renderer keeps hidden IDs in a tiny Zustand store, filters Hub resources client-side, adds a card hide button, and exposes restore/clear controls in Settings.

**Tech Stack:** Electron IPC, better-sqlite3, React, Zustand, Vitest.

---

### Task 1: Persistence And IPC

**Files:**

- Modify: `src/main/db.js`
- Modify: `src/main/db.test.js`
- Modify: `src/main/ipc/hub.js`
- Modify: `src/preload/index.js`

- [ ] Add `hub_hidden` schema beside `hub_wishlist`, bump `SCHEMA_VERSION`, and add migration.
- [ ] Add DB helpers: `listHubHidden`, `getHubHiddenIds`, `isHubHidden`, `upsertHubHidden`, `deleteHubHidden`, `clearHubHidden`.
- [ ] Add tests for schema, insert, id validation, delete, and clear.
- [ ] Add IPC under `window.api.hub.hidden`: `list`, `ids`, `hide`, `unhide`, `clear`.
- [ ] Run `npm run test -- src/main/db.test.js`.

### Task 2: Renderer Store And Hub Filtering

**Files:**

- Create: `src/renderer/src/stores/useHubHiddenStore.js`
- Modify: `src/renderer/src/views/HubView.jsx`
- Modify: `src/renderer/src/components/PackageCard.jsx`

- [ ] Create a Zustand store mirroring wishlist basics: `items`, `ids`, `hydrate`, `hide`, `unhide`, `clear`.
- [ ] Hydrate hidden IDs when Hub mounts.
- [ ] Filter hidden IDs after existing Hub/wishlist/hide-installed filtering.
- [ ] Add an `EyeOff` card button that hides the resource without opening detail.
- [ ] Keep Hub API totals unchanged; client-side filtering only.
- [ ] Run focused lint on touched renderer files.

### Task 3: Settings Manager

**Files:**

- Modify: `src/renderer/src/views/SettingsView.jsx`

- [ ] In Settings > Hub, show hidden item count.
- [ ] List hidden titles and IDs.
- [ ] Add per-item Restore.
- [ ] Add Clear all with existing confirmation dialog.
- [ ] Run focused lint on Settings.

### Task 4: Verification And Launch

**Files:**

- No new files.

- [ ] Run `npm run test -- src/main/db.test.js`.
- [ ] Run `npm run lint -- src/main/db.js src/main/db.test.js src/main/ipc/hub.js src/preload/index.js src/renderer/src/stores/useHubHiddenStore.js src/renderer/src/views/HubView.jsx src/renderer/src/views/SettingsView.jsx src/renderer/src/components/PackageCard.jsx`.
- [ ] Run `npm run build`.
- [ ] Launch with `npm run start`.
