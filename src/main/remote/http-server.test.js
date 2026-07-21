import { once } from 'events'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { createRemoteHttpServer } from './http-server.js'

let root
let created

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'vam-backstage-web-'))
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'index.html'), '<main>backstage</main>')
  await writeFile(join(root, 'assets', 'app.js'), 'export default true')
})

afterEach(async () => {
  if (created) {
    for (const client of created.wss.clients) client.terminate()
    await new Promise((resolve) => created.wss.close(resolve))
    if (created.server.listening) await new Promise((resolve) => created.server.close(resolve))
  }
  await rm(root, { recursive: true, force: true })
})

async function start(rendererRoot = root, options) {
  created = createRemoteHttpServer(rendererRoot, options)
  await new Promise((resolve) => created.server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${created.server.address().port}`
}

describe('remote HTTP listener', () => {
  it('serves index, assets, HEAD, cache headers, and SPA fallback', async () => {
    const base = await start()

    expect(await (await fetch(`${base}/`)).text()).toContain('backstage')
    const asset = await fetch(`${base}/assets/app.js`)
    expect(asset.headers.get('content-type')).toContain('javascript')
    expect(asset.headers.get('cache-control')).toContain('immutable')
    expect((await fetch(`${base}/library`)).status).toBe(200)
    expect((await fetch(`${base}/`, { method: 'HEAD' })).status).toBe(200)
  })

  it('rejects bad methods, missing assets, and traversal', async () => {
    const base = await start()

    expect((await fetch(base, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404)
    expect((await fetch(`${base}/%5c..%5csecret.txt`)).status).toBe(403)
  })

  it('returns 503 when renderer build is unavailable', async () => {
    const base = await start(join(root, 'missing'))

    const response = await fetch(base)
    expect(response.status).toBe(503)
    expect(await response.text()).toContain('npm run build')
  })

  it('accepts WebSocket upgrade on the same listener', async () => {
    const base = await start()
    const socket = new WebSocket(base.replace('http:', 'ws:'))

    await once(socket, 'open')
    expect(created.wss.clients.size).toBe(1)
    socket.close()
    await once(socket, 'close')
  })

  it('routes every Hub proxy method before static handling', async () => {
    const hubProxy = vi.fn((_request, response) => response.writeHead(204).end())
    const base = await start(root, { hubProxy })

    expect((await fetch(`${base}/__hub/login/`, { method: 'POST' })).status).toBe(204)
    expect(hubProxy).toHaveBeenCalledOnce()
  })
})
