import { afterEach, describe, expect, it } from 'vitest'
import { decode, encode } from './net-codec.js'

const nodeBuffer = globalThis.Buffer

afterEach(() => {
  globalThis.Buffer = nodeBuffer
})

describe('browser codec', () => {
  it('round-trips binary without Node Buffer', () => {
    globalThis.Buffer = undefined
    const bytes = Uint8Array.from([0, 1, 127, 128, 254, 255])

    expect(decode(encode({ bytes }))).toEqual({ bytes })
  })

  it('preserves undefined values in RPC arguments and objects', () => {
    expect(decode(encode({ args: [undefined], value: undefined }))).toEqual({
      args: [undefined],
      value: undefined,
    })
  })
})
