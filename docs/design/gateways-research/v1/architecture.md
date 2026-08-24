# Gateways: architecture

**Status: as built for this increment.** The remaining items are deliberately
outside its scope, recorded in `out-of-scope.md` or the open-design documents.

---

## 1. What the feature is

Two gateway planes share a policy service: one proxies model protocols, the other
proxies MCP Streamable HTTP. Callers authenticate to Agenta; gateway code resolves
the selected route and its project-owned secret and calls the upstream without
exposing that upstream secret to the caller.

## 2. The shape

```text
caller ──> FastAPI gateway router ──> gateway service + policy ──> adapter ──> upstream
                  north port                    south port
```

- **North ports.** LLM routes expose OpenAI chat-completions and Responses plus
  Anthropic Messages; MCP routes expose transparent Streamable HTTP.
- **Policy core.** `GatewayPolicyService` resolves the authenticated principal,
  fails closed on permission denial, and publishes a gateway-call event.
- **South ports.** LLM relay adapters receive a resolved deployment route and
  secret; MCP HTTP adapters receive a resolved server route and credentials.

The implementation is part of the API deployment: routers live in
`apis/fastapi/gateways/`, the domain in `core/gateways/`, and persistence in the
normal storage layers. It does not join the older `core/gateway/` integrations
domain.

## 3. Boundary rules

- A request is authenticated and authorised before any upstream call.
- Secrets are resolved server-side and injected only into the outbound adapter
  request; no management or proxy response serializes secret material.
- Router-to-service-to-storage layering is retained. Concrete adapters are wired
  at the application boundary rather than imported by policy.
- Custom outbound URLs pass the existing outbound-target guard when registered and
  again when relayed.

## 4. Implemented call paths

### Models

The proxy resolves a namespace (`builtin`, `standard`, or `custom`), provider or
custom endpoint, model and protocol. It authorises the target, resolves the route
and secret, passes the request through the LLM relay, then emits the gateway-call
event. Chat-completions, Responses, Messages and model-listing are each available
where the upstream protocol supports them.

### MCP

The proxy resolves a standard provider, builtin provider, or custom endpoint,
authorises it, resolves the route and secret, and transparently relays the
Streamable-HTTP request. `POST /endpoints/{id}/connect` discovers an OAuth server
and starts authorization; the callback completes the exchange and stores its
project-owned OAuth grant.

## 5. Security and failure posture

Gateway authorization is fail-closed. OAuth state is signed and time-bound, grant
material is stored in the secrets service, and the client metadata endpoint is
public only where MCP authorization servers must fetch it. HTTP authentication
supports the Agenta credentials header so upstream bearer credentials can remain
pass-through content when necessary.

Policy decisions are evaluated for each request. There is no decision cache or
mid-stream reauthorization in this increment; their semantics remain open design
work rather than an implied guarantee.

## 6. Deliberately later

Model aliases/fallback, embeddings, user-owned secrets, static/stdio MCP
providers, policy composition and egress ceilings, durable compliance storage,
metering/billing, routing policy and cache semantics are not implemented here.
Their status and rationale live in `out-of-scope.md` and `open-designs.md`.
