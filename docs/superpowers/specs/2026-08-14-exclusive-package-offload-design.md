# Exclusive Package Offload Design

## Goal

Add a persistent Library checkbox that lets the user keep one selected package and its installed dependency tree enabled while offloading every other installed package.

## User Experience

The Library detail panel gets a checkbox labeled `Offload all other packages` near the package state action.

- It defaults to off and persists in the existing `library-view` Zustand state.
- It is available only when `disable_behavior` points to a registered offload directory (`move-to:<auxDirId>`).
- Without an offload target, it is disabled and unchecked. Its title directs the user to configure offloading in Settings.
- While off, the existing Enable/Disable behavior is unchanged.
- While on, the package state action reads `Enable only`, even when the selected package is already enabled.
- Clicking `Enable only` runs the exclusive operation without a confirmation dialog.
- The checkbox and action are disabled while the operation runs.

This mode affects only the selected package action in the Library detail panel. Bulk actions, Library context-menu actions, and Content-view package actions keep their current behavior.

## Package Selection

For selected package `P`, the keep set is:

```text
P + every installed resolved transitive dependency of P
```

Existing dependency resolution remains authoritative, including exact, latest, minimum-version, fallback, cycle, and missing-reference behavior. Missing packages are not downloaded. The synthetic `__local__` package is never moved.

Every installed non-local package outside the keep set is an offload target. Packages already offloaded remain where they are. Enabled and VaM-disabled packages move to the configured offload directory.

## Backend Operation

Add one IPC operation:

```text
packages:enable-exclusive(filename)
```

The main process owns the complete operation:

1. Validate the VaM directory, selected package, and configured `move-to` offload target before moving files.
2. Compute the keep and offload sets from the current package index and forward dependency graph.
3. Finish all offload attempts.
4. Attempt to enable every package in the keep set.
5. Return one summary to the renderer.

The existing storage-state worker gains an internal `offload` intent. Unlike normal `disable`, this intent moves both enabled and VaM-disabled packages to the configured auxiliary directory, treats already-offloaded packages as unchanged, and does not cascade. Exclusive enabling also disables normal cascade because the complete keep set is already explicit.

The response shape is:

```js
{
  ok: errors.length === 0,
  keepCount,
  offloadedCount,
  enabledCount,
  errors: [{ filename, phase: 'offload' | 'enable', error }],
}
```

`offloadedCount` and `enabledCount` count actual state changes. `keepCount` counts the selected package plus installed dependencies, including packages already enabled.

## Failure Handling

Configuration errors fail before any package moves.

Individual package move failures do not abort the batch. The backend records each failure, completes the remaining offload attempts, then still attempts the complete keep set. The renderer shows a success summary when all moves succeed or an error summary with the failed count when any package fails. Existing filesystem overwrite guards, watcher bulk windows, BrowserAssist sidecars, database updates, and extracted-content reconciliation remain authoritative.

## Persistence

Add `offloadOthersOnEnable` and its setter to `useLibraryStore`. Persist only the boolean through the existing `persistViewState('library-view', ...)` schema with `asBool`. No database migration or new setting key is needed.

## Testing

Focused tests cover:

- keep/offload planning with a transitive dependency tree, unrelated packages, cycles, already-offloaded packages, and `__local__`;
- explicit offload intent for enabled, disabled, and already-offloaded states;
- offload phase completing before enable phase, including partial failures;
- shared API exposure, persisted checkbox wiring, offload-target gating, `Enable only` labeling, and exclusive IPC routing in the Library detail panel.

Final verification runs lint, formatting, focused tests, the full test suite, and the production build. The Library detail interaction is then checked in the Electron app with both configured and missing offload targets.

## Non-Goals

- No VaM scene-load or startup automation.
- No BrowserAssist runtime integration.
- No dependency downloads.
- No profiles, exceptions, or manual dependency sources.
- No changes to normal Disable, bulk state changes, context menus, or Content-view actions.
- No relocation of packages already offloaded in another auxiliary directory.
