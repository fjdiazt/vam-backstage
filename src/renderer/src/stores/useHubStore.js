import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { toast } from '@/components/Toast'
import { useInstalledStore } from './useInstalledStore'
import {
  persistViewState,
  oneOf,
  asArray,
  asPolarityList,
  asString,
  asBool,
  asObject,
  asClamped,
  asCardWidth,
} from './persistViewState'

/** Gallery data sources. Extend this (and the toolbar segmented control) to add future modes. */
export const GALLERY_MODES = ['hub', 'wishlist']
export const HUB_PER_PAGE_OPTIONS = [30, 60, 90, 120]

/**
 * Freshness key over the hub-query fields, so returning to Hub doesn't refetch
 * page 1 when nothing changed. Excludes wishlist filters (client-side, no fetch).
 */
export function hubFilterSignature(state) {
  return [
    state.search,
    state.selectedType,
    state.paidFilter,
    state.authorSearch,
    state.selectedHubTags.join(','),
    state.sort,
    state.license,
    state.perPage,
  ].join('\u0000')
}

/** Hub-search filter defaults (server-side query). `sort` is excluded — its default is
 *  resolved dynamically from the server's option list, and reordering doesn't hide content. */
export const HUB_FILTER_DEFAULTS = {
  search: '',
  selectedType: 'All',
  paidFilter: 'all',
  authorSearch: '',
  /** Hub tag filter — joined with comma for `getResources` */
  selectedHubTags: [],
  license: 'Any',
}

/** Wishlist gallery filter defaults — client-side only (the wishlist is a local list,
 *  never a hub query), independent from the hub-search filters above so the two modes
 *  never clobber each other. `wlSort` is excluded like `sort`. */
export const WISHLIST_FILTER_DEFAULTS = {
  wlSearch: '',
  wlType: 'All',
  wlTags: [],
  wlPaid: 'all',
  wlAuthor: '',
  wlExcludedAuthors: [],
  wlLicense: 'Any',
}

let fetchSeq = 0
let tailResolveSeq = 0

function syncInstalledFromResources(resources) {
  useInstalledStore.getState().applyBatch(
    resources.map((r) => ({
      hubResourceId: r.resource_id,
      installed: r._installed,
      isDirect: r._isDirect,
      filename: r._localFilename,
    })),
  )
}

function syncInstalledFromDetail(detail) {
  if (!detail?.resource_id) return
  useInstalledStore.getState().update(detail.resource_id, detail._installed, detail._isDirect, detail._localFilename)
}

function hubResources(result) {
  return Array.isArray(result?.resources) ? result.resources : []
}

function hubSearchParams(state, page) {
  const params = { page, perpage: state.perPage }
  if (state.sort) params.sort = state.sort
  if (state.search) params.search = state.search
  if (state.selectedType !== 'All') params.type = state.selectedType
  if (state.paidFilter === 'free') params.category = 'Free'
  else if (state.paidFilter === 'paid') params.category = 'Paid'
  if (state.authorSearch) params.username = state.authorSearch
  if (state.selectedHubTags?.length) params.tags = state.selectedHubTags.join(',')
  if (state.license && state.license !== 'Any') params.license = state.license
  return params
}

export function hubTailCacheKey(state) {
  return JSON.stringify({
    search: state.search || '',
    selectedType: state.selectedType || 'All',
    paidFilter: state.paidFilter || 'all',
    authorSearch: state.authorSearch || '',
    selectedHubTags: state.selectedHubTags || [],
    sort: state.sort || '',
    license: state.license || 'Any',
    perPage: state.perPage,
  })
}

function cachedTailPage(cache, key) {
  const entry = cache?.[key]
  const page = typeof entry === 'number' ? entry : entry?.totalPages
  return Number.isInteger(page) && page > 0 ? page : null
}

async function resolveEmptyTailPage(params, requestedPage, isCurrent) {
  let emptyUpper = requestedPage
  let lowerPage = 0
  let lowerResult = null
  let step = 1

  while (requestedPage - step > 0) {
    const page = Math.max(1, requestedPage - step)
    const result = await window.api.hub.search({ ...params, page })
    if (!isCurrent()) return null
    if (hubResources(result).length) {
      lowerPage = page
      lowerResult = result
      break
    }
    emptyUpper = page
    step *= 2
  }

  if (!lowerResult) {
    const result = await window.api.hub.search({ ...params, page: 1 })
    return isCurrent() ? { page: 1, result } : null
  }

  while (lowerPage + 1 < emptyUpper) {
    const page = Math.floor((lowerPage + emptyUpper) / 2)
    const result = await window.api.hub.search({ ...params, page })
    if (!isCurrent()) return null
    if (hubResources(result).length) {
      lowerPage = page
      lowerResult = result
    } else {
      emptyUpper = page
    }
  }

  return { page: lowerPage, result: lowerResult }
}

async function resolveTailPage(params, reportedPage, isCurrent) {
  const page = Math.max(1, Number(reportedPage) || 1)
  const result = await window.api.hub.search({ ...params, page })
  if (!isCurrent()) return null
  if (hubResources(result).length) return { page, result }
  return resolveEmptyTailPage(params, page, isCurrent)
}

// Renderer-side detail cache (insertion-order LRU). The main process already
// caches detail payloads, but every `openDetail` still clears `detailData` and
// awaits an async IPC round-trip — so without this the panel always flashes a
// skeleton for a frame even on a cache hit. Seeding from here lets openDetail
// render the known detail synchronously and revalidate in the background.
const MAX_DETAIL_CACHE = 60
const detailCache = new Map()
function cacheDetail(detail) {
  if (!detail?.resource_id) return
  const key = String(detail.resource_id)
  detailCache.delete(key)
  detailCache.set(key, detail)
  if (detailCache.size > MAX_DETAIL_CACHE) detailCache.delete(detailCache.keys().next().value)
}

export const HUB_PERSISTED_STATE = {
  search: asString,
  selectedType: asString,
  paidFilter: oneOf(['all', 'free', 'paid']),
  selectedHubTags: asArray,
  authorSearch: asString,
  license: asString,
  sort: asString,
  hideInstalled: asBool,
  showHidden: asBool,
  browseMode: oneOf(['infinite', 'paged']),
  page: asClamped(1, Number.MAX_SAFE_INTEGER),
  startPage: asClamped(1, Number.MAX_SAFE_INTEGER),
  restorePage: asClamped(1, Number.MAX_SAFE_INTEGER),
  perPage: oneOf(HUB_PER_PAGE_OPTIONS),
  showInfinitePagerControls: asBool,
  trackInfiniteRestorePage: asBool,
  tailCache: asObject,
  wlSearch: asString,
  wlType: asString,
  wlTags: asPolarityList,
  wlPaid: oneOf(['all', 'free', 'paid']),
  wlAuthor: asString,
  wlExcludedAuthors: asArray,
  wlLicense: asString,
  wlSort: asString,
  cardMode: oneOf(['minimal', 'medium']),
  cardWidth: asCardWidth,
}

export const useHubStore = create(
  persist(
    (set, get) => ({
      resources: [],
      totalFound: 0,
      totalPages: 0,
      page: 1,
      startPage: 1,
      restorePage: 1,
      perPage: HUB_PER_PAGE_OPTIONS[0],
      browseMode: 'infinite',
      showInfinitePagerControls: true,
      trackInfiniteRestorePage: true,
      loading: false,
      loadingPrevious: false,
      tailResolving: false,
      error: null,
      tailCache: {},
      tailCacheKey: '',
      resolvedTotalPages: null,
      // Hub filter signature at the last reset-fetch; lets HubView skip a redundant
      // reset+fetch on reveal. Not persisted (nor are resources), so launch refetches.
      lastFetchedKey: null,

      ...HUB_FILTER_DEFAULTS,
      sort: '',
      hideInstalled: false,
      showHidden: false,

      // `wlSort` values are the local sort keys defined in HubView (WISHLIST_SORTS);
      // default 'added' = created_at DESC.
      ...WISHLIST_FILTER_DEFAULTS,
      wlSort: 'added',

      detailResource: null,
      detailData: null,
      detailLoading: false,
      // Bumped on every explicit detail open (gallery click, cross-view nav, prev/next
      // jump) so HubDetail can be keyed on it and remount for a fresh load. Deliberately
      // NOT changed by followDetail, which must keep the webview mounted while the user
      // browses inside the guest page.
      detailNonce: 0,
      // Stack of prior packages when drilling via Hub-available deps. Each entry is
      // `{ resource, title }` — Back pops this instead of closing to the gallery.
      // Cleared on gallery/pager opens and on closeDetail.
      detailHistory: [],
      // Resource id whose detail followDetail is fetching in the background; dedupes
      // concurrent follows and lets stale responses be discarded after a newer
      // follow/open supersedes them.
      followingDetailId: null,
      cardMode: 'medium',
      cardWidth: 220,

      // Gallery data source (see GALLERY_MODES): 'hub' search or local 'wishlist'.
      // Not persisted — always start in hub mode after a restart; switching never
      // touches hub search state (filters/results/page), so switching back is lossless.
      galleryMode: 'hub',

      filterOptions: null,

      setSearch: (search) => set({ search }),
      setSelectedType: (selectedType) => set({ selectedType }),
      setPaidFilter: (paidFilter) => set({ paidFilter }),
      setAuthorSearch: (authorSearch) => set({ authorSearch }),
      setSelectedHubTags: (selectedHubTags) => set({ selectedHubTags }),
      setSort: (sort) => set({ sort }),
      setLicense: (license) => set({ license }),
      setHideInstalled: (hideInstalled) => set({ hideInstalled }),
      setShowHidden: (showHidden) => set({ showHidden }),
      setWlSearch: (wlSearch) => set({ wlSearch }),
      setWlType: (wlType) => set({ wlType }),
      setWlTags: (wlTags) => set({ wlTags }),
      setWlPaid: (wlPaid) => set({ wlPaid }),
      setWlAuthor: (wlAuthor) => set({ wlAuthor }),
      setWlExcludedAuthors: (wlExcludedAuthors) => set({ wlExcludedAuthors }),
      setWlLicense: (wlLicense) => set({ wlLicense }),
      setWlSort: (wlSort) => set({ wlSort }),
      setCardMode: (cardMode) => set({ cardMode }),
      setCardWidth: (cardWidth) => set({ cardWidth }),
      setGalleryMode: (galleryMode) => set({ galleryMode }),
      setPage: (page) => set({ page }),
      setBrowseMode: (browseMode) => set({ browseMode: browseMode === 'paged' ? 'paged' : 'infinite' }),
      setShowInfinitePagerControls: (showInfinitePagerControls) => set({ showInfinitePagerControls }),
      setTrackInfiniteRestorePage: (trackInfiniteRestorePage) => set({ trackInfiniteRestorePage }),
      setInfiniteRestorePage: (page) => {
        const state = get()
        if (!state.trackInfiniteRestorePage) return
        const restorePage = Math.min(Math.max(1, Number(page) || 1), Math.max(state.totalPages || 1, 1))
        if (restorePage !== state.restorePage) set({ restorePage })
      },
      setPerPage: (perPage) => {
        const nextPerPage = HUB_PER_PAGE_OPTIONS.includes(Number(perPage)) ? Number(perPage) : HUB_PER_PAGE_OPTIONS[0]
        const state = get()
        if (nextPerPage === state.perPage) return
        const basePage = state.browseMode === 'infinite' ? state.restorePage : state.page
        const nextPage = Math.floor(((basePage - 1) * state.perPage) / nextPerPage) + 1
        set({ perPage: nextPerPage, page: nextPage, startPage: nextPage, restorePage: nextPage })
      },
      goToPage: async (page) => {
        const target = Math.max(1, Number(page) || 1)
        if (get().resolvedTotalPages && target >= get().resolvedTotalPages) {
          const resolved = await get().resolveTailPages({ force: true })
          return get().fetchResources(true, { page: resolved || target })
        }
        return get().fetchResources(true, { page: target })
      },
      startInfiniteAtPage: async (page) => {
        const target = Math.min(Math.max(1, Number(page) || 1), Math.max(get().totalPages || 1, 1))
        if (get().resolvedTotalPages && target >= get().resolvedTotalPages) {
          const resolved = Math.max(1, Number(await get().resolveTailPages({ force: true })) || target)
          set({ startPage: resolved, restorePage: resolved })
          return get().fetchResources(true, { page: resolved })
        }
        set({ startPage: target, restorePage: target })
        return get().fetchResources(true, { page: target })
      },
      clearCurrentTailCache: () => {
        const key = hubTailCacheKey(get())
        if (!get().tailCache[key]) return set({ resolvedTotalPages: null, tailCacheKey: key })
        const tailCache = { ...get().tailCache }
        delete tailCache[key]
        set({ tailCache, resolvedTotalPages: null, tailCacheKey: key })
      },
      resolveTailPages: async ({ force = false } = {}) => {
        const state = get()
        const key = hubTailCacheKey(state)
        const cached = cachedTailPage(state.tailCache, key)
        if (cached && !force) {
          set({ tailCacheKey: key, resolvedTotalPages: cached, totalPages: cached, tailResolving: false })
          return cached
        }

        const seq = ++tailResolveSeq
        set({ tailCacheKey: key, tailResolving: true })
        try {
          const params = hubSearchParams(get(), 1)
          let reported = cached || Math.max(1, Number(get().totalPages) || 1)
          if (force && cached) {
            const nextResult = await window.api.hub.search({ ...params, page: cached + 1 })
            if (seq !== tailResolveSeq || key !== hubTailCacheKey(get())) return null
            if (hubResources(nextResult).length)
              reported = Math.max(cached + 1, Number(nextResult.totalPages) || cached + 1)
          }
          const resolved = await resolveTailPage(
            params,
            reported,
            () => seq === tailResolveSeq && key === hubTailCacheKey(get()),
          )
          if (!resolved) return null
          const totalPages = resolved.page
          const tailCache = { ...get().tailCache, [key]: { totalPages, resolvedAt: Date.now() } }
          set({ tailCache, tailCacheKey: key, resolvedTotalPages: totalPages, totalPages, tailResolving: false })
          return totalPages
        } catch {
          if (seq === tailResolveSeq) set({ tailResolving: false })
          return null
        }
      },

      fetchFilters: async (force) => {
        if (!force && get().filterOptions) return
        if (!get().resources.length) set({ loading: true })
        try {
          const options = await window.api.hub.filters()
          const list = options?.sort || []
          let nextSort = get().sort
          // Only adopt/repair sort from a non-empty option list; never wipe a
          // valid persisted sort just because the list came back empty (that
          // would stall the search effect, which bails on an empty sort).
          if (list.length && (!nextSort || !list.includes(nextSort))) nextSort = list[0]
          set({ filterOptions: options, sort: nextSort })
        } catch (err) {
          console.error('Failed to fetch hub filters:', err)
        }
      },

      fetchResources: async (resetPage, opts) => {
        const seq = ++fetchSeq
        const state = get()
        let requestedPage = Math.max(1, Number(opts?.page ?? (resetPage ? 1 : state.page)) || 1)
        const append = opts?.append === true
        set({ loading: true, loadingPrevious: false, error: null, ...(append ? {} : { resources: [] }) })
        try {
          if (opts?.forceRefresh) {
            get().clearCurrentTailCache()
            await window.api.hub.invalidateCaches()
            await get().fetchFilters(true)
          }
          const key = hubTailCacheKey(get())
          const cachedTotalPages = cachedTailPage(get().tailCache, key)
          if (cachedTotalPages && requestedPage > cachedTotalPages) requestedPage = cachedTotalPages
          if (seq !== fetchSeq) return
          const q = get()
          const result = await window.api.hub.search(hubSearchParams(q, requestedPage))
          if (seq !== fetchSeq) return
          let incoming = hubResources(result)
          let totalFound = result.totalFound || 0
          let totalPages = cachedTotalPages || result.totalPages || 0
          let page = requestedPage
          if (!append && requestedPage > 1 && incoming.length === 0 && totalPages >= requestedPage) {
            const resolved = await resolveEmptyTailPage(
              hubSearchParams(q, requestedPage),
              requestedPage,
              () => seq === fetchSeq,
            )
            if (!resolved || seq !== fetchSeq) return
            incoming = hubResources(resolved.result)
            totalFound = resolved.result.totalFound || totalFound
            totalPages = incoming.length ? resolved.page : resolved.result.totalPages || 0
            page = resolved.page
            const tailCache = { ...get().tailCache, [key]: { totalPages, resolvedAt: Date.now() } }
            set({ tailCache, resolvedTotalPages: totalPages })
          }
          syncInstalledFromResources(incoming)
          const patch = {
            resources: append ? [...get().resources, ...incoming] : incoming,
            totalFound,
            totalPages,
            page,
            loading: false,
            tailCacheKey: key,
            resolvedTotalPages: cachedTotalPages || get().resolvedTotalPages,
            ...(append ? {} : { lastFetchedKey: hubFilterSignature(q) }),
          }
          if (!append && q.browseMode === 'infinite') {
            patch.startPage = page
            patch.restorePage = page
          }
          set(patch)
        } catch (err) {
          if (seq !== fetchSeq) return
          set({ error: err.message, loading: false, loadingPrevious: false, ...(append ? {} : { resources: [] }) })
        }
      },

      fetchNextPage: async () => {
        const { page, totalPages, loading, resolvedTotalPages } = get()
        if (loading) return
        if (resolvedTotalPages && page >= resolvedTotalPages) {
          const resolved = await get().resolveTailPages({ force: true })
          if (!resolved || page >= resolved) return
        } else if (page >= totalPages) {
          return
        }
        return get().fetchResources(false, { page: get().page + 1, append: true })
      },

      fetchPreviousPage: async () => {
        const state = get()
        if (state.loading || state.browseMode !== 'infinite' || state.startPage <= 1) return false
        const seq = ++fetchSeq
        const requestedPage = state.startPage - 1
        set({ loading: true, loadingPrevious: true, error: null })
        try {
          const result = await window.api.hub.search(hubSearchParams(get(), requestedPage))
          if (seq !== fetchSeq) return false
          const incoming = hubResources(result)
          syncInstalledFromResources(incoming)
          set({
            resources: [...incoming, ...get().resources],
            totalFound: result.totalFound || get().totalFound,
            totalPages: get().resolvedTotalPages || result.totalPages || get().totalPages,
            startPage: requestedPage,
            loading: false,
            loadingPrevious: false,
          })
          return incoming.length > 0
        } catch (err) {
          if (seq !== fetchSeq) return false
          set({ error: err.message, loading: false, loadingPrevious: false })
          return false
        }
      },

      /**
       * Open a package detail overlay.
       * @param opts.pushHistory  Push the current package onto `detailHistory` (dep drill).
       * @param opts.history      Replace the stack (used by popDetailHistory). Cleared when neither is set.
       */
      openDetail: async (resource, opts) => {
        const rid = String(resource.resource_id)
        const cached = detailCache.get(rid)
        set((s) => {
          let detailHistory = []
          if (opts?.history) {
            detailHistory = opts.history
          } else if (opts?.pushHistory) {
            const cur = s.detailResource
            if (cur?.resource_id != null && String(cur.resource_id) !== rid) {
              detailHistory = [
                ...s.detailHistory,
                { resource: cur, title: s.detailData?.title || cur.title || 'Package' },
              ]
            } else {
              detailHistory = s.detailHistory
            }
          }
          return {
            detailResource: resource,
            detailData: cached || null,
            detailLoading: !cached,
            followingDetailId: null,
            detailNonce: s.detailNonce + 1,
            detailHistory,
          }
        })
        if (cached) syncInstalledFromDetail(cached)
        try {
          const detail = await window.api.hub.detail(resource.resource_id)
          cacheDetail(detail)
          syncInstalledFromDetail(detail)
          // A newer open/close may have superseded this resource while we awaited.
          if (String(get().detailResource?.resource_id) !== rid) return
          set((s) => ({
            detailData: detail,
            detailLoading: false,
            resources:
              detail._installSizeBytes != null
                ? s.resources.map((r) =>
                    String(r.resource_id) === rid ? { ...r, _installSizeBytes: detail._installSizeBytes } : r,
                  )
                : s.resources,
          }))
        } catch (err) {
          if (String(get().detailResource?.resource_id) !== rid) return
          toast(`Failed to load hub detail: ${err.message}`)
          set({ detailLoading: false })
        }
      },

      /** Pop the dep-drill stack and reopen the previous package, or close if empty. */
      popDetailHistory: () => {
        const { detailHistory } = get()
        if (!detailHistory.length) {
          get().closeDetail()
          return
        }
        const prev = detailHistory[detailHistory.length - 1]
        return get().openDetail(prev.resource, { history: detailHistory.slice(0, -1) })
      },

      /** Warm the detail cache for a resource without touching visible state. */
      prefetchDetail: async (resourceId) => {
        const key = String(resourceId)
        if (detailCache.has(key)) return
        try {
          cacheDetail(await window.api.hub.detail(resourceId))
        } catch {}
      },

      /**
       * Load a different resource while keeping the currently displayed detail on
       * screen, then swap atomically once the new detail is ready (no skeleton flash).
       * Used when following in-browser navigation. Self-dedupes concurrent follows and
       * discards stale responses superseded by a newer follow or by openDetail/closeDetail.
       */
      followDetail: async (resource) => {
        const rid = String(resource.resource_id)
        if (String(get().detailData?.resource_id) === rid || get().followingDetailId === rid) return
        set({ followingDetailId: rid })
        try {
          const detail = await window.api.hub.detail(resource.resource_id)
          if (get().followingDetailId !== rid) return
          cacheDetail(detail)
          syncInstalledFromDetail(detail)
          set((s) => ({
            detailResource: resource,
            detailData: detail,
            detailLoading: false,
            followingDetailId: null,
            resources:
              detail._installSizeBytes != null
                ? s.resources.map((r) =>
                    String(r.resource_id) === rid ? { ...r, _installSizeBytes: detail._installSizeBytes } : r,
                  )
                : s.resources,
          }))
        } catch (err) {
          if (get().followingDetailId !== rid) return
          toast(`Failed to load hub detail: ${err.message}`)
          set({ followingDetailId: null })
        }
      },

      closeDetail: () => set({ detailResource: null, detailData: null, followingDetailId: null, detailHistory: [] }),

      refreshDetail: async () => {
        const { detailResource } = get()
        if (!detailResource) return
        try {
          const detail = await window.api.hub.detail(detailResource.resource_id)
          cacheDetail(detail)
          syncInstalledFromDetail(detail)
          const rid = String(detail.resource_id)
          set((s) => ({
            detailData: detail,
            resources:
              detail._installSizeBytes != null
                ? s.resources.map((r) =>
                    String(r.resource_id) === rid ? { ...r, _installSizeBytes: detail._installSizeBytes } : r,
                  )
                : s.resources,
          }))
        } catch (err) {
          toast(`Failed to refresh hub detail: ${err.message}`)
        }
      },

      resetFilters: () => {
        const sortOptions = get().filterOptions?.sort
        const nextSort = sortOptions?.[0] || ''
        set({
          ...HUB_FILTER_DEFAULTS,
          sort: nextSort,
          hideInstalled: false,
          showHidden: false,
          page: 1,
          startPage: 1,
          restorePage: 1,
        })
      },

      /** Reset the client-side wishlist filters (incl. search) to defaults. Separate from
       *  `resetFilters` (hub search) since the two modes never share filter state; `wlSort`
       *  is left as-is — reordering doesn't hide content. */
      resetWishlistFilters: () => set({ ...WISHLIST_FILTER_DEFAULTS }),

      // Jump to a Hub search scoped to one author. Only sets the author and
      // switches to hub mode — the other hub filters are left as-is (the wishlist
      // filters that were narrowing the view are deliberately NOT mirrored, since
      // the models aren't 1:1 and the intent is to broaden to the creator). The
      // authorSearch change drives HubView's fetch effect.
      searchHubForAuthor: (author) => {
        if (!author) return
        set({ authorSearch: author, page: 1, galleryMode: 'hub' })
      },
    }),
    persistViewState('hub-view', HUB_PERSISTED_STATE),
  ),
)
