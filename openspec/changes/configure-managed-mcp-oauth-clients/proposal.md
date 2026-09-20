# Configure managed OAuth clients for MCP integrations

Draft for review. Not implemented.

## Why

A catalog alone still asks each user to register an application with GitHub or Slack. Agenta Cloud and self-hosting operators should configure a provider application once per deployment, so users only consent to their own connection.

## What Changes

- Read provider-specific client IDs and secrets through the backend's central environment configuration.
- Use a backend-owned setup decision to show consent directly when configured, or the existing client form with documentation when not configured.
- Restrict shared credentials to catalog-approved resources, issuers, and token destinations. Never select credentials from a browser-supplied issuer alone.
- Keep grants per project connection and preserve the client identity used for callback and refresh.
- Document manual and operator-configured setup, separate staging/production applications, rotation, and rollback.
- Prepare a separate Cloud deployment change that keeps these secrets in the API service rather than every service's shared environment.

## Capabilities

### New Capabilities

- `mcp-managed-oauth-clients`: Configure and safely resolve deployment-owned OAuth registrations; expose only setup decisions to the UI.
- `mcp-provider-operations`: Maintain provider setup instructions and environment-specific credential lifecycle procedures.

### Modified Capabilities

None. This adds managed selection before the existing registration fallback. It preserves the prior registration and manual-client requirements rather than replacing their definitions.

## Impact

Depends on the registered-client fix and the backend catalog from `add-mcp-integration-catalog`. It touches backend environment configuration, probe/connect decisions, callback and refresh identity handling, shared UI rendering, hosting examples, and provider documentation. A companion deployment pull request targets the existing Cloud delivery repository. Provider app creation and live secret changes remain separate, approval-required operator work.

No secrets belong in the frontend, catalog source, repository, or review documents. Self-hosted installations never receive Agenta Cloud's client secret.
