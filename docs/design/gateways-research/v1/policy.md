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
