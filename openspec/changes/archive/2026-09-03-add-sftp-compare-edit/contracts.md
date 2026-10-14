# Contracts: add-sftp-compare-edit

## Contract Home

- `src/shared/sftp-types.ts` — channel names, save-remote arg/result types, error codes
- `src/preload/api/sftp-api.ts` — renderer-facing `SftpApi.saveRemote`
- `src/main/ipc/sftp-transfer-compare.ts` — `runSftpSaveRemote` handler implementation

## Interface Contracts

```ts
// src/shared/sftp-types.ts
export const SFTP_SAVE_REMOTE_CHANNEL = 'sftp:save-remote'

export type SftpSaveRemoteArgs = {
  workspacePath: string
  profileId: string
  localPath: string
  content: string
}

export type SftpSaveRemoteResult = {
  bytesWritten: number
}
```

Direction: renderer → main (`ipcMain.handle`, one-shot invoke like `SFTP_COMPARE_CHANNEL`).

Error cases (rejected as `sftp-error:<code>:<message>` per the existing `IpcSftpError` wire contract): `profile-not-found`, `outside-local-root`, `host-key-mismatch`, `host-key-rejected`, `system-ssh-only-transport`, `compare-file-too-large` (payload > `SFTP_COMPARE_MAX_BYTES`). Session-level write failures reject with the session error code mapped by `toIpcSftpError`.

```ts
// src/preload/api/sftp-api.ts (SftpApi addition)
saveRemote: (args: {
  workspacePath: string
  profileId: string
  localPath: string
  content: string
}) => Promise<{ bytesWritten: number }>
```

```ts
// src/renderer/src/components/editor/diff-viewer-props.ts (optional addition)
onDiffEditorReady?: (editor: import('monaco-editor').editor.IStandaloneDiffEditor | null) => void
```

```ts
// src/renderer/src/components/right-sidebar/use-sftp-explorer-menu.ts (signature change)
export type OpenSftpCompare = (options: {
  content: string
  localPath: string
  profile: SftpWorkspaceProfile
  workspacePath: string
}) => void
```

## Data Contracts

No new persisted shapes. Existing keys unchanged: `sftp-profiles`, `sftp-host-trust`. Diff-view scroll cache keys become per-session (`sftp-compare:<sessionNonce>:<localPath>`), which only affects the in-memory `diffViewStateCache` LRU — no persistence involved.

## Compatibility

- `SFTP_SAVE_REMOTE_CHANNEL` is a new invoke channel: old renderers never call it; old mains lack it and the preload rejects with the standard missing-handler error. No stream opcodes added, so remote-wire capability negotiation is not required.
- `OpenSftpCompare` and `onDiffEditorReady` are renderer-internal; not wire surfaces.
- `sftp-transfer-progress` / transfer result shapes are untouched; the auto-dismiss is renderer-local behavior.
