import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { SFTPWrapper } from 'ssh2'
import { removeDirectorySftp, uploadBuffer, uploadDirectory, uploadFile } from './sftp-upload'
import { uploadLocalTo } from './sftp-upload-batch'

function createWritable(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    }
  })
}

function createSftpMock(): SFTPWrapper {
  return {
    mkdir: vi.fn((_path: string, cb: (err?: Error | null) => void) => cb(null)),
    createWriteStream: vi.fn(() => createWritable()),
    readdir: vi.fn((_path: string, cb: (err?: Error | null, entries?: unknown[]) => void) =>
      cb(null, [])
    ),
    unlink: vi.fn((_path: string, cb: (err?: Error | null) => void) => cb(null)),
    rmdir: vi.fn((_path: string, cb: (err?: Error | null) => void) => cb(null))
  } as unknown as SFTPWrapper
}

describe('sftp-upload', () => {
  it('can create the first binary upload chunk without clobbering an existing temp file', async () => {
    const sftp = createSftpMock()

    await uploadBuffer(sftp, Buffer.from('png'), '/remote/.logo.orca-upload', {
      exclusive: true
    })

    expect(sftp.createWriteStream).toHaveBeenCalledWith('/remote/.logo.orca-upload', {
      flags: 'wx'
    })
    const writeStream = vi.mocked(sftp.createWriteStream).mock.results[0]?.value as Writable
    expect(writeStream.listenerCount('close')).toBe(0)
    expect(writeStream.listenerCount('error')).toBe(0)
  })

  it('uses no-clobber writes for nested files during exclusive directory upload', async () => {
    const localDir = await mkdtemp(join(tmpdir(), 'orca-sftp-upload-'))
    await mkdir(join(localDir, 'nested'))
    await writeFile(join(localDir, 'nested', 'asset.txt'), 'asset')
    const sftp = createSftpMock()

    await uploadDirectory(sftp, localDir, '/remote/assets', await realpath(localDir), {
      exclusive: true
    })

    expect(sftp.mkdir).toHaveBeenCalledWith('/remote/assets/nested', expect.any(Function))
    expect(sftp.createWriteStream).toHaveBeenCalledWith('/remote/assets/nested/asset.txt', {
      flags: 'wx'
    })
    const writeStream = vi.mocked(sftp.createWriteStream).mock.results[0]?.value as Writable
    expect(writeStream.listenerCount('close')).toBe(0)
    expect(writeStream.listenerCount('error')).toBe(1)
  })

  it('uploads files from valid dot-dot-prefixed local directories', async () => {
    const localDir = await mkdtemp(join(tmpdir(), 'orca-sftp-upload-'))
    await mkdir(join(localDir, '..fixtures'))
    await writeFile(join(localDir, '..fixtures', 'asset.txt'), 'asset')
    const sftp = createSftpMock()

    await uploadDirectory(sftp, localDir, '/remote/assets', await realpath(localDir), {
      exclusive: true
    })

    expect(sftp.mkdir).toHaveBeenCalledWith('/remote/assets/..fixtures', expect.any(Function))
    expect(sftp.createWriteStream).toHaveBeenCalledWith('/remote/assets/..fixtures/asset.txt', {
      flags: 'wx'
    })
  })

  it('rejects sibling directories outside the upload root', async () => {
    const localDir = await mkdtemp(join(tmpdir(), 'orca-sftp-upload-'))
    const escapedDir = `${localDir}-sibling`
    await mkdir(escapedDir)
    await writeFile(join(escapedDir, 'asset.txt'), 'asset')
    const sftp = createSftpMock()

    await expect(
      uploadDirectory(sftp, escapedDir, '/remote/assets', await realpath(localDir), {
        exclusive: true
      })
    ).rejects.toThrow('Path escaped upload root')

    expect(sftp.mkdir).not.toHaveBeenCalled()
    expect(sftp.createWriteStream).not.toHaveBeenCalled()
  })

  it('does not create the remote file when the local source is a symlink', async () => {
    const localDir = await mkdtemp(join(tmpdir(), 'orca-sftp-upload-'))
    const targetPath = join(localDir, process.platform === 'win32' ? 'target-dir' : 'target.txt')
    const linkPath = join(localDir, process.platform === 'win32' ? 'link-dir' : 'link.txt')
    if (process.platform === 'win32') {
      await mkdir(targetPath)
      // Why: file symlinks often require Developer Mode/admin on Windows, while
      // junctions still exercise the symlink rejection branch.
      await symlink(targetPath, linkPath, 'junction')
    } else {
      await writeFile(targetPath, 'secret')
      await symlink(targetPath, linkPath)
    }
    const sftp = createSftpMock()

    await expect(uploadFile(sftp, linkPath, '/remote/link.txt')).rejects.toThrow()

    expect(sftp.createWriteStream).not.toHaveBeenCalled()
  })

  it('joins local file-descriptor teardown when a live upload is aborted', async () => {
    const localDir = await mkdtemp(join(tmpdir(), 'orca-sftp-upload-abort-'))
    const localPath = join(localDir, 'relay.js')
    const controller = new AbortController()
    const blockedWrite = new Writable({
      write() {}
    })
    const sftp = createSftpMock()
    vi.mocked(sftp.createWriteStream).mockReturnValue(blockedWrite as never)
    try {
      await writeFile(localPath, Buffer.alloc(1024 * 1024, 7))
      const upload = uploadFile(sftp, localPath, '/remote/relay.js', {
        signal: controller.signal
      })
      await vi.waitFor(() => expect(sftp.createWriteStream).toHaveBeenCalledTimes(1))

      controller.abort()

      await expect(upload).rejects.toMatchObject({ name: 'AbortError' })
      if (process.platform !== 'win32') {
        const descriptorProbe = spawnSync(
          'lsof',
          ['-a', '-p', String(process.pid), '--', localPath],
          { encoding: 'utf8' }
        )
        if (!descriptorProbe.error) {
          expect(descriptorProbe.stdout).not.toContain(localPath)
        }
      }
    } finally {
      await rm(localDir, { recursive: true, force: true })
    }
  })

  it('joins the local read when the remote write fails', async () => {
    const localDir = await mkdtemp(join(tmpdir(), 'orca-sftp-upload-failure-'))
    const localPath = join(localDir, 'relay.js')
    const sftp = createSftpMock()
    vi.mocked(sftp.createWriteStream).mockReturnValue(
      new Writable({
        write(_chunk, _encoding, callback) {
          callback(new Error('remote write failed'))
        }
      }) as never
    )
    try {
      await writeFile(localPath, Buffer.alloc(1024 * 1024, 7))

      await expect(uploadFile(sftp, localPath, '/remote/relay.js')).rejects.toThrow(
        'remote write failed'
      )
    } finally {
      await rm(localDir, { recursive: true, force: true })
    }
  })

  it('removes remote directory contents before removing the directory', async () => {
    const sftp = createSftpMock()
    vi.mocked(sftp.readdir).mockImplementation((remotePath, cb) => {
      const pathString = String(remotePath)
      if (pathString === '/remote/assets') {
        cb(undefined, [
          { filename: '.', attrs: { isDirectory: () => true } },
          { filename: '..', attrs: { isDirectory: () => true } },
          { filename: 'nested', attrs: { isDirectory: () => true } },
          { filename: 'logo.png', attrs: { isDirectory: () => false } }
        ] as never)
        return
      }
      if (pathString === '/remote/assets/nested') {
        cb(undefined, [{ filename: 'copy.txt', attrs: { isDirectory: () => false } }] as never)
        return
      }
      cb(new Error(`unexpected readdir: ${pathString}`), [] as never)
    })

    await removeDirectorySftp(sftp, '/remote/assets')

    expect(sftp.unlink).toHaveBeenNthCalledWith(
      1,
      '/remote/assets/nested/copy.txt',
      expect.any(Function)
    )
    expect(sftp.rmdir).toHaveBeenNthCalledWith(1, '/remote/assets/nested', expect.any(Function))
    expect(sftp.unlink).toHaveBeenNthCalledWith(2, '/remote/assets/logo.png', expect.any(Function))
    expect(sftp.rmdir).toHaveBeenNthCalledWith(2, '/remote/assets', expect.any(Function))
  })
})

describe('uploadLocalTo (batch semantics)', () => {
  const remoteUploads: Record<string, Buffer> = {}
  function createWritableFor(paths: Record<string, 'ok' | 'error'>): {
    sftp: SFTPWrapper
    written: string[]
  } {
    const written: string[] = []
    const sftp = {
      mkdir: (_path: string, cb: (err?: Error | null) => void) => cb(null),
      fastPut: (
        localPath: string,
        remotePath: string,
        _opts: unknown,
        cb: (err: Error | null) => void
      ) => {
        if (paths[remotePath] === 'error') {
          cb(new Error('remote disk full'))
          return
        }
        written.push(remotePath)
        try {
          const chunk = readFileSync(localPath)
          remoteUploads[remotePath] = Buffer.concat([
            remoteUploads[remotePath] ?? Buffer.alloc(0),
            chunk
          ])
          cb(null)
        } catch (err) {
          cb(err instanceof Error ? err : new Error(String(err)))
        }
      },
      createWriteStream: (path: string) => {
        written.push(path)
        const mode = paths[path] ?? 'ok'
        if (mode === 'error') {
          return new Writable({
            write(_chunk: unknown, _enc: string, cb: (err?: Error | null) => void) {
              cb(new Error('remote disk full'))
            }
          })
        }
        return new Writable({
          write(_chunk: unknown, _enc: string, cb: (err?: Error | null) => void) {
            cb(null)
          }
        })
      }
    }
    return { sftp: sftp as unknown as SFTPWrapper, written }
  }

  it('continues after a per-file failure and collects outcomes', async () => {
    const localDir = await mkdtemp(join(tmpdir(), 'orca-sftp-batch-'))
    await writeFile(join(localDir, 'good1.txt'), 'a')
    await writeFile(join(localDir, 'bad.txt'), 'b')
    await writeFile(join(localDir, 'good2.txt'), 'c')

    const { sftp } = createWritableFor({
      '/remote/bad.txt': 'error'
    })
    const outcomes = await uploadLocalTo(sftp, localDir, '/remote', {
      rootRealPath: await realpath(localDir)
    })

    expect(outcomes).toHaveLength(3)
    const failed = outcomes.find((o) => !o.ok)
    expect(failed?.path.endsWith('bad.txt')).toBe(true)
    expect(outcomes.filter((o) => o.ok)).toHaveLength(2)
  })

  it('cancel mid-transfer stops and keeps completed outcomes', async () => {
    const localDir = await mkdtemp(join(tmpdir(), 'orca-sftp-cancel-'))
    await writeFile(join(localDir, 'first.txt'), 'a')
    await writeFile(join(localDir, 'second.txt'), 'b')

    const controller = new AbortController()
    const { sftp, written } = createWritableFor({})
    const outcomes = await uploadLocalTo(sftp, localDir, '/remote', {
      rootRealPath: await realpath(localDir),
      signal: controller.signal,
      onProgress: (done: number) => {
        if (done >= 1) {
          controller.abort()
        }
      }
    })

    expect(outcomes.filter((o) => o.ok)).toHaveLength(1)
    expect(controller.signal.aborted).toBe(true)
    expect(written).toEqual(['/remote/first.txt'])
  })

  it('skips entries via shouldSkip', async () => {
    const localDir = await mkdtemp(join(tmpdir(), 'orca-sftp-skip-'))
    await writeFile(join(localDir, 'keep.txt'), 'a')
    await writeFile(join(localDir, 'skip-me.txt'), 'b')

    const { sftp } = createWritableFor({})
    const outcomes = await uploadLocalTo(sftp, localDir, '/remote', {
      rootRealPath: await realpath(localDir),
      shouldSkip: (p: string) => p.endsWith('skip-me.txt')
    })

    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]?.path.endsWith('keep.txt')).toBe(true)
  })
})
