# ssh-credential-memory

## ADDED Requirements

### Requirement: Optional remembered credentials per target
The system SHALL allow users to opt in, via a "remember" checkbox in the SSH credential prompt, to persist the entered password or private-key passphrase for a `SshTarget`. Remembered credentials SHALL be encrypted with `safeStorage` and SHALL be used automatically by future connections to that target, including SFTP operations and terminal reconnects.

#### Scenario: Remembered password reused
- **WHEN** a user checks "remember" while entering a password for a target and later triggers any new connection to it
- **THEN** the stored credential is used and no prompt appears

#### Scenario: Opt-out default
- **WHEN** a user submits the credential prompt without checking "remember"
- **THEN** nothing is persisted and the next connection prompts again

### Requirement: Credential removal
The system SHALL provide a way to clear a target's remembered credential (from target management), after which connections prompt again.

#### Scenario: Cleared credential
- **WHEN** a user clears the remembered credential for a target
- **THEN** the encrypted value is deleted from persistence and the next connection prompts interactively

### Requirement: Decryption failure fallback
The system SHALL treat a credential that cannot be decrypted (e.g. OS keychain reset) as absent and fall back to interactive prompting rather than failing the connection.

#### Scenario: Keychain reset
- **WHEN** stored credentials become undecryptable
- **THEN** connections prompt for credentials again and otherwise behave normally
