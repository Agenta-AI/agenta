# WP30 tasks — MCP OAuth foundation and secrets-backed token storage

- [ ] Select and pin the official MCP SDK as a direct dependency; record its `TokenStorage` and
      OAuth-provider contracts.
- [ ] Implement secret-service-backed token storage using gateway-row `secret_id` handles only.
- [ ] Wire discovery, client metadata, redirect and callback hooks to the dashboard-facing API.
- [ ] Add **unit tests** for the token-storage adapter, state/refusal DTOs, and no-token wire/log
      invariants.
- [ ] Add **integration tests** using a local OAuth provider for discovery through callback and
      reconnect.
- [ ] Add **OSS and EE acceptance tests** for authorization followed by a real gateway tool call.
