import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { uploadLocalTo } from './sftp-upload-batch'
import type { SFTPWrapper } from 'ssh2'

describe('uploadLocalTo cancel during in-flight fastPut', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sftp-cancel-mid-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('aborts while a single fastPut hangs instead of waiting it out', async () => {
    writeFileSync(join(dir, 'huge.tar.gz'), 'x')
    const controller = new AbortController()
    const sftp = {
      mkdir: (_p: string, cb: (e?: Error | null) => void) => cb(null),
      fastPut: () => {
        // Why: never settles and never observes the signal — only the
        // engine's own abort race can end this transfer.
      }
    } as unknown as SFTPWrapper

    const pending = uploadLocalTo(sftp, join(dir, 'huge.tar.gz'), '/remote/huge.tar.gz', {
      signal: controller.signal
    })
    setTimeout(() => controller.abort(), 20)

    const outcomes = await Promise.race([
      pending,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('ENGINE FAILED TO ABORT')), 2000)
      )
    ])
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]?.ok).toBe(false)
  })
})

describe('uploadLocalTo remote parent creation', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sftp-mkdir-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('creates every nested remote subdirectory before writing into it', async () => {
    mkdirSync(join(dir, 'sub', 'deep'), { recursive: true })
    writeFileSync(join(dir, 'sub', 'deep', 'leaf.txt'), 'x')
    writeFileSync(join(dir, 'top.txt'), 'y')

    // Why: a real SFTP server rejects writes into a directory that was never
    // created — the fake enforces the same contract via a created-dirs set.
    const createdDirs = new Set<string>([''])
    const sftp = {
      mkdir: (p: string, cb: (e?: Error | null) => void) => {
        createdDirs.add(p)
        cb(null)
      },
      fastPut: (_l: string, r: string, _o: unknown, cb: (e: Error | null) => void) => {
        const parent = r.split('/').slice(0, -1).join('/')
        if (!createdDirs.has(parent)) {
          cb(Object.assign(new Error('No such file'), { code: 2 }))
          return
        }
        cb(null)
      }
    } as unknown as SFTPWrapper

    const outcomes = await uploadLocalTo(sftp, dir, '/remote', {
      rootRealPath: dir
    })

    expect(outcomes).toHaveLength(2)
    expect(outcomes.every((o) => o.ok)).toBe(true)
    expect(createdDirs.has('/remote')).toBe(true)
    expect(createdDirs.has('/remote/sub')).toBe(true)
    expect(createdDirs.has('/remote/sub/deep')).toBe(true)
  })

  it('mkdir -ps the remote parent chain for a single-file upload', async () => {
    writeFileSync(join(dir, 'newborn.txt'), 'x')
    const createdDirs = new Set<string>([''])
    const sftp = {
      mkdir: (p: string, cb: (e?: Error | null) => void) => {
        createdDirs.add(p)
        cb(null)
      },
      fastPut: (_l: string, r: string, _o: unknown, cb: (e: Error | null) => void) => {
        const parent = r.split('/').slice(0, -1).join('/')
        if (!createdDirs.has(parent)) {
          cb(Object.assign(new Error('No such file'), { code: 2 }))
          return
        }
        cb(null)
      }
    } as unknown as SFTPWrapper

    const outcomes = await uploadLocalTo(
      sftp,
      join(dir, 'newborn.txt'),
      '/remote/new/dir/newborn.txt',
      {
        rootRealPath: dir
      }
    )

    expect(outcomes[0]?.ok).toBe(true)
    expect(createdDirs.has('/remote')).toBe(true)
    expect(createdDirs.has('/remote/new')).toBe(true)
    expect(createdDirs.has('/remote/new/dir')).toBe(true)
  })
})

describe('uploadLocalTo mkdir failure containment', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sftp-mkdirfail-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('records the denied directory as failed and still uploads siblings', async () => {
    mkdirSync(join(dir, 'denied'), { recursive: true })
    writeFileSync(join(dir, 'denied', 'inner.txt'), 'x')
    writeFileSync(join(dir, 'ok.txt'), 'y')

    const sftp = {
      mkdir: (p: string, cb: (e?: Error | null) => void) => {
        if (p.endsWith('/denied')) {
          cb(Object.assign(new Error('Permission denied'), { code: 3 }))
          return
        }
        cb(null)
      },
      fastPut: (_l: string, _r: string, _o: unknown, cb: (e: Error | null) => void) => cb(null)
    } as unknown as SFTPWrapper

    const outcomes = await uploadLocalTo(sftp, dir, '/remote', { rootRealPath: dir })

    const denied = outcomes.find((o) => o.path.endsWith('denied'))
    expect(denied?.ok).toBe(false)
    if (denied?.ok === false) {
      expect(denied.error).toContain('Permission denied')
    }
    const ok = outcomes.find((o) => o.path.endsWith('ok.txt'))
    expect(ok?.ok).toBe(true)
  })
})
