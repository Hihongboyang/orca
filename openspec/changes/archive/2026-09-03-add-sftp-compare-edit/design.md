## Context

`SftpCompareDialog` (renderer) renders local-vs-remote content through the shared `DiffViewer` (Monaco `DiffEditor`). Three problems:

1. **Stale diff**: `DiffViewer` passes stable `originalModelPath`/`modifiedModelPath` plus `keepCurrent*Model`. `@monaco-editor/react` (4.7.0) resolves models via `getOrCreateModel` in an effect keyed on the model *path* only; for an existing model it returns it with its **old content** — the fresh `original`/`modified` props are only applied at model creation. The SFTP dialog uses path-stable keys (`sftp-compare-local:<path>`), so after the first open the kept-alive models are reused forever: re-comparing after an upload still shows the first snapshot's diff.
2. **Read-only compare**: the only way to reconcile is a full-file upload from outside the dialog.
3. **Transfer cards**: clean-success cards sit in the corner until manually dismissed.

Main-process compare (`runSftpCompare` in `src/main/ipc/sftp-transfer-compare.ts`) opens a dedicated `withSftpSession`, resolves the mirror path, streams the remote file (≤ `SFTP_COMPARE_MAX_BYTES`), refuses binaries. Transfers run through `runTransfer` with progress cards settled in the renderer store (`SftpTransferCard`).

## Goals / Non-Goals

**Goals:**
- Every compare open renders current local + remote content.
- Remote pane editable; per-hunk apply from local; save edited content back to the remote mirror path.
- Clean-success transfer cards auto-close; failed/cancelled/host-key cards stay.

**Non-Goals:**
- Gutter arrow buttons inside Monaco panes; bidirectional apply; local-pane editing.
- Changing transfer semantics (overwrite/trash/ignore), the 10 MB cap, or host trust.

## Decisions

### D1 — Per-session model keys + dispose-by-prefix (stale-diff fix)
`FileExplorer` mints a session nonce (monotonic counter is enough) each time `onCompare` fires and stores it in the `sftpCompare` state. `SftpCompareDialog` derives all three DiffViewer keys from `sftp-compare:${sessionNonce}:${localPath}`. On session change/unmount the dialog disposes that session's models via the existing `getDiffViewerMonacoModelPathPrefixes` + `disposeUnattachedMonacoModelsByPathPrefix` (same hygiene pattern as the large-diff fallback in `useDiffViewerLargeDiffLifecycle`).
Rejected: pushing content into existing models via `model.setValue` on dialog mount — requires reaching into Monaco internals from the dialog and fighting the library's own model lifecycle; nonce keys stay within the established path-rotation pattern. Rejected: dropping `keepCurrent*Model` — that flag is load-bearing for other DiffViewer consumers sharing this component.

### D2 — Save-back is a sibling of compare: `sftp:save-remote`
New handler `runSftpSaveRemote` in `src/main/ipc/sftp-transfer-compare.ts` reusing the exact compare wiring (`resolveProfile`/`requireTarget`/`resolveRemoteMirrorPath`/`withSftpSession` + host-key TOFU + credential request). It truncate-writes the string via `sftp.createWriteStream(remotePath)` on the same dedicated short-lived session contract. Refuses payloads > `SFTP_COMPARE_MAX_BYTES` (keeps the compare feature boundary symmetric: what you can read and diff is what you can write back). No remote trash concept — write is destructive, matching upload overwrite semantics (spec: silent overwrite, nothing preserved).
Rejected: routing through `uploadLocalTo` with a temp file — adds an fs footprint and reuses ignore/skip logic that must not apply to an explicit content write. Rejected: a live transfer card for saves — a single-file save shows inline state in the dialog footer (dirty/saving/saved), consistent with editor save UX; transfer cards are for batch transfers.

### D3 — Editable remote pane via existing `DiffViewer` contract
The dialog passes `editable`, `onContentChange` (dirty tracking), `onSave` (Ctrl+S → `sftp:save-remote`). `DiffViewer` already sets `readOnly: !editable` with `originalEditable: false` — local pane stays a read-only reference; only the remote pane takes edits.
Rejected: forking a dedicated SFTP diff component — the props contract already covers it.

### D4 — Chunk apply = toolbar actions over `getLineChanges()`
Standalone Monaco does not expose VS Code's inline diff arrows, and view-zone button widgets are fragile against re-layout. Instead the dialog renders a slim toolbar (existing `Button`/`ui` primitives, STYLEGUIDE tokens): previous/next hunk (`diffEditor.previousDiff()/nextDiff()`), **Apply hunk** (applies the hunk nearest the active pane's cursor from the local model into the remote model via `executeEdits`), **Apply all** (applies every current hunk bottom-up so earlier line numbers stay valid), **Save**. A pure helper `applySftpLineChange(remoteModel, localModel, change)` converts one `ILineChange` into an edit; unit-tested against insert/delete/replace/EOF cases.
Rejected: gutter hover buttons — high effort, brittle positioning, no library support.

### D5 — DiffViewer gains one optional prop: `onDiffEditorReady`
The toolbar needs the mounted `IStandaloneDiffEditor` for navigation and `getLineChanges()`. `DiffViewer` already registers instances into the diff-navigation context; a minimal optional mount callback (`onDiffEditorReady?: (editor) => void`, invoked in `handleMount`, nulled on dispose) is the smallest generic surface. Rejected: pulling the instance out of `useDiffEditorRegistration` — that context is for cross-component jump-to-diff, not ownership handoff.

### D6 — Clean-success cards auto-dismiss after 4 s, hover pauses
`SftpTransferNotificationCard` owns a `useEffect`: when `phase === 'done' && !error && !cancelled && outcomes.every(ok)`, schedule `onDismiss` in 4 s; `onMouseEnter`/`onFocus` cancel the timer (restart on leave). Any failure, cancellation, error, or host-key state keeps the manual-dismiss contract.
Rejected: auto-close in the store's `finishSftpTransfer` — the store shouldn't own wall-clock UI timing, and hovering couldn't pause it there.

### D7 — Dialog needs identity, not just label
`OpenSftpCompare` now carries `{ content, localPath, profile, workspacePath }` instead of `profileLabel`, so the dialog can address `sftp:save-remote` directly. `profile.label` still drives the title.

## Risks / Trade-offs

- **Destructive remote write**: save-back overwrites the remote file with the edited buffer. Mitigation: explicit Save action + Ctrl+S + dirty indicator; overwriting is already the spec's transfer semantics.
- **Concurrent remote change between compare and save**: last writer wins (same as upload today). No mtime precheck — an SFTP mtime guard would be advisory anyway (clock skew); called out as a known trade-off.
- **Nonce models leak if disposal is skipped**: bounded by the dispose-on-close effect; same LRU-ish hygiene as other diff surfaces.
- **Toolbar "current hunk" is cursor-relative**: if the cursor sits far from any hunk, Apply applies the nearest hunk (by line distance on the active side); acceptable, documented in the tooltip.

## Module Map

| File | Change |
| --- | --- |
| `src/shared/sftp-types.ts` | `SFTP_SAVE_REMOTE_CHANNEL`, `SftpSaveRemoteArgs`, `SftpSaveRemoteResult` |
| `src/main/ipc/sftp-transfer-compare.ts` | `runSftpSaveRemote` (mirror-path truncate-write, size cap, shared session wiring) |
| `src/main/ipc/sftp-transfer.ts` | register `SFTP_SAVE_REMOTE_CHANNEL` handler |
| `src/preload/api/sftp-api.ts` | `saveRemote(args)` typed surface |
| `src/preload/index.ts` (sftp wiring) | expose `saveRemote` |
| `src/renderer/src/components/editor/diff-viewer-props.ts` | optional `onDiffEditorReady` |
| `src/renderer/src/components/editor/DiffViewer.tsx` | invoke `onDiffEditorReady` on mount/dispose |
| `src/renderer/src/components/editor/SftpCompareDialog.tsx` | session keys + dispose, editable remote, toolbar, save flow |
| `src/renderer/src/components/editor/sftp-compare-apply-change.ts` | pure `ILineChange` → `executeEdits` helper |
| `src/renderer/src/components/right-sidebar/use-sftp-explorer-menu.ts` | `OpenSftpCompare` carries profile + workspacePath |
| `src/renderer/src/components/right-sidebar/FileExplorer.tsx` | session nonce in `sftpCompare` state |
| `src/renderer/src/components/right-sidebar/SftpTransferNotificationCard.tsx` | clean-success auto-dismiss timer |
| tests adjacent to each | unit coverage per repo pattern |
