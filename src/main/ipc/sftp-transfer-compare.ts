// sftp:compare + sftp:save-remote handlers (contracts.md) — split from
// sftp-transfer.ts to respect the repo line budget (no max-lines disables
// per AGENTS.md).
import { ipcMain } from 'electron'
import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { Readable, Writable } from 'node:stream'
import { finished } from 'node:stream/promises'
import type { Store } from '../persistence'
import type { SshTarget } from '../../shared/ssh-types'
import {
  SFTP_COMPARE_CHANNEL,
  SFTP_COMPARE_MAX_BYTES,
  SFTP_SAVE_REMOTE_CHANNEL,
  type SftpSaveRemoteArgs,
  type SftpTransferErrorCode,
  type SftpWorkspaceProfile
} from '../../shared/sftp-types'
import { withSftpSession, SftpTransferSessionError } from '../ssh/sftp-transfer-session'
import { resolveRemoteMirrorPath } from '../ssh/sftp-mirror-path'
import { attachPersistentStreamErrorGuard } from '../ssh/sftp-download'

const BINARY_SNIFF_BYTES = 8192

export class IpcSftpError extends Error {
  constructor(
    readonly code: SftpTransferErrorCode,
    message: string
  ) {
    super(`sftp-error:${code}:${message}`)
  }
}

/** Map session errors onto the wire `sftp-error:<code>:<message>` contract. */
export function toIpcSftpError(err: unknown): Error {
  if (err instanceof SftpTransferSessionError) {
    return new IpcSftpError(err.code, err.message)
  }
  return err instanceof Error ? err : new Error(String(err))
}

async function isLocalFileBinary(localPath: string): Promise<boolean> {
  try {
    const handle = await open(localPath, constants.O_RDONLY)
    try {
      const buffer = Buffer.alloc(BINARY_SNIFF_BYTES)
      const { bytesRead } = await handle.read(buffer, 0, BINARY_SNIFF_BYTES, 0)
      return buffer.subarray(0, bytesRead).includes(0)
    } finally {
      await handle.close()
    }
  } catch {
    return false
  }
}

export async function runSftpCompare(args: {
  store: Store
  confirmHostKey: (hostKey: string, fingerprint: string) => Promise<boolean>
  makeCredentialRequest: (
    targetId: string
  ) => (kind: 'password' | 'passphrase', detail: string) => Promise<string | null>
  resolveProfile: (workspacePath: string, profileId: string) => SftpWorkspaceProfile
  requireTarget: (profile: SftpWorkspaceProfile) => SshTarget
  toIpcSftpError: (err: unknown) => Error
  workspacePath: string
  profileId: string
  localPath: string
}): Promise<{ content: string }> {
  const {
    store,
    confirmHostKey,
    makeCredentialRequest,
    resolveProfile,
    requireTarget,
    toIpcSftpError
  } = args
  const profile = resolveProfile(args.workspacePath, args.profileId)
  const target = requireTarget(profile)
  const remotePath = await resolveRemoteMirrorPath(profile, args.localPath).catch(toIpcSftpError)
  if (remotePath instanceof Error) {
    throw remotePath
  }

  if (await isLocalFileBinary(args.localPath)) {
    throw new IpcSftpError('compare-binary-refused', 'Binary compare is not supported')
  }

  const content = await withSftpSession(
    target,
    {
      hostTrustStore: store,
      confirmHostKey,
      onCredentialRequest: makeCredentialRequest(target.id)
    },
    async (sftp) => {
      const size = await new Promise<number>((resolveSize, reject) => {
        sftp.lstat(remotePath, (err, attrs) => {
          if (err) {
            reject(err)
            return
          }
          resolveSize((attrs as { size?: number }).size ?? 0)
        })
      }).catch(toIpcSftpError)
      if (size instanceof Error) {
        throw size
      }
      if (size > SFTP_COMPARE_MAX_BYTES) {
        throw new IpcSftpError(
          'compare-file-too-large',
          `Remote file is ${size} bytes; compare is capped at ${SFTP_COMPARE_MAX_BYTES} bytes — download it instead`
        )
      }
      const chunks: Buffer[] = []
      const stream = sftp.createReadStream(remotePath) as unknown as Readable
      // Why: persistent listener — late ssh2 teardown emits must not throw uncaught.
      attachPersistentStreamErrorGuard(stream)
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      await finished(stream, { cleanup: true })
      return Buffer.concat(chunks)
    }
  ).catch(toIpcSftpError)
  if (content instanceof Error) {
    throw content
  }
  if (content.includes(0)) {
    throw new IpcSftpError('compare-binary-refused', 'Binary compare is not supported')
  }
  return { content: content.toString('utf-8') }
}

/** Save-back (add-sftp-compare-edit D2): truncate-write the compare dialog's
 * edited remote pane to the mirror path on a dedicated short-lived session. */
export async function runSftpSaveRemote(args: {
  store: Store
  confirmHostKey: (hostKey: string, fingerprint: string) => Promise<boolean>
  makeCredentialRequest: (
    targetId: string
  ) => (kind: 'password' | 'passphrase', detail: string) => Promise<string | null>
  resolveProfile: (workspacePath: string, profileId: string) => SftpWorkspaceProfile
  requireTarget: (profile: SftpWorkspaceProfile) => SshTarget
  toIpcSftpError: (err: unknown) => Error
  workspacePath: string
  profileId: string
  localPath: string
  content: string
}): Promise<{ bytesWritten: number }> {
  const {
    store,
    confirmHostKey,
    makeCredentialRequest,
    resolveProfile,
    requireTarget,
    toIpcSftpError
  } = args
  const profile = resolveProfile(args.workspacePath, args.profileId)
  const target = requireTarget(profile)
  const remotePath = await resolveRemoteMirrorPath(profile, args.localPath).catch(toIpcSftpError)
  if (remotePath instanceof Error) {
    throw remotePath
  }

  const payload = Buffer.from(args.content, 'utf-8')
  if (payload.byteLength > SFTP_COMPARE_MAX_BYTES) {
    throw new IpcSftpError(
      'compare-file-too-large',
      `Edited content is ${payload.byteLength} bytes; save-back is capped at ${SFTP_COMPARE_MAX_BYTES} bytes`
    )
  }

  const written = await withSftpSession(
    target,
    {
      hostTrustStore: store,
      confirmHostKey,
      onCredentialRequest: makeCredentialRequest(target.id)
    },
    async (sftp) => {
      const stream = sftp.createWriteStream(remotePath) as unknown as Writable
      // Why: persistent listener — late ssh2 teardown emits must not throw uncaught.
      attachPersistentStreamErrorGuard(stream)
      // Why: ssh2 createWriteStream defaults to O_WRONLY|O_CREAT|O_TRUNC — the
      // write replaces the remote file, matching upload overwrite semantics.
      stream.end(payload)
      await finished(stream, { cleanup: true })
      return payload.byteLength
    }
  ).catch(toIpcSftpError)
  if (written instanceof Error) {
    throw written
  }
  return { bytesWritten: written }
}

/** Registers the compare IPC handler (called from registerSftpTransferHandlers). */
export function registerSftpCompareHandler(wiring: {
  store: Store
  confirmHostKey: (hostKey: string, fingerprint: string) => Promise<boolean>
  makeCredentialRequest: (
    targetId: string
  ) => (kind: 'password' | 'passphrase', detail: string) => Promise<string | null>
  resolveProfile: (workspacePath: string, profileId: string) => SftpWorkspaceProfile
  requireTarget: (profile: SftpWorkspaceProfile) => SshTarget
  toIpcSftpError: (err: unknown) => Error
}): void {
  ipcMain.removeHandler(SFTP_COMPARE_CHANNEL)
  ipcMain.handle(
    SFTP_COMPARE_CHANNEL,
    (_event, args: { workspacePath: string; profileId: string; localPath: string }) =>
      runSftpCompare({
        ...wiring,
        workspacePath: args.workspacePath,
        profileId: args.profileId,
        localPath: args.localPath
      })
  )
}

/** Registers the save-back IPC handler (called from registerSftpTransferHandlers). */
export function registerSftpSaveRemoteHandler(wiring: {
  store: Store
  confirmHostKey: (hostKey: string, fingerprint: string) => Promise<boolean>
  makeCredentialRequest: (
    targetId: string
  ) => (kind: 'password' | 'passphrase', detail: string) => Promise<string | null>
  resolveProfile: (workspacePath: string, profileId: string) => SftpWorkspaceProfile
  requireTarget: (profile: SftpWorkspaceProfile) => SshTarget
  toIpcSftpError: (err: unknown) => Error
}): void {
  ipcMain.removeHandler(SFTP_SAVE_REMOTE_CHANNEL)
  ipcMain.handle(SFTP_SAVE_REMOTE_CHANNEL, (_event, args: SftpSaveRemoteArgs) =>
    runSftpSaveRemote({
      ...wiring,
      workspacePath: args.workspacePath,
      profileId: args.profileId,
      localPath: args.localPath,
      content: args.content
    })
  )
}
