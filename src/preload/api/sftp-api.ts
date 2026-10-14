// SFTP transfer API surface (contracts.md): per-workspace profiles, transfer
// ops with requestId correlation, host-key TOFU dialogs, progress events.
import type {
  SftpCompareResult,
  SftpTransferProgress,
  SftpTransferResult,
  SftpWorkspaceProfile
} from '../../shared/sftp-types'

export type SftpApi = {
  listProfiles: (args: { workspacePath: string }) => Promise<SftpWorkspaceProfile[]>
  saveProfile: (args: {
    workspacePath: string
    profile: SftpWorkspaceProfile
  }) => Promise<SftpWorkspaceProfile>
  deleteProfile: (args: { workspacePath: string; profileId: string }) => Promise<void>
  upload: (args: {
    workspacePath: string
    profileId: string
    localPath: string
    requestId?: string
  }) => Promise<SftpTransferResult>
  download: (args: {
    workspacePath: string
    profileId: string
    localPath: string
    requestId?: string
  }) => Promise<SftpTransferResult>
  compare: (args: {
    workspacePath: string
    profileId: string
    localPath: string
  }) => Promise<SftpCompareResult>
  saveRemote: (args: {
    workspacePath: string
    profileId: string
    localPath: string
    content: string
  }) => Promise<{ bytesWritten: number }>
  cancelTransfer: (args: { transferId: string }) => Promise<void>
  confirmHostKey: (args: {
    hostKey: string
    fingerprint: string
    accepted: boolean
  }) => Promise<void>
  clearHostTrust: (args: { hostKey: string }) => Promise<void>
  onProfilesChanged: (callback: (profiles: SftpWorkspaceProfile[]) => void) => () => void
  onTransferProgress: (callback: (progress: SftpTransferProgress) => void) => () => void
  onHostKeyRequired: (
    callback: (request: { hostKey: string; fingerprint: string }) => void
  ) => () => void
}
