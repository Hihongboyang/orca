# sftp-transfer delta

## MODIFIED Requirements

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
