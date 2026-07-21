export const HUB_PROXY_PREFIX = '/__hub'
export const HUB_ORIGIN = 'https://hub.virtamate.com'

const STRIPPED_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'content-security-policy',
  'content-security-policy-report-only',
  'keep-alive',
  'set-cookie',
  'transfer-encoding',
  'x-frame-options',
])

const IFRAME_BRIDGE = `<script>(function(){
  if(window.__vamBackstageHubBridge)return;window.__vamBackstageHubBridge=true;
  var send=function(type,url){parent.postMessage({type:type,url:url||location.href},location.origin)};
  var report=function(){send('vam-backstage:hub-location')};
  addEventListener('load',report);addEventListener('popstate',report);addEventListener('hashchange',report);
  document.addEventListener('click',function(e){
    if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    var a=e.target.closest('a[href]');if(!a)return;
    var href=a.getAttribute('href');if(!href||href.charAt(0)==='#'||href.indexOf('javascript:')===0)return;
    try{var u=new URL(href,location.href);if(u.origin!==location.origin||u.pathname.indexOf('/__hub/')!==0){
      e.preventDefault();e.stopImmediatePropagation();send('vam-backstage:hub-external',u.href);
    }else if(a.target&&a.target!=='_self'){e.preventDefault();location.href=u.href;}}
    catch(_){}
  },true);
  var open=window.open.bind(window);window.open=function(url){
    if(!url)return null;try{var u=new URL(url,location.href);if(u.origin===location.origin&&u.pathname.indexOf('/__hub/')===0){location.href=u.href;return null}
    send('vam-backstage:hub-external',u.href);return null}catch(_){return open(url)}};
  document.addEventListener('mousedown',function(e){if(e.button===3||e.button===4){e.preventDefault();send('vam-backstage:hub-history',String(e.button===3?-1:1))}},true);
})();</script>`

export function toHubUrl(requestUrl) {
  const incoming = new URL(requestUrl, 'http://localhost')
  if (!incoming.pathname.startsWith(`${HUB_PROXY_PREFIX}/`)) throw new Error('Invalid Hub proxy URL')
  const target = new URL(`${incoming.pathname.slice(HUB_PROXY_PREFIX.length)}${incoming.search}`, HUB_ORIGIN)
  if (target.origin !== HUB_ORIGIN) throw new Error('Invalid Hub proxy URL')
  return target.href
}

export function toProxyUrl(hubUrl) {
  const target = new URL(hubUrl)
  if (target.origin !== HUB_ORIGIN) throw new Error('Invalid Hub URL')
  return `${HUB_PROXY_PREFIX}${target.pathname}${target.search}${target.hash}`
}

export function rewriteHubText(text, contentType = '') {
  if (!/\b(?:text\/html|text\/css|javascript)\b/i.test(contentType)) return text

  let rewritten = text
    .replaceAll(`${HUB_ORIGIN}/`, `${HUB_PROXY_PREFIX}/`)
    .replaceAll(`//${new URL(HUB_ORIGIN).host}/`, `${HUB_PROXY_PREFIX}/`)
    .replace(
      /(\s(?:href|src|action|poster|srcset|data-[\w:-]+)\s*=\s*["'])\/(?!\/|__hub\/)/gi,
      `$1${HUB_PROXY_PREFIX}/`,
    )
    .replace(/(url\(\s*["']?)\/(?!\/|__hub\/)/gi, `$1${HUB_PROXY_PREFIX}/`)

  if (/\btext\/html\b/i.test(contentType)) {
    rewritten = rewritten.includes('</head>')
      ? rewritten.replace('</head>', `${IFRAME_BRIDGE}</head>`)
      : `${IFRAME_BRIDGE}${rewritten}`
  }
  return rewritten
}

function rewriteLocation(location) {
  const target = new URL(location, HUB_ORIGIN)
  return target.origin === HUB_ORIGIN ? toProxyUrl(target) : location
}

export function filterHubResponseHeaders(headers = {}) {
  const filtered = {}
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (STRIPPED_HEADERS.has(lower)) continue
    filtered[lower] = lower === 'location' ? (value.map?.(rewriteLocation) ?? rewriteLocation(value)) : value
  }
  return filtered
}

const REQUEST_HEADER_DENYLIST = new Set([
  'accept-encoding',
  'connection',
  'cookie',
  'host',
  'origin',
  'referer',
  'transfer-encoding',
])

function firstHeader(headers, name) {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value || ''
}

export function createHubProxyHandler({ request, getSession }) {
  return (incoming, outgoing) => {
    let url
    try {
      url = toHubUrl(incoming.url)
    } catch {
      outgoing.writeHead(400).end('Bad Hub proxy request')
      return
    }

    const upstream = request({
      method: incoming.method,
      url,
      session: getSession(),
      useSessionCookies: true,
      redirect: 'follow',
    })
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (!REQUEST_HEADER_DENYLIST.has(name.toLowerCase()) && value != null) upstream.setHeader(name, value)
    }
    upstream.setHeader('Accept-Encoding', 'identity')
    if (incoming.headers.origin) upstream.setHeader('Origin', HUB_ORIGIN)
    if (incoming.headers.referer) {
      try {
        const referer = new URL(incoming.headers.referer)
        upstream.setHeader('Referer', toHubUrl(`${referer.pathname}${referer.search}`))
      } catch {
        upstream.setHeader('Referer', HUB_ORIGIN)
      }
    }

    upstream.on('response', (response) => {
      const headers = filterHubResponseHeaders(response.headers)
      const contentType = firstHeader(headers, 'content-type')
      const transform = /\b(?:text\/html|text\/css|javascript)\b/i.test(contentType)
      outgoing.writeHead(response.statusCode || 502, headers)
      if (incoming.method === 'HEAD') {
        outgoing.end()
        return
      }
      if (!transform) {
        response.on('data', (chunk) => outgoing.write(chunk))
        response.on('end', () => outgoing.end())
        response.on('error', () => outgoing.destroy())
        return
      }
      const chunks = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.on('end', () => outgoing.end(rewriteHubText(Buffer.concat(chunks).toString('utf8'), contentType)))
      response.on('error', () => outgoing.destroy())
    })
    upstream.on('error', (error) => {
      if (!outgoing.headersSent) outgoing.writeHead(502)
      outgoing.end(`Hub proxy failed: ${error.message}`)
    })
    incoming.on('data', (chunk) => upstream.write(chunk))
    incoming.on('end', () => upstream.end())
  }
}
