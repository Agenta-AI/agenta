# WP30 tasks — MCP OAuth foundation and secrets-backed token storage

- [x] Select and pin the official MCP SDK as a direct dependency; record its `TokenStorage` and
      OAuth-provider contracts.
- [x] Implement secret-service-backed token storage using gateway-row `secret_id` handles only.
- [x] Wire discovery, client metadata, redirect and callback hooks to the dashboard-facing API.
- [x] Add **unit tests** for the token-storage adapter, state/refusal DTOs, and no-token wire/log
      invariants.
- [x] Add **integration tests** using a local OAuth provider for discovery through callback and
      reconnect.
- [x] Add **OSS and EE acceptance tests** for authorization followed by a real gateway tool call.
