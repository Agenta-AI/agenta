# WP31 — MCP OAuth consent and registration flow

Build the product flow on WP30's OAuth substrate: dashboard connection, scope selection, callback
completion, endpoint state display, and automatic registration fallback for deployments whose
domain cannot use client metadata.

## Required verification

- **Unit:** `test_gateways_mcp_router.py` validates scope request shape and callback messages;
  the settings UI tests validate ready / needs-auth / needs-input rendering and reject malformed
  callback completions. Registration choice remains covered by
  `test_gateways_mcp_oauth_registration_fallback.py` at the WP30 service boundary.
- **Integration:** add a local-provider test at
  `api/oss/tests/pytest/integration/gateways/test_mcp_oauth_connect.py` that exercises the
  dashboard/API connection route, callback completion, reconnect, and scope step-up through the
  WP30 OAuth fixture.
- **Acceptance:** add OSS and EE Playwright settings flows at
  `web/{oss,ee}/tests/playwright/acceptance/settings/mcp-oauth.spec.ts`: consent, callback,
  ready-state refresh, step-up/reconnect, and automatic registration fallback.

The integration and browser cases depend on WP30 exporting its pinned official-client contract
and reusable local OAuth provider fixture. They must use that fixture; WP31 must not create a
second hand-rolled OAuth server or client only for tests.

## Done when

A user can connect an OAuth MCP endpoint from the dashboard, complete consent, see its ready
state, and receive a typed step-up response when scopes change.
