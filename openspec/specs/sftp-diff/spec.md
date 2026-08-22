# sftp-diff
## Requirements


### Requirement: Single-file remote compare
The system SHALL compare a selected local file against its mirrored remote path and render the difference in a read-only compare view following the existing `editor/DiffViewer` rendering pattern (v1: modal compare dialog, same pattern as `ExternalFileChangeCompareDialog`; promotion to an editor tab is a follow-up — design D15). The remote file SHALL be read into memory in the main process subject to a 10 MB hard cap; larger remote files SHALL be refused with an error naming the cap and suggesting download instead.

#### Scenario: Differing file compared
- **WHEN** a user runs "Compare with remote" on a local text file whose remote mirror differs
- **THEN** a read-only compare view opens showing local and remote content side by side

#### Scenario: Oversized remote file
- **WHEN** the mirrored remote file exceeds 10 MB
- **THEN** the compare is refused with an error stating the 10 MB limit

#### Scenario: Remote file missing
- **WHEN** the mirrored remote path does not exist
- **THEN** the compare reports an error and no diff tab opens

### Requirement: Compare input restrictions
The system SHALL disable the compare action for directory selections and SHALL refuse binary content with a clear message. Only local↔remote comparison SHALL be offered.

#### Scenario: Directory selection
- **WHEN** the selected item is a directory
- **THEN** the "Compare with remote" menu item is disabled

#### Scenario: Binary file
- **WHEN** either side of the comparison is detected as binary
- **THEN** the compare is refused with a message explaining binary compare is unsupported
