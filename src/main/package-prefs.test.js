import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { mkTempVamDir } from '../../test/fixtures/index.js'
import { packagePrefsPath, readPackageHiddenPrefs, writePackageHiddenPref } from './package-prefs.js'

describe('package-prefs', () => {
  it('reads missing package prefs as null', async () => {
    const tmp = await mkTempVamDir()
    try {
      await expect(readPackageHiddenPrefs(tmp.vamDir, 'A.Pkg')).resolves.toBe(null)
    } finally {
      await tmp.cleanup()
    }
  })

  it('preserves unknown fields when writing explicit hidden state', async () => {
    const tmp = await mkTempVamDir()
    try {
      const p = packagePrefsPath(tmp.vamDir, 'A.Pkg')
      await mkdir(join(tmp.vamDir, 'AddonPackagesUserPrefs'), { recursive: true })
      await writeFile(p, JSON.stringify({ customOptions: { preloadMorphs: true } }, null, 2))

      await writePackageHiddenPref(tmp.vamDir, 'A.Pkg', false)

      const json = JSON.parse(await readFile(p, 'utf8'))
      expect(json.customOptions.preloadMorphs).toBe(true)
      expect(json.hidden).toBe(false)
    } finally {
      await tmp.cleanup()
    }
  })
})
