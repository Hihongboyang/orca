// SFTP profile CRUD + host-trust-clear IPC (contracts.md) — split from
// sftp-transfer.ts to respect the repo line budget (no max-lines disables).
import { ipcMain } from 'electron'
import { resolve } from 'node:path'
import type { Store } from '../persistence'
import {
  SFTP_PROFILES_CHANNEL,
  SFTP_SAVE_PROFILE_CHANNEL,
  SFTP_DELETE_PROFILE_CHANNEL,
  SFTP_CLEAR_HOST_TRUST_CHANNEL,
  SFTP_PROFILES_CHANGED_CHANNEL,
  type SftpWorkspaceProfile
} from '../../shared/sftp-types'

// Why: keys must be stable across renderer restarts and path spellings.
export const sftpWorkspaceKey = (workspacePath: string): string => resolve(workspacePath)

export function registerSftpProfileHandlers(
  store: Store,
  send: (channel: string, payload: unknown) => void
): void {
  ipcMain.removeHandler(SFTP_PROFILES_CHANNEL)
  ipcMain.handle(SFTP_PROFILES_CHANNEL, (_event, args: { workspacePath: string }) => {
    return store.getSftpProfiles(sftpWorkspaceKey(args.workspacePath))
  })

  ipcMain.removeHandler(SFTP_SAVE_PROFILE_CHANNEL)
  ipcMain.handle(
    SFTP_SAVE_PROFILE_CHANNEL,
    (_event, args: { workspacePath: string; profile: SftpWorkspaceProfile }) => {
      const profile = args.profile
      if (!profile.defaultRemoteDir.startsWith('/')) {
        throw new Error('defaultRemoteDir must be an absolute path starting with /')
      }
      if (!store.getSshTarget(profile.targetId)) {
        throw new Error(`Unknown SSH target: ${profile.targetId}`)
      }
      const key = sftpWorkspaceKey(args.workspacePath)
      const saved = store.saveSftpProfile(key, profile)
      send(SFTP_PROFILES_CHANGED_CHANNEL, store.getSftpProfiles(key))
      return saved
    }
  )

  ipcMain.removeHandler(SFTP_DELETE_PROFILE_CHANNEL)
  ipcMain.handle(
    SFTP_DELETE_PROFILE_CHANNEL,
    (_event, args: { workspacePath: string; profileId: string }) => {
      const key = sftpWorkspaceKey(args.workspacePath)
      store.deleteSftpProfile(key, args.profileId)
      send(SFTP_PROFILES_CHANGED_CHANNEL, store.getSftpProfiles(key))
    }
  )

  ipcMain.removeHandler(SFTP_CLEAR_HOST_TRUST_CHANNEL)
  ipcMain.handle(SFTP_CLEAR_HOST_TRUST_CHANNEL, (_event, args: { hostKey: string }) => {
    store.clearSftpHostTrust(args.hostKey)
  })
}
