import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HUB_PERSISTED_STATE, hubFilterSignature, hubTailCacheKey, useHubStore } from './useHubStore'
import { useInstalledStore } from './useInstalledStore'
import { persistViewState } from './persistViewState'

function resource(id) {
  return { resource_id: id, title: `Resource ${id}` }
}

const persistedState = () => persistViewState('test', HUB_PERSISTED_STATE).partialize(useHubStore.getState())

describe('useHubStore', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      api: {
        hub: {
          search: vi
            .fn()
            .mockImplementation(({ page }) =>
              Promise.resolve({ resources: [resource(page)], totalFound: 300, totalPages: 10 }),
            ),
          invalidateCaches: vi.fn(),
          filters: vi.fn().mockResolvedValue({ sort: ['Latest Update'] }),
        },
        settings: {
          get: vi.fn().mockResolvedValue(null),
          set: vi.fn(),
        },
      },
    })
    useHubStore.setState({
      resources: [],
      resourcesByIndex: {},
      loadedPages: new Set(),
      itemCount: 0,
      totalFound: 0,
      totalPages: 10,
      page: 3,
      startPage: 3,
      restorePage: 3,
      showInfinitePagerControls: true,
      trackInfiniteRestorePage: true,
      perPage: 60,
      browseMode: 'infinite',
      loading: false,
      loadingPrevious: false,
      tailResolving: false,
      error: null,
      tailCache: {},
      tailCacheLoaded: false,
      tailCacheKey: '',
      resolvedTotalPages: null,
      search: '',
      selectedType: 'All',
      paidFilter: 'all',
      authorSearch: '',
      selectedHubTags: [],
      sort: '',
      license: 'Any',
      hideInstalled: false,
      showHidden: false,
      filterOptions: null,
    })
    useInstalledStore.setState({ byHubResourceId: new Map() })
  })

  it('restarts infinite scrolling from a requested page', async () => {
    await useHubStore.getState().startInfiniteAtPage(2)

    expect(window.api.hub.search).toHaveBeenCalledWith(expect.objectContaining({ page: 2, perpage: 60 }))
    expect(useHubStore.getState().page).toBe(2)
  })

  it('persists infinite restore page separately from the loaded tail page', () => {
    useHubStore.setState({ browseMode: 'infinite', startPage: 1, restorePage: 3, page: 5 })

    expect(persistedState()).toMatchObject({ browseMode: 'infinite', page: 5, restorePage: 3 })
  })

  it('persists and restores page size', () => {
    useHubStore.setState({ browseMode: 'paged', page: 4, perPage: 120 })

    expect(persistedState()).toMatchObject({ page: 4, perPage: 120 })

    const restored = persistViewState('test', HUB_PERSISTED_STATE).merge(
      { page: 2, startPage: 2, restorePage: 2, perPage: 90 },
      useHubStore.getState(),
    )
    useHubStore.setState(restored)

    expect(useHubStore.getState()).toMatchObject({ page: 2, startPage: 2, restorePage: 2, perPage: 90 })
  })

  it('persists and restores Hub visibility toggles', () => {
    useHubStore.setState({ hideInstalled: true, showHidden: true })

    expect(persistedState()).toMatchObject({
      hideInstalled: true,
      showHidden: true,
    })

    const restored = persistViewState('test', HUB_PERSISTED_STATE).merge(
      { hideInstalled: false, showHidden: true },
      useHubStore.getState(),
    )
    useHubStore.setState(restored)

    expect(useHubStore.getState()).toMatchObject({ hideInstalled: false, showHidden: true })
  })

  it('loads an earlier sparse page without changing the selected page', async () => {
    useHubStore.setState({
      resourcesByIndex: { 120: resource(3) },
      loadedPages: new Set([3]),
      itemCount: 300,
      page: 3,
      startPage: 3,
      restorePage: 3,
      totalFound: 300,
      totalPages: 10,
      sort: 'Latest Update',
    })
    useHubStore.setState({ lastFetchedKey: hubFilterSignature(useHubStore.getState()) })

    await useHubStore.getState().loadRange(60, 119)

    expect(window.api.hub.search).toHaveBeenCalledWith(expect.objectContaining({ page: 2, perpage: 60 }))
    expect(useHubStore.getState().resourcesByIndex[60]).toEqual(resource(2))
    expect(useHubStore.getState().page).toBe(3)
  })

  it('resizes infinite start page from the restore page without fetching twice', () => {
    useHubStore.setState({ browseMode: 'infinite', startPage: 1, restorePage: 3, page: 5, perPage: 60 })

    useHubStore.getState().setPerPage(120)

    expect(useHubStore.getState()).toMatchObject({ page: 2, startPage: 2, restorePage: 2, perPage: 120 })
    expect(window.api.hub.search).not.toHaveBeenCalled()
  })

  it('tracks infinite restore page when enabled', () => {
    useHubStore.setState({ browseMode: 'infinite', startPage: 1, restorePage: 1, page: 5 })

    useHubStore.getState().setInfiniteRestorePage(4)

    expect(useHubStore.getState().startPage).toBe(1)
    expect(persistedState()).toMatchObject({ restorePage: 4 })
  })

  it('can disable infinite restore tracking later', () => {
    useHubStore.setState({
      browseMode: 'infinite',
      startPage: 1,
      restorePage: 1,
      page: 5,
      trackInfiniteRestorePage: false,
    })

    useHubStore.getState().setInfiniteRestorePage(4)

    expect(persistedState()).toMatchObject({ restorePage: 1 })
  })

  it('normalizes hub sort before exposing loaded filter options', async () => {
    const snapshots = []
    const unsubscribe = useHubStore.subscribe((state) => {
      snapshots.push({ filterOptions: state.filterOptions, sort: state.sort })
    })

    useHubStore.setState({ filterOptions: null, sort: 'Missing Sort', resources: [] })
    await useHubStore.getState().fetchFilters(true)
    unsubscribe()

    expect(snapshots).not.toContainEqual({ filterOptions: { sort: ['Latest Update'] }, sort: 'Missing Sort' })
  })

  it('keeps page 1 empty without probing lower pages', async () => {
    window.api.hub.search.mockResolvedValueOnce({ resources: [], totalFound: 0, totalPages: 0 })

    await useHubStore.getState().fetchResources(true, { page: 1 })

    expect(window.api.hub.search).toHaveBeenCalledTimes(1)
    expect(useHubStore.getState()).toMatchObject({ resources: [], page: 1, totalPages: 0, loading: false })
  })

  it('keeps non-empty requested pages unchanged', async () => {
    useHubStore.setState({ browseMode: 'paged' })
    window.api.hub.search.mockResolvedValueOnce({ resources: [resource(3)], totalFound: 90, totalPages: 3 })

    await useHubStore.getState().fetchResources(true, { page: 3 })

    expect(window.api.hub.search).toHaveBeenCalledTimes(1)
    expect(window.api.hub.search).toHaveBeenCalledWith(expect.objectContaining({ page: 3 }))
    expect(useHubStore.getState()).toMatchObject({ resources: [resource(3)], page: 3, totalPages: 3 })
  })

  it('resolves an empty tail page to the last non-empty page', async () => {
    window.api.hub.search.mockImplementation(({ page }) => {
      const resources = page <= 6 ? [resource(page)] : []
      return Promise.resolve({ resources, totalFound: 600, totalPages: 10 })
    })

    await useHubStore.getState().fetchResources(true, { page: 10 })

    expect(window.api.hub.search.mock.calls.length).toBeLessThanOrEqual(5)
    expect(useHubStore.getState()).toMatchObject({
      page: 6,
      startPage: 6,
      restorePage: 6,
      totalPages: 6,
    })
    expect(useHubStore.getState().resourcesByIndex[300]).toEqual(resource(6))
  })

  it('uses a persisted resolved tail page cache', async () => {
    const key = hubTailCacheKey(useHubStore.getState())
    useHubStore.setState({ tailCache: { [key]: { totalPages: 6 } } })

    await useHubStore.getState().fetchResources(true, { page: 10 })

    expect(window.api.hub.search).toHaveBeenCalledWith(expect.objectContaining({ page: 6, perpage: 60 }))
    expect(useHubStore.getState()).toMatchObject({ page: 6, totalPages: 6, resolvedTotalPages: 6 })
  })

  it('resolves and caches the actual tail page', async () => {
    window.api.hub.search.mockImplementation(({ page }) => {
      const resources = page <= 6 ? [resource(page)] : []
      return Promise.resolve({ resources, totalFound: 300, totalPages: 10 })
    })

    await useHubStore.getState().fetchResources(true, { page: 1 })
    await useHubStore.getState().resolveTailPages()

    expect(useHubStore.getState()).toMatchObject({ totalPages: 6, resolvedTotalPages: 6 })
    const key = hubTailCacheKey(useHubStore.getState())
    expect(useHubStore.getState().tailCache[key]).toMatchObject({ totalPages: 6 })
  })

  it('force rechecks a cached tail page for newly-added pages', async () => {
    const key = hubTailCacheKey(useHubStore.getState())
    useHubStore.setState({
      tailCacheLoaded: true,
      tailCache: { [key]: { totalPages: 6 } },
      resolvedTotalPages: 6,
      totalPages: 6,
      page: 6,
    })
    window.api.hub.search.mockImplementation(({ page }) => {
      const resources = page <= 8 ? [resource(page)] : []
      return Promise.resolve({ resources, totalFound: 480, totalPages: 10 })
    })

    await useHubStore.getState().resolveTailPages({ force: true })

    expect(window.api.hub.search).toHaveBeenCalledWith(expect.objectContaining({ page: 7 }))
    expect(useHubStore.getState()).toMatchObject({ totalPages: 8, resolvedTotalPages: 8 })
  })
})
