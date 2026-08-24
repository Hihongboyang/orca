import { describe, expect, it } from 'vitest'
import { hostTrustKey, SftpHostTrust, type SftpHostTrustStoreOps } from './sftp-host-trust'

function fakeStore(): SftpHostTrustStoreOps & { entries: Map<string, string> } {
  const entries = new Map<string, string>()
  return {
    entries,
    getSftpHostTrust: (hostKey) => entries.get(hostKey),
    setSftpHostTrust: (hostKey, fingerprint) => {
      entries.set(hostKey, fingerprint)
    },
    clearSftpHostTrust: (hostKey) => {
      entries.delete(hostKey)
    }
  }
}

describe('hostTrustKey', () => {
  it('joins host and port with the default port collapsed', () => {
    expect(hostTrustKey('10.0.0.5', 22)).toBe('10.0.0.5:22')
    expect(hostTrustKey('example.com', 2222)).toBe('example.com:2222')
  })
})

describe('SftpHostTrust', () => {
  it('first connection to an unknown host requires confirmation with the fingerprint', () => {
    const trust = new SftpHostTrust(fakeStore())
    expect(trust.evaluate('10.0.0.5', 22, 'aabbcc')).toEqual({
      outcome: 'confirm-required',
      fingerprint: 'aabbcc'
    })
  })

  it('silently trusts a matching fingerprint after confirmation', () => {
    const store = fakeStore()
    const trust = new SftpHostTrust(store)
    trust.confirm('10.0.0.5', 22, 'aabbcc')
    expect(trust.evaluate('10.0.0.5', 22, 'aabbcc')).toEqual({ outcome: 'trusted' })
  })

  it('hard-blocks on fingerprint mismatch with both fingerprints surfaced', () => {
    const store = fakeStore()
    const trust = new SftpHostTrust(store)
    trust.confirm('10.0.0.5', 22, 'aabbcc')
    expect(trust.evaluate('10.0.0.5', 22, 'ddeeff')).toEqual({
      outcome: 'mismatch',
      stored: 'aabbcc',
      presented: 'ddeeff'
    })
    // Why: a mismatch must not silently rewrite trust; the store is unchanged.
    expect(store.entries.get('10.0.0.5:22')).toBe('aabbcc')
  })

  it('clear-trust recovery restarts first-use confirmation with the new fingerprint', () => {
    const store = fakeStore()
    const trust = new SftpHostTrust(store)
    trust.confirm('10.0.0.5', 22, 'aabbcc')
    trust.clear('10.0.0.5', 22)
    expect(trust.evaluate('10.0.0.5', 22, 'ddeeff')).toEqual({
      outcome: 'confirm-required',
      fingerprint: 'ddeeff'
    })
    trust.confirm('10.0.0.5', 22, 'ddeeff')
    expect(trust.evaluate('10.0.0.5', 22, 'ddeeff')).toEqual({ outcome: 'trusted' })
  })

  it('normalizes hex fingerprints to lowercase before comparing', () => {
    const store = fakeStore()
    const trust = new SftpHostTrust(store)
    trust.confirm('10.0.0.5', 22, 'AABBCC')
    expect(trust.evaluate('10.0.0.5', 22, 'aabbcc')).toEqual({ outcome: 'trusted' })
    expect(store.entries.get('10.0.0.5:22')).toBe('aabbcc')
  })

  it('isolates trust per host:port', () => {
    const trust = new SftpHostTrust(fakeStore())
    trust.confirm('10.0.0.5', 22, 'aabbcc')
    expect(trust.evaluate('10.0.0.5', 2222, 'aabbcc')).toEqual({
      outcome: 'confirm-required',
      fingerprint: 'aabbcc'
    })
  })
})
