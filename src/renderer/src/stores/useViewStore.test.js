import { describe, expect, it } from 'vitest'
import { restoreView } from './useViewStore'

describe('active view restoration', () => {
  it('restores primary views and opens Hub after Settings', () => {
    expect(restoreView('hub')).toBe('hub')
    expect(restoreView('library')).toBe('library')
    expect(restoreView('content')).toBe('content')
    expect(restoreView('settings')).toBe('hub')
    expect(restoreView('graph')).toBeUndefined()
  })
})
