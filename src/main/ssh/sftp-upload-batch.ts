// Batch upload entry (D9): per-file outcomes, continue-on-failure, clean
// cancel, ignore-skip — extracted from sftp-upload.ts to keep both under the
// repo line budget (no max-lines disables per AGENTS.md).
import { lstat, readdir, realpath } from 'node:fs/promises'
import { join as pathJoin } from 'node:path'
import type { SFTPWrapper } from 'ssh2'
import type { SftpTransferFileOutcome } from '../../shared/sftp-types'
import { assertLocalUploadPathInsideRoot, mkdirSftp } from './sftp-upload'

/** fastPut with concurrent chunk requests — the throughput lever over a
 * single piped stream (RTT-bound). Promise-wrapped for the batch engines. */
function fastPutSftp(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, { concurrency: 16, chunkSize: 32768 }, (err) => {
      if (err) {
        reject(err)
        return
      }
      resolve()
    })
  })
}

/**
 * Why: ssh2's fastPut/fastGet have no AbortSignal support — a big file would
 * hold a "cancelled" transfer hostage until it finishes. Race the signal so
 * cancellation stops WAITING immediately; the session teardown (client.end)
 * then kills the in-flight transfer server-side.
 */
export function raceSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) {
    return promise
  }
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      cleanup()
      reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
    }
    const cleanup = (): void => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (err) => {
        cleanup()
        reject(err)
      }
    )
  })
}

export type SftpUploadBatchOptions = {
  /** Upload-root containment guard root (root-escape assertion). */
  rootRealPath?: string
  signal?: AbortSignal
  /** Upload-ignore parity (D6): return true to skip a local path. */
  shouldSkip?: (localPath: string) => boolean
  onProgress?: (filesDone: number, filesTotal: number, currentPath: string) => void
}

async function countUploadableFiles(
  localDir: string,
  shouldSkip: ((localPath: string) => boolean) | undefined,
  signal?: AbortSignal
): Promise<number> {
  let count = 0
  for (const entry of await readdir(localDir, { withFileTypes: true })) {
    signal?.throwIfAborted()
    if (entry.name === '.git') {
      continue
    }
    const localPath = pathJoin(localDir, entry.name)
    if (shouldSkip?.(localPath) === true) {
      continue
    }
    const statResult = await lstat(localPath)
    if (statResult.isSymbolicLink() || (!statResult.isFile() && !statResult.isDirectory())) {
      continue
    }
    count += statResult.isDirectory()
      ? await countUploadableFiles(localPath, shouldSkip, signal)
      : 1
  }
  return count
}

async function uploadTreeCollecting(
  sftp: SFTPWrapper,
  localDir: string,
  remoteDir: string,
  rootRealPath: string,
  state: { done: number; total: number },
  options: SftpUploadBatchOptions
): Promise<SftpTransferFileOutcome[]> {
  const outcomes: SftpTransferFileOutcome[] = []
  await assertLocalUploadPathInsideRoot(rootRealPath, localDir)
  for (const entry of await readdir(localDir, { withFileTypes: true })) {
    // Why: cancelled batches stop cleanly and keep completed outcomes (D9).
    if (options.signal?.aborted) {
      return outcomes
    }
    const localPath = pathJoin(localDir, entry.name)
    if (options.shouldSkip?.(localPath) === true) {
      continue
    }
    const remotePath = `${remoteDir}/${entry.name}`
    await assertLocalUploadPathInsideRoot(rootRealPath, localPath)
    const statResult = await lstat(localPath)

    // Why: skip symlinks and special files to prevent exfiltration via
    // symlink-following (same guard as uploadDirectory).
    if (statResult.isSymbolicLink() || (!statResult.isFile() && !statResult.isDirectory())) {
      continue
    }

    if (statResult.isDirectory()) {
      // Why: recursive uploads into fresh remote locations fail every nested
      // write with "No such file" unless each subdir is created first (spec:
      // remote mkdir-p semantics). A denied mkdir fails THIS directory only —
      // the batch continues (D9).
      try {
        await mkdirSftp(sftp, remotePath, { allowExisting: true })
      } catch (err) {
        outcomes.push({
          path: localPath,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
        continue
      }
      outcomes.push(
        ...(await uploadTreeCollecting(sftp, localPath, remotePath, rootRealPath, state, options))
      )
    } else {
      // Why: fastPut parallelizes chunk requests; cancel stays effective at
      // file boundaries (state.done reflects completed files).
      const outcome: SftpTransferFileOutcome = await raceSignal(
        fastPutSftp(sftp, localPath, remotePath),
        options.signal
      )
        .then(() => {
          state.done += 1
          return { path: localPath, ok: true as const }
        })
        .catch((err: unknown) => ({
          path: localPath,
          ok: false as const,
          error: err instanceof Error ? err.message : String(err)
        }))
      outcomes.push(outcome)
      options.onProgress?.(state.done, state.total, localPath)
    }
  }
  return outcomes
}

/** mkdir-p the remote parent chain of a remote file path (each segment
 * idempotent — mkdirSftp tolerates "already exists"). */
async function mkdirRemoteParentChain(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  const segments = remotePath.split('/').filter((segment) => segment !== '')
  for (let i = 1; i < segments.length; i += 1) {
    await mkdirSftp(sftp, `/${segments.slice(0, i).join('/')}`, { allowExisting: true })
  }
}

/**
 * Batch upload entry (D9): per-file outcomes, continue-on-failure, clean
 * cancel. Remote root is created with mkdir-p semantics (spec).
 */
export async function uploadLocalTo(
  sftp: SFTPWrapper,
  localPath: string,
  remotePath: string,
  options: SftpUploadBatchOptions = {}
): Promise<SftpTransferFileOutcome[]> {
  const statResult = await lstat(localPath)
  if (statResult.isSymbolicLink() || (!statResult.isFile() && !statResult.isDirectory())) {
    return []
  }
  const rootRealPath = options.rootRealPath ?? (await realpath(localPath))
  if (statResult.isFile()) {
    // Why: a single file whose mirrored remote parent doesn't exist yet (new
    // local subdir) needs the parent chain created or the write fails with
    // "No such file" — mkdir-p each missing segment (idempotent).
    await mkdirRemoteParentChain(sftp, remotePath)
    const outcome = await raceSignal(fastPutSftp(sftp, localPath, remotePath), options.signal)
      .then(() => [{ path: localPath, ok: true as const }] satisfies SftpTransferFileOutcome[])
      .catch((err: unknown) => [
        {
          path: localPath,
          ok: false as const,
          error: err instanceof Error ? err.message : String(err)
        }
      ])
    options.onProgress?.(1, 1, localPath)
    return outcome
  }
  // Why: a denied root mkdir fails the transfer as a single outcome instead
  // of rejecting the whole invoke (D9 continue-and-summarize).
  try {
    await mkdirSftp(sftp, remotePath, { allowExisting: true })
  } catch (err) {
    return [
      {
        path: localPath,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
    ]
  }
  const state = {
    done: 0,
    total: await countUploadableFiles(localPath, options.shouldSkip, options.signal)
  }
  return uploadTreeCollecting(sftp, localPath, remotePath, rootRealPath, state, options)
}
