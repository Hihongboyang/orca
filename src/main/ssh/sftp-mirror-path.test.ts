import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { mapLocalToRemote, resolveRemoteMirrorPath } from './sftp-mirror-path'
import { SftpTransferSessionError } from './sftp-transfer-session'

let root: string
let sibling: string

function createLocalTree(): void {
  root = mkdtempSync(join(tmpdir(), 'sftp-mirror-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'main.ts'), 'export {}\n')
  sibling = mkdtempSync(join(tmpdir(), 'sftp-mirror-other-'))
}

async function withPlatform<T>(platform: NodeJS.Platform, fn: () => Promise<T>): Promise<T> {
  const original = process.platform
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
  try {
    return await fn()
  } finally {
    Object.defineProperty(process, 'platform', { configurable: true, value: original })
  }
}

describe('resolveRemoteMirrorPath', () => {
  beforeEach(createLocalTree)
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(sibling, { recursive: true, force: true })
  })

  it('maps a nested file under localRoot to the mirrored remote path', async () => {
    const remote = await resolveRemoteMirrorPath(
      { localRoot: root, defaultRemoteDir: '/srv/app' },
      join(root, 'src', 'main.ts')
    )
    expect(remote).toBe('/srv/app/src/main.ts')
  })

  it('maps the localRoot itself to defaultRemoteDir', async () => {
    const remote = await resolveRemoteMirrorPath(
      { localRoot: root, defaultRemoteDir: '/srv/app/' },
      root
    )
    expect(remote).toBe('/srv/app')
  })

  it('accepts forward-slash input on Windows (separator boundary)', async () => {
    const withForwardSlashes = join(root, 'src', 'main.ts').split(sep).join('/')
    const remote = await resolveRemoteMirrorPath(
      { localRoot: root, defaultRemoteDir: '/srv/app' },
      withForwardSlashes
    )
    expect(remote).toBe('/srv/app/src/main.ts')
  })

  it('rejects a path outside the profile localRoot with outside-local-root', async () => {
    await expect(
      resolveRemoteMirrorPath(
        { localRoot: root, defaultRemoteDir: '/srv/app' },
        join(sibling, 'elsewhere.txt')
      )
    ).rejects.toMatchObject({ code: 'outside-local-root' })
  })

  it('rejects prefix-sibling lookalikes (root-2 vs root)', async () => {
    const lookalike = `${root}-lookalike/escape.txt`
    mkdirSync(`${root}-lookalike`, { recursive: true })
    writeFileSync(lookalike, 'x')
    try {
      await expect(
        resolveRemoteMirrorPath({ localRoot: root, defaultRemoteDir: '/srv/app' }, lookalike)
      ).rejects.toMatchObject({ code: 'outside-local-root' })
    } finally {
      rmSync(`${root}-lookalike`, { recursive: true, force: true })
    }
  })

  it('is case-insensitive on Windows-style platforms', async () => {
    if (sep !== '\\') {
      // Why: case-insensitive containment needs a case-insensitive fs to have a
      // realpath to compare; only meaningful on a Windows runner.
      return
    }
    await withPlatform('win32', async () => {
      const remote = await resolveRemoteMirrorPath(
        { localRoot: root, defaultRemoteDir: '/srv/app' },
        join(root.toUpperCase(), 'src', 'main.ts')
      )
      expect(remote).toBe('/srv/app/src/main.ts')
    })
  })

  it('pure containment is case-sensitive when folding is off', () => {
    // Why: win32 realpath canonicalizes case, so case-divergent roots are only
    // testable against the pure mapping core, not through the fs.
    expect(
      mapLocalToRemote('C:\\Dev\\Project', 'c:\\dev\\project\\src\\main.ts', '/srv', false)
    ).toBeNull()
    expect(
      mapLocalToRemote('C:\\Dev\\Project', 'C:\\Dev\\Project\\src\\main.ts', '/srv', false)
    ).toBe('/srv/src/main.ts')
  })

  it('pure containment folds case when requested', () => {
    expect(
      mapLocalToRemote('C:\\Dev\\Project', 'c:\\dev\\PROJECT\\src\\main.ts', '/srv', true)
    ).toBe('/srv/src/main.ts')
  })

  it('surfaces the typed error for nonexistent paths', async () => {
    const error = await resolveRemoteMirrorPath(
      { localRoot: root, defaultRemoteDir: '/srv/app' },
      join(sibling, 'does-not-exist.txt')
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SftpTransferSessionError)
  })
})
