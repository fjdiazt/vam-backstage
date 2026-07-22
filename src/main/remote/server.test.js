import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./server.js', import.meta.url), 'utf8')

describe('remote server host', () => {
  it('serves app HTTP and WebSocket together and isolates the Hub proxy', () => {
    expect(source).toContain("import { createRemoteHttpServer } from './http-server.js'")
    expect(source).toContain("server.listen(port, '0.0.0.0',")
    expect(source).toContain('currentPort = listeningPort')
    expect(source).toContain('let httpServer = null')
    expect(source).not.toContain("new WebSocketServer({ host: '0.0.0.0', port })")
    expect(source).toContain('let hubHttpServer = null')
    expect(source).toContain('hubProxyPort')
    expect(source).toContain('await close(hubHttpServer)')
    expect(source).toContain('storageChannelUsesVam(channel)')
    expect(source).toContain("broadcast('storage:changed', storage)")
    expect(source).toContain('storageUnavailableError(storage)')
    expect(source).toContain('let replyError = err')
    expect(source).toContain('replyError = storageUnavailableError(storage)')
    expect(source).toContain('sendError(ws, id, replyError)')
  })
})
