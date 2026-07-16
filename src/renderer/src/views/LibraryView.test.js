import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { labelsForPackages, LAZY_LABEL_LOADING } from './LibraryView'

const source = readFileSync(resolve(import.meta.dirname, 'LibraryView.jsx'), 'utf8')

describe('LibraryView label facets', () => {
  it('keeps label loading eager while facet-filtering options in memory', () => {
    expect(LAZY_LABEL_LOADING).toBe(false)
  })

  it('keeps label suggestions scoped to visible packages and selected labels', () => {
    const labels = [
      { id: 1, name: 'visible' },
      { id: 2, name: 'hidden' },
      { id: 3, name: 'selected-hidden' },
    ]
    const visiblePackages = [{ labelIds: [1] }]

    expect(labelsForPackages(labels, visiblePackages, [3]).map((l) => l.name)).toEqual(['visible', 'selected-hidden'])
  })

  it('uses content label categories for package label suggestions', () => {
    const labels = [
      { id: 1, name: 'look:vg' },
      { id: 2, name: 'pose' },
    ]
    const packages = [{ contentLabelIds: [1, 2], contentLabelCategories: { 1: ['Looks'], 2: ['Poses'] } }]

    expect(labelsForPackages(labels, packages, [], ['Looks']).map((l) => l.name)).toEqual(['look:vg'])
  })

  it('keeps the startup scroll restore token stable while scrolling', () => {
    expect(source).toContain('const restoreKeyRef = useRef(')
    expect(source).toContain('const restoreKey = restoreKeyRef.current')
  })
})
