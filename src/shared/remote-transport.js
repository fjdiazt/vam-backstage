import { encode, decode } from './net-codec.js'
import { isDevVersion } from './version.js'

function rebuildError(info) {
  const err = new Error(info?.message || 'Remote error')
  if (info?.name) err.name = info.name
  if (info?.stack) err.stack = info.stack
  return err
}

export function createRemoteTransport(
  url,
  {
    createSocket = (target) => new WebSocket(target),
    identify = async () => ({ version: null, dev: false }),
    isLocalChannel = () => false,
    localInvoke = null,
    localSubscribe = null,
    stubs = {},
    reload = () => globalThis.location?.reload(),
  } = {},
) {
  let ws = null
  let ready = false
  let everConnected = false
  let fatal = null
  let reconnectTimer = null
  let backoff = 500

  let nextId = 1
  const pending = new Map()
  const queue = []

  const log = (...args) => console.info('[remote-client]', ...args)
  const eventSubs = new Map()
  const statusSubs = new Set()

  let localVersion = null
  let localDev = false

  function status() {
    return { connected: ready, url, error: fatal }
  }

  function emitStatus() {
    const next = status()
    for (const callback of statusSubs) {
      try {
        callback(next)
      } catch {}
    }
  }

  function connect() {
    log('connecting to', url)
    try {
      ws = createSocket(url)
    } catch (err) {
      log('WebSocket ctor threw:', err?.message)
      scheduleReconnect()
      return
    }
    ws.onopen = () => {
      log('socket open')
      backoff = 500
    }
    ws.onmessage = (event) => onFrame(event.data)
    ws.onclose = (event) => {
      log('socket closed', event?.code ?? '', event?.reason ?? '')
      ready = false
      ws = null
      emitStatus()
      if (!fatal) scheduleReconnect()
    }
    ws.onerror = () => {
      // onclose follows and handles reconnect.
    }
  }

  function scheduleReconnect() {
    if (fatal || reconnectTimer) return
    log('reconnect in', backoff, 'ms')
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, backoff)
    backoff = Math.min(backoff * 2, 10000)
  }

  function onFrame(raw) {
    let message
    try {
      message = decode(typeof raw === 'string' ? raw : String(raw))
    } catch {
      return
    }
    if (message.t === 'hello') {
      onHello(message)
    } else if (message.t === 'event') {
      dispatchEvent(message.channel, message.data)
    } else if (message.t === 'ok' || message.t === 'err') {
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.t === 'ok') request.resolve(message.result)
      else request.reject(rebuildError(message.error))
    }
  }

  function onHello(message) {
    const mismatch = localVersion && message.version && localVersion !== message.version
    const relaxed = localDev || message.dev || isDevVersion(localVersion) || isDevVersion(message.version)
    if (mismatch && relaxed) {
      log(`version mismatch (server ${message.version}, client ${localVersion}) allowed — dev build/mode on one side`)
    }
    if (mismatch && !relaxed) {
      fatal = `Version mismatch: server ${message.version}, client ${localVersion}. Update both to the same version.`
      ready = false
      emitStatus()
      const err = new Error(fatal)
      queue.length = 0
      for (const [, request] of pending) request.reject(err)
      pending.clear()
      try {
        ws?.close()
      } catch {}
      return
    }

    ready = true
    emitStatus()
    log('hello ok — connected (server', message.version + ')')

    if (everConnected) {
      log('reconnected after prior session — reloading renderer')
      reload()
      return
    }
    everConnected = true

    for (const frame of queue.splice(0)) rawSend(frame)
  }

  function rawSend(frame) {
    try {
      ws.send(encode(frame))
    } catch (err) {
      const request = pending.get(frame.id)
      if (request) {
        pending.delete(frame.id)
        request.reject(err)
      }
    }
  }

  function dispatchEvent(channel, data) {
    const subs = eventSubs.get(channel)
    if (!subs) return
    for (const callback of subs) {
      try {
        callback(data)
      } catch {}
    }
  }

  function remoteInvoke(channel, args) {
    if (fatal) return Promise.reject(new Error(fatal))
    return new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      const frame = { t: 'rpc', id, channel, args }
      if (ready && ws?.readyState === 1) rawSend(frame)
      else queue.push(frame)
    })
  }

  function invoke(channel, ...args) {
    if (isLocalChannel(channel)) {
      if (!localInvoke) return Promise.reject(new Error(`No local handler for "${channel}"`))
      return localInvoke(channel, args)
    }
    if (Object.hasOwn(stubs, channel)) {
      const value = stubs[channel]
      return Promise.resolve(typeof value === 'function' ? value(...args) : value)
    }
    return remoteInvoke(channel, args)
  }

  function on(channel, callback) {
    let subs = eventSubs.get(channel)
    if (!subs) {
      subs = new Set()
      eventSubs.set(channel, subs)
    }
    subs.add(callback)
    const offLocal = localSubscribe?.(channel, callback) || (() => {})
    return () => {
      subs.delete(callback)
      offLocal()
    }
  }

  function onStatus(callback) {
    statusSubs.add(callback)
    callback(status())
    return () => statusSubs.delete(callback)
  }

  Promise.resolve()
    .then(identify)
    .then(({ version, dev }) => {
      localVersion = version
      localDev = !!dev
    })
    .catch(() => {})
    .finally(connect)

  return {
    invoke,
    on,
    remote: {
      isRemote: true,
      url,
      onStatus,
    },
  }
}
