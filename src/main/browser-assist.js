import { readFile, writeFile, readdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { categoryOf } from '@shared/content-types.js'
import {
  getPackageIndex,
  getContentByPackage,
  effectivePackageType,
  getLabelsByPackageMap,
  getLabelsByContentMap,
  getLabelContentSourcesMap,
  getLabelNameById,
  refreshLabels,
  buildFromDb,
} from './store.js'
import {
  LABEL_SOURCE_BACKSTAGE,
  LABEL_SOURCE_BROWSERASSIST,
  applyLabelToContents,
  clearLabelContentSource,
  findOrCreateLabel,
  getPackageHidden,
  removeLabelFromContents,
  setLabelContentSource,
  setPackageHidden,
} from './db.js'
import { readPackageHiddenPrefs } from './package-prefs.js'

const BA_REL_PARTS = ['Saves', 'PluginData', 'JayJayWon', 'BrowserAssist', 'VARResourcesUserData']
const MANAGED_SCENE_TAGS = new Set(['scene-real', 'scene-look', 'scene-other'])
const USER_CATEGORY = 'User'
const LABEL_CATEGORY = 'Label'

export function browserAssistSettingsDir(vamDir) {
  return join(vamDir, ...BA_REL_PARTS)
}

/**
 * @param {string|null|undefined} vamDir
 * @returns {boolean}
 */
export function browserAssistSettingsDirExists(vamDir) {
  if (!vamDir || typeof vamDir !== 'string') return false
  return existsSync(browserAssistSettingsDir(vamDir))
}

export function applyBrowserAssistPackageHidden(currentHidden, baHidden) {
  return typeof baHidden === 'boolean' ? baHidden : currentHidden
}

export async function syncBrowserAssistPackageHidden(
  vamDir,
  {
    packageIndex = getPackageIndex,
    readHiddenPrefs = readPackageHiddenPrefs,
    readCurrentHidden = getPackageHidden,
    writeHidden = setPackageHidden,
    refreshStore = buildFromDb,
  } = {},
) {
  const errors = []
  let packagesHiddenImported = 0
  const packageHiddenByName = new Map()

  for (const [filename, pkg] of packageIndex()) {
    const packageName = typeof pkg.package_name === 'string' ? pkg.package_name : ''
    if (!packageName) continue

    let baHidden
    if (packageHiddenByName.has(packageName)) {
      baHidden = packageHiddenByName.get(packageName)
    } else {
      try {
        baHidden = await readHiddenPrefs(vamDir, packageName)
      } catch (err) {
        errors.push(`${packageName}: package hidden prefs read failed — ${err.message}`)
        baHidden = null
      }
      packageHiddenByName.set(packageName, baHidden)
    }

    const currentHidden = readCurrentHidden(filename)
    const nextHidden = applyBrowserAssistPackageHidden(currentHidden, baHidden)
    if (nextHidden !== currentHidden) {
      writeHidden(filename, nextHidden)
      packagesHiddenImported++
    }
  }

  if (packagesHiddenImported > 0) refreshStore({ skipGraph: true })
  return { packagesHiddenImported, errors }
}

/**
 * @returns {boolean}
 */
function isSceneContentPath(normPath) {
  return /^Saves\/scene\//i.test(normPath) && /\.(json|vac)$/i.test(normPath)
}

/**
 * @param {string|null|undefined} pt
 * @returns {string}
 */
function sceneTagForPackageType(pt) {
  if (pt === 'Scenes') return 'scene-real'
  if (pt === 'Looks') return 'scene-look'
  return 'scene-other'
}

export function browserAssistCategory(normPath, tags, fallbackType) {
  const userTags = new Set(
    (Array.isArray(tags) ? tags : [])
      .filter((t) => t && typeof t === 'object' && t.tagCategory === USER_CATEGORY && typeof t.tagName === 'string')
      .map((t) => t.tagName.trim()),
  )
  if (userTags.has('scene-look')) return 'Looks'
  if (userTags.has('scene-real') || userTags.has('scene-other')) return 'Scenes'
  if (/^Custom\/Clothing\//i.test(normPath)) return 'Clothing'
  if (/^Custom\/Hair\//i.test(normPath)) return 'Hairstyles'
  if (/^(Custom\/Atom\/Person\/Pose\/|Saves\/Person\/Pose\/)/i.test(normPath)) return 'Poses'
  return categoryOf(fallbackType)
}

/**
 * Resolve label ids to display names, preserving first-seen order and skipping unknowns.
 *
 * @param {Iterable<number>} ids
 * @returns {string[]}
 */
function labelNamesFromIds(ids) {
  const names = []
  const seenIds = new Set()
  for (const id of ids) {
    if (seenIds.has(id)) continue
    seenIds.add(id)
    const name = getLabelNameById(id)
    if (name) names.push(name)
  }
  return names
}

/**
 * Build a package-level lookup keyed by `lower(package_name)`.
 *
 * BrowserAssist stores package-wide tags as a resource with an empty
 * `resourceFullFileName`. Multiple installed versions share that key (BA has no
 * version axis), so label names are unioned across versions.
 *
 * Every indexed package gets an entry (possibly empty) so a later sync can strip
 * stale `Label`-category tags when all labels were removed.
 *
 * @returns {Map<string, Set<string>>}
 */
function buildPackageLookup() {
  const packageIndex = getPackageIndex()
  const labelsByPackage = getLabelsByPackageMap()

  const lookup = new Map()
  for (const [filename, pkg] of packageIndex) {
    const pkgName = typeof pkg.package_name === 'string' ? pkg.package_name : ''
    if (!pkgName) continue
    const pkgKey = pkgName.toLowerCase()

    let entry = lookup.get(pkgKey)
    if (!entry) {
      entry = new Set()
      lookup.set(pkgKey, entry)
    }
    for (const name of labelNamesFromIds(labelsByPackage.get(filename) || [])) {
      entry.add(name)
    }
  }
  return lookup
}

/**
 * Build a content lookup keyed by `lower(package_name) + '\0' + lower(internal_path)`.
 *
 * Each entry carries:
 *   - `sceneType`: effective package type for scene/legacyScene rows (used to derive
 *     scene-real/scene-look/scene-other), or null for non-scene content.
 *   - `packageLabelNames`: inherited package labels exported to BrowserAssist.
 *   - `contentLabels`: content labels plus source rows, keyed by label name.
 *
 * Multiple installed package versions share the same `(packageKey, pathKey)` (BA has
 * no version axis). We merge across versions: any version's scene type sticks; label
 * names are unioned so a label set on either v1 or v2 still appears on the BA tag.
 *
 * @returns {Map<string, { packageFilename: string, internalPath: string, type: string, sceneType: string|null, packageLabelNames: Set<string>, contentLabels: Map<string, { id: number, sourceMask: number, baCategory: string|null }> }>}
 */
function buildContentLookup() {
  const packageIndex = getPackageIndex()
  const contentByPackage = getContentByPackage()
  const labelsByPackage = getLabelsByPackageMap()
  const labelsByContent = getLabelsByContentMap()
  const labelSources = getLabelContentSourcesMap()
  const sourcesByContent = new Map()
  for (const [key, sourceMask] of labelSources) {
    const [packageFilename, internalPath, labelId] = key.split('\0')
    const contentKey = packageFilename + '\0' + internalPath
    let rows = sourcesByContent.get(contentKey)
    if (!rows) {
      rows = new Map()
      sourcesByContent.set(contentKey, rows)
    }
    rows.set(Number(labelId), sourceMask)
  }

  const lookup = new Map()
  for (const [filename, pkg] of packageIndex) {
    const pkgName = typeof pkg.package_name === 'string' ? pkg.package_name : ''
    if (!pkgName) continue
    const pkgKey = pkgName.toLowerCase()
    const pt = effectivePackageType(pkg)
    const items = contentByPackage.get(filename)
    if (!items) continue

    const inheritedIds = labelsByPackage.get(filename) || []

    for (const item of items) {
      const ip = typeof item.internal_path === 'string' ? item.internal_path : ''
      if (!ip) continue
      const pathKey = ip.replace(/\\/g, '/').toLowerCase()
      const key = pkgKey + '\0' + pathKey

      const contentKey = filename + '\0' + item.internal_path
      const ownIds = labelsByContent.get(contentKey) || []
      const sourceRows = sourcesByContent.get(contentKey) || new Map()
      const packageLabelNames = []
      const contentLabels = new Map()
      const seenIds = new Set()
      for (const id of inheritedIds) {
        if (seenIds.has(id)) continue
        seenIds.add(id)
        const name = getLabelNameById(id)
        if (name) packageLabelNames.push(name)
      }
      for (const id of ownIds) {
        const name = getLabelNameById(id)
        if (!name) continue
        const source = sourceRows.get(id)
        contentLabels.set(name, {
          id,
          sourceMask: source?.sourceMask ?? source ?? LABEL_SOURCE_BACKSTAGE,
          baCategory: source?.baCategory ?? null,
        })
      }
      for (const [id, sourceMask] of sourceRows) {
        if (contentLabels.has(getLabelNameById(id))) continue
        const name = getLabelNameById(id)
        if (name) {
          contentLabels.set(name, {
            id,
            sourceMask: sourceMask?.sourceMask ?? sourceMask,
            baCategory: sourceMask?.baCategory ?? null,
          })
        }
      }

      const isSceneItem = item.type === 'scene' || item.type === 'legacyScene'
      const sceneType = isSceneItem ? pt : null

      let entry = lookup.get(key)
      if (!entry) {
        entry = {
          packageFilename: filename,
          internalPath: item.internal_path,
          type: item.type,
          sceneType,
          packageLabelNames: new Set(packageLabelNames),
          contentLabels,
        }
        lookup.set(key, entry)
      } else {
        if (sceneType && !entry.sceneType) entry.sceneType = sceneType
        for (const n of packageLabelNames) entry.packageLabelNames.add(n)
        for (const [name, info] of contentLabels) {
          const existing = entry.contentLabels.get(name)
          entry.contentLabels.set(
            name,
            existing
              ? {
                  ...existing,
                  sourceMask: existing.sourceMask | info.sourceMask,
                  baCategory: existing.baCategory || info.baCategory,
                }
              : info,
          )
        }
      }
    }
  }
  return lookup
}

/**
 * @param {unknown} tags
 * @returns {Set<string>}
 */
export function browserAssistUserTagNames(tags) {
  const arr = Array.isArray(tags) ? tags : []
  return new Set(
    arr
      .filter((t) => t && typeof t === 'object' && t.tagCategory === USER_CATEGORY && typeof t.tagName === 'string')
      .map((t) => t.tagName.trim())
      .filter((name) => name && !MANAGED_SCENE_TAGS.has(name)),
  )
}

function mergeLabelTags(tags, labelNames) {
  const arr = Array.isArray(tags) ? tags : []
  const hasStaleLabels = arr.some((t) => t && typeof t === 'object' && t.tagCategory === LABEL_CATEGORY)
  if (labelNames.length === 0 && !hasStaleLabels) return tags

  const filtered = arr.filter((t) => !t || typeof t !== 'object' || t.tagCategory !== LABEL_CATEGORY)
  if (labelNames.length === 0) return filtered

  const sorted = [...labelNames].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  return [...filtered, ...sorted.map((name) => ({ tagName: name, tagCategory: LABEL_CATEGORY }))]
}

/**
 * @param {unknown} tags
 * @param {string[]} labelNames
 * @param {string|null} sceneTagName
 * @returns {Array<{ tagName: string, tagCategory: string }>}
 */
export function mergeBrowserAssistUserTags(tags, labelNames, sceneTagName = null) {
  const arr = Array.isArray(tags) ? tags : []
  const filtered = arr.filter((t) => !t || typeof t !== 'object' || t.tagCategory !== USER_CATEGORY)
  const wanted = new Set(labelNames.map((n) => String(n ?? '').trim()).filter(Boolean))
  const sorted = [...wanted].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  const next = [...filtered, ...sorted.map((n) => ({ tagName: n, tagCategory: USER_CATEGORY }))]
  if (sceneTagName) next.push({ tagName: sceneTagName, tagCategory: USER_CATEGORY })
  return next
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function shallowTagsEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * @param {string} vamDir
 * @returns {Promise<{
 *   shardsRead: number,
 *   shardsWritten: number,
 *   resourcesScanned: number,
 *   tagsUpdated: number,
 *   labelsImported: number,
 *   labelsRemoved: number,
 *   labelsExported: number,
 *   packagesHiddenImported: number,
 *   skippedNoMatch: number,
 *   errors: string[],
 * }>}
 */
export async function syncBrowserAssistTags(vamDir) {
  const dir = browserAssistSettingsDir(vamDir)
  const errors = []
  let shardsRead = 0
  let shardsWritten = 0
  let resourcesScanned = 0
  let tagsUpdated = 0
  let labelsImported = 0
  let labelsRemoved = 0
  let labelsExported = 0
  let packagesHiddenImported = 0
  let skippedNoMatch = 0
  let labelsChanged = false

  const packageHiddenSync = await syncBrowserAssistPackageHidden(vamDir)
  packagesHiddenImported = packageHiddenSync.packagesHiddenImported
  errors.push(...packageHiddenSync.errors)

  if (!existsSync(dir)) {
    return {
      shardsRead: 0,
      shardsWritten: 0,
      resourcesScanned: 0,
      tagsUpdated: 0,
      labelsImported: 0,
      labelsRemoved: 0,
      labelsExported: 0,
      packagesHiddenImported,
      skippedNoMatch: 0,
      errors: [...errors, `BrowserAssist directory not found: ${dir}`],
    }
  }

  let names
  try {
    names = await readdir(dir)
  } catch (err) {
    return {
      shardsRead: 0,
      shardsWritten: 0,
      resourcesScanned: 0,
      tagsUpdated: 0,
      labelsImported: 0,
      labelsRemoved: 0,
      labelsExported: 0,
      packagesHiddenImported,
      skippedNoMatch: 0,
      errors: [...errors, `Failed to read BrowserAssist directory: ${err.message}`],
    }
  }

  const shardFiles = names.filter((n) => /^VARResourcesData.*\.userData$/i.test(n)).sort()
  const contentLookup = buildContentLookup()
  const packageLookup = buildPackageLookup()

  for (const name of shardFiles) {
    const filePath = join(dir, name)
    let text
    try {
      text = await readFile(filePath, 'utf8')
    } catch (err) {
      errors.push(`${name}: read failed — ${err.message}`)
      continue
    }
    shardsRead++

    let data
    try {
      data = JSON.parse(text)
    } catch (err) {
      errors.push(`${name}: invalid JSON — ${err.message}`)
      continue
    }

    const resources = data?.resources
    if (!Array.isArray(resources)) {
      errors.push(`${name}: missing or invalid "resources" array`)
      continue
    }

    let modified = false
    for (const res of resources) {
      if (!res || typeof res !== 'object') continue

      const cName = typeof res.creatorName === 'string' ? res.creatorName : ''
      const pName = typeof res.packageName === 'string' ? res.packageName : ''
      if (!cName || !pName) continue

      const rawPath = typeof res.resourceFullFileName === 'string' ? res.resourceFullFileName : ''
      const normPath = rawPath.replace(/\\/g, '/').trim()
      // Empty resourceFullFileName = package-level row (tags on the .var itself).
      const isPackageLevel = !normPath

      resourcesScanned++
      const dbPackageName = `${cName}.${pName}`.toLowerCase()

      let nextTags = res.Tags
      if (isPackageLevel) {
        const labelNames = packageLookup.get(dbPackageName)
        if (!labelNames) {
          skippedNoMatch++
          continue
        }
        nextTags = mergeLabelTags(nextTags, [...labelNames])
      } else {
        const key = dbPackageName + '\0' + normPath.toLowerCase()
        const entry = contentLookup.get(key)
        if (!entry) {
          skippedNoMatch++
          continue
        }
        const baLabels = browserAssistUserTagNames(res.Tags)
        const baCategory = browserAssistCategory(normPath, res.Tags, entry.type)
        const nextContentLabels = new Map(entry.contentLabels)

        for (const name of baLabels) {
          const label = findOrCreateLabel(name)
          if (label.created) labelsChanged = true
          const existing = nextContentLabels.get(label.name)
          const currentMask = existing?.sourceMask ?? 0
          if (existing && currentMask === 0) continue
          const nextMask = currentMask | LABEL_SOURCE_BROWSERASSIST
          nextContentLabels.set(label.name, { id: label.id, sourceMask: nextMask, baCategory })
          if (!existing || nextMask !== currentMask || existing.baCategory !== baCategory) {
            applyLabelToContents(label.id, [
              { packageFilename: entry.packageFilename, internalPath: entry.internalPath },
            ])
            setLabelContentSource(label.id, entry.packageFilename, entry.internalPath, nextMask, baCategory)
            labelsImported++
            labelsChanged = true
          }
        }

        for (const [name, info] of entry.contentLabels) {
          if (info.sourceMask === 0) {
            if (!baLabels.has(name)) clearLabelContentSource(info.id, entry.packageFilename, entry.internalPath)
            nextContentLabels.delete(name)
            labelsChanged = true
            continue
          }
          if (info.sourceMask & LABEL_SOURCE_BROWSERASSIST && !baLabels.has(name)) {
            const nextMask = info.sourceMask & ~LABEL_SOURCE_BROWSERASSIST
            if (nextMask) {
              setLabelContentSource(info.id, entry.packageFilename, entry.internalPath, nextMask)
              nextContentLabels.set(name, { ...info, sourceMask: nextMask })
            } else {
              removeLabelFromContents(info.id, [
                { packageFilename: entry.packageFilename, internalPath: entry.internalPath },
              ])
              clearLabelContentSource(info.id, entry.packageFilename, entry.internalPath)
              nextContentLabels.delete(name)
            }
            labelsRemoved++
            labelsChanged = true
          }
        }

        const outboundNames = new Set(entry.packageLabelNames)
        for (const [name, info] of nextContentLabels) {
          if (info.sourceMask > 0) outboundNames.add(name)
        }
        const sceneTagName =
          entry.sceneType && isSceneContentPath(normPath) ? sceneTagForPackageType(entry.sceneType) : null
        nextTags = mergeBrowserAssistUserTags(res.Tags, [...outboundNames], sceneTagName)
      }

      if (shallowTagsEqual(res.Tags, nextTags)) continue
      res.Tags = nextTags
      modified = true
      tagsUpdated++
      labelsExported++
    }

    if (modified) {
      try {
        await writeFile(filePath, JSON.stringify(data, null, 3) + '\n', 'utf8')
        shardsWritten++
      } catch (err) {
        errors.push(`${name}: write failed — ${err.message}`)
      }
    }
  }

  if (labelsChanged) refreshLabels()

  return {
    shardsRead,
    shardsWritten,
    resourcesScanned,
    tagsUpdated,
    labelsImported,
    labelsRemoved,
    labelsExported,
    packagesHiddenImported,
    skippedNoMatch,
    errors,
  }
}
