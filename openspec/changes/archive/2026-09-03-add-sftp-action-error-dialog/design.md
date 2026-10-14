## Context

Renderer orchestration: `runSftpExplorerAction` (sftp-transfer-actions.ts) is the single entry for upload/download/compare from the file explorer. Its catch already parses `sftp-error:<code>:<message>` via `parseSftpIpcError`; compare rejections currently vanish (no card was begun), transfers tint the card only. `SftpTransferSurface` is the globally mounted SFTP UI host (card stack + host-key dialogs).

## Goals / Non-Goals

**Goals:** one shared modal error surface for operation-level failures across all three actions; code-specific copy; no double prompting with the host-key mismatch dialog.

**Non-Goals:** retry affordances, new channels, notification changes.

## Decisions

### D1 — Raise from the shared catch, render from the Surface
`runSftpExplorerAction`'s catch sets a one-shot `sftpActionError: { code, message } | null` on the sftp store slice (via `setSftpActionError`). `SftpTransferSurface` renders the modal when non-null; Close clears it. Rejected: rendering the dialog from `FileExplorer` — the failure point is not tied to any one surface and the Surface is already the global SFTP dialog host.
Rejected: beginning a transfer card for compare — a success-path card would flash for a non-transfer action.

### D2 — Skip the generic dialog for `host-key-mismatch`
That code already drives the dedicated block dialog (`mismatchCard` in the Surface). Raising the generic dialog too would double-prompt. All other codes (including `host-key-rejected`) raise the generic dialog so the user always learns why nothing ran.

### D3 — Copy map lives beside its only consumer
A small `code → { title, hint }` map in `SftpTransferSurface.tsx`, unknown codes fall back to the raw message. No i18n key registry changes beyond the standard `translate()` fallback pattern.

## Risks / Trade-offs

- Modal interrupts flow on failure — acceptable: the action the user picked did not run at all.
- Dialog state is one-shot (last failure wins if two actions fail concurrently) — fine; each failure is acknowledged by an explicit Close.

## Module Map

| File | Change |
| --- | --- |
| `src/renderer/src/store/slices/sftp.ts` | `sftpActionError` state + `setSftpActionError` |
| `src/renderer/src/components/right-sidebar/sftp-transfer-actions.ts` | raise dialog state in catch (skip `host-key-mismatch`) |
| `src/renderer/src/components/sftp/SftpTransferSurface.tsx` | error dialog + code copy map |
| `src/renderer/src/components/right-sidebar/sftp-transfer-actions.test.ts` | new: raise/skip logic |
| `src/renderer/src/components/sftp/SftpTransferSurface.test.tsx` | new: dialog rendering |
