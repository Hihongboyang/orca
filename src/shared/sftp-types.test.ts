import { describe, expect, it } from 'vitest'
import {
  SFTP_PROFILES_CHANNEL,
  SFTP_SAVE_PROFILE_CHANNEL,
  SFTP_DELETE_PROFILE_CHANNEL,
  SFTP_UPLOAD_CHANNEL,
  SFTP_DOWNLOAD_CHANNEL,
  SFTP_COMPARE_CHANNEL,
  SFTP_CANCEL_TRANSFER_CHANNEL,
  SFTP_CONFIRM_HOST_KEY_CHANNEL,
  SFTP_CLEAR_HOST_TRUST_CHANNEL,
  SFTP_PROFILES_CHANGED_CHANNEL,
  SFTP_TRANSFER_PROGRESS_CHANNEL,
  SFTP_HOST_KEY_REQUIRED_CHANNEL,
  SFTP_TRANSFER_ERROR_CODES,
  type SftpTransferErrorCode
} from './sftp-types'

describe('SFTP channel constants', () => {
  it('declares exactly the channels from contracts.md', () => {
    expect(SFTP_PROFILES_CHANNEL).toBe('sftp:profiles')
    expect(SFTP_SAVE_PROFILE_CHANNEL).toBe('sftp:save-profile')
    expect(SFTP_DELETE_PROFILE_CHANNEL).toBe('sftp:delete-profile')
    expect(SFTP_UPLOAD_CHANNEL).toBe('sftp:upload')
    expect(SFTP_DOWNLOAD_CHANNEL).toBe('sftp:download')
    expect(SFTP_COMPARE_CHANNEL).toBe('sftp:compare')
    expect(SFTP_CANCEL_TRANSFER_CHANNEL).toBe('sftp:cancel-transfer')
    expect(SFTP_CONFIRM_HOST_KEY_CHANNEL).toBe('sftp:confirm-host-key')
    expect(SFTP_CLEAR_HOST_TRUST_CHANNEL).toBe('sftp:clear-host-trust')
    expect(SFTP_PROFILES_CHANGED_CHANNEL).toBe('sftp:profiles-changed')
    expect(SFTP_TRANSFER_PROGRESS_CHANNEL).toBe('sftp:transfer-progress')
    expect(SFTP_HOST_KEY_REQUIRED_CHANNEL).toBe('sftp:host-key-required')
  })

  it('channel names are unique', () => {
    const channels = [
      SFTP_PROFILES_CHANNEL,
      SFTP_SAVE_PROFILE_CHANNEL,
      SFTP_DELETE_PROFILE_CHANNEL,
      SFTP_UPLOAD_CHANNEL,
      SFTP_DOWNLOAD_CHANNEL,
      SFTP_COMPARE_CHANNEL,
      SFTP_CANCEL_TRANSFER_CHANNEL,
      SFTP_CONFIRM_HOST_KEY_CHANNEL,
      SFTP_CLEAR_HOST_TRUST_CHANNEL,
      SFTP_PROFILES_CHANGED_CHANNEL,
      SFTP_TRANSFER_PROGRESS_CHANNEL,
      SFTP_HOST_KEY_REQUIRED_CHANNEL
    ]
    expect(new Set(channels).size).toBe(channels.length)
  })

  it('channel names follow the sftp:action kebab-case convention', () => {
    const channels = [
      SFTP_PROFILES_CHANNEL,
      SFTP_SAVE_PROFILE_CHANNEL,
      SFTP_DELETE_PROFILE_CHANNEL,
      SFTP_UPLOAD_CHANNEL,
      SFTP_DOWNLOAD_CHANNEL,
      SFTP_COMPARE_CHANNEL,
      SFTP_CANCEL_TRANSFER_CHANNEL,
      SFTP_CONFIRM_HOST_KEY_CHANNEL,
      SFTP_CLEAR_HOST_TRUST_CHANNEL,
      SFTP_PROFILES_CHANGED_CHANNEL,
      SFTP_TRANSFER_PROGRESS_CHANNEL,
      SFTP_HOST_KEY_REQUIRED_CHANNEL
    ]
    for (const channel of channels) {
      expect(channel).toMatch(/^sftp:[a-z]+(-[a-z]+)*$/)
    }
  })
})

describe('SFTP transfer error codes', () => {
  it('lists every code from contracts.md exactly once', () => {
    expect([...SFTP_TRANSFER_ERROR_CODES].sort()).toEqual(
      [
        'profile-not-found',
        'outside-local-root',
        'host-key-mismatch',
        'host-key-rejected',
        'system-ssh-only-transport',
        'compare-file-too-large',
        'compare-binary-refused',
        'trash-unavailable'
      ].sort()
    )
  })

  it('registry is exhaustive over the union', () => {
    const codes: readonly SftpTransferErrorCode[] = SFTP_TRANSFER_ERROR_CODES
    const unionExhaustive = (code: SftpTransferErrorCode): string => code
    expect(codes.map(unionExhaustive)).toHaveLength(8)
    expect(new Set(codes).size).toBe(8)
  })
})
