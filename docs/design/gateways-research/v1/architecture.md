# Gateways: architecture

**Status: skeleton.** Section headings are settled; the content marked *to establish* is the
remaining work.

---

## 1. What the feature is

Two gateways — one for model calls, one for tool and MCP calls — sharing one policy core.
Every outbound call from every caller transits one of them. Callers name what they want and
authenticate to us; the gateway binds that name to a real route and a real secret.

## 2. The shape

The system is **one policy core, two protocol surfaces, and a set of adapters**.

```text
callers ──▶ protocol surface ──▶ policy core ──▶ adapter ──▶ upstream
                (north port)                    (south port)
```

- **North port** — what a caller speaks. Model plane: an OpenAI-compatible surface. Tool
  plane: MCP over Streamable HTTP. Both authenticate with a secret we mint.
- **Policy core** — identity, authorization, governance, secret resolution, audit,
  metering. Protocol-neutral. Shared by both surfaces; this sharing is the reason the two
  gateways are one design.
- **South port** — adapters. Model providers and their deployments on one side, MCP servers
  on the other.

*To establish:* whether the core and the surfaces ship as one deployable or two, and where
the boundary sits relative to the main API. See `decisions.md` D1 and D2.

## 3. Boundary rules

*To establish.* Candidates, each of which needs stating as a rule or discarding:

- No secret material crosses the north port outward.
- No caller-supplied value reaches an adapter without passing the policy core.
- The core never imports a protocol surface or a concrete adapter; wiring happens at the
  entrypoint, per the repo's layering rule.

## 4. Where this lands relative to the existing layering

The repo's required direction is Router → Service → DAO interface → DAO implementation → DB,
with concrete dependencies wired only at the entrypoint, and DTO/DBE mapping isolated in the
DB layer.

The gateways are a **separate domain that mirrors the existing gateway family's shape without
joining it**. That family — catalog, connections, tools, triggers — already has ports,
registries, services and per-provider adapters, so it is the structural precedent to copy. It is
not a family to enter.

**Why the distinction is not pedantry.** Judged by what it holds rather than by what it is
called, that family is an *integrations* domain: its contracts are integrations and integration
keys, its one table is a connections table, and its only provider is Composio. The gateways are
traffic transiting a boundary — identity, policy, secret injection and metering, per call, on the
data path. Sharing ports and registries is true of every domain in this repo and proves nothing
about kinship. `notes.md` records the two drafts that concluded otherwise.

Settled in `entities.md`: `core/gateways/` beside the existing `core/gateway/`, holding both
planes and the shared policy core, with matching folders under the storage and API layers. One
genuine reference to the older domain survives and is not evidence of kinship — a
Composio-brokered MCP server points at a connection row.

## 5. The path of a model call

*To establish.* Must cover: caller authenticates → principal resolved → policy evaluated →
secret resolved by owner and mode → adapter selected by provider and deployment →
upstream call → streaming response → usage recorded → audit written.

Open within this: how streaming interacts with a policy decision that has to be made before
the first token, and what happens to a decision that expires mid-stream.

## 6. The path of a tool call

*To establish.* Must cover: caller authenticates → principal resolved → target resolved from
the request headers → policy and allowlist evaluated → secret resolved → upstream MCP
call → result returned → audit written.

Open within this: the endpoint shape (one merged endpoint with namespaced tools, or one per
server), and how a list call composes across servers with differing secret health.

## 7. What belongs to the platform, not here

Tracing and metering pipelines, RBAC, entitlement checks, the secrets service, and the
approval mechanism all exist. The gateways emit into them and call them; they do not
reimplement any of them.

*To establish:* the exact call into the entitlement check, and whether the gateway's own
decision caching layers on top of the existing two-layer pattern or replaces it for this
path.

## 8. Security posture

The gateway's central claim is that provider credentials stop at our boundary.

Established: signing for cloud resellers moves to the gateway, so the secret category
that today must be held in an agent-controlled sandbox stops existing for gateway-routed
runs; and the per-run redaction set collapses to one short-lived token.

*To establish:* the token's lifetime and scope, what it authorizes beyond identity, and what
an attacker holding one can do.

## 9. Failure posture

Fail-closed on policy, with the data plane able to serve cached decisions through a
control-plane outage.

*To establish:* what "cached decision" means concretely — what is cached, keyed how, for how
long, and which classes of call are never served from cache.

## 10. Extending to protocols we do not yet speak

*To establish.* The adapter port should admit a new upstream kind without touching the core.
Whether that generalizes beyond models and MCP is worth stating one way or the other, since
an over-general port costs more than it returns.
