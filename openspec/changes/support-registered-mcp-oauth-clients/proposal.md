# Registered OAuth clients for MCP servers

Draft for review. This change describes code already present in commit `c8e3cfd50359ddb4824a3972f0080ae6abd58318`, not completed provider acceptance testing.

## Why

GitHub and Slack MCP servers do not advertise automatic client registration. Agenta assumed they accepted a client metadata URL instead, so users reached a provider flow that could not authorize Agenta.

## What Changes

- Require explicit metadata-document support before using that registration method.
- Report unsupported automatic registration distinctly from an unreachable callback.
- Accept a registered client ID and, when required, a write-only client secret when beginning consent.
- Keep user-supplied registrations separate per endpoint and retain the token fallback.

## Capabilities

### New Capabilities

- `mcp-manual-oauth-clients`: Enter, store, and reuse a registered application through the connection form.

### Modified Capabilities

- `mcp-oauth-registration`: Check registration support and stop unsupported automatic consent before redirecting.

## Impact

The existing patch changes the MCP probe, OAuth discovery and service, vault-backed registration storage, FastAPI request models, entity API/hooks, and shared connect UI. It needs no new catalog or managed environment variables. It does not provision provider applications.

This change is the prerequisite for the two proposed follow-ups. See [the review guide](../../README.md) for delivery boundaries and validation gaps.
