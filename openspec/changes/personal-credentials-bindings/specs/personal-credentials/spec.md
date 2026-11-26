## ADDED Requirements

### Requirement: User owner for credentials
The system SHALL let a user own a provider key, a subscription login, a Composio connection, an MCP server, or an MCP OAuth grant for a project's server, inside one organization. A user-owned row SHALL store the organization id and the user id and SHALL have no project. The system SHALL refuse the user owner for other kinds, including custom secrets. Only runs in projects of that organization SHALL use the credential.

#### Scenario: Bob connects his own Gmail
- **WHEN** Bob connects Gmail with himself as owner in organization Acme
- **THEN** the system SHALL store a Composio connection with Acme's id, Bob's id, and no project, and its Composio entity SHALL be `org:<Acme id>:user:<Bob id>`

#### Scenario: Organization wall
- **WHEN** Bob owns a Gmail connection in Acme and runs an agent in organization Beta
- **THEN** no run in Beta SHALL use that connection

### Requirement: Personal MCP servers
A user SHALL be able to add an MCP server for their own use, with its URL and auth mode, in one organization. Only its owner SHALL list, edit, sign in to, use, or delete it. A run SHALL reach it only through a `caller_account` reference with scope `user` whose caller is the owner.

#### Scenario: Bob adds his own server
- **WHEN** Bob adds an MCP server with the slug `notes` as a personal server in Acme
- **THEN** the system SHALL store it with Acme's id, Bob's id, and no project, and other members of Acme SHALL NOT see it in any server list

### Requirement: Custom secrets stay project-owned until hidden secrets exist
Until hidden secrets exist (the sandbox gets a placeholder, and the real value is added outside the sandbox), the system SHALL store custom secrets as project rows only and SHALL refuse a personal or organization custom secret. Project custom secrets SHALL keep today's behavior.

#### Scenario: Personal custom secret before hidden secrets
- **WHEN** Alice creates a custom secret with herself as owner
- **THEN** the system SHALL refuse it with a validation error

### Requirement: One personal account per service
The system SHALL allow at most one user-owned credential per service, per user, per organization: per provider kind for provider keys and subscription logins, per integration for Composio, per slug for personal MCP servers, and per server for MCP grants. The one-login-per-provider rule SHALL apply per owner.

#### Scenario: Second personal Gmail
- **WHEN** Bob already owns a Gmail connection in Acme and starts a second one
- **THEN** the system SHALL refuse it with a conflict

#### Scenario: Personal and project subscription logins
- **WHEN** project Sales has a Claude login and Alice adds her own Claude login
- **THEN** the system SHALL store both

### Requirement: Personal credentials are private to their owner
Only the owner SHALL list, read the metadata of, refresh, use, or delete a user-owned credential. Organization owners, project admins, and EE no-RBAC shortcuts SHALL NOT change this. No read API SHALL return a credential value.

#### Scenario: Admin lists credentials
- **WHEN** an organization owner lists the credentials of a project or of the organization
- **THEN** the list SHALL NOT contain any user-owned credential of another user

### Requirement: Per-user MCP OAuth consent
For a project's MCP server with OAuth, a user SHALL be able to consent with their own account. The system SHALL store the grant as that user's secret for the server and SHALL NOT change the server's project grant. Deleting the server SHALL delete its user grants.

#### Scenario: Two people consent to one server
- **WHEN** Alice and Bob each consent to the GitHub MCP server of project Sales
- **THEN** the system SHALL store one user-owned grant for each and SHALL keep the project grant unchanged

### Requirement: Personal credentials end when the owner leaves
When a user leaves an organization, the system SHALL delete every credential and every personal MCP server that the user owns there. A failed Composio revocation SHALL NOT block the local delete.

#### Scenario: Alice leaves Acme
- **WHEN** an admin removes Alice from Acme, or EE SSO deprovisions her
- **THEN** her user-owned credentials in Acme SHALL be deleted, and those in other organizations SHALL stay

### Requirement: EE policy for personal credentials
In EE, an organization SHALL be able to forbid personal credentials. Then the system SHALL refuse new user-owned credentials and every selection of one, with "Your organization does not allow personal accounts", and SHALL NOT use another account. OSS SHALL ignore the policy.

#### Scenario: Policy forbids personal credentials
- **WHEN** the Acme policy forbids personal credentials and a run reaches a `caller_account` connection
- **THEN** the system SHALL refuse the call with the policy message
