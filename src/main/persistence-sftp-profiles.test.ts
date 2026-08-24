import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDefaultPersistedState } from '../shared/constants'
import type { SftpWorkspaceProfile } from '../shared/sftp-types'
import { testState, createStore, writeDataFile, readDataFile } from './persistence-test-harness'

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => {
      const decoded = ciphertext.toString('utf-8')
      if (!decoded.startsWith('encrypted:')) {
        throw new Error('invalid ciphertext')
      }
      return decoded.slice('encrypted:'.length)
    }
  }
}))

const profile = (overrides: Partial<SftpWorkspaceProfile> = {}): SftpWorkspaceProfile => ({
  id: 'p1',
  label: 'prod',
  targetId: 'ssh-1',
  localRoot: 'C:/dev/app',
  defaultRemoteDir: '/srv/app',
  ...overrides
})

describe('Store SFTP state', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-sftp-persist-'))
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('round-trips sftp-profiles keyed by workspace path through disk', async () => {
    const store = await createStore()
    const saved = store.saveSftpProfile('/ws/a', profile({ id: '' }))
    expect(saved.id).not.toBe('')
    store.saveSftpProfile('/ws/a', profile({ id: 'p2', label: 'staging' }))
    expect(store.getSftpProfiles('/ws/b')).toEqual([])

    await store.waitForPendingWrite()
    store.flush()
    const persisted = readDataFile() as Record<string, unknown>
    expect((persisted['sftp-profiles'] as Record<string, unknown[]>)['/ws/a']).toHaveLength(2)

    const reloaded = await createStore()
    expect(
      reloaded
        .getSftpProfiles('/ws/a')
        .map((p) => p.label)
        .sort()
    ).toEqual(['prod', 'staging'])

    reloaded.deleteSftpProfile('/ws/a', saved.id)
    reloaded.flush()
    const afterDelete = readDataFile() as Record<string, unknown>
    expect((afterDelete['sftp-profiles'] as Record<string, unknown[]>)['/ws/a']).toHaveLength(1)
  })

  it('round-trips and clears the sftp-host-trust store', async () => {
    const store = await createStore()
    expect(store.getSftpHostTrust('10.0.0.5:22')).toBeUndefined()

    store.setSftpHostTrust('10.0.0.5:22', 'a1b2c3')
    store.setSftpHostTrust('10.1.0.9:2222', 'd4e5f6')
    store.flush()
    const persisted = readDataFile() as Record<string, unknown>
    expect(persisted['sftp-host-trust']).toEqual({
      '10.0.0.5:22': 'a1b2c3',
      '10.1.0.9:2222': 'd4e5f6'
    })

    const reloaded = await createStore()
    expect(reloaded.getSftpHostTrust('10.1.0.9:2222')).toBe('d4e5f6')
    reloaded.clearSftpHostTrust('10.0.0.5:22')
    reloaded.flush()
    const afterClear = readDataFile() as Record<string, unknown>
    expect(afterClear['sftp-host-trust']).toEqual({ '10.1.0.9:2222': 'd4e5f6' })
  })

  it('encrypts remembered SSH credentials through protected-secret slots', async () => {
    const store = await createStore()
    store.addSshTarget({
      id: 'ssh-cred-1',
      label: 'cred host',
      host: '10.0.0.5',
      port: 22,
      username: 'deploy',
      rememberedPassword: 'hunter2-secret',
      rememberedPassphrase: 'open-sesame'
    })

    expect(store.getSshTarget('ssh-cred-1')?.rememberedPassword).toBe('hunter2-secret')

    store.flush()
    const rawDisk = readFileSync(join(testState.dir, 'orca-data.json'), 'utf-8')
    expect(rawDisk).not.toContain('hunter2-secret')
    expect(rawDisk).not.toContain('open-sesame')

    const reloaded = await createStore()
    expect(reloaded.getSshTarget('ssh-cred-1')?.rememberedPassword).toBe('hunter2-secret')
    expect(reloaded.getSshTarget('ssh-cred-1')?.rememberedPassphrase).toBe('open-sesame')
  })

  it('treats undecryptable remembered credentials as absent', async () => {
    mkdirSync(testState.dir, { recursive: true })
    writeDataFile({
      ...getDefaultPersistedState(testState.dir),
      sshTargets: [
        {
          id: 'ssh-garbage',
          label: 'garbage cred host',
          host: '10.0.0.5',
          port: 22,
          username: 'deploy',
          rememberedPassword: Buffer.from('garbage-ciphertext', 'utf-8').toString('base64'),
          rememberedPassphrase: Buffer.from('encrypted:also-not-valid').toString('base64')
        }
      ]
    })

    const store = await createStore()
    const target = store.getSshTarget('ssh-garbage')
    expect(target?.rememberedPassword).toBeUndefined()
    expect(target?.rememberedPassphrase).toBeUndefined()
    expect(target?.host).toBe('10.0.0.5')
  })
})
