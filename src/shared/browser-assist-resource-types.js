export const BA_VAR_PACKAGES_TYPE = 'VAR Packages'

export const BA_RESOURCE_TYPE_ID_TO_NAME = new Map([
  ['1', 'Scene'],
  ['2', 'Preset Appearance'],
  ['5', 'Preset Clothing'],
  ['8', 'Preset Hair'],
  ['11', 'Preset Pose'],
  ['12', 'Preset Skin'],
  ['15', 'Plugins'],
  ['17', 'SubScenes'],
  ['18', 'Clothing (Female)'],
  ['19', 'Clothing (Male)'],
  ['20', 'Custom Unity Assets'],
  ['21', 'Clothing Item Presets'],
  ['22', 'Scene & Session Plugin Presets'],
  ['23', 'Audio'],
  ['24', 'Hair (Female)'],
  ['25', 'Hair (Male)'],
  ['26', 'Hair Item Presets'],
  ['27', BA_VAR_PACKAGES_TYPE],
])

export function normalizeBrowserAssistResourceType(value) {
  if (value == null) return null
  const s = String(value).trim()
  return BA_RESOURCE_TYPE_ID_TO_NAME.get(s) || s || null
}

export function browserAssistResourceTypesForContent(internalPath, exactType) {
  const p = String(internalPath || '').replace(/\\/g, '/')
  if (exactType === 'scene' || exactType === 'legacyScene') return ['Scene']
  if (exactType === 'subscene') return ['SubScenes']
  if (exactType === 'look' || exactType === 'legacyLook') return ['Preset Appearance']
  if (exactType === 'skinPreset') return ['Preset Skin']
  if (exactType === 'pose' || exactType === 'legacyPose') return ['Preset Pose']
  if (exactType === 'clothingPreset') return ['Preset Clothing']
  if (exactType === 'hairPreset') return ['Preset Hair']
  if (exactType === 'clothingItem') return ['Clothing (Female)', 'Clothing (Male)', 'Clothing Item Presets']
  if (exactType === 'hairItem') return ['Hair (Female)', 'Hair (Male)', 'Hair Item Presets']
  if (exactType === 'pluginPreset') return ['Scene & Session Plugin Presets']
  if (exactType === 'pluginScript' || exactType === 'scriptList') return ['Plugins']
  if (exactType === 'assetbundle') return ['Custom Unity Assets']
  if (exactType === 'audio') return ['Audio']
  if (/^Saves\/scene\//i.test(p)) return ['Scene']
  return []
}
