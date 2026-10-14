// SFTP IPC namespace (contracts.md). Transfer ops run on a dedicated
// short-lived session (D4); typed failures reject with
// `sftp-error:<code>:<message>` so the preload can rebuild SftpTransferError.
import { ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import type { Store } from '../persistence'
import type { SshTarget } from '../../shared/ssh-types'
import {
  SFTP_UPLOAD_CHANNEL,
  SFTP_DOWNLOAD_CHANNEL,
  SFTP_CANCEL_TRANSFER_CHANNEL,
  SFTP_CONFIRM_HOST_KEY_CHANNEL,
  SFTP_TRANSFER_PROGRESS_CHANNEL,
  SFTP_HOST_KEY_REQUIRED_CHANNEL,
  type SftpTransferFileOutcome,
  type SftpTransferProgress,
  type SftpTransferResult,
  type SftpWorkspaceProfile
} from '../../shared/sftp-types'
import { withSftpSession } from '../ssh/sftp-transfer-session'
import { requestCredential } from './ssh-passphrase'
import { uploadLocalTo } from '../ssh/sftp-upload-batch'
import {
  registerSftpCompareHandler,
  registerSftpSaveRemoteHandler,
  toIpcSftpError,
  IpcSftpError
} from './sftp-transfer-compare'
import { registerSftpProfileHandlers, sftpWorkspaceKey } from './sftp-profiles-ipc'
import { downloadRemoteTo } from '../ssh/sftp-download'
import { collectUploadIgnoreSet, isUploadSkippedRelative } from '../ssh/sftp-upload-ignore'
import { resolveRemoteMirrorPath } from '../ssh/sftp-mirror-path'
import type { SFTPWrapper } from 'ssh2'

const PROGRESS_THROTTLE_MS = 150
const HOST_KEY_PROMPT_TIMEOUT_MS = 300_000

export function registerSftpTransferHandlers(
  store: Store,
  getMainWindow: () => BrowserWindow | null
): void {
  const send = (channel: string, payload: unknown): void => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }

  registerSftpProfileHandlers(store, send)

  // ── host-key confirmation detour ──────────────────────────────────

  const pendingHostKeyConfirmations = new Map<
    string,
    { fingerprint: string; resolve: (accepted: boolean) => void }
  >()

  ipcMain.removeHandler(SFTP_CONFIRM_HOST_KEY_CHANNEL)
  ipcMain.handle(
    SFTP_CONFIRM_HOST_KEY_CHANNEL,
    (_event, args: { hostKey: string; fingerprint: string; accepted: boolean }) => {
      const pending = pendingHostKeyConfirmations.get(args.hostKey)
      if (pending && pending.fingerprint === args.fingerprint) {
        pendingHostKeyConfirmations.delete(args.hostKey)
        pending.resolve(args.accepted)
      }
    }
  )

  const confirmHostKey = (hostKey: string, fingerprint: string): Promise<boolean> => {
    return new Promise((resolvePromise) => {
      const timer = setTimeout(() => {
        if (pendingHostKeyConfirmations.delete(hostKey)) {
          resolvePromise(false)
        }
      }, HOST_KEY_PROMPT_TIMEOUT_MS)
      pendingHostKeyConfirmations.set(hostKey, {
        fingerprint,
        resolve: (accepted: boolean) => {
          clearTimeout(timer)
          if (accepted) {
            // Why: persist here as well as in the session verifier — the store
            // write is idempotent, and the IPC layer owns trust persistence
            // even if the session layer is exercised separately.
            store.setSftpHostTrust(hostKey, fingerprint)
          }
          resolvePromise(accepted)
        }
      })
      send(SFTP_HOST_KEY_REQUIRED_CHANNEL, { hostKey, fingerprint })
    })
  }

  // Why: same prompt + remember flow as terminal connections (D3 parity) —
  // SFTP ops on a not-yet-remembered target prompt inline instead of failing.
  const makeCredentialRequest =
    (targetId: string) =>
    async (kind: 'password' | 'passphrase', detail: string): Promise<string | null> => {
      const answer = await requestCredential(getMainWindow, targetId, kind, detail)
      if (answer.remember && answer.value) {
        store.updateSshTarget(
          targetId,
          kind === 'password'
            ? { rememberedPassword: answer.value }
            : { rememberedPassphrase: answer.value }
        )
      }
      return answer.value
    }

  // ── transfer lifecycle ────────────────────────────────────────────

  const activeTransfers = new Map<string, AbortController>()

  ipcMain.removeHandler(SFTP_CANCEL_TRANSFER_CHANNEL)
  ipcMain.handle(SFTP_CANCEL_TRANSFER_CHANNEL, (_event, args: { transferId: string }) => {
    activeTransfers.get(args.transferId)?.abort()
  })

  const resolveProfile = (workspacePath: string, profileId: string): SftpWorkspaceProfile => {
    const profile = store
      .getSftpProfiles(sftpWorkspaceKey(workspacePath))
      .find((candidate) => candidate.id === profileId)
    if (!profile) {
      throw new IpcSftpError('profile-not-found', `No SFTP profile ${profileId}`)
    }
    return profile
  }

  const requireTarget = (profile: SftpWorkspaceProfile): SshTarget => {
    const target = store.getSshTarget(profile.targetId)
    if (!target) {
      throw new IpcSftpError(
        'profile-not-found',
        `Profile "${profile.label}" references a removed SSH target`
      )
    }
    return target
  }

  const runTransfer = async (
    args: {
      workspacePath: string
      profileId: string
      localPath: string
      requestId?: string
      /** Pre-registered transfer (controller minted before a long prepare
       * phase so Cancel is live during the ignore scan, not just the wire). */
      prepared?: { transferId: string; controller: AbortController }
      prepare?: (options: {
        signal: AbortSignal
        target: SshTarget
        profile: SftpWorkspaceProfile
      }) => Promise<void>
    },
    run: (options: {
      sftp: SFTPWrapper
      signal: AbortSignal
      remotePath: string
      onProgress: (filesDone: number, filesTotal: number, currentPath: string) => void
    }) => Promise<SftpTransferFileOutcome[]>
  ): Promise<SftpTransferResult> => {
    const profile = resolveProfile(args.workspacePath, args.profileId)
    const target = requireTarget(profile)
    const remotePath = await resolveRemoteMirrorPath(profile, args.localPath).catch(toIpcSftpError)
    if (remotePath instanceof Error) {
      throw remotePath
    }

    const transferId = args.prepared?.transferId ?? randomUUID()
    const controller = args.prepared?.controller ?? new AbortController()
    activeTransfers.set(transferId, controller)
    if (args.prepare) {
      await args.prepare({ signal: controller.signal, target, profile })
      if (controller.signal.aborted) {
        return { transferId, cancelled: true, outcomes: [] }
      }
    }
    let lastProgressAt = 0
    const emitProgress = (progress: Omit<SftpTransferProgress, 'requestId'>): void => {
      const now = Date.now()
      // Why: 'connecting' is always emitted (single event) and never gates the
      // first 'transferring'; subsequent transferrings throttle.
      if (progress.phase === 'connecting' || now - lastProgressAt >= PROGRESS_THROTTLE_MS) {
        if (progress.phase === 'transferring') {
          lastProgressAt = now
        }
        send(SFTP_TRANSFER_PROGRESS_CHANNEL, {
          ...progress,
          ...(args.requestId ? { requestId: args.requestId } : {})
        })
      }
    }

    emitProgress({
      transferId,
      phase: 'connecting',
      filesDone: 0,
      filesTotal: 0,
      currentPath: args.localPath
    })

    try {
      const outcomes = await withSftpSession(
        target,
        {
          hostTrustStore: store,
          confirmHostKey,
          onCredentialRequest: makeCredentialRequest(target.id)
        },
        (sftp) =>
          run({
            sftp,
            signal: controller.signal,
            remotePath,
            onProgress: (filesDone, filesTotal, currentPath) =>
              emitProgress({
                transferId,
                phase: 'transferring',
                filesDone,
                filesTotal,
                currentPath
              })
          })
      ).catch(toIpcSftpError)
      if (outcomes instanceof Error) {
        throw outcomes
      }
      // Why: per-file failures resolve normally — surface them in the dev log
      // or a failed transfer is undiagnosable from the terminal.
      const failures = outcomes.filter((outcome) => !outcome.ok)
      if (failures.length > 0) {
        const detail = failures.map((o) => `${o.path}: ${o.error}`).join('\n')
        console.error(
          `[sftp] transfer ${transferId} (${target.label}, root ${remotePath}) — ${failures.length} failure(s):\n${detail}`
        )
      }
      return { transferId, cancelled: controller.signal.aborted, outcomes }
    } finally {
      activeTransfers.delete(transferId)
    }
  }

  ipcMain.removeHandler(SFTP_UPLOAD_CHANNEL)
  ipcMain.handle(
    SFTP_UPLOAD_CHANNEL,
    async (
      _event,
      args: {
        workspacePath: string
        profileId: string
        localPath: string
        requestId?: string
      }
    ): Promise<SftpTransferResult> => {
      const profile = resolveProfile(args.workspacePath, args.profileId)
      // Why: Cancel must be live DURING the ignore scan too — the controller
      // is minted and registered before the prepare phase, not after it.
      const prepared = { transferId: randomUUID(), controller: new AbortController() }
      let ignored: Set<string> | null = null
      const shouldSkip = (localPath: string): boolean => {
        if (localPath.split(/[\\/]/).pop() === '.git') {
          return true
        }
        if (!ignored) {
          return false
        }
        const rel = localPath.slice(profile.localRoot.length + 1)
        return isUploadSkippedRelative(rel, ignored)
      }
      return runTransfer(
        {
          ...args,
          prepared,
          prepare: async ({ signal }) => {
            // Why: only directory uploads need the gitignore consult — a single
            // right-clicked file pays the scan for nothing.
            const isDirectoryUpload = await stat(args.localPath)
              .then((info) => info.isDirectory())
              .catch(() => false)
            if (!isDirectoryUpload) {
              return
            }
            // Why: walk the SELECTED subtree, not the whole repo — root-relative
            // queries keep gitignore matching correct (D6 scope).
            ignored = await collectUploadIgnoreSet(profile.localRoot, {
              signal,
              scanRoot: args.localPath
            })
          }
        },
        ({ sftp, signal, remotePath, onProgress }) =>
          uploadLocalTo(sftp, args.localPath, remotePath, {
            signal,
            onProgress,
            shouldSkip
          })
      )
    }
  )

  ipcMain.removeHandler(SFTP_DOWNLOAD_CHANNEL)
  ipcMain.handle(
    SFTP_DOWNLOAD_CHANNEL,
    async (
      _event,
      args: {
        workspacePath: string
        profileId: string
        localPath: string
        requestId?: string
      }
    ): Promise<SftpTransferResult> => {
      return runTransfer(args, ({ sftp, signal, remotePath, onProgress }) =>
        downloadRemoteTo(sftp, remotePath, args.localPath, { signal, onProgress })
      )
    }
  )

  // ── compare + save-back (compare dialog) ───────────────────────────
  const compareWiring = {
    store,
    confirmHostKey,
    makeCredentialRequest,
    resolveProfile,
    requireTarget,
    toIpcSftpError
  }
  registerSftpCompareHandler(compareWiring)
  registerSftpSaveRemoteHandler(compareWiring)
}
