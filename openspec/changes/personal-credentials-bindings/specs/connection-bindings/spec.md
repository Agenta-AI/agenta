## ADDED Requirements

### Requirement: Explicit binding on every agent connection
Every model, Composio tool, and MCP gateway connection reference SHALL have a binding: `caller_account` ("Each person's own account") or `project_default` ("The project's shared account"). A stored revision without a binding SHALL be read as `project_default` with its stored named reference, which keeps its M5 meaning. Saving a revision SHALL NOT check its bindings. At run start, the system SHALL refuse a run whose revision has an unsupported combination of binding and connection kind, or the `specific` binding, which is not in the first step.

#### Scenario: Old revision keeps its M5 meaning
- **WHEN** a revision saved before M7 names the slug `openai-main` with no scope, and the project has a key with that slug
- **THEN** the system SHALL resolve the project key, as under M5, and SHALL NOT read an organization key with the same slug

#### Scenario: Unsupported combination
- **WHEN** an author saves `project_default` on an MCP reference with scope `user`, and then runs the agent
- **THEN** the system SHALL save the revision, and SHALL refuse the run at run start with an error that names the connection

#### Scenario: One fixed account is not offered
- **WHEN** an author saves the `specific` binding on a Composio connection, and then runs the agent
- **THEN** the system SHALL save the revision, and SHALL refuse the run at run start with an error that names the connection

### Requirement: The project's shared account is the picked connection
For `project_default`, the system SHALL use the connection that the M5 named reference names (its scope and slug), from the project or from the organization. It SHALL NOT select a user-owned credential. When the named connection is gone or unavailable, the system SHALL refuse the call and SHALL NOT use another credential.

#### Scenario: Picked project connection deleted
- **WHEN** a `project_default` Composio connection names the slug `gmail-support`, that connection is deleted, and the project has another Gmail connection
- **THEN** the system SHALL refuse the call and SHALL NOT use the other connection

### Requirement: The caller is the person behind the run
For `caller_account`, the system SHALL select the credential of the person behind the run: `principal.id` when the run principal is `human`, and the linked user (`linked_user_id`) for a channel turn. A channel turn from an unlinked user, and every API-key run until M6a exists, SHALL have no person, and the system SHALL refuse the call. After M6a, a personal key SHALL act as its human, and a service key SHALL have no person. A person without a credential for the service SHALL be refused. The system SHALL NOT use any other account, including a project connection, the binding creator's account, or the account of the person who created the channel connection.

#### Scenario: Caller has no account
- **WHEN** Bob's private-session turn reaches a `caller_account` Gmail connection and Bob has no Gmail connection in the organization
- **THEN** the system SHALL refuse the call with "Connect your Gmail account to use this agent" and SHALL NOT use a project connection

#### Scenario: Schedules of two users
- **WHEN** Alice and Bob each have a schedule with themselves as executing principal on one agent with a `caller_account` Gmail connection
- **THEN** Alice's runs SHALL use Alice's Gmail and Bob's runs SHALL use Bob's Gmail

#### Scenario: Child run through a door
- **WHEN** Alice's personal agent runs a Sales agent through the M6 run-an-agent door
- **THEN** the child run in Sales SHALL use Alice's credentials for its `caller_account` connections

#### Scenario: API key run before M6a
- **WHEN** a run started with an API key reaches a `caller_account` connection, and M6a does not exist yet
- **THEN** the system SHALL refuse the call and SHALL NOT use a project connection or the key creator's account

#### Scenario: Service key run
- **WHEN** a run started with an M6a service key reaches a `caller_account` connection
- **THEN** the system SHALL refuse the call and SHALL NOT use a project connection

### Requirement: Personal MCP servers are referenced explicitly
An MCP reference with scope `user` SHALL name a personal MCP server by slug and SHALL use the `caller_account` binding. The run SHALL use the caller's own personal server with that slug, or refuse the call when the caller has none. An MCP reference with scope `project` SHALL use the project's server with that slug; with `caller_account`, it SHALL use the caller's own sign-in to that server.

#### Scenario: Two people with their own server
- **WHEN** Alice and Bob each own a personal MCP server with the slug `notes`, and each runs an agent whose MCP reference is scope `user`, slug `notes`
- **THEN** Alice's run SHALL reach Alice's server and Bob's run SHALL reach Bob's server

#### Scenario: Project server with the same slug
- **WHEN** a reference with scope `user`, slug `notes` runs for Carol, who has no personal server `notes`, and the project has a server `notes`
- **THEN** the system SHALL refuse the MCP connection and SHALL NOT use the project server

### Requirement: Bindings come from the server
The system SHALL sign the bindings of the resolved revision into the run credential and the gateway credential at run start. Gateway lookups and vault reads with a run credential SHALL apply them. A lookup with no signed binding SHALL resolve as `project_default` and SHALL NOT select a user-owned credential. `SecretMode` SHALL be removed.

#### Scenario: Sandbox asks for a personal key
- **WHEN** sandbox code asks the gateway or the vault for the caller's personal OpenAI key and the model connection is `project_default`
- **THEN** the system SHALL NOT return or use the personal key

#### Scenario: Run credential minted before M7
- **WHEN** a run credential without signed bindings reaches the gateway after the deploy
- **THEN** each lookup SHALL resolve as `project_default` with the named reference it carries
