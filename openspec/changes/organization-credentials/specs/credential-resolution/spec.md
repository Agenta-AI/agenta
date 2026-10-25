# Credential resolution delta

## ADDED Requirements

### Requirement: One effective credential set per project
Every in-process reader (the LLM gateway resolver and the custom endpoint lookup) SHALL resolve through `VaultService.list_effective_secrets(organization_id, project_id)` and its single-row forms. The effective set SHALL be the project's rows, then the available inherited rows whose slug no project row uses.

#### Scenario: New project sees the company key
- **WHEN** an organization has an OpenAI organization credential and an admin creates a new project
- **THEN** the gateway resolver SHALL include `openai` in the new project's available provider keys.

#### Scenario: SSO secret stays out
- **WHEN** an EE organization has an SSO provider secret
- **THEN** no project's effective set SHALL contain it.

### Requirement: Inheritance stays in the project's organization
Inheritance SHALL use the organization that the project row names. A request whose organization differs from it SHALL inherit nothing.

#### Scenario: Mismatched organization
- **WHEN** a request names organization B for a project whose row names organization A
- **THEN** the effective set SHALL hold the project's rows only.

### Requirement: Only the LLM plane reads organization rows
The secrets resolver SHALL be built per plane. The LLM plane SHALL read the effective set. The MCP plane SHALL resolve project rows only.

#### Scenario: MCP never sees an organization key
- **WHEN** an organization has a `provider_key` of a family that the MCP gateway also knows (`mock`)
- **THEN** the MCP endpoint list and MCP resolution SHALL NOT use it.

### Requirement: The effective read costs what today's project read costs
Reading the effective set SHALL cost no more Postgres statements and Redis round trips than today's project vault read, in every cache mode.

#### Scenario: Warm read
- **WHEN** the gateway resolves a provider key with a warm cache
- **THEN** it SHALL send one Redis command and no Postgres statement for the credential.

### Requirement: A slug reference resolves project, then organization
A slug reference SHALL resolve the project row with that slug, else the available inherited row with that slug, else fail with the existing not-found error. It SHALL NOT try another slug or provider. This meaning SHALL hold after M7 (CONTRACT.md section 8).

#### Scenario: Project overrides the company key
- **WHEN** project Sales has its own `provider_key` with the slug of the organization's OpenAI credential
- **THEN** Sales SHALL use its own row, and project Marketing SHALL use the organization row.

#### Scenario: Named connection removed
- **WHEN** an agent names `openai-sales`, the project deletes that row, and the organization has another OpenAI credential with a different slug
- **THEN** resolution SHALL fail with "connection not found".

### Requirement: Default selection prefers project credentials
With no named connection, resolution SHALL choose among the project's credentials for the provider, and SHALL consider inherited ones only when the project has none. The existing tie rules SHALL apply inside the chosen group.

#### Scenario: Project key wins
- **WHEN** the project and the organization each have an OpenAI key and the agent names no connection
- **THEN** the run SHALL use the project key.

### Requirement: Id references never substitute
A `BoundSecretRef` SHALL carry the owner kind of the row it names and SHALL resolve only that row, and only while it is available to the project. Otherwise resolution SHALL fail without trying another row.

#### Scenario: Limited away
- **WHEN** a target pinned to an organization credential is resolved after an EE admin removes the project from that credential's selected projects
- **THEN** resolution SHALL fail with a not-found error and SHALL NOT use a project credential.

### Requirement: Inherited custom providers resolve without an endpoint row
When the gateway finds no project endpoint row for a custom slug, it SHALL build the target from an available, unshadowed inherited `custom_provider` with that slug, with `map_custom_provider_secret_to_endpoint`, pinned to its id. The lookup SHALL be one statement. It SHALL NOT write an endpoint row, and SHALL refuse a deployment it does not serve. A project endpoint row with the same slug SHALL win. A project endpoint row SHALL still not bind an organization secret.

#### Scenario: Company Azure deployment
- **WHEN** the organization owns an Azure `custom_provider` with slug `azure-company` and an agent names that slug
- **THEN** the gateway SHALL route the call with the organization credential, and no endpoint row SHALL be added.

### Requirement: Resolution reports the real owner
`ResolvedSecret.owner` SHALL name the owner of the row that answered. Gateway audit and usage labels SHALL carry it.

#### Scenario: Audit names the organization
- **WHEN** a gateway call spends an inherited organization key
- **THEN** the audit record SHALL name owner kind `organization`.
