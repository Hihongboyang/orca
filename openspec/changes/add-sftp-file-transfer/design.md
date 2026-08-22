# Design: add-sftp-file-transfer

## Context

Orca users develop locally and deploy to servers reachable only over SSH. Orca already has: a global `SshTarget` model (`src/shared/ssh-types.ts`) with auth resolution (key/password/agent, jump hosts, ssh-config import), interactive credential prompting with `lastRequiredPassphrase` semantics (no credential persistence today), and hardened SFTP upload primitives in `src/main/ssh/sftp-upload.ts` (streaming, TOCTOU/symlink guards, `AbortSignal`, recursive `uploadDirectory`) used by relay deploy. Existing ssh2 connections do not verify host keys (`hostVerifier` unconditionally returns `true` in `ssh-connection.ts`). The file explorer (`src/renderer/src/components/right-sidebar/`) already computes gitignore-aware ignored paths, and diff rendering exists as the `editor/DiffViewer.tsx` family. No `GitDiffPane` component exists — the diff-tab pattern is what gets reused.

Constraints: servers are on isolated networks with no Orca-side service installable (SFTP rides the sshd subsystem, direction is outbound from the user's machine — compatible). AGENTS.md requires folder-workspace support, Windows path correctness, and 5-locale i18n.

## Module Map

Contract-first: `src/shared/sftp-types.ts` is the single home for every new field shape (profiles, host-trust store, transfer request/result/progress, IPC channel constants). Decisions below reference it instead of re-describing shapes.

| File | New/Mod | Contents |
|---|---|---|
| `src/shared/sftp-types.ts` (+`.test.ts`) | new | `SftpWorkspaceProfile`, profiles-by-workspace map, host-trust store shape, transfer request/result/progress types, IPC channel constants |
| `src/shared/ssh-types.ts` | mod | optional remembered-credential fields on `SshTarget` |
| `src/main/ssh/sftp-host-trust.ts` (+`.test.ts`) | new | TOFU store: fingerprint verify, first-use confirm, clear-trust recovery |
| `src/main/ssh/sftp-mirror-path.ts` (+`.test.ts`) | new | `localRoot`↔`defaultRemoteDir` mapping, `realpath` normalization, platform case sensitivity, separator boundary |
| `src/main/ssh/sftp-download.ts` (+`.test.ts`) | new | download + compare read path (trash-before-overwrite, 10 MB cap, binary refusal) — mirrors `sftp-upload.ts` |
| `src/main/ssh/sftp-transfer-session.ts` (+`.test.ts`) | new | per-operation connection lifecycle: auth resolution + remembered credentials + host-trust verify → run operation → close in `finally` |
| `src/main/ssh/ssh-connection.ts` | mod | accept a host-key verifier hook for SFTP-scoped connections (today `hostVerifier` returns `true` unconditionally) |
| `src/main/ssh/sftp-upload.ts` | mod (minimal) | reused as the upload engine; ignore list arrives as an operation input |
| `src/main/persistence.ts` | mod | `sftp-profiles` + host-trust keys in durable state; remembered credentials encrypted via the existing `encryptToSentinel` secret-slot mechanism |
| `src/main/ipc/sftp-transfer.ts` (+`.test.ts`) | new | `registerSftpTransferHandlers`, wired from `src/main/ipc/register-core-handlers.ts` |
| `src/main/ipc/ssh.ts`, `src/main/ssh/ssh-connection-store.ts`, `src/renderer/src/App.tsx` | mod | credential-prompt flow (`lastRequiredPassphrase` seam) gains the "remember" checkbox |
| `src/renderer/src/components/right-sidebar/FileExplorerRow.tsx` | mod | context-menu submenus (Upload to ▸ / Download from ▸ / Compare with remote ▸), local-workspace gating |
| `src/renderer/src/components/settings/SftpProfilesSection.tsx` | new | profile management section (existing `*Section.tsx` convention; nav slot = open question below) |
| `src/renderer/src/components/sftp/SftpTransferNotificationCard.tsx` | new | progress + cancel + completion-summary card |
| `src/renderer/src/components/editor/EditorContent.tsx` | mod | read-only compare tab kind rendering through the existing `DiffViewer` path (precedent: `ExternalFileChangeCompareDialog.tsx`) |

Seam to resolve at implementation: the explorer's ignore computation lives renderer-side (`right-sidebar/use-file-explorer-ignored-paths.ts`); either port it to `src/shared/` or pass the ignore list over IPC as an operation input (D6 parity either way).

## Data Flow

One transfer, end to end (ownership per stage):

1. **Renderer — trigger** (`FileExplorerRow.tsx` context menu, or `SftpTransferNotificationCard.tsx` cancel): resolves the active workspace + selection, invokes `sftp:upload|download|compare` with typed params. Owns UI state only — never file IO.
2. **IPC boundary** (`src/main/ipc/sftp-transfer.ts`): validates params against `sftp-types.ts` (boundary validation only), looks up the profile, mints a `transferId`, returns; work continues async.
3. **Session** (`sftp-transfer-session.ts`): auth resolution (+ remembered credentials), TOFU check via `sftp-host-trust.ts` — an unknown fingerprint detours through `sftp:host-key-required` → renderer dialog → `sftp:confirm-host-key` before the dedicated ssh2 connection opens; system-ssh-only transports are refused here.
4. **Engine**: upload → `sftp-upload.ts` (local fs → remote, ignore rules applied); download → `sftp-download.ts` (remote → local fs; every overwrite passes through `shell.trashItem` first); compare → remote read ≤10 MB into main-process memory, content returned to renderer.
5. **Back-flow**: throttled `sftp:transfer-progress` events → renderer SFTP store slice → notification card; final `SftpTransferResult` (per-file outcomes) → completion summary. The connection closes in `finally` at session exit.

Invariants: secrets (remembered credentials, passphrases) never cross the IPC boundary into renderer payloads; all fs/ssh2/trash side effects happen in main; renderer state is a projection of events.

## Goals / Non-Goals

**Goals:**

- Right-click upload/download/compare from the file explorer, executing immediately with zero confirmation dialogs.
- Per-workspace mapping profiles backed by the existing global `SshTarget` list — no parallel auth stack.
- TOFU host-key trust for SFTP connections (password auth makes MITM a credential-theft risk, not just a file-privacy risk).
- No unrecoverable local data loss: downloads trash overwritten local files first.
- Batch transfers survive individual file failures and report a summary.

**Non-Goals:**

- Remote file browsing tree; manual path entry fallback.
- SSH-workspace support (file bridging), mobile/paired-client surface, AI-tool exposure.
- Permission-bit/mtime preservation; mirror-delete semantics on download.
- Host-key policy changes for terminal connections.
- System-ssh-only transports (GSSAPI, exotic ProxyCommand) in v1 — clear error instead.

## Decisions

### D1. Reuse `SshTarget` instead of a standalone connection profile

Alternative rejected: a standalone `SftpProfile` with its own host/port/auth fields. It would fork the auth stack (second credential store, second host UI) and lose agent/jump-host/ProxyCommand/ssh-config import — the features wall-garden servers actually need. Reusing `SshTarget` is zero server-side cost (sftp is an sshd subsystem; adding a target to Orca is inert until used).

### D2. Profiles in global persistence keyed by workspace path — no `sftp.json`

`sftp-profiles: Record<normalizedWorkspacePath, SftpWorkspaceProfile[]>` — all shapes live in `src/shared/sftp-types.ts` (the change's type contract), not in this document. Alternative rejected: a `sftp.json` in the project root. With connection fields gone, the file's only content is path mappings keyed to a machine-local `targetId` — no portability value, but real git-history leak risk and divergent behavior between git worktrees and folder workspaces. Keying by workspace path makes worktrees and folder workspaces behave identically.

### D3. Optional credential memory on `SshTarget` (`safeStorage`)

The credential prompt gains a "remember" checkbox; a checked password/passphrase is encrypted via the existing `safeStorage` boundary in `persistence.ts` and auto-used by future connections. Session-only caching and always-prompt were rejected: always-prompt makes "right-click → instant transfer" impossible for password-auth targets (the primary auth mode in this environment), and the change also fixes the same friction for terminal reconnects.

### D4. Dedicated short-lived connection per operation

Each upload/download/compare opens its own ssh2 connection from the target's parameters (auth resolution + remembered credentials), reuses it within the operation (e.g. one recursive transfer), and closes it in `finally`. Piggybacking a live terminal connection was rejected: it couples transfer failures to user sessions and muddies ownership/close semantics; with D3 the re-auth cost is a ~1–3 s handshake only.

### D5. SFTP-scoped TOFU host-key trust

Global store `Record<"host:port", SHA256-fingerprint>` (shape in `src/shared/sftp-types.ts`); first SFTP connection to an unknown `host:port` prompts with the fingerprint (the value is already computed in the existing `hostVerifier` hook — today discarded), subsequent connections verify silently, a mismatch hard-blocks with a strong warning whose only recovery is "clear trust and re-confirm" (still requires human confirmation of the new fingerprint; never unconditional acceptance). Terminal policy deliberately unchanged — rolling TOFU out to all ssh2 connections would prompt every existing user and hard-block legitimate rotations; that's a separate future change.

### D6. Upload ignore = file-explorer parity + `.git`

Recursive upload reuses the explorer's ignore computation (gitignore-aware) and always skips `.git`. "What the explorer hides, upload skips" is the least surprising semantics; folder workspaces without gitignore degrade to skipping `.git` only.

### D7. Silent overwrite; downloads trash local files first

Both directions overwrite silently (no dialogs, no content-equality short-circuit). Before a download overwrites an existing local file, the file is moved to the OS trash via `shell.trashItem` — local is where uncommitted work lives and divergence is expected (the compare feature exists for that reason), so that side gets recoverability. If trashing fails (e.g. no trash backend on some Linux, odd WSL mounts), the file is treated as failed and left untouched rather than destroyed. Remote overwrites are not recoverable but are re-derivable from local by design.

### D8. Compare: single file, read-only tab, 10 MB cap

Reads the remote file into memory in the main process (hard cap 10 MB → refuse with a clear message), refuses binary content, and opens a read-only diff tab reusing the `editor/DiffViewer` pattern. Directory selections disable the compare menu item. Larger caps were rejected on renderer-memory grounds; the existing large-diff render pruning does not bound the SFTP read itself.

### D9. Batch failure policy: continue and summarize

A per-file error marks that file failed and the batch continues; the completion notification reports "N succeeded / M failed" with failed paths. Fail-fast wastes large batches on one locked log file and leaves the same partial state with less information. Cancel is available throughout via `AbortSignal` (already supported by the upload core).

### D10. Local workspaces only; strict per-profile path matching

The SFTP menu appears only for local workspaces (WSL UNC paths included). Matching is strict to the selected profile: containment uses `realpath` normalization plus platform-appropriate case sensitivity (case-insensitive on Windows/macOS), local separators are converted to `/` at the mapping boundary, `defaultRemoteDir` must be absolute (validated at save). A file under profile A's `localRoot` but invoked with profile B selected → error, no auto-switching; overlapping roots across profiles are allowed and disambiguated by explicit user selection every time.

### D11. Download is copy-semantics, never mirror-delete

Downloads create missing local parents (`mkdir -p`), create files absent locally, overwrite differing ones (D7), skip remote symlinks (symmetric with upload's symlink skip), and never delete local files that have no remote counterpart.

### D12. SFTP settings live inside `SshPane` as a subsection

`SftpProfilesSection.tsx` renders within the existing SSH settings pane, scoped to the active workspace. Alternative rejected: a separate top-level settings nav entry — profiles exist only as mappings onto `SshTarget`s, so colocating with target management keeps the reference visible and avoids nav sprawl for a sub-feature.

### D13. Dedicated persistent transfer card, not a transient toast

Transfers surface as `SftpTransferNotificationCard` in the existing toast overlay area, following toast visual patterns but persistent while a transfer is in flight — progress and cancel need a stable surface. Alternatives rejected: reusing the terminal-error toast (transient — cannot host progress or cancel); a notifications-center entry (out of v1 scope; the card can seed one later).

### D14. Transfer correlation via renderer-minted `requestId`

`transferId` is minted in main and only reaches the renderer via progress events / the final result — too late to correlate a card opened at click time (multiple concurrent transfers make "most recent pending" racy). The renderer therefore mints an optional `requestId`, passes it on `sftp:upload`/`sftp:download`, and main echoes it on every `SftpTransferProgress` for that operation (additive field; old payloads unaffected). Cards correlate by `requestId` first, adopt the main `transferId` from the first progress event (cancel needs it), and the completion result is matched by either.

### D15. Compare renders as a modal DiffViewer dialog in v1

The design originally called for a read-only editor *tab*, but the editor's tab model is file-backed; a content-only diff tab would need a new tab kind across EditorContent/session persistence. v1 renders the comparison through a modal dialog reusing `DiffViewer` — the same rendering pattern as `ExternalFileChangeCompareDialog`, which the Module Map already cited as precedent. The spec scenario wording is updated to "read-only compare view"; promoting the dialog to a first-class tab is a pure follow-up (no contract change — `SftpCompareResult` is unchanged).

## UI Design

All surfaces use STYLEGUIDE.md tokens and existing `ui/` primitives; no new token values. Each surface's component states: empty / loading / error / success.

### Context-menu submenus (`FileExplorerRow.tsx`)

```
┌────────────────────────┐      ┌────────────────────────┐
│ Open                   │      │ prod    user@10.0.0.5  │
│ Reveal in Explorer     │      │ staging user@10.1.0.9  │
│ ────────────────────── │  ▸   └────────────────────────┘
│ Upload to           ▸  │
│ Download from       ▸  │      (same submenu shape for all three)
│ Compare with remote ▸  │
└────────────────────────┘
```

- States: **no profiles** → a single disabled "Upload to ▸ (no SFTP profiles)" row plus an "Add SFTP profile…" shortcut opening `SshPane`; **directory selected** → Compare row disabled; **SSH remote workspace** → the three submenus are absent entirely (spec).
- Profile rows read `label (user@host)` — target disambiguation without leaving the menu.

### `SftpProfilesSection` (inside `SshPane`)

```
SFTP Profiles — workspace: E:\myself\orca
┌──────────────────────────────────────────────┐
│ prod    user@10.0.0.5   src      → /srv/app  │ [Edit] [Delete]
│ staging user@10.1.0.9   dist     → /srv/stg  │ [Edit] [Delete]
└──────────────────────────────────────────────┘
[+ Add profile]
Form: Label* | Target* (SshTarget dropdown) | Local root* (picker) | Remote dir* (input)
```

- States: **empty** → one-line explainer + "Add profile" CTA; **validation error** → inline field errors (relative remote dir, missing target, non-absolute local root) — save blocked; **success** → list updates via `sftp:profiles-changed`; **delete** → single click, no dialog (a profile is a re-creatable mapping, no data at stake).
- The section always names the workspace it edits — profiles are workspace-scoped by key.

### `SftpTransferNotificationCard`

```
┌─────────────────────────────────────┐
│ ↑ Upload to prod           [Cancel] │
│ 42/120 files · src/renderer/src/…   │
│ ▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░   │
└─────────────────────────────────────┘
```

- States: **connecting** (spinner + label + cancel), **transferring** (file count + ellipsized current path + cancel), **success** ("120 succeeded"; auto-dismiss ~8 s), **partial failure** ("118 succeeded / 2 failed" + expandable failed-path list; persists until dismissed), **cancelled** (summary of what completed), **pre-start error** (e.g. `outside-local-root`, `host-key-mismatch`) → single-line card with the error; re-run from the menu, no retry affordance.

## Risks / Trade-offs

- [Partial-failure ambiguity: recursive ops can end half-done] → Completion summary lists per-file outcomes; user can re-run; operations are idempotent re-runs of the same mapping.
- [TOFU friction on legitimate server reinstall/key rotation] → Warning dialog's "clear trust and re-confirm" path makes rotation a one-action recovery; no data is lost.
- [Two host-key policies in one app (terminal trusts, SFTP verifies)] → Accepted consciously; SFTP is a new surface that must not copy the old weakness; unifying is a separate future change.
- [`shell.trashItem` unavailable or failing] → File is reported failed and left untouched; never silently destroyed.
- [Remembered credentials widen blast radius of OS-keychain compromise] → Opt-in per target, encrypted via `safeStorage`, removable by unchecking/removing the target.
- [Short connections add handshake latency per operation] → Accepted for isolation and predictable teardown; ~1–3 s typical.
- [10 MB compare cap may surprise users with big logs] → Error message names the cap and suggests download instead.

## Migration Plan

Additive only: new persistence keys (`sftp-profiles`, host-trust store, optional per-target encrypted credentials), new IPC namespace, new UI surfaces. No existing data migrates; old configs ignore the new keys. Rollback = revert the change; persisted new keys are harmless orphans. `SshTarget` gains only optional fields, so mixed-version persistence stays readable.

## Open Questions

None. The former settings-IA and notification-surface questions are resolved as D12/D13.
