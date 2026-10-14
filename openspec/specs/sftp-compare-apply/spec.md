# sftp-compare-apply Specification

## Purpose
Editing the remote side from the SFTP compare dialog: per-session fresh diff models, an editable remote pane with save-back to the mirror path, and chunk-level apply from the local pane.
## Requirements
### Requirement: Per-session compare freshness
The system SHALL render each compare open with the current local and remote content. Each compare session SHALL use freshly keyed editor models; models from a superseded session SHALL NOT be reused and SHALL be disposed when the dialog closes.

#### Scenario: Re-compare after upload shows no diff
- **WHEN** a file with local edits is compared, uploaded, and compared again
- **THEN** the second compare shows no differences between the two panes

#### Scenario: Superseded models are released
- **WHEN** the compare dialog closes
- **THEN** that session's unattached editor models are disposed by model-path prefix

### Requirement: Editable remote pane
The system SHALL render the remote (right) pane of `SftpCompareDialog` editable and the local (left) pane read-only. Unsaved changes SHALL surface a dirty indicator; Ctrl+S and the Save affordance SHALL write the edited remote content to the remote mirror path via the `SFTP_SAVE_REMOTE_CHANNEL` handler.

#### Scenario: Direct edit and save
- **WHEN** the user edits the remote pane and triggers Save
- **THEN** the edited content is written to the mirror remote path over a dedicated short-lived session and the dialog reflects the saved state

#### Scenario: Save failure surfaces inline
- **WHEN** the save-back IPC rejects
- **THEN** the dialog shows the error inline, keeps the edited buffer, and stays open

#### Scenario: Oversized payload refused
- **WHEN** the edited content exceeds `SFTP_COMPARE_MAX_BYTES`
- **THEN** the main process rejects the save with `compare-file-too-large` and the remote file is untouched

### Requirement: Chunk-level apply from local
The compare dialog SHALL offer toolbar actions over the live diff hunks: previous/next hunk navigation, apply-the-hunk-at-the-cursor from the local pane into the remote pane, and apply-all-hunks. Applied hunks SHALL land in the remote pane as pending edits subject to the same Save flow.

#### Scenario: Apply one hunk
- **WHEN** the cursor sits at a hunk and the user invokes Apply hunk
- **THEN** only that hunk's local lines replace the corresponding remote lines and the hunk disappears from the diff

#### Scenario: Apply all hunks
- **WHEN** the user invokes Apply all
- **THEN** every current hunk is applied and the remote pane equals the local pane (pending Save)

#### Scenario: No hunks remaining
- **WHEN** the panes are identical and the user invokes Apply hunk or Apply all
- **THEN** the actions are no-ops

