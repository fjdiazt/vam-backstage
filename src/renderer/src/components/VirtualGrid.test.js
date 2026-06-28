import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(import.meta.dirname, 'VirtualGrid.jsx'), 'utf8')

describe('virtual scroll back-to-top wiring', () => {
  it('imports and renders the shared BackToTopButton', () => {
    expect(source).toContain("import BackToTopButton from './BackToTopButton'")
    expect(source.match(/<BackToTopButton scrollRef=\{scrollRef\} \/>/g)).toHaveLength(2)
  })

  it('gates the button behind showBackToTop for grid and list', () => {
    expect(source.match(/showBackToTop = false/g)).toHaveLength(2)
    expect(source.match(/\{showBackToTop && <BackToTopButton/g)).toHaveLength(2)
  })
})
