import { deleteHubWishlist, isHubWishlisted, listHubWishlist, upsertHubWishlist } from '../db.js'
import { findLocalByHubResourceId } from '../store.js'

const HUB_ORIGIN = 'https://hub.virtamate.com'

const pick = (obj, keys) =>
  Object.fromEntries(keys.map((key) => [key, obj?.[key]]).filter(([, value]) => value !== undefined))

export function snapshotHubWishlistResource(resource) {
  const resourceId = resource?.resource_id ?? resource?.resourceId
  return {
    resource_id: resourceId,
    title: resource?.title ?? null,
    url: resource?.url || `${HUB_ORIGIN}/resources/${resourceId}/`,
    image_url: resource?.image_url ?? resource?.imageUrl ?? null,
    username: resource?.username ?? null,
    type: resource?.type ?? null,
    category: resource?.category ?? null,
    license: resource?.license ?? resource?.licenseType ?? null,
    snapshot_json: JSON.stringify(
      pick(resource, [
        'resource_id',
        'title',
        'url',
        'image_url',
        'username',
        'type',
        'category',
        'license',
        'licenseType',
        'download_count',
        'reaction_score',
        'rating_avg',
        'user_id',
        'tags',
        'hubFiles',
        'hubDownloadable',
        'promotional_link',
      ]),
    ),
  }
}

export async function fetchThumbnailBlob(url) {
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0]
    return { buffer: Buffer.from(await res.arrayBuffer()), mime }
  } catch {
    return null
  }
}

export function listWishlist() {
  return listHubWishlist().filter((row) => {
    if (!findLocalByHubResourceId(row.resource_id)?.is_direct) return true
    deleteHubWishlist(row.resource_id)
    return false
  })
}

export function wishlistIds() {
  return listWishlist().map((r) => r.resource_id)
}

export async function toggleWishlist(resource) {
  const id = resource?.resource_id ?? resource?.resourceId
  if (findLocalByHubResourceId(id)?.is_direct) {
    deleteHubWishlist(id)
    return { wishlisted: false, item: null }
  }
  if (isHubWishlisted(id)) {
    deleteHubWishlist(id)
    return { wishlisted: false, item: null }
  }
  const snapshot = snapshotHubWishlistResource(resource)
  const thumb = await fetchThumbnailBlob(snapshot.image_url)
  const item = upsertHubWishlist(snapshot, thumb || {})
  return { wishlisted: true, item }
}
