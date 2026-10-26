# Credential resolution delta

## ADDED Requirements

### Requirement: An agent names its connection by scope and slug
A connection reference SHALL carry a scope, `project` (the default when omitted) or `organization`. A project reference SHALL resolve only the project's rows. An organization reference SHALL resolve only the shareable organization row with that slug that is available to the project, and SHALL fail with a typed "connection not found" error (`connection_not_found`, with the scope and slug) otherwise. A project row and an organization row with the same slug SHALL never stand in for each other.

#### Scenario: Same slug in both scopes
- **WHEN** project Sales has a `provider_key` with slug `openai-company` and the organization has a connection with that slug
- **THEN** an agent that names `openai-company` with scope `project` SHALL use the project row, and an agent that names it with scope `organization` SHALL use the organization row.

#### Scenario: Organization connection not available
- **WHEN** an agent names an organization connection that does not exist, or that is limited to other projects
- **THEN** resolution SHALL fail with `connection_not_found`, and SHALL NOT use a project row or the project default.

### Requirement: No connection means the project default
With no named connection, resolution SHALL choose among the project's own credentials for the provider, with the existing tie rules. An organization connection SHALL never be chosen for an agent that did not name it. Agents saved before M5 SHALL keep this behavior with no data change.

#### Scenario: Organization key not used by default
- **WHEN** the organization has an OpenAI connection, the project has none, and the agent names no connection
- **THEN** resolution SHALL fail as it does today for a project with no key.

### Requirement: Organization connections resolve in their own gateway namespace
An organization reference SHALL resolve to the gateway namespace `organization`, and the relay SHALL serve `/gateways/llms/organization/{slug}/v1/...`. A `provider_key` SHALL route like a standard endpoint of its family; a `custom_provider` SHALL build its target from the row with `map_custom_provider_secret_to_endpoint`, with no endpoint row written. Both SHALL be pinned to that row, and an unserved deployment SHALL be refused.

#### Scenario: Company Azure deployment
- **WHEN** the organization owns an Azure `custom_provider` with slug `azure-company` and an agent names it with scope `organization`
- **THEN** the gateway SHALL route the call with the organization connection, and no endpoint row SHALL be added.

### Requirement: Organization connections stay in the project's organization
Organization rows SHALL come from the organization that the project row names. A request whose organization differs from it SHALL get no organization row.

#### Scenario: Mismatched organization
- **WHEN** a request names organization B for a project whose row names organization A
- **THEN** no organization connection SHALL resolve.

### Requirement: Only the LLM plane reads organization rows
The secrets resolver SHALL be built per plane. Only the LLM plane SHALL answer an organization reference. The MCP plane SHALL resolve project rows only.

#### Scenario: MCP never sees an organization key
- **WHEN** an organization has a `provider_key` of a family that the MCP gateway also knows (`mock`)
- **THEN** the MCP endpoint list and MCP resolution SHALL NOT use it.

### Requirement: The project read costs what today's project read costs
A project's credentials and the organization rows available to it SHALL live in one cache entry filled by one statement. Every existing hot path SHALL cost no more Postgres statements and Redis round trips than before M5, in every cache mode. Project writes SHALL send the same statements as before M5.

#### Scenario: Warm read
- **WHEN** the gateway resolves a provider key with a warm cache
- **THEN** it SHALL send one Redis command and no Postgres statement for the credential.

### Requirement: Id references never substitute
A `BoundSecretRef` SHALL carry the owner kind of the row it names and SHALL resolve only that row, and only while it is available to the project. Otherwise resolution SHALL fail without trying another row.

#### Scenario: Limited away
- **WHEN** a target pinned to an organization connection is resolved after an EE admin removes the project from that connection's selected projects
- **THEN** resolution SHALL fail with a not-found error and SHALL NOT use a project credential.

### Requirement: An older runtime refuses an organization connection
An organization connection SHALL be saved with namespace `organization`, so a runtime that does not know organization connections refuses it instead of reading its slug as a project connection. Without the gateway, the SDK SHALL refuse an organization connection (`organization_connection_unavailable`) and SHALL NOT read the vault for it.

#### Scenario: Gateway does not serve the run
- **WHEN** the gateway answers that it does not serve the run and the agent named an organization connection
- **THEN** the run SHALL fail, and no project row with the same slug SHALL be used.

### Requirement: Resolution reports the real owner
`ResolvedSecret.owner` SHALL name the owner of the row that answered. Gateway audit and usage labels SHALL carry it.

#### Scenario: Audit names the organization
- **WHEN** a gateway call spends an organization connection
- **THEN** the audit record SHALL name owner kind `organization`.
