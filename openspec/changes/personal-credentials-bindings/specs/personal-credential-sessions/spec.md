## ADDED Requirements

### Requirement: Shared sessions never release a user-owned credential
Before the system releases a user-owned credential or calls its provider for a run of a session, it SHALL, in one transaction, lock the session row, refuse if the session is shared, and otherwise set the sticky personal-use mark. A session SHALL count as shared when it is project-visible, has any grant, or belongs to a channel thread. The rule SHALL apply to the selected credential, not to the binding. On refusal, the system SHALL NOT switch to another account.

#### Scenario: Bob continues Alice's shared chat
- **WHEN** Bob is a Participant in Alice's session and his turn reaches a `caller_account` Gmail connection
- **THEN** the system SHALL refuse the Gmail call with "This conversation is shared. Gmail is set to use each person's own account, which shared conversations cannot use." and SHALL use no Gmail account

#### Scenario: Slack channel session with a project agent account
- **WHEN** a Slack turn in a channel session reaches a `caller_account` connection whose agent account is a project connection
- **THEN** the run SHALL use the project connection

#### Scenario: Sharing races with first personal use
- **WHEN** Alice invites Bob to her private session while a run of that session first selects her personal Gmail
- **THEN** exactly one SHALL succeed, and the other SHALL be refused

### Requirement: A marked session cannot be shared
The personal-use mark SHALL never clear. The sharing service SHALL refuse to make a marked session project-visible or to add a grant to it, with "This conversation used your personal accounts. Start a new conversation to share with others."

#### Scenario: Alice shares after using her Gmail
- **WHEN** Alice's private session used her personal Gmail and she then invites Bob
- **THEN** the system SHALL refuse the invitation and keep the session private

### Requirement: Installations need an agent account
The system SHALL refuse to bind an agent to a channel installation when a `caller_account` connection of the revision has no agent account, and SHALL list those connections. A run of a later revision with the same gap SHALL refuse that connection.

#### Scenario: Slack install refused
- **WHEN** an admin binds an agent to Slack and its Gmail connection is `caller_account` without an agent account
- **THEN** the system SHALL refuse the binding and name the Gmail connection

### Requirement: Each turn shows which account it used
For each run, the system SHALL record per connection the binding, owner kind, owner, credential id, and display name, and no secret value or provider account detail. The session view SHALL show it per turn to every reader of the session, also after the credential is deleted.

#### Scenario: Shared session account line
- **WHEN** Carol reads a shared session whose turns used the project Gmail connection
- **THEN** each turn SHALL show "Gmail: <connection name> (project)"
