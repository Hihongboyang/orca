import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable, Writable } from 'node:stream'
import type { SFTPWrapper } from 'ssh2'
import type { SshTarget } from '../../shared/ssh-types'
import {
  SFTP_PROFILES_CHANNEL,
  SFTP_SAVE_PROFILE_CHANNEL,
  SFTP_DELETE_PROFILE_CHANNEL,
  SFTP_UPLOAD_CHANNEL,
  SFTP_DOWNLOAD_CHANNEL,
  SFTP_COMPARE_CHANNEL,
  SFTP_SAVE_REMOTE_CHANNEL,
  SFTP_CANCEL_TRANSFER_CHANNEL,
  SFTP_CONFIRM_HOST_KEY_CHANNEL,
  SFTP_CLEAR_HOST_TRUST_CHANNEL,
  SFTP_PROFILES_CHANGED_CHANNEL,
  SFTP_TRANSFER_PROGRESS_CHANNEL,
  SFTP_HOST_KEY_REQUIRED_CHANNEL
} from '../../shared/sftp-types'

const { handleMock, sendMock, withSftpSessionMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  sendMock: vi.fn(),
  withSftpSessionMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
    on: vi.fn(),
    once: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn()
  },
  shell: {
    trashItem: vi.fn().mockResolvedValue(undefined)
  }
}))

vi.mock('../ssh/sftp-transfer-session', () => ({
  withSftpSession: withSftpSessionMock,
  SftpTransferSessionError: class SftpTransferSessionError extends Error {
    constructor(
      public readonly code: string,
      message: string
    ) {
      super(message)
    }
  }
}))

import { registerSftpTransferHandlers } from './sftp-transfer'

// ── in-memory remote ──────────────────────────────────────────────────

type RemoteNode = {
  type: 'file' | 'dir' | 'symlink'
  content?: string
  size?: number
  children?: string[]
}

let remoteTree: Record<string, RemoteNode>
let remoteWrites: Record<string, string>

function attrsFor(node: RemoteNode) {
  return {
    size: node.size ?? node.content?.length ?? 0,
    isDirectory: () => node.type === 'dir',
    isSymbolicLink: () => node.type === 'symlink',
    isFile: () => node.type === 'file'
  }
}

function fakeSftp(): SFTPWrapper {
  const nodeAt = (p: string): RemoteNode | undefined => remoteTree[p.replace(/\/+$/, '') || '/']
  return {
    mkdir: (_p: string, cb: (err?: Error | null) => void) => cb(null),
    fastPut: (
      localPath: string,
      remotePath: string,
      _opts: unknown,
      cb: (err: Error | null) => void
    ) => {
      try {
        remoteWrites[remotePath] =
          (remoteWrites[remotePath] ?? '') + readFileSync(localPath, 'utf-8')
        cb(null)
      } catch (err) {
        cb(err instanceof Error ? err : new Error(String(err)))
      }
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
    createWriteStream: (p: string) =>
      new Writable({
        write(chunk: Buffer, _enc: string, cb: (err?: Error | null) => void) {
          remoteWrites[p] = (remoteWrites[p] ?? '') + chunk.toString('utf-8')
          cb(null)
        }
      }),
    lstat: (p: string, cb: (err: Error | null, attrs?: unknown) => void) => {
      const node = nodeAt(p)
      if (!node) {
        cb(Object.assign(new Error('ENOENT'), { code: 2 }))
        return
      }
      cb(null, attrsFor(node))
    },
    readdir: (p: string, cb: (err: Error | null, entries?: unknown[]) => void) => {
      const node = nodeAt(p)
      if (!node || node.type !== 'dir') {
        cb(Object.assign(new Error('ENOENT'), { code: 2 }))
        return
      }
      cb(
        null,
        (node.children ?? []).map((name) => ({
          filename: name,
          attrs: attrsFor(nodeAt(`${p.replace(/\/+$/, '')}/${name}`)!)
        }))
      )
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

// ── store mock ────────────────────────────────────────────────────────

const target: SshTarget = {
  id: 'ssh-1',
  label: 'prod',
  host: '10.0.0.5',
  port: 22,
  username: 'deploy'
}

function createStoreMock() {
  const profiles: Record<string, unknown[]> = {}
  const hostTrust: Record<string, string> = {}
  return {
    profiles,
    hostTrust,
    getSftpProfiles: vi.fn((ws: string) => [...(profiles[ws] ?? [])]),
    saveSftpProfile: vi.fn((ws: string, profile: unknown) => {
      profiles[ws] ??= []
      const list = profiles[ws] as { id: string }[]
      const incoming = profile as { id: string }
      // Why: mirror the real Store's id-generation-on-create contract.
      const saved = incoming.id === '' ? { ...incoming, id: `gen-${list.length + 1}` } : incoming
      const index = list.findIndex((p) => p.id === saved.id)
      if (index !== -1) {
        list[index] = saved
      } else {
        list.push(saved)
      }
      return saved
    }),
    deleteSftpProfile: vi.fn((ws: string, profileId: string) => {
      profiles[ws] = (profiles[ws] ?? []).filter((p) => (p as { id: string }).id !== profileId)
    }),
    getSftpHostTrust: vi.fn((k: string) => hostTrust[k]),
    setSftpHostTrust: vi.fn((k: string, v: string) => {
      hostTrust[k] = v
    }),
    clearSftpHostTrust: vi.fn((k: string) => delete hostTrust[k]),
    getSshTarget: vi.fn(() => target),
    getSshTargets: vi.fn(() => [target])
  }
}

// ── harness ───────────────────────────────────────────────────────────

let handlers: Map<string, (event: unknown, args: unknown) => Promise<unknown>>
let storeMock: ReturnType<typeof createStoreMock>
let localRoot: string

function invoke(channel: string, args: unknown): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`no handler for ${channel}`)
  }
  // Why: wrap so handlers that throw synchronously surface as rejections,
  // matching ipcMain.handle semantics over the real boundary.
  return Promise.resolve().then(() => handler(null, args)) as Promise<unknown>
}

describe('sftp IPC handlers', () => {
  beforeEach(() => {
    handlers = new Map()
    handleMock.mockReset()
    handleMock.mockImplementation((channel: string, handler: () => Promise<unknown>) => {
      handlers.set(channel, handler as never)
    })
    sendMock.mockReset()
    withSftpSessionMock.mockReset()
    withSftpSessionMock.mockImplementation(
      (_target: unknown, _ops: unknown, operation: (s: SFTPWrapper) => Promise<unknown>) =>
        Promise.resolve(operation(fakeSftp()))
    )
    storeMock = createStoreMock()
    remoteTree = {}
    remoteWrites = {}
    localRoot = mkdtempSync(join(tmpdir(), 'sftp-ipc-'))
    registerSftpTransferHandlers(
      storeMock as never,
      () => ({ webContents: { send: sendMock }, isDestroyed: () => false }) as never
    )
  })

  it('registers exactly the channels from contracts.md', () => {
    const expected = [
      SFTP_PROFILES_CHANNEL,
      SFTP_SAVE_PROFILE_CHANNEL,
      SFTP_DELETE_PROFILE_CHANNEL,
      SFTP_UPLOAD_CHANNEL,
      SFTP_DOWNLOAD_CHANNEL,
      SFTP_COMPARE_CHANNEL,
      SFTP_SAVE_REMOTE_CHANNEL,
      SFTP_CANCEL_TRANSFER_CHANNEL,
      SFTP_CONFIRM_HOST_KEY_CHANNEL,
      SFTP_CLEAR_HOST_TRUST_CHANNEL
    ]
    expect([...handlers.keys()].sort()).toEqual([...expected].sort())
  })

  describe('profile CRUD', () => {
    it('saves, lists, and deletes profiles scoped to the workspace path', async () => {
      const saved = (await invoke(SFTP_SAVE_PROFILE_CHANNEL, {
        workspacePath: '/ws/a',
        profile: {
          id: '',
          label: 'prod',
          targetId: 'ssh-1',
          localRoot,
          defaultRemoteDir: '/srv/app'
        }
      })) as { id: string }
      expect(saved.id).not.toBe('')

      const other = await invoke(SFTP_SAVE_PROFILE_CHANNEL, {
        workspacePath: '/ws/b',
        profile: {
          id: 'p2',
          label: 'staging',
          targetId: 'ssh-1',
          localRoot,
          defaultRemoteDir: '/srv/stg'
        }
      })
      expect((other as { id: string }).id).toBe('p2')

      expect(await invoke(SFTP_PROFILES_CHANNEL, { workspacePath: '/ws/a' })).toHaveLength(1)
      expect(await invoke(SFTP_PROFILES_CHANNEL, { workspacePath: '/ws/b' })).toHaveLength(1)
      expect(sendMock).toHaveBeenCalledWith(SFTP_PROFILES_CHANGED_CHANNEL, [
        expect.objectContaining({ id: saved.id })
      ])

      await invoke(SFTP_DELETE_PROFILE_CHANNEL, { workspacePath: '/ws/a', profileId: saved.id })
      expect(await invoke(SFTP_PROFILES_CHANNEL, { workspacePath: '/ws/a' })).toHaveLength(0)
    })

    it('rejects a relative defaultRemoteDir', async () => {
      await expect(
        invoke(SFTP_SAVE_PROFILE_CHANNEL, {
          workspacePath: '/ws/a',
          profile: {
            id: '',
            label: 'x',
            targetId: 'ssh-1',
            localRoot,
            defaultRemoteDir: 'srv/app'
          }
        })
      ).rejects.toThrow(/absolute/)
    })

    it('rejects a profile referencing an unknown target', async () => {
      storeMock.getSshTarget.mockReturnValue(undefined as unknown as SshTarget)
      await expect(
        invoke(SFTP_SAVE_PROFILE_CHANNEL, {
          workspacePath: '/ws/a',
          profile: {
            id: '',
            label: 'x',
            targetId: 'ghost',
            localRoot,
            defaultRemoteDir: '/srv'
          }
        })
      ).rejects.toThrow(/target/i)
    })
  })

  describe('save-remote dispatch', () => {
    it('writes the edited content to the mirrored remote path', async () => {
      remoteTree['/srv/app/src/main.ts'] = { type: 'file', content: 'old remote' }
      mkdirSync(join(localRoot, 'src'), { recursive: true })
      writeFileSync(join(localRoot, 'src', 'main.ts'), 'local side')
      const saved = (await invoke(SFTP_SAVE_PROFILE_CHANNEL, {
        workspacePath: localRoot,
        profile: {
          id: '',
          label: 'prod',
          targetId: 'ssh-1',
          localRoot,
          defaultRemoteDir: '/srv/app'
        }
      })) as { id: string }

      const result = (await invoke(SFTP_SAVE_REMOTE_CHANNEL, {
        workspacePath: localRoot,
        profileId: saved.id,
        localPath: join(localRoot, 'src', 'main.ts'),
        content: 'edited remote'
      })) as { bytesWritten: number }

      expect(result.bytesWritten).toBe('edited remote'.length)
      expect(remoteWrites['/srv/app/src/main.ts']).toBe('edited remote')
    })

    it('refuses payloads over the 10 MB cap with the typed code', async () => {
      mkdirSync(join(localRoot, 'src'), { recursive: true })
      writeFileSync(join(localRoot, 'src', 'main.ts'), 'local')
      const saved = (await invoke(SFTP_SAVE_PROFILE_CHANNEL, {
        workspacePath: localRoot,
        profile: {
          id: '',
          label: 'prod',
          targetId: 'ssh-1',
          localRoot,
          defaultRemoteDir: '/srv/app'
        }
      })) as { id: string }

      await expect(
        invoke(SFTP_SAVE_REMOTE_CHANNEL, {
          workspacePath: localRoot,
          profileId: saved.id,
          localPath: join(localRoot, 'src', 'main.ts'),
          content: 'x'.repeat(10 * 1024 * 1024 + 1)
        })
      ).rejects.toThrow('compare-file-too-large')
    })
  })

  describe('upload dispatch', () => {
    let profileId: string

    beforeEach(async () => {
      remoteTree['/srv/app'] = { type: 'dir', children: [] }
      mkdirSync(join(localRoot, 'src'), { recursive: true })
      writeFileSync(join(localRoot, 'src', 'main.ts'), 'export {}\n')
      profileId = (
        (await invoke(SFTP_SAVE_PROFILE_CHANNEL, {
          workspacePath: localRoot,
          profile: {
            id: '',
            label: 'prod',
            targetId: 'ssh-1',
            localRoot,
            defaultRemoteDir: '/srv/app'
          }
        })) as { id: string }
      ).id
    })

    it('uploads through a mirrored remote path and reports per-file outcomes', async () => {
      const result = (await invoke(SFTP_UPLOAD_CHANNEL, {
        workspacePath: localRoot,
        profileId,
        localPath: join(localRoot, 'src', 'main.ts')
      })) as { cancelled: boolean; outcomes: { ok: boolean }[] }

      expect(result.cancelled).toBe(false)
      expect(result.outcomes).toHaveLength(1)
      expect(result.outcomes[0]?.ok).toBe(true)
      expect(remoteWrites['/srv/app/src/main.ts']).toBe('export {}\n')
    })

    it('emits connecting then transferring progress events', async () => {
      writeFileSync(join(localRoot, 'two.ts'), 'b')
      await invoke(SFTP_UPLOAD_CHANNEL, {
        workspacePath: localRoot,
        profileId,
        localPath: localRoot
      })

      const progressCalls = sendMock.mock.calls.filter(
        (call) => call[0] === SFTP_TRANSFER_PROGRESS_CHANNEL
      )
      const phases = progressCalls.map((call) => (call[1] as { phase: string }).phase)
      expect(phases[0]).toBe('connecting')
      expect(phases).toContain('transferring')
    })

    it('rejects paths outside the profile localRoot with the typed code', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'sftp-outside-'))
      writeFileSync(join(outside, 'x.txt'), 'x')
      try {
        await expect(
          invoke(SFTP_UPLOAD_CHANNEL, {
            workspacePath: localRoot,
            profileId,
            localPath: join(outside, 'x.txt')
          })
        ).rejects.toThrow('outside-local-root')
      } finally {
        rmSync(outside, { recursive: true, force: true })
      }
    })

    it('rejects an unknown profile with profile-not-found', async () => {
      await expect(
        invoke(SFTP_UPLOAD_CHANNEL, {
          workspacePath: localRoot,
          profileId: 'ghost',
          localPath: join(localRoot, 'two.ts')
        })
      ).rejects.toThrow('profile-not-found')
    })
  })

  describe('download dispatch', () => {
    it('downloads the mirrored remote path onto the local selection', async () => {
      remoteTree['/srv/app/src'] = { type: 'dir', children: ['main.ts'] }
      remoteTree['/srv/app/src/main.ts'] = { type: 'file', content: 'from remote' }
      mkdirSync(join(localRoot, 'src'), { recursive: true })
      writeFileSync(join(localRoot, 'src', 'main.ts'), 'stale local')

      const saved = (await invoke(SFTP_SAVE_PROFILE_CHANNEL, {
        workspacePath: localRoot,
        profile: {
          id: '',
          label: 'prod',
          targetId: 'ssh-1',
          localRoot,
          defaultRemoteDir: '/srv/app'
        }
      })) as { id: string }

      const result = (await invoke(SFTP_DOWNLOAD_CHANNEL, {
        workspacePath: localRoot,
        profileId: saved.id,
        localPath: join(localRoot, 'src', 'main.ts')
      })) as { outcomes: { ok: boolean }[] }

      expect(result.outcomes[0]?.ok).toBe(true)
      expect(readFileSync(join(localRoot, 'src', 'main.ts'), 'utf-8')).toBe('from remote')
    })
  })

  describe('compare dispatch', () => {
    it('returns remote content for a text file', async () => {
      remoteTree['/srv/app/src/main.ts'] = { type: 'file', content: 'remote side' }
      mkdirSync(join(localRoot, 'src'), { recursive: true })
      writeFileSync(join(localRoot, 'src', 'main.ts'), 'local side')
      const saved = (await invoke(SFTP_SAVE_PROFILE_CHANNEL, {
        workspacePath: localRoot,
        profile: {
          id: '',
          label: 'prod',
          targetId: 'ssh-1',
          localRoot,
          defaultRemoteDir: '/srv/app'
        }
      })) as { id: string }

      const result = (await invoke(SFTP_COMPARE_CHANNEL, {
        workspacePath: localRoot,
        profileId: saved.id,
        localPath: join(localRoot, 'src', 'main.ts')
      })) as { content: string }
      expect(result.content).toBe('remote side')
    })

    it('refuses files over the 10 MB cap with the typed code', async () => {
      remoteTree['/srv/app/src/main.ts'] = {
        type: 'file',
        content: 'x',
        size: 10 * 1024 * 1024 + 1
      }
      mkdirSync(join(localRoot, 'src'), { recursive: true })
      writeFileSync(join(localRoot, 'src', 'main.ts'), 'local')
      const saved = (await invoke(SFTP_SAVE_PROFILE_CHANNEL, {
        workspacePath: localRoot,
        profile: {
          id: '',
          label: 'prod',
          targetId: 'ssh-1',
          localRoot,
          defaultRemoteDir: '/srv/app'
        }
      })) as { id: string }

      await expect(
        invoke(SFTP_COMPARE_CHANNEL, {
          workspacePath: localRoot,
          profileId: saved.id,
          localPath: join(localRoot, 'src', 'main.ts')
        })
      ).rejects.toThrow('compare-file-too-large')
    })

    it('refuses binary remote content with the typed code', async () => {
      remoteTree['/srv/app/blob.bin'] = { type: 'file', content: ' bin ary' }
      writeFileSync(join(localRoot, 'blob.bin'), Buffer.from([0, 1]))
      const saved = (await invoke(SFTP_SAVE_PROFILE_CHANNEL, {
        workspacePath: localRoot,
        profile: {
          id: '',
          label: 'prod',
          targetId: 'ssh-1',
          localRoot,
          defaultRemoteDir: '/srv/app'
        }
      })) as { id: string }

      await expect(
        invoke(SFTP_COMPARE_CHANNEL, {
          workspacePath: localRoot,
          profileId: saved.id,
          localPath: join(localRoot, 'blob.bin')
        })
      ).rejects.toThrow('compare-binary-refused')
    })
  })

  describe('host-key prompt flow', () => {
    it('detours through host-key-required and persists acceptance', async () => {
      remoteTree['/srv/app'] = { type: 'dir', children: [] }
      writeFileSync(join(localRoot, 'up.txt'), 'x')
      const saved = (await invoke(SFTP_SAVE_PROFILE_CHANNEL, {
        workspacePath: localRoot,
        profile: {
          id: '',
          label: 'prod',
          targetId: 'ssh-1',
          localRoot,
          defaultRemoteDir: '/srv/app'
        }
      })) as { id: string }

      let capturedOps: { confirmHostKey: (k: string, f: string) => Promise<boolean> } | undefined
      withSftpSessionMock.mockImplementation(
        (
          _target: unknown,
          ops: { confirmHostKey: (k: string, f: string) => Promise<boolean> },
          operation: (s: SFTPWrapper) => Promise<unknown>
        ) => {
          capturedOps = ops
          return ops
            .confirmHostKey('10.0.0.5:22', 'abc123')
            .then((accepted) =>
              accepted ? Promise.resolve(operation(fakeSftp())) : Promise.reject(new Error('nope'))
            )
        }
      )

      const pending = invoke(SFTP_UPLOAD_CHANNEL, {
        workspacePath: localRoot,
        profileId: saved.id,
        localPath: join(localRoot, 'up.txt')
      })

      await vi.waitFor(() => expect(capturedOps).toBeDefined())
      await vi.waitFor(() =>
        expect(sendMock).toHaveBeenCalledWith(SFTP_HOST_KEY_REQUIRED_CHANNEL, {
          hostKey: '10.0.0.5:22',
          fingerprint: 'abc123'
        })
      )
      await invoke(SFTP_CONFIRM_HOST_KEY_CHANNEL, {
        hostKey: '10.0.0.5:22',
        fingerprint: 'abc123',
        accepted: true
      })

      const result = (await pending) as { outcomes: { ok: boolean }[] }
      expect(result.outcomes[0]?.ok).toBe(true)
      expect(storeMock.setSftpHostTrust).toHaveBeenCalledWith('10.0.0.5:22', 'abc123')
    })

    it('clear-host-trust forwards to the store', async () => {
      await invoke(SFTP_CLEAR_HOST_TRUST_CHANNEL, { hostKey: '10.0.0.5:22' })
      expect(storeMock.clearSftpHostTrust).toHaveBeenCalledWith('10.0.0.5:22')
    })
  })

  describe('cancel', () => {
    it('cancels an in-flight transfer by id', async () => {
      remoteTree['/srv/app'] = { type: 'dir', children: [] }
      writeFileSync(join(localRoot, 'up.txt'), 'x')
      const saved = (await invoke(SFTP_SAVE_PROFILE_CHANNEL, {
        workspacePath: localRoot,
        profile: {
          id: '',
          label: 'prod',
          targetId: 'ssh-1',
          localRoot,
          defaultRemoteDir: '/srv/app'
        }
      })) as { id: string }

      let releaseSession: (() => void) | undefined
      withSftpSessionMock.mockImplementation(
        (_t: unknown, _o: unknown, operation: (s: SFTPWrapper) => Promise<unknown>) =>
          new Promise((resolve) => {
            releaseSession = () => resolve(operation(fakeSftp()))
          })
      )

      const pending = invoke(SFTP_UPLOAD_CHANNEL, {
        workspacePath: localRoot,
        profileId: saved.id,
        localPath: join(localRoot, 'up.txt')
      })

      let transferId = ''
      await vi.waitFor(() => {
        const progress = sendMock.mock.calls.find((c) => c[0] === SFTP_TRANSFER_PROGRESS_CHANNEL)
        expect(progress).toBeDefined()
        transferId = (progress![1] as { transferId: string }).transferId
      })

      await invoke(SFTP_CANCEL_TRANSFER_CHANNEL, { transferId })
      releaseSession?.()

      const result = (await pending) as { cancelled: boolean }
      expect(result.cancelled).toBe(true)
    })
  })
})
