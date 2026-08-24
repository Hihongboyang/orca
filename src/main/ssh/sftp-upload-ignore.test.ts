import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { collectUploadIgnoreSet, isUploadSkippedRelative } from './sftp-upload-ignore'

let repoRoot: string
let plainRoot: string

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

describe('isUploadSkippedRelative prefix semantics', () => {
  it('skips anything under an ignored directory, not just exact matches', () => {
    const ignored = new Set(['node_modules', 'src/node_modules', 'secret.txt'])
    expect(isUploadSkippedRelative('node_modules', ignored)).toBe(true)
    expect(isUploadSkippedRelative('node_modules/pkg/index.js', ignored)).toBe(true)
    expect(isUploadSkippedRelative('node_modules-evil/escape.txt', ignored)).toBe(false)
    expect(isUploadSkippedRelative('src/node_modules/x', ignored)).toBe(true)
    expect(isUploadSkippedRelative('src/main.ts', ignored)).toBe(false)
  })
})

describe('collectUploadIgnoreSet', () => {
  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'sftp-ign-'))
    git(['init', '--quiet'], repoRoot)
    writeFileSync(join(repoRoot, '.gitignore'), 'node_modules/\nsecret.txt\n')
    writeFileSync(join(repoRoot, 'secret.txt'), 'x')
    writeFileSync(join(repoRoot, 'main.ts'), 'x')
    writeFileSync(join(repoRoot, 'tracked.txt'), 'x')
    git(['add', 'tracked.txt'], repoRoot)
    mkdirSync(join(repoRoot, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(repoRoot, 'node_modules', 'pkg', 'index.js'), 'x')
    mkdirSync(join(repoRoot, '.git', 'hooks'), { recursive: true })

    plainRoot = mkdtempSync(join(tmpdir(), 'sftp-ign-plain-'))
    writeFileSync(join(plainRoot, 'file.txt'), 'x')
  })

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true })
    rmSync(plainRoot, { recursive: true, force: true })
  })

  it('collects gitignored paths with .git never enumerated', async () => {
    const ignored = await collectUploadIgnoreSet(repoRoot)

    expect(isUploadSkippedRelative('secret.txt', ignored)).toBe(true)
    expect(isUploadSkippedRelative('node_modules', ignored)).toBe(true)
    expect(isUploadSkippedRelative(join('node_modules', 'pkg', 'index.js'), ignored)).toBe(true)
    // Why: .git is hardcoded-skip territory — it must not appear in the set at
    // all (it is never enumerated), and nothing under it is either.
    expect([...ignored].every((p) => !p.split(/[\\/]/).includes('.git'))).toBe(true)
    expect(isUploadSkippedRelative('main.ts', ignored)).toBe(false)
    expect(isUploadSkippedRelative('tracked.txt', ignored)).toBe(false)
  })

  it('degrades to an empty set outside a git repo', async () => {
    const ignored = await collectUploadIgnoreSet(plainRoot)
    expect(ignored.size).toBe(0)
    expect(isUploadSkippedRelative('file.txt', ignored)).toBe(false)
  })
})
