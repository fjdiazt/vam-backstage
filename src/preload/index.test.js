import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(import.meta.dirname, 'index.js'), 'utf8')

describe('preload API adapter', () => {
  it('routes network recovery through its transport', () => {
    expect(source).toContain("transport.invoke('downloads:network-online')")
    expect(source).not.toContain("\n  invoke('downloads:network-online')")
  })
})
