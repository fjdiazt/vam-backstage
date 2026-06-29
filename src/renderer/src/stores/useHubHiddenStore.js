import { create } from 'zustand'
import { toast } from '@/components/Toast'

export const useHubHiddenStore = create((set, get) => ({
  items: [],
  ids: new Set(),
  loading: false,

  hydrate: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const rows = await window.api.hub.hidden.list()
      set({ items: rows, ids: new Set(rows.map((r) => String(r.resource_id))), loading: false })
    } catch (err) {
      set({ loading: false })
      toast(`Failed to load hidden Hub items: ${err.message}`)
    }
  },

  hide: async (resource) => {
    const rid = String(resource.resource_id)
    const previous = { items: get().items, ids: get().ids }
    set((s) => {
      const ids = new Set(s.ids).add(rid)
      const item = { resource_id: rid, title: resource.title || `Resource ${rid}` }
      return { ids, items: [item, ...s.items.filter((r) => String(r.resource_id) !== rid)] }
    })
    try {
      const row = await window.api.hub.hidden.hide(resource)
      set((s) => ({
        ids: new Set(s.ids).add(rid),
        items: [row, ...s.items.filter((r) => String(r.resource_id) !== rid)],
      }))
    } catch (err) {
      set(previous)
      toast(`Failed to hide Hub item: ${err.message}`)
    }
  },

  unhide: async (resourceId) => {
    const rid = String(resourceId)
    const previous = { items: get().items, ids: get().ids }
    set((s) => {
      const ids = new Set(s.ids)
      ids.delete(rid)
      return { ids, items: s.items.filter((r) => String(r.resource_id) !== rid) }
    })
    try {
      await window.api.hub.hidden.unhide(rid)
    } catch (err) {
      set(previous)
      toast(`Failed to restore Hub item: ${err.message}`)
    }
  },

  clear: async () => {
    const previous = { items: get().items, ids: get().ids }
    set({ items: [], ids: new Set() })
    try {
      await window.api.hub.hidden.clear()
    } catch (err) {
      set(previous)
      toast(`Failed to clear hidden Hub items: ${err.message}`)
    }
  },
}))
