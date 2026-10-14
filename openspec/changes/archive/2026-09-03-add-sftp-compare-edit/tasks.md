## 1. Shared contract + save-remote IPC (D2/D7)

- [x] 1.1 RED: save-remote dispatch tests in `src/main/ipc/sftp-transfer.test.ts` — mirror-path truncate-write, size-cap rejection (`compare-file-too-large`), channel registration
- [x] 1.2 GREEN: add `SFTP_SAVE_REMOTE_CHANNEL`, `SftpSaveRemoteArgs`, `SftpSaveRemoteResult` to `src/shared/sftp-types.ts` and implement `runSftpSaveRemote` in `src/main/ipc/sftp-transfer-compare.ts`
- [x] 1.3 Register the `SFTP_SAVE_REMOTE_CHANNEL` handler via `registerSftpSaveRemoteHandler` (wired from `sftp-transfer.ts`) and add `saveRemote` to `SftpApi` in `src/preload/api/sftp-api.ts` + preload exposure

## 2. Per-session compare freshness (D1)

- [x] 2.1 RED: `SftpCompareDialog.test.tsx` — two opens of the same `localPath` produce distinct DiffViewer `modelKey`s; unmount disposes by prefix
- [x] 2.2 GREEN: session nonce minted in `FileExplorer`; DiffViewer keys derived from it; session models disposed on close via `getDiffViewerMonacoModelPathPrefixes` + `disposeUnattachedMonacoModelsByPathPrefix`

## 3. Editable remote pane + save flow (D3/D7)

- [x] 3.1 RED: dialog passes `editable`/`onSave`/`onContentChange`; Save invokes `window.api.sftp.saveRemote` with the current buffer; rejection surfaces inline
- [x] 3.2 GREEN: `OpenSftpCompare` carries `{ content, localPath, profile, workspacePath }`; editable remote pane, dirty indicator, saving/saved/error footer states

## 4. Chunk-level apply (D4/D5)

- [x] 4.1 RED→GREEN: `sftp-compare-apply-change.test.ts` — insert, delete, replace, EOF hunk, whole-file edges, bottom-up multi-hunk apply
- [x] 4.2 Implement `applySftpLineChange`/`applyAllSftpLineChanges` in `sftp-compare-apply-change.ts`
- [x] 4.3 Add optional `onDiffEditorReady` to `diff-viewer-props.ts`, invoked from `DiffViewer` mount/dispose
- [x] 4.4 Toolbar (previous/next hunk, Apply change at cursor, Apply all, Save) driving the captured diff editor; dialog test asserts call-through

## 5. Success-card auto-dismiss (D6)

- [x] 5.1 RED→GREEN: `SftpTransferNotificationCard.test.tsx` — clean-success auto-dismiss (fake timers), hover pause + restart, failed/cancelled never auto-dismiss

## 6. Verification + archive

- [x] 6.1 Touched test files (59 tests incl. sftp-types/store/DiffViewer lifecycle suites) green; `tsc -p config/tsconfig.web.json` clean for touched files; oxlint clean (line budgets respected without disables; compare/save registration split into `sftp-transfer-compare.ts`)
- [x] 6.2 `openspec archive add-sftp-compare-edit` once all specs hold
