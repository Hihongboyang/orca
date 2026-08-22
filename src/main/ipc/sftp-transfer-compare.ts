// sftp:compare handler (contracts.md) — split from sftp-transfer.ts to respect
// the repo line budget (no max-lines disables per AGENTS.md).
import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import type { Store } from '../persistence'
import type { SshTarget } from '../../shared/ssh-types'
import {
  SFTP_COMPARE_MAX_BYTES,
  type SftpTransferErrorCode,
  type SftpWorkspaceProfile
} from '../../shared/sftp-types'
import { withSftpSession } from '../ssh/sftp-transfer-session'
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
  toIpcError: (err: unknown) => Error
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
    toIpcError
  } = args
  const profile = resolveProfile(args.workspacePath, args.profileId)
  const target = requireTarget(profile)
  const remotePath = await resolveRemoteMirrorPath(profile, args.localPath).catch(toIpcError)
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
      }).catch(toIpcError)
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
  ).catch(toIpcError)
  if (content instanceof Error) {
    throw content
  }
  if (content.includes(0)) {
    throw new IpcSftpError('compare-binary-refused', 'Binary compare is not supported')
  }
  return { content: content.toString('utf-8') }
}
