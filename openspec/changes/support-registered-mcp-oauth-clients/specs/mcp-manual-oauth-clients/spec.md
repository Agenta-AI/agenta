# Registered client input

## Purpose

Let a person connect an MCP provider that requires a pre-registered OAuth application without exposing the stored client secret in later API responses.

## ADDED Requirements

### Requirement: Collect registered client credentials at consent start
When automatic registration is unsupported and no backend-selected registration is available, the journey SHALL show the callback URL, client ID, and a masked client-secret input. It SHALL prevent submission when required values are absent. The backend SHALL accept these credentials only when beginning OAuth, not when completing the callback.

#### Scenario: Required input is absent
- **WHEN** the client ID is empty or a required client secret is absent
- **THEN** Connect is disabled
- **AND** an equivalent incomplete API request is refused without redirecting.

#### Scenario: Public client registration
- **WHEN** the issuer supports public clients and the person supplies a client ID without a secret
- **THEN** Agenta begins consent using the supplied client ID and the `none` token authentication method.

### Requirement: Keep supplied client secrets write-only
Agenta SHALL store a supplied client secret through the project vault and SHALL NOT return it through endpoint reads or connection responses. The frontend SHALL clear submitted credential state rather than display stored values on reconnect.

#### Scenario: Read a connection after saving its client
- **WHEN** the person reads or reconnects an endpoint with saved client credentials
- **THEN** no response or populated input reveals the client secret.

### Requirement: Retain connection-specific registrations
A supplied registration SHALL be stored for the endpoint, issuer, and callback. Reconnect SHALL reuse a compatible stored registration. Dynamic registrations SHALL retain their existing shared issuer-and-callback behavior.

#### Scenario: Reconnect the same endpoint
- **WHEN** a compatible registration already exists for the endpoint
- **THEN** reconnect uses it without asking the person to enter the secret again.

#### Scenario: Different explicitly configured clients
- **WHEN** two endpoints at the same issuer are each given different client credentials
- **THEN** saving the second registration does not overwrite the first.

### Requirement: Preserve token fallback
The unsupported-registration screen SHALL offer **Use a token instead** and reuse manual header authentication with a named project secret.

#### Scenario: Choose token authentication
- **WHEN** the person chooses the token alternative
- **THEN** the journey requests a header and a project secret
- **AND** it does not require an OAuth application.
