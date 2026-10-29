## ADDED Requirements

### Requirement: Shared sessions never release a user-owned credential
Before the system releases a user-owned credential or calls its provider for a run of a session, it SHALL, in one transaction, lock the session row, refuse if the session is shared, and otherwise set the sticky personal-use mark. A session SHALL count as shared when it is project-visible, has any grant, or belongs to a channel thread. A channel turn of a linked user is the one exception (see "Channel turns use the linked user's own account"). The rule SHALL apply to the selected credential, not to the binding. On refusal, the system SHALL NOT switch to another account.

#### Scenario: Bob continues Alice's shared chat
- **WHEN** Bob is a Participant in Alice's session and his turn reaches a `caller_account` Gmail connection
- **THEN** the system SHALL refuse the Gmail call with "This conversation is shared. Gmail is set to use each person's own account, which shared conversations cannot use." and SHALL use no Gmail account

#### Scenario: Shared session with the project's shared account
- **WHEN** Bob is a Participant in Alice's session and his turn reaches a `project_default` Gmail connection
- **THEN** the run SHALL use the project's Gmail connection

#### Scenario: Sharing races with first personal use
- **WHEN** Alice invites Bob to her private session while a run of that session first selects her personal Gmail
- **THEN** exactly one SHALL succeed, and the other SHALL be refused

### Requirement: A marked session cannot be shared
The personal-use mark SHALL never clear. The sharing service SHALL refuse to make a marked session project-visible or to add a grant to it, with "This conversation used your personal accounts. Start a new conversation to share with others."

#### Scenario: Alice shares after using her Gmail
- **WHEN** Alice's private session used her personal Gmail and she then invites Bob
- **THEN** the system SHALL refuse the invitation and keep the session private

### Requirement: Channel turns use the linked user's own account
On a `caller_account` connection, a channel turn SHALL use the own account of the linked user who sent it. A channel turn from an unlinked user SHALL be refused on that connection when it runs, with a short note that asks the user to link their account. The system SHALL NOT use the binding creator's account, the account of the person who created the channel connection, or a project connection. The shared-session guard SHALL NOT refuse the channel turn of a linked user. Saving or activating a channel binding SHALL NOT be refused because the agent has a `caller_account` connection.

#### Scenario: Linked Slack user
- **WHEN** a linked Slack user, Alice, writes to an agent whose Gmail connection is `caller_account`, and Alice has a Gmail connection
- **THEN** the turn SHALL use Alice's Gmail

#### Scenario: Unlinked Slack user
- **WHEN** a Slack user who is not linked writes to the same agent and the turn reaches the Gmail connection
- **THEN** the system SHALL refuse the Gmail call with a short note to link their account, and SHALL use no Gmail account

#### Scenario: Slack binding saved
- **WHEN** an admin binds an agent to Slack and its Gmail connection is `caller_account`
- **THEN** the system SHALL save the binding

### Requirement: Each turn shows which account it used
For each run, the system SHALL record per connection the binding, owner kind, owner, credential id, and display name, and no secret value or provider account detail. The session view SHALL show it per turn to every reader of the session, also after the credential is deleted.

#### Scenario: Shared session account line
- **WHEN** Carol reads a shared session whose turns used the project Gmail connection
- **THEN** each turn SHALL show "Gmail: <connection name> (project)"
