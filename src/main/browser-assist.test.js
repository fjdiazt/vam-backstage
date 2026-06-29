import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const storeMocks = vi.hoisted(() => ({
  buildFromDb: vi.fn(),
  getPackageIndex: vi.fn(() => new Map()),
  getContentByPackage: vi.fn(() => new Map()),
  effectivePackageType: vi.fn(() => 'Scenes'),
  getLabelsByPackageMap: vi.fn(() => new Map()),
  getLabelsByContentMap: vi.fn(() => new Map()),
  getLabelContentSourcesMap: vi.fn(() => new Map()),
  getLabelNameById: vi.fn(() => null),
  refreshLabels: vi.fn(),
  setContentDerivedHiddenRules: vi.fn(),
  setPackageDerivedHiddenMap: vi.fn(),
}))
const dbMocks = vi.hoisted(() => ({
  applyLabelToContents: vi.fn(),
  clearLabelContentSource: vi.fn(),
  findOrCreateLabel: vi.fn((name) => ({ id: 1, name, created: false })),
  getPackageHidden: vi.fn(() => null),
  removeLabelFromContents: vi.fn(),
  setLabelContentSource: vi.fn(),
  setPackageHidden: vi.fn(),
}))
const packagePrefsMocks = vi.hoisted(() => ({ readPackageHiddenPrefs: vi.fn(() => null) }))

vi.mock('./store.js', () => storeMocks)
vi.mock('./db.js', () => ({
  ...dbMocks,
  LABEL_SOURCE_BACKSTAGE: 1,
  LABEL_SOURCE_BROWSERASSIST: 2,
}))
vi.mock('./package-prefs.js', () => packagePrefsMocks)

import {
  applyBrowserAssistPackageHidden,
  browserAssistSettingsDir,
  browserAssistCategory,
  browserAssistUserTagNames,
  mergeBrowserAssistUserTags,
  syncBrowserAssistTags,
  parseBrowserAssistPackageHiddenRules,
  syncBrowserAssistDerivedContentHidden,
  syncBrowserAssistDerivedPackageHidden,
  syncBrowserAssistPackageHidden,
} from './browser-assist.js'

const BA_REL = ['Saves', 'PluginData', 'JayJayWon', 'BrowserAssist', 'VARResourcesUserData']

function shardPayload(resources) {
  return {
    VARUserDataStoreFormat: '3',
    BAMajorVersion: '1',
    BAMinorVersion: '42',
    BAFixVersion: '0',
    resources,
  }
}

describe('syncBrowserAssistTags — package-level labels', () => {
  let vamDir
  let shardDir

  beforeEach(async () => {
    vamDir = await mkdtemp(join(tmpdir(), 'ba-sync-'))
    shardDir = join(vamDir, ...BA_REL)
    await mkdir(shardDir, { recursive: true })

    for (const fn of Object.values(storeMocks)) fn.mockReset()
    for (const fn of Object.values(dbMocks)) fn.mockClear()
    packagePrefsMocks.readPackageHiddenPrefs.mockReset().mockResolvedValue(null)
    dbMocks.getPackageHidden.mockReturnValue(null)
    storeMocks.getPackageIndex.mockReturnValue(new Map())
    storeMocks.getContentByPackage.mockReturnValue(new Map())
    storeMocks.effectivePackageType.mockReturnValue('Scenes')
    storeMocks.getLabelsByPackageMap.mockReturnValue(new Map())
    storeMocks.getLabelsByContentMap.mockReturnValue(new Map())
    storeMocks.getLabelContentSourcesMap.mockReturnValue(new Map())
    storeMocks.getLabelNameById.mockReturnValue(null)
  })

  afterEach(async () => {
    await rm(vamDir, { recursive: true, force: true })
  })

  async function writeShard(resources) {
    const path = join(shardDir, 'VARResourcesData0001.userData')
    await writeFile(path, JSON.stringify(shardPayload(resources), null, 3) + '\n', 'utf8')
    return path
  }

  function seedPackage({ filename, packageName, labelIds = [] }) {
    const pkgIndex = storeMocks.getPackageIndex()
    pkgIndex.set(filename, { package_name: packageName, filename })
    storeMocks.getPackageIndex.mockReturnValue(pkgIndex)

    const byPkg = storeMocks.getLabelsByPackageMap()
    byPkg.set(filename, labelIds)
    storeMocks.getLabelsByPackageMap.mockReturnValue(byPkg)
  }

  it('writes Label-category tags onto package rows with empty resourceFullFileName', async () => {
    seedPackage({
      filename: 'CuddleMocap.023-Witch-Seduction.1.var',
      packageName: 'CuddleMocap.023-Witch-Seduction',
      labelIds: [1, 2],
    })
    storeMocks.getLabelNameById.mockImplementation((id) => ({ 1: 'favorites', 2: 'nsfw' })[id] ?? null)

    const shardPath = await writeShard([
      {
        creatorName: 'CuddleMocap',
        packageName: '023-Witch-Seduction',
        resourceFullFileName: '',
        baNew: 'true',
        Tags: [{ tagName: 'vartag', tagCategory: 'User' }],
      },
    ])

    const result = await syncBrowserAssistTags(vamDir)
    expect(result.errors).toEqual([])
    expect(result.tagsUpdated).toBe(1)
    expect(result.shardsWritten).toBe(1)

    const written = JSON.parse(await readFile(shardPath, 'utf8'))
    expect(written.resources[0].Tags).toEqual([
      { tagName: 'vartag', tagCategory: 'User' },
      { tagName: 'favorites', tagCategory: 'Label' },
      { tagName: 'nsfw', tagCategory: 'Label' },
    ])
  })

  it('strips stale Label tags when the package no longer has labels', async () => {
    seedPackage({
      filename: 'A.B.1.var',
      packageName: 'A.B',
      labelIds: [],
    })

    const shardPath = await writeShard([
      {
        creatorName: 'A',
        packageName: 'B',
        resourceFullFileName: '',
        Tags: [
          { tagName: 'keep-me', tagCategory: 'User' },
          { tagName: 'gone', tagCategory: 'Label' },
        ],
      },
    ])

    const result = await syncBrowserAssistTags(vamDir)
    expect(result.tagsUpdated).toBe(1)

    const written = JSON.parse(await readFile(shardPath, 'utf8'))
    expect(written.resources[0].Tags).toEqual([{ tagName: 'keep-me', tagCategory: 'User' }])
  })

  it('unions labels across installed versions of the same package', async () => {
    seedPackage({ filename: 'A.B.1.var', packageName: 'A.B', labelIds: [1] })
    seedPackage({ filename: 'A.B.2.var', packageName: 'A.B', labelIds: [2] })
    storeMocks.getLabelNameById.mockImplementation((id) => ({ 1: 'alpha', 2: 'beta' })[id] ?? null)

    const shardPath = await writeShard([
      {
        creatorName: 'A',
        packageName: 'B',
        resourceFullFileName: '',
        Tags: [],
      },
    ])

    await syncBrowserAssistTags(vamDir)
    const written = JSON.parse(await readFile(shardPath, 'utf8'))
    expect(written.resources[0].Tags).toEqual([
      { tagName: 'alpha', tagCategory: 'Label' },
      { tagName: 'beta', tagCategory: 'Label' },
    ])
  })

  it('skips package rows with no local DB match', async () => {
    seedPackage({ filename: 'Known.Pkg.1.var', packageName: 'Known.Pkg', labelIds: [1] })
    storeMocks.getLabelNameById.mockReturnValue('x')

    await writeShard([
      {
        creatorName: 'Unknown',
        packageName: 'Pkg',
        resourceFullFileName: '',
        Tags: [],
      },
    ])

    const result = await syncBrowserAssistTags(vamDir)
    expect(result.skippedNoMatch).toBe(1)
    expect(result.tagsUpdated).toBe(0)
    expect(result.shardsWritten).toBe(0)
  })

  it('still syncs content-level labels alongside package rows', async () => {
    seedPackage({
      filename: 'A.B.1.var',
      packageName: 'A.B',
      labelIds: [1],
    })
    storeMocks.getContentByPackage.mockReturnValue(
      new Map([['A.B.1.var', [{ internal_path: 'Saves/scene/foo.json', type: 'scene' }]]]),
    )
    storeMocks.getLabelsByContentMap.mockReturnValue(new Map([['A.B.1.var\0Saves/scene/foo.json', [2]]]))
    storeMocks.getLabelNameById.mockImplementation((id) => ({ 1: 'pkg', 2: 'own' })[id] ?? null)
    storeMocks.effectivePackageType.mockReturnValue('Scenes')

    const shardPath = await writeShard([
      {
        creatorName: 'A',
        packageName: 'B',
        resourceFullFileName: '',
        Tags: [],
      },
      {
        creatorName: 'A',
        packageName: 'B',
        resourceFullFileName: 'Saves/scene/foo.json',
        Tags: [],
      },
    ])

    const result = await syncBrowserAssistTags(vamDir)
    expect(result.tagsUpdated).toBe(2)

    const written = JSON.parse(await readFile(shardPath, 'utf8'))
    expect(written.resources[0].Tags).toEqual([{ tagName: 'pkg', tagCategory: 'Label' }])
    expect(written.resources[1].Tags).toEqual([
      { tagName: 'own', tagCategory: 'User' },
      { tagName: 'pkg', tagCategory: 'User' },
      { tagName: 'scene-real', tagCategory: 'User' },
    ])
  })

  it('reports a clear error when the BrowserAssist directory is missing', async () => {
    const result = await syncBrowserAssistTags(join(vamDir, 'missing'))
    expect(result.shardsRead).toBe(0)
    expect(result.errors[0]).toMatch(/BrowserAssist directory not found/)
  })

  it('resolves the expected settings directory under vamDir', () => {
    expect(browserAssistSettingsDir('/vam')).toBe(join('/vam', ...BA_REL))
  })
})

describe('BrowserAssist user tag helpers', () => {
  it('reads User category tags except managed scene tags', () => {
    expect([
      ...browserAssistUserTagNames([
        { tagName: 'Favorite', tagCategory: 'User' },
        { tagName: 'scene-real', tagCategory: 'User' },
        { tagName: 'fixed', tagCategory: 'Scene' },
        { tagName: '', tagCategory: 'User' },
      ]),
    ]).toEqual(['Favorite'])
  })

  it('rewrites only User category tags and can append managed scene tag', () => {
    expect(
      mergeBrowserAssistUserTags(
        [
          { tagName: 'fixed', tagCategory: 'Scene' },
          { tagName: 'Old', tagCategory: 'User' },
        ],
        ['New', 'Favorite'],
        'scene-look',
      ),
    ).toEqual([
      { tagName: 'fixed', tagCategory: 'Scene' },
      { tagName: 'Favorite', tagCategory: 'User' },
      { tagName: 'New', tagCategory: 'User' },
      { tagName: 'scene-look', tagCategory: 'User' },
    ])
  })

  it('derives BA category from scene marker tags before path fallback', () => {
    expect(
      browserAssistCategory('Saves/scene/Demo.json', [{ tagName: 'scene-look', tagCategory: 'User' }], 'scene'),
    ).toBe('Looks')
    expect(browserAssistCategory('Custom/Hair/Foo.vam', [], 'hairItem')).toBe('Hairstyles')
  })

  it('applies BrowserAssist package hidden when explicit', () => {
    expect(applyBrowserAssistPackageHidden(null, true)).toBe(true)
    expect(applyBrowserAssistPackageHidden(false, true)).toBe(true)
    expect(applyBrowserAssistPackageHidden(true, false)).toBe(false)
    expect(applyBrowserAssistPackageHidden(true, null)).toBe(true)
  })

  it('imports package hidden prefs and refreshes summaries', async () => {
    const writes = []
    const refreshes = []

    const result = await syncBrowserAssistPackageHidden('VAM', {
      packageIndex: () =>
        new Map([
          ['A.Pkg.1.var', { package_name: 'A.Pkg' }],
          ['B.Pkg.1.var', { package_name: 'B.Pkg' }],
        ]),
      readHiddenPrefs: async (_vamDir, packageName) => (packageName === 'A.Pkg' ? true : null),
      readCurrentHidden: (filename) => (filename === 'A.Pkg.1.var' ? false : null),
      writeHidden: (filename, hidden) => writes.push([filename, hidden]),
      refreshStore: (opts) => refreshes.push(opts),
    })

    expect(result).toEqual({ packagesHiddenImported: 1, errors: [] })
    expect(writes).toEqual([['A.Pkg.1.var', true]])
    expect(refreshes).toEqual([{ skipGraph: true }])
  })

  it('does not refresh summaries when package prefs make no DB changes', async () => {
    const refreshes = []

    const result = await syncBrowserAssistPackageHidden('VAM', {
      packageIndex: () => new Map([['A.Pkg.1.var', { package_name: 'A.Pkg' }]]),
      readHiddenPrefs: async () => true,
      readCurrentHidden: () => true,
      writeHidden: () => {
        throw new Error('unexpected write')
      },
      refreshStore: (opts) => refreshes.push(opts),
    })

    expect(result).toEqual({ packagesHiddenImported: 0, errors: [] })
    expect(refreshes).toEqual([])
  })

  it('parses BrowserAssist package hidden tag and creator rules', () => {
    const rules = parseBrowserAssistPackageHiddenRules({
      ResourceSettings: {
        'VAR Packages': { hiddenTags: ['hidden', 'hidden:old'] },
        Scene: { hiddenTags: ['hidden:unwanted'] },
      },
      creatorSettings: [
        { creatorName: 'Alice', hiddenResourceTypes: ['VAR Packages'] },
        { creatorName: 'Bob', hiddenResourceTypes: ['Scene'] },
      ],
    })

    expect([...rules.hiddenTags]).toEqual(['hidden', 'hidden:old'])
    expect([...rules.hiddenCreators]).toEqual(['alice'])
    expect([...rules.contentHiddenTagsByResourceType.get('Scene')]).toEqual(['hidden:unwanted'])
    expect([...rules.contentHiddenCreatorsByResourceType.get('Scene')]).toEqual(['bob'])
  })

  it('computes derived package hidden state from BA tag and creator rules', async () => {
    const writes = []
    const result = await syncBrowserAssistDerivedPackageHidden('VAM', {
      packageIndex: () =>
        new Map([
          ['A.Pkg.1.var', { creator: 'Alice' }],
          ['B.Pkg.1.var', { creator: 'Bob' }],
          ['C.Pkg.1.var', { creator: 'Carol' }],
        ]),
      labelsByPackageMap: () =>
        new Map([
          ['A.Pkg.1.var', [1]],
          ['B.Pkg.1.var', [2]],
        ]),
      labelNameById: (id) => ({ 1: 'hidden', 2: 'normal' })[id],
      readRules: async () => ({ hiddenTags: new Set(['hidden']), hiddenCreators: new Set(['bob']) }),
      writeDerived: (map) => writes.push([...map.entries()]),
    })

    expect(result).toEqual({ packagesHiddenDerived: 2, errors: [] })
    expect(writes).toEqual([
      [
        ['A.Pkg.1.var', { hiddenByTag: true, hiddenByCreator: false }],
        ['B.Pkg.1.var', { hiddenByTag: false, hiddenByCreator: true }],
      ],
    ])
  })

  it('writes derived content hidden rules from BA settings', async () => {
    const writes = []
    const result = await syncBrowserAssistDerivedContentHidden('VAM', {
      readRules: async () => ({
        contentHiddenTagsByResourceType: new Map([['Scene', new Set(['hidden:unwanted'])]]),
        contentHiddenCreatorsByResourceType: new Map([['Scene', new Set(['alice'])]]),
      }),
      writeRules: (rules) => writes.push(rules),
    })

    expect(result).toEqual({ contentHiddenDerivedTags: 1, contentHiddenDerivedCreators: 1, errors: [] })
    expect([...writes[0].hiddenTagsByResourceType.get('Scene')]).toEqual(['hidden:unwanted'])
    expect([...writes[0].hiddenCreatorsByResourceType.get('Scene')]).toEqual(['alice'])
  })
})
