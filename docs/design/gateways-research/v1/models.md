# Gateways: models

> **MCP release scope update (2026-09-15):** Read [confirmed decisions](release-decisions-2026-09-15.md) and the [release-ready handoff](MCP-RELEASE-HANDOFF.md) first. They govern current scope and the target connection UX where this baseline differs. Existing code-review findings remain independent and must be resolved or explicitly dispositioned; no implementation or QA is implied by a product decision.

**Status: as built for the current model protocols.** Embeddings, aliases and
fallback remain deliberately outside this increment.

## Routing axes

Model routing preserves two independent axes:

- **Provider family** identifies the upstream integration when there is one.
- **Deployment kind** identifies how it is reached: direct, custom-compatible,
  Azure, Bedrock, SageMaker, Vertex, or the development `mock` deployment.

`LLMEndpointRoute` carries the non-secret addressing data: base URL and headers,
plus API version, region and provider-specific extras. `provider_key` is optional
for a self-hosted OpenAI-compatible custom endpoint.

## Current north port and relay

Each `builtin/{provider}`, `standard/{provider}` and `custom/{slug}` namespace
supports OpenAI Chat Completions, OpenAI Responses, Anthropic Messages and model
listing. The gateway selects the resolved route and passes the upstream request
and response through the relay; the adapter holds the provider compatibility
logic and receives resolved credentials only server-side.

Builtin `agenta` and mock providers, standard mock, and custom mock routes make
the three namespace variants testable in development. Production provider
catalogue expansion (for example Gemini or Bedrock) extends this same route
shape rather than adding a global client configuration.

## Credential isolation

Provider credentials are per-request resolved inputs to the relay. No handler
stores provider keys in module-level model-client configuration: that historical
cross-tenant leak risk was removed by the gateway relay work (the former OR13).
Custom endpoints are checked with the outbound-target guard when registered and
when relayed.

## Deferred model work

- **Embeddings.** Existing evaluator/service callers have not moved to a gateway
  route; model gateways currently cover the chat-oriented protocols above.
- **Aliases and fallbacks.** The gateway is route-and-inject enforcement, not a
  model-selection product surface in this increment.
- **User-owned secrets and charging semantics.** These require ownership,
  billing and entitlement decisions, tracked in `out-of-scope.md`.
- **Mid-stream policy expiry and north-port versioning.** There is no policy
  refresh or public compatibility policy beyond the current protocol surfaces.
