import { describe, expect, it } from 'vitest'
import { browserAssistCategory, browserAssistUserTagNames, mergeBrowserAssistUserTags } from './browser-assist.js'

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
})
