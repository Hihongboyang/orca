// localRoot ↔ defaultRemoteDir mirror resolution (D10): realpath
// normalization, platform-appropriate case sensitivity, separator boundary at
// the mapping edge. Strict to the selected profile — no auto-switching.
import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join as pathJoin, resolve, sep } from 'node:path'
import type { SftpWorkspaceProfile } from '../../shared/sftp-types'
import { SftpTransferSessionError } from './sftp-transfer-session'

const isCaseInsensitivePlatform = (): boolean =>
  process.platform === 'win32' || process.platform === 'darwin'

// Why: win32 realpath can return extended-length prefixed paths; normalize away.
function stripExtendedPrefix(p: string): string {
  return p.startsWith('\\\\?\\') ? p.slice(4) : p
}

function normalizeSeparators(p: string): string {
  return resolve(p)
}

/** realpath with ENOENT tolerance: resolve the deepest existing ancestor. */
async function realpathBestEffort(p: string): Promise<string> {
  try {
    return stripExtendedPrefix(await realpath(normalizeSeparators(p)))
  } catch {
    const parent = dirname(normalizeSeparators(p))
    if (parent === p) {
      throw new SftpTransferSessionError('outside-local-root', `Path is not resolvable: ${p}`)
    }
    const parentReal = stripExtendedPrefix(await realpath(parent))
    // Why: rebuild from the real parent so the unresolved remainder keeps its
    // original casing (download targets may not exist yet).
    return pathJoin(parentReal, p.split(/[\\/]/).findLast((segment) => segment !== '') ?? '')
  }
}

function stripTrailingSeparator(p: string): string {
  return p.length > 1 && (p.endsWith('/') || p.endsWith('\\')) ? p.slice(0, -1) : p
}

export type SftpMirrorProfile = Pick<SftpWorkspaceProfile, 'localRoot' | 'defaultRemoteDir'>

/**
 * Pure containment + mapping core over already-realpath'd inputs.
 * Returns the mirrored remote path, or null when pathReal is outside rootReal.
 */
export function mapLocalToRemote(
  rootReal: string,
  pathReal: string,
  remoteDir: string,
  caseInsensitive: boolean
): string | null {
  const root = stripTrailingSeparator(rootReal)
  const path = stripTrailingSeparator(pathReal)
  const fold = (p: string): string => (caseInsensitive ? p.toLowerCase() : p)
  // Why: containment check on folded forms; the original-case remainder is
  // derived by prefix length so remote names keep their casing.
  const foldedRoot = fold(root)
  const foldedPath = fold(path)
  const contained =
    foldedPath === foldedRoot || foldedPath.startsWith(foldedRoot + (sep === '\\' ? '\\' : '/'))
  if (!contained) {
    return null
  }
  const remote = stripTrailingSeparator(remoteDir)
  if (foldedPath === foldedRoot) {
    return remote
  }
  const remainder = path.slice(root.length + 1)
  // Why: separator boundary — local separators never leak into remote paths.
  return `${remote}/${remainder.split(sep).join('/')}`
}

/**
 * Mirrored remote path for a local path under the profile's localRoot.
 * Throws SftpTransferSessionError('outside-local-root') when not contained.
 */
export async function resolveRemoteMirrorPath(
  profile: SftpMirrorProfile,
  localPath: string
): Promise<string> {
  const rootReal = await realpathBestEffort(profile.localRoot)
  const pathReal = await realpathBestEffort(localPath)

  const mapped = mapLocalToRemote(
    rootReal,
    pathReal,
    profile.defaultRemoteDir,
    isCaseInsensitivePlatform()
  )
  if (mapped === null) {
    throw new SftpTransferSessionError(
      'outside-local-root',
      `"${localPath}" is not under the profile's localRoot "${profile.localRoot}"`
    )
  }
  return mapped
}

/** Local containment check without mapping (used by IPC boundary validation). */
export async function isPathInsideLocalRoot(
  profile: SftpMirrorProfile,
  localPath: string
): Promise<boolean> {
  try {
    await resolveRemoteMirrorPath(profile, localPath)
    return true
  } catch {
    return false
  }
}

export { isAbsolute }
