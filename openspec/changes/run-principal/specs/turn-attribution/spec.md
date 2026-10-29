# Turn attribution

## Purpose

Record on each turn who acted, who sent it, who approved it, and where it came from, from the credential only.

## ADDED Requirements

### Requirement: Each turn stores its attribution from the credential
The turn append and complete routes SHALL write `principal_kind`, `principal_id`, `sender_user_id`, `sender_external_key`, `origin`, `origin_id`, `parent_run_id` and `approved_by` from the credential, and SHALL NOT accept them from the body. `approved_by` SHALL name the approving principal kind and id, its acting user, and the channel key for a channel answer.

#### Scenario: Two people in one session
- **WHEN** Alice sends one message and Bob sends the next in the same session
- **THEN** the first turn SHALL store Alice and the second turn SHALL store Bob

#### Scenario: Body tries to set the sender
- **WHEN** the append body contains a `sender_user_id`
- **THEN** the stored value SHALL come from the credential

#### Scenario: Unlinked Slack user
- **WHEN** an unlinked Slack user sends a message
- **THEN** the turn SHALL store the external key, no `sender_user_id`, and principal `installation`

#### Scenario: Resumed turn
- **WHEN** Bob approves a tool call in Alice's run
- **THEN** the resumed turn SHALL store sender Alice and `approved_by` with principal `human` Bob

#### Scenario: Approval by an API key
- **WHEN** an API key answers an interaction
- **THEN** `approved_by` SHALL store principal `api_key` with the key id and the key creator as acting user

### Requirement: Completion keeps the recorded attribution
Turn completion SHALL write the attribution as one group, and only when the turn has no recorded principal. Otherwise it SHALL keep every attribution field, including null fields.

#### Scenario: API key turn completed by another credential
- **WHEN** an API key appends a turn and a different credential completes it
- **THEN** the turn SHALL keep principal `api_key`, its origin, and its null sender

### Requirement: Old turns stay readable
Turns written before this change SHALL keep null attribution. The API SHALL NOT guess a sender from `created_by_id`.

#### Scenario: Historical turn
- **WHEN** a client reads a turn written before the migration
- **THEN** the sender fields SHALL be null
