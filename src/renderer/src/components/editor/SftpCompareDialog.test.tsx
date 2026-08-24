// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n/i18n'
import { SftpCompareDialog } from './SftpCompareDialog'

const { readRuntimeFileContentMock, diffViewerProps } = vi.hoisted(() => ({
  readRuntimeFileContentMock: vi.fn(),
  diffViewerProps: [] as unknown[]
}))

vi.mock('@/runtime/runtime-file-client', () => ({
  readRuntimeFileContent: readRuntimeFileContentMock
}))

// Why: DiffViewer lazy-loads CodeMirror; stub it and capture its props.
vi.mock('./DiffViewer', () => ({
  default: (props: unknown) => {
    diffViewerProps.push(props)
    return <div data-diff-viewer-stub="" />
  }
}))

describe('SftpCompareDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    readRuntimeFileContentMock.mockReset()
    diffViewerProps.length = 0
  })

  afterEach(cleanup)

  it('renders local vs remote content through the DiffViewer pattern', async () => {
    readRuntimeFileContentMock.mockResolvedValue({ content: 'local side' })

    render(
      <SftpCompareDialog
        open
        localPath="C:\\dev\\app\\src\\main.ts"
        remoteContent="remote side"
        profileLabel="prod"
        onClose={vi.fn()}
      />
    )

    await waitFor(() => expect(diffViewerProps.length).toBeGreaterThan(0))
    expect(readRuntimeFileContentMock).toHaveBeenCalled()
    expect(screen.getByText(/main\.ts/)).toBeTruthy()
    const props = diffViewerProps[0] as { originalContent?: string; modifiedContent?: string }
    expect(props.originalContent).toBe('local side')
    expect(props.modifiedContent).toBe('remote side')
  })

  it('surfaces a local read failure inline', async () => {
    readRuntimeFileContentMock.mockRejectedValue(new Error('locked'))

    render(
      <SftpCompareDialog
        open
        localPath="C:\\dev\\app\\src\\main.ts"
        remoteContent="remote side"
        profileLabel="prod"
        onClose={vi.fn()}
      />
    )

    await waitFor(() => expect(screen.getByText(/locked/)).toBeTruthy())
    expect(diffViewerProps).toHaveLength(0)
  })
})
