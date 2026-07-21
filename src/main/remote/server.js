import { join } from 'path'
import { createServer } from 'http'
import { app, net, session } from 'electron'
import { encode, decode } from '@shared/net-codec.js'
import { DEFAULT_REMOTE_PORT } from '@shared/remote-config.js'
import { getHandler } from './registry.js'
import { CLIENT_LOCAL_EVENTS, isRemoteChannelDenied } from './channel-policy.js'
import { getWindow } from '../notify.js'
import { getSetting } from '../db.js'
import { createRemoteHttpServer } from './http-server.js'
import { createHubProxyHandler } from './hub-proxy.js'

// The version gate on the client relaxes when a peer reports `dev` — true for
// unpackaged runs and for packaged builds where DevTools/developer options have
// been unlocked (both signal a user who knowingly runs mixed versions).
function isDevMode() {
  if (!app.isPackaged) return true
  try {
    return getSetting('developer_options_unlocked') === '1'
  } catch {
    return false
  }
}

/**
 * LAN WebSocket bridge that re-exposes the captured ipcMain handlers (see
 * registry.js) as RPC, and rebroadcasts `notify()` events to every connected
 * client. Single-user / trusted-LAN: no auth, binds 0.0.0.0. Machine-local
 * channels are denied at dispatch (see channel-policy.js).
 */

let wss = null
let httpServer = null
let currentPort = null
let hubHttpServer = null
let currentHubProxyPort = null
const clients = new Set()

export function getStatus() {
  return { running: !!wss, port: currentPort, hubProxyPort: currentHubProxyPort, clients: clients.size }
}

// Push the current status to the local renderer so the Settings tab reflects
// client connects/disconnects live (only the local window runs the server UI —
// no need to broadcast this to remote clients).
function emitStatus() {
  try {
    getWindow()?.webContents.send('remote:server-status', getStatus())
  } catch {}
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error)
    server.once('error', onError)
    server.listen(port, '0.0.0.0', () => {
      server.off('error', onError)
      resolve(server.address().port)
    })
  })
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()))
}

export async function startServer(port = DEFAULT_REMOTE_PORT, { rendererRoot = join(__dirname, '../renderer') } = {}) {
  if (wss) return { ok: true, port: currentPort, hubProxyPort: currentHubProxyPort }

  const hubProxy = createHubProxyHandler({
    request: (options) => net.request(options),
    getSession: () => session.fromPartition('persist:hub'),
  })
  const proxyServer = createServer(hubProxy)
  let proxyPort
  try {
    proxyPort = await listen(proxyServer, port === 0 ? 0 : port + 1)
  } catch (error) {
    console.warn(`[remote] failed to start Hub proxy: ${error.message}`)
    return { ok: false, error: error.message }
  }

  const { server, wss: socketServer } = createRemoteHttpServer(rendererRoot, { hubProxyPort: proxyPort })
  socketServer.on('connection', registerClient)
  let listeningPort
  try {
    listeningPort = await listen(server, port)
  } catch (error) {
    try {
      socketServer.close()
    } catch {}
    await close(proxyServer)
    console.warn(`[remote] failed to start on port ${port}: ${error.message}`)
    return { ok: false, error: error.message }
  }

  hubHttpServer = proxyServer
  currentHubProxyPort = proxyPort
  httpServer = server
  wss = socketServer
  currentPort = listeningPort
  console.info(`[remote] serving on http://0.0.0.0:${currentPort} (Hub proxy ${currentHubProxyPort})`)
  emitStatus()
  return { ok: true, port: currentPort, hubProxyPort: currentHubProxyPort }
}

function registerClient(ws) {
  clients.add(ws)
  emitStatus()
  ws.on('close', () => {
    clients.delete(ws)
    emitStatus()
  })
  ws.on('error', () => {
    clients.delete(ws)
    emitStatus()
  })
  ws.on('message', (raw) => handleMessage(ws, raw))
  send(ws, { t: 'hello', version: app.getVersion(), dev: isDevMode() })
}

export async function stopServer() {
  if (!wss) return
  for (const ws of clients) {
    try {
      ws.close()
    } catch {}
  }
  clients.clear()
  await new Promise((resolve) => wss.close(() => resolve()))
  await new Promise((resolve) => httpServer.close(() => resolve()))
  wss = null
  httpServer = null
  currentPort = null
  await close(hubHttpServer)
  hubHttpServer = null
  currentHubProxyPort = null
  emitStatus()
}

/**
 * Fan a `notify()` event out to connected clients.
 * @param {string} channel
 * @param {*} data
 * @param {{ except?: import('ws').WebSocket | null }} [opts] — skip one socket
 *   (the remote peer that already applied the mutation via RPC).
 */
export function broadcast(channel, data, { except = null } = {}) {
  if (!wss || clients.size === 0 || CLIENT_LOCAL_EVENTS.has(channel)) return
  let frame
  try {
    frame = encode({ t: 'event', channel, data })
  } catch (err) {
    console.warn(`[remote] failed to encode event ${channel}: ${err.message}`)
    return
  }
  for (const ws of clients) {
    if (except && ws === except) continue
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(frame)
      } catch {}
    }
  }
}

function send(ws, obj) {
  try {
    ws.send(encode(obj))
  } catch (err) {
    console.warn(`[remote] send failed: ${err.message}`)
  }
}

async function handleMessage(ws, raw) {
  let msg
  try {
    msg = decode(raw.toString())
  } catch {
    return
  }
  if (!msg || msg.t !== 'rpc') return

  const { id, channel, args } = msg
  if (isRemoteChannelDenied(channel)) {
    send(ws, {
      t: 'err',
      id,
      error: { name: 'Error', message: `Remote channel not allowed: "${channel}"` },
    })
    return
  }

  const handler = getHandler(channel)
  if (!handler) {
    send(ws, { t: 'err', id, error: { name: 'Error', message: `No remote handler for "${channel}"` } })
    return
  }

  // Handlers ignore the Electron IpcMainInvokeEvent; we only attach `remoteWs`
  // so `notifyPeers()` can exclude this socket from the fan-out.
  const event = { sender: null, remoteWs: ws }
  let result
  try {
    result = await handler(event, ...(args || []))
  } catch (err) {
    sendError(ws, id, err)
    return
  }

  // Encode the reply explicitly (not via `send`, which swallows throws): if the
  // handler returned something the codec can't serialize, the client's pending
  // promise would otherwise hang forever. Fail it loud with an error frame.
  let frame
  try {
    frame = encode({ t: 'ok', id, result })
  } catch (err) {
    console.warn(`[remote] failed to encode result for "${channel}": ${err.message}`)
    sendError(ws, id, err)
    return
  }
  try {
    ws.send(frame)
  } catch (err) {
    console.warn(`[remote] send failed: ${err.message}`)
  }
}

function sendError(ws, id, err) {
  send(ws, {
    t: 'err',
    id,
    error: {
      name: err?.name || 'Error',
      message: err?.message || String(err),
      stack: !app.isPackaged ? err?.stack : undefined,
    },
  })
}
