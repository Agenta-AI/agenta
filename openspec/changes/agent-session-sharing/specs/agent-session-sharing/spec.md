## ADDED Requirements

### Requirement: Named session roles
Web agent sessions SHALL support an owner and named Viewer or Participant grants. Shared content SHALL include existing history, future replies, and session files.

#### Scenario: Viewer
- **WHEN** Carol has Viewer access
- **THEN** Carol SHALL read shared content but SHALL NOT send requests, approve actions, or change sharing.

#### Scenario: Participant
- **WHEN** Bob has Participant access and may use the selected agent
- **THEN** Bob SHALL contribute using the agent-owned account; participation alone SHALL NOT grant sharing or agent editing.

#### Scenario: Read without agent use
- **WHEN** Bob has session read access but cannot use the agent
- **THEN** Bob SHALL read the web history and SHALL be denied a new invocation.

#### Scenario: Approval
- **WHEN** a participant requests an action requiring approval
- **THEN** only an authenticated requester with authority for that pending action SHALL approve it in this release; read access alone SHALL NOT suffice.

### Requirement: Manage session sharing
Only the session owner SHALL change ordinary web-session invitations, delete the session, or archive it. Project-wide sharing SHALL grant Viewer access in this first release.

#### Scenario: Named invitation
- **WHEN** the owner gives Bob Participant and Carol Viewer
- **THEN** the service SHALL retain the two distinct grants, reject cross-project users, and prevent duplicate grants.

#### Scenario: Only me
- **WHEN** the owner selects Only me
- **THEN** the service SHALL remove project visibility and all named grants atomically.

#### Scenario: Revocation
- **WHEN** a member loses all session grants or project membership
- **THEN** new session reads and requests SHALL be denied and active streams SHALL recheck access.

#### Scenario: Private creation
- **WHEN** a new web agent session is created by an authenticated human
- **THEN** the session SHALL start private with that human as owner.

### Requirement: Parent access for files
Session file reads, downloads, exports, and issued storage access SHALL require the parent session permission. Ordinary runs SHALL write generated files to their session and SHALL NOT edit shared agent files without agent edit permission.

#### Scenario: Guessed file
- **WHEN** a user without session read permission guesses a file identifier
- **THEN** the file service SHALL deny access.

#### Scenario: Expired sharing
- **WHEN** session access is removed after a download or credential was issued
- **THEN** new credentials SHALL be denied; the system SHALL document that prior downloads and unexpired credentials are not recalled.
