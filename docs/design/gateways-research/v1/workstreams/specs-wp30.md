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

## Out of scope

Dashboard scope selection and registration fallback belong to WP31. User-owned secrets and
subscription pass-through remain out of scope.

## Done when

An OAuth MCP endpoint stores only a secret handle, can complete a mocked authorization exchange,
and relays through the normal gateway without exposing an access or refresh token.
