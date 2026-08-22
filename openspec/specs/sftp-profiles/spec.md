# sftp-profiles
## Requirements


### Requirement: Per-workspace SFTP mapping profiles
The system SHALL store SFTP mapping profiles in global persistence keyed by normalized workspace path. Each profile SHALL contain `id`, `label`, `targetId` (reference to a global `SshTarget`), `localRoot`, and `defaultRemoteDir` (absolute POSIX path). No profile data SHALL be written into the workspace directory.

#### Scenario: Profile saved for a folder workspace
- **WHEN** a user saves a profile while a non-git folder workspace is active
- **THEN** the profile is persisted under that workspace's normalized path and is available after app restart

#### Scenario: Workspaces are isolated
- **WHEN** two workspaces each define profiles
- **THEN** each workspace's context menu lists only its own profiles

### Requirement: Profile CRUD in Settings
The system SHALL provide create, read, update, and delete management for SFTP profiles in a dedicated Settings section, including validation that `defaultRemoteDir` is an absolute path and that `targetId` references an existing `SshTarget`.

#### Scenario: Invalid remote path rejected
- **WHEN** a user saves a profile whose `defaultRemoteDir` is not absolute
- **THEN** the save is rejected with a validation error and nothing is persisted

#### Scenario: Target deletion
- **WHEN** a referenced `SshTarget` is removed from Orca
- **THEN** profiles referencing it are surfaced as invalid in Settings rather than silently executing against a missing target

### Requirement: Zero-configuration menu state
The system SHALL show a disabled hint plus an "Open SFTP settings" entry in the SFTP context submenus when the current workspace has no profiles.

#### Scenario: No profiles configured
- **WHEN** a user opens an SFTP submenu with zero profiles for the workspace
- **THEN** the submenu shows a disabled hint and an entry that navigates to the SFTP Settings section
