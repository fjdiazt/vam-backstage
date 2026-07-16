import { beforeEach, describe, expect, it } from 'vitest'
import { useContentStore } from './useContentStore'
import { useLibraryStore } from './useLibraryStore'

describe('local view scroll anchor persistence', () => {
  beforeEach(() => {
    useLibraryStore.setState(useLibraryStore.getInitialState(), true)
    useContentStore.setState(useContentStore.getInitialState(), true)
  })

  it('persists and restores library first-visible filename', () => {
    useLibraryStore.getState().setScrollAnchorFilename('B.var')
    expect(useLibraryStore.getState().scrollAnchorFilename).toBe('B.var')
  })

  it('persists and restores content first-visible item', () => {
    useContentStore.getState().setScrollAnchorItem({ id: 2, packageFilename: 'B.var' })

    expect(useContentStore.getState()).toMatchObject({
      scrollAnchorItemId: 2,
      scrollAnchorPackageFilename: 'B.var',
    })
  })
})
