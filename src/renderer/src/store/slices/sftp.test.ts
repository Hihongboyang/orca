import { describe, expect, it } from 'vitest'
import type { SftpWorkspaceProfile } from '../../../../shared/sftp-types'
import { createTestStore } from './store-test-helpers'

const profile: SftpWorkspaceProfile = {
  id: 'p1',
  label: 'prod',
  targetId: 'ssh-1',
  localRoot: 'C:\\dev\\app',
  defaultRemoteDir: '/srv/app'
}

describe('createSftpSlice', () => {
  it('caches profiles per workspace path', () => {
    const store = createTestStore()
    store.getState().setSftpProfiles('/ws/a', [profile])
    store.getState().setSftpProfiles('/ws/b', [])

    expect(store.getState().sftpProfilesByWorkspace['/ws/a']).toEqual([profile])
    expect(store.getState().getSftpProfiles('/ws/b')).toEqual([])
    expect(store.getState().getSftpProfiles('/ws/a')).toHaveLength(1)
  })

  it('tracks an in-flight transfer from connecting through progress', () => {
    const store = createTestStore()
    store.getState().beginSftpTransferCard({
      transferId: 't1',
      direction: 'upload',
      profileLabel: 'prod'
    })

    expect(store.getState().sftpTransferCards).toHaveLength(1)
    expect(store.getState().sftpTransferCards[0]).toMatchObject({
      transferId: 't1',
      phase: 'connecting',
      cancelled: false
    })

    store.getState().updateSftpTransferProgress({
      transferId: 't1',
      phase: 'transferring',
      filesDone: 3,
      filesTotal: 10,
      currentPath: 'C:\\dev\\app\\src\\main.ts'
    })

    expect(store.getState().sftpTransferCards[0]).toMatchObject({
      phase: 'transferring',
      filesDone: 3,
      filesTotal: 10
    })
  })

  it('records completion summary with the cancelled flag', () => {
    const store = createTestStore()
    store.getState().beginSftpTransferCard({
      transferId: 't1',
      direction: 'download',
      profileLabel: 'prod'
    })
    store.getState().finishSftpTransfer({
      transferId: 't1',
      cancelled: true,
      outcomes: [
        { path: 'a.txt', ok: true },
        { path: 'b.txt', ok: false, error: 'nope' }
      ]
    })

    const card = store.getState().sftpTransferCards[0]
    expect(card.phase).toBe('done')
    expect(card.cancelled).toBe(true)
    expect(card.outcomes).toHaveLength(2)
  })

  it('records a pre-start error on the card', () => {
    const store = createTestStore()
    store.getState().beginSftpTransferCard({
      transferId: 't2',
      direction: 'upload',
      profileLabel: 'prod'
    })
    store.getState().failSftpTransfer('t2', 'outside-local-root')

    expect(store.getState().sftpTransferCards[0]).toMatchObject({
      phase: 'done',
      error: 'outside-local-root'
    })
  })

  it('dismisses a card and keeps others', () => {
    const store = createTestStore()
    store
      .getState()
      .beginSftpTransferCard({ transferId: 't1', direction: 'upload', profileLabel: 'a' })
    store
      .getState()
      .beginSftpTransferCard({ transferId: 't2', direction: 'download', profileLabel: 'b' })
    store.getState().dismissSftpTransferCard('t1')

    expect(store.getState().sftpTransferCards.map((c) => c.transferId)).toEqual(['t2'])
  })

  it('ignores progress for unknown transfers', () => {
    const store = createTestStore()
    store.getState().updateSftpTransferProgress({
      transferId: 'ghost',
      phase: 'transferring',
      filesDone: 1,
      filesTotal: 1,
      currentPath: 'x'
    })
    expect(store.getState().sftpTransferCards).toHaveLength(0)
  })
})

describe('card identity survives transferId adoption', () => {
  it('fails the card by the original requestId after progress adopted the main transferId', () => {
    const store = createTestStore()
    store.getState().beginSftpTransferCard({
      transferId: 'req-1',
      direction: 'upload',
      profileLabel: 'prod'
    })
    store.getState().updateSftpTransferProgress({
      transferId: 'main-1',
      requestId: 'req-1',
      phase: 'connecting',
      filesDone: 0,
      filesTotal: 0,
      currentPath: 'x'
    })
    // Why: adoption must not erase the requestId identity — the failure path
    // only knows the requestId.
    expect(store.getState().sftpTransferCards[0]).toMatchObject({ transferId: 'main-1' })

    store.getState().failSftpTransfer('req-1', 'Permission denied')

    const card = store.getState().sftpTransferCards[0]
    expect(card.phase).toBe('done')
    expect(card.error).toBe('Permission denied')
  })
})
