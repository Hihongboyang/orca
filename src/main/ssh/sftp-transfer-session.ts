// Per-operation SFTP connection lifecycle (D4): dedicated short-lived ssh2
// connection reused within one operation, closed in `finally`. Never attaches
// to a user's live terminal session. Carries the same auth-fallback ladder as
// SshConnection (agent → direct keys → password) plus the TOFU verifier.
import { Client as SshClient, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import { createHash } from 'node:crypto'
import type { SshTarget } from '../../shared/ssh-types'
import type { SftpTransferErrorCode } from '../../shared/sftp-types'
import {
  buildConnectConfig,
  isAgentFallbackError,
  isAuthError,
  isPassphraseError
} from './ssh-connection-utils'
import { hostTrustKey, SftpHostTrust, type SftpHostTrustStoreOps } from './sftp-host-trust'

export class SftpTransferSessionError extends Error {
  constructor(
    readonly code: SftpTransferErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'SftpTransferSessionError'
  }
}

export type SftpSessionOps = {
  hostTrustStore: SftpHostTrustStoreOps
  /** First-use TOFU detour; resolves true when the user accepts the fingerprint. */
  confirmHostKey: (hostKey: string, fingerprint: string) => Promise<boolean>
  /** Auth-failure detour (parity with terminal connections); null declines. */
  onCredentialRequest?: (kind: 'password' | 'passphrase', detail: string) => Promise<string | null>
}

export async function withSftpSession<T>(
  target: SshTarget,
  ops: SftpSessionOps,
  operation: (sftp: SFTPWrapper) => Promise<T>
): Promise<T> {
  // Why: GSSAPI auth rides the system OpenSSH binary; the sftp subsystem needs
  // the ssh2 stack, so these targets are out of scope in v1 (clear error, spec).
  if (target.gssapiAuthentication === true) {
    throw new SftpTransferSessionError(
      'system-ssh-only-transport',
      `Target "${target.label}" authenticates via GSSAPI (system OpenSSH transport); SFTP transfers are not supported for it.`
    )
  }

  const trust = new SftpHostTrust(ops.hostTrustStore)
  // Why: a verifier abort must surface as its typed error, not ssh2's generic
  // "Handshake failed" — each attempt records its reason for the catch ladder.
  let verifierAbort: SftpTransferSessionError | null = null
  let dropAgent = false
  // Why: track prompted-ness separately from the value — a declined prompt
  // (null) must not re-prompt in a retry loop.
  let passwordPrompted = false
  let passphrasePrompted = false
  let promptedPassword: string | undefined
  let promptedPassphrase: string | undefined

  const buildAttemptConfig = (): ConnectConfig => {
    const config = dropAgent
      ? buildConnectConfig(target, null, { includeAgent: false, includePrivateKey: true })
      : buildConnectConfig(target, null)
    const mutable = config as ConnectConfig & { password?: string; passphrase?: string }
    // Why: remembered credentials (D3) plus any value obtained from the prompt
    // detour make the handshake prompt-free.
    mutable.password = promptedPassword ?? target.rememberedPassword
    mutable.passphrase = promptedPassphrase ?? target.rememberedPassphrase
    const host = String(config.host ?? target.host)
    const port = Number(config.port ?? target.port)
    config.hostVerifier = (key: Buffer, verify: (ok: boolean) => void): void => {
      const fingerprint = createHash('sha256').update(key).digest('hex')
      const decision = trust.evaluate(host, port, fingerprint)
      if (decision.outcome === 'trusted') {
        verify(true)
        return
      }
      if (decision.outcome === 'mismatch') {
        verifierAbort = new SftpTransferSessionError(
          'host-key-mismatch',
          `Host key for ${host}:${port} changed (stored ${decision.stored}, presented ${decision.presented}). Clear the stored trust to re-confirm the new key.`
        )
        verify(false)
        return
      }
      void ops
        .confirmHostKey(hostTrustKey(host, port), fingerprint)
        .then((accepted) => {
          if (accepted) {
            trust.confirm(host, port, fingerprint)
            verify(true)
          } else {
            verifierAbort = new SftpTransferSessionError(
              'host-key-rejected',
              `Host key for ${host}:${port} was not accepted.`
            )
            verify(false)
          }
        })
        .catch(() => {
          verifierAbort ??= new SftpTransferSessionError(
            'host-key-rejected',
            `Host key confirmation for ${host}:${port} failed.`
          )
          verify(false)
        })
    }
    return config
  }

  let settledClient: SshClient | null = null
  try {
    for (;;) {
      const config = buildAttemptConfig()
      const client = new SshClient()
      let connected = false
      try {
        await new Promise<void>((resolve, reject) => {
          client.on('ready', () => resolve())
          client.on('error', (err: Error) => reject(verifierAbort ?? err))
          client.connect(config)
        })
        connected = true
        // Why: ssh2's post-ready teardown (e.g. SFTP cleanupRequests "No
        // response from server") emits client errors with no remaining
        // handler — an uncaught exception in main. Swallow them: in-flight
        // operation failures already reject through their own callbacks.
        client.on('error', () => {})
        const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
          client.sftp((err, channel) => {
            if (err) {
              reject(err)
              return
            }
            // Why: the SFTP channel is an EventEmitter — a teardown-time
            // channel error with no listener would throw uncaught in main.
            ;(channel as { on?: (event: string, fn: () => void) => void }).on?.('error', () => {})
            resolve(channel)
          })
        })
        settledClient = client
        return await operation(sftp)
      } catch (caught) {
        const err = caught instanceof Error ? caught : new Error(String(caught))
        if (!connected) {
          client.end()
          client.destroy()
        }
        if (err instanceof SftpTransferSessionError) {
          throw err
        }
        // Why: Windows defaults to the OpenSSH agent pipe even when the agent
        // service is off; ssh2 stops at the agent error instead of falling
        // through to key/password auth (same guard as SshConnection: only an
        // agent-only attempt qualifies — a full-auth failure means prompting).
        if (isAgentFallbackError(err) && !dropAgent && config.agent && !config.privateKey) {
          dropAgent = true
          continue
        }
        if ((isAuthError(err) || isPassphraseError(err)) && ops.onCredentialRequest) {
          const wantsPassphrase = isPassphraseError(err) && !passphrasePrompted
          const wantsPassword = !wantsPassphrase && !passwordPrompted
          if (wantsPassphrase || wantsPassword) {
            const kind: 'passphrase' | 'password' = wantsPassphrase ? 'passphrase' : 'password'
            const detail =
              kind === 'passphrase'
                ? (target.identityFile ?? '(unknown key)')
                : target.username
                  ? `${target.username}@${target.host}`
                  : target.host
            const value = await ops.onCredentialRequest(kind, detail)
            if (kind === 'passphrase') {
              passphrasePrompted = true
              promptedPassphrase = value ?? undefined
            } else {
              passwordPrompted = true
              promptedPassword = value ?? undefined
            }
            if (value) {
              continue
            }
          }
        }
        throw err
      }
    }
  } finally {
    // Why: end() is an orderly disconnect; destroy() guarantees socket teardown
    // even when end() never completes (half-open connections).
    settledClient?.end()
    settledClient?.destroy()
  }
}
