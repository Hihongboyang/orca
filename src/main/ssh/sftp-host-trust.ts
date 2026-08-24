// TOFU host-key trust for SFTP-dedicated connections (D5). Terminal
// connections deliberately keep their existing policy — see design.md.
import type { SshTarget } from '../../shared/ssh-types'

/** Minimal persistence surface the trust logic needs; Store satisfies this. */
export type SftpHostTrustStoreOps = {
  getSftpHostTrust(hostKey: string): string | undefined
  setSftpHostTrust(hostKey: string, fingerprint: string): void
  clearSftpHostTrust(hostKey: string): void
}

export function hostTrustKey(host: string, port: number): string {
  return `${host}:${port}`
}

export type SftpHostTrustDecision =
  | { outcome: 'trusted' }
  | { outcome: 'confirm-required'; fingerprint: string }
  | { outcome: 'mismatch'; stored: string; presented: string }

// Why lowercase: SSH fingerprints are case-insensitive hex; normalize at the boundary.
const normalizeFingerprint = (fingerprint: string): string => fingerprint.trim().toLowerCase()

export class SftpHostTrust {
  constructor(private readonly store: SftpHostTrustStoreOps) {}

  evaluate(host: string, port: number, presentedFingerprint: string): SftpHostTrustDecision {
    const presented = normalizeFingerprint(presentedFingerprint)
    const stored = this.store.getSftpHostTrust(hostTrustKey(host, port))
    if (stored === undefined) {
      return { outcome: 'confirm-required', fingerprint: presented }
    }
    if (stored === presented) {
      return { outcome: 'trusted' }
    }
    // Why surface both: the mismatch warning names the host and both fingerprints (spec).
    return { outcome: 'mismatch', stored, presented }
  }

  /** Persist a first-use acceptance. Never called for a mismatch (D5: no unconditional accept). */
  confirm(host: string, port: number, fingerprint: string): void {
    this.store.setSftpHostTrust(hostTrustKey(host, port), normalizeFingerprint(fingerprint))
  }

  /** Recovery path for a legitimate key rotation; the next connect re-runs first-use. */
  clear(host: string, port: number): void {
    this.store.clearSftpHostTrust(hostTrustKey(host, port))
  }

  /** Trust key for a target's connection endpoint. */
  keyForTarget(target: Pick<SshTarget, 'host' | 'port'>): string {
    return hostTrustKey(target.host, target.port)
  }
}
