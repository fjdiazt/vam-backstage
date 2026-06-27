# Local View Scroll Anchors Design

## Goal

Persist the user's last visible position in the local Library and Content views, so returning to a view or reopening the app restores the same local list position without changing Hub infinite-scroll behavior.

## Scope

- In scope: Library and Content views.
- Out of scope: Hub infinite-scroll paging changes, Settings view persistence, raw browser/webview scroll state.
- Settings remains non-persistent and reopens to Hub.

## Approach

Persist stable item anchors, not raw `scrollTop`.

- Library anchor: first visible package `filename`.
- Content anchor: first visible content item `{ id, packageFilename }`.
- Store anchors with the existing per-view persisted filter and selection state.
- Restore by resolving the saved anchor against the currently filtered and sorted local list.

This is safer than raw pixel offsets because it survives grid/table mode changes, card-width changes, column count changes, and row-height differences.

## Data Flow

1. `VirtualGrid` and `VirtualList` report the first visible item index through a lightweight callback.
2. `LibraryView` maps that index to a package filename and writes it to `useLibraryStore`.
3. `ContentView` maps that index to item id plus package filename and writes it to `useContentStore`.
4. Existing app-level store subscriptions persist the anchors through `getPersistedState`.
5. On restore, the view applies filters and sort first, then resolves the anchor to an index and passes it through the existing `restoreIndex` / `restoreKey` path.

## Fallbacks

- If the anchor still exists in the filtered result, restore to it.
- If the anchor is missing, fall back to the selected package/content item.
- If neither exists, start at the top.
- If filters changed, use the restored filters first; do not scroll to an anchor from a different filter result.

## Components

- `view-state.js`: sanitize optional Library and Content scroll anchors.
- `useLibraryStore.js`: persist and apply `scrollAnchorFilename`.
- `useContentStore.js`: persist and apply `scrollAnchorItemId` / `scrollAnchorPackageFilename`.
- `VirtualGrid.jsx` / `VirtualList`: expose `onFirstVisibleIndexChange`.
- `LibraryView.jsx` / `ContentView.jsx`: map visible index to anchor and restore index.

## Testing

Add focused Vitest coverage for:

- Library and Content sanitizers keep valid anchors and drop invalid anchors.
- Library and Content stores include anchors in persisted state and hydrate them.
- View helper logic prefers scroll anchor, then selected item, then top.

Run focused tests for changed modules, then lint, format check, and build.
