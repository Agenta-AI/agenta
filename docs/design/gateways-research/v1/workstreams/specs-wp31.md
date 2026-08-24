# WP31 — MCP OAuth consent and registration flow

Build the product flow on WP30's OAuth substrate: dashboard connection, scope selection, callback
completion, endpoint state display, and automatic registration fallback for deployments whose
domain cannot use client metadata.

## Done when

A user can connect an OAuth MCP endpoint from the dashboard, complete consent, see its ready
state, and receive a typed step-up response when scopes change.
