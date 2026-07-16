import { describe, expect, it } from 'vitest'
import { sectionActive } from './FilterPanel'

describe('sectionActive', () => {
  it('marks switch groups active when their value differs from the default', () => {
    expect(sectionActive({ value: [false, false], default: [false, false] })).toBe(false)
    expect(sectionActive({ value: [true, false], default: [false, false] })).toBe(true)
  })
})
