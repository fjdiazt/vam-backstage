# Hub Paid Wishlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users wishlist paid Hub cards locally and browse those wishlisted paid resources without calling the Hub API.

**Architecture:** Add a SQLite `hub_wishlist` table with metadata plus thumbnail `BLOB`. Main process owns persistence, thumbnail fetch, and IPC. Renderer keeps a small Zustand cache, shows a heart on paid Hub cards, and adds `Wishlisted` to the Hub pricing filter.

**Tech Stack:** Electron IPC, better-sqlite3, React, Zustand, Vitest.

---

### Task 1: Persist Wishlist Rows

**Files:**

- Modify: `src/main/db.js`
- Test: `src/main/db.test.js`

- [ ] Bump `SCHEMA_VERSION` to `24`, add `applyV24()`, and create `hub_wishlist` in both migration and `createSchema()`.
- [ ] Add DB helpers: `listHubWishlist()`, `getHubWishlistIds()`, `isHubWishlisted(resourceId)`, `upsertHubWishlist(resource, thumb)`, `deleteHubWishlist(resourceId)`.
- [ ] Add tests that migration creates the table and helper round-trip stores `image_blob` as a `Buffer`.
- [ ] Run `npm test -- --run src/main/db.test.js`.

### Task 2: Add Hub Wishlist IPC

**Files:**

- Create: `src/main/hub/wishlist.js`
- Modify: `src/main/ipc/hub.js`
- Modify: `src/preload/index.js`

- [ ] Add `snapshotHubWishlistResource(resource)` and `fetchThumbnailBlob(url)` in `src/main/hub/wishlist.js`.
- [ ] Add IPC: `hub:wishlist:list`, `hub:wishlist:ids`, `hub:wishlist:toggle`.
- [ ] Expose preload methods under `window.api.hub.wishlist`.
- [ ] Keep thumbnail fetch best-effort: failed image fetch saves metadata only.

### Task 3: Add Renderer Wishlist Store

**Files:**

- Create: `src/renderer/src/stores/useHubWishlistStore.js`

- [ ] Store `items`, `ids`, `loading`.
- [ ] Add `hydrate()` and `toggle(resource)`.
- [ ] Convert `image_blob` rows to `data:image/...;base64,...` URLs when present.

### Task 4: Wire Hub UI

**Files:**

- Modify: `src/renderer/src/components/PackageCard.jsx`
- Modify: `src/renderer/src/views/HubView.jsx`
- Modify: `src/renderer/src/stores/useHubStore.js`

- [ ] Add `wishlist` paid filter value.
- [ ] In wishlist mode, load DB wishlist rows instead of calling `hub.search`.
- [ ] Show a heart icon button only on paid Hub cards.
- [ ] Toggle wishlist without opening the card.
- [ ] Use saved thumb data URL when present.

### Task 5: Verify

**Files:**

- Test: `src/main/db.test.js`

- [ ] Run `npm test -- --run src/main/db.test.js`.
- [ ] Run `npm run lint -- src/main/db.js src/main/hub/wishlist.js src/main/ipc/hub.js src/preload/index.js src/renderer/src/stores/useHubWishlistStore.js src/renderer/src/views/HubView.jsx src/renderer/src/components/PackageCard.jsx`.
- [ ] Run `npm run format:check -- src/main/db.js src/main/hub/wishlist.js src/main/ipc/hub.js src/preload/index.js src/renderer/src/stores/useHubWishlistStore.js src/renderer/src/views/HubView.jsx src/renderer/src/components/PackageCard.jsx`.
- [ ] Run `npm run build`.
