import { useState, useEffect, useCallback, useRef, useMemo, Activity } from 'react'
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Grid2x2,
  Grid3x3,
  Infinity as InfinityIcon,
  Loader2,
  RefreshCw,
  Pin,
} from 'lucide-react'
import { dismissTransientOverlays } from '@/lib/dismissOverlays'
import { CONTENT_TYPES, compareContentTypes, getTypeColor } from '@/lib/utils'
import {
  useHubStore,
  hubFilterSignature,
  HUB_FILTER_DEFAULTS,
  HUB_PER_PAGE_OPTIONS,
  WISHLIST_FILTER_DEFAULTS,
} from '@/stores/useHubStore'
import { useWishlistStore } from '@/stores/useWishlistStore'
import { useHubHiddenStore } from '@/stores/useHubHiddenStore'
import { useDownloadStore } from '@/stores/useDownloadStore'
import { useInstalledStore } from '@/stores/useInstalledStore'
import { HubCard } from '@/components/PackageCard'
import HubDetail from '@/components/HubDetail'
import FilterPanel, { sectionActive } from '@/components/FilterPanel'
import { LICENSE_FILTER_OPTIONS, getHubResourceLicense } from '@/lib/licenses'
import { matchesSmartQuery, parseSmartQuery } from '@/lib/smart-search'
import { wishlistSearchExtras } from '@/lib/search-text'
import { matchesPolarityList, matchesAuthorFilter, matchesLicenseFilter } from '@/lib/filter-match'
import { SearchOnHubButton } from '@/components/SearchOnHubButton'
import { ThumbnailSizeSlider } from '@/components/ThumbnailSizeSlider'
import { VirtualGrid } from '@/components/VirtualGrid'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useViewStore } from '@/stores/useViewStore'
import { useMousePageNavigation } from '@/hooks/useMousePageNavigation'
import { scrollMousePage, shouldIgnoreMousePageTarget } from '@/lib/mouse-page-nav'

/** Hub text search: avoid a network request on every keystroke */
const HUB_SEARCH_DEBOUNCE_MS = 320
/**
 * Medium HubCard footer height below the square thumb. Unlike LibraryCard, HubCard adds a
 * full-width action button row, so it's taller: author+stats block (~68px) + button row
 * (pt-2 8 + gradient button 32 + pb-3 12 = ~52px) ≈ 120px.
 */
const HUB_CARD_FOOTER_PX = 120

export function hubPageForVisibleResourceIndex(index, perPage, startPage = 1) {
  return Number.isInteger(index) ? startPage + Math.floor(index / Math.max(1, perPage)) : startPage
}

export function hubPageCountLabel(maxPage) {
  return Math.max(1, Number(maxPage) || 1).toLocaleString()
}

export function shouldRenderHubPageNav(browseMode, maxPage, showInfinitePagerControls = true) {
  return maxPage > 1 && (browseMode === 'paged' || showInfinitePagerControls)
}

export function shouldRenderHubPageSummary(browseMode, showInfinitePagerControls = true) {
  return browseMode === 'paged' || showInfinitePagerControls
}

/**
 * Local sort options for the wishlist gallery. Unlike the hub sort list (which
 * comes from the server and includes server-only notions like relevance), these
 * all map to fields present in the stored snapshot, so sorting is client-side.
 * `added` (default) reproduces the original fixed created_at DESC order.
 *
 * Deliberately NO "recently updated": `last_update` is frozen in the snapshot at
 * add / last-detail-open time, so a package updated afterward would sort as if it
 * never changed — the one field whose staleness corrupts the sort's own premise.
 * Downloads/rating/likes are also snapshot-stale, but only in magnitude (accepted
 * staleness policy) — relative order stays broadly right, so they're kept.
 */
const WISHLIST_SORTS = [
  { value: 'added', label: 'Recently added' },
  { value: 'author', label: 'Author (A–Z)' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'downloads', label: 'Downloads' },
  { value: 'rating', label: 'Rating' },
  { value: 'likes', label: 'Reaction Score' },
]

const wlNum = (v) => parseInt(v || '0', 10) || 0
/** Tiebreaker: most recently wishlisted first (matches the default order). */
const wlByAdded = (a, b) => (b._wishlistedAt || 0) - (a._wishlistedAt || 0)
const WISHLIST_SORT_FNS = {
  added: wlByAdded,
  downloads: (a, b) => wlNum(b.download_count) - wlNum(a.download_count) || wlByAdded(a, b),
  rating: (a, b) => (parseFloat(b.rating_avg) || 0) - (parseFloat(a.rating_avg) || 0) || wlByAdded(a, b),
  likes: (a, b) => wlNum(b.reaction_score) - wlNum(a.reaction_score) || wlByAdded(a, b),
  name: (a, b) => String(a.title || '').localeCompare(String(b.title || '')) || wlByAdded(a, b),
  author: (a, b) => String(a.username || '').localeCompare(String(b.username || '')) || wlByAdded(a, b),
}

/**
 * Tags on the stored snapshot mirror the hub detail `tags` field: a single
 * comma-separated string (same shape the library persists to `hub_tags`). Parse
 * to a lowercased list, matching the library's `packageMatchesSelectedTags`.
 */
function parseSnapshotTags(r) {
  if (!r.tags) return []
  return String(r.tags)
    .toLowerCase()
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

/** All wishlist filter dimensions, in a fixed key order for facet cross-filtering. */
const WISHLIST_FILTER_KEYS = ['search', 'type', 'tags', 'paid', 'author', 'license']

/**
 * Build one predicate per filter dimension bound to the current filter state.
 * Keeping them separate lets the gallery AND each facet reuse the same logic:
 * the gallery ANDs them all, while a facet's counts AND every dimension *except*
 * its own (standard cross-filtered faceting).
 */
function wishlistPredicates({ search, type, tags, paid, author, excludedAuthors, license }) {
  const { tokens } = parseSmartQuery(search)
  const tagItems = tags || []
  const excluded = excludedAuthors || []
  return {
    search: (r) =>
      !tokens.length ||
      matchesSmartQuery(tokens, {
        text: () => [r.title, r.username, r.tag_line, ...wishlistSearchExtras(r)],
        author: () => r.username || '',
        tags: () => parseSnapshotTags(r),
        labels: () => [],
      }),
    type: (r) => type === 'All' || r.type === type,
    tags: (r) => matchesPolarityList(tagItems, parseSnapshotTags(r), { normalize: true }),
    paid: (r) => paid === 'all' || (paid === 'free' ? r.category === 'Free' : r.category === 'Paid'),
    author: (r) => matchesAuthorFilter(r.username, author, excluded),
    license: (r) => matchesLicenseFilter(getHubResourceLicense(r), license),
  }
}

/** Items passing every filter dimension except `exclude` — the input set for that facet's counts. */
function wishlistItemsExcept(items, preds, exclude) {
  const keys = WISHLIST_FILTER_KEYS.filter((k) => k !== exclude)
  return items.filter((r) => keys.every((k) => preds[k](r)))
}

/** Apply the full wishlist filter/sort state to the raw snapshot list. */
function filterAndSortWishlist(items, state) {
  const preds = wishlistPredicates(state)
  // `.filter` always returns a fresh array, so sorting never mutates the store's.
  const result = items.filter((r) => WISHLIST_FILTER_KEYS.every((k) => preds[k](r)))
  return result.sort(WISHLIST_SORT_FNS[state.sort] || WISHLIST_SORT_FNS.added)
}

export default function HubView({ onNavigate }) {
  const hubActive = useViewStore((state) => state.view === 'hub')
  const {
    resources,
    totalFound,
    totalPages,
    page,
    startPage,
    restorePage,
    perPage,
    browseMode,
    showInfinitePagerControls,
    trackInfiniteRestorePage,
    loadingPrevious,
    tailResolving,
    resolvedTotalPages,
    loading,
    error,
    search,
    selectedType,
    paidFilter,
    authorSearch,
    selectedHubTags,
    sort,
    license,
    hideInstalled,
    showHidden,
    wlSearch,
    wlType,
    wlTags,
    wlPaid,
    wlAuthor,
    wlExcludedAuthors,
    wlLicense,
    wlSort,
    detailResource,
    detailData,
    detailNonce,
    detailHistory,
    cardMode,
    cardWidth,
    galleryMode,
    setGalleryMode,
    filterOptions,
    setSearch,
    setSelectedType,
    setPaidFilter,
    setAuthorSearch,
    setSelectedHubTags,
    setSort,
    setLicense,
    setHideInstalled,
    setShowHidden,
    setWlSearch,
    setWlType,
    setWlTags,
    setWlPaid,
    setWlAuthor,
    setWlExcludedAuthors,
    setWlLicense,
    setWlSort,
    resetFilters,
    resetWishlistFilters,
    setCardMode,
    setCardWidth,
    setBrowseMode,
    setPerPage,
    setInfiniteRestorePage,
    fetchResources,
    fetchNextPage,
    fetchPreviousPage,
    goToPage,
    startInfiniteAtPage,
    resolveTailPages,
    openDetail,
    closeDetail,
    popDetailHistory,
  } = useHubStore()

  const wishlistMode = galleryMode === 'wishlist'
  const galleryRef = useRef(null)
  const [startPageDraft, setStartPageDraft] = useState(String(restorePage))
  useEffect(() => setStartPageDraft(String(restorePage)), [restorePage])
  const detailBackLabel = detailHistory.length > 0 ? detailHistory[detailHistory.length - 1].title : null

  const [searchDraft, setSearchDraft] = useState(search)
  const searchDraftRef = useRef(search)
  const searchDebounceRef = useRef(null)
  useEffect(() => {
    setSearchDraft(search)
    searchDraftRef.current = search
  }, [search])
  useEffect(
    () => () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    },
    [],
  )
  const handleSearchChange = useCallback(
    (value) => {
      setSearchDraft(value)
      searchDraftRef.current = value
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
        searchDebounceRef.current = null
      }
      const trimmed = value.trim()
      if (trimmed === '') {
        setSearch('')
        return
      }
      searchDebounceRef.current = setTimeout(() => {
        searchDebounceRef.current = null
        // Ignore stale timers (clear clicked after timeout fired, or newer keystrokes).
        if (searchDraftRef.current !== value) return
        setSearch(trimmed)
      }, HUB_SEARCH_DEBOUNCE_MS)
    },
    [setSearch],
  )

  const sortOptions = useMemo(() => filterOptions?.sort || [], [filterOptions])
  const hubTypes = (filterOptions?.type || CONTENT_TYPES).toSorted(compareContentTypes)

  /** getInfo `tags` / `users`: map → numeric counts for autocomplete (ordered by ct in the UI) */
  const tagSuggestions = useMemo(() => {
    const raw = filterOptions?.tags
    if (!raw || typeof raw !== 'object') return {}
    const out = {}
    for (const [k, v] of Object.entries(raw)) {
      out[k] = Number(v?.ct ?? 0)
    }
    return out
  }, [filterOptions])
  const userSuggestions = useMemo(() => {
    const raw = filterOptions?.users
    if (!raw || typeof raw !== 'object') return {}
    const out = {}
    for (const [k, v] of Object.entries(raw)) {
      out[k] = Number(v?.ct ?? 0)
    }
    return out
  }, [filterOptions])

  useEffect(() => {
    useHubStore.getState().fetchFilters()
    useHubHiddenStore.getState().hydrate()
  }, [])

  // Wishlist: id set drives the segmented-control count + detail toggle state
  // (loaded once on mount); the full list is loaded lazily on entering the mode.
  const wishlistItems = useWishlistStore((s) => s.items)
  const wishlistCount = useWishlistStore((s) => s.ids.size)
  const wishlistLoading = useWishlistStore((s) => s.loading)
  const wishlistLoaded = useWishlistStore((s) => s.loaded)
  useEffect(() => {
    useWishlistStore.getState().loadIds()
  }, [])
  useEffect(() => {
    if (wishlistMode) useWishlistStore.getState().load()
  }, [wishlistMode])
  // Main fires `wishlist:updated` for background snapshot changes and peer
  // pin/unpin. Keep the old local behavior for bare events; only peer membership
  // invalidations refresh ids when the full wishlist has never been loaded.
  useEffect(() => {
    return window.api.onWishlistUpdated((data) => {
      const s = useWishlistStore.getState()
      if (s.loaded) s.load()
      else if (data?.membership) s.loadIds()
    })
  }, [])

  const [availableWidth, setAvailableWidth] = useState(0)
  const [gridCols, setGridCols] = useState(1)
  const handleGridLayout = useCallback(({ availableWidth: w, cols }) => {
    setAvailableWidth(w)
    setGridCols(cols)
  }, [])

  const hiddenHubIds = useHubHiddenStore((state) => state.ids)
  const installedByHubResourceId = useInstalledStore((state) => state.byHubResourceId)
  const filteredHubResources = useMemo(
    () =>
      resources.filter((resource) => {
        const rid = String(resource.resource_id)
        if (!showHidden && hiddenHubIds.has(rid)) return false
        if (hideInstalled && (installedByHubResourceId.get(rid)?.installed ?? resource._installed)) return false
        return true
      }),
    [resources, showHidden, hiddenHubIds, hideInstalled, installedByHubResourceId],
  )

  // Wishlist filtering/sorting is client-side over the locally stored snapshots.
  const wishlistFiltered = useMemo(
    () =>
      filterAndSortWishlist(wishlistItems, {
        search: wlSearch,
        type: wlType,
        tags: wlTags,
        paid: wlPaid,
        author: wlAuthor,
        excludedAuthors: wlExcludedAuthors,
        license: wlLicense,
        sort: wlSort,
      }),
    [wishlistItems, wlSearch, wlType, wlTags, wlPaid, wlAuthor, wlExcludedAuthors, wlLicense, wlSort],
  )

  // While more hub pages exist, hide the trailing partial row so the gallery bottom is always
  // full rows — the ragged remainder fills in once the next chunk loads. `gridCols` comes from
  // VirtualGrid's onLayout (its actual column count), so the trim tracks resize/slider changes.
  const visibleResources = useMemo(() => {
    if (browseMode === 'paged' || page >= totalPages) return filteredHubResources
    const fullRowCount = Math.floor(filteredHubResources.length / gridCols) * gridCols
    if (fullRowCount === 0) return filteredHubResources
    return filteredHubResources.slice(0, fullRowCount)
  }, [filteredHubResources, page, totalPages, gridCols, browseMode])

  // Per-mode scroll reset keys: each grid resets only on a filter change within its
  // own mode, so toggling Hub<->Wishlist keeps both scroll positions. The hub key
  // reuses the fetch-guard signature so "filters changed" means the same thing for
  // scroll reset and refetch.
  const hubScrollResetKey = useMemo(
    () =>
      hubFilterSignature({ search, selectedType, paidFilter, authorSearch, selectedHubTags, sort, license, perPage }),
    [search, selectedType, paidFilter, authorSearch, selectedHubTags, sort, license, perPage],
  )
  const wlScrollResetKey = useMemo(
    () =>
      `${wlSearch}\0${wlType}\0${wlTags.map((t) => `${typeof t === 'object' ? t.value : t}:${t?.negate ? 1 : 0}`).join(',')}\0${wlPaid}\0${wlAuthor}\0${wlExcludedAuthors.join(',')}\0${wlLicense}\0${wlSort}`,
    [wlSearch, wlType, wlTags, wlPaid, wlAuthor, wlExcludedAuthors, wlLicense, wlSort],
  )

  const hubShowSkeleton = resources.length === 0 && (loading || !sort)

  const compactCards = cardMode === 'minimal'

  // Filter changes → reset to page 1 and fetch. Freshness-guarded so an <Activity>
  // reveal with unchanged filters is a no-op (doesn't wipe loaded pages).
  useEffect(() => {
    if (!sort) return // wait for sort options to load
    const s = useHubStore.getState()
    if (hubFilterSignature(s) === s.lastFetchedKey) return
    const initialPage = s.lastFetchedKey == null ? (s.browseMode === 'infinite' ? s.restorePage : s.page) : 1
    s.fetchResources(true, { page: initialPage })
  }, [search, selectedType, paidFilter, authorSearch, selectedHubTags, sort, license, perPage])

  useEffect(() => {
    if (wishlistMode || loading || !totalPages) return
    void resolveTailPages()
  }, [wishlistMode, loading, totalPages, resolveTailPages])

  // When packages change (promote, download completes, uninstall), resync install status from DB.
  // The hub detail panel is refreshed at App level; here we only patch the
  // gallery's resource objects + the global installed-state store.
  useEffect(() => {
    return window.api.onPackagesUpdated(async () => {
      // Re-list the wishlist so its cards' installed/dep badges reconcile too
      // (wishlist items aren't part of hub `resources`, so the block below misses them).
      if (useWishlistStore.getState().loaded) useWishlistStore.getState().load()

      const { resources } = useHubStore.getState()
      if (resources.length === 0) return

      const ids = resources.map((r) => r.resource_id)
      let snapshot = {}
      try {
        snapshot = await window.api.hub.localSnapshot(ids)
      } catch {
        return
      }

      // Canonical update — this is what all components read from
      useInstalledStore.getState().applyBatch(
        ids.map((id) => {
          const local = snapshot[String(id)]
          return local
            ? { hubResourceId: id, installed: true, isDirect: local.is_direct, filename: local.filename }
            : { hubResourceId: id, installed: false, isDirect: false, filename: null }
        }),
      )

      // Also patch resource objects for backward compat (dep size calc, etc.)
      let changed = false
      const updated = resources.map((r) => {
        const id = String(r.resource_id)
        const local = snapshot[id]
        let next = r
        if (local) {
          next = { ...r, _installed: true, _isDirect: local.is_direct, _localFilename: local.filename }
        } else if (r._installed || r._localFilename != null) {
          next = { ...r, _installed: false, _isDirect: false, _localFilename: undefined }
        }
        if (
          next._installed !== r._installed ||
          next._isDirect !== r._isDirect ||
          next._localFilename !== r._localFilename
        ) {
          changed = true
        }
        return next
      })
      if (changed) useHubStore.setState({ resources: updated })
    })
  }, [])

  const dlInstall = useDownloadStore((s) => s.install)

  const handleInstall = useCallback(
    (resource, hubDetail) => {
      dlInstall(resource.resource_id, hubDetail).catch(() => {})
    },
    [dlInstall],
  )

  const handleViewInLibrary = useCallback(
    (resource) => {
      onNavigate('library', { selectPackage: resource._localFilename })
    },
    [onNavigate],
  )

  const handleFilterAuthor = useCallback(
    (author) => {
      // Filter within the current mode: in wishlist mode this drives the local
      // wishlist author filter, in hub mode the hub search. The gallery mode can't
      // change while a detail overlay is open (the toggle sits behind it), so
      // reading it live also correctly reflects where the detail was opened from.
      if (useHubStore.getState().galleryMode === 'wishlist') setWlAuthor(author)
      else setAuthorSearch(author)
    },
    [setAuthorSearch, setWlAuthor],
  )

  const handlePromote = useCallback((filename, hubResourceId) => {
    window.api.packages.promote(filename, hubResourceId)
    const rid = String(hubResourceId)
    useInstalledStore.getState().update(rid, true, true, filename)
    useHubStore.setState((s) => ({
      resources: s.resources.map((r) => (String(r.resource_id) === rid ? { ...r, _isDirect: true } : r)),
      detailData:
        s.detailData && String(s.detailData.resource_id) === rid ? { ...s.detailData, _isDirect: true } : s.detailData,
    }))
  }, [])

  // --- Prev/Next navigation through the current gallery list ---
  // The currently shown package: detailData once loaded, else the opening stub.
  // The list stepped through is the filtered wishlist in wishlist mode, else hub
  // search. A ref mirrors the filtered list so the pager callbacks (which read
  // fresh state to dodge stale closures) can step through exactly what's shown.
  const detailList = wishlistMode ? wishlistFiltered : resources
  const wishlistViewRef = useRef(wishlistFiltered)
  wishlistViewRef.current = wishlistFiltered
  const currentDetailId = detailResource ? String(detailData?.resource_id ?? detailResource.resource_id ?? '') : ''
  const detailIdx = currentDetailId ? detailList.findIndex((r) => String(r.resource_id) === currentDetailId) : -1
  const canPrevDetail = detailIdx > 0
  const canNextDetail = wishlistMode
    ? detailIdx >= 0 && detailIdx < detailList.length - 1
    : detailIdx >= 0 && (detailIdx < resources.length - 1 || (page < totalPages && !loading))
  // null → pager hidden (neighbor unknown, or dep-drill history is active)
  const detailPosition =
    detailBackLabel || detailIdx < 0
      ? null
      : { n: detailIdx + 1, total: wishlistMode ? detailList.length : totalFound || resources.length }

  const handleDetailPrev = useCallback(() => {
    const { galleryMode, resources, detailResource, detailData } = useHubStore.getState()
    const list = galleryMode === 'wishlist' ? wishlistViewRef.current : resources
    const cur = detailResource ? String(detailData?.resource_id ?? detailResource.resource_id ?? '') : ''
    const idx = cur ? list.findIndex((r) => String(r.resource_id) === cur) : -1
    if (idx > 0) openDetail(list[idx - 1])
  }, [openDetail])

  // Enabled after the first Next within a panel-open session; gates neighbor detail
  // prefetch so users who never step through don't pay extra `hub:detail` requests.
  const detailPrefetchRef = useRef(false)
  useEffect(() => {
    if (!detailResource) detailPrefetchRef.current = false
  }, [detailResource])

  // When Next is pressed on the last loaded item, remember which item we advanced
  // from and load the next page; the effect below jumps once that page arrives.
  const pendingNextFromRef = useRef(null)
  const handleDetailNext = useCallback(() => {
    detailPrefetchRef.current = true
    const { galleryMode, resources, detailResource, detailData, page, totalPages } = useHubStore.getState()
    const cur = detailResource ? String(detailData?.resource_id ?? detailResource.resource_id ?? '') : ''
    if (galleryMode === 'wishlist') {
      const list = wishlistViewRef.current
      const idx = cur ? list.findIndex((r) => String(r.resource_id) === cur) : -1
      if (idx >= 0 && idx < list.length - 1) openDetail(list[idx + 1])
      return
    }
    const idx = cur ? resources.findIndex((r) => String(r.resource_id) === cur) : -1
    if (idx < 0) return
    if (idx < resources.length - 1) {
      openDetail(resources[idx + 1])
    } else if (page < totalPages) {
      pendingNextFromRef.current = cur
      fetchNextPage()
    }
  }, [openDetail, fetchNextPage])

  useEffect(() => {
    const fromId = pendingNextFromRef.current
    if (!fromId) return
    const idx = resources.findIndex((r) => String(r.resource_id) === fromId)
    if (idx >= 0 && idx < resources.length - 1) {
      pendingNextFromRef.current = null
      openDetail(resources[idx + 1])
    }
  }, [resources, openDetail])

  // Proactively load the next search page when the shown item nears the end of the
  // loaded list, so Next is rarely a dead wait.
  useEffect(() => {
    if (wishlistMode || detailIdx < 0 || loading) return
    if (detailIdx >= resources.length - 2 && page < totalPages) fetchNextPage()
  }, [wishlistMode, detailIdx, resources.length, page, totalPages, loading, fetchNextPage])

  // Once stepping through, warm the next item's detail into the main-process LRU
  // cache so the upcoming Next resolves without a network round-trip. The previous
  // item is already cached from having been viewed.
  useEffect(() => {
    if (wishlistMode || !detailPrefetchRef.current || detailIdx < 0) return
    const next = resources[detailIdx + 1]
    if (next?.resource_id) useHubStore.getState().prefetchDetail(next.resource_id)
  }, [wishlistMode, detailIdx, resources])

  const sections = useMemo(
    () => [
      {
        key: 'type',
        label: 'Type',
        type: 'list',
        value: selectedType,
        default: HUB_FILTER_DEFAULTS.selectedType,
        onChange: setSelectedType,
        items: [
          { value: 'All', label: 'All' },
          ...hubTypes.map((t) => ({ value: t, label: t, color: getTypeColor(t) })),
        ],
      },
      {
        key: 'paid',
        label: 'Pricing',
        type: 'list',
        value: paidFilter,
        default: HUB_FILTER_DEFAULTS.paidFilter,
        onChange: setPaidFilter,
        items: [
          { value: 'all', label: 'All' },
          { value: 'free', label: 'Free' },
          { value: 'paid', label: 'Paid' },
        ],
      },
      {
        key: 'show',
        label: 'Show',
        type: 'switches',
        active: hideInstalled || showHidden,
        items: [
          {
            key: 'installed',
            label: 'Installed',
            checked: !hideInstalled,
            onCheckedChange: (checked) => setHideInstalled(!checked),
          },
          { key: 'hidden', label: 'Hidden', checked: showHidden, onCheckedChange: setShowHidden },
        ],
      },
      {
        key: 'tags',
        label: 'Tags',
        type: 'tags-autocomplete',
        value: selectedHubTags,
        default: HUB_FILTER_DEFAULTS.selectedHubTags,
        onChange: setSelectedHubTags,
        suggestions: tagSuggestions,
        placeholder: 'Filter by tags…',
      },
      {
        key: 'author',
        label: 'Author',
        type: 'text-autocomplete',
        value: authorSearch,
        default: HUB_FILTER_DEFAULTS.authorSearch,
        onChange: setAuthorSearch,
        suggestions: userSuggestions,
        placeholder: 'Filter by author…',
      },
      {
        key: 'license',
        label: 'License',
        type: 'select',
        value: license,
        default: HUB_FILTER_DEFAULTS.license,
        onChange: setLicense,
        options: LICENSE_FILTER_OPTIONS,
      },
      { key: 'sort', label: 'Sort by', type: 'select', value: sort, onChange: setSort, options: sortOptions },
    ],
    [
      selectedType,
      paidFilter,
      hideInstalled,
      showHidden,
      selectedHubTags,
      authorSearch,
      license,
      sort,
      sortOptions,
      hubTypes,
      tagSuggestions,
      userSuggestions,
      setSelectedType,
      setPaidFilter,
      setHideInstalled,
      setShowHidden,
      setSelectedHubTags,
      setAuthorSearch,
      setLicense,
      setSort,
    ],
  )

  // Wishlist facets. The displayed counts are proper cross-filtered facets: each
  // dimension counts items matching all the OTHER active filters, so they update
  // as filters toggle (standard filter-panel behaviour).
  const wishlistFacets = useMemo(() => {
    const preds = wishlistPredicates({
      search: wlSearch,
      type: wlType,
      tags: wlTags,
      paid: wlPaid,
      author: wlAuthor,
      excludedAuthors: wlExcludedAuthors,
      license: wlLicense,
    })
    const bucket = (items, fn) => {
      const m = new Map()
      for (const r of items) fn(r, m)
      return m
    }
    const addType = (r, m) => r.type && m.set(r.type, (m.get(r.type) || 0) + 1)
    const typeFacet = bucket(wishlistItemsExcept(wishlistItems, preds, 'type'), addType)

    const tagCounts = {}
    for (const r of wishlistItemsExcept(wishlistItems, preds, 'tags'))
      for (const t of parseSnapshotTags(r)) tagCounts[t] = (tagCounts[t] || 0) + 1

    const authorCounts = {}
    for (const r of wishlistItemsExcept(wishlistItems, preds, 'author'))
      if (r.username) authorCounts[r.username] = (authorCounts[r.username] || 0) + 1

    let free = 0
    let paid = 0
    for (const r of wishlistItemsExcept(wishlistItems, preds, 'paid')) {
      if (r.category === 'Free') free++
      else if (r.category === 'Paid') paid++
    }

    // Type list mirrors the hub shape: the fixed core categories always come
    // first in canonical order, then extra hub types fall into the "N more"
    // spoiler. That tail's membership + order use OVERALL counts (across the
    // whole wishlist, not the facet) so it stays put as filters toggle; only the
    // number shown on each row is the live facet count. With All + the core
    // categories filling the collapse threshold, the tail hides by default like
    // the hub sidebar.
    const coreSet = new Set(CONTENT_TYPES)
    const typeOverall = bucket(wishlistItems, addType)
    const typeItems = [
      { value: 'All', label: 'All' },
      ...CONTENT_TYPES.map((t) => ({ value: t, label: t, color: getTypeColor(t), count: typeFacet.get(t) || 0 })),
      ...[...typeOverall.entries()]
        .filter(([t]) => !coreSet.has(t))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([t]) => ({ value: t, label: t, color: getTypeColor(t), count: typeFacet.get(t) || 0 })),
    ]
    const paidItems = [
      { value: 'all', label: 'All' },
      { value: 'free', label: 'Free', count: free },
      { value: 'paid', label: 'Paid', count: paid },
    ]
    return { typeItems, paidItems, authorCounts, tagCounts }
  }, [wishlistItems, wlSearch, wlType, wlTags, wlPaid, wlAuthor, wlExcludedAuthors, wlLicense])

  const wishlistSections = useMemo(
    () => [
      {
        key: 'wl-type',
        label: 'Type',
        type: 'list',
        value: wlType,
        default: WISHLIST_FILTER_DEFAULTS.wlType,
        onChange: setWlType,
        items: wishlistFacets.typeItems,
      },
      {
        key: 'wl-paid',
        label: 'Pricing',
        type: 'list',
        value: wlPaid,
        default: WISHLIST_FILTER_DEFAULTS.wlPaid,
        onChange: setWlPaid,
        items: wishlistFacets.paidItems,
      },
      {
        key: 'wl-tags',
        label: 'Tags',
        type: 'tags-autocomplete',
        value: wlTags,
        default: WISHLIST_FILTER_DEFAULTS.wlTags,
        onChange: setWlTags,
        suggestions: wishlistFacets.tagCounts,
        placeholder: 'Filter by tags…',
        allowNegate: true,
      },
      {
        key: 'wl-author',
        label: 'Author',
        type: 'text-autocomplete',
        value: wlAuthor,
        default: WISHLIST_FILTER_DEFAULTS.wlAuthor,
        onChange: setWlAuthor,
        excluded: wlExcludedAuthors,
        onExcludedChange: setWlExcludedAuthors,
        suggestions: wishlistFacets.authorCounts,
        placeholder: 'Filter by author…',
        titleAction: wlAuthor ? <SearchOnHubButton author={wlAuthor} /> : null,
      },
      {
        key: 'wl-license',
        label: 'License',
        type: 'select',
        value: wlLicense,
        default: WISHLIST_FILTER_DEFAULTS.wlLicense,
        onChange: setWlLicense,
        options: LICENSE_FILTER_OPTIONS,
      },
      { key: 'wl-sort', label: 'Sort by', type: 'select', value: wlSort, onChange: setWlSort, options: WISHLIST_SORTS },
    ],
    [
      wlType,
      wlTags,
      wlPaid,
      wlAuthor,
      wlExcludedAuthors,
      wlLicense,
      wlSort,
      wishlistFacets,
      setWlType,
      setWlTags,
      setWlPaid,
      setWlAuthor,
      setWlExcludedAuthors,
      setWlLicense,
      setWlSort,
    ],
  )

  const maxHubPage = Math.max(resolvedTotalPages || totalPages || 1, 1)
  const pageCountLabel = hubPageCountLabel(maxHubPage)
  const pageButtons = useMemo(() => {
    if (maxHubPage <= 7) return Array.from({ length: maxHubPage }, (_, i) => i + 1)
    const pages = new Set([1, maxHubPage, page - 1, page, page + 1])
    if (page <= 4) for (let p = 2; p <= 5; p += 1) pages.add(p)
    if (page >= maxHubPage - 3) for (let p = maxHubPage - 4; p < maxHubPage; p += 1) pages.add(p)
    const sorted = [...pages].filter((p) => p >= 1 && p <= maxHubPage).sort((a, b) => a - b)
    return sorted.flatMap((p, i) => (i && p - sorted[i - 1] > 1 ? ['...', p] : [p]))
  }, [maxHubPage, page])

  const topVisiblePage = useCallback(() => {
    const root = galleryRef.current
    if (!root) return restorePage
    const rootTop = root.getBoundingClientRect().top
    for (const card of root.querySelectorAll('[data-hub-resource-id]')) {
      if (card.getBoundingClientRect().bottom <= rootTop + 8) continue
      const index = resources.findIndex((r) => String(r.resource_id) === card.dataset.hubResourceId)
      return hubPageForVisibleResourceIndex(index, perPage, startPage)
    }
    return restorePage
  }, [perPage, resources, restorePage, startPage])

  useEffect(() => {
    const root = galleryRef.current
    if (!root || wishlistMode || browseMode !== 'infinite' || !trackInfiniteRestorePage) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setInfiniteRestorePage(topVisiblePage()))
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      root.removeEventListener('scroll', onScroll)
    }
  }, [browseMode, setInfiniteRestorePage, topVisiblePage, trackInfiniteRestorePage, wishlistMode])

  const goPagedPage = useCallback(
    (nextPage) => {
      galleryRef.current?.scrollTo({ top: 0 })
      void goToPage(nextPage)
    },
    [goToPage],
  )
  const goInfiniteStartPage = useCallback(
    (nextPage) => {
      galleryRef.current?.scrollTo({ top: 0 })
      void startInfiniteAtPage(nextPage)
    },
    [startInfiniteAtPage],
  )
  const toggleBrowseMode = useCallback(() => {
    if (browseMode === 'infinite') {
      const target = topVisiblePage()
      setBrowseMode('paged')
      goPagedPage(target)
    } else {
      setBrowseMode('infinite')
      goInfiniteStartPage(page)
    }
  }, [browseMode, goInfiniteStartPage, goPagedPage, page, setBrowseMode, topVisiblePage])

  const captureScrollAnchor = useCallback(() => {
    const root = galleryRef.current
    if (!root) return null
    const rootTop = root.getBoundingClientRect().top
    for (const card of root.querySelectorAll('[data-hub-resource-id]')) {
      const rect = card.getBoundingClientRect()
      if (rect.bottom > rootTop + 8) return { id: card.dataset.hubResourceId, top: rect.top }
    }
    return null
  }, [])
  const fetchPreviousHubPage = useCallback(async () => {
    const anchor = captureScrollAnchor()
    if (!(await fetchPreviousPage()) || !anchor) return
    requestAnimationFrame(() => {
      const root = galleryRef.current
      const card = [...(root?.querySelectorAll('[data-hub-resource-id]') || [])].find(
        (node) => node.dataset.hubResourceId === anchor.id,
      )
      if (root && card) root.scrollTop += card.getBoundingClientRect().top - anchor.top
    })
  }, [captureScrollAnchor, fetchPreviousPage])
  const handleGalleryWheel = useCallback(
    (event) => {
      if (wishlistMode || browseMode !== 'infinite' || loading || startPage <= 1 || event.deltaY >= 0) return
      if ((galleryRef.current?.scrollTop || 0) <= 8) void fetchPreviousHubPage()
    },
    [browseMode, fetchPreviousHubPage, loading, startPage, wishlistMode],
  )

  const currentPage = browseMode === 'infinite' ? restorePage : page
  const canRecheckTail = !!resolvedTotalPages && !tailResolving
  const goCurrentModePage = browseMode === 'infinite' ? goInfiniteStartPage : goPagedPage
  const handlePageDirection = useCallback(
    (direction, target, root) => {
      if (detailResource) {
        if (direction < 0) popDetailHistory()
        return
      }
      if (target && shouldIgnoreMousePageTarget(target)) return
      if (wishlistMode) {
        scrollMousePage(target || root, root, direction)
        return
      }
      if (loading || (direction < 0 && currentPage <= 1)) return
      if (direction > 0 && currentPage >= maxHubPage && !canRecheckTail) return
      goCurrentModePage(currentPage + direction)
    },
    [
      canRecheckTail,
      currentPage,
      detailResource,
      goCurrentModePage,
      loading,
      maxHubPage,
      popDetailHistory,
      wishlistMode,
    ],
  )
  const { rootRef: pageNavRootRef, onMouseUpCapture: handleMousePageButton } = useMousePageNavigation({
    active: hubActive,
    onDirection: handlePageDirection,
  })
  const rangePage = browseMode === 'infinite' ? startPage : page
  const pageStart = resources.length ? (rangePage - 1) * perPage + 1 : 0
  const pageEnd = resources.length ? Math.min(pageStart + resources.length - 1, totalFound) : 0
  const pageRange = resources.length
    ? `Showing ${pageStart.toLocaleString()}-${pageEnd.toLocaleString()} of ${totalFound.toLocaleString()}`
    : `Showing 0 of ${totalFound.toLocaleString()}`

  const renderPageNav = () => {
    if (wishlistMode || !shouldRenderHubPageNav(browseMode, maxHubPage, showInfinitePagerControls)) return null
    const iconClass =
      'h-8 w-8 rounded flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-elevated disabled:opacity-30 cursor-pointer disabled:cursor-default'
    const numbered = browseMode === 'paged'
    return (
      <div className="flex min-w-0 max-w-full items-center justify-center gap-1">
        <button
          type="button"
          disabled={loading || currentPage <= 1}
          onClick={() => goCurrentModePage(1)}
          title="First Hub page"
          className={iconClass}
        >
          <ChevronsLeft size={17} />
        </button>
        <button
          type="button"
          disabled={loading || currentPage <= 1}
          onClick={() => goCurrentModePage(currentPage - 1)}
          title="Previous Hub page"
          className={iconClass}
        >
          <ChevronLeft size={18} />
        </button>
        {numbered ? (
          pageButtons.map((item, index) =>
            item === '...' ? (
              <span key={`ellipsis-${index}`} className="px-1 text-text-tertiary">
                ...
              </span>
            ) : (
              <button
                key={item}
                type="button"
                disabled={loading || item === page}
                onClick={() => goPagedPage(item)}
                aria-current={item === page ? 'page' : undefined}
                className={`h-8 min-w-8 rounded px-2 text-xs tabular-nums ${item === page ? 'bg-hover text-text-primary font-medium' : 'text-text-tertiary hover:bg-elevated hover:text-text-primary'}`}
              >
                {item.toLocaleString()}
              </button>
            ),
          )
        ) : (
          <span className="flex h-8 items-center gap-1 px-2 text-xs text-text-tertiary">
            <span>Page</span>
            <input
              type="number"
              min="1"
              max={maxHubPage}
              value={startPageDraft}
              disabled={loading}
              onChange={(event) => setStartPageDraft(event.target.value)}
              onBlur={() => goInfiniteStartPage(startPageDraft)}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
              aria-label="Hub start page"
              className="h-6 w-16 rounded border border-input bg-elevated px-2 text-right text-xs tabular-nums text-text-primary outline-none focus:border-ring/50"
            />
            <span className="tabular-nums">of {pageCountLabel}</span>
          </span>
        )}
        <button
          type="button"
          disabled={loading || (currentPage >= maxHubPage && !canRecheckTail)}
          onClick={() => goCurrentModePage(currentPage + 1)}
          title="Next Hub page"
          className={iconClass}
        >
          <ChevronRight size={18} />
        </button>
        <button
          type="button"
          disabled={loading || (currentPage >= maxHubPage && !canRecheckTail)}
          onClick={() => goCurrentModePage(maxHubPage)}
          title="Last Hub page"
          className={iconClass}
        >
          <ChevronsRight size={17} />
        </button>
      </div>
    )
  }

  const renderPageSummary = () => (
    <div className="flex min-w-0 items-center justify-end gap-2">
      <span className="text-right text-[11px] tabular-nums text-text-tertiary">{pageRange}</span>
      <span className="text-[11px] text-text-tertiary">Page size</span>
      <Select value={String(perPage)} onValueChange={setPerPage}>
        <SelectTrigger size="sm" className="h-8 min-w-[72px]" aria-label="Hub page size">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end" className="min-w-[72px]">
          {HUB_PER_PAGE_OPTIONS.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {size}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  const activeSections = wishlistMode ? wishlistSections : sections
  const activeFilterCount = activeSections.filter((s) => sectionActive(s) === true).length

  const refreshBusy = loading && resources.length === 0

  return (
    <div ref={pageNavRootRef} className="h-full flex min-w-0 relative" onMouseUpCapture={handleMousePageButton}>
      {/* Both modes use the same panel; hub filters drive the server query while
          wishlist filters run client-side over the local snapshots. */}
      <FilterPanel
        search={wishlistMode ? wlSearch : searchDraft}
        onSearchChange={wishlistMode ? setWlSearch : handleSearchChange}
        smartSearch={
          wishlistMode ? { authors: wishlistFacets.authorCounts, tags: wishlistFacets.tagCounts, labels: [] } : null
        }
        sections={wishlistMode ? wishlistSections : sections}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Toolbar */}
        <div className="min-h-10 grid grid-cols-[minmax(120px,1fr)_auto_minmax(120px,1fr)] items-center px-4 py-1 border-b border-border shrink-0 gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {/* dismissTransientOverlays: the mode toggle hides one <Activity> gallery surface, which
              would orphan any overlay (tooltip/menu) still open or animating out inside it. */}
            <div className="flex items-center gap-px bg-elevated rounded p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => {
                  dismissTransientOverlays()
                  setGalleryMode('hub')
                }}
                className={`px-2 py-1 rounded cursor-pointer transition-colors ${!wishlistMode ? 'bg-hover text-text-primary' : 'text-text-tertiary hover:text-text-secondary'}`}
              >
                Hub
              </button>
              <button
                type="button"
                onClick={() => {
                  dismissTransientOverlays()
                  setGalleryMode('wishlist')
                }}
                className={`px-2 py-1 rounded cursor-pointer transition-colors flex items-center gap-1 ${wishlistMode ? 'bg-hover text-text-primary' : 'text-text-tertiary hover:text-text-secondary'}`}
              >
                Wishlist
                {wishlistCount > 0 && <span className="tabular-nums opacity-70">{wishlistCount}</span>}
              </button>
            </div>
            <span className="text-[11px] text-text-tertiary">
              {wishlistMode
                ? wishlistLoading && !wishlistLoaded
                  ? 'Loading…'
                  : wishlistFiltered.length !== wishlistItems.length
                    ? `${wishlistFiltered.length.toLocaleString()} of ${wishlistItems.length.toLocaleString()} wishlisted`
                    : `${wishlistItems.length.toLocaleString()} wishlisted`
                : loading && resources.length === 0
                  ? 'Searching…'
                  : hideInstalled || showHidden
                    ? `${visibleResources.length.toLocaleString()} shown`
                    : `${totalFound.toLocaleString()} packages`}
            </span>
            {activeFilterCount > 0 && (
              <span className="shrink-0 flex items-center gap-1.5 whitespace-nowrap text-[11px] text-text-tertiary">
                <span aria-hidden="true">·</span>
                <span>
                  {activeFilterCount} {activeFilterCount === 1 ? 'filter' : 'filters'}
                </span>
                <span>
                  (
                  <button
                    type="button"
                    onClick={() => (wishlistMode ? resetWishlistFilters() : resetFilters())}
                    title="Reset all filters to their defaults"
                    className="text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
                  >
                    Reset
                  </button>
                  )
                </span>
              </span>
            )}
            {/* Network-backed hub search gets a cache-busting refresh; the wishlist
              is local + live, so it needs none. */}
            {!wishlistMode && (
              <button
                type="button"
                onClick={() =>
                  fetchResources(true, {
                    forceRefresh: true,
                    page: browseMode === 'infinite' ? restorePage : page,
                  })
                }
                disabled={refreshBusy}
                title="Refresh"
                className="p-1 rounded text-text-tertiary hover:text-text-secondary disabled:opacity-30 cursor-pointer disabled:cursor-default"
              >
                <RefreshCw size={13} className={refreshBusy ? 'animate-spin' : ''} />
              </button>
            )}
          </div>
          {renderPageNav()}
          <div className="col-start-3 flex min-w-0 flex-wrap items-center justify-end gap-2">
            {!wishlistMode && shouldRenderHubPageSummary(browseMode, showInfinitePagerControls) && renderPageSummary()}
            <ThumbnailSizeSlider
              cardWidth={cardWidth}
              availableWidth={availableWidth}
              onCardWidthChange={setCardWidth}
            />
            {!wishlistMode && (
              <button
                type="button"
                onClick={toggleBrowseMode}
                title={browseMode === 'infinite' ? 'Infinite scroll' : 'Paged browsing'}
                className="p-1.5 rounded cursor-pointer text-text-tertiary hover:text-text-primary hover:bg-elevated"
              >
                {browseMode === 'infinite' ? <InfinityIcon size={14} /> : <BookOpen size={14} />}
              </button>
            )}
            <div className="flex items-center gap-px bg-elevated rounded p-0.5">
              <button
                type="button"
                onClick={() => setCardMode('minimal')}
                title="Small cards"
                className={`p-1.5 rounded cursor-pointer ${cardMode === 'minimal' ? 'bg-hover text-text-primary' : 'text-text-tertiary'}`}
              >
                <Grid3x3 size={14} />
              </button>
              <button
                type="button"
                onClick={() => setCardMode('medium')}
                title="Large cards"
                className={`p-1.5 rounded cursor-pointer ${cardMode === 'medium' ? 'bg-hover text-text-primary' : 'text-text-tertiary'}`}
              >
                <Grid2x2 size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Gallery — cards + wishlist are two <Activity>-kept scroll surfaces, so
            toggling modes preserves each one's scroll and DOM. */}
        <div className="relative flex-1 min-h-0 flex flex-col min-w-0">
          <Activity mode={wishlistMode ? 'hidden' : 'visible'}>
            <div className="relative flex-1 min-h-0 flex flex-col min-w-0">
              {error && (
                <div className="shrink-0 mx-4 mt-4 px-4 py-3 rounded-lg bg-error/10 border border-error/20 text-error text-xs select-text cursor-text">
                  {error}
                </div>
              )}
              {hubShowSkeleton ? (
                <div className="flex-1 overflow-y-auto p-4">
                  <div
                    className="grid gap-3 content-start"
                    style={{ gridTemplateColumns: `repeat(auto-fill,minmax(min(${cardWidth}px,100%),1fr))` }}
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <SkeletonCard key={i} mode={cardMode} />
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <VirtualGrid
                    items={visibleResources}
                    itemWidth={cardWidth}
                    itemHeight={compactCards ? cardWidth : cardWidth + HUB_CARD_FOOTER_PX}
                    fixedHeight={compactCards ? 0 : HUB_CARD_FOOTER_PX}
                    className="flex-1"
                    scrollRef={galleryRef}
                    onWheel={handleGalleryWheel}
                    scrollResetKey={hubScrollResetKey}
                    onLayout={handleGridLayout}
                    hideEmptyMessage
                    onEndReached={browseMode === 'infinite' && page < totalPages ? fetchNextPage : undefined}
                    footer={
                      loading && !loadingPrevious && resources.length > 0 ? (
                        <div className="flex items-center justify-center -mt-3 pb-4">
                          <Loader2 size={20} className="animate-spin text-accent-blue" />
                          <span className="text-[11px] text-text-tertiary ml-2">Loading more…</span>
                        </div>
                      ) : null
                    }
                    renderItem={(r) => (
                      <HubCard
                        key={r.resource_id}
                        resource={r}
                        onClick={openDetail}
                        onViewInLibrary={handleViewInLibrary}
                        onInstall={handleInstall}
                        onPromote={handlePromote}
                        onFilterAuthor={handleFilterAuthor}
                        onHide={(resource) => useHubHiddenStore.getState().hide(resource)}
                        onUnhide={(resource) => useHubHiddenStore.getState().unhide(resource.resource_id)}
                        isHidden={hiddenHubIds.has(String(r.resource_id))}
                        mode={cardMode}
                        hideType={selectedType !== 'All'}
                      />
                    )}
                  />
                  {!loading && sort && resources.length === 0 && (
                    <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-16 text-text-tertiary text-sm">
                      No packages found
                    </div>
                  )}
                </>
              )}
            </div>
          </Activity>

          <Activity mode={wishlistMode ? 'visible' : 'hidden'}>
            <div className="relative flex-1 min-h-0 flex flex-col min-w-0">
              <VirtualGrid
                items={wishlistFiltered}
                itemWidth={cardWidth}
                itemHeight={compactCards ? cardWidth : cardWidth + HUB_CARD_FOOTER_PX}
                fixedHeight={compactCards ? 0 : HUB_CARD_FOOTER_PX}
                className="flex-1"
                scrollResetKey={wlScrollResetKey}
                onLayout={handleGridLayout}
                hideEmptyMessage
                renderItem={(r) => (
                  <HubCard
                    key={r.resource_id}
                    resource={r}
                    onClick={openDetail}
                    onViewInLibrary={handleViewInLibrary}
                    onInstall={handleInstall}
                    onPromote={handlePromote}
                    onFilterAuthor={handleFilterAuthor}
                    mode={cardMode}
                    hideType={wlType !== 'All'}
                    wishlist
                  />
                )}
              />
              {wishlistLoaded && wishlistItems.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-16">
                  <div className="max-w-sm text-center text-text-tertiary text-sm flex flex-col items-center gap-2">
                    <Pin size={28} className="opacity-40" />
                    <p>Your wishlist is empty.</p>
                    <p className="text-[12px] text-text-tertiary/80">
                      Open a package and tap the <Pin size={12} className="inline align-[-1px]" /> button in its details
                      to add it here.
                    </p>
                  </div>
                </div>
              )}
              {wishlistItems.length > 0 && wishlistFiltered.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-16 text-text-tertiary text-sm">
                  No wishlisted packages match your filters
                </div>
              )}
            </div>
          </Activity>
        </div>
      </div>
      {detailResource && (
        <HubDetail
          key={detailNonce}
          resource={detailResource}
          onBack={popDetailHistory}
          onClose={closeDetail}
          onNavigate={onNavigate}
          onInstall={handleInstall}
          onFilterAuthor={handleFilterAuthor}
          onPrev={handleDetailPrev}
          onNext={handleDetailNext}
          canPrev={canPrevDetail}
          canNext={canNextDetail}
          position={detailPosition}
          backLabel={detailBackLabel}
        />
      )}
    </div>
  )
}

// --- Skeleton card for gallery loading ---

function SkeletonCard({ mode = 'medium' }) {
  const minimal = mode === 'minimal'
  return (
    <div className="w-full min-w-0 bg-surface border border-border rounded-lg overflow-hidden flex flex-col">
      <div className="relative aspect-square skeleton" />
      {!minimal && (
        <div className="p-3">
          <div className="flex items-center gap-2">
            <div className="w-[30px] h-[30px] rounded-sm skeleton shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="h-3.5 skeleton rounded w-3/4" />
              <div className="h-2.5 skeleton rounded w-1/2" />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <div className="h-2.5 skeleton rounded w-10" />
            <div className="h-2.5 skeleton rounded w-10" />
            <div className="h-2.5 skeleton rounded w-8" />
          </div>
          <div className="h-[30px] skeleton rounded w-full mt-3" />
        </div>
      )}
    </div>
  )
}
