# Proposal: add-sftp-file-transfer

## Why

Users develop projects locally and need to move files to/from servers reachable only over SSH (often on isolated networks where no Orca-side service can be installed). Today they must drop out of Orca into an external SFTP client, re-entering credentials and hand-mapping paths. Orca already owns the full SSH connection stack (`SshTarget` + auth resolution + credential prompting) and SFTP upload primitives (`src/main/ssh/sftp-upload.ts`, used by relay deploy) — exposing manual upload/download/compare from the file explorer closes this loop with zero server-side installation.

## What Changes

- Add per-workspace SFTP mapping profiles — `{ label, targetId, localRoot, defaultRemoteDir }` — stored in global persistence keyed by workspace path (no `sftp.json` file in the repo). CRUD lives in a new Settings section; connections/auth reuse the existing global `SshTarget` list.
- File explorer context menu gains three submenus — **Upload to ▸**, **Download from ▸**, **Compare with remote ▸** — each listing all profiles for the current workspace. Clicking a profile executes immediately; no confirmation dialogs anywhere in the flow.
- Recursive upload/download with remote `mkdir -p`. Upload skips paths the file explorer hides (gitignore-aware) plus a hardcoded `.git` skip. Overwrites are silent in both directions; a local file about to be overwritten by a download is first moved to the OS trash.
- Single-file local↔remote compare opens a read-only diff tab reusing the `editor/DiffViewer` pattern. Directory compare is disabled; binary files are refused; remote reads are capped at 10 MB.
- SFTP-dedicated TOFU host-key trust (global store keyed `host:port` → SHA256 fingerprint): first connection shows the fingerprint for confirmation, later connections verify silently, a changed key hard-blocks with a strong warning offering "clear trust and re-confirm" (never unconditional acceptance). Terminal connection policy is unchanged.
- `SshTarget` gains optional remembered credentials (password / key passphrase) via a "remember" checkbox in the existing credential prompt, persisted with `safeStorage`. Also removes repeated prompts for terminal reconnects.
- Each operation opens its own short-lived ssh2 connection (reused only within one operation, e.g. a recursive transfer) and closes it when done. Feature is user-manual only: not exposed as an AI tool.
- Scope guardrails: local workspaces only (including WSL paths); menu is hidden for SSH remote workspaces; mobile/paired clients out of scope; targets whose transport is system-ssh-only (GSSAPI, exotic ProxyCommand) fail with a clear "not supported" error in v1.

## Capabilities

### New Capabilities

- `sftp-profiles`: Per-workspace mapping configuration model, persistence, Settings CRUD UI, and the zero-configuration context-menu state.
- `sftp-transfer`: Upload/download execution — path mirroring rules, ignore behavior, overwrite semantics, failure policy, progress/cancel notifications, connection lifecycle.
- `sftp-diff`: Single-file local↔remote compare in a read-only diff tab, with size and binary limits.
- `sftp-host-trust`: TOFU host-key trust store and its confirm/block/re-confirm UX, scoped to SFTP connections.
- `ssh-credential-memory`: Optional per-`SshTarget` remembered credentials in `safeStorage`, surfaced through the existing credential prompt.

### Modified Capabilities

(none — `openspec/specs/` is empty; no existing specs are amended)

## Impact

- **Main process**: new `sftp:` IPC namespace (profile CRUD, upload/download/compare, trust + transfer events); new download counterpart to `src/main/ssh/sftp-upload.ts`; host-trust store and SFTP profiles added to persistence; `SshTarget` credential persistence touching `ssh-connection.ts` auth resolution and the credential prompt flow; settings IPC.
- **Renderer**: FileExplorer row/context menu additions (local workspaces only); transfer notification card (progress + cancel via existing toast patterns); read-only diff tab type reusing `editor/DiffViewer.tsx` family; Settings section for profile management.
- **i18n**: all new UI strings in `en`/`zh`/`ja`/`ko`/`es` locale files.
- **Tests**: unit tests colocated with new/changed modules per repo convention (persistence, path mirroring, ignore rules, trust store, credential memory, IPC handlers).
- **Out of scope**: remote file browsing tree, SSH-workspace file bridging, mobile/relay wire surface, AI tool exposure, permission-bit/mtime preservation, mirror-delete on download.
