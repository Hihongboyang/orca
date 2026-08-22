import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import type { SFTPWrapper } from 'ssh2'
import type { SftpTransferFileOutcome } from '../../shared/sftp-types'

const { trashItemMock, trashFails } = vi.hoisted(() => ({
  trashItemMock: vi.fn().mockResolvedValue(undefined),
  trashFails: { current: false }
}))

vi.mock('electron', () => ({
  shell: {
    trashItem: (...args: unknown[]) => {
      if (trashFails.current) {
        return Promise.reject(new Error('no trash backend'))
      }
      return trashItemMock(...args)
    }
  }
}))

import { attachPersistentStreamErrorGuard, downloadRemoteTo } from './sftp-download'

type RemoteNode = { type: 'file' | 'dir' | 'symlink'; content?: string; children?: string[] }
type RemoteTree = Record<string, RemoteNode>

/** Minimal SFTPWrapper fake over an in-memory remote tree. */
function fakeSftp(tree: RemoteTree): SFTPWrapper {
  const nodeAt = (p: string): RemoteNode | undefined => {
    const normalized = p.replace(/\/+$/, '') || '/'
    return tree[normalized]
  }
  return {
    lstat: (p: string, cb: (err: Error | null, attrs?: unknown) => void) => {
      const node = nodeAt(p)
      if (!node) {
        cb(Object.assign(new Error('ENOENT'), { code: 2 }))
        return
      }
      cb(null, {
        isDirectory: () => node.type === 'dir',
        isSymbolicLink: () => node.type === 'symlink',
        isFile: () => node.type === 'file'
      })
    },
    readdir: (p: string, cb: (err: Error | null, entries?: unknown[]) => void) => {
      const node = nodeAt(p)
      if (!node || node.type !== 'dir') {
        cb(Object.assign(new Error('ENOENT'), { code: 2 }))
        return
      }
      cb(
        null,
        (node.children ?? []).map((name) => {
          const child = nodeAt(`${p.replace(/\/+$/, '')}/${name}`)!
          return {
            filename: name,
            attrs: {
              isDirectory: () => child.type === 'dir',
              isSymbolicLink: () => child.type === 'symlink',
              isFile: () => child.type === 'file'
            }
          }
        })
      )
    },
    fastGet: (
      remotePath: string,
      localPath: string,
      _opts: unknown,
      cb: (err: Error | null) => void
    ) => {
      const node = nodeAt(remotePath)
      if (!node || node.type !== 'file') {
        cb(Object.assign(new Error('ENOENT'), { code: 2 }))
        return
      }
      mkdirSync(dirname(localPath), { recursive: true })
      writeFileSync(localPath, node.content ?? '')
      cb(null)
    },
    createReadStream: (p: string) => {
      const node = nodeAt(p)
      if (!node || node.type !== 'file') {
        const stream = new Readable()
        stream.destroy(new Error('ENOENT'))
        return stream
      }
      return Readable.from([Buffer.from(node.content ?? '')])
    }
  } as unknown as SFTPWrapper
}

let localRoot: string

describe('downloadRemoteTo', () => {
  beforeEach(() => {
    localRoot = mkdtempSync(join(tmpdir(), 'sftp-dl-'))
    trashItemMock.mockClear()
    trashFails.current = false
  })
  afterEach(() => {
    rmSync(localRoot, { recursive: true, force: true })
  })

  it('recursively downloads a remote directory with local mkdir -p', async () => {
    const sftp = fakeSftp({
      '/srv': {
        type: 'dir',
        children: ['app', 'app.txt']
      },
      '/srv/app': { type: 'dir', children: ['nested'] },
      '/srv/app/nested': { type: 'dir', children: ['deep.txt'] },
      '/srv/app.txt': { type: 'file', content: 'top' },
      '/srv/app/nested/deep.txt': { type: 'file', content: 'deep' }
    })

    const outcomes = await downloadRemoteTo(sftp, '/srv', join(localRoot, 'srv'))

    expect(readFileSync(join(localRoot, 'srv', 'app.txt'), 'utf-8')).toBe('top')
    expect(readFileSync(join(localRoot, 'srv', 'app', 'nested', 'deep.txt'), 'utf-8')).toBe('deep')
    expect(outcomes.filter((o) => o.ok)).toHaveLength(2)
  })

  it('skips remote symlinks', async () => {
    const sftp = fakeSftp({
      '/srv': { type: 'dir', children: ['real.txt', 'link'] },
      '/srv/real.txt': { type: 'file', content: 'x' },
      '/srv/link': { type: 'symlink' }
    })

    const outcomes = await downloadRemoteTo(sftp, '/srv', join(localRoot, 'srv'))

    expect(readFileSync(join(localRoot, 'srv', 'real.txt'), 'utf-8')).toBe('x')
    expect(existsSync(join(localRoot, 'srv', 'link'))).toBe(false)
    expect(outcomes).toHaveLength(1)
  })

  it('never deletes local files that have no remote counterpart', async () => {
    const localDir = join(localRoot, 'srv')
    mkdirSync(join(localDir, 'extra'), { recursive: true })
    writeFileSync(join(localDir, 'extra', 'local-only.txt'), 'precious')

    const sftp = fakeSftp({
      '/srv': { type: 'dir', children: ['remote.txt'] },
      '/srv/remote.txt': { type: 'file', content: 'r' }
    })
    await downloadRemoteTo(sftp, '/srv', localDir)

    expect(readFileSync(join(localDir, 'extra', 'local-only.txt'), 'utf-8')).toBe('precious')
  })

  it('moves an overwritten local file to the OS trash first', async () => {
    const localDir = join(localRoot, 'srv')
    mkdirSync(localDir, { recursive: true })
    writeFileSync(join(localDir, 'file.txt'), 'old')

    const sftp = fakeSftp({
      '/srv': { type: 'dir', children: ['file.txt'] },
      '/srv/file.txt': { type: 'file', content: 'new' }
    })
    await downloadRemoteTo(sftp, '/srv', localDir)

    expect(trashItemMock).toHaveBeenCalledWith(join(localDir, 'file.txt'))
    expect(readFileSync(join(localDir, 'file.txt'), 'utf-8')).toBe('new')
  })

  it('reports the file failed and leaves it untouched when trash is unavailable', async () => {
    const localDir = join(localRoot, 'srv')
    mkdirSync(localDir, { recursive: true })
    writeFileSync(join(localDir, 'file.txt'), 'old')

    const sftp = fakeSftp({
      '/srv': { type: 'dir', children: ['file.txt', 'fresh.txt'] },
      '/srv/file.txt': { type: 'file', content: 'new' },
      '/srv/fresh.txt': { type: 'file', content: 'fresh' }
    })
    trashFails.current = true

    const outcomes: SftpTransferFileOutcome[] = await downloadRemoteTo(sftp, '/srv', localDir)

    // Why: the overwrite target is left exactly as it was; the batch continues.
    expect(readFileSync(join(localDir, 'file.txt'), 'utf-8')).toBe('old')
    expect(readFileSync(join(localDir, 'fresh.txt'), 'utf-8')).toBe('fresh')
    const failed = outcomes.find((o) => !o.ok)
    expect(failed?.path).toContain('file.txt')
    expect(failed?.ok).toBe(false)
  })

  it('downloads a single remote file to the mirrored local file', async () => {
    const sftp = fakeSftp({
      '/srv/alone.txt': { type: 'file', content: 'solo' }
    })
    const outcomes = await downloadRemoteTo(sftp, '/srv/alone.txt', join(localRoot, 'alone.txt'))
    expect(readFileSync(join(localRoot, 'alone.txt'), 'utf-8')).toBe('solo')
    expect(outcomes).toHaveLength(1)
  })
})

describe('downloadRemoteTo batch semantics', () => {
  beforeEach(() => {
    localRoot = mkdtempSync(join(tmpdir(), 'sftp-dl-batch-'))
    trashItemMock.mockClear()
    trashFails.current = false
  })
  afterEach(() => {
    rmSync(localRoot, { recursive: true, force: true })
  })

  it('continues after a per-file failure mid-batch', async () => {
    const sftp = fakeSftp({
      '/srv': { type: 'dir', children: ['good1.txt', 'bad.txt', 'good2.txt'] },
      '/srv/good1.txt': { type: 'file', content: 'a' },
      '/srv/bad.txt': { type: 'file', content: 'b' },
      '/srv/good2.txt': { type: 'file', content: 'c' }
    })
    // Why: break one file's transfer on EVERY layer (fastGet and stream) —
    // capture the originals before overriding.
    const holder = sftp as unknown as {
      fastGet: (r: string, l: string, o: unknown, cb: (e: Error | null) => void) => void
      createReadStream: (p: string) => Readable
    }
    const originalFastGet = holder.fastGet.bind(sftp)
    const originalCreateReadStream = holder.createReadStream.bind(sftp)
    holder.fastGet = (remotePath, localPath, opts, cb) => {
      if (remotePath === '/srv/bad.txt') {
        cb(new Error('read failed at offset'))
        return
      }
      originalFastGet(remotePath, localPath, opts, cb)
    }
    holder.createReadStream = (p: string) => {
      if (p === '/srv/bad.txt') {
        const stream = new Readable()
        stream.destroy(new Error('read failed at offset'))
        return stream
      }
      return originalCreateReadStream(p)
    }

    const outcomes = await downloadRemoteTo(sftp, '/srv', join(localRoot, 'srv'))

    expect(outcomes).toHaveLength(3)
    expect(outcomes.filter((o) => o.ok)).toHaveLength(2)
    expect(outcomes.find((o) => !o.ok)?.path.endsWith('bad.txt')).toBe(true)
  })

  it('cancel mid-transfer stops and keeps completed work without throwing', async () => {
    const sftp = fakeSftp({
      '/srv': { type: 'dir', children: ['first.txt', 'second.txt'] },
      '/srv/first.txt': { type: 'file', content: 'a' },
      '/srv/second.txt': { type: 'file', content: 'b' }
    })
    const controller = new AbortController()

    const outcomes = await downloadRemoteTo(sftp, '/srv', join(localRoot, 'srv'), {
      signal: controller.signal,
      onProgress: (done: number) => {
        if (done >= 1) {
          controller.abort()
        }
      }
    })

    expect(controller.signal.aborted).toBe(true)
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1)
    expect(outcomes[0]?.path.endsWith('first.txt')).toBe(true)
    expect(existsSync(join(localRoot, 'srv', 'second.txt'))).toBe(false)
  })
})

describe('late teardown error safety', () => {
  beforeEach(() => {
    localRoot = mkdtempSync(join(tmpdir(), 'sftp-dl-late-'))
    trashItemMock.mockClear()
    trashFails.current = false
  })
  afterEach(() => {
    rmSync(localRoot, { recursive: true, force: true })
  })

  it('keeps a persistent error listener so late ssh2 cleanup emits cannot throw uncaught', () => {
    const stream = new Readable({ read() {} })
    // Why: ssh2's cleanupRequests fires req.cb(err) → ReadStream emit('error')
    // after finished()'s cleanup removed its listener — a bare emit throws
    // (uncaught in main). The guard must absorb it.
    attachPersistentStreamErrorGuard(stream)
    expect(() => stream.emit('error', new Error('No response from server'))).not.toThrow()
  })
})

describe('fastGet windows delete-pending retry', () => {
  beforeEach(() => {
    localRoot = mkdtempSync(join(tmpdir(), 'sftp-dl-retry-'))
    trashItemMock.mockClear()
    trashFails.current = false
  })
  afterEach(() => {
    rmSync(localRoot, { recursive: true, force: true })
  })

  it('retries fastGet through transient EPERM/EBUSY after trashing', async () => {
    const sftp = fakeSftp({
      '/srv/file.txt': { type: 'file', content: 'retry-me' }
    })
    const holder = sftp as unknown as {
      fastGet: (r: string, l: string, o: unknown, cb: (e: Error | null) => void) => void
    }
    const originalFastGet = holder.fastGet.bind(sftp)
    let attempts = 0
    holder.fastGet = (remotePath, localPath, opts, cb) => {
      attempts += 1
      if (attempts <= 2) {
        // Why: Windows delete-pending after trashItem — the old file's handle
        // lingers, so creating the same-name target fails transiently.
        const err = Object.assign(new Error('EPERM: operation not permitted'), {
          code: 'EPERM'
        })
        cb(err)
        return
      }
      originalFastGet(remotePath, localPath, opts, cb)
    }

    const outcomes = await downloadRemoteTo(sftp, '/srv/file.txt', join(localRoot, 'file.txt'))

    expect(attempts).toBe(3)
    expect(outcomes[0]?.ok).toBe(true)
    expect(readFileSync(join(localRoot, 'file.txt'), 'utf-8')).toBe('retry-me')
  })
})

describe('fastGet server-quirk fallback', () => {
  beforeEach(() => {
    localRoot = mkdtempSync(join(tmpdir(), 'sftp-dl-fallback-'))
    trashItemMock.mockClear()
    trashFails.current = false
  })
  afterEach(() => {
    rmSync(localRoot, { recursive: true, force: true })
  })

  it('falls back to the piped stream when the server rejects fastGet entirely', async () => {
    const sftp = fakeSftp({
      '/srv/file.txt': { type: 'file', content: 'via-stream' }
    })
    const holder = sftp as unknown as {
      fastGet: (r: string, l: string, o: unknown, cb: (e: Error | null) => void) => void
    }
    let fastGetCalls = 0
    holder.fastGet = (_r, _l, _o, cb) => {
      fastGetCalls += 1
      // Why: some minimal SFTP servers reject fastGet's call shape outright
      // (e.g. concurrent positioned reads) while serving plain streams.
      cb(new Error('Failed to parse path'))
    }

    const outcomes = await downloadRemoteTo(sftp, '/srv/file.txt', join(localRoot, 'file.txt'))

    expect(fastGetCalls).toBeGreaterThan(0)
    expect(outcomes[0]?.ok).toBe(true)
    expect(readFileSync(join(localRoot, 'file.txt'), 'utf-8')).toBe('via-stream')
  })
})

describe('local path normalization for Electron APIs', () => {
  beforeEach(() => {
    localRoot = mkdtempSync(join(tmpdir(), 'sftp-dl-norm-')).split(sep).join('/')
    trashItemMock.mockClear()
    trashFails.current = false
  })
  afterEach(() => {
    rmSync(localRoot, { recursive: true, force: true })
  })

  it('passes a native-separator path to shell.trashItem', async () => {
    mkdirSync(localRoot, { recursive: true })
    writeFileSync(`${localRoot}/file.txt`, 'old')
    const sftp = fakeSftp({
      '/srv/file.txt': { type: 'file', content: 'new' }
    })

    // Why: renderer paths arrive with forward slashes on Windows; Chromium's
    // trashItem parses only native separators and throws 'Failed to parse path'.
    await downloadRemoteTo(sftp, '/srv/file.txt', `${localRoot}/file.txt`)

    expect(trashItemMock).toHaveBeenCalledWith(join(localRoot, 'file.txt'))
    expect(readFileSync(join(localRoot, 'file.txt'), 'utf-8')).toBe('new')
  })
})
