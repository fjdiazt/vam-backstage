import { describe, expect, it } from 'vitest'
import { labelsForContentItems } from './ContentView'

describe('ContentView label facets', () => {
  it('keeps label suggestions scoped to visible content and selected labels', () => {
    const labels = [
      { id: 1, name: 'look:vg' },
      { id: 2, name: 'clothing:vg' },
      { id: 3, name: 'selected-hidden' },
    ]
    const visibleItems = [{ ownLabelIds: [1], package: { labelIds: [] } }]

    expect(labelsForContentItems(labels, visibleItems, [3]).map((l) => l.name)).toEqual(['look:vg', 'selected-hidden'])
  })
})
