import { describe, expect, it } from 'vitest'
import { filterHubResponseHeaders, rewriteHubText, toHubUrl, toProxyUrl } from './hub-proxy.js'

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
})
