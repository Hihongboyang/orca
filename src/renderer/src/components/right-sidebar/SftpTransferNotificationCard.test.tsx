// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SftpTransferCard } from '../../store/slices/sftp'
import { i18n } from '../../i18n/i18n'
import { SftpTransferNotificationCard } from './SftpTransferNotificationCard'

const cancelTransferMock = vi.fn().mockResolvedValue(undefined)

function baseCard(overrides: Partial<SftpTransferCard>): SftpTransferCard {
  return {
    transferId: 't1',
    direction: 'upload',
    profileLabel: 'prod',
    phase: 'connecting',
    filesDone: 0,
    filesTotal: 0,
    currentPath: '',
    cancelled: false,
    error: null,
    outcomes: null,
    ...overrides
  }
}

describe('SftpTransferNotificationCard', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    cancelTransferMock.mockClear()
    ;(window as { api?: unknown }).api = { sftp: { cancelTransfer: cancelTransferMock } }
  })

  afterEach(cleanup)

  it('shows connecting with a cancel affordance', () => {
    render(
      <SftpTransferNotificationCard card={baseCard({ phase: 'connecting' })} onDismiss={vi.fn()} />
    )
    expect(screen.getByText(/Upload to prod/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeTruthy()
  })

  it('shows transferring with file counts and current path', () => {
    render(
      <SftpTransferNotificationCard
        card={baseCard({
          phase: 'transferring',
          filesDone: 42,
          filesTotal: 120,
          currentPath: 'C:\\dev\\app\\src\\main.ts'
        })}
        onDismiss={vi.fn()}
      />
    )
    expect(screen.getByText(/42\s*\/\s*120/)).toBeTruthy()
    expect(screen.getByText(/main\.ts/)).toBeTruthy()
  })

  it('shows the success summary while in flight has ended', () => {
    render(
      <SftpTransferNotificationCard
        card={baseCard({
          phase: 'done',
          outcomes: [
            { path: 'a', ok: true },
            { path: 'b', ok: true }
          ]
        })}
        onDismiss={vi.fn()}
      />
    )
    expect(screen.getByText(/2 succeeded/i)).toBeTruthy()
  })

  it('shows partial failure with failed paths', () => {
    render(
      <SftpTransferNotificationCard
        card={baseCard({
          phase: 'done',
          outcomes: [
            { path: 'ok1.txt', ok: true },
            { path: 'bad.txt', ok: false, error: 'nope' },
            { path: 'bad2.txt', ok: false, error: 'nope' }
          ]
        })}
        onDismiss={vi.fn()}
      />
    )
    expect(screen.getByText(/1 succeeded \/ 2 failed/i)).toBeTruthy()
    expect(screen.getByText(/bad\.txt/)).toBeTruthy()
    expect(screen.getByText(/bad2\.txt/)).toBeTruthy()
  })

  it('shows the cancelled summary', () => {
    render(
      <SftpTransferNotificationCard
        card={baseCard({
          phase: 'done',
          cancelled: true,
          outcomes: [{ path: 'a', ok: true }]
        })}
        onDismiss={vi.fn()}
      />
    )
    expect(screen.getByText(/cancelled/i)).toBeTruthy()
  })

  it('shows a pre-start error line', () => {
    render(
      <SftpTransferNotificationCard
        card={baseCard({ phase: 'done', error: 'outside-local-root' })}
        onDismiss={vi.fn()}
      />
    )
    expect(screen.getByText(/outside-local-root/)).toBeTruthy()
  })

  it('cancel invokes the transfer cancel IPC', () => {
    render(
      <SftpTransferNotificationCard
        card={baseCard({ phase: 'transferring' })}
        onDismiss={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(cancelTransferMock).toHaveBeenCalledWith({ transferId: 't1' })
  })

  describe('clean-success auto-dismiss', () => {
    const cleanCard = baseCard({
      phase: 'done',
      outcomes: [{ path: 'a', ok: true }]
    })

    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('dismisses itself after the delay', () => {
      const onDismiss = vi.fn()
      render(<SftpTransferNotificationCard card={cleanCard} onDismiss={onDismiss} />)
      act(() => {
        vi.advanceTimersByTime(4000)
      })
      expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('pauses while hovered and restarts after the pointer leaves', () => {
      const onDismiss = vi.fn()
      const { container } = render(
        <SftpTransferNotificationCard card={cleanCard} onDismiss={onDismiss} />
      )
      const card = container.querySelector('[data-sftp-transfer-card]') as HTMLElement
      fireEvent.mouseEnter(card)
      act(() => {
        vi.advanceTimersByTime(4000)
      })
      expect(onDismiss).not.toHaveBeenCalled()
      fireEvent.mouseLeave(card)
      act(() => {
        vi.advanceTimersByTime(4000)
      })
      expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('never auto-dismisses a failed batch', () => {
      const onDismiss = vi.fn()
      render(
        <SftpTransferNotificationCard
          card={baseCard({
            phase: 'done',
            outcomes: [{ path: 'a', ok: false, error: 'nope' }]
          })}
          onDismiss={onDismiss}
        />
      )
      act(() => {
        vi.advanceTimersByTime(10_000)
      })
      expect(onDismiss).not.toHaveBeenCalled()
    })

    it('never auto-dismisses a cancelled batch', () => {
      const onDismiss = vi.fn()
      render(
        <SftpTransferNotificationCard
          card={baseCard({
            phase: 'done',
            cancelled: true,
            outcomes: [{ path: 'a', ok: true }]
          })}
          onDismiss={onDismiss}
        />
      )
      act(() => {
        vi.advanceTimersByTime(10_000)
      })
      expect(onDismiss).not.toHaveBeenCalled()
    })
  })
})
