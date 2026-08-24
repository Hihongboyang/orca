import { useEffect, useState } from 'react'
import { ImagePlus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import type { GlobalSettings } from '../../../../shared/types'
import { normalizeBackgroundImageOpacity } from '../../../../shared/types'
import { useAppStore } from '../../store'
import { Button } from '../ui/button'
import { SearchableSetting } from './SearchableSetting'
import { SettingsRow } from './SettingsFormControls'
import {
  clearAppBackgroundImageCache,
  peekAppBackgroundImageUrl,
  readAppBackgroundImageUrl
} from '../background-image/use-app-background-image-style'
import {
  getBackgroundImageEntries,
  BACKGROUND_IMAGE_SETTING_ID
} from './appearance-background-image-search'
import { TERMINAL_BACKGROUND_OPACITY_SETTING_ID } from './terminal-window-setup-search'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'

type BackgroundImageSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  forceVisible?: boolean
}

export function BackgroundImageSetting({
  settings,
  updateSettings,
  forceVisible = false
}: BackgroundImageSettingProps): React.JSX.Element | null {
  // Why: bytes live in local userData — the web/mobile client can never render
  // the image, so hide the row instead of offering a dead control.
  if (isWebClientLocation()) {
    return null
  }

  const image = settings.backgroundImage
  const entry = getBackgroundImageEntries()[0]
  const opacity = normalizeBackgroundImageOpacity(settings.backgroundImageOpacity)

  async function handleImport(): Promise<void> {
    try {
      const model = await window.api.backgroundImage.import()
      if (!model) {
        return
      }
      // Why: revoke the previous blob so a replaced image can't flash back from cache.
      clearAppBackgroundImageCache()
      updateSettings({ backgroundImage: model })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate('settings.appearance.backgroundImage.importFailed', 'Failed to import image')
      )
    }
  }

  function handleRemove(): void {
    if (image) {
      void window.api.backgroundImage.delete(image.id, image.fileName)
    }
    clearAppBackgroundImageCache()
    updateSettings({ backgroundImage: undefined })
  }

  return (
    <SearchableSetting
      id={BACKGROUND_IMAGE_SETTING_ID}
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords ?? []}
      forceVisible={forceVisible}
    >
      {image ? (
        <div className="divide-y divide-border/40">
          <SettingsRow
            label={
              <span className="block max-w-[280px] truncate" title={image.fileName}>
                {image.fileName}
              </span>
            }
            alignTop
            control={<CurrentBackgroundThumbnail image={image} />}
          />
          <SettingsRow
            label={translate('settings.appearance.backgroundImage.opacityLabel', 'Image Opacity')}
            control={
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(opacity * 100)}
                  onChange={(e) =>
                    updateSettings({ backgroundImageOpacity: Number(e.target.value) / 100 })
                  }
                  className="w-36"
                  aria-label={translate(
                    'settings.appearance.backgroundImage.opacityLabel',
                    'Image Opacity'
                  )}
                />
                <span className="w-9 text-right tabular-nums">{Math.round(opacity * 100)}%</span>
              </label>
            }
          />
          {(settings.terminalBackgroundOpacity ?? 1) >= 1 ? (
            <div className="flex items-start gap-1.5 px-1 py-2 text-xs text-muted-foreground">
              <span>
                {translate(
                  'settings.appearance.backgroundImage.terminalHint',
                  'Terminals are opaque by default, so the image only shows outside them.'
                )}
              </span>
              <button
                type="button"
                className="cursor-pointer underline underline-offset-2 hover:text-foreground"
                onClick={() =>
                  useAppStore.getState().openSettingsTarget({
                    pane: 'appearance',
                    repoId: null,
                    sectionId: TERMINAL_BACKGROUND_OPACITY_SETTING_ID
                  })
                }
              >
                {translate(
                  'settings.appearance.backgroundImage.terminalHintLink',
                  'Lower terminal background opacity'
                )}
              </button>
            </div>
          ) : null}
          <div className="flex justify-end gap-2 py-2">
            <Button variant="outline" size="sm" onClick={() => void handleImport()}>
              <Pencil aria-hidden="true" />
              {translate('settings.appearance.backgroundImage.change', 'Change Image…')}
            </Button>
            <Button variant="outline" size="sm" onClick={handleRemove}>
              <Trash2 aria-hidden="true" />
              {translate('settings.appearance.backgroundImage.remove', 'Remove')}
            </Button>
          </div>
        </div>
      ) : (
        <SettingsRow
          label={entry.title}
          control={
            <Button variant="outline" size="sm" onClick={() => void handleImport()}>
              <ImagePlus aria-hidden="true" />
              {translate('settings.appearance.backgroundImage.choose', 'Choose Image…')}
            </Button>
          }
        />
      )}
    </SearchableSetting>
  )
}

function CurrentBackgroundThumbnail({
  image
}: {
  image: GlobalSettings['backgroundImage']
}): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(() =>
    image ? peekAppBackgroundImageUrl(image.id) : null
  )

  useEffect(() => {
    if (!image) {
      setUrl(null)
      return
    }
    const peeked = peekAppBackgroundImageUrl(image.id)
    if (peeked) {
      setUrl(peeked)
      return
    }
    let cancelled = false
    void readAppBackgroundImageUrl(image).then((loaded) => {
      if (!cancelled) {
        setUrl(loaded)
      }
    })
    return () => {
      cancelled = true
    }
  }, [image])

  return (
    <div className="flex items-center gap-2">
      <div className="h-12 w-20 shrink-0 overflow-hidden rounded-md border border-border/60 bg-muted/40">
        {url ? (
          <img
            src={url}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : null}
      </div>
    </div>
  )
}
