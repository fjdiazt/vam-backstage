import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  hubPageCountLabel,
  hubPageForVisibleResourceIndex,
  shouldRenderHubPageNav,
  shouldRenderHubPageSummary,
} from './HubView'

const hubView = readFileSync(resolve(import.meta.dirname, 'HubView.jsx'), 'utf8')
const filterPanel = readFileSync(resolve(import.meta.dirname, '../components/FilterPanel.jsx'), 'utf8')

describe('Hub show filter UI', () => {
  it('uses switches for installed and hidden visibility', () => {
    const start = hubView.indexOf("key: 'show',")
    const end = hubView.indexOf('\n      },', start)
    const showSection = hubView.slice(start, end)

    expect(showSection).toContain("type: 'switches'")
    expect(showSection).toContain("label: 'Show'")
    expect(showSection).toContain("label: 'Installed'")
    expect(showSection).toContain('checked: !hideInstalled')
    expect(showSection).toContain('onCheckedChange: (checked) => setHideInstalled(!checked)')
    expect(showSection).toContain("label: 'Hidden'")
    expect(showSection).toContain('checked: showHidden')
    expect(showSection).toContain('onCheckedChange: setShowHidden')
    expect(filterPanel).toContain("import { Switch } from '@/components/ui/switch'")
    expect(filterPanel).toContain("section.type === 'switches'")
  })
})

describe('HubView infinite page tracking', () => {
  it('uses the API page containing the first visible resource', () => {
    expect(hubPageForVisibleResourceIndex(0, 60, 1)).toBe(1)
    expect(hubPageForVisibleResourceIndex(59, 60, 1)).toBe(1)
    expect(hubPageForVisibleResourceIndex(60, 60, 1)).toBe(2)
    expect(hubPageForVisibleResourceIndex(119, 60, 1)).toBe(2)
  })

  it('formats reported total pages without approximation', () => {
    expect(hubPageCountLabel(300)).toBe('300')
    expect(hubPageCountLabel(190)).toBe('190')
  })

  it('uses compact page size wording', () => {
    expect(hubView).toContain('Page size')
    expect(hubView).toContain('aria-label="Hub page size"')
    expect(hubView).not.toContain('/ page')
  })

  it('keeps page controls in the sticky toolbar', () => {
    expect(shouldRenderHubPageNav('infinite', 2)).toBe(true)
    expect(shouldRenderHubPageNav('paged', 2)).toBe(true)
    expect(shouldRenderHubPageNav('infinite', 2, false)).toBe(false)
    expect(shouldRenderHubPageNav('paged', 2, false)).toBe(true)
    expect(shouldRenderHubPageNav('paged', 1)).toBe(false)
    expect(hubView).toContain('{renderPageNav()}')
  })

  it('hides infinite page summary with infinite page controls', () => {
    expect(shouldRenderHubPageSummary('infinite', false)).toBe(false)
    expect(shouldRenderHubPageSummary('infinite', true)).toBe(true)
    expect(shouldRenderHubPageSummary('paged', false)).toBe(true)
  })

  it('wires infinite scrolling to start on the last page', () => {
    expect(hubView).toContain('onClick={() => goCurrentModePage(maxHubPage)}')
    expect(hubView).toContain('title="Last Hub page"')
  })

  it('wires wheel-up loading for earlier infinite pages', () => {
    expect(hubView).toContain('fetchPreviousPage')
    expect(hubView).toContain('onWheel={handleGalleryWheel}')
    expect(hubView).toContain('captureScrollAnchor')
    expect(hubView).toContain('requestAnimationFrame(() =>')
  })

  it('replaces paged results when detail Next crosses an API page boundary', () => {
    expect(hubView).toContain("if (browseMode === 'paged') goToPage(targetPage)")
    expect(hubView).toContain("if (wishlistMode || browseMode !== 'infinite'")
  })
})
