import { describe, expect, it } from 'vitest'
import { hubProxyUrl, hubUrlFromProxy, isHubUrl } from './hub-proxy.js'

describe('browser Hub proxy URLs', () => {
  it('maps Hub URLs to the same-origin proxy and back', () => {
    expect(hubProxyUrl('https://hub.virtamate.com/resources/42/?page=2#reviews')).toBe(
      '/__hub/resources/42/?page=2#reviews',
    )
    expect(hubUrlFromProxy('http://vam:42069/__hub/resources/42/?page=2#reviews')).toBe(
      'https://hub.virtamate.com/resources/42/?page=2#reviews',
    )
  })

  it('rejects non-Hub and non-proxy URLs', () => {
    expect(isHubUrl('https://hub.virtamate.com/resources/42/')).toBe(true)
    expect(isHubUrl('https://evil.example/')).toBe(false)
    expect(() => hubProxyUrl('https://evil.example/')).toThrow('Only Hub URLs can be embedded')
    expect(() => hubUrlFromProxy('http://vam:42069/library')).toThrow('Invalid Hub proxy URL')
  })
})
