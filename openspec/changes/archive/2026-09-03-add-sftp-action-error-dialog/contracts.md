# Contracts: add-sftp-action-error-dialog

## Contract Home

- `src/renderer/src/store/slices/sftp.ts` — dialog state shape
- `src/renderer/src/components/right-sidebar/sftp-transfer-actions.ts` — raise semantics

## Interface Contracts

No new IPC channels or preload surface. Renderer-internal only:

```ts
// src/renderer/src/store/slices/sftp.ts (SftpSlice addition)
export type SftpActionError = {
  /** Parsed `sftp-error:` code ('' when unparsed). */
  code: string
  message: string
}

sftpActionError: SftpActionError | null
setSftpActionError: (error: SftpActionError | null) => void
```

Raise rule: `runSftpExplorerAction`'s catch calls `setSftpActionError({ code, message })` for every rejection except `code === 'host-key-mismatch'`.

## Data Contracts

None — transient renderer state, never persisted.

## Compatibility

No wire changes; mixed client/host versions unaffected.
