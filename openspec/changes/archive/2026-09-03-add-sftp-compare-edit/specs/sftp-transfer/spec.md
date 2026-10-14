# sftp-transfer delta

## MODIFIED Requirements

### Requirement: Batch failure policy and progress
The system SHALL continue a recursive transfer after individual file failures and report a completion summary of succeeded and failed counts with failed paths. The system SHALL surface an in-app transfer notification with progress and a cancel affordance; cancelling SHALL abort remaining work via `AbortSignal`. A card whose batch finished with no error, no cancellation, and zero failed outcomes SHALL dismiss itself automatically after a short delay that pauses while hovered or focused; every other completion SHALL require manual dismissal.

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
