import type { BackgroundImage } from '../../shared/background-image-settings'

export type BackgroundImageApi = {
  import: () => Promise<BackgroundImage | null>
  read: (id: string, fileName: string) => Promise<ArrayBuffer | null>
  delete: (id: string, fileName: string) => Promise<void>
}
