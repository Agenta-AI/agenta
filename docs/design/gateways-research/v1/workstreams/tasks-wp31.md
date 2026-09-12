# WP31 tasks — MCP OAuth consent and registration flow

- [x] Add dashboard/API connection and scope-selection flow with **unit tests** for state and
      callback validation.
- [x] Display derived ready, needs-auth, and needs-input endpoint states; allow OAuth reconnect
      for scope step-up and refresh the table only after a typed successful callback.
- [x] Use the existing WP30-facing automatic client-registration fallback and keep its unit
      coverage at the service boundary; do not duplicate OAuth/client plumbing in the dashboard.
- [x] Add the WP30-fixture-backed local-provider **integration** test at
      `api/oss/tests/pytest/integration/gateways/test_mcp_oauth_connect.py` for connect,
      callback, reconnect, and scope step-up. It skips only until the WP30 fixture merges.
- [x] Add browser-driven **OSS and EE acceptance coverage** at
      `web/{oss,ee}/tests/playwright/acceptance/settings/mcp-oauth.spec.ts` for consent,
      callback, ready state, reconnect/step-up, and fallback. It skips only when the deployed
      development stack has not advertised the reachable browser OAuth-provider capability.
