## Why

Compare failures are silent today (`runSftpExplorerAction`'s catch calls `failSftpTransfer`, but compare never opens a card, so nothing renders), and upload/download operation-level failures only tint the corner card. Users get no clear signal when an action cannot run at all (unknown profile, path outside `localRoot`, >10 MB compare, binary compare, system-ssh-only transport, connection errors).

## What Changes

- Failed SFTP explorer actions (upload, download, compare) reject through a shared catch that now raises an error dialog with a code-specific explanation plus the raw message.
- `host-key-mismatch` keeps its existing dedicated block dialog instead (no double prompt).
- Partial per-file batch failures keep the card summary contract — only operation-level rejects (the IPC call itself failing) open the dialog.

## Capabilities

### New Capabilities
- `sftp-action-error-dialog`: modal error surface for failed SFTP explorer actions.

### Modified Capabilities
- `sftp-transfer`: operation-level failures (action never ran) surface a modal error dialog; per-file batch failures remain card-only.

## Non-Goals

- No retry-from-dialog affordance.
- No toast/notification channel change; the transfer card stack is untouched.
- No new error codes — existing `SftpTransferErrorCode` vocabulary drives the copy.

## Reused Modules and Flows

- `runSftpExplorerAction` catch path (`sftp-transfer-actions.ts`) as the single raise point.
- `SftpTransferSurface` dialog patterns (Dialog/Button/translate) matching the host-key prompts.
- `parseSftpIpcError` for code extraction; store slice state pattern for one-shot dialog state.
