import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(import.meta.dirname, 'VirtualGrid.jsx'), 'utf8')

describe('virtual scroll back-to-top wiring', () => {
  it('renders the upstream shared ScrollToTopButton', () => {
    expect(source).toContain("import { ScrollToTopButton } from '@/components/ScrollToTopButton'")
    expect(source.match(/<ScrollToTopButton scrollRef=\{scrollRef\} \/>/g)).toHaveLength(2)
  })

  it('accepts an external scroll ref and wheel handler for Hub reverse paging', () => {
    expect(source).toContain('scrollRef: providedScrollRef')
    expect(source).toContain('const scrollRef = providedScrollRef || ownScrollRef')
    expect(source).toContain('onWheel={onWheel}')
  })

  it('restores persisted first-visible anchors in grid and table modes', () => {
    expect(source.match(/restoreIndex = null/g)).toHaveLength(2)
    expect(source.match(/onFirstVisibleIndexChange/g).length).toBeGreaterThanOrEqual(4)
    expect(source.match(/consumedRestoreKeyRef/g).length).toBeGreaterThanOrEqual(4)
  })
})
