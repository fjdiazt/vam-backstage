import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { createServer } from 'http'
import { extname, resolve, sep } from 'path'
import { WebSocketServer } from 'ws'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

function end(response, status, body, headers) {
  response.writeHead(status, headers).end(body)
}

export function createRemoteHttpServer(rendererRoot, { hubProxy, hubProxyPort } = {}) {
  const root = resolve(rendererRoot)
  const server = createServer(async (request, response) => {
    let pathname
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    } catch {
      end(response, 400, 'Bad request')
      return
    }

    if (pathname.startsWith('/__hub/')) {
      if (hubProxyPort) {
        const requestHost = request.headers.host || 'localhost'
        const hostname = new URL(`http://${requestHost}`).hostname
        const host = hostname.includes(':') ? `[${hostname}]` : hostname
        response.writeHead(307, { Location: `http://${host}:${hubProxyPort}${request.url}` }).end()
        return
      }
      if (hubProxy) hubProxy(request, response)
      else end(response, 404, 'Not found')
      return
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      end(response, 405, undefined, { Allow: 'GET, HEAD' })
      return
    }

    const relative = pathname.replace(/^\/+/, '').replaceAll('/', sep) || 'index.html'
    let target = resolve(root, relative)
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      end(response, 403, 'Forbidden')
      return
    }

    let info
    try {
      info = await stat(target)
    } catch {
      if (relative === 'index.html') {
        end(response, 503, 'Renderer build unavailable. Run npm run build.')
        return
      }
      if (extname(relative)) {
        end(response, 404, 'Not found')
        return
      }
      target = resolve(root, 'index.html')
      try {
        info = await stat(target)
      } catch {
        end(response, 503, 'Renderer build unavailable. Run npm run build.')
        return
      }
    }

    if (!info.isFile()) {
      end(response, 404, 'Not found')
      return
    }

    response.setHeader('Content-Type', TYPES[extname(target).toLowerCase()] || 'application/octet-stream')
    response.setHeader('Content-Length', info.size)
    response.setHeader(
      'Cache-Control',
      relative.startsWith(`assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    )
    response.writeHead(200)
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    createReadStream(target)
      .on('error', () => response.destroy())
      .pipe(response)
  })

  return { server, wss: new WebSocketServer({ server }) }
}
