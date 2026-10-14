import { ipcRenderer } from 'electron'
import type { SftpTransferProgress, SftpWorkspaceProfile } from '../../shared/sftp-types'
import type { SftpApi } from './sftp-api'

export const sftpApi = {
  listProfiles: (args: { workspacePath: string }) => ipcRenderer.invoke('sftp:profiles', args),
  saveProfile: (args: { workspacePath: string; profile: SftpWorkspaceProfile }) =>
    ipcRenderer.invoke('sftp:save-profile', args),
  deleteProfile: (args: { workspacePath: string; profileId: string }) =>
    ipcRenderer.invoke('sftp:delete-profile', args),
  upload: (args: {
    workspacePath: string
    profileId: string
    localPath: string
    requestId?: string
  }) => ipcRenderer.invoke('sftp:upload', args),
  download: (args: {
    workspacePath: string
    profileId: string
    localPath: string
    requestId?: string
  }) => ipcRenderer.invoke('sftp:download', args),
  compare: (args: { workspacePath: string; profileId: string; localPath: string }) =>
    ipcRenderer.invoke('sftp:compare', args),
  cancelTransfer: (args: { transferId: string }) =>
    ipcRenderer.invoke('sftp:cancel-transfer', args),
  confirmHostKey: (args: { hostKey: string; fingerprint: string; accepted: boolean }) =>
    ipcRenderer.invoke('sftp:confirm-host-key', args),
  clearHostTrust: (args: { hostKey: string }) => ipcRenderer.invoke('sftp:clear-host-trust', args),
  onProfilesChanged: (callback: (profiles: SftpWorkspaceProfile[]) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      profiles: SftpWorkspaceProfile[]
    ): void => {
      callback(profiles)
    }
    ipcRenderer.on('sftp:profiles-changed', listener)
    return () => ipcRenderer.removeListener('sftp:profiles-changed', listener)
  },
  onTransferProgress: (callback: (progress: SftpTransferProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: SftpTransferProgress): void => {
      callback(progress)
    }
    ipcRenderer.on('sftp:transfer-progress', listener)
    return () => ipcRenderer.removeListener('sftp:transfer-progress', listener)
  },
  onHostKeyRequired: (callback: (request: { hostKey: string; fingerprint: string }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      request: { hostKey: string; fingerprint: string }
    ): void => {
      callback(request)
    }
    ipcRenderer.on('sftp:host-key-required', listener)
    return () => ipcRenderer.removeListener('sftp:host-key-required', listener)
  }
} satisfies SftpApi
