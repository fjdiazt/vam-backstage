import { once } from 'events'
import { createServer } from 'http'
import { Readable } from 'stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHubProxyHandler, filterHubResponseHeaders, rewriteHubText, toHubUrl, toProxyUrl } from './hub-proxy.js'

let server

afterEach(async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve))
})

async function serve(handler) {
  server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${server.address().port}`
}

describe('Hub proxy boundary', () => {
  it('maps only the fixed Hub origin', () => {
    expect(toHubUrl('/__hub/resources/42/?page=2')).toBe('https://hub.virtamate.com/resources/42/?page=2')
    expect(toProxyUrl('https://hub.virtamate.com/resources/42/')).toBe('/__hub/resources/42/')
    expect(() => toHubUrl('/__hub//evil.example/x')).toThrow('Invalid Hub proxy URL')
    expect(() => toProxyUrl('https://evil.example/x')).toThrow('Invalid Hub URL')
  })

  it('rewrites Hub HTML navigation and injects the iframe bridge', () => {
    const html = rewriteHubText(
      '<html><head></head><body><a href="/login/">Login</a><img src="https://hub.virtamate.com/x.png"></body></html>',
      'text/html; charset=utf-8',
    )

    expect(html).toContain('href="/__hub/login/"')
    expect(html).toContain('src="/__hub/x.png"')
    expect(html).toContain('vam-backstage:hub-location')
    expect(html).toContain('vam-backstage:hub-external')
  })

  it('rewrites root URLs in CSS and leaves binary text untouched', () => {
    expect(rewriteHubText('body{background:url(/styles/bg.png)}', 'text/css')).toBe(
      'body{background:url(/__hub/styles/bg.png)}',
    )
    expect(rewriteHubText('/images/raw', 'application/octet-stream')).toBe('/images/raw')
  })

  it('removes frame blockers and stale transformed-length headers', () => {
    expect(
      filterHubResponseHeaders({
        'content-type': ['text/html; charset=utf-8'],
        'content-length': ['123'],
        'content-encoding': ['gzip'],
        'x-frame-options': ['SAMEORIGIN'],
        'content-security-policy': ["frame-ancestors 'self'"],
        'cache-control': ['private'],
      }),
    ).toEqual({
      'content-type': ['text/html; charset=utf-8'],
      'cache-control': ['private'],
    })
  })

  it('forwards request bodies through the shared Hub session and rewrites responses', async () => {
    let options
    let body = ''
    const setHeader = vi.fn()
    const request = vi.fn((nextOptions) => {
      options = nextOptions
      const listeners = {}
      return {
        on: (event, callback) => {
          listeners[event] = callback
        },
        setHeader,
        write: (chunk) => {
          body += chunk.toString()
        },
        end: () => {
          const response = Readable.from(['<a href="/resources/42/">Resource</a>'])
          response.statusCode = 200
          response.headers = {
            'content-type': ['text/html; charset=utf-8'],
            'x-frame-options': ['SAMEORIGIN'],
          }
          listeners.response(response)
        },
      }
    })
    const handler = createHubProxyHandler({ request, getSession: () => 'hub-session' })
    const base = await serve(handler)

    const response = await fetch(`${base}/__hub/login/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'user=fred',
    })

    expect(options).toMatchObject({
      method: 'POST',
      url: 'https://hub.virtamate.com/login/',
      session: 'hub-session',
      useSessionCookies: true,
      redirect: 'follow',
    })
    expect(body).toBe('user=fred')
    expect(response.headers.get('x-frame-options')).toBeNull()
    expect(await response.text()).toContain('href="/__hub/resources/42/"')
  })
})
