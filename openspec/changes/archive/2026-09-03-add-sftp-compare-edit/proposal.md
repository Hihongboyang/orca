## Why

The compare dialog is read-only, so fixing a remote difference today means leaving the compare view and running an upload of the whole file. Compare also has two correctness bugs users hit immediately: reopening a compare shows the first snapshot's diff forever (Monaco models are keyed by path and `@monaco-editor/react` ignores content props for existing models), and clean-success transfer cards never auto-close.

## What Changes

- **Compare becomes apply/edit**: the remote (right) pane of `SftpCompareDialog` becomes editable; a new `sftp:save-remote` IPC writes the edited remote content back through the mirror path on a dedicated short-lived session (same wiring as `runSftpCompare`).
- **Chunk-level apply**: toolbar actions over the live diff hunks — previous/next hunk navigation, "apply current hunk from local to remote" (pure `executeEdits` on the remote model), and "apply all hunks". Free-form typing in the remote pane is also live.
- **Fresh content per compare session**: every compare open mints a session nonce in the DiffViewer model keys so stale models cannot be reused; superseded session models are disposed by prefix on close (existing `disposeUnattachedMonacoModelsByPathPrefix` primitive).
- **Success cards auto-close**: transfer cards whose batch finished with zero failures and no cancellation auto-dismiss after a short delay; failure, cancelled, and host-key cards keep requiring manual dismissal.
- Shared contract additions in `src/shared/sftp-types.ts`: `SFTP_SAVE_REMOTE_CHANNEL` and the save-remote argument/result types.

## Capabilities

### New Capabilities
- `sftp-compare-apply`: editing the remote side from the compare dialog — editable remote pane, per-hunk apply from local, save-back to the remote mirror path, and per-session fresh diff models.

### Modified Capabilities
- `sftp-transfer`: transfer cards auto-dismiss on clean success (no error, not cancelled, zero failed outcomes); failures/cancellations still require manual dismissal.
- `sftp-transfer` (compare requirement): compare reads are per-session — each compare open renders the current local and remote content, never a cached first snapshot.

## Non-Goals

- No per-hunk gutter arrow buttons rendered inside the Monaco panes (toolbar actions instead — the VS Code-style inline diff arrows are not exposed by standalone Monaco).
- No bidirectional apply (remote → local) or local-pane editing; local stays a read-only reference.
- No change to transfer overwrite/trash semantics, ignore rules, or the 10 MB compare read cap; save-back refuses payloads over the same cap.
- No transfer-card history panel or retry queue.

## Reused Modules and Flows

- `runSftpCompare` plumbing (`withSftpSession`, host-key TOFU detour, credential request, `resolveRemoteMirrorPath`, `toIpcSftpError`) — save-remote is a sibling handler in `src/main/ipc/sftp-transfer-compare.ts`.
- `DiffViewer` already supports `editable`, `onContentChange`, `onSave` (Ctrl+S) — the dialog opts in rather than forking the viewer.
- Model hygiene pattern from `useDiffViewerLargeDiffLifecycle` + `diff-monaco-model-disposal` (path rotation + dispose-by-prefix) for the per-session nonce.
- Transfer card store (`SftpTransferCard`) and `SftpTransferNotificationCard` for the auto-close timer.
