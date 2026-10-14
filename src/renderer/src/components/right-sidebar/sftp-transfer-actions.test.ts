// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SftpWorkspaceProfile } from '../../../../shared/sftp-types'
import type { SftpSlice } from '../../store/slices/sftp'
import { runSftpExplorerAction } from './sftp-transfer-actions'

const { stateMock, compareMock, uploadMock, downloadMock } = vi.hoisted(() => ({
  stateMock: vi.fn(),
  compareMock: vi.fn(),
  uploadMock: vi.fn(),
  downloadMock: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: stateMock
  }
}))

const profile: SftpWorkspaceProfile = {
  id: 'profile-1',
  label: 'prod',
  targetId: 'ssh-1',
  localRoot: 'C:\\dev\\app',
  defaultRemoteDir: '/srv/app'
}

function storeSlice(overrides: Partial<SftpSlice>): SftpSlice {
  return {
    beginSftpTransferCard: vi.fn(),
    updateSftpTransferProgress: vi.fn(),
    finishSftpTransfer: vi.fn(),
    failSftpTransfer: vi.fn(),
    setSftpActionError: vi.fn(),
    ...overrides
  } as SftpSlice
}

describe('runSftpExplorerAction error dialog', () => {
  const setSftpActionError = vi.fn()

  beforeEach(() => {
    compareMock.mockReset()
    uploadMock.mockReset()
    downloadMock.mockReset()
    setSftpActionError.mockReset()
    globalThis.window.api = {
      sftp: { compare: compareMock, upload: uploadMock, download: downloadMock }
    } as unknown as Window['api']
  })

  async function run(action: 'upload' | 'download' | 'compare'): Promise<void> {
    stateMock.mockReturnValue(storeSlice({ setSftpActionError }))
    await runSftpExplorerAction({
      action,
      profile,
      workspacePath: 'C:\\dev\\app',
      localPath: 'C:\\dev\\app\\src\\main.ts'
    })
  }

  it('raises the error dialog when compare rejects', async () => {
    compareMock.mockRejectedValue(new Error('sftp-error:compare-file-too-large:too big'))

    await run('compare')

    expect(setSftpActionError).toHaveBeenCalledWith({
      code: 'compare-file-too-large',
      message: 'too big'
    })
  })

  it('raises the error dialog when upload rejects', async () => {
    uploadMock.mockRejectedValue(new Error('sftp-error:outside-local-root:not under root'))

    await run('upload')

    expect(setSftpActionError).toHaveBeenCalledWith({
      code: 'outside-local-root',
      message: 'not under root'
    })
  })

  it('raises the error dialog when download rejects with an unparsed error', async () => {
    downloadMock.mockRejectedValue(new Error('boom'))

    await run('download')

    expect(setSftpActionError).toHaveBeenCalledWith({ code: '', message: 'boom' })
  })

  it('skips the dialog for host-key-mismatch (dedicated dialog covers it)', async () => {
    uploadMock.mockRejectedValue(
      new Error('sftp-error:host-key-mismatch:Host key for h:22 changed')
    )

    await run('upload')

    expect(setSftpActionError).not.toHaveBeenCalled()
  })
})
