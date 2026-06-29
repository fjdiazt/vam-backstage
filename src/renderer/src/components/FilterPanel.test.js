import { describe, expect, it } from 'vitest'
import { filterLabelMatches } from './FilterPanel'

describe('filterLabelMatches', () => {
  it('returns every unselected label when query is empty', () => {
    const labels = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, name: `label-${i + 1}` }))

    expect(filterLabelMatches(labels, [2], '')).toHaveLength(39)
  })
})
