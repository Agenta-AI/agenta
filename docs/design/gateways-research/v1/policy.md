# Gateways: the policy core

> **MCP release scope update (2026-09-15):** Read [confirmed decisions](release-decisions-2026-09-15.md) and the [release-ready handoff](MCP-RELEASE-HANDOFF.md) first. They govern current scope and the target connection UX where this baseline differs. Existing code-review findings remain independent and must be resolved or explicitly dispositioned; no implementation or QA is implied by a product decision.

**Status: implemented baseline.** Both gateway planes use the same policy service
for authenticated principal handling, fail-closed permission checks and gateway-call
events. Broader commercial and cache policy is not implemented in this increment.

## Current implementation

| Concern | Current behaviour |
|---|---|
| Identity | Gateway routes inherit the authenticated organization, workspace, project and user scope. |
| Authorization | `GatewayPolicyService` calls the normal action-access check before relay and denies on failure. LLM and MCP endpoint-use permissions remain distinct. |
| Governance | The resolved endpoint model/tool filters and endpoint settings are applied by gateway services; custom outbound hosts are guarded at registration and relay. |
| Compliance | Each relay publishes a gateway-call event with the resolved principal and outcome. |
| Routing | The gateway resolves the namespace/provider or custom slug to its generated or persisted endpoint before adapter selection. |
| Metering | Usage can be attached to the call event, but billing, wallets, entitlement limits and durable audit guarantees are not a gateway increment deliverable. |

## Whether a plane serves at all

Above the per-call policy above sits one switch per plane, read by the API and nowhere else.

| Variable | Default | Reached as | Off means |
|---|---|---|---|
| `AGENTA_MCP_GATEWAY_ENABLED` | `true` | `env.mcp_gateway.enabled` | Every MCP gateway route refuses with `mcp_gateway_disabled`; the web hides the MCP endpoints settings tab; an agent dials its declared MCP servers directly. |
| `AGENTA_LLM_GATEWAY_ENABLED` | `false` | `env.llm_gateway.enabled` | Every LLM gateway route refuses with `llm_gateway_disabled`; the SDK resolves a model from the project's vault key and injects it into the run, the pre-gateway path. |

Three properties are load-bearing, and each was chosen against a plausible alternative.

**The routers stay mounted.** A refusal carries the shared `{code, message, retryable,
next_step, details}` envelope, rendered per surface: as the HTTP `detail` on the control
plane, as an OpenAI-shaped error on the LLM data plane, as a JSON-RPC error on the MCP one.
Not mounting the routers would have been fewer lines, but the SDK's fallback keys on the
code, and an absent route answers 404 — indistinguishable from a mistyped URL.

**The API is the authority and the SDK holds no second switch.** The SDK learns a plane is
off from the refusal: `POST /gateways/llms/resolve` answers it directly, and `POST
/gateways/credentials` accepts an optional `plane` so a caller about to use the MCP gateway
learns before it dials rather than at the first tool call. A second switch shipped in the SDK
could disagree with the API's, and the disagreement would be a run that routes a provider key
somewhere the operator closed.

**The MCP kill switch does not cover the OAuth attempt sweep.** Expiring abandoned attempts
is table maintenance; a deployment that turned the plane off still wants the rows it already
has swept rather than kept forever.

The OAuth connect callback IS covered: a browser returning after the switch flipped is
holding an authorization code for a gateway that no longer serves, and storing the grant it
buys would leave a connection nobody can use.

## Failure posture

Authorization is fail-closed: an unauthenticated or unauthorized caller never
reaches an adapter. Secrets remain in the resolved south-port input and must not
appear in a north-port response or log. There is presently no gateway policy
decision cache; a control-plane outage is not masked by an undocumented cache.

## Still deliberately open

- How entitlement limits, wallets and spend/egress ceilings compose with a call.
- Durable compliance retention versus the gateway-call event/tracing pipeline.
- Whether routing can be policy-overridden rather than derived from the endpoint.
- Decision-cache key, invalidation, TTL and the classes of call that must never
  use it.
- Policy expiry during a streamed response.

Those are design obligations for later increments, not guarantees implied by the
current relay implementation.
