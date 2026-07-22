# Docker SMB Hosting Design

## Goal

Run VaM Backstage on an Ubuntu LAN server in Docker while the complete VaM folder remains on a Windows machine. Browser clients must retain the current Library, Content, Hub, settings, scanning, download, and filesystem mutation behavior.

This is a proof of concept built on the existing Electron backend. A standalone Node backend and offline browsing remain later work.

## Deployment

One container runs the packaged Linux Electron application under Xvfb in existing headless `--serve` mode. It serves the React application, WebSocket RPC, static assets, and Hub proxy. Browsers are the clients; no separate frontend container is needed.

```text
Windows VaM folder
       |
       | SMB
       v
Ubuntu /mnt/vam
       |
       | bind mount, read/write
       v
Backstage container /vam
       |
       +-- app + WebSocket: 42069
       +-- Hub proxy:        42070
       +-- local volume:     /data
```

Ubuntu owns the SMB mount. Docker only bind-mounts `/mnt/vam` into the container. The application container does not receive SMB credentials, `CAP_SYS_ADMIN`, or privileged mode.

A named Docker volume mounted at `/data` contains Electron user data, `backstage.db`, thumbnail and avatar caches, and Hub session data. SQLite and caches never reside on SMB.

## Container Configuration

The container supplies these runtime values:

- `VAM_SERVE=42069` starts the existing headless server.
- `VAM_DIR=/vam` makes the mounted folder authoritative instead of relying on a native folder picker or a Windows path stored in SQLite.
- `VAM_USER_DATA=/data` gives Electron, SQLite, caches, and Hub sessions one deterministic persistent location.
- `VAM_STORAGE_MODE=manual` disables filesystem watchers and enables visible manual refresh controls.

The image is built from the existing Linux packaged output. Its runtime layer contains the Electron Linux libraries and Xvfb. The entry point runs the packaged executable under `xvfb-run`; it does not start a desktop session or expose a graphical display.

Docker Compose publishes `42069` and `42070`, bind-mounts `/mnt/vam:/vam:rw`, and mounts the named data volume at `/data`.

## SMB Mount

Ubuntu mounts the Windows share using `mount.cifs`. Credentials live in a root-readable host file, not in Git or Compose. The mount is configured as a network filesystem and maps files to the UID/GID used by the container.

The shared root is the complete VaM directory, including at least:

- `AddonPackages`
- `AddonPackagesFilePrefs`
- `AddonPackagesUserPrefs`
- `Custom`
- `Saves`

Auxiliary library directories must also be beneath the shared root for this POC. Supporting unrelated shares is excluded.

## Storage Availability

The backend has one storage-status check used at startup, before scans, and by Retry/Rescan actions. `/vam` is available only when it is a readable directory, its expected `AddonPackages` child is a readable directory, and the root passes a write-access check.

Checking `AddonPackages` distinguishes a live share from the empty host mountpoint left behind when SMB is unavailable.

When unavailable:

- The HTTP/WebSocket service remains running so the browser can explain the problem.
- The application shell is replaced by a blocking storage-unavailable screen.
- The screen names `/vam`, reports the filesystem error, and offers Retry.
- Library scans and filesystem mutations are rejected with the same storage-unavailable error.
- Hub-only or cached browsing is not offered in this POC.

Retry rechecks storage. When available again, it runs a full scan, rebuilds the stores, and opens the application.

## Scanning and Refresh

`VAM_STORAGE_MODE=manual` prevents `@parcel/watcher` startup. Existing full-scan logic remains authoritative and keeps its current mtime/size shortcuts.

Manual mode adds one compact Rescan control to the existing status bar. It is visible in browser/server mode when manual storage mode is active and reuses the current scan action and progress events. The existing Settings `Rescan Library` action remains available.

Each rescan first checks storage. A failed check opens the blocking screen. A successful scan refreshes packages, loose `Saves`/`Custom` content, preferences, thumbnails, and renderer stores through existing scan and notification flows.

No network-filesystem detection heuristic or user toggle is added. Docker explicitly selects manual mode; local desktop behavior and watchers remain unchanged.

## Data Flow

1. Ubuntu accesses the Windows VaM share at `/mnt/vam`.
2. Docker exposes the same files inside the container at `/vam`.
3. The backend reads and mutates `/vam` using existing scanner, package, preference, extraction, and download code.
4. Metadata is persisted in `/data/backstage.db`; extracted thumbnail and Hub caches remain under `/data`.
5. Browsers call the existing WebSocket API and receive current progress/invalidation events.
6. External Windows-side changes appear after the user presses Rescan.

## Error Handling

- Container startup failure logs the fatal Electron/Xvfb error and exits non-zero.
- Port conflicts retain existing server startup errors.
- Missing or unreadable `/data` is fatal; the container exits rather than risking an ephemeral database.
- Missing, unmounted, unreadable, or unwritable `/vam` keeps the server alive and blocks the application UI.
- A share loss during an operation surfaces the filesystem error, marks storage unavailable, and blocks further mutations until Retry succeeds.
- The application never creates `/vam/AddonPackages` automatically. Its absence means the share is unavailable or the configured root is wrong.

## Security

The existing trusted-intranet, no-authentication model remains unchanged. Every machine able to reach ports `42069` and `42070` can use Backstage and mutate the VaM share.

The container runs without privileged mode and receives only the VaM bind mount and its local data volume. SMB credentials remain on Ubuntu. Public-internet exposure is unsupported.

## Testing

Focused automated tests cover:

- Environment overrides for VaM and user-data paths.
- Manual storage mode skipping watcher startup while desktop mode remains unchanged.
- Storage checks for a valid root, empty mountpoint, missing root, unreadable root, and unwritable root.
- Scanner and mutation rejection while storage is unavailable.
- Retry recovery and rescan notification flow.
- Manual-mode Rescan visibility and storage-blocking UI behavior.

Build verification:

```text
npm run lint
npm run format:check
npm run test
npm run build
docker compose build
docker compose config
```

Manual POC verification:

1. Mount the Windows VaM share on Ubuntu and start Compose.
2. Open `http://<ubuntu-host>:42069` from another LAN machine.
3. Confirm Library and complete Content views load with thumbnails.
4. Perform representative write operations: install, enable/disable, favorite/hide, and extract.
5. Change files on Windows, press Rescan, and confirm updates appear.
6. Unmount or disconnect the share and confirm the blocking screen appears on Retry/Rescan or the next filesystem failure.
7. Restore the share, press Retry, and confirm a scan restores the application.
8. Restart the container and confirm database, caches, and Hub session persist.

## Excluded

- Standalone Node backend refactor.
- Separate frontend container.
- SMB mounting inside the application container.
- Automatic network-share detection.
- Live filesystem watching over SMB.
- Offline browsing from cached metadata or thumbnails.
- Authentication, TLS termination, or public hosting.
- Multiple VaM shares or VaM roots outside `/vam`.
