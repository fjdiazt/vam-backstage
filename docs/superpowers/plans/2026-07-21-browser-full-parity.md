# Browser Hub Full-Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Give the intranet browser client the same in-app Hub browsing, login session, and Hub account controls as the Electron app while preserving one renderer and one trusted-LAN backend.

**Architecture:** The app HTTP/WebSocket listener redirects `/__hub/` into an adjacent-port, fixed-origin reverse proxy backed by Electron's `persist:hub` session. Web `HubDetail` renders that separate-origin proxy in an iframe and adapts the existing browser toolbar; Electron keeps its `<webview>`. Hub auth RPC and auth-change events become remote-safe because proxy browsing and the existing interaction handlers share the host's single-user Hub session.

**Tech Stack:** JavaScript, Electron `net`/`session`, Node HTTP, React 19, Vitest

## Global Constraints

- Trusted intranet only; no VaM Backstage auth, TLS, or multi-user isolation.
- Proxy only `https://hub.virtamate.com`; never become an open proxy.
- Reuse `persist:hub` so iframe login and existing favorite/bookmark/rate/like handlers share one session.
- Preserve Electron `<webview>` behavior unchanged.
- No new dependencies.
- Every behavior change follows red-green-refactor.

---

### Task 1: Hub proxy URL and content boundary

**Files:**

- Create: `src/main/remote/hub-proxy.js`
- Test: `src/main/remote/hub-proxy.test.js`

**Interfaces:**

- Produces: `HUB_PROXY_PREFIX`, `toHubUrl(requestUrl)`, `toProxyUrl(hubUrl)`, `rewriteHubText(text, contentType)`, `filterHubResponseHeaders(headers)`.
- Security invariant: `toHubUrl` returns only URLs on `https://hub.virtamate.com` and rejects malformed or non-prefixed input.

- [x] **Step 1: Write failing pure-function tests**

```js
expect(toHubUrl('/__hub/resources/42/?page=2')).toBe('https://hub.virtamate.com/resources/42/?page=2')
expect(() => toHubUrl('/__hub//evil.example/x')).toThrow('Invalid Hub proxy URL')
expect(toProxyUrl('https://hub.virtamate.com/resources/42/')).toBe('/__hub/resources/42/')
expect(rewriteHubText('<a href="/login/">', 'text/html')).toContain('href="/__hub/login/"')
expect(filterHubResponseHeaders({ 'x-frame-options': ['SAMEORIGIN'] })).not.toHaveProperty('x-frame-options')
```

- [x] **Step 2: Run test and verify RED**

Run: `npm test -- src/main/remote/hub-proxy.test.js`
Expected: FAIL because `hub-proxy.js` does not exist.

- [x] **Step 3: Implement minimum fixed-origin mapping and rewriting**

```js
export const HUB_PROXY_PREFIX = '/__hub'
export const HUB_ORIGIN = 'https://hub.virtamate.com'

export function toHubUrl(requestUrl) {
  const incoming = new URL(requestUrl, 'http://localhost')
  if (!incoming.pathname.startsWith(`${HUB_PROXY_PREFIX}/`)) throw new Error('Invalid Hub proxy URL')
  const target = new URL(`${incoming.pathname.slice(HUB_PROXY_PREFIX.length)}${incoming.search}`, HUB_ORIGIN)
  if (target.origin !== HUB_ORIGIN) throw new Error('Invalid Hub proxy URL')
  return target.href
}
```

Rewrite Hub absolute/root-relative HTML attributes, CSS `url(...)`, and absolute Hub URLs to `/__hub/`. Strip framing/CSP/content-length/content-encoding headers from transformed responses. Inject one inline bridge that posts navigation and external-link messages to the parent.

- [x] **Step 4: Run focused test and verify GREEN**

Run: `npm test -- src/main/remote/hub-proxy.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```text
git add src/main/remote/hub-proxy.js src/main/remote/hub-proxy.test.js
git commit -m "feat: add fixed-origin Hub proxy"
```

### Task 2: Serve proxied Hub on an isolated listener

**Files:**

- Modify: `src/main/remote/http-server.js`
- Modify: `src/main/remote/server.js`
- Modify: `src/main/remote/http-server.test.js`
- Test: `src/main/remote/hub-proxy.test.js`

**Interfaces:**

- Consumes: Task 1 URL/rewrite helpers.
- Produces: `createHubProxyHandler()`, a dedicated Hub proxy listener, and app-listener redirects for `/__hub/*`.

- [x] **Step 1: Write failing routing and transport tests**

```js
it('redirects Hub paths to the isolated proxy origin', async () => {
  const base = await start(root, { hubProxyOrigin: 'http://127.0.0.1:42070' })
  const response = await fetch(`${base}/__hub/login/`, { redirect: 'manual' })
  expect(response.status).toBe(307)
  expect(response.headers.get('location')).toBe('http://127.0.0.1:42070/__hub/login/')
})
```

Test that the transport forwards method/body and rewrites HTML plus redirects while removing frame blockers.

- [x] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/main/remote/http-server.test.js src/main/remote/hub-proxy.test.js`
Expected: FAIL because proxy routing/handler are absent.

- [x] **Step 3: Implement the proxy transport**

Use `electron.net.request` with `session.fromPartition('persist:hub')`, `useSessionCookies: true`, `redirect: 'follow'`, and upstream URL from `toHubUrl`. Forward request bodies and safe headers; rewrite incoming proxy `Origin`/`Referer` to the Hub origin. Stream binary responses; buffer only HTML/CSS/JavaScript that needs URL rewriting. Return `400` for invalid proxy paths and `502` for upstream errors.

Start `createHubProxyHandler()` on the adjacent port and pass its origin into `createRemoteHttpServer` for redirects. Keep WebSocket attachment on the app listener unchanged. Close both listeners during shutdown.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- src/main/remote/http-server.test.js src/main/remote/hub-proxy.test.js src/main/remote/server.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```text
git add src/main/remote/hub-proxy.js src/main/remote/hub-proxy.test.js src/main/remote/http-server.js src/main/remote/http-server.test.js src/main/remote/server.js
git commit -m "feat: proxy Hub through web host"
```

### Task 3: Share Hub authentication with browser clients

**Files:**

- Modify: `src/main/remote/channel-policy.js`
- Modify: `src/main/remote/channel-policy.test.js`
- Modify: `src/renderer/src/browser-api.js`
- Modify: `src/renderer/src/browser-api.test.js`

**Interfaces:**

- Consumes: existing `hub:isLoggedIn`, `hub:resourceUserState`, and Hub toggle handlers using `persist:hub`.
- Produces: web capabilities `embeddedHub: true`, `hubAccountActions: true`; RPC/event policy permits Hub auth methods and `hub:auth-changed`.

- [x] **Step 1: Write failing policy/capability tests**

```js
expect(isRemoteChannelDenied('hub:isLoggedIn')).toBe(false)
expect(isRemoteChannelDenied('hub:toggleLike')).toBe(false)
expect(CLIENT_LOCAL_EVENTS.has('hub:auth-changed')).toBe(false)
expect(api.runtime.capabilities.embeddedHub).toBe(true)
expect(api.runtime.capabilities.hubAccountActions).toBe(true)
```

- [x] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/main/remote/channel-policy.test.js src/renderer/src/browser-api.test.js`
Expected: FAIL against current denied channels and false capabilities.

- [x] **Step 3: Remove obsolete browser stubs and policy blocks**

Delete the six Hub auth/account stubs from `browser-api.js`, the corresponding exact denied channels from `channel-policy.js`, and `hub:auth-changed` from `CLIENT_LOCAL_EVENTS`. Set only `embeddedHub` and `hubAccountActions` true; native OS capabilities remain false.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- src/main/remote/channel-policy.test.js src/renderer/src/browser-api.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```text
git add src/main/remote/channel-policy.js src/main/remote/channel-policy.test.js src/renderer/src/browser-api.js src/renderer/src/browser-api.test.js
git commit -m "feat: share Hub session with web clients"
```

### Task 4: Render the Hub browser in web mode

**Files:**

- Create: `src/renderer/src/lib/hub-proxy.js`
- Test: `src/renderer/src/lib/hub-proxy.test.js`
- Modify: `src/renderer/src/components/HubDetail.jsx`
- Modify: `src/renderer/src/runtime-ui.test.js`

**Interfaces:**

- Produces: `hubProxyUrl(url)`, `hubUrlFromProxy(url)`, `isHubUrl(url)` for the iframe adapter.
- Behavior: Electron renders `<webview>`; web renders `<iframe>` at the same toolbar location.

- [x] **Step 1: Write failing URL and renderer-source tests**

```js
expect(hubProxyUrl('https://hub.virtamate.com/resources/42/')).toBe('/__hub/resources/42/')
expect(hubUrlFromProxy('http://vam:42069/__hub/resources/42/')).toBe('https://hub.virtamate.com/resources/42/')
expect(() => hubProxyUrl('https://evil.example/')).toThrow('Only Hub URLs can be embedded')
expect(hubDetailSource).toContain("runtime.kind === 'web'")
expect(hubDetailSource).toContain('<iframe')
```

- [x] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/renderer/src/lib/hub-proxy.test.js src/renderer/src/runtime-ui.test.js`
Expected: FAIL because URL helpers/iframe are absent.

- [x] **Step 3: Add the iframe adapter to existing toolbar logic**

In `HubDetail.jsx`, derive `isWebHub` from `window.api.runtime.kind`. Keep the current webview event effect for Electron only. For web:

- set iframe `src={hubProxyUrl(navUrl)}`;
- on bridge/load navigation, convert proxy URL back to Hub URL, update address/tab state, and call existing `followDetail` logic;
- back/forward/reload/stop use `contentWindow.history`, `location.reload`, and `stop`;
- address navigation accepts Hub URLs in-frame and opens non-Hub URLs externally;
- external-link bridge calls existing `window.api.shell.openExternal`;
- omit webview DevTools in web mode.

Keep the existing “Open Hub page” fallback only for runtimes where `embeddedHub` is false.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- src/renderer/src/lib/hub-proxy.test.js src/renderer/src/runtime-ui.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```text
git add src/renderer/src/lib/hub-proxy.js src/renderer/src/lib/hub-proxy.test.js src/renderer/src/components/HubDetail.jsx src/renderer/src/runtime-ui.test.js
git commit -m "feat: embed Hub in browser client"
```

### Task 5: Document and verify full parity

**Files:**

- Modify: `docs/superpowers/specs/2026-07-20-intranet-web-ui-design.md`
- Modify: `docs/Implementation.md`
- Modify: `README.md`

**Interfaces:**

- Documents the single-user shared Hub session and `/__hub/` proxy boundary.

- [x] **Step 1: Update docs**

Remove browser Hub browsing/account actions from exclusions and Future Full Parity. Document that the proxy is fixed to the Hub origin, strips frame-blocking headers only on proxied responses, and shares `persist:hub` across the single trusted user.

- [x] **Step 2: Run complete automated gate**

Run:

```text
npm run lint
npm run format:check
npm test
npm run build
```

Expected: all commands exit 0.

- [x] **Step 3: Run browser smoke**

Start the built app headless on an unused port. Verify:

```text
GET /                         -> 200
GET app /__hub/resources/    -> 307 to adjacent proxy origin
GET proxy /__hub/resources/  -> 200, no X-Frame-Options, rewritten /__hub/ asset links
WebSocket app-port hello     -> received
Browser Hub detail iframe    -> loads and follows Hub resource links inside the app
```

Stop the smoke host afterward.

- [x] **Step 4: Commit**

```text
git add README.md docs/Implementation.md docs/superpowers/specs/2026-07-20-intranet-web-ui-design.md docs/superpowers/plans/2026-07-21-browser-full-parity.md
git commit -m "docs: describe browser Hub parity"
```
