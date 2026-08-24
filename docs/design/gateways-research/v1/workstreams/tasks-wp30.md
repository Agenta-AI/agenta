# WP30 tasks — MCP OAuth foundation and secrets-backed token storage

- [ ] Select and pin the official MCP SDK as a direct dependency; record its `TokenStorage` and
      OAuth-provider contracts.
- [ ] Implement secret-service-backed token storage using gateway-row `secret_id` handles only.
- [ ] Wire discovery, client metadata, redirect and callback hooks to the dashboard-facing API.
- [ ] Add endpoint-state and typed-refusal tests with a local OAuth test provider.
- [ ] Prove no token material appears in API responses, logs, or runner payloads.
