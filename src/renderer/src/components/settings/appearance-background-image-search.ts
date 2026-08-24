import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import type { SettingsSearchEntry } from './settings-search'

/** Stable Settings deep-link / scroll target for the app background image control. */
export const BACKGROUND_IMAGE_SETTING_ID = 'app-background-image'

export const getBackgroundImageEntries = createLocalizedCatalog((): SettingsSearchEntry[] => [
  {
    title: translate('settings.appearance.backgroundImage.title', 'Background Image'),
    description: translate(
      'settings.appearance.backgroundImage.description',
      'Use your own image as the app background.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'settings.appearance.backgroundImage.search.background',
        'background'
      ),
      ...translateSearchKeyword('settings.appearance.backgroundImage.search.image', 'image'),
      ...translateSearchKeyword(
        'settings.appearance.backgroundImage.search.wallpaper',
        'wallpaper'
      ),
      ...translateSearchKeyword('settings.appearance.backgroundImage.search.opacity', 'opacity'),
      // Why: native words for "wallpaper" indexed directly so speakers find the
      // setting whatever the current interface locale is (mirrors language entries).
      '背景',
      '背景图',
      '壁纸',
      '背景画像',
      '壁紙',
      '배경',
      '워터페이퍼',
      'fondo',
      'papel tapiz'
    ]
  }
])
