# Contracts: add-sftp-file-transfer

## Contract Home

- `src/shared/sftp-types.ts` — every new shape below (single source of truth once implemented)
- `src/shared/ssh-types.ts` — `SshTarget` gains the optional credential-memory fields

## Interface Contracts

Channels follow the repo `domain:action` kebab-case convention (cf. `ssh:connect`, `repos:changed`).

```ts
// --- invoke (renderer → main) ---
'sftp:profiles'          { workspacePath: string } → SftpWorkspaceProfile[]
'sftp:save-profile'      { workspacePath: string; profile: SftpWorkspaceProfile } → SftpWorkspaceProfile // id generated on create
'sftp:delete-profile'    { workspacePath: string; profileId: string } → void
'sftp:upload'            { workspacePath: string; profileId: string; localPath: string; requestId?: string } → SftpTransferResult // requestId: renderer-minted correlation key (D14)
'sftp:download'          { workspacePath: string; profileId: string; localPath: string; requestId?: string } → SftpTransferResult
'sftp:compare'           { workspacePath: string; profileId: string; localPath: string } → SftpCompareResult
'sftp:cancel-transfer'   { transferId: SftpTransferId } → void
'sftp:confirm-host-key'  { hostKey: string; fingerprint: string; accepted: boolean } → void
'sftp:clear-host-trust'  { hostKey: string } → void

// --- event (main → renderer) ---
'sftp:profiles-changed'      SftpWorkspaceProfile[]            // cf. repos:changed
'sftp:transfer-progress'     SftpTransferProgress
'sftp:host-key-required'     { hostKey: string; fingerprint: string } // answered via sftp:confirm-host-key
```

Errors: every failing invoke rejects with `SftpTransferError { code: SftpTransferErrorCode; message: string }`.

```ts
type SftpTransferId = string

type SftpTransferProgress = {
  transferId: SftpTransferId
  requestId?: string          // echoes the invoke's requestId (D14 correlation)
  phase: 'connecting' | 'transferring'
  filesDone: number
  filesTotal: number
  currentPath: string
}

type SftpTransferFileOutcome =
  | { path: string; ok: true }
  | { path: string; ok: false; error: string }

type SftpTransferResult = {
  transferId: SftpTransferId
  cancelled: boolean
  outcomes: SftpTransferFileOutcome[] // per-file: continue-and-summarize (D9)
}

type SftpTransferErrorCode =
  | 'profile-not-found'
  | 'outside-local-root'          // strict per-profile matching (D10)
  | 'host-key-mismatch'           // hard-block (D5)
  | 'host-key-rejected'
  | 'system-ssh-only-transport'   // GSSAPI / exotic ProxyCommand (spec)
  | 'compare-file-too-large'      // > 10 MB (D8)
  | 'compare-binary-refused'      // (D8)
  | 'trash-unavailable'           // overwrite guard failed (D7)

type SftpCompareResult = { content: string } // feeds the read-only DiffViewer tab
```

## Data Contracts

```ts
type SftpWorkspaceProfile = {
  id: string                // uuid, stable across renames
  label: string
  targetId: string          // existing SshTarget id (D1)
  localRoot: string         // absolute local path
  defaultRemoteDir: string  // absolute POSIX path, validated at save (D10)
}

type SftpProfilesByWorkspace = Record<string, SftpWorkspaceProfile[]> // key: normalized workspace path (D2)

type SftpHostTrustStore = Record<string, string> // 'host:port' → SHA256 fingerprint, hex (D5)
```

Persisted keys (main durable state, `src/main/persistence.ts`):

| Key | Shape | Encrypted |
|---|---|---|
| `sftp-profiles` | `SftpProfilesByWorkspace` | no |
| `sftp-host-trust` | `SftpHostTrustStore` | no |
| on-`SshTarget` optional fields | `rememberedPassword?`, `rememberedPassphrase?` | yes — via existing `encryptToSentinel` slot mechanism (D3) |

## Compatibility

- All persisted keys and `SshTarget` fields are additive and optional: old versions ignore them; mixed-version persistence stays readable (design Migration Plan).
- Remembered-credential fields exist only in main-process persistence and are **never included in renderer-facing IPC payloads** — the renderer sees `SshTarget` without them.
- Channel names are stable once shipped; new channels are additive. Changing any shape declared here requires a decision record in design.md first.
