# sftp-host-trust

## ADDED Requirements

### Requirement: TOFU host-key trust for SFTP connections
The system SHALL maintain a global trust store keyed by `host:port` mapping to the SHA256 fingerprint of the accepted host key. On first SFTP connection to an unknown `host:port`, the system SHALL present the fingerprint for user confirmation before proceeding. On subsequent connections the fingerprint SHALL be verified silently.

#### Scenario: First connection
- **WHEN** an SFTP operation connects to a `host:port` with no stored fingerprint
- **THEN** the user is shown the fingerprint and the connection proceeds only after confirmation

#### Scenario: Known host
- **WHEN** an SFTP operation connects to a `host:port` whose stored fingerprint matches
- **THEN** the connection proceeds with no prompt

### Requirement: Host key change hard-block
The system SHALL block the connection when the presented host key fingerprint differs from the stored one, showing a strong warning that names the host and both fingerprints. The only recovery SHALL be an explicit "clear trust and re-confirm" action that removes the stored fingerprint and restarts first-use confirmation with the new fingerprint. The system SHALL NOT offer unconditional acceptance of a changed key.

#### Scenario: Changed key blocked
- **WHEN** a server presents a different key than the one stored for its `host:port`
- **THEN** the connection is refused and a strong warning dialog is shown

#### Scenario: Legitimate rotation recovery
- **WHEN** the user chooses "clear trust and re-confirm" in the warning dialog
- **THEN** the stored fingerprint is removed and the new fingerprint goes through first-use confirmation again

### Requirement: Terminal connections unaffected
The host-trust store SHALL apply only to SFTP-dedicated connections. Existing terminal/relay connection behavior SHALL be unchanged by this capability.

#### Scenario: Terminal session untouched
- **WHEN** a user opens a terminal to a host whose key changed
- **THEN** terminal connection behavior is identical to before this change
