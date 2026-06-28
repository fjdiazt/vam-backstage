import { create } from 'zustand'
import { toast } from '@/components/Toast'

function bytesToDataUrl(bytes, mime) {
  if (!bytes) return null
  const arr =
    bytes instanceof Uint8Array
      ? bytes
      : bytes instanceof ArrayBuffer
        ? new Uint8Array(bytes)
        : Array.isArray(bytes?.data)
          ? new Uint8Array(bytes.data)
          : Array.isArray(bytes)
            ? new Uint8Array(bytes)
            : null
  if (!arr?.length) return null
  let binary = ''
  for (let i = 0; i < arr.length; i += 8192) {
    binary += String.fromCharCode(...arr.subarray(i, i + 8192))
  }
  return `data:${mime || 'image/jpeg'};base64,${btoa(binary)}`
}

function rowToResource(row) {
  let snapshot = {}
  try {
    snapshot = row.snapshot_json ? JSON.parse(row.snapshot_json) : {}
  } catch {}
  return {
    ...snapshot,
    resource_id: row.resource_id,
    title: row.title ?? snapshot.title,
    url: row.url ?? snapshot.url,
    image_url: bytesToDataUrl(row.image_blob, row.image_mime) || row.image_url || snapshot.image_url,
    username: row.username ?? snapshot.username,
    type: row.type ?? snapshot.type,
    category: row.category ?? snapshot.category ?? 'Paid',
    license: row.license ?? snapshot.license,
    _wishlisted: true,
  }
}

export const useHubWishlistStore = create((set, get) => ({
  items: [],
  ids: new Set(),
  loading: false,

  hydrate: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const rows = await window.api.hub.wishlist.list()
      const items = rows.map(rowToResource)
      set({ items, ids: new Set(items.map((r) => String(r.resource_id))), loading: false })
    } catch (err) {
      set({ loading: false })
      toast(`Failed to load wishlist: ${err.message}`)
    }
  },

  toggle: async (resource) => {
    const rid = String(resource.resource_id)
    const wasWishlisted = get().ids.has(rid)
    const previousItems = get().items
    set((s) => {
      const ids = new Set(s.ids)
      if (wasWishlisted) ids.delete(rid)
      else ids.add(rid)
      return { ids, items: wasWishlisted ? s.items.filter((r) => String(r.resource_id) !== rid) : s.items }
    })
    try {
      const result = await window.api.hub.wishlist.toggle(resource)
      set((s) => {
        const ids = new Set(s.ids)
        let items = s.items.filter((r) => String(r.resource_id) !== rid)
        if (result.wishlisted && result.item) {
          const item = rowToResource(result.item)
          ids.add(rid)
          items = [item, ...items]
        } else {
          ids.delete(rid)
        }
        return { ids, items }
      })
    } catch (err) {
      set((s) => {
        const ids = new Set(s.ids)
        if (wasWishlisted) ids.add(rid)
        else ids.delete(rid)
        return { ids, items: previousItems }
      })
      toast(`Failed to update wishlist: ${err.message}`)
    }
  },
}))
