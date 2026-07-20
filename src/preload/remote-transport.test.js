import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(import.meta.dirname, 'remote-transport.js'), 'utf8')

describe('preload remote transport adapter', () => {
  it('delegates socket behavior to the shared transport', () => {
    expect(source).toContain("from '@shared/remote-transport.js'")
    expect(source).toContain('createSharedRemoteTransport(url')
    expect(source).not.toContain("from '@shared/net-codec.js'")
  })
})
