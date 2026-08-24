// Remote → local download engine (D7/D11): copy semantics — creates missing
// local parents, overwrites via OS trash, never deletes local extras, skips
// remote symlinks, preserves no permissions/mtimes. Continue-and-summarize (D9).
import { mkdir, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { dirname, join as pathJoin, resolve as pathResolve } from 'node:path'
import { finished } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import { shell } from 'electron'
import type { SFTPWrapper } from 'ssh2'
import type { SftpTransferFileOutcome } from '../../shared/sftp-types'
import { raceSignal } from './sftp-upload-batch'

type SftpAttrs = {
  isDirectory: () => boolean
  isSymbolicLink: () => boolean
  isFile: () => boolean
}

type RemoteEntry = { filename: string; attrs?: SftpAttrs }

export type SftpDownloadOptions = {
  signal?: AbortSignal
  onProgress?: (filesDone: number, filesTotal: number, currentPath: string) => void
}

function lstatSftp(sftp: SFTPWrapper, path: string): Promise<SftpAttrs> {
  return new Promise((resolve, reject) => {
    sftp.lstat(path, (err, attrs) => {
      if (err) {
        reject(err)
        return
      }
      resolve(attrs as unknown as SftpAttrs)
    })
  })
}

function readdirSftp(sftp: SFTPWrapper, dir: string): Promise<RemoteEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(dir, (err, entries) => {
      if (err) {
        reject(err)
        return
      }
      resolve((entries ?? []) as unknown as RemoteEntry[])
    })
  })
}

async function countRemoteFiles(sftp: SFTPWrapper, remotePath: string): Promise<number> {
  const attrs = await lstatSftp(sftp, remotePath)
  if (!attrs.isDirectory()) {
    return 1
  }
  let count = 0
  for (const entry of await readdirSftp(sftp, remotePath)) {
    const child = `${remotePath.replace(/\/+$/, '')}/${entry.filename}`
    const childAttrs = entry.attrs ?? (await lstatSftp(sftp, child).catch(() => null))
    if (!childAttrs) {
      continue
    }
    if (childAttrs.isSymbolicLink()) {
      continue
    }
    count += childAttrs.isDirectory() ? await countRemoteFiles(sftp, child) : 1
  }
  return count
}

async function trashExistingLocalFile(localPath: string): Promise<'absent' | 'trashed'> {
  try {
    await stat(localPath)
  } catch {
    return 'absent'
  }
  // Why: trash first so an interrupted overwrite never destroys the old copy;
  // a trash failure means the file stays untouched (D7).
  await shell.trashItem(localPath)
  return 'trashed'
}

/**
 * ssh2's teardown (cleanupRequests → ReadStream emit('error')) can fire after
 * finished()'s cleanup removed its listeners — a bare emit throws and kills
 * main. Every sftp-origin stream gets this persistent guard; real failures
 * still reject through finished()/pipe.
 */
export function attachPersistentStreamErrorGuard(stream: {
  on: (event: string, fn: () => void) => void
}): void {
  stream.on('error', () => {})
}

/** Piped single-stream fallback (with persistent error guards) for SFTP
 * servers that reject fastGet's call shape (e.g. concurrent positioned reads). */
async function pipeRemoteToLocal(
  sftp: SFTPWrapper,
  remotePath: string,
  localPath: string
): Promise<void> {
  await mkdir(dirname(localPath), { recursive: true })
  const remoteStream = sftp.createReadStream(remotePath) as unknown as Readable
  const localStream = createWriteStream(localPath)
  attachPersistentStreamErrorGuard(remoteStream)
  attachPersistentStreamErrorGuard(localStream)
  const readDone = finished(remoteStream, { cleanup: true }).catch((error: unknown) => {
    localStream.destroy()
    throw error
  })
  const writeDone = finished(localStream, { cleanup: true }).catch((error: unknown) => {
    if (!remoteStream.destroyed) {
      remoteStream.destroy()
    }
    throw error
  })
  remoteStream.pipe(localStream)
  const results = await Promise.allSettled([readDone, writeDone])
  const failure = results.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') {
    throw failure.reason
  }
}

/**
 * Layered file download: fastGet(16 concurrent) → fastGet(1 sequential —
 * servers that choke on out-of-order reads) → piped stream (different call
 * shape entirely). EPERM/EBUSY/EACCES also retry with backoff — Windows
 * delete-pending after trashItem fails the same-name open transiently.
 */
async function fastGetWithRetry(
  sftp: SFTPWrapper,
  remotePath: string,
  localPath: string,
  signal?: AbortSignal
): Promise<void> {
  const backoffMs = [150, 400]
  const attempts: (() => Promise<void>)[] = [
    () => fastGetOnce(sftp, remotePath, localPath, 16),
    () => fastGetOnce(sftp, remotePath, localPath, 1),
    () => pipeRemoteToLocal(sftp, remotePath, localPath)
  ]
  let lastError: unknown
  for (const attempt of attempts) {
    for (let tryIndex = 0; ; tryIndex += 1) {
      try {
        await raceSignal(attempt(), signal)
        return
      } catch (err) {
        lastError = err
        const code = (err as { code?: string }).code
        const transient = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
        if (transient && tryIndex < backoffMs.length) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs[tryIndex]))
          continue
        }
        break
      }
    }
  }
  throw lastError
}

function fastGetOnce(
  sftp: SFTPWrapper,
  remotePath: string,
  localPath: string,
  concurrency: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.fastGet(remotePath, localPath, { concurrency, chunkSize: 32768 }, (err) => {
      if (err) {
        reject(err)
        return
      }
      resolve()
    })
  })
}

async function downloadFileWithOutcome(
  sftp: SFTPWrapper,
  remotePath: string,
  localPath: string,
  state: { done: number; total: number },
  signal?: AbortSignal
): Promise<SftpTransferFileOutcome> {
  try {
    // Why: 'absent' | 'trashed' both proceed to write; trash failure throws
    // and is recorded as a failed file, leaving the local copy untouched (D7).
    await trashExistingLocalFile(localPath)
    // Why: fastGet parallelizes chunk requests — the throughput lever over a
    // single piped stream (RTT-bound); the signal race also cancels mid-file.
    await fastGetWithRetry(sftp, remotePath, localPath, signal)
    state.done += 1
    return { path: localPath, ok: true }
  } catch (err) {
    return {
      path: localPath,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

async function downloadDirectoryInto(
  sftp: SFTPWrapper,
  remoteDir: string,
  localDir: string,
  state: { done: number; total: number },
  options: SftpDownloadOptions
): Promise<SftpTransferFileOutcome[]> {
  const outcomes: SftpTransferFileOutcome[] = []
  const entries = await readdirSftp(sftp, remoteDir)
  await mkdir(localDir, { recursive: true })
  const normalizedRemote = remoteDir.replace(/\/+$/, '')
  for (const entry of entries) {
    // Why: cancelled batches stop cleanly and keep completed outcomes (D9).
    if (options.signal?.aborted) {
      return outcomes
    }
    const remotePath = `${normalizedRemote}/${entry.filename}`
    const localPath = pathJoin(localDir, entry.filename)
    const attrs = entry.attrs ?? (await lstatSftp(sftp, remotePath).catch(() => null))
    if (!attrs) {
      outcomes.push({ path: localPath, ok: false, error: `Cannot stat ${remotePath}` })
      continue
    }
    if (attrs.isSymbolicLink()) {
      continue
    }
    if (attrs.isDirectory()) {
      outcomes.push(...(await downloadDirectoryInto(sftp, remotePath, localPath, state, options)))
    } else {
      const outcome = await downloadFileWithOutcome(
        sftp,
        remotePath,
        localPath,
        state,
        options.signal
      )
      outcomes.push(outcome)
      options.onProgress?.(state.done, state.total, remotePath)
    }
  }
  return outcomes
}

/**
 * Downloads a remote file or directory tree to a local path.
 * Copy semantics: local extras are never removed (D11); overwritten local
 * files go through the OS trash first (D7).
 */
export async function downloadRemoteTo(
  sftp: SFTPWrapper,
  remotePath: string,
  rawLocalPath: string,
  options: SftpDownloadOptions = {}
): Promise<SftpTransferFileOutcome[]> {
  // Why: renderer paths arrive with forward slashes on Windows; Chromium's
  // shell.trashItem parses only native separators and throws
  // 'Failed to parse path'. Normalize once at the engine boundary.
  const localPath = pathResolve(rawLocalPath)
  const rootAttrs = await lstatSftp(sftp, remotePath)
  if (rootAttrs.isSymbolicLink()) {
    return []
  }
  const state = { done: 0, total: await countRemoteFiles(sftp, remotePath) }
  if (rootAttrs.isDirectory()) {
    return downloadDirectoryInto(sftp, remotePath, localPath, state, options)
  }
  options.onProgress?.(0, 1, remotePath)
  return [await downloadFileWithOutcome(sftp, remotePath, localPath, state, options.signal)]
}
