# Intranet Web UI Design

## Goal

Serve VaM Backstage's existing React interface to desktop browsers on a trusted intranet while preserving the current Electron desktop application. The browser and Electron windows must use the same renderer code and the same backend behavior.

Web scope provides Library, Content, labels, downloads, scanning, settings that do not require native UI, Hub search/detail/install, the embedded Hub site, and Hub login/account interactions without forking the renderer.

## Scope

### Included

- Serve the existing built renderer over HTTP from the VaM Backstage host.
- Run HTTP and the existing WebSocket RPC protocol on the same port.
- Support both windowed hosting and the existing headless `--serve` mode.
- Support current desktop versions of Chrome, Edge, and Firefox at desktop widths.
- Reuse `App.jsx`, renderer components, Zustand stores, CSS, IPC handlers, SQLite data, scanner, watcher, downloads, and remote events.
- Preserve browser `.var` import through the existing chunked-upload handlers.
- Browse Hub pages in the existing in-app detail browser from the web UI.
- Expose runtime capabilities so unsupported controls are hidden or replaced deliberately.
- Keep the existing trusted-intranet, no-authentication model.

### Excluded

- Phone and tablet responsive redesign.
- Public-internet exposure, authentication, authorization, TLS termination, or multi-user isolation.
- Browser control of native folder pickers, Explorer reveal, app updates, or server lifecycle.
- REST API or standalone backend rewrite.
- Separate web frontend or duplicated React components.

## Architecture

The existing `out/renderer` bundle remains the only frontend artifact. Electron loads it from disk; the remote host serves the same files over HTTP.

```text
out/renderer/*
      |
      +-- Electron BrowserWindow
      +-- intranet HTTP client

shared React renderer
      |
      +-- shared window.api facade
             +-- local Electron IPC transport
             +-- WebSocket transport
                     |
                     +-- existing captured ipcMain handlers
```

`src/preload/index.js` becomes an Electron adapter rather than the owner of the API contract. A shared API factory receives a transport and runtime-specific operations, then returns the current `window.api` surface plus runtime capabilities.

The WebSocket RPC core becomes Electron-free. Electron remote clients supply local IPC routing for channels that must execute on the client machine. Browser clients supply browser implementations or unavailable results for those channels. Both clients retain the current RPC encoding, version gate, reconnect backoff, event delivery, and reload-after-reconnect behavior.

`src/main/remote/server.js` owns the app HTTP/WebSocket listener and a fixed-origin Hub proxy listener. App HTTP and WebSocket share the configured port (`42069` by default). The Hub proxy uses the adjacent port (`42070` by default), giving third-party Hub JavaScript a separate browser origin while still sharing Electron's `persist:hub` session. `/__hub/*` on the app listener redirects into that proxy.

No new runtime dependency is required. HTTP, filesystem reads, path resolution, and streaming use Node standard-library modules; `ws` remains the WebSocket implementation.

## Shared API Contract

The shared API factory preserves every current domain and method name. Renderer stores and components continue calling `window.api.*` without knowing whether IPC or WebSocket carries the request.

The API adds:

```js
runtime: {
  kind: 'electron' | 'web',
  capabilities: {
    embeddedHub: boolean,
    hubAccountActions: boolean,
    nativeDialogs: boolean,
    revealInFolder: boolean,
    updater: boolean,
    serverControl: boolean,
    developerTools: boolean,
  },
}
```

Capability values describe working behavior, not platform guesses:

| Capability          | Local Electron | Remote Electron                       | Web                            |
| ------------------- | -------------- | ------------------------------------- | ------------------------------ |
| `embeddedHub`       | yes            | yes                                   | yes                            |
| `hubAccountActions` | yes            | yes, using client Electron session    | yes, using host shared session |
| `nativeDialogs`     | yes            | no for host paths                     | no                             |
| `revealInFolder`    | yes            | no                                    | no                             |
| `updater`           | yes            | yes, client-local                     | no                             |
| `serverControl`     | yes            | yes, client-local connection controls | no                             |
| `developerTools`    | yes            | yes, client-local                     | no                             |

Browser-local operations:

- `shell.openExternal(url)` uses `window.open(url, '_blank', 'noopener,noreferrer')` after existing URL validation.
- `packages.getPathForFile()` returns an empty string, forcing existing chunked upload.
- Native browse methods return their current cancelled shapes.
- Developer, updater, reveal-in-folder, and server-control methods return stable unavailable results when invoked defensively.
- `app.getVersion()` is allowed over remote RPC.
- `app.hubWebviewPreload` is `null`.
- `remote.isRemote` is `true`; connection state comes from the WebSocket transport.

## Renderer Startup

`src/renderer/src/main.jsx` keeps one entry point:

1. Electron preload has already exposed `window.api`; startup uses it unchanged.
2. Browser startup finds no `window.api`, creates the same-origin WebSocket transport, creates the shared API, assigns it to `window.api`, then mounts React.
3. Startup failure renders a small connection state instead of mounting an application that will immediately reject every call.

Same-origin WebSocket URL derives from `window.location`: `http:` becomes `ws:`, `https:` becomes `wss:`, and host/port remain unchanged.

## HTTP Serving

The app server accepts `GET` and `HEAD`; other methods return `405`. The isolated Hub proxy forwards the methods needed by Hub navigation, forms, and XHR.

- `/` serves `index.html`.
- `/__hub/*` redirects to the same path on the isolated adjacent-port proxy.
- The proxy accepts only `https://hub.virtamate.com`, rewrites Hub URLs, strips frame-blocking headers, and reuses `persist:hub` cookies.
- Existing files beneath `out/renderer` are streamed with correct MIME types.
- Hashed files under `/assets/` receive long-lived immutable caching.
- `index.html` receives `Cache-Control: no-cache`.
- Extensionless unknown paths fall back to `index.html` for future client-side routing.
- Missing files with extensions return `404`.
- Missing renderer output returns `503` with a direct instruction to run/build a packaged application.
- Malformed URLs and decoded paths outside the renderer root return `400` or `403`; filesystem paths never escape the renderer root.

The response MIME map only covers artifacts emitted by the current build: HTML, JavaScript, CSS, JSON, PNG, JPEG, SVG, ICO, WOFF, WOFF2, and source maps. Unknown extensions use `application/octet-stream`.

`startServer()` resolves only after the app and Hub proxy listeners start. `stopServer()` closes clients, WebSocket handling, and both HTTP listeners without leaving either port occupied. Port `0` records actual assigned ports for tests.

## Browser UI Behavior

Renderer changes use capability checks, not copied web components.

- `HubDetail` keeps Electron `<webview>` locally and uses the isolated Hub proxy iframe in web mode, preserving toolbar, tabs, history, and resource-follow behavior.
- Hub login and account controls use the shared host `persist:hub` session in web mode.
- Settings hides native folder-selection, updater, developer, and remote-server lifecycle controls when their capabilities are false. Read-only host settings and safe backend actions remain visible.
- Reveal-in-folder actions are hidden when `revealInFolder` is false.
- Update prompts and updater actions are not subscribed or rendered when `updater` is false.
- `.var` drag/drop and file-input imports use chunked upload in web mode.
- If the host has no configured VaM directory, browser UI shows “Complete setup on the host desktop” instead of attempting the native first-run wizard.

Desktop UI and behavior must remain unchanged.

## Data and Event Flow

1. Browser requests `/`; host streams the renderer.
2. Browser creates same-origin WebSocket.
3. Server sends the existing hello frame with version and dev state.
4. Client applies the existing version compatibility gate.
5. Renderer API calls encode existing `{ t: 'rpc', id, channel, args }` frames.
6. Server channel policy rejects machine-local or forbidden handlers exactly as today.
7. Registered handlers read or mutate the host database and VaM filesystem.
8. RPC result returns to the caller; `notify()` events fan out through existing event frames.
9. Zustand stores refresh through their current subscriptions.

No data moves into browser persistence except existing renderer-local Zustand state and preferences. SQLite and VaM paths remain host-owned.

## Failure Handling

- Initial connection failure shows host URL and reconnect state. Transport continues current exponential backoff.
- Connection loss rejects in-flight requests using existing remote-error behavior.
- Reconnection after a prior successful session reloads the renderer to rebuild consistent store state.
- Version mismatch shows the existing fatal mismatch message.
- HTTP startup failure returns the current `{ ok: false, error }` result and does not report server running.
- Static file read failures return an HTTP error and are logged without crashing the backend.
- Unsupported browser operations return explicit unavailable values rather than hanging or invoking denied RPC channels.
- Trusted-intranet/no-auth behavior remains explicit in Settings and documentation: every machine able to reach the port can mutate the library.

## Testing

Focused automated checks cover:

- Shared API facade preserves current method names and routes through supplied transport.
- Browser runtime capability values and local fallback return shapes.
- Browser WebSocket URL derivation for HTTP and HTTPS origins.
- Static asset resolution, MIME types, cache headers, `HEAD`, SPA fallback, missing build, missing asset, malformed path, and traversal rejection.
- HTTP and WebSocket traffic share the app listener; Hub content redirects to a separate origin.
- Server stop releases both listeners.
- Hub proxy origin restriction, URL/header rewriting, body forwarding, and session reuse.
- Renderer adapter coverage for Hub iframe embedding, Hub account actions, native settings controls, reveal-in-folder, updater UI, and first-run host setup.
- Existing remote channel-policy tests continue passing.

Verification commands:

```text
npm run lint
npm run format:check
npm run test
npm run build
```

Manual smoke matrix:

| Host                                       | Client                       | Required result                                      |
| ------------------------------------------ | ---------------------------- | ---------------------------------------------------- |
| Windowed Electron with remote mode enabled | Same Electron window         | Existing desktop behavior unchanged                  |
| Windowed Electron with remote mode enabled | Desktop browser              | Library loads; mutations and events work             |
| `--serve` headless host                    | Desktop browser              | Site loads and core flows work                       |
| Either host                                | Browser disconnect/reconnect | Status updates; successful reconnect reloads cleanly |
| Either host                                | Browser `.var` import        | Chunked upload installs package                      |
| Either host                                | Browser Hub install          | Download progress and completion events update UI    |

## Remaining Native Boundaries

Hub browsing and account interactions now have browser parity. Electron-only operations remain capability-gated:

- Native folder pickers and Explorer reveal.
- App updater and developer tools.
- Remote server lifecycle controls.
