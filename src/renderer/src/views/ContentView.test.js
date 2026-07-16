import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { labelsForContentItems, LAZY_LABEL_LOADING } from './ContentView'

const source = readFileSync(resolve(import.meta.dirname, 'ContentView.jsx'), 'utf8')

describe('ContentView label facets', () => {
  it('keeps label loading eager while facet-filtering options in memory', () => {
    expect(LAZY_LABEL_LOADING).toBe(false)
  })

  it('keeps label suggestions scoped to visible content and selected labels', () => {
    const labels = [
      { id: 1, name: 'look:vg' },
      { id: 2, name: 'clothing:vg' },
      { id: 3, name: 'selected-hidden' },
    ]
    const visibleItems = [{ category: 'Looks', ownLabelIds: [1], package: { labelIds: [] } }]

    expect(labelsForContentItems(labels, visibleItems, [3]).map((label) => label.name)).toEqual([
      'look:vg',
      'selected-hidden',
    ])
  })

  it('uses BrowserAssist category for scene-look label suggestions', () => {
    const labels = [
      { id: 1, name: 'looks:vg' },
      { id: 2, name: 'scene-only' },
    ]
    const items = [{ category: 'Scenes', ownLabelIds: [1, 2], labelSourceCategories: { 1: 'Looks', 2: 'Scenes' } }]

    expect(labelsForContentItems(labels, items, [], ['Looks']).map((l) => l.name)).toEqual(['looks:vg'])
  })

  it('keeps the startup scroll restore token stable while scrolling', () => {
    expect(source).toContain('const restoreKeyRef = useRef(')
    expect(source).toContain('const restoreKey = restoreKeyRef.current')
  })
})
