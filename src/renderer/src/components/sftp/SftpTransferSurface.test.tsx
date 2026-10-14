// @vitest-environment happy-dom
import { useEffect, useReducer } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n/i18n'
import type { SftpActionError } from '../../store/slices/sftp'
import { SftpTransferSurface } from './SftpTransferSurface'

const { onTransferProgressMock, onHostKeyRequiredMock, setActionErrorMock, subscribeMock } =
  vi.hoisted(() => ({
    onTransferProgressMock: vi.fn(() => vi.fn()),
    onHostKeyRequiredMock: vi.fn(() => vi.fn()),
    setActionErrorMock: vi.fn<(error: { code: string; message: string } | null) => void>(),
    subscribeMock: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    })
  }))

const listeners = new Set<() => void>()

// Minimal zustand-shaped store: static snapshot, notify-on-write listeners.
let actionError: SftpActionError | null = null

vi.mock('@/store', () => ({
  useAppStore: (selector: (snapshot: unknown) => unknown): unknown =>
    selector({
      sftpTransferCards: [],
      sftpActionError: actionError,
      updateSftpTransferProgress: vi.fn(),
      dismissSftpTransferCard: vi.fn(),
      failSftpTransfer: vi.fn(),
      setSftpActionError: setActionErrorMock
    })
}))

function setActionError(next: SftpActionError | null): void {
  actionError = next
  listeners.forEach((listener) => listener())
}
setActionErrorMock.mockImplementation((next) => setActionError(next))

/** Re-render on store notifications so dialog open/close is observable. */
function SurfaceHarness(): React.JSX.Element {
  const [, forceUpdate] = useReducer((count: number): number => count + 1, 0)
  useEffect(() => {
    const unsubscribe = subscribeMock(() => forceUpdate())
    return () => {
      unsubscribe()
    }
  }, [])
  return <SftpTransferSurface />
}

describe('SftpTransferSurface action-error dialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    globalThis.window.api = {
      sftp: {
        onTransferProgress: onTransferProgressMock,
        onHostKeyRequired: onHostKeyRequiredMock,
        clearHostTrust: vi.fn().mockResolvedValue(undefined)
      }
    } as unknown as Window['api']
  })

  afterEach(cleanup)

  it('renders the error dialog with code-specific copy and clears on Close', async () => {
    setActionError({ code: 'compare-file-too-large', message: 'Remote file is 12 MB' })

    render(<SurfaceHarness />)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getByText(/10 MB/i)).toBeTruthy()
    expect(screen.getByText(/Remote file is 12 MB/)).toBeTruthy()

    await userEvent.click(screen.getAllByRole('button', { name: /close/i })[0])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('falls back to the raw message for unknown codes', async () => {
    setActionError({ code: 'weird-new-code', message: 'surprise' })

    render(<SurfaceHarness />)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getByText(/surprise/)).toBeTruthy()
  })

  it('renders no dialog while idle', () => {
    setActionError(null)

    render(<SurfaceHarness />)

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
