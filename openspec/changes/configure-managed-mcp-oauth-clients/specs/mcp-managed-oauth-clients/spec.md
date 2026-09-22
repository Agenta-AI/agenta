# Managed MCP OAuth clients

## Purpose

Let a deployment operator register an OAuth application once for a known MCP integration while each project connection retains its own authorization and tokens.

## ADDED Requirements

### Requirement: Configure provider applications on the backend
Agenta SHALL support `AGENTA_MCP_GITHUB_CLIENT_ID`, `AGENTA_MCP_GITHUB_CLIENT_SECRET`, `AGENTA_MCP_SLACK_CLIENT_ID`, and `AGENTA_MCP_SLACK_CLIENT_SECRET` as API-service environment configuration. These SHALL be separate from Agenta account-login credentials and SHALL NOT be shipped as Agenta Cloud defaults to self-hosted installations.

#### Scenario: A self-hosting operator configures GitHub
- **WHEN** the operator registers an application with the deployment callback, supplies both GitHub values to the API, and restarts the API
- **THEN** new eligible GitHub connections use that application without asking users for its client credentials.

#### Scenario: Only one required value is configured
- **WHEN** an integration has an incomplete managed credential pair
- **THEN** Agenta reports an actionable configuration error for that integration without disclosing values
- **AND** unrelated integrations remain usable
- **AND** Agenta does not silently treat partial configuration as a working client or submit partial credentials.

### Requirement: Let the backend choose the setup screen
The backend SHALL return one setup action: consent with a managed, saved, or automatically registered client; collect a manual client; or show a blocked setup reason. It SHALL include the callback and a documentation link where relevant, without returning stored credential values. Begin SHALL independently resolve and validate the choice rather than trust a stale probe or frontend flag.

#### Scenario: Managed credentials are configured
- **WHEN** a new eligible connection has a complete managed configuration
- **THEN** the UI hides client-ID and client-secret fields and offers Connect
- **AND** the backend constructs the authorization URL using its configured client.

#### Scenario: No managed credentials are configured
- **WHEN** the provider has no automatic registration method and no managed or saved client is available
- **THEN** the UI shows the manual registered-client form, exact callback, documentation link, and token alternative.

#### Scenario: The configuration changes after probing
- **WHEN** the probe offered managed consent but a later begin request cannot resolve that client
- **THEN** begin returns an actionable setup result
- **AND** it does not redirect using missing credentials or silently change client identity.

### Requirement: Restrict managed credentials to trusted destinations
The backend SHALL require a catalog-approved server address, resource identity, issuer, and token destination before using managed credentials. It SHALL validate these on begin, callback, and refresh as applicable, retain existing outbound-network safeguards, and refuse cross-origin credential redirects. User-controlled metadata or a matching issuer alone SHALL NOT select a managed client.

#### Scenario: An attacker names a known issuer
- **WHEN** an arbitrary MCP server advertises GitHub's issuer
- **THEN** Agenta does not attach the managed GitHub client to that server's consent, exchange, or refresh.

#### Scenario: Token metadata changes destination
- **WHEN** a known resource advertises a token endpoint outside the reviewed destination set
- **THEN** Agenta blocks managed exchange before sending the secret and reports an unsupported provider configuration.

### Requirement: Keep shared secrets out of project and browser state
Managed client secrets SHALL remain in backend deployment configuration. Agenta SHALL NOT copy them into project secrets, agent revisions, catalog responses, browser storage, logs, or traces. Individual access and refresh tokens SHALL continue to use the project vault. A public client ID appearing in the provider authorization URL SHALL NOT be treated as a client-secret disclosure.

#### Scenario: Inspect browser traffic and persisted connection data
- **WHEN** a managed connection is created and read back
- **THEN** no response, client storage, or project record contains the managed client secret
- **AND** separate project endpoints still have separate grant records.

### Requirement: Preserve the client used for each grant
An OAuth attempt and resulting grant SHALL retain a non-secret reference to the selected client source and identity. Callback and refresh SHALL use that reference, not whichever client now takes precedence for new connections. Existing manual and dynamic registrations SHALL retain their behavior when managed configuration is enabled.

#### Scenario: Enable managed configuration after manual setup
- **WHEN** an endpoint already uses a manual registration and managed configuration becomes available
- **THEN** its callback, refresh, and ordinary reconnect retain its registered client
- **AND** newly created connections use the managed client.

#### Scenario: Rotate a secret for the same managed client ID
- **WHEN** the operator replaces the secret for the same provider application and restarts the API
- **THEN** subsequent exchanges resolve the current secret without rewriting project grants
- **AND** tests verify the provider's overlap or reconnect behavior before production rotation.

#### Scenario: Replace or remove the managed application
- **WHEN** a managed grant's pinned client ID no longer matches available configuration
- **THEN** refresh fails safely with reconnect or operator-repair guidance
- **AND** Agenta does not present that grant to a different client or switch it to manual or metadata authentication.

### Requirement: Preserve explicit consent and least required access
Managed registration SHALL NOT authorize accounts on its own. The user SHALL still consent at the provider. Requested scopes SHALL be constrained by the integration's reviewed scope policy and discovered support, rather than expand automatically when the provider advertises new scopes. Provider refusal or administrator restrictions SHALL remain distinguishable from missing local configuration.

#### Scenario: Discovery adds broader scopes
- **WHEN** a provider advertises new write scopes after the integration was reviewed
- **THEN** Agenta does not automatically request those new scopes on a managed connection.

#### Scenario: Consent is denied
- **WHEN** the person or provider administrator refuses authorization
- **THEN** the connection is not reported ready
- **AND** the UI does not respond by asking for Agenta's managed secret.
