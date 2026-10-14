## 1. State + raise point

- [x] 1.1 RED: `sftp-transfer-actions.test.ts` — compare/upload/download rejection sets `sftpActionError` with parsed code+message; `host-key-mismatch` does not
- [x] 1.2 GREEN: `sftpActionError` + `setSftpActionError` on the slice; raise in the shared catch

## 2. Dialog surface

- [x] 2.1 RED: `SftpTransferSurface.test.tsx` — dialog renders title/hint/message from state and clears on Close
- [x] 2.2 GREEN: error dialog + code copy map in `SftpTransferSurface.tsx`

## 3. Verify + archive

- [x] 3.1 Touched tests green (50 across the SFTP suites); oxlint/tsc clean; en.json catalog carries the new keys (`verify-localization-extraction` exit 0)
- [x] 3.2 `openspec archive add-sftp-action-error-dialog`
