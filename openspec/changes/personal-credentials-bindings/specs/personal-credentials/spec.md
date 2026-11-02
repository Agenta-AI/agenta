## ADDED Requirements

### Requirement: User owner for credentials
The system SHALL let a user own a provider key, a subscription login, a Composio connection, or an MCP OAuth grant for a project's endpoint, inside one organization. A user-owned row SHALL store the organization id and the user id and SHALL have no project. The system SHALL refuse the user owner for other kinds. Only runs in projects of that organization SHALL use the credential.

#### Scenario: Bob connects his own Gmail
- **WHEN** Bob connects Gmail with himself as owner in organization Acme
- **THEN** the system SHALL store a Composio connection with Acme's id, Bob's id, and no project, and its Composio entity SHALL be `org:<Acme id>:user:<Bob id>`

#### Scenario: Organization wall
- **WHEN** Bob owns a Gmail connection in Acme and runs an agent in organization Beta
- **THEN** no run in Beta SHALL use that connection

### Requirement: One personal account per service
The system SHALL allow at most one user-owned credential per service, per user, per organization: per provider kind for provider keys and subscription logins, per integration for Composio, and per endpoint for MCP grants. The one-login-per-provider rule SHALL apply per owner.

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
For an MCP endpoint with OAuth, a user SHALL be able to consent with their own account. The system SHALL store the grant as that user's secret for the endpoint and SHALL NOT change the endpoint's project grant. Deleting the endpoint SHALL delete its user grants.

#### Scenario: Two people consent to one endpoint
- **WHEN** Alice and Bob each consent to the GitHub MCP endpoint of project Sales
- **THEN** the system SHALL store one user-owned grant for each and SHALL keep the project grant unchanged

### Requirement: Personal credentials end when the owner leaves
When a user leaves an organization, the system SHALL delete every credential that the user owns there. A failed Composio revocation SHALL NOT block the local delete.

#### Scenario: Alice leaves Acme
- **WHEN** an admin removes Alice from Acme, or EE SSO deprovisions her
- **THEN** her user-owned credentials in Acme SHALL be deleted, and those in other organizations SHALL stay

### Requirement: EE policy for personal credentials
In EE, an organization SHALL be able to forbid personal credentials. Then the system SHALL refuse new user-owned credentials and every selection of one, with "Your organization does not allow personal accounts", and SHALL NOT use another account. OSS SHALL ignore the policy.

#### Scenario: Policy forbids personal credentials
- **WHEN** the Acme policy forbids personal credentials and a run reaches a `caller_account` connection
- **THEN** the system SHALL refuse the call with the policy message
