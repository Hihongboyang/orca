export const BACKGROUND_IMAGE_OPACITY_MAX = 1

/** Clamp persisted opacity into [0, 1]; non-finite values fall back to fully shown. */
export function normalizeBackgroundImageOpacity(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return BACKGROUND_IMAGE_OPACITY_MAX
  }
  return Math.min(BACKGROUND_IMAGE_OPACITY_MAX, Math.max(0, value))
}

/** User-selected app background image; renderer fetches bytes from main via background-image:read, never learning the on-disk path. */
export type BackgroundImage = {
  id: string
  /** On-disk name `<id>.<ext>` under userData/backgrounds/; extension kept so reads can rebuild the Blob MIME. */
  fileName: string
  mimeType: string
}
