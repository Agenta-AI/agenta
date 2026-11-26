# Gateway Triggers — Proposal

## Summary

Add **triggers** to the gateway as a first-class, standalone concept, symmetric to the
existing gateway **tools**. A trigger lets a project subscribe to an *inbound* event
from a connected provider (new Gmail message, new GitHub commit, new Slack message) and,
when that event fires, **invoke an Agenta workflow** with the event as input. Triggers
are a peer top-level domain (`/triggers`, alongside `/tools`) with their own router,
service, DAO, and `subscriptions` table. Provider connections (`ca_*`) are **shared**: an
extracted `connections` domain (table `gateway_connections`, renamed from
`tool_connections`) backs both tools and triggers, so a provider is connected once and
used from both (decision **A2-2**; see [Alternatives](#alternatives-considered)).

The guiding analogy:

```text
Agenta events    ──▶  user endpoints      (outbound; the existing `webhooks` domain)
Composio triggers ──▶  Agenta workflows    (inbound; this design)
```

So a trigger is the inbound dual of an event subscription: where the `webhooks` domain
pushes Agenta-internal events *out* to a customer's URL, a gateway trigger pulls a
provider event *in* and runs it through an Agenta workflow. Triggers are their **own
domain concept** — not the outbound `webhooks` domain, and not workflow hooks.
See "Non-goals".

## Why

Tools answer "let the model *do* something in a provider." Triggers answer the inverse:
"let a provider *tell Agenta* something happened, and run an Agenta workflow on it."
Together they make the gateway bidirectional. This is the symmetric counterpart to the
existing outbound `webhooks` domain: Agenta events flow *out* to user endpoints; provider
triggers flow *in* to Agenta workflows. The `/tools` vertical already proved the
gateway-via-Composio pattern end to end; triggers replicate that proven structure in a
standalone domain for the inbound direction.

## Goals

1. **Event catalog** — browse the **events** a connected integration exposes, including
   each event's required `trigger_config` schema. Symmetric to the tools action catalog.
2. **Subscription lifecycle** — on a (shared) connection, create / enable / disable /
   delete many *subscriptions*, each a standing watch on one event bound to one workflow.
   Persisted in the triggers domain's own `subscriptions` table; connection auth lives in
   the shared `connections` domain.
3. **Ingress** — one server-owned, signature-verified inbound endpoint that receives
   Composio's webhook deliveries, maps each event to the owning project + trigger
   record, and dedups redeliveries.
4. **Dispatch to a workflow** — when a verified event arrives, invoke the Agenta
   workflow bound to that subscription, passing the event as input. This is the
   point of the feature: `Composio event → Agenta workflow`, mirroring
   `Agenta event → user endpoint`. The binding (`subscription → workflow ref`) is
   stored on the subscription record; dispatch calls the existing
   `WorkflowsService.invoke_workflow(project_id, user_id, request)` seam
   (`core/workflows/service.py:1698`).
5. **Peer `/triggers` domain alongside `/tools`** — triggers get their own top-level
   endpoint (not nested under `/tools`), their own router, service, DAO, DTOs, and their
   own `subscriptions` table. `/tools` for outbound actions, `/triggers` for inbound
   events. Triggers' event-catalog, subscription, and dispatch code is separate from
   tools'.
6. **Shared provider connections (decision: A2-2)** — the provider connection (`ca_*`) is
   a **gateway-level primitive**, not a per-feature resource: one Composio connected
   account is the same account whether a tool calls it or a trigger watches it. It is
   extracted into a shared `connections` domain (service + DAO + `gateway_connections`
   table, renamed from `tool_connections`) that has **no router of its own**. The HTTP
   surface stays per-domain — `/tools/connections` and `/triggers/connections` — both
   delegating to the shared service over the same rows. **Connect a provider once; use it
   from both tools and triggers.** Tools' connection auth is repointed at the shared
   service; the `/tools/connections` HTTP contract is unchanged. See
   [Alternatives considered](#alternatives-considered) for the rejected fully-separate
   option (B).
7. **Provider-agnostic shape** — model the shared connections adapter and the triggers
   adapter behind ports so a future non-Composio provider drops in without touching
   routers or services.

## Non-goals

- **Not the outbound `webhooks` domain.** That domain (Agenta → customer URLs, driven by
  internal `EventType`s, with its own subscriptions/deliveries/retries) stays exactly as
  is. Triggers are inbound (provider → Agenta) and are a separate domain with their own
  router, service, and table. We do **not** merge them, and we do **not** route trigger
  ingress through the webhooks subscription/delivery machinery in v1.
- **Not workflow hooks.** Workflow lifecycle hooks are an unrelated mechanism; triggers
  do not extend, replace, or depend on them.
- **Workflow invocation is the only v1 consumer.** A trigger binds to exactly one
  Agenta workflow and invokes it on each event. Other downstream consumers (evaluations,
  queues, re-emitting as an internal Agenta event for the outbound `webhooks` domain) are
  deliberately out of scope for v1 — the dispatch step is kept narrow: resolve the bound
  workflow and call `invoke_workflow`.
- **No new workflow execution path.** Triggers invoke workflows through the existing
  `WorkflowsService` seam; we do not build a parallel runner.
- **No custom-OAuth ingress registration** (registering Composio's ingress URL on a
  customer's own OAuth app). Managed-auth only for v1.
- **No polling fallback we own.** Composio handles provider polling for polling-type
  triggers; we only consume its single normalized webhook.
- **No SDK dependency.** `httpx` direct calls, same as tools.
- **No EE-only gating beyond what tools already have.** Triggers ship wherever tools do.

## Shape of the solution (high level)

```text
Provider ──event──▶ Composio ──signed webhook──▶  POST /triggers/composio/events/
                                                          │ verify HMAC (raw body)
                                                          │ route metadata.trigger_id → local record
                                                          │ recover project from metadata.user_id
                                                          │ dedup on metadata.id
                                                          ▼
                                                   resolve bound workflow ref on the record
                                                          ▼
                                                   WorkflowsService.invoke_workflow(
                                                       project_id, user_id, request=event-as-input)

Project ──▶ POST /triggers/connections/ (connect provider, OAuth)  ──┐  shared connection (ca_*)
            (or /tools/connections — same shared service + rows)        │  (also usable from tools)
        ──▶ POST /triggers/subscriptions/ (pick event + bind workflow) ├─▶ services ─▶ Composio v3
        ──▶ GET /triggers/catalog/.../events/... (events)              ┘     (one ca_* ; many ti_* per ca_*)
```

Terminology (see `mimics.md`): catalog leaf = **event** (≈ tools **action**). The created
state is two records with different owners and cardinality:

- **connection** — durable provider auth (`ca_*`), one per (project, provider,
  integration). A **gateway-level** resource shared by tools and triggers, in the
  `connections` domain. The inbound/outbound-neutral evolution of today's tool connection.
- **subscription** — a standing watch on one event (`ti_*` + `trigger_config` + bound
  workflow), FK → connection. Owned by the triggers domain. The inbound dual of a
  **webhook subscription**.

Why split connection from subscription: a Composio connected account (`ca_*`) backs
**many** trigger instances (`ti_*`) — Gmail "new message" and "new starred message" share
one auth. Tools already separates durable auth from per-use detail (a connection holds
only auth; the action + arguments arrive per call). Triggers is the first domain that must
*persist* per-event detail, so the connection/subscription split makes the
1-connection → many-subscriptions cardinality explicit (connect once, subscribe many).

Why share connections across domains (A2-2): `ca_*` is one real account regardless of
consumer; two rows for it would encode a lie and force a second OAuth consent. So:

- **`connections` (shared domain, no router)** — `core/gateway/connections/` +
  `dbs/postgres/gateway/connections/`. Owns OAuth initiate / callback / refresh / revoke
  and the `gateway_connections` table (renamed from `tool_connections`; already
  domain-neutral). Its Composio **auth** adapter implements a `ConnectionsGatewayInterface`.
  **No `apis/fastapi/gateway/connections/` router** — the HTTP surface is the per-domain
  `/tools/connections` and `/triggers/connections`, both delegating to this one service
  over the same rows.
- **`triggers` (peer domain)** — `apis/fastapi/triggers/`, `core/triggers/`,
  `dbs/postgres/triggers/`. A **two-table** domain mirroring webhooks' subscription +
  delivery pair:
  - `subscriptions` — project-scoped, FlagsDBA (enabled/valid), DataDBA with `ti_*`, the
    mapping (`inputs_fields`), the destination (`references`/`selector`), and the **bound
    workflow ref**; FK → shared connection.
  - `deliveries` — one audit row per inbound event dispatched (resolved `inputs`, workflow
    `references`, `result`/`error`); the audit + retry surface, mirroring
    `webhook_deliveries`.

  Plus the event catalog, ingress, and dispatch. Three routers under `/triggers`:
  - `/triggers/connections` — delegates to the shared `connections` service (the triggers
    view onto `gateway_connections`).
  - `/triggers/subscriptions` — the standing watches (own `subscriptions` table).
  - `/triggers/deliveries` — the dispatch audit log (own `deliveries` table).

  (Plus the catalog routes and the `/triggers/composio/events/` ingress.) Its Composio
  **triggers** adapter implements a `TriggersGatewayInterface` (`list_events`, `get_event`,
  `create_subscription`, `set_subscription_status`, `delete_subscription`). It depends on
  the shared `connections` service for auth and on `WorkflowsService` for dispatch.
- **`tools` (existing domain)** — unchanged HTTP contract; its connection auth is
  repointed at the shared `connections` service. Keeps actions + execution.
- One provider-namespaced ingress endpoint, **`POST /triggers/composio/events/`**,
  with HMAC verification keyed on a `COMPOSIO_WEBHOOK_SECRET`. This follows the
  established `{domain}/{provider}/events/` convention — cf. billing's
  `/billing/stripe/events/` (`api/ee/src/apis/fastapi/billing/router.py:106`), which
  likewise reads the raw body and verifies a provider signature
  (`stripe.Webhook.construct_event` with `env.stripe.webhook_secret`). Namespacing by
  provider leaves room for a future `/triggers/{provider}/events/` without collision.

## Success criteria

- A project can connect Gmail **once** (a shared `gateway_connections` row), browse
  Gmail's **events**, create a "new message" **subscription bound to a chosen Agenta
  workflow** (and more subscriptions on the same connection without re-auth), and have
  that workflow invoked with the event payload when a new message arrives.
- A Gmail already connected for tools is usable by triggers without reconnecting, and
  vice-versa; the same connection shows in both `/tools/connections` and
  `/triggers/connections` (same shared rows).
- The invocation is project-scoped and authenticated through the existing
  `invoke_workflow` path (no new execution route).
- Disabling/deleting a subscription stops delivery and removes the Composio trigger
  instance, without touching the shared connection.
- Forged or replayed deliveries are rejected (signature + dedup).
- No change to the outbound `webhooks` domain or to the existing `/tools` HTTP contract.

## Risks / decisions to lock before build

- **Exact Composio v3 trigger REST paths** (verify against live OpenAPI; SDK names are
  stable).
- **How the project webhook URL is registered** (API vs dashboard) and whether one URL
  per Composio project forces all projects through one ingress (it does — routing is
  ours).
- **Event → workflow mapping** — worked out in [`mapping.md`](mapping.md): destination is a
  workflow `references`/`selector` (the `/retrieve` shape); the `inputs_fields` template
  (webhooks' `payload_fields`, retargeted) resolves the inbound event into
  `WorkflowServiceRequest.data.inputs` via the reused selector resolver. Open sub-points:
  the default mapping, schema-validation against the bound workflow, and what `user_id` a
  system-initiated invocation runs as (no human in the loop).
- **Sync vs async dispatch** — invoke inline in the ingress request, or enqueue and ack
  fast so Composio's webhook doesn't time out / retry. Leaning async.
- **Idempotency store** for `metadata.id` dedup (table column vs cache).
- **Cross-domain revoke rule (consequence of A2-2).** Because a connection is shared,
  revoking a `ca_*` affects every consumer (tools actions + trigger subscriptions on it).
  Lean: **revoke-for-everyone + show usage** ("used by tools / used by N subscriptions")
  rather than cross-domain reference-counting. Deleting a subscription must *not* revoke
  the shared connection. The FE must expect overlapping reads across the three connection
  surfaces. This rule is the main new behavior A2-2 introduces.
- **`gateway_connections` migration.** Rename `tool_connections` → `gateway_connections`
  (+ its `uq_`/`ix_` constraints); no data transform (table is already domain-neutral).
  Repoint tools' connection auth (~4 references) at the shared `connections` service. The
  `/tools/connections` contract stays frozen.

## Alternatives considered

### B — fully separate connections (rejected)

`tool_connections` stays as-is; triggers gets its own `trigger_connections` (a mirror).
Zero migration, zero cross-domain coupling, no shared-lifecycle rule.

**Why rejected:** it buys nothing for the user and encodes a falsehood. A Composio
connected account is one real account; modeling it as two rows forces the user to connect
the same provider **twice** (two OAuth consents, two "Gmail connected" states) for tools
vs. triggers, indefinitely. B is the smaller raw diff, but the cost is paid forever in
duplicate consent. A2-2 was chosen because the migration turned out cheap (`tool_connections`
is recent, ~4 references, and already provider-agnostic) — so the only real added cost of
A2-2 over B is the cross-domain revoke rule above, which is small and worth it.

A2-1 (shared `gateway_connections` table but **separate rows per domain**) was also
rejected: it pays A2's migration cost while still forcing connect-twice — all of the cost,
none of the benefit.
