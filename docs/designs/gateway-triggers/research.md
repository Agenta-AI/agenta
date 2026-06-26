# Gateway Triggers — Research

Status quo, internal and external, for adding **triggers** (inbound provider events)
to the gateway alongside the existing **tools** (outbound action calls).

---

## 0. Terminology and the shared-connection decision

Three nouns, drawn from existing domains so the whole thing reads familiar:

| Concept | Owner | Tools | Webhooks | Triggers | What it is |
|---------|-------|-------|----------|----------|------------|
| catalog leaf | per-domain | **action** | — | **event** | callable action vs. watchable event |
| provider auth | **shared** `connections` | connection (`ca_*`) | — | connection (`ca_*`) | one per (project, provider, integration), via OAuth |
| standing event watch | triggers | — | subscription | **subscription** (`ti_*` + config + workflow) | many per connection |

Catalog hierarchy maps cleanly:

```text
tools:     providers / integrations / actions
triggers:  providers / integrations / events
```

The created state is two records with **different owners**:

```text
shared:    connection (ca_*)            ← gateway_connections; used by BOTH tools and triggers
triggers:  event (catalog) → subscription (ti_* + trigger_config + workflow)  ← FK → connection
```

**Why connection and subscription are split, and why the connection is shared (A2-2):**

- *Split* — a Composio connected account (`ca_*`) backs many trigger instances (`ti_*`):
  one Gmail auth serves "new message", "new starred", etc. So a **subscription** (one
  standing watch, bound to one workflow) is separate from the **connection** (durable
  auth). Connect once, subscribe many. Tools never persisted the per-use record (a tool
  call is ephemeral); webhooks never had a connection (no provider to authenticate);
  triggers is the first domain needing both.
- *Shared* — `ca_*` is one real account regardless of consumer. Rather than each domain
  owning its own copy, the connection is extracted into a **shared `connections` domain**
  (`gateway_connections` table, renamed from `tool_connections`; service + DAO, **no
  router of its own**), consumed by both tools and triggers. Connect Gmail once → usable
  from both. HTTP surface is per-domain — `/tools/connections` and `/triggers/connections`
  both delegate to the one shared service over the same rows.
  (Decision **A2-2**; rejected alternative **B** — fully separate connections — and full
  reasoning in `proposal.md` § Alternatives and `mimics.md`.)

Composio's own vocabulary ("trigger type", "trigger instance") is kept only when
describing the Composio API itself; in Agenta terms they are an **event** and the
provider-side half of a **subscription**.

---

## 1. External: how Composio triggers work

Composio's [Triggers](https://docs.composio.dev/docs/triggers) are the mirror image of
its tools. Tools are *outbound* — you call a provider action (`GMAIL_SEND_EMAIL`).
Triggers are *inbound* — a provider emits an event (new Slack message, new GitHub
commit, new Gmail message) and Composio delivers it to you.

### Core concepts

| Composio concept | Agenta term | Meaning | Composio ID prefix |
|------------------|-------------|---------|--------------------|
| **Trigger type** | **event** (catalog leaf) | Template defining an event to watch + required config. E.g. `GITHUB_COMMIT_EVENT` needs `owner`, `repo`. Each toolkit exposes its own trigger types. | (slug, e.g. `GITHUB_COMMIT_EVENT`) |
| **Trigger instance** | part of a **subscription** | A trigger type *instantiated* for one user + one connected account, with concrete config. Independently enable/disable/delete. | `ti_*` |
| **Connected account** | part of a **subscription** | The authenticated binding a trigger is scoped to. **A trigger cannot exist without one** — auth comes first. | `ca_*` |

### Two delivery mechanisms (transparent to us)

- **Webhook triggers** (Slack, Notion, Asana, Outlook): provider pushes to a
  Composio-issued ingress URL in real time.
- **Polling triggers** (Gmail, Google Calendar): Composio polls the provider on a
  schedule; with Composio-managed auth the worst-case source→delivery delay is ~15 min.

Either way, Composio normalizes both into one outbound webhook to **our** subscription
URL. We never talk to the provider directly.

### Lifecycle (per the docs)

1. **Subscribe** (once per Composio project): tell Composio the single webhook URL to
   deliver all trigger events to.
2. **Discover**: list trigger types for a toolkit; read each type's required `config`.
3. **Create**: create an active trigger instance scoped to a `user_id` +
   connected account, with `trigger_config`.
4. **Receive**: events arrive at our subscription URL as HTTP POST; route on
   `metadata.trigger_slug`.
5. **Manage**: enable / disable / delete instances.

### SDK / REST surface

The Python SDK (`composio.triggers.*`) wraps a REST surface. From the docs and SDK:

```python
# Discover required config
trigger_type = composio.triggers.get_type("GITHUB_COMMIT_EVENT")
trigger_type.config        # JSON Schema of required trigger_config

# Create an instance (scoped to a user + their connected account)
trigger = composio.triggers.create(
    slug="GITHUB_COMMIT_EVENT",
    user_id="project_019abc...",
    trigger_config={"owner": "composiohq", "repo": "composio"},
)
trigger.trigger_id          # ti_*

# Local-dev only: SDK-managed subscription (websocket), not for prod
subscription = composio.triggers.subscribe()
@subscription.handle(trigger_id="ti_...")
def handler(data): ...
```

REST equivalents (we use `httpx` directly, no SDK — same decision as tools):

| Operation | REST (v3) |
|-----------|-----------|
| List trigger types for a toolkit | `GET /api/v3/triggers_types?toolkit_slugs={slug}` |
| Get one trigger type (config schema) | `GET /api/v3/triggers_types/{slug}` |
| Create / upsert instance | `POST /api/v3/trigger_instances/{slug}/upsert` (`user_id`, `trigger_config`) |
| Enable / disable instance | `PATCH /api/v3/trigger_instances/manage/{trigger_id}` (`status`) |
| Delete instance | `DELETE /api/v3/trigger_instances/manage/{trigger_id}` |
| List instances | `GET /api/v3/trigger_instances` (filter by `user_id`, `toolkit`) |
| Set project webhook URL | project settings / `POST /api/v3/...webhook` (one-time, dashboard or API) |

> Exact paths must be confirmed against the live OpenAPI spec during implementation;
> the SDK method names (`get_type`, `create`, `subscribe`) are stable. This is the
> same "verify against live spec" caveat that landed for the tools endpoints.

### Webhook payload (V3, the default for new orgs)

```json
{
  "type": "github_commit_event",
  "timestamp": "2026-06-18T10:00:00Z",
  "data": { /* provider event payload, trigger-type-specific */ },
  "metadata": {
    "id": "evt_...",
    "trigger_slug": "GITHUB_COMMIT_EVENT",
    "trigger_id": "ti_...",
    "toolkit_slug": "github",
    "user_id": "project_019abc...",
    "connected_account": { "id": "ca_...", "status": "ACTIVE" }
  }
}
```

We route on `metadata.trigger_slug` (which trigger type) and `metadata.trigger_id`
(which instance) → our local trigger record → project scope.
`metadata.user_id` carries our `project_{project_id}` scope verbatim, the same
`user_id` strategy tools already use.

### Webhook verification

Composio signs every webhook with **HMAC-SHA256** (svix-style headers), per
[Verifying webhooks](https://docs.composio.dev/docs/webhook-verification):

- Headers: `webhook-id`, `webhook-timestamp`, `webhook-signature`.
- Signing string: `{webhook-id}.{webhook-timestamp}.{raw-body}`.
- HMAC-SHA256 with the project webhook secret, base64-encoded; compare with
  `hmac.compare_digest`. The `webhook-signature` header may carry a `v1,` prefix.

```python
signing_string = f"{webhook_id}.{webhook_timestamp}.{raw_body}"
expected = base64.b64encode(
    hmac.new(secret.encode(), signing_string.encode(), hashlib.sha256).digest()
).decode()
received = signature.split(",", 1)[1] if "," in signature else signature
ok = hmac.compare_digest(expected, received)
```

Verification needs the **raw request body** (not the parsed JSON), so the ingress
endpoint must read `await request.body()` before parsing.

### Tools vs triggers — the symmetry

| Axis | Tools (built) | Triggers (proposed) |
|------|---------------|---------------------|
| Direction | Outbound (we call provider) | Inbound (provider calls us) |
| Catalog leaf | **action** slug | **event** slug (Composio trigger type) |
| Durable auth record | **connection** (`ca_*`) | **same shared connection** (`gateway_connections`) |
| Per-use record | *(ephemeral tool call)* | **subscription** (`ti_*` + config + workflow), FK → connection |
| Connection routes | `/tools/connections` | `/triggers/connections` (both delegate to the shared service; no `/gateway/connections` route) |
| Per-domain routes | actions, `/call` | events catalog, `/subscriptions`, ingress |
| Config | arguments per call | `trigger_config` per subscription, set once |
| Entry point | `POST /tools/call` | inbound `POST /triggers/composio/events/` |
| HTTP domain | `/tools/*` | independent `/triggers/*` (peer, not nested) |
| Per-event work | synchronous response to caller | invoke the bound Agenta workflow |

The single most important external fact: **a trigger, like a tool, is a Composio
resource scoped to a connected account.** Tools proved that pattern; triggers reuse the
**same** (shared) connected account and add events + subscriptions on top (see the
shared-connection decision A2-2
below).

---

## 2. Internal: how tools are integrated today

The gateway-tools feature is **shipped** (not just designed). Layout follows the
standard domain shape from `api/AGENTS.md`.

### Layers

```text
api/oss/src/apis/fastapi/tools/        router.py · models.py · utils.py
api/oss/src/core/tools/                service.py · interfaces.py · dtos.py
                                       registry.py · exceptions.py · utils.py
api/oss/src/core/tools/providers/composio/   adapter.py · catalog.py · dtos.py
api/oss/src/dbs/postgres/tools/        dbes.py · dao.py · mappings.py
```

Dependency direction (enforced): `Router → Service → DAOInterface + GatewayInterface →
DAO impl + Adapter impl`. Concrete wiring lives only in `api/entrypoints/routers.py`.

### Domain layout — three verticals, shared connections (decision A2-2)

**Decision:** connections are a **gateway-level primitive shared** by tools and triggers;
the trigger-specific state is a peer domain. Three verticals:

1. **`connections` (shared, extracted)** — owns the provider connection `ca_*`: OAuth
   initiate/callback/refresh/revoke and the `gateway_connections` table (renamed from
   `tool_connections`). **No router of its own** — the HTTP surface is `/tools/connections`
   and `/triggers/connections`, both delegating to this shared service over the same rows.
   Code: `core/gateway/connections/`, `dbs/postgres/gateway/connections/` (service + DAO +
   table; no `apis/fastapi/gateway/connections/`).
2. **`triggers` (peer to tools)** — owns events catalog, the `subscriptions` **and**
   `deliveries` tables (a two-table domain mirroring webhooks' `webhook_subscriptions` +
   `webhook_deliveries`), ingress, and dispatch. Depends on the shared `connections`
   service for auth and on `WorkflowsService` for dispatch.
3. **`tools` (existing)** — unchanged HTTP contract; connection auth repointed at the
   shared `connections` service.

`/tools` remains the structural blueprint for the trigger-specific code (copy structure,
swap nouns `action → event`); the connections code is *extracted and shared*, not copied.
(Rejected alternative B — fully separate `trigger_connections` — and why, in
[`proposal.md` § Alternatives].)

What each part is modeled on:

- **Shared connections** — evolve the existing tool-connection code in place:
  `ToolConnectionDBE` / `tool_connections` (`dbs/postgres/tools/dbes.py`) becomes the
  `gateway_connections` DBE in the connections domain (already domain-neutral — no
  `tool_`-specific columns). The Composio **auth** adapter (`initiate_connection`,
  `get_connection_status`, `refresh_connection`, `revoke_connection` from
  `ComposioToolsAdapter`) moves to a `ConnectionsGatewayInterface` in the connections
  domain. Tools and triggers both consume it.
- **Triggers adapter** — a **new** `ComposioTriggersAdapter` (own httpx client,
  modeled on `ComposioToolsAdapter`'s `_get/_post/_delete` + slug mapping) implementing a
  `TriggersGatewayInterface` for the trigger REST surface (`triggers_types`,
  `trigger_instances/...`). Helpers may be copied or promoted to a shared util.
- **`subscriptions` table** — modeled on `WebhookSubscription` / `webhook_subscriptions`
  (`core/webhooks/types.py:116`): project-scoped, FlagsDBA (enabled/valid), carrying the
  trigger instance (`ti_*`), the mapping (`inputs_fields`), the destination
  (`references`/`selector`), and a FK → `gateway_connections`. Many per connection.
- **`deliveries` table** — modeled on `WebhookDelivery` / `webhook_deliveries`
  (`core/webhooks/types.py:156`): one audit row per inbound event dispatched, carrying the
  resolved `inputs`, the workflow `references`, and `result`/`error`. The audit + retry
  surface — and the only record when dispatch fails before invocation. (See `mapping.md`
  §4.3.)
- **Events catalog** — model on the tools catalog; leaf is **events**:
  `/triggers/catalog/providers/{p}/integrations/{i}/events/{event_key}`, returning the
  event's `trigger_config` JSON Schema (analogue of an action's `input_parameters`).
- **Service / router / DAO** — `TriggersService` (event-catalog browse, subscription CRUD,
  ingress, dispatch) models on `ToolsService` + `WebhooksRouter`'s `/subscriptions/...`
  shape; depends on its own DAO + triggers adapter + the shared connections service +
  `WorkflowsService`.
- **Env** — `env.composio` (`api_key`, `api_url`) read directly; add
  `COMPOSIO_WEBHOOK_SECRET`.

Route map:

| Surface | Route | Patterned on |
|---------|-------|--------------|
| connections (triggers view) | `/triggers/connections/` · `/query` · `/{id}` · `/{id}/refresh` · `/{id}/revoke` · `/callback` | tools connections (shared service) |
| connections (tools view) | `/tools/connections/...` | same shared service + rows |
| events catalog | `/triggers/catalog/.../integrations/{i}/events/{event_key}` | tools catalog |
| subscriptions | `/triggers/subscriptions/` · `/query` · `/{id}` · `/{id}/test` | webhook subscriptions |
| deliveries | `/triggers/deliveries` · `/{id}` · `/query` | webhook deliveries |
| ingress | `/triggers/composio/events/` | billing `/stripe/events/` |

(There is **no** `/gateway/connections` route — the shared `connections` domain has no
router; the two views above are its only HTTP surfaces.)

> Firm decisions: connections is a shared gateway primitive (`gateway_connections`, A2-2);
> `/triggers` is a peer domain owning subscriptions + dispatch; the sanctioned cross-domain
> runtime calls are triggers → connections service (auth) and triggers →
> `WorkflowsService.invoke_workflow` (dispatch).

> **Consequence — cross-domain revoke.** Because `ca_*` is shared, revoking it affects
> both tools actions and trigger subscriptions on it. Lean: revoke-for-everyone + show
> usage; deleting a subscription must not revoke the connection. Connect once, used
> everywhere — the inverse of the connect-twice cost that rejected option B carried.

### The workflow dispatch seam

Dispatch invokes the existing
`WorkflowsService.invoke_workflow(*, project_id, user_id, request: WorkflowServiceRequest)`
(`core/workflows/service.py:1698`). It signs a secret token from the project's
workspace/org, resolves the workflow's service URL from the bound revision, and calls it.
Triggers build a `WorkflowServiceRequest` from the verified event and call this — no new
execution path. The open question is the **event → `WorkflowServiceRequest` mapping** and
what `user_id` a system-initiated (no-human) invocation runs as.

### The OAuth callback is the closest existing analogue to a webhook ingress

`GET /tools/connections/callback` (`router.py:785`) already implements the inbound
pattern we need for trigger ingress:

- Server-owned callback URL with an **HMAC-signed `state` token** (`make_oauth_state` /
  `decode_oauth_state`, keyed on `env.agenta.crypt_key`) that recovers `project_id`
  without trusting the caller.
- Looks up the local connection by provider-side ID
  (`activate_connection_by_provider_connection_id`) and mutates local state.
- Returns a controlled response.

Trigger ingress is the same shape: verify a signature, recover project scope from the
payload's `user_id`/`trigger_id`, look up the local record, then act.

### The Stripe webhook is the direct precedent for the ingress route shape

Billing already has a provider-namespaced, signature-verified inbound webhook at
**`POST /billing/stripe/events/`** (`api/ee/src/apis/fastapi/billing/router.py:106`). It
reads the raw request body and verifies the provider signature via
`stripe.Webhook.construct_event(payload, sig, env.stripe.webhook_secret)`. This sets the
house convention for inbound provider events: `{domain}/{provider}/events/`. Trigger
ingress should follow it as **`/triggers/composio/events/`** (Composio HMAC-SHA256 in
place of Stripe's verifier, keyed on `COMPOSIO_WEBHOOK_SECRET`). Provider-namespacing
also leaves room for a second trigger provider at `/triggers/{provider}/events/`.

### Connection scoping / `user_id` strategy

`user_id = str(project_id)` is passed to Composio as the connected-account scope
(`service.py:230`). Every connection and therefore every trigger is implicitly
project-scoped. The webhook `metadata.user_id` echoes this back, so ingress can map an
inbound event to a project with no extra lookup table.

### Config & wiring

- `env.composio` (`utils/env.py:507`): `api_key`, `api_url`, `enabled` (key present).
- Wiring (`entrypoints/routers.py:578`): adapter built only when `env.composio.enabled`,
  registered under key `composio`, injected into `ToolsService`, mounted via
  `ToolsRouter`. Triggers slot into the same three spots.

### Frontend

Tools UI lives in `web/packages/agenta-entities/src/gatewayTool`,
`web/packages/agenta-entity-ui/src/gatewayTool`, and
`web/oss/src/components/pages/settings/Tools`. Catalog browse, connect (OAuth popup +
poll), list/delete connections. Triggers extend these surfaces (a "Triggers" tab on a
connected integration).

---

## 3. Internal: the existing **outbound** webhooks domain (do not confuse)

There is already a `webhooks` domain
(`api/oss/src/core/webhooks/`, `apis/fastapi/webhooks/`). It is **outbound**: Agenta
emits internal `EventType`s (e.g. `TRACES_QUERIED`) to subscriber-registered URLs, with
subscriptions, deliveries, retries (`WEBHOOK_MAX_RETRIES = 5`), and HMAC signing on the
*sending* side.

This is the inverse of triggers:

- **webhooks domain** = Agenta → outside world (we sign and send).
- **gateway triggers** = outside world (via Composio) → Agenta (we verify and receive).

They are complementary and should **stay separate domains**. But there is a real
integration point: an inbound Composio trigger can be re-emitted as an internal Agenta
event, which the existing webhooks domain then fans out to customer subscribers. That
keeps "deliver events to customers" in one place and avoids a second outbound delivery
engine. See `proposal.md` for whether v1 includes that bridge.

---

## 4. Open external unknowns to verify during implementation

1. **Exact v3 REST paths** for trigger types / instances (`triggers_types`,
   `trigger_instances/{slug}/upsert`, `.../manage/{id}`). SDK names are stable; REST
   paths must be confirmed against the live OpenAPI spec — same caveat the tools
   endpoints carried.
2. **How the project webhook URL is registered** — dashboard-only vs API. Determines
   whether we can automate it per-environment or document a manual setup step.
3. **One webhook URL per Composio project** — all trigger events for all
   projects/integrations arrive at a single ingress. Fan-out/routing is entirely on us
   (route by `metadata.trigger_id` → local record).
4. **Retry / redelivery semantics** from Composio on a non-2xx from our ingress
   (affects idempotency requirements — we must dedup on `metadata.id`).
5. **Custom-OAuth toolkits** may require registering the Composio ingress URL on the
   provider's own OAuth app (noted in the Composio docs). Out of scope for managed-auth
   v1 but flagged.

## Sources

- [Triggers | Composio](https://docs.composio.dev/docs/triggers)
- [Using Triggers | Composio](https://docs.composio.dev/docs/using-triggers)
- [Creating triggers | Composio](https://docs.composio.dev/docs/setting-up-triggers/creating-triggers)
- [Verifying webhooks | Composio](https://docs.composio.dev/docs/webhook-verification)
- [Triggers — TypeScript SDK reference | Composio](https://docs.composio.dev/sdk-reference/type-script/models/triggers)
- [Create or update a trigger | Composio API](https://docs.composio.dev/reference/api-reference/triggers/postTriggerInstancesBySlugUpsert)
- Internal: `api/oss/src/core/tools/`, `api/oss/src/apis/fastapi/tools/router.py`,
  `api/oss/src/dbs/postgres/tools/`, `api/oss/src/core/webhooks/`,
  `vibes/docs/designs/gateway-tools/`
