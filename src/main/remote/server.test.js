import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./server.js', import.meta.url), 'utf8')

describe('remote server host', () => {
  it('serves HTTP and WebSocket traffic from one listener', () => {
    expect(source).toContain("import { createRemoteHttpServer } from './http-server.js'")
    expect(source).toContain("server.listen(port, '0.0.0.0')")
    expect(source).toContain('currentPort = server.address().port')
    expect(source).toContain('let httpServer = null')
    expect(source).not.toContain("new WebSocketServer({ host: '0.0.0.0', port })")
  })
})
