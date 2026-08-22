// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n/i18n'
import { useAppStore } from '../../store'
import { SshPassphraseDialog } from './SshPassphraseDialog'

const submitCredentialMock = vi.fn().mockResolvedValue(undefined)

function queuePasswordRequest(): void {
  useAppStore.setState({
    sshCredentialQueue: [
      { requestId: 'req-1', targetId: 'ssh-1', kind: 'password', detail: '10.0.0.5' }
    ],
    sshTargetLabels: new Map([['ssh-1', 'prod']]),
    removeSshCredentialRequest: vi.fn()
  })
}

describe('SshPassphraseDialog remember checkbox', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    submitCredentialMock.mockClear().mockResolvedValue(undefined)
    ;(window as { api?: unknown }).api = { ssh: { submitCredential: submitCredentialMock } }
    queuePasswordRequest()
  })

  afterEach(cleanup)

  it('renders the remember checkbox unchecked by default (opt-in)', () => {
    render(<SshPassphraseDialog />)
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
  })

  it('submits without remember by default', async () => {
    render(<SshPassphraseDialog />)
    fireEvent.change(screen.getByLabelText(/Password for/), { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    await vi.waitFor(() => expect(submitCredentialMock).toHaveBeenCalledTimes(1))
    expect(submitCredentialMock).toHaveBeenCalledWith({
      requestId: 'req-1',
      value: 'hunter2',
      remember: false
    })
  })

  it('submits with remember when the checkbox is checked', async () => {
    render(<SshPassphraseDialog />)
    fireEvent.change(screen.getByLabelText(/Password for/), { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    await vi.waitFor(() => expect(submitCredentialMock).toHaveBeenCalledTimes(1))
    expect(submitCredentialMock).toHaveBeenCalledWith({
      requestId: 'req-1',
      value: 'hunter2',
      remember: true
    })
  })

  it('cancel submits null without remember', async () => {
    render(<SshPassphraseDialog />)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await vi.waitFor(() => expect(submitCredentialMock).toHaveBeenCalledTimes(1))
    expect(submitCredentialMock).toHaveBeenCalledWith({
      requestId: 'req-1',
      value: null,
      remember: false
    })
  })

  it('resets the checkbox for a new request', () => {
    const { rerender } = render(<SshPassphraseDialog />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)

    useAppStore.setState({
      sshCredentialQueue: [
        { requestId: 'req-2', targetId: 'ssh-1', kind: 'passphrase', detail: '~/.ssh/id_ed25519' }
      ]
    })
    rerender(<SshPassphraseDialog />)
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  })
})
