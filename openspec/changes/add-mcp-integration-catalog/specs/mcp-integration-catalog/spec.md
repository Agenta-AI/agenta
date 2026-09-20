# MCP integration catalog

## Purpose

Give users a maintained list of direct MCP servers and a stable way to select one without confusing the catalog definition with a connected account.

## ADDED Requirements

### Requirement: Publish a maintained catalog
Agenta SHALL serve a version-controlled catalog with a stable key, name, description, canonical server URL, and setup documentation link per integration. GitHub and Slack SHALL be the initial entries. Entries SHALL contain no credential values. Search SHALL match key, name, and description case-insensitively with deterministic ordering.

#### Scenario: Browse without deployment credentials
- **WHEN** a signed-in user browses the catalog on a deployment with no managed clients configured
- **THEN** GitHub and Slack remain discoverable
- **AND** their setup requirements do not imply that they are connected or ready to run tools.

#### Scenario: Find a provider
- **WHEN** the person searches for `github` or `GitHub`
- **THEN** the same GitHub entry appears with its setup link.

### Requirement: Resolve catalog identity on the server
The backend SHALL resolve the integration key to the maintained definition. It SHALL reject unknown keys and conflicting client-supplied server URLs. A display name or matching issuer alone SHALL NOT establish catalog identity or grant access to managed credentials.

#### Scenario: A caller substitutes an address
- **WHEN** a request names the GitHub key but supplies an unrelated server URL
- **THEN** the backend rejects the conflicting request before using any provider credentials.

#### Scenario: Custom URL matches a known integration
- **WHEN** a custom URL exactly matches a supported canonical catalog address under documented normalization
- **THEN** the backend can resolve the same integration
- **AND** a lookalike hostname, different port, or unlisted path does not inherit that identity.

### Requirement: Keep catalog entries separate from connections
Completing a connection from a catalog entry SHALL create an ordinary project-scoped MCP endpoint through existing authorization checks. It SHALL NOT create a Composio connection, copy Skills workflows, or grant an agent tool permissions. Two accounts for the same integration SHALL remain independently connectable.

#### Scenario: Select an already connected provider
- **WHEN** the project already has one GitHub endpoint and the person adds another account
- **THEN** the flow creates a distinct endpoint and grant
- **AND** it does not overwrite the existing account.

### Requirement: Evolve definitions without redirecting existing grants
Catalog updates SHALL affect new selections without silently changing saved endpoint addresses or repointing existing grants. Removing a catalog entry SHALL remove it from new selections without deleting existing connections. Each addition or changed trust destination SHALL include official source references and a recorded validation date.

#### Scenario: A provider changes its URL
- **WHEN** a release updates a catalog entry's URL
- **THEN** existing endpoints keep their saved URL and identity
- **AND** changing those endpoints requires an explicit reconnect or migration decision.

### Requirement: Keep browsing and selection accessible
The list SHALL support keyboard selection, named controls, visible focus, loading feedback, and a usable narrow-screen layout. Back navigation SHALL preserve the person's search. Cancellation before endpoint creation SHALL leave no connection behind.

#### Scenario: Cancel while browsing
- **WHEN** the person opens the list, searches, and cancels without starting connection creation
- **THEN** no endpoint or credential is persisted.
