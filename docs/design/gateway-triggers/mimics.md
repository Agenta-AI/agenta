# Gateway Triggers — Mimics & Contrasts

This doc maps each part of the work onto the existing Agenta pattern it relates to.
Two relationship kinds are used, and they are different:

- **mimic** — *replicate the pattern in new triggers-domain files* (copy structure, swap
  nouns; no imports across the boundary). Applies to events catalog, subscriptions,
  ingress, dispatch.
- **share/extract** — *the same code/table serves both domains.* Applies to **one** thing
  only: provider **connections** (`ca_*`), which are pulled out of `/tools` into a shared
  `connections` domain and consumed by both (decision **A2-2**).

Terminology: the triggers catalog leaf is an **event** (≈ a tools **action**). The created
state is **two** records with **different owners**:

- **connection** — durable provider auth (`ca_*`). A **shared, gateway-level** record
  (`gateway_connections`, renamed from `tool_connections`), used by both tools and
  triggers. Not triggers-owned.
- **subscription** — a standing watch on one event (`ti_*` + config + workflow, FK →
  connection), owned by the triggers domain. Modeled on a webhook subscription. Split from
  the connection because one `ca_*` backs many `ti_*`.

This file is organized as a set of pairwise comparisons:

- [Triggers vs Tools](#triggers-vs-tools) — the structural template (events catalog, adapter) + the **shared** connection (extracted from tools)
- [Triggers vs Billing](#triggers-vs-billing) — the inbound-event ingress template
- [Triggers vs Webhooks](#triggers-vs-webhooks) — the two **subscription** species + the directional mirror
- [Triggers vs Everything (the net-new parts)](#triggers-vs-everything-the-net-new-parts)

A one-line map of where each part comes from:

| Part | Relationship | Source |
|------|--------------|--------|
| **event** catalog, triggers adapter, domain layout | mimic | **Tools** |
| provider **connection** (`ca_*`) | **share/extract** | **Tools** → shared `gateway_connections` |
| the **subscription** + **delivery** tables (two-table domain, CRUD, lifecycle) | mimic | **Webhooks** (`webhook_subscriptions` + `webhook_deliveries`) |
| inbound event endpoint, signature verify, payload-based scoping | mimic | **Billing** (Stripe `/stripe/events/`) |
| trigger↔workflow binding, system-initiated dispatch, idempotency | net new | **nothing** |

> **Two parents, plus one shared organ.** The triggers code is a cross of **tools**
> (catalog/adapter machinery) and **webhooks** (the subscription model + lifecycle); the
> ingress endpoint comes from **billing**. Separately, the provider **connection** is not
> re-created at all — it is extracted from tools into a shared `connections` domain that
> both tools and triggers sit on (A2-2). The one sanctioned cross-domain runtime calls are
> triggers → the shared connections service (auth) and triggers →
> `WorkflowsService.invoke_workflow` (dispatch).

---

## Triggers vs Tools

Tools relates to triggers in **two** different ways, and it's important not to conflate
them:

- **mimic** — the triggers *event catalog* and *Composio adapter* replicate the tools
  catalog/adapter structure in new files.
- **share/extract** — the tools *connection* is not copied; it is **moved** into a shared
  `connections` domain that both tools and triggers consume.

### Part A — mimic: events catalog + triggers adapter

New triggers-domain files, modeled on tools, swapping `action → event`:

| Aspect | `/tools` | `/triggers` (new files, same shape) |
|--------|----------|-------------------------------------|
| Domain layout | `apis/fastapi/tools/`, `core/tools/`, `dbs/postgres/tools/` | `apis/fastapi/triggers/`, `core/triggers/`, `dbs/postgres/triggers/` |
| Layering | Router → Service → DAOInterface + GatewayInterface → impls | identical |
| Wiring | `tools` block in `entrypoints/routers.py:578` | `triggers` block next to it |
| Adapter | `ComposioToolsAdapter` (httpx, no SDK) | own `ComposioTriggersAdapter` (httpx, no SDK) |
| Catalog leaf | **actions** + `input_parameters` schema | **events** + `trigger_config` schema |
| Catalog route | `.../integrations/{i}/actions/{action_key}` | `.../integrations/{i}/events/{event_key}` |
| Env gate | `env.composio` | `env.composio` (shared value) + `COMPOSIO_WEBHOOK_SECRET` |

### Part B — share/extract: the provider connection

The tools connection (`ca_*`, OAuth, refresh, revoke) is **the same object** triggers
needs for auth. Rather than re-create it, extract it from `/tools` into a shared
`connections` domain (decision A2-2):

| Aspect | before (tools-owned) | after (shared) |
|--------|----------------------|----------------|
| Table | `tool_connections` | `gateway_connections` (renamed; already domain-neutral) |
| Code | `core/tools` connection code + `ComposioToolsAdapter` auth methods | `core/gateway/connections/` + a `ConnectionsGatewayInterface` auth adapter |
| Router | `/tools/connections` router | **none of its own** — shared service has no router |
| HTTP surface | `/tools/connections` | `/tools/connections` **and** `/triggers/connections`, both delegating to the shared service (same rows) |
| Auth verbs | `initiate_connection`, `refresh`, `revoke`, `get_status` | unchanged, now in the shared service |
| Consumers | tools only | tools **and** triggers |

The tools `/tools/connections` HTTP contract is unchanged; its handlers delegate to the
shared service. `ToolsService` connection management (`core/tools/service.py:138-383`) is
the code that *moves* (lightly generalized), not code that triggers re-creates.

### Where they differ

| | Tools | Triggers |
|---|-------|----------|
| Direction | outbound (we call the provider) | inbound (the provider calls us) |
| Source of work | an LLM/agent tool call | a provider event |
| Per-event work | synchronous response to caller | invoke the bound Agenta workflow |
| Per-use record | *(ephemeral tool call — nothing persisted)* | a **subscription** (`ti_*` + config + workflow), FK → shared connection |
| Relation to connection | uses it directly to call actions | references it from a standing subscription |
| Extra surface | — | an inbound ingress endpoint (no tools analogue — see Billing) |

> **Connect once, used by both.** Because the connection is shared, a Gmail connected for
> tools is immediately usable by triggers and vice-versa — no second OAuth consent. The
> cost is a cross-domain revoke rule (revoking `ca_*` affects both; deleting a subscription
> must not revoke the connection). This is the inverse of rejected option B, where each
> domain owned its own connection and the user connected twice (see
> [Triggers vs Everything](#triggers-vs-everything-the-net-new-parts) and
> `proposal.md` § Alternatives).

---

## Triggers vs Billing

**Relationship: the ingress template.** The inbound event endpoint has **no analogue in
tools** (tools are outbound). Its only precedent in the codebase is billing's Stripe
webhook — Agenta's one existing inbound, signature-verified provider-event handler. This
is the most important pattern to copy correctly.

Reference: `handle_events` at `api/ee/src/apis/fastapi/billing/router.py:240`, route at
`:106`.

### What lines up (billing)

| Aspect | `/billing` (Stripe) | `/triggers` (Composio) |
|--------|---------------------|------------------------|
| Route shape | `POST /billing/stripe/events/` | `POST /triggers/composio/events/` |
| Convention | `{domain}/{provider}/events/` | same |
| Body handling | `await request.body()` before parsing | same — raw body required for verify |
| Verification | `stripe.Webhook.construct_event(payload, sig, env.stripe.webhook_secret)` | HMAC-SHA256 over `{id}.{ts}.{body}`, `COMPOSIO_WEBHOOK_SECRET` |
| Bad signature | 401, return | 401, return |
| Unconfigured provider | 200 no-op (`"Stripe not configured"`) | 200 no-op if secret unset |
| Irrelevant/skipped event | 200 skip (so provider stops retrying) | 200 skip (unknown `trigger_id`, disabled, duplicate) |
| Tenant scope | from payload `metadata.organization_id` | from payload `metadata.user_id` → `project_id` |
| Routing key | event `type` | `metadata.trigger_id` → local row |
| Env fan-out guard | `metadata.target == env.stripe.webhook_target` | optional `target`-style guard (see below) |
| Boundary decorator | `@intercept_exceptions()` | same |

Handler skeleton to lift:

```python
payload = await request.body()          # raw body BEFORE parsing — required for verify
# verify provider signature against raw body + secret; on failure → 401 + return
# extract scope from the payload, look up the local record, act
# always 2xx for events you intentionally skip (so the provider doesn't retry)
```

### Where they differ (billing)

| | Billing (Stripe) | Triggers (Composio) |
|---|------------------|---------------------|
| Scope key | `organization_id` | `project_id` (from `user_id`) |
| What the event drives | subscription/meter state changes | invoke an Agenta workflow |
| Processing | effectively synchronous in-handler | likely ack-fast + async dispatch (avoid webhook timeout/retry storms) |
| Dedup | relies on Stripe semantics | **we** dedup on `metadata.id` (new) |
| Edition | EE-only | wherever tools ship |

> **Worth copying: the `webhook_target` filter.** Stripe lets one account fan out to
> dev/staging/prod without cross-talk by checking `metadata.target` against
> `env.stripe.webhook_target`. One Composio project's single webhook URL serving multiple
> Agenta deployments has the same need — a `target`-style guard is a reasonable copy.

---

## Triggers vs Webhooks

**Relationship: the subscription + delivery model — and the conceptual mirror.** The
outbound `webhooks` domain (`api/oss/src/core/webhooks/`) matters to triggers in two
distinct ways: it owns the **two-table subscription/delivery** model the trigger records
are patterned on, *and* it is the directional mirror of the whole feature. As always: copy
the pattern into new files, do not touch `core/webhooks/`.

Webhooks is a **two-table domain**: `webhook_subscriptions` (standing config) +
`webhook_deliveries` (one audit row per attempt). Triggers mirrors the **same pair**:
`subscriptions` + `deliveries`.

### Part A1 — the two subscription species

A **webhook subscription** already exists: a project subscribes to internal Agenta events
and they are delivered *out* to a URL. A **trigger subscription** is the inbound dual: a
project subscribes to provider events and they are delivered *in* to a workflow. Same
noun, same lifecycle shape, opposite direction.

Webhook subscription shape — `WebhookSubscription` /
`WebhookSubscriptionData{url, event_types, auth_mode, secret, payload_fields}` (`core/webhooks/types.py:116`),
routes `/webhooks/subscriptions/` · `/query` · `/{id}` · `/{id}/test`
(`apis/fastapi/webhooks/router.py:55`).

| Aspect | webhook subscription | trigger subscription |
|--------|----------------------|----------------------|
| Noun / table | `webhook_subscriptions` | `subscriptions` (triggers domain) |
| Routes | `/webhooks/subscriptions/` + `/query` + `/{id}` + `/{id}/test` | `/triggers/subscriptions/` + `/query` + `/{id}` + `/{id}/refresh` + `/{id}/revoke` |
| What you subscribe to | internal `EventType`s (`event_types`) | a provider **event** (Composio trigger type) |
| Direction | event delivered **out** to `data.url` | event delivered **in**, dispatched to a workflow |
| Destination | customer URL (`url/headers/auth_mode`, by value) | workflow `references` + `selector` (by reference) |
| Mapping field | `payload_fields` → whole body | `inputs_fields` → `data.inputs` (see `mapping.md`) |
| Secret | `secret` / `secret_id` (we sign outgoing) | `COMPOSIO_WEBHOOK_SECRET` (we verify incoming) |
| Project-scoped record w/ lifecycle | yes | yes |
| Mixins | `Identifier, Lifecycle, Header, Metadata` | same + `FlagsDBA`, `DataDBA` for `ti_*` + config + workflow ref + FK → connection |

### Part A2 — the two delivery species

`webhook_deliveries` records each outbound attempt; `deliveries` (triggers) records each
inbound event dispatched to its workflow. Same role (audit + retry surface), fields differ
only where the destination differs.

`WebhookDelivery` / `WebhookDeliveryData{url, headers, payload, response{status_code, body}, error}`
(`core/webhooks/types.py:156`), routes `/webhooks/deliveries` · `/{id}` · `/query`
(`router.py:110`).

| Aspect | webhook delivery | trigger delivery |
|--------|------------------|------------------|
| Table | `webhook_deliveries` | `deliveries` (triggers domain) |
| Routes | `/webhooks/deliveries` · `/{id}` · `/query` | `/triggers/deliveries` · `/{id}` · `/query` |
| One row per | outbound POST attempt | inbound event dispatched |
| Destination fields | `url`, `headers` | `references` (workflow) |
| Payload fields | `payload` (sent body) | `inputs` (resolved `inputs_fields`) |
| Outcome fields | `response{status_code, body}`, `error` | `result`, `error` |
| Why it exists | audit + retry of a failed POST | audit + retry of a failed dispatch — and the **only** record when dispatch fails *before* invocation (bad mapping, workflow not found), where no workflow trace exists |

> The trigger `deliveries` table is **decided, not optional** — it is the dual of
> `webhook_deliveries`, and it is the sole audit/retry surface for dispatches that never
> reach the workflow. (Reasoning in `mapping.md` §4.3.)

A trigger subscription is modeled on a webhook subscription for its **subscribe-to-events
lifecycle** (a project-scoped record naming what to watch, with CRUD + a secret). It does
**not** carry the provider auth — that lives in the shared `gateway_connections` row it
FKs to (A2-2). So:

```text
trigger subscription  =  webhook subscription  (subscribe to an event, /subscriptions CRUD, lifecycle)
                      +  FK → shared connection  (provider auth: ca_*, in the connections domain)
                      +  workflow binding  (net-new — see last section)
```

The connection half is **shared, not bundled** — see [Triggers vs Tools, Part B](#part-b--shareextract-the-provider-connection).

### Part B — the directional mirror (the framing)

```text
outbound webhooks:  Agenta event      ──▶  customer URL      (we sign + POST out)
gateway triggers:   provider event    ──▶  Agenta workflow   (we verify + invoke in)
```

As `webhooks` is to Agenta events, triggers are to provider events — pointed inward and
ending in a workflow.

| | Outbound `webhooks` | Triggers |
|---|---------------------|----------|
| Direction | sender (Agenta → customer) | receiver (Composio → Agenta) |
| HMAC role | we **sign** outgoing | we **verify** incoming |
| Where the "subscription" lives | the Agenta `webhook_subscriptions` row | the Agenta `subscriptions` row **and** a Composio trigger instance it mirrors |
| Deliveries/retries | owned here (`WEBHOOK_MAX_RETRIES = 5`, delivery records) | inbound leg owned by Composio; our dispatch is the new part |
| Destination | an arbitrary customer URL | an Agenta workflow |
| Event source | internal `EventType`s | external provider events |
| Code reuse | **none** — must not route through it | — |

> Despite the shared "subscription" noun and lifecycle, do **not** route trigger ingress
> through the webhooks subscription/delivery machinery, and do not share its tables. They
> are separate domains that happen to be duals — the similarity is a pattern to copy, not
> code to reuse.

---

## Triggers vs Everything (the net-new parts)

These have **no precedent** in tools, billing, or webhooks. They must be designed, and
they deserve the most review.

1. **Trigger ↔ workflow binding.** Storing a workflow ref (workflow +
   revision/environment) on the trigger row and resolving it at dispatch. Nothing in any
   domain binds a provider resource to a workflow.

2. **System-initiated `invoke_workflow`.** The seam exists
   (`WorkflowsService.invoke_workflow`, `core/workflows/service.py:1698`) but has only
   been called from human-initiated, request-scoped paths. A no-human, event-triggered
   invocation is new — what identity it runs as is an open decision (proposal §Risks).

3. **Event → `WorkflowServiceRequest` mapping.** Shaping an arbitrary provider event
   payload into workflow inputs. No existing code maps external JSON into a workflow
   request; the schema-mapping question is non-trivial.

4. **Async dispatch + idempotency.** Billing's handler is effectively synchronous and
   leans on Stripe's dedup. Invoking a workflow inline risks webhook timeouts → provider
   retries → duplicate runs. Ack-fast-then-dispatch + `metadata.id` dedup is new behavior.

5. **One-time project webhook-URL registration with Composio.** Tools never registered an
   *inbound* URL with a provider; Stripe's is configured out-of-band in its dashboard.
   How Composio's is registered (API vs dashboard) and managed per-environment is new
   operational surface.

6. **Connection extraction + cross-domain revoke (A2-2).** Pulling `tool_connections` out
   into a shared `gateway_connections` domain is a migration + repoint of shipped tools
   code (cheap — the table is already domain-neutral, ~4 refs). The genuinely *new
   behavior* is the cross-domain lifecycle rule: revoking a shared `ca_*` affects both
   tools and triggers (lean: revoke-for-everyone + show usage), and deleting a subscription
   must not revoke the connection. No prior domain had a connection with two consumers.

> Rule of thumb by relationship kind:
> - **mimic** (Tools §A events/adapter, Webhooks subscription, Billing ingress) — replicate
>   the named file's structure into a new triggers-domain file and adjust nouns; never
>   import or subclass across the boundary.
> - **share/extract** (Tools §B connection) — move the code into the shared `connections`
>   domain and have both tools and triggers depend on it; the shared service *is* imported
>   by both (that's the point).
> - **net new** (this section) — needs a design decision before code.
