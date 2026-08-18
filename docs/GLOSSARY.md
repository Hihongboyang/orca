# Glossary

One term per concept. Specs, design docs, code naming, and reviews use these terms exactly; synonyms get flagged in review. Add a term here before using it in a new artifact.

| Term | Definition |
|---|---|
| **SshTarget** | Global SSH connection model (`src/shared/ssh-types.ts`): host, port, auth (key/password/agent), jump hosts, ssh-config import. The single auth source — SFTP reuses it, never forks it. |
| **SFTP profile** (`SftpWorkspaceProfile`) | Per-workspace mapping: `label` + `targetId` + `localRoot` + `defaultRemoteDir`. Persisted in `sftp-profiles`, keyed by normalized workspace path. |
| **localRoot** | Absolute local path a profile maps to the remote side. A selection outside it is an `outside-local-root` error — no auto-switching to another profile. |
| **defaultRemoteDir** | Absolute POSIX path on the remote that `localRoot` maps to. Validated absolute at save. |
| **mirror path resolution** | Local↔remote path mapping: `realpath` normalization, platform-appropriate case sensitivity, local separators converted to `/` at the boundary. |
| **transfer** | One upload or download operation: dedicated short-lived ssh2 connection, one or many files, per-file outcomes, cancellable via `AbortSignal`. |
| **compare** | Read-only single-file diff of local vs remote: ≤10 MB, text only, rendered through the existing `DiffViewer` tab pattern. |
| **host trust (TOFU)** | Per-`host:port` SHA256 fingerprint store (`sftp-host-trust`). First use prompts; later connections verify silently; a mismatch hard-blocks until trust is cleared and re-confirmed. SFTP-scoped — terminal connections unchanged. |
| **remembered credential** | Opt-in encrypted password/passphrase stored on an `SshTarget` via `safeStorage`; exists only in main-process persistence, never in renderer-facing payloads. |
| **copy semantics** | Download behavior: create/overwrite files, never delete local files that have no remote counterpart. |
| **workspace** | An opened project context: local, WSL (UNC path), or SSH remote. SFTP surfaces only on local/WSL workspaces. |
