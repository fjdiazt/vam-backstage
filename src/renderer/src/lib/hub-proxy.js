const HUB_ORIGIN = 'https://hub.virtamate.com'
const HUB_PROXY_PREFIX = '/__hub'

export function isHubUrl(url) {
  try {
    return new URL(url).origin === HUB_ORIGIN
  } catch {
    return false
  }
}

export function hubProxyUrl(url) {
  const target = new URL(url)
  if (target.origin !== HUB_ORIGIN) throw new Error('Only Hub URLs can be embedded')
  return `${HUB_PROXY_PREFIX}${target.pathname}${target.search}${target.hash}`
}

export function hubUrlFromProxy(url) {
  const target = new URL(url)
  if (!target.pathname.startsWith(`${HUB_PROXY_PREFIX}/`)) throw new Error('Invalid Hub proxy URL')
  return `${HUB_ORIGIN}${target.pathname.slice(HUB_PROXY_PREFIX.length)}${target.search}${target.hash}`
}
