# Back To Top Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating back-to-top button to Hub, Library, and Content scrolling galleries.

**Architecture:** Create one small reusable button that observes a supplied scroll element. Hub renders it against `galleryRef`; Library and Content get it through `VirtualGrid`/`VirtualList` so the button follows their internal scroll containers.

**Tech Stack:** React, lucide-react, existing Tailwind utility classes, Vitest static tests.

---

### Task 1: Reusable Button

**Files:**

- Create: `src/renderer/src/components/BackToTopButton.jsx`

- [ ] Add a component accepting `scrollRef`, optional `threshold`, and optional `className`.
- [ ] Track visibility from the scroll element's `scrollTop`.
- [ ] On click, call `scrollTo({ top: 0, behavior: 'smooth' })`; fall back to `scrollTop = 0`.

### Task 2: Virtual Containers

**Files:**

- Modify: `src/renderer/src/components/VirtualGrid.jsx`

- [ ] Import `BackToTopButton`.
- [ ] Add `showBackToTop = false` prop to `VirtualGrid` and `VirtualList`.
- [ ] Render the button inside the scroll container when `showBackToTop` is true.

### Task 3: Hub, Library, Content Wiring

**Files:**

- Modify: `src/renderer/src/views/HubView.jsx`
- Modify: `src/renderer/src/views/LibraryView.jsx`
- Modify: `src/renderer/src/views/ContentView.jsx`

- [ ] Hub: import `BackToTopButton` and render it inside the gallery scroll pane.
- [ ] Library: pass `showBackToTop` to `VirtualGrid` and `VirtualList` table usage.
- [ ] Content: pass `showBackToTop` to `VirtualGrid` and `VirtualList` table usage.

### Task 4: Verify

**Files:**

- Test: `src/renderer/src/components/VirtualGrid.test.js`

- [ ] Add static assertions that `VirtualGrid` and `VirtualList` accept and render `showBackToTop`.
- [ ] Run `npm test -- --run src/renderer/src/components/VirtualGrid.test.js`.
- [ ] Run eslint/prettier on touched files.
- [ ] Run `npm run build`.
