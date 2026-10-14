import type { SshConnectionCallbacks } from '../ssh/ssh-connection'
import type { SshConnectionState } from '../../shared/ssh-types'
import { isSshHostCensusInFlight } from '../ssh/ssh-connection-attribution'
import {
  connectInFlight,
  credentialRequestedForTarget,
  testingTargets
} from './ssh-connect-attempt-registry'
import { getCurrentMainWindow } from './ssh-ipc-context'
import { restoreManagedHostPortForwards } from './ssh-managed-port-forward-restore'
import { requestCredential } from './ssh-passphrase'
import { getSshTargetRegistryStore } from '../ssh/ssh-target-registry'
import { broadcastSshState } from './ssh-renderer-broadcast'

export function handleSshConnectionStateChange(targetId: string, state: SshConnectionState): void {
  if (testingTargets.has(targetId)) {
    return
  }
  if (
    state.status === 'connected' &&
    (connectInFlight.has(targetId) || isSshHostCensusInFlight(targetId))
  ) {
    // Why: the raw transport reaches 'connected' while the connect is still deciding the host's
    // server; forwarding it would let the renderer treat the host as up before anything serves it.
    broadcastSshState(getCurrentMainWindow, targetId, {
      targetId,
      status: 'connecting',
      error: state.error,
      reconnectAttempt: state.reconnectAttempt
    })
    return
  }
  broadcastSshState(getCurrentMainWindow, targetId, state)
  // An explicit connect restores through its own publish; this covers a transport that recovered.
  if (state.status === 'connected') {
    void restoreManagedHostPortForwards(targetId)
  }
}

export function createSshConnectionCallbacks(): SshConnectionCallbacks {
  return {
    onCredentialRequest: async (targetId, kind, detail, echo, signal) => {
      credentialRequestedForTarget.add(targetId)
      const answer = await requestCredential(getCurrentMainWindow, targetId, kind, detail, echo, signal)
      // Why: persist only on an explicit remember opt-in with a submitted value;
      // the current connection keeps its in-memory cache either way (D3).
      if (answer.remember && answer.value) {
        getSshTargetRegistryStore()?.rememberCredential(targetId, kind, answer.value)
      }
      return answer.value
    },
    onStateChange: handleSshConnectionStateChange
  }
}
