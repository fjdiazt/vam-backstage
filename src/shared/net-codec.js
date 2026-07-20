/**
 * Wire codec for the remote (client-server) transport. Mirrors the subset of
 * structured-clone semantics the IPC boundary actually relies on: primitives,
 * plain objects/arrays, `BigInt`, and binary (`Buffer`/`Uint8Array`, used by
 * thumbnails + avatars).
 *
 * We deliberately do NOT use a `JSON.stringify` replacer: `stringify` invokes a
 * value's own `toJSON()` *before* the replacer runs, and both `Buffer` and
 * `Date` define one — so a replacer would see `{type:'Buffer',data:[…]}` /
 * an ISO string and could neither tag binary nor detect a `Date`. Instead we
 * walk the value ourselves, tag the special types, and pass a JSON-clean tree
 * to `stringify`. Any non-plain object we don't recognize (Map, Set, Date,
 * class instance, function) throws instead of silently mangling — unknown
 * types fail loud the first time they cross the wire.
 *
 * Main/preload use Node Buffer; browser clients use btoa/atob. Both paths
 * produce the same tagged JSON representation.
 *
 */

function isPlainObject(v) {
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function bytesToBase64(value) {
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (globalThis.Buffer) return globalThis.Buffer.from(bytes).toString('base64')

  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return globalThis.btoa(binary)
}

function base64ToBytes(value) {
  if (globalThis.Buffer) return Uint8Array.from(globalThis.Buffer.from(value, 'base64'))

  const binary = globalThis.atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}
function encodeVal(v) {
  if (v === null || v === undefined) return v
  const t = typeof v
  if (t === 'string' || t === 'number' || t === 'boolean') return v
  if (t === 'bigint') return { __t: 'bigint', value: v.toString() }
  if (t === 'function' || t === 'symbol') throw new TypeError(`net-codec: cannot serialize ${t}`)

  if (v instanceof Uint8Array) {
    // Covers Node Buffer too (Buffer extends Uint8Array). Slice to the view's
    // own window so a pooled Buffer doesn't leak neighbouring bytes.
    return { __t: 'buffer', base64: bytesToBase64(v) }
  }
  if (Array.isArray(v)) return v.map(encodeVal)
  if (isPlainObject(v)) {
    const out = {}
    for (const k of Object.keys(v)) out[k] = encodeVal(v[k])
    return out
  }

  const name = v.constructor?.name || Object.prototype.toString.call(v)
  throw new TypeError(`net-codec: cannot serialize non-plain object (${name})`)
}

function decodeVal(v) {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(decodeVal)
  if (v.__t === 'buffer') return base64ToBytes(v.base64)
  if (v.__t === 'bigint') return BigInt(v.value)
  const out = {}
  for (const k of Object.keys(v)) out[k] = decodeVal(v[k])
  return out
}

export function encode(value) {
  return JSON.stringify(encodeVal(value))
}

export function decode(text) {
  return decodeVal(JSON.parse(text))
}
