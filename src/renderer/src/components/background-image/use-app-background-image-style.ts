import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { BackgroundImage } from '../../../../shared/types'
import { normalizeBackgroundImageOpacity } from '../../../../shared/types'
import { useAppStore } from '../../store'
import { isWebClientLocation } from '@/lib/web-client-location'

// Why: single-entry cache shared with the settings row's thumbnail so switching
// between the row and the app root never re-fetches the bytes from main.
let cached: { id: string; url: string } | null = null
let pendingLoad: Promise<string | null> | null = null
const healedIds = new Set<string>()

function loadBackgroundBlobUrl(image: BackgroundImage): Promise<string | null> {
  if (cached?.id === image.id) {
    return Promise.resolve(cached.url)
  }
  if (!pendingLoad) {
    pendingLoad = (async () => {
      try {
        const buffer = await window.api.backgroundImage.read(image.id, image.fileName)
        if (!buffer) {
          return null
        }
        // Why: MIME from BackgroundImage.mimeType — blob URLs render wrong-MIME images as downloads, not images.
        const blob = new Blob([buffer], { type: image.mimeType })
        const url = URL.createObjectURL(blob)
        if (cached) {
          URL.revokeObjectURL(cached.url)
        }
        cached = { id: image.id, url }
        return url
      } catch {
        return null
      } finally {
        pendingLoad = null
      }
    })()
  }
  return pendingLoad
}

/** Drop the cached blob URL (remove/replace flows) so a stale image can't flash back. */
export function clearAppBackgroundImageCache(): void {
  if (cached) {
    URL.revokeObjectURL(cached.url)
    cached = null
  }
}

/** Resolve the current background's blob URL, loading it if needed (settings-row thumbnail). */
export function readAppBackgroundImageUrl(image: BackgroundImage): Promise<string | null> {
  return loadBackgroundBlobUrl(image)
}

/** Peek the cached URL without loading (synchronous first paint after cache exists). */
export function peekAppBackgroundImageUrl(id: string): string | null {
  return cached?.id === id ? cached.url : null
}

/**
 * Resolve the app background image into a root-element style. Returns undefined
 * (solid color) when no image is set, bytes are unavailable, or on web/mobile
 * clients where the local userData bytes don't exist.
 */
export function useAppBackgroundImageStyle(): CSSProperties | undefined {
  const backgroundImage = useAppStore((state) => state.settings?.backgroundImage ?? null)
  const opacitySetting = useAppStore((state) => state.settings?.backgroundImageOpacity)
  const [url, setUrl] = useState<string | null>(() =>
    backgroundImage ? peekAppBackgroundImageUrl(backgroundImage.id) : null
  )

  useEffect(() => {
    if (!backgroundImage || isWebClientLocation()) {
      setUrl(null)
      return
    }
    const peeked = peekAppBackgroundImageUrl(backgroundImage.id)
    if (peeked) {
      setUrl(peeked)
      return
    }
    setUrl(null)
    let cancelled = false
    void loadBackgroundBlobUrl(backgroundImage).then((loaded) => {
      if (cancelled) {
        return
      }
      if (loaded) {
        setUrl(loaded)
        return
      }
      // Why self-heal: a missing file (deleted userData, disk issue) must not
      // leave a dangling setting that shows "set" forever — clear it once per id.
      if (!healedIds.has(backgroundImage.id)) {
        healedIds.add(backgroundImage.id)
        void useAppStore.getState().updateSettings({ backgroundImage: undefined })
      }
    })
    return () => {
      cancelled = true
    }
  }, [backgroundImage])

  if (!backgroundImage || !url || isWebClientLocation()) {
    return undefined
  }
  const veilPercent = Math.round((1 - normalizeBackgroundImageOpacity(opacitySetting)) * 100)
  // Why the veil: CSS can't set opacity on a background image alone; a flat
  // color-mix gradient of the base color at (1 - opacity) stacked over the
  // image reproduces "image at N% over the solid background", and var(--background)
  // keeps it theme-aware with zero re-renders.
  const veil = `linear-gradient(color-mix(in srgb, var(--background) ${veilPercent}%, transparent), color-mix(in srgb, var(--background) ${veilPercent}%, transparent))`
  return { backgroundImage: `${veil}, url(${url})` }
}
