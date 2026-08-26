// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../../../shared/ssh-types'
import type { SftpWorkspaceProfile } from '../../../../shared/sftp-types'
import { i18n } from '../../i18n/i18n'
import { SftpProfilesSection } from './SftpProfilesSection'

const targets: SshTarget[] = [
  { id: 'ssh-1', label: 'prod', host: '10.0.0.5', port: 22, username: 'deploy' },
  { id: 'ssh-2', label: 'staging', host: '10.1.0.9', port: 22, username: 'deploy' }
]

const api = {
  listProfiles: vi.fn(),
  saveProfile: vi.fn(),
  deleteProfile: vi.fn(),
  onProfilesChanged: vi.fn()
}

function profilesChangedCapture(): (profiles: SftpWorkspaceProfile[]) => void {
  return api.onProfilesChanged.mock.calls[0]?.[0] as (profiles: SftpWorkspaceProfile[]) => void
}

const WORKSPACE_PATH = 'E:\\dev\\app'

describe('SftpProfilesSection', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    api.listProfiles.mockReset().mockResolvedValue([])
    api.saveProfile.mockReset().mockResolvedValue({} as SftpWorkspaceProfile)
    api.deleteProfile.mockReset().mockResolvedValue(undefined)
    api.onProfilesChanged.mockReset().mockReturnValue(() => {})
    ;(window as { api?: unknown }).api = { sftp: api }
  })

  afterEach(cleanup)

  it('shows the empty state with an add CTA when no profiles exist', async () => {
    api.listProfiles.mockResolvedValue([])
    render(<SftpProfilesSection workspacePath={WORKSPACE_PATH} targets={targets} />)
    await waitFor(() => expect(api.listProfiles).toHaveBeenCalled())
    expect(screen.getByText(/No SFTP profiles/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Add profile/i })).toBeTruthy()
  })

  it('lists profiles with target disambiguation', async () => {
    api.listProfiles.mockResolvedValue([
      {
        id: 'p1',
        label: 'prod',
        targetId: 'ssh-1',
        localRoot: 'E:\\dev\\app\\src',
        defaultRemoteDir: '/srv/app'
      }
    ])
    render(<SftpProfilesSection workspacePath={WORKSPACE_PATH} targets={targets} />)
    await waitFor(() => expect(screen.getByText('prod')).toBeTruthy())
    expect(screen.getByText(/deploy@10\.0\.0\.5/)).toBeTruthy()
  })

  it('blocks save with inline errors for a relative remote dir', async () => {
    render(<SftpProfilesSection workspacePath={WORKSPACE_PATH} targets={targets} />)
    fireEvent.click(screen.getByRole('button', { name: /Add profile/i }))

    fireEvent.change(screen.getByLabelText(/Label/i), { target: { value: 'prod' } })
    fireEvent.change(screen.getByLabelText(/Target/i), { target: { value: 'ssh-1' } })
    fireEvent.change(screen.getByLabelText(/Local root/i), { target: { value: 'E:\\dev\\app' } })
    fireEvent.change(screen.getByLabelText(/Remote dir/i), { target: { value: 'srv/app' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }))

    expect(await screen.findByText(/absolute/i)).toBeTruthy()
    expect(api.saveProfile).not.toHaveBeenCalled()
  })

  it('blocks save when no target is selected', async () => {
    render(<SftpProfilesSection workspacePath={WORKSPACE_PATH} targets={targets} />)
    fireEvent.click(screen.getByRole('button', { name: /Add profile/i }))
    fireEvent.change(screen.getByLabelText(/Label/i), { target: { value: 'prod' } })
    fireEvent.change(screen.getByLabelText(/Local root/i), { target: { value: 'E:\\dev\\app' } })
    fireEvent.change(screen.getByLabelText(/Remote dir/i), { target: { value: '/srv/app' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }))

    expect(await screen.findByText(/Pick an SSH target/i)).toBeTruthy()
    expect(api.saveProfile).not.toHaveBeenCalled()
  })

  it('updates the list when sftp:profiles-changed fires', async () => {
    api.listProfiles.mockResolvedValue([])
    render(<SftpProfilesSection workspacePath={WORKSPACE_PATH} targets={targets} />)
    await waitFor(() => expect(api.onProfilesChanged).toHaveBeenCalled())

    profilesChangedCapture()([
      {
        id: 'p2',
        label: 'staging',
        targetId: 'ssh-2',
        localRoot: 'E:\\dev\\app',
        defaultRemoteDir: '/srv/stg'
      }
    ])
    await waitFor(() => expect(screen.getByText('staging')).toBeTruthy())
  })

  it('deletes a profile on a single click without a confirmation dialog', async () => {
    api.listProfiles.mockResolvedValue([
      {
        id: 'p1',
        label: 'prod',
        targetId: 'ssh-1',
        localRoot: 'E:\\dev\\app',
        defaultRemoteDir: '/srv/app'
      }
    ])
    render(<SftpProfilesSection workspacePath={WORKSPACE_PATH} targets={targets} />)
    await waitFor(() => expect(screen.getByText('prod')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Delete/i }))
    await waitFor(() => expect(api.deleteProfile).toHaveBeenCalled())
    expect(api.deleteProfile).toHaveBeenCalledWith({
      workspacePath: 'E:\\dev\\app',
      profileId: 'p1'
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('prefills the form with existing values when editing a profile', async () => {
    api.listProfiles.mockResolvedValue([
      {
        id: 'p1',
        label: 'prod',
        targetId: 'ssh-1',
        localRoot: 'E:\\dev\\app',
        defaultRemoteDir: '/srv/app'
      }
    ])
    render(<SftpProfilesSection workspacePath={WORKSPACE_PATH} targets={targets} />)
    await waitFor(() => expect(screen.getByText('prod')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Edit profile/i }))
    expect((screen.getByLabelText(/Label/i) as HTMLInputElement).value).toBe('prod')
    expect((screen.getByLabelText(/Target/i) as HTMLSelectElement).value).toBe('ssh-1')
    expect((screen.getByLabelText(/Local root/i) as HTMLInputElement).value).toBe('E:\\dev\\app')
    expect((screen.getByLabelText(/Remote dir/i) as HTMLInputElement).value).toBe('/srv/app')
  })

  it('saves an edit in place with the original profile id', async () => {
    api.listProfiles.mockResolvedValue([
      {
        id: 'p1',
        label: 'prod',
        targetId: 'ssh-1',
        localRoot: 'E:\\dev\\app',
        defaultRemoteDir: '/srv/app'
      }
    ])
    render(<SftpProfilesSection workspacePath={WORKSPACE_PATH} targets={targets} />)
    await waitFor(() => expect(screen.getByText('prod')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Edit profile/i }))
    fireEvent.change(screen.getByLabelText(/Label/i), { target: { value: 'prod-eu' } })
    fireEvent.change(screen.getByLabelText(/Remote dir/i), { target: { value: '/srv/eu' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }))

    await waitFor(() => expect(api.saveProfile).toHaveBeenCalledTimes(1))
    expect(api.saveProfile).toHaveBeenCalledWith({
      workspacePath: 'E:\\dev\\app',
      profile: {
        id: 'p1',
        label: 'prod-eu',
        targetId: 'ssh-1',
        localRoot: 'E:\\dev\\app',
        defaultRemoteDir: '/srv/eu'
      }
    })
  })
})
