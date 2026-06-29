import { describe, expect, it } from 'vitest'
import {
  applyBrowserAssistPackageHidden,
  browserAssistCategory,
  browserAssistUserTagNames,
  mergeBrowserAssistUserTags,
  parseBrowserAssistPackageHiddenRules,
  syncBrowserAssistDerivedContentHidden,
  syncBrowserAssistDerivedPackageHidden,
  syncBrowserAssistPackageHidden,
} from './browser-assist.js'

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
