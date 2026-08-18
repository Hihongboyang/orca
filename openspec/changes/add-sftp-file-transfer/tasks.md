# Tasks: add-sftp-file-transfer

Verification commands (defined once, used below):
- `vitest <file>` = `pnpm exec vitest run --config config/vitest.config.ts <file>`
- `pnpm run typecheck`; per-file lint `pnpm exec oxlint <files>`; full gates in §7
- **Red-first discipline**: every implementation task is preceded by its failing-test task. Run the test, confirm RED (the failure must be the missing behavior, not a syntax error), then implement until GREEN. A test that never ran red is not a contract.
- File targets come from design.md Module Map; type/channel shapes come from contracts.md — implement them verbatim.

## 1. Contracts & persistence

- [ ] 1.1 Write `src/shared/sftp-types.test.ts` covering channel-name uniqueness and error-code exhaustiveness per contracts.md. Verify: `vitest src/shared/sftp-types.test.ts` → RED (module absent)
- [ ] 1.2 Create `src/shared/sftp-types.ts` with every type, error code, and channel constant from contracts.md. Verify: 1.1 → GREEN + `pnpm run typecheck`
- [ ] 1.3 Extend `src/main/persistence.test.ts` with failing cases: `sftp-profiles` / `sftp-host-trust` round-trip; `SshTarget` optional credential fields encrypted via sentinel slots; undecryptable credential treated as absent. Verify: `vitest src/main/persistence.test.ts` → RED on the new cases
- [ ] 1.4 Implement the persistence keys and `SshTarget` optional fields (`src/shared/ssh-types.ts`, `src/main/persistence.ts` via `encryptToSentinel`). Verify: 1.3 → GREEN; `vitest src/main/ssh/ssh-target-readoption.test.ts src/main/ssh/ssh-target-id-migration.test.ts` stay green
- [ ] 1.5 Write `src/main/ssh/sftp-host-trust.test.ts` from the spec scenarios: first-use prompt, silent verify on match, mismatch hard-block, clear-trust recovery. Verify: → RED
- [ ] 1.6 Implement `src/main/ssh/sftp-host-trust.ts`. Verify: 1.5 → GREEN

## 2. Credential memory (ssh-credential-memory)

- [ ] 2.1 Write failing cases in `src/main/ssh/ssh-connection-store.test.ts`: stored credential consumed by new connections; cleared credential prompts again. Verify: → RED
- [ ] 2.2 Implement the remember/clear wiring across the credential-prompt seam (`src/renderer/src/App.tsx`, `src/main/ipc/ssh.ts`, `ssh-connection-store.ts`). Verify: 2.1 → GREEN
- [ ] 2.3 Write the failing component tests for the "remember" checkbox (opt-in, default off) and the "clear remembered credential" affordance in SSH target management. Verify: → RED
- [ ] 2.4 Implement both affordances (5 locales). Verify: 2.3 → GREEN + `pnpm run verify:localization-coverage`
- [ ] 2.5 Write the failing reconnect case in `src/main/ipc/ssh.test.ts`: terminal reconnect uses the remembered credential without re-prompting. Verify: → RED
- [ ] 2.6 Implement reconnect consumption. Verify: 2.5 → GREEN

## 3. Connection lifecycle & host trust (sftp-host-trust)

- [ ] 3.1 Write `src/main/ssh/sftp-transfer-session.test.ts` failing cases: dedicated per-op connection from `SshTarget` auth, system-ssh-only refusal (`system-ssh-only-transport`), connection closed in `finally` on success and failure. Verify: → RED
- [ ] 3.2 Implement `src/main/ssh/sftp-transfer-session.ts`. Verify: 3.1 → GREEN
- [ ] 3.3 Write failing cases: verifier-hook contract in `src/main/ssh/ssh-connection.test.ts` (SFTP-scoped only, terminal policy unchanged) + trust outcomes in the session test (unknown → prompt flow, match → silent, mismatch → hard-block). Verify: → RED
- [ ] 3.4 Wire the host-key verifier hook on `src/main/ssh/ssh-connection.ts` and the TOFU detour (`sftp:host-key-required` → `sftp:confirm-host-key`). Verify: 3.3 → GREEN

## 4. Transfer engine (sftp-transfer)

- [ ] 4.1 Write `src/main/ssh/sftp-mirror-path.test.ts` from the spec scenarios: mirrored upload path, outside-selected-root error, platform case sensitivity, separator boundary. Verify: → RED
- [ ] 4.2 Implement `src/main/ssh/sftp-mirror-path.ts`. Verify: 4.1 → GREEN
- [ ] 4.3 Write `src/main/ssh/sftp-download.test.ts` failing cases from the specs: recursive copy semantics, local `mkdir -p`, remote symlink skip, local extras preserved, trash-before-overwrite, trash-unavailable → file failed and untouched. Verify: → RED
- [ ] 4.4 Implement `src/main/ssh/sftp-download.ts` including the trash step (`shell.trashItem`). Verify: 4.3 → GREEN
- [ ] 4.5 Write failing cases for upload ignore parity (explorer rules + `.git` always skipped) on the module chosen for the Module Map seam. Verify: → RED
- [ ] 4.6 Resolve the seam (port `use-file-explorer-ignored-paths.ts` computation to `src/shared/` or pass the list over IPC) and implement. Verify: 4.5 → GREEN
- [ ] 4.7 Write failing batch cases in `sftp-download.test.ts` + `sftp-upload.test.ts`: one bad file doesn't stop the batch, per-file outcomes collected, cancel mid-transfer reflects completed work. Verify: → RED
- [ ] 4.8 Implement batch continue-on-failure, `AbortSignal` wiring, and the completion summary. Verify: 4.7 → GREEN

## 5. IPC & renderer state

- [ ] 5.1 Write `src/main/ipc/sftp-transfer.test.ts` failing cases: channel names match contracts.md exactly, profile CRUD scoped to workspace path, upload/download/compare dispatch, throttled progress events, host-key prompt flow. Verify: → RED
- [ ] 5.2 Implement `src/main/ipc/sftp-transfer.ts` wired via `src/main/ipc/register-core-handlers.ts`. Verify: 5.1 → GREEN
- [ ] 5.3 Write the failing renderer store-slice test: profiles cache + in-flight transfer state (progress, cancel). Verify: → RED
- [ ] 5.4 Implement the SFTP slice in `src/renderer/src/store/`. Verify: 5.3 → GREEN + `pnpm run typecheck`

## 6. UI

- [ ] 6.1 Write `SftpProfilesSection.test.tsx` failing cases from the UI Design states: empty CTA, inline validation (relative remote dir, missing target), list updates on `sftp:profiles-changed`, delete without dialog. Verify: → RED
- [ ] 6.2 Implement `SftpProfilesSection.tsx` inside `SshPane.tsx` (D12). Verify: 6.1 → GREEN
- [ ] 6.3 Write failing cases in `src/renderer/src/components/right-sidebar/FileExplorer.test.tsx`: submenus on local workspaces, absent on SSH workspaces (spec scenario), no-profiles disabled hint + settings shortcut, directory selection disables compare. Verify: → RED
- [ ] 6.4 Implement the context-menu submenus in `FileExplorerRow.tsx`. Verify: 6.3 → GREEN
- [ ] 6.5 Write failing component tests for `SftpTransferNotificationCard` states per D13: connecting / transferring / success / partial failure / cancelled / pre-start error; persistent while in flight. Verify: → RED
- [ ] 6.6 Implement the card. Verify: 6.5 → GREEN
- [ ] 6.7 Write failing compare cases: 10 MB cap → `compare-file-too-large` and binary → `compare-binary-refused` at the handler level; read-only diff tab opens; directories disable compare. Verify: → RED
- [ ] 6.8 Implement compare via `src/renderer/src/components/editor/EditorContent.tsx` + `DiffViewer`. Verify: 6.7 → GREEN
- [ ] 6.9 Add all new UI strings to `en`/`zh`/`ja`/`ko`/`es`. Verify: run `pnpm run verify:localization-coverage` before (RED) and after (GREEN)

## 7. Final gates

- [ ] 7.1 `pnpm run typecheck` and full `pnpm run test` green; `pnpm run lint` clean (no `max-lines` disables, per AGENTS.md)
- [ ] 7.2 Manual end-to-end against a real SSH server: first-use TOFU prompt, remembered-password upload/download round-trip, trash-on-overwrite, compare tab, cancel mid-transfer, partial-failure summary
