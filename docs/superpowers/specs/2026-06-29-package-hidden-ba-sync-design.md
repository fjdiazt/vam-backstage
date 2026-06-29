# Package Hidden BrowserAssist Sync Design

## Goal

Add Library package hiding to Backstage and keep it compatible with BrowserAssist package hiding.

## Current State

Backstage has hidden support in two places:

- Hub hidden items: Backstage-only Hub browser state.
- Content hidden items: VaM-compatible `.hide` sidecars, already visible to BrowserAssist after refresh/rescan.

Backstage does not have Library package hidden state. BrowserAssist now has VAR package browsing, and its hidden filter uses resource hidden state. BrowserAssist package user state is stored in its user data/prefs area rather than in Backstage's database.

## Decisions

Use Backstage DB for fast Library filtering and UI state, but mirror user edits to BrowserAssist-compatible package prefs.

Package hidden state semantics:

- missing/null = visible and not explicitly set
- `hidden: false` = explicitly visible
- `hidden: true` = hidden

BrowserAssist wins conflicts. If Backstage DB and BrowserAssist prefs disagree during sync/rescan, Backstage imports BrowserAssist state into DB and does not overwrite it. This sync only covers direct package hidden state; BrowserAssist derived hidden states from hide-tags or hidden creators are not flattened into Backstage package hidden.

## Storage

Backstage stores package hidden state per installed package filename for renderer queries.

BrowserAssist-compatible state is stored at:

```text
AddonPackagesUserPrefs/<Creator.Package>.prefs
```

Backstage reads and writes only the `hidden` JSON field and preserves all other fields. Writes use an atomic temp-file replace.

## Data Flow

Backstage user hides/unhides a Library package:

1. Update Backstage DB.
2. Write `hidden: true` or `hidden: false` to the package prefs file.
3. Refresh Library rows.

Backstage scans or runs BrowserAssist sync:

1. Read package prefs files.
2. Import `hidden` into Backstage DB.
3. Keep BrowserAssist state as winner on mismatch.
4. Refresh Library rows.

BrowserAssist user hides/unhides a package:

1. BrowserAssist writes package hidden state.
2. Backstage sees it on sync/rescan.

## UI

Library gets a `Visibility` filter with:

- All
- Visible
- Hidden

Package card/table/context actions get Hide/Unhide. Hidden rows are excluded from Visible and included in Hidden. Existing Content visibility is unchanged.

## Non-Goals

- Do not change Content `.hide` behavior.
- Do not sync Hub hidden items.
- Do not hide package contents when hiding a Library package.
- Do not overwrite unrelated BrowserAssist prefs fields.
- Do not import BrowserAssist tag-hidden or creator-hidden package state in this first pass.

## Testing

Tests must cover:

- DB migration and package hidden helpers.
- BrowserAssist prefs read/write preserving unrelated JSON.
- BrowserAssist prefs win over DB on import.
- Library filtering for all/visible/hidden.
- IPC hide/unhide updates DB and prefs.
