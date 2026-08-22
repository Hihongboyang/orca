// Upload ignore parity (D6): what the file explorer hides, upload skips.
// One `git ls-files --others --ignored --exclude-standard --directory` call
// per upload — git itself lists ignored entries with directories collapsed,
// so a 50k-file node_modules costs one line, not a walk. Folder workspaces
// without git degrade to .git-only skipping. `.git` is never enumerated.
import { sep } from 'node:path'
import { gitExecFileAsync } from '../git/runner'

// Why: ls-files/--others/--ignored/--exclude-standard/--directory/-z all date
// to Git 1.x — no capability gating needed for the 2.25 baseline (AGENTS.md).
const LS_FILES_IGNORED_ARGS = [
  'ls-files',
  '--others',
  '--ignored',
  '--exclude-standard',
  '--directory',
  '-z'
] as const

export async function collectUploadIgnoreSet(
  localRoot: string,
  options?: { signal?: AbortSignal; scanRoot?: string }
): Promise<Set<string>> {
  const scanRoot = options?.scanRoot ?? localRoot
  options?.signal?.throwIfAborted()
  try {
    const { stdout } = await gitExecFileAsync([...LS_FILES_IGNORED_ARGS, '--', scanRoot], {
      cwd: localRoot,
      signal: options?.signal,
      maxBuffer: 16 * 1024 * 1024
    })
    options?.signal?.throwIfAborted()
    // Why: -z separates by NUL; ls-files prints repo-root-relative entries,
    // with ignored directories collapsed and trailing '/'-terminated.
    const ignored = new Set<string>()
    for (const entry of stdout.split('\0')) {
      const trimmed = entry.replace(/\/+$/, '')
      if (trimmed !== '') {
        ignored.add(trimmed.split(sep).join('/'))
      }
    }
    return ignored
  } catch {
    // Why: non-git folder workspace (exit 128 'not a git repository') or a git
    // failure — degrade to .git-only skipping (D6).
    return new Set()
  }
}

export function isUploadSkippedRelative(relPath: string, ignored: Set<string>): boolean {
  const segments = relPath.split(/[\\/]/)
  // Why: an ignored DIRECTORY prunes its whole subtree (ls-files collapses
  // them) — check the path itself and every ancestor prefix.
  for (let i = segments.length; i >= 1; i -= 1) {
    if (ignored.has(segments.slice(0, i).join('/'))) {
      return true
    }
  }
  return false
}
