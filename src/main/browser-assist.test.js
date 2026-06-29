import { describe, expect, it } from 'vitest'
import {
  applyBrowserAssistPackageHidden,
  browserAssistCategory,
  browserAssistUserTagNames,
  mergeBrowserAssistUserTags,
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
})
