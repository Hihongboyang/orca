import { ipcRenderer } from 'electron'
import type { BackgroundImage } from '../../shared/background-image-settings'
import type { BackgroundImageApi } from './background-image-api'

export const backgroundImageApi = {
  import: (): Promise<BackgroundImage | null> => ipcRenderer.invoke('background-image:import'),
  read: (id: string, fileName: string): Promise<ArrayBuffer | null> =>
    ipcRenderer.invoke('background-image:read', id, fileName),
  delete: (id: string, fileName: string): Promise<void> =>
    ipcRenderer.invoke('background-image:delete', id, fileName)
} satisfies BackgroundImageApi
