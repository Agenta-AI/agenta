# WP37 — Production Agenta builtin MCP provider

`builtin/agenta` currently exists only when development mocks are enabled and is another name for
the mock MCP adapter. This package defines and delivers the first production Agenta-owned MCP
server so the provider means something outside development.

## Scope

- Define the first Agenta-owned tool set, ownership, authorization, and lifecycle as a real
  Streamable HTTP MCP server behind the gateway.
- Replace the development-only `agenta -> mock` mapping with a production adapter/server. Keep
  the mock route as an explicit development test provider.
- Ensure the server uses normal gateway policy, audit, and short-lived credential controls; it
  cannot be a disguised runner-internal tool channel.

## Required verification

- **Unit:** catalogue visibility, adapter selection, policy, tool schemas, and no mock fallback in
  production mode.
- **Integration:** real `tools/list` and allowed/denied `tools/call` through the builtin Agenta
  route.
- **Acceptance:** OSS and EE gateway and harness tests call one Agenta-owned tool through the
  production route.

## Done when

`builtin/agenta` is a real production provider with an independently testable tool server; the
development mock remains a separate provider and cannot stand in for it.
