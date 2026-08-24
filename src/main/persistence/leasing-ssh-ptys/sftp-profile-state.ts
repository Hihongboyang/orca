// SFTP mapping-profile + TOFU host-trust state operations (D2/D5) and their
// disk-load normalizers. Profiles are workspace-scoped; trust is host:port-scoped.
import type {
  SftpHostTrustStore,
  SftpProfilesByWorkspace,
  SftpWorkspaceProfile
} from '../../../shared/sftp-types'

export type SftpProfileStateOperations = {
  getSftpProfilesState: () => SftpProfilesByWorkspace
  setSftpProfilesState: (next: SftpProfilesByWorkspace) => void
  getSftpHostTrustState: () => SftpHostTrustStore
  setSftpHostTrustState: (next: SftpHostTrustStore) => void
  scheduleSave: () => void
}

function isSftpWorkspaceProfile(value: unknown): value is SftpWorkspaceProfile {
  if (!value || typeof value !== 'object') {
    return false
  }
  const profile = value as Partial<SftpWorkspaceProfile>
  return (
    typeof profile.id === 'string' &&
    typeof profile.label === 'string' &&
    typeof profile.targetId === 'string' &&
    typeof profile.localRoot === 'string' &&
    typeof profile.defaultRemoteDir === 'string'
  )
}

export function normalizeSftpProfiles(value: unknown): SftpProfilesByWorkspace {
  if (!value || typeof value !== 'object') {
    return {}
  }
  const result: SftpProfilesByWorkspace = {}
  for (const [workspacePath, profiles] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(profiles)) {
      continue
    }
    const valid = profiles.filter(isSftpWorkspaceProfile)
    if (valid.length > 0) {
      result[workspacePath] = valid
    }
  }
  return result
}

export function normalizeSftpHostTrust(value: unknown): SftpHostTrustStore {
  if (!value || typeof value !== 'object') {
    return {}
  }
  const result: SftpHostTrustStore = {}
  for (const [hostKey, fingerprint] of Object.entries(value as Record<string, unknown>)) {
    if (typeof fingerprint === 'string' && fingerprint !== '') {
      result[hostKey] = fingerprint
    }
  }
  return result
}

export function getSftpProfiles(
  operations: SftpProfileStateOperations,
  workspacePath: string
): SftpWorkspaceProfile[] {
  return [...(operations.getSftpProfilesState()[workspacePath] ?? [])]
}

export function saveSftpProfile(
  operations: SftpProfileStateOperations,
  workspacePath: string,
  profile: SftpWorkspaceProfile
): SftpWorkspaceProfile {
  const state = operations.getSftpProfilesState()
  const existing = state[workspacePath] ?? []
  const index = existing.findIndex((candidate) => candidate.id === profile.id)
  if (index !== -1) {
    existing[index] = profile
  } else {
    existing.push(profile)
  }
  state[workspacePath] = existing
  operations.setSftpProfilesState(state)
  operations.scheduleSave()
  return { ...profile }
}

export function deleteSftpProfile(
  operations: SftpProfileStateOperations,
  workspacePath: string,
  profileId: string
): void {
  const state = operations.getSftpProfilesState()
  const existing = state[workspacePath]
  if (!existing?.some((candidate) => candidate.id === profileId)) {
    return
  }
  state[workspacePath] = existing.filter((candidate) => candidate.id !== profileId)
  operations.setSftpProfilesState(state)
  operations.scheduleSave()
}

export function getSftpHostTrust(
  operations: SftpProfileStateOperations,
  hostKey: string
): string | undefined {
  return operations.getSftpHostTrustState()[hostKey]
}

export function setSftpHostTrust(
  operations: SftpProfileStateOperations,
  hostKey: string,
  fingerprint: string
): void {
  const state = operations.getSftpHostTrustState()
  state[hostKey] = fingerprint
  operations.setSftpHostTrustState(state)
  operations.scheduleSave()
}

export function clearSftpHostTrust(operations: SftpProfileStateOperations, hostKey: string): void {
  const state = operations.getSftpHostTrustState()
  if (!(hostKey in state)) {
    return
  }
  delete state[hostKey]
  operations.setSftpHostTrustState(state)
  operations.scheduleSave()
}
