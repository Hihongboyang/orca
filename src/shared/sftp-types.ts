// ─── SFTP File Transfer Types ───────────────────────────────────────
// Contract home for the add-sftp-file-transfer change; shapes come from
// openspec/changes/add-sftp-file-transfer/contracts.md. Changing anything
// here requires a design.md decision record first.

// --- invoke channels (renderer → main) ---
export const SFTP_PROFILES_CHANNEL = 'sftp:profiles'
export const SFTP_SAVE_PROFILE_CHANNEL = 'sftp:save-profile'
export const SFTP_DELETE_PROFILE_CHANNEL = 'sftp:delete-profile'
export const SFTP_UPLOAD_CHANNEL = 'sftp:upload'
export const SFTP_DOWNLOAD_CHANNEL = 'sftp:download'
export const SFTP_COMPARE_CHANNEL = 'sftp:compare'
export const SFTP_SAVE_REMOTE_CHANNEL = 'sftp:save-remote'
export const SFTP_CANCEL_TRANSFER_CHANNEL = 'sftp:cancel-transfer'
export const SFTP_CONFIRM_HOST_KEY_CHANNEL = 'sftp:confirm-host-key'
export const SFTP_CLEAR_HOST_TRUST_CHANNEL = 'sftp:clear-host-trust'

// --- event channels (main → renderer) ---
export const SFTP_PROFILES_CHANGED_CHANNEL = 'sftp:profiles-changed'
export const SFTP_TRANSFER_PROGRESS_CHANNEL = 'sftp:transfer-progress'
export const SFTP_HOST_KEY_REQUIRED_CHANNEL = 'sftp:host-key-required'

// --- persistence keys (src/main/persistence.ts) ---
export const SFTP_PROFILES_PERSISTENCE_KEY = 'sftp-profiles'
export const SFTP_HOST_TRUST_PERSISTENCE_KEY = 'sftp-host-trust'

// --- profiles (D1/D2: mapping only; connections come from SshTarget) ---
export type SftpWorkspaceProfile = {
  /** uuid, stable across renames. */
  id: string
  label: string
  /** Existing SshTarget id (D1). */
  targetId: string
  /** Absolute local path. */
  localRoot: string
  /** Absolute POSIX path, validated at save (D10). */
  defaultRemoteDir: string
}

/** Key: normalized workspace path (D2). */
export type SftpProfilesByWorkspace = Record<string, SftpWorkspaceProfile[]>

/** 'host:port' → SHA256 fingerprint, hex (D5). */
export type SftpHostTrustStore = Record<string, string>

// --- transfer lifecycle ---
export type SftpTransferId = string

export type SftpTransferProgress = {
  transferId: SftpTransferId
  /** Echoes the invoke's requestId (D14 renderer-side correlation). */
  requestId?: string
  phase: 'connecting' | 'transferring'
  filesDone: number
  filesTotal: number
  currentPath: string
}

export type SftpTransferFileOutcome =
  | { path: string; ok: true }
  | { path: string; ok: false; error: string }

/** Per-file outcomes: continue-and-summarize (D9). */
export type SftpTransferResult = {
  transferId: SftpTransferId
  cancelled: boolean
  outcomes: SftpTransferFileOutcome[]
}

export type SftpTransferErrorCode =
  | 'profile-not-found'
  | 'outside-local-root' // strict per-profile matching (D10)
  | 'host-key-mismatch' // hard-block (D5)
  | 'host-key-rejected'
  | 'system-ssh-only-transport' // GSSAPI / exotic ProxyCommand (spec)
  | 'compare-file-too-large' // > 10 MB (D8)
  | 'compare-binary-refused' // (D8)
  | 'trash-unavailable' // overwrite guard failed (D7)

export const SFTP_TRANSFER_ERROR_CODES = [
  'profile-not-found',
  'outside-local-root',
  'host-key-mismatch',
  'host-key-rejected',
  'system-ssh-only-transport',
  'compare-file-too-large',
  'compare-binary-refused',
  'trash-unavailable'
] as const satisfies readonly SftpTransferErrorCode[]

export type SftpTransferError = {
  code: SftpTransferErrorCode
  message: string
}

/** Feeds the read-only DiffViewer compare tab (D8). */
export type SftpCompareResult = {
  content: string
}

/** Save-back payload for the compare dialog's edited remote pane. */
export type SftpSaveRemoteArgs = {
  workspacePath: string
  profileId: string
  localPath: string
  content: string
}

export type SftpSaveRemoteResult = {
  bytesWritten: number
}

/** Remote read cap for compare, in bytes (D8). */
export const SFTP_COMPARE_MAX_BYTES = 10 * 1024 * 1024
