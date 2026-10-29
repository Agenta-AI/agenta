# WP37 — Expose existing Agenta tools through builtin MCP

`builtin/agenta` currently exists only when development mocks are enabled and is another name for
the mock MCP adapter. That is a gateway integration omission, not an absence of Agenta tools:
the production tool resolver already creates run-scoped `customTools`; Pi receives them natively,
while Claude and Codex receive them through the runner's loopback `agenta-tools` MCP server. This
package makes the builtin gateway use that existing tool capability.

## Scope

- Reuse the existing Agenta tool resolver, public schemas, platform handlers, permission gates,
  approval behavior, and callback dispatch. Do not invent or duplicate a second tool service.
- Define the run-scoped identity and context carried by a gateway credential so a builtin MCP
  request identifies the same resolved tools and bound arguments as its agent run. The gateway
  must refuse a request without that context.
- Replace the development-only `agenta -> mock` mapping with an adapter that delegates to the
  existing capability. Keep `builtin/mock` as the explicit development test provider.
- Preserve the existing separation of duties: the runner's loopback `agenta-tools` transport is
  an implementation detail; the gateway exposes the same authorized tool capability, not a new
  unauthenticated or globally enumerable tool server.

## Required verification

- **Unit:** run-scoped endpoint visibility, adapter selection, existing public schemas, context
  binding, permissions, and no mock fallback in production mode.
- **Integration:** real `tools/list` and allowed/denied `tools/call` through builtin Agenta use
  the same resolver/handler result as the existing `customTools` path.
- **Acceptance:** OSS and EE harness tests call an existing Agenta tool through builtin Agenta and
  prove that a missing or mismatched run credential is refused.

## Done when

`builtin/agenta` is a real production provider backed by existing Agenta tools; the development
mock remains a separate provider and cannot stand in for it.
