# WP31 — MCP OAuth consent and registration flow

Build the product flow on WP30's OAuth substrate: dashboard connection, scope selection, callback
completion, endpoint state display, and automatic registration fallback for deployments whose
domain cannot use client metadata.

## Required verification

- **Unit:** scope and callback-state validation, state rendering, and registration-fallback choice.
- **Integration:** dashboard/API connection flow, callback completion, reconnect, and scope
  step-up against the local OAuth provider.
- **Acceptance:** browser-driven OSS and EE development-stack flows cover consent, ready state,
  step-up, and automatic registration fallback.

## Done when

A user can connect an OAuth MCP endpoint from the dashboard, complete consent, see its ready
state, and receive a typed step-up response when scopes change.
