# WP30 — MCP OAuth foundation and secrets-backed token storage

Implement the OAuth substrate for MCP endpoints. This package is the first direct consumer of the
official MCP SDK; pin it in the owning Python project and record its exact storage/provider
contract. Do not build a bespoke OAuth client.

## Scope

- Implement the SDK `TokenStorage` protocol as a thin adapter over the existing secrets service.
  Gateway rows retain only a `secret_id`; no response, log, or runner wire may contain token
  material.
- Use the SDK OAuth client provider for discovery, client metadata, authorization redirect, and
  callback handling. Redirects target the dashboard flow, never a local-browser opener.
- Add MCP endpoint state transitions for ready, needs-auth, and needs-input, with typed gateway
  refusals.
- Pin the direct MCP SDK version and test the adapter against that exact API.

## Required verification

- **Unit:** token-storage mapping, secret-handle-only persistence, OAuth state transitions, and
  refusal serialization; include negative assertions that tokens never appear in API DTOs, logs,
  or runner payloads.
- **Integration:** a local OAuth provider exercises discovery, metadata, redirect/callback, secret
  persistence, and reconnect through the API/service boundary.
- **Acceptance:** an OAuth-backed MCP endpoint completes the mocked authorization exchange and
  invokes a tool through the real gateway socket on both OSS and EE development stacks.

## Out of scope

Dashboard scope selection and registration fallback belong to WP31. User-owned secrets and
subscription pass-through remain out of scope.

## Done when

An OAuth MCP endpoint stores only a secret handle, can complete a mocked authorization exchange,
and relays through the normal gateway without exposing an access or refresh token.
