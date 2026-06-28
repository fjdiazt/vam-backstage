# Local View Page Controls Design

## Goal

Add Hub-style top paging controls to the Library and Content views so users can jump through the currently filtered local result list without changing those views from virtual scrolling.

## Scope

Library and Content already persist their last visible item through `scrollAnchorFilename` and `scrollAnchorItemId`. This feature reuses that anchor path: page controls scroll to a target item, then the existing first-visible callback updates the persisted anchor. No new persisted page number is needed.

The page size is the visible viewport, not a fixed item count. In grid mode, a page is the number of full visible rows times the current column count. In table mode, a page is the number of full visible rows. Thumbnail size, window size, table/grid mode, and filters therefore change the page count naturally.

Out of scope: Hub API paging, the Library missing-dependencies table, new settings, bottom pagers, and changing selected item/package when paging.

## UI

Add a centered pager to the normal top toolbar in Library and Content. Keep the left result count and right view controls/thumbnail slider. Hide the pager when there is only one visual page. The bulk-selection toolbar remains unchanged.

Controls match the Hub infinite-scroll control shape:

- first page
- previous page
- `Page` number input
- next page
- last page

The label stays neutral. There is no hidden-results highlight because local paging does not hide earlier items; users can still scroll normally.

## Architecture

Add small page-math helpers in `src/renderer/src/lib/local-page-nav.js`. Add a reusable `LocalPageNav` component for the button/input cluster. Extend `VirtualGrid` and `VirtualList` with an optional page-metrics callback so views can compute page count from the actual rendered viewport.

Library and Content keep tiny local state for `firstVisibleIndex`, `pageMetrics`, and a transient manual restore index. Page button clicks calculate a target index, set the transient restore index, and bump `restoreScrollKey`; existing virtualizer restore code performs the scroll.

## Testing

Unit-test page math for clamping, current page, target index, and hidden-single-page behavior. Add lightweight static/render-free coverage that Library and Content wire `LocalPageNav`. Run focused tests, lint, and build.
