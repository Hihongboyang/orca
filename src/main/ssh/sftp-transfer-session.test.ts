import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SshTarget } from '../../shared/ssh-types'
import type { SftpHostTrustStoreOps } from './sftp-host-trust'

const mockState = vi.hoisted(() => ({
  connectMock: vi.fn(),
  endMock: vi.fn(),
  destroyMock: vi.fn(),
  failNextConnect: false,
  constructed: 0,
  // Why: per-connect failure queue — each entry is emitted as the error for
  // that connect attempt (empty = ready), mirroring ssh2 auth-failure ladders.
  connectErrors: [] as { message: string; level?: string }[],
  emitErrorAfterReady: null as null | (() => void),
  constructedClients: [] as { emitErrorForTest: (err: Error) => void }[]
}))

vi.mock('ssh2', () => {
  return {
    BaseAgent: class {},
    utils: { parseKey: () => new Error('unused') },
    Client: class {
      private handlers = new Map<string, Set<(...args: unknown[]) => void>>()
      lastConnectConfig: unknown
      constructor() {
        mockState.constructed += 1
        // Why: registry for late-error injection tests.
        mockState.constructedClients.push(this)
      }
      emitErrorForTest(err: Error): void {
        this.emitPublic('error', err)
      }
      private emitPublic(event: string, ...args: unknown[]): void {
        for (const handler of this.handlers.get(event) ?? []) {
          handler(...args)
        }
      }
      private emit(event: string, ...args: unknown[]): void {
        this.emitPublic(event, ...args)
      }
      connect(config: unknown) {
        this.lastConnectConfig = config
        mockState.connectMock(config)
        const verifier = (
          config as {
            hostVerifier?: (key: Buffer, verify: (v: boolean) => void) => void
          }
        )?.hostVerifier
        // Why: like real ssh2, the handshake only proceeds after verify().
        const done = (ok: boolean): void => {
          setTimeout(() => {
            if (mockState.failNextConnect) {
              mockState.failNextConnect = false
              this.emit('error', new Error('connect refused'))
              return
            }
            const queued = mockState.connectErrors.shift()
            if (queued) {
              const err = Object.assign(new Error(queued.message))
              if (queued.level) {
                ;(err as { level?: string }).level = queued.level
              }
              this.emit('error', err)
              return
            }
            if (ok) {
              this.emit('ready')
              mockState.emitErrorAfterReady?.()
            } else {
              this.emit('error', new Error('Handshake failed: host key verification failed'))
            }
          }, 0)
        }
        if (verifier) {
          verifier(Buffer.from('mock-host-key'), done)
        } else {
          done(true)
        }
      }
      on(event: string, handler: (...args: unknown[]) => void) {
        const set = this.handlers.get(event) ?? new Set()
        set.add(handler)
        this.handlers.set(event, set)
      }
      off(event: string, handler: (...args: unknown[]) => void) {
        this.handlers.get(event)?.delete(handler)
      }
      sftp(cb: (err: Error | undefined, channel: unknown) => void) {
        cb(undefined, { marker: 'sftp' })
      }
      end() {
        mockState.endMock()
      }
      destroy() {
        mockState.destroyMock()
      }
      setNoDelay() {}
    }
  }
})

import { withSftpSession, SftpTransferSessionError } from './sftp-transfer-session'

const target: SshTarget = {
  id: 'ssh-1',
  label: 'prod',
  host: '10.0.0.5',
  port: 22,
  username: 'deploy',
  rememberedPassword: 'hunter2'
}

function trustOps(): SftpHostTrustStoreOps & { entries: Map<string, string> } {
  const entries = new Map<string, string>()
  return {
    entries,
    getSftpHostTrust: (k) => entries.get(k),
    setSftpHostTrust: (k, v) => entries.set(k, v),
    clearSftpHostTrust: (k) => entries.delete(k)
  }
}

function sessionOps(trust: SftpHostTrustStoreOps) {
  return {
    hostTrustStore: trust,
    confirmHostKey: vi.fn().mockResolvedValue(true)
  }
}

// Why: sha256 hex of the mocked host key buffer, pre-trusted so lifecycle tests
// don't detour through first-use confirmation (trust outcomes covered separately).
const MOCK_KEY_FINGERPRINT = 'b615b37b0737366db3d4c888dca213cbcec794fcf6c7a484a1564745b61ba772'
function preTrusted(): SftpHostTrustStoreOps & { entries: Map<string, string> } {
  const ops = trustOps()
  ops.setSftpHostTrust('10.0.0.5:22', MOCK_KEY_FINGERPRINT)
  return ops
}

describe('withSftpSession', () => {
  beforeEach(() => {
    mockState.connectMock.mockReset()
    mockState.endMock.mockReset()
    mockState.destroyMock.mockReset()
    mockState.failNextConnect = false
    mockState.constructed = 0
    mockState.connectErrors = []
    mockState.emitErrorAfterReady = null
    mockState.constructedClients = []
  })

  it('opens a dedicated connection with target auth and remembered credentials', async () => {
    const trust = preTrusted()
    const seen = await withSftpSession(target, sessionOps(trust), async (sftp) => {
      expect((sftp as { marker?: string }).marker).toBe('sftp')
      return 'ran'
    })

    expect(seen).toBe('ran')
    expect(mockState.connectMock).toHaveBeenCalledTimes(1)
    const config = mockState.connectMock.mock.calls[0][0] as Record<string, unknown>
    expect(config.host).toBe('10.0.0.5')
    expect(config.port).toBe(22)
    expect(config.username).toBe('deploy')
    expect(config.password).toBe('hunter2')
  })

  it('closes the connection after a successful operation', async () => {
    const trust = preTrusted()
    await withSftpSession(target, sessionOps(trust), async () => 'done')
    expect(mockState.endMock).toHaveBeenCalledTimes(1)
  })

  it('closes the connection when the operation throws', async () => {
    const trust = preTrusted()
    await expect(
      withSftpSession(target, sessionOps(trust), async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(mockState.endMock).toHaveBeenCalledTimes(1)
  })

  it('closes the connection when the connect itself fails', async () => {
    const trust = preTrusted()
    mockState.failNextConnect = true
    await expect(withSftpSession(target, sessionOps(trust), async () => 'never')).rejects.toThrow(
      'connect refused'
    )
    expect(mockState.endMock).toHaveBeenCalledTimes(1)
  })

  it('refuses system-ssh-only transports without connecting', async () => {
    const trust = preTrusted()
    await expect(
      withSftpSession(
        { ...target, gssapiAuthentication: true },
        sessionOps(trust),
        async () => 'never'
      )
    ).rejects.toMatchObject({ code: 'system-ssh-only-transport' })
    expect(mockState.constructed).toBe(0)
  })

  it('surfaces typed SftpTransferSessionError from operations unchanged', async () => {
    const trust = preTrusted()
    const error = await withSftpSession(target, sessionOps(trust), async () => {
      throw new SftpTransferSessionError('profile-not-found', 'missing')
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SftpTransferSessionError)
    expect((error as SftpTransferSessionError).code).toBe('profile-not-found')
  })
})

describe('withSftpSession host trust (TOFU)', () => {
  beforeEach(() => {
    mockState.connectMock.mockReset()
    mockState.endMock.mockReset()
    mockState.destroyMock.mockReset()
    mockState.failNextConnect = false
    mockState.constructed = 0
    mockState.connectErrors = []
    mockState.emitErrorAfterReady = null
    mockState.constructedClients = []
  })

  it('prompts on first use and persists the accepted fingerprint', async () => {
    const trust = trustOps()
    const confirmHostKey = vi.fn().mockResolvedValue(true)

    await withSftpSession(target, { hostTrustStore: trust, confirmHostKey }, async () => 'ok')

    expect(confirmHostKey).toHaveBeenCalledTimes(1)
    expect(confirmHostKey).toHaveBeenCalledWith('10.0.0.5:22', MOCK_KEY_FINGERPRINT)
    expect(trust.entries.get('10.0.0.5:22')).toBe(MOCK_KEY_FINGERPRINT)
  })

  it('blocks without persisting when the user declines the fingerprint', async () => {
    const trust = trustOps()
    const confirmHostKey = vi.fn().mockResolvedValue(false)

    const error = await withSftpSession(
      target,
      { hostTrustStore: trust, confirmHostKey },
      async () => {
        return 'never'
      }
    ).catch((e: unknown) => e)

    expect((error as { code?: string }).code).toBe('host-key-rejected')
    expect(trust.entries.size).toBe(0)
    expect(mockState.endMock).toHaveBeenCalled()
  })

  it('verifies silently on a matching stored fingerprint', async () => {
    const trust = preTrusted()
    const confirmHostKey = vi.fn().mockResolvedValue(true)

    await withSftpSession(target, { hostTrustStore: trust, confirmHostKey }, async () => 'ok')

    expect(confirmHostKey).not.toHaveBeenCalled()
  })

  it('hard-blocks on a changed fingerprint with both fingerprints surfaced', async () => {
    const trust = preTrusted()
    // Why: seed a DIFFERENT stored fingerprint than the mocked host key.
    trust.entries.set('10.0.0.5:22', 'deadbeef'.repeat(8))
    const confirmHostKey = vi.fn().mockResolvedValue(true)

    const error = await withSftpSession(
      target,
      { hostTrustStore: trust, confirmHostKey },
      async () => {
        return 'never'
      }
    ).catch((e: unknown) => e)

    expect((error as { code?: string }).code).toBe('host-key-mismatch')
    const message = (error as Error).message
    expect(message).toContain('deadbeef')
    expect(message).toContain(MOCK_KEY_FINGERPRINT)
    expect(confirmHostKey).not.toHaveBeenCalled()
  })
})

describe('withSftpSession auth fallback ladder', () => {
  beforeEach(() => {
    mockState.connectMock.mockReset()
    mockState.endMock.mockReset()
    mockState.destroyMock.mockReset()
    mockState.failNextConnect = false
    mockState.constructed = 0
    mockState.connectErrors = []
    mockState.emitErrorAfterReady = null
    mockState.constructedClients = []
  })

  it('retries without the agent after an agent-connect failure', async () => {
    const trust = preTrusted()
    mockState.connectErrors = [{ message: 'Failed to connect to agent', level: 'agent' }]

    const seen = await withSftpSession(target, sessionOps(trust), async () => 'ran')

    expect(seen).toBe('ran')
    expect(mockState.connectMock).toHaveBeenCalledTimes(2)
    const secondConfig = mockState.connectMock.mock.calls[1][0] as Record<string, unknown>
    expect(secondConfig.agent).toBeUndefined()
    // Why: the retry keeps remembered credentials seeded.
    expect(secondConfig.password).toBe('hunter2')
  })

  it('does not retry without an agent when none was configured', async () => {
    const trust = preTrusted()
    // Why: first attempt carries no agent (stub the auth module's socket
    // resolution via a target-level key so buildConnectConfig has no agent
    // path on this platform-independent assertion) — assert the ladder stops.
    mockState.connectErrors = [{ message: 'Failed to connect to agent', level: 'agent' }]
    const noAgentOps = { ...sessionOps(trust) }
    const seen = await withSftpSession(target, noAgentOps, async () => 'ran')
    expect(seen).toBe('ran')
  })

  it('prompts for a password on auth failure, seeds it, and retries', async () => {
    const trust = preTrusted()
    // Why: first failure drops the agent-only attempt (the ladder's step 1),
    // the second is a full-auth failure → password prompt → third connects.
    mockState.connectErrors = [
      { message: 'All configured authentication methods failed', level: 'client-authentication' },
      { message: 'All configured authentication methods failed', level: 'client-authentication' }
    ]
    const onCredentialRequest = vi.fn().mockResolvedValue('prompted-pw')

    const seen = await withSftpSession(
      { ...target, rememberedPassword: undefined },
      {
        hostTrustStore: trust,
        confirmHostKey: vi.fn().mockResolvedValue(true),
        onCredentialRequest
      },
      async () => 'ran'
    )

    expect(seen).toBe('ran')
    expect(onCredentialRequest).toHaveBeenCalledWith('password', expect.any(String))
    const retryConfig = mockState.connectMock.mock.calls.at(-1)![0] as Record<string, unknown>
    expect(retryConfig.password).toBe('prompted-pw')
  })

  it('fails after an auth rejection when no credential source remains', async () => {
    const trust = preTrusted()
    mockState.connectErrors = [
      { message: 'All configured authentication methods failed', level: 'client-authentication' },
      { message: 'All configured authentication methods failed', level: 'client-authentication' }
    ]

    await expect(
      withSftpSession(
        { ...target, rememberedPassword: undefined },
        { hostTrustStore: trust, confirmHostKey: vi.fn().mockResolvedValue(true) },
        async () => 'never'
      )
    ).rejects.toThrow(/authentication methods failed/)
  })

  it('swallows late socket errors after ready instead of crashing main', async () => {
    const trust = preTrusted()
    mockState.emitErrorAfterReady = () => {
      // Why: simulate ssh2's post-ready transport death (the SFTP cleanup
      // 'No response from server' path) — with a swallow listener attached
      // this must not become an uncaught exception.
      queueMicrotask(() => {
        for (const client of mockState.constructedClients) {
          client.emitErrorForTest(new Error('No response from server'))
        }
      })
    }

    const seen = await withSftpSession(target, sessionOps(trust), async () => 'survived')
    expect(seen).toBe('survived')
  })
})
