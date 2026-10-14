import { randomUUID } from 'node:crypto'
import type { SftpWorkspaceProfile } from '../../../shared/sftp-types'
import {
  clearSftpHostTrust as clearSftpHostTrustOperation,
  deleteSftpProfile as deleteSftpProfileOperation,
  getSftpHostTrust as getSftpHostTrustOperation,
  getSftpProfiles as getSftpProfilesOperation,
  saveSftpProfile as saveSftpProfileOperation,
  setSftpHostTrust as setSftpHostTrustOperation,
  type SftpProfileStateOperations
} from '../leasing-ssh-ptys/sftp-profile-state'
import type { StoreRuntimeState } from './store-runtime-state'
import type { WriteSchedulingOperations } from './write-scheduling'
import { scheduleSave } from './write-scheduling'

type SftpProfilePersistenceRuntime = Pick<StoreRuntimeState, 'state'>

const sftpProfilePersistenceContext = Symbol('SftpProfilePersistence')
type SftpProfilePersistenceContext = {
  runtime: SftpProfilePersistenceRuntime
  scheduling: WriteSchedulingOperations
}

export class SftpProfilePersistence {
  readonly [sftpProfilePersistenceContext]: SftpProfilePersistenceContext

  constructor(runtime: SftpProfilePersistenceRuntime, scheduling: WriteSchedulingOperations) {
    this[sftpProfilePersistenceContext] = { runtime, scheduling }
  }

  private getStateOperations(): SftpProfileStateOperations {
    const { runtime, scheduling } = this[sftpProfilePersistenceContext]
    return {
      getSftpProfilesState: () => (runtime.state['sftp-profiles'] ??= {}),
      setSftpProfilesState: (next) => {
        runtime.state['sftp-profiles'] = next
      },
      getSftpHostTrustState: () => (runtime.state['sftp-host-trust'] ??= {}),
      setSftpHostTrustState: (next) => {
        runtime.state['sftp-host-trust'] = next
      },
      scheduleSave: () => scheduleSave(scheduling)
    }
  }

  getSftpProfiles(workspacePath: string): SftpWorkspaceProfile[] {
    return getSftpProfilesOperation(this.getStateOperations(), workspacePath)
  }

  saveSftpProfile(workspacePath: string, profile: SftpWorkspaceProfile): SftpWorkspaceProfile {
    // Why: id generated on create at the store boundary (contracts.md).
    const withId = profile.id === '' ? { ...profile, id: randomUUID() } : profile
    return saveSftpProfileOperation(this.getStateOperations(), workspacePath, withId)
  }

  deleteSftpProfile(workspacePath: string, profileId: string): void {
    deleteSftpProfileOperation(this.getStateOperations(), workspacePath, profileId)
  }

  getSftpHostTrust(hostKey: string): string | undefined {
    return getSftpHostTrustOperation(this.getStateOperations(), hostKey)
  }

  setSftpHostTrust(hostKey: string, fingerprint: string): void {
    setSftpHostTrustOperation(this.getStateOperations(), hostKey, fingerprint)
  }

  clearSftpHostTrust(hostKey: string): void {
    clearSftpHostTrustOperation(this.getStateOperations(), hostKey)
  }
}
