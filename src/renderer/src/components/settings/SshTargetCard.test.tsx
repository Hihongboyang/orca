// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../../../shared/ssh-types'
import { i18n } from '../../i18n/i18n'
import { TooltipProvider } from '../ui/tooltip'
import { SshTargetCard } from './SshTargetCard'

const baseTarget: SshTarget = {
  id: 'ssh-1',
  label: 'prod',
  host: '10.0.0.5',
  port: 22,
  username: 'deploy'
}

function renderCard(
  target: SshTarget,
  callbacks: Partial<React.ComponentProps<typeof SshTargetCard>> = {}
): void {
  const noop = vi.fn()
  render(
    <TooltipProvider>
      <SshTargetCard
        target={target}
        state={undefined}
        testing={false}
        onConnect={noop}
        onDisconnect={noop}
        onTerminateSessions={noop}
        onResetRelay={noop}
        onTest={noop}
        onEdit={noop}
        onRemove={noop}
        onClearRememberedCredential={noop}
        {...callbacks}
      />
    </TooltipProvider>
  )
}

describe('SshTargetCard clear remembered credential', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(cleanup)

  it('hides the clear-credential action when nothing is remembered', () => {
    renderCard(baseTarget)
    expect(screen.queryByLabelText('Clear remembered credential')).toBeNull()
  })

  it('shows the action when the target has a remembered credential', () => {
    renderCard({ ...baseTarget, hasRememberedCredential: true })
    expect(screen.getByLabelText('Clear remembered credential')).toBeTruthy()
  })

  it('clears the credential on click', () => {
    const onClearRememberedCredential = vi.fn()
    renderCard({ ...baseTarget, hasRememberedCredential: true }, { onClearRememberedCredential })
    fireEvent.click(screen.getByLabelText('Clear remembered credential'))
    expect(onClearRememberedCredential).toHaveBeenCalledWith('ssh-1')
  })
})
