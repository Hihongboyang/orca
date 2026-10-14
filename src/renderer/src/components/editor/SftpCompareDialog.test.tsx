// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SftpWorkspaceProfile } from '../../../../shared/sftp-types'
import type * as DisposalModule from './diff-monaco-model-disposal'
import { i18n } from '../../i18n/i18n'
import { SftpCompareDialog } from './SftpCompareDialog'

const { readRuntimeFileContentMock, diffViewerProps, disposeByPrefixMock } = vi.hoisted(() => ({
  readRuntimeFileContentMock: vi.fn(),
  diffViewerProps: [] as Record<string, unknown>[],
  disposeByPrefixMock: vi.fn()
}))

vi.mock('@/runtime/runtime-file-read-client', () => ({
  readRuntimeFileContent: readRuntimeFileContentMock
}))

// Why: DiffViewer lazy-loads Monaco; stub it and capture its props.
vi.mock('./DiffViewer', () => ({
  default: (props: Record<string, unknown>) => {
    diffViewerProps.push(props)
    return <div data-diff-viewer-stub="" />
  }
}))

vi.mock('@/lib/monaco-setup', () => ({
  monaco: { editor: { getModels: () => [] }, Uri: { parse: (value: string) => value } }
}))

vi.mock('./diff-monaco-model-disposal', async (importOriginal) => {
  const original = await importOriginal<typeof DisposalModule>()
  return {
    ...original,
    disposeUnattachedMonacoModelsByPathPrefixes: disposeByPrefixMock
  }
})

const profile: SftpWorkspaceProfile = {
  id: 'profile-1',
  label: 'prod',
  targetId: 'ssh-1',
  localRoot: 'C:\\dev\\app',
  defaultRemoteDir: '/srv/app'
}

const LOCAL_PATH = 'C:\\dev\\app\\src\\main.ts'
const WORKSPACE_PATH = 'C:\\dev\\app'

function renderDialog(overrides: Partial<Parameters<typeof SftpCompareDialog>[0]> = {}) {
  return render(
    <SftpCompareDialog
      open
      sessionKey={1}
      localPath={LOCAL_PATH}
      remoteContent="remote side"
      profile={profile}
      workspacePath={WORKSPACE_PATH}
      onClose={vi.fn()}
      {...overrides}
    />
  )
}

describe('SftpCompareDialog', () => {
  const saveRemoteMock = vi.fn()

  beforeEach(async () => {
    await i18n.changeLanguage('en')
    readRuntimeFileContentMock.mockReset()
    diffViewerProps.length = 0
    disposeByPrefixMock.mockReset()
    saveRemoteMock.mockReset()
    globalThis.window.api = { sftp: { saveRemote: saveRemoteMock } } as unknown as Window['api']
  })

  afterEach(cleanup)

  it('renders local vs remote content through the DiffViewer pattern', async () => {
    readRuntimeFileContentMock.mockResolvedValue({ content: 'local side' })

    renderDialog()

    await waitFor(() => expect(diffViewerProps.length).toBeGreaterThan(0))
    expect(readRuntimeFileContentMock).toHaveBeenCalled()
    expect(screen.getByText(/main\.ts/)).toBeTruthy()
    const props = diffViewerProps[0] as { originalContent?: string; modifiedContent?: string }
    expect(props.originalContent).toBe('local side')
    expect(props.modifiedContent).toBe('remote side')
  })

  it('keys models per compare session so stale snapshots cannot be reused', async () => {
    readRuntimeFileContentMock.mockResolvedValue({ content: 'local side' })

    const first = renderDialog({ sessionKey: 1 })
    await waitFor(() => expect(diffViewerProps.length).toBeGreaterThan(0))
    first.unmount()

    renderDialog({ sessionKey: 2, remoteContent: 'fresh remote' })
    await waitFor(() => expect(diffViewerProps.length).toBeGreaterThan(1))

    const keyOf = (props: Record<string, unknown>): string => props.modelKey as string
    expect(keyOf(diffViewerProps[0])).toContain('sftp-compare:1:')
    expect(keyOf(diffViewerProps[1])).toContain('sftp-compare:2:')
    expect(keyOf(diffViewerProps[0])).not.toBe(keyOf(diffViewerProps[1]))
  })

  it('disposes the session models on unmount', async () => {
    readRuntimeFileContentMock.mockResolvedValue({ content: 'local side' })

    const view = renderDialog({ sessionKey: 7 })
    await waitFor(() => expect(diffViewerProps.length).toBeGreaterThan(0))
    disposeByPrefixMock.mockClear()
    view.unmount()

    await waitFor(() => expect(disposeByPrefixMock).toHaveBeenCalledTimes(1))
    const prefixes = (disposeByPrefixMock.mock.calls[0]?.[1] ?? []) as string[]
    expect(prefixes.some((prefix) => prefix.includes('sftp-compare~3A7'))).toBe(true)
  })

  it('saves the edited remote content through saveRemote and clears dirty state', async () => {
    readRuntimeFileContentMock.mockResolvedValue({ content: 'local side' })
    saveRemoteMock.mockResolvedValue({ bytesWritten: 12 })

    renderDialog()
    await waitFor(() => expect(diffViewerProps.length).toBeGreaterThan(0))
    const props = diffViewerProps[0] as {
      editable?: boolean
      onContentChange?: (content: string) => void
    }
    expect(props.editable).toBe(true)

    await act(async () => {
      props.onContentChange?.('edited remote')
    })
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(saveRemoteMock).toHaveBeenCalledTimes(1))
    expect(saveRemoteMock).toHaveBeenCalledWith({
      workspacePath: WORKSPACE_PATH,
      profileId: 'profile-1',
      localPath: LOCAL_PATH,
      content: 'edited remote'
    })
    await waitFor(() => expect(screen.getByText(/^saved$/i)).toBeTruthy())
  })

  it('forwards DiffViewer saves (Ctrl+S) with the latest buffer', async () => {
    readRuntimeFileContentMock.mockResolvedValue({ content: 'local side' })
    saveRemoteMock.mockResolvedValue({ bytesWritten: 12 })

    renderDialog()
    await waitFor(() => expect(diffViewerProps.length).toBeGreaterThan(0))
    const props = diffViewerProps[0] as {
      onContentChange?: (c: string) => void
      onSave?: (c: string) => void
    }

    await act(async () => {
      props.onContentChange?.('buffer one')
      props.onSave?.('buffer two')
    })
    await waitFor(() =>
      expect(saveRemoteMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'buffer two' })
      )
    )
  })

  it('surfaces a save failure inline and keeps the buffer', async () => {
    readRuntimeFileContentMock.mockResolvedValue({ content: 'local side' })
    saveRemoteMock.mockRejectedValue(new Error('sftp-error:host-key-rejected:nope'))

    renderDialog()
    await waitFor(() => expect(diffViewerProps.length).toBeGreaterThan(0))
    const props = diffViewerProps[0] as { onContentChange?: (content: string) => void }
    await act(async () => {
      props.onContentChange?.('edited remote')
    })
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(screen.getByText(/nope/i)).toBeTruthy())
  })

  it('drives hunk navigation and apply through the mounted diff editor', async () => {
    readRuntimeFileContentMock.mockResolvedValue({ content: 'local side' })
    const applyEdits = vi.fn()
    const setPosition = vi.fn()
    const revealLineInCenter = vi.fn()
    const remoteModel = {
      applyEdits,
      getLineCount: () => 2,
      getLineMaxColumn: () => 5,
      getValueInRange: () => 'b',
      getEOL: () => '\n'
    }
    const localModel = { ...remoteModel, applyEdits: vi.fn() }
    const diffEditorStub = {
      getLineChanges: () => [
        {
          originalStartLineNumber: 2,
          originalEndLineNumber: 2,
          modifiedStartLineNumber: 2,
          modifiedEndLineNumber: 2
        }
      ],
      getModel: () => ({ original: localModel, modified: remoteModel }),
      getModifiedEditor: () => ({
        getPosition: () => ({ lineNumber: 2, column: 1 }),
        hasTextFocus: () => true,
        setPosition,
        revealLineInCenter
      }),
      getOriginalEditor: () => ({ getPosition: () => null })
    }

    renderDialog()
    await waitFor(() => expect(diffViewerProps.length).toBeGreaterThan(0))
    const props = diffViewerProps[0] as { onDiffEditorReady?: (editor: unknown) => void }
    expect(typeof props.onDiffEditorReady).toBe('function')
    act(() => {
      props.onDiffEditorReady?.(diffEditorStub)
    })

    await userEvent.click(screen.getByRole('button', { name: /previous change/i }))
    expect(revealLineInCenter).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: /next change/i }))
    expect(revealLineInCenter).toHaveBeenCalledTimes(2)
    expect(setPosition).toHaveBeenCalledTimes(2)
    await userEvent.click(screen.getByRole('button', { name: /apply change/i }))
    expect(applyEdits).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: /apply all/i }))
    expect(applyEdits).toHaveBeenCalledTimes(2)
  })

  it('surfaces a local read failure inline', async () => {
    readRuntimeFileContentMock.mockRejectedValue(new Error('locked'))

    renderDialog()

    await waitFor(() => expect(screen.getByText(/locked/)).toBeTruthy())
    expect(diffViewerProps).toHaveLength(0)
  })
})
