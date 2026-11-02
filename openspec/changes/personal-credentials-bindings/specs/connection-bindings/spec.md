## ADDED Requirements

### Requirement: Explicit binding on every agent connection
Every model, Composio tool, and MCP gateway connection reference SHALL have a binding: `caller_account`, `project_default`, or `specific`. A stored revision without a binding SHALL be read as `project_default` with its stored slug, which keeps its M5 named meaning. The system SHALL refuse a revision with an unsupported combination of binding and connection kind.

#### Scenario: Old revision keeps its M5 meaning
- **WHEN** a revision saved before M7 names the slug `openai-main`, the project has no row with that slug, and the organization has one available to the project
- **THEN** the system SHALL resolve the organization row, as under M5

#### Scenario: Unsupported combination
- **WHEN** an author saves `specific` on an MCP gateway connection
- **THEN** the system SHALL refuse the revision with a validation error that names the connection

### Requirement: An exact binding never substitutes
A `specific` binding and an agent account SHALL name one credential id that is project-owned in the run's project, or organization-owned and available to it. They SHALL NOT name a user-owned credential. When the named credential is gone or unavailable, the system SHALL refuse the call and SHALL NOT use another credential.

#### Scenario: Exact credential deleted
- **WHEN** a `specific` Composio binding names a deleted connection and the project has another Gmail connection
- **THEN** the system SHALL refuse the call and SHALL NOT use the other connection

#### Scenario: Builder pins her own account
- **WHEN** Alice saves a `specific` binding that names her personal Gmail connection
- **THEN** the system SHALL refuse the revision and tell her to use "Each person's own account"

### Requirement: The caller is the human behind the run principal
For `caller_account`, the system SHALL select the credential of `principal.id` when the run principal is `human`. When the principal is `service_account`, the system SHALL use the connection's agent account, or refuse the call when there is none. A human without a credential for the service SHALL be refused, and the system SHALL NOT use any other account, including the agent account.

#### Scenario: Caller has no account
- **WHEN** Bob's private-session turn reaches a `caller_account` Gmail connection and Bob has no Gmail connection in the organization
- **THEN** the system SHALL refuse the call with "Connect your Gmail account to use this agent" and SHALL NOT use a project connection or the agent account

#### Scenario: Schedules of two users
- **WHEN** Alice and Bob each have a schedule with themselves as executing principal on one agent with a `caller_account` Gmail connection
- **THEN** Alice's runs SHALL use Alice's Gmail and Bob's runs SHALL use Bob's Gmail

#### Scenario: Child run through a door
- **WHEN** Alice's personal agent runs a Sales agent through the M6 run-an-agent door
- **THEN** the child run in Sales SHALL use Alice's credentials for its `caller_account` connections

#### Scenario: Slack turn with agent account
- **WHEN** a Slack turn runs as the installation's service account and the Gmail connection is `caller_account` with the agent account `support-gmail`
- **THEN** the run SHALL use `support-gmail`

### Requirement: Bindings come from the server
The system SHALL sign the bindings of the resolved revision into the run credential and the gateway credential at run start. Gateway lookups and vault reads with a run credential SHALL apply them. A lookup with no signed binding SHALL resolve as `project_default` and SHALL NOT select a user-owned credential. `SecretMode` SHALL be removed.

#### Scenario: Sandbox asks for a personal key
- **WHEN** sandbox code asks the gateway or the vault for the caller's personal OpenAI key and the model connection is `project_default`
- **THEN** the system SHALL NOT return or use the personal key

#### Scenario: Run credential minted before M7
- **WHEN** a run credential without signed bindings reaches the gateway after the deploy
- **THEN** each lookup SHALL resolve as `project_default` with the slug it names
