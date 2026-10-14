# sftp-transfer
## Requirements


### Requirement: Context-menu triggered transfer
The system SHALL offer "Upload to ▸", "Download from ▸", and "Compare with remote ▸" submenus in the file explorer context menu, each listing all profiles of the current workspace. Selecting a profile SHALL execute the operation immediately with no confirmation dialog. The submenus SHALL appear only for local workspaces (including WSL paths) and SHALL be hidden for SSH remote workspaces.

#### Scenario: Immediate upload
- **WHEN** a user selects a file and clicks a profile under "Upload to ▸"
- **THEN** the upload starts immediately with no confirmation prompt

#### Scenario: SSH workspace excluded
- **WHEN** the active workspace is an SSH remote workspace
- **THEN** no SFTP submenu entries appear in the context menu

### Requirement: Mirror path resolution
The system SHALL map a local path under a profile's `localRoot` to the corresponding path under `defaultRemoteDir` (and vice versa), normalizing with `realpath`, comparing containment with platform-appropriate case sensitivity, and converting local separators to `/` at the boundary. If the selected item is not under the selected profile's `localRoot`, the system SHALL report an error and perform no transfer. The system SHALL NOT auto-switch to another profile whose `localRoot` does contain the item.

#### Scenario: Mirrored upload path
- **WHEN** a user uploads `<localRoot>/src/main.ts` with a profile mapping `localRoot` → `/srv/app`
- **THEN** the file is written to `/srv/app/src/main.ts`

#### Scenario: Outside the selected profile's root
- **WHEN** the selected item is outside the chosen profile's `localRoot` (even if inside another profile's)
- **THEN** an error is reported and no transfer occurs

### Requirement: Recursive directory transfer
The system SHALL support recursive directory upload and download. Upload SHALL create remote directories as needed (`mkdir -p` semantics); download SHALL create local parent directories as needed. Upload SHALL skip paths ignored by the file explorer's ignore rules plus `.git`; both directions SHALL skip symbolic links. Download SHALL use copy semantics: it SHALL create files absent locally and overwrite existing ones, but SHALL NEVER delete local files that have no remote counterpart.

#### Scenario: Nested directory upload
- **WHEN** a user uploads a directory containing subdirectories
- **THEN** remote parent directories are created and all non-ignored files are transferred

#### Scenario: Local extras preserved on download
- **WHEN** a download completes into a local directory containing files absent on the remote
- **THEN** those local files remain untouched

### Requirement: Overwrite semantics
The system SHALL overwrite existing destination files silently in both directions without content comparison. Before a download overwrites an existing local file, the system SHALL move that file to the OS trash; if trashing fails, the local file SHALL be treated as failed and left unmodified. Permission bits and modification times SHALL NOT be preserved.

#### Scenario: Download overwrites via trash
- **WHEN** a download overwrites an existing local file and the OS trash is available
- **THEN** the previous local file is moved to the trash and the new content written

#### Scenario: Trash unavailable
- **WHEN** the OS trash operation fails during a download overwrite
- **THEN** that file is reported as failed and its local content is left unchanged

### Requirement: Short-lived dedicated connections
The system SHALL open a dedicated ssh2 connection per operation using the profile's `SshTarget` authentication, reuse that single connection for the entire operation (including recursive transfers), and close it when the operation ends. The system SHALL NOT attach transfers to a user's live terminal connection. Targets whose transport requires system OpenSSH (GSSAPI or exotic ProxyCommand) SHALL fail with a clear "not supported" error.

#### Scenario: Connection closed after operation
- **WHEN** an operation completes or fails
- **THEN** its dedicated connection is closed

#### Scenario: System-ssh-only target
- **WHEN** a profile references a target that requires system OpenSSH transport
- **THEN** the operation fails with an explicit not-supported message

### Requirement: Batch failure policy and progress
The system SHALL continue a recursive transfer after individual file failures and report a completion summary of succeeded and failed counts with failed paths. The system SHALL surface an in-app transfer notification with progress and a cancel affordance; cancelling SHALL abort remaining work via `AbortSignal`. A card whose batch finished with no error, no cancellation, and zero failed outcomes SHALL dismiss itself automatically after a short delay that pauses while hovered or focused; every other completion SHALL require manual dismissal. When an explorer action (upload, download, or compare) fails at the operation level — the invoke rejects and no transfer starts — the system SHALL additionally surface a modal error dialog with a code-specific explanation and the raw message; `host-key-mismatch` SHALL NOT open this dialog because its dedicated block dialog already covers it, and per-file batch failures SHALL remain card-only.

#### Scenario: One bad file does not stop the batch
- **WHEN** a recursive upload encounters an unreadable file among many
- **THEN** remaining files still transfer and the summary reports both counts with the failed path

#### Scenario: Cancel mid-transfer
- **WHEN** a user cancels from the transfer notification
- **THEN** remaining work stops and the summary reflects what completed before cancellation

#### Scenario: Clean success auto-dismisses
- **WHEN** a transfer finishes with no error, not cancelled, and every outcome ok
- **THEN** its card dismisses itself after the delay without user action

#### Scenario: Hover pauses auto-dismiss
- **WHEN** the pointer is over a clean-success card when the delay elapses
- **THEN** the card remains until the pointer leaves, after which the delay restarts

#### Scenario: Failure stays visible
- **WHEN** a transfer finishes with any failed outcome, cancellation, or error
- **THEN** its card remains until manually dismissed

#### Scenario: Operation-level failure opens the error dialog
- **WHEN** an upload, download, or compare invoke rejects before any work runs
- **THEN** a modal dialog explains the failure by error code and shows the raw message

#### Scenario: Host key mismatch stays on its dedicated dialog
- **WHEN** the failure code is `host-key-mismatch`
- **THEN** only the existing block dialog appears

#### Scenario: Per-file batch failures stay card-only
- **WHEN** a recursive transfer completes with some failed outcomes
- **THEN** no modal error dialog appears; the card summary reports the failures
