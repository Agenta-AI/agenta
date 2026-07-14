# Gateway Triggers — Gap

The delta between **what exists today** and **what the proposal requires**. Every row is
something that must be built, moved, or decided; the "Source" column names what it is
patterned on (per `mimics.md`), and "Kind" classifies it:

- **extract** — move shipped code into a shared home (the connection only).
- **mimic** — replicate an existing pattern in new triggers-domain files.
- **net-new** — no precedent; needs a design decision before code (per `mimics.md` §
  Triggers vs Everything).
- **decision** — an open question to lock before or during build (from proposal § Risks
  and `mapping.md` § Open questions).

Nothing here changes the outbound `webhooks` domain or the `/tools` HTTP contract — both
are invariants (proposal § Success criteria).

---

## 1. What exists today (the baseline)

| Capability | Where | Reusable as-is? |
|---|---|---|
| Composio **auth** (initiate/status/refresh/revoke) | `ComposioToolsAdapter` (`core/tools/providers/composio/adapter.py`) | Yes — **extract** the auth verbs to the shared connection adapter |
| Connection persistence | `ToolConnectionDBE` / `tool_connections` (`dbs/postgres/tools/dbes.py:38`) | Yes — **rename** to `gateway_connections` (already domain-neutral) |
| Connection CRUD + OAuth callback | `ToolsService` (`core/tools/service.py:138-383`), `/tools/connections/...` + `/callback` (`router.py:785`) | Yes — **extract** to shared service; `/tools/connections` contract frozen |
| Action catalog (providers/integrations/actions) | `core/tools` catalog + `apis/fastapi/tools` | Pattern only — **mimic** for events |
| Composio call surface (httpx `_get/_post/_delete`, slug mapping) | `ComposioToolsAdapter` | Pattern only — **mimic** for the triggers REST surface |
| Two-table subscription/delivery model | `webhooks`: `webhook_subscriptions` + `webhook_deliveries` (`core/webhooks/`, `dbs/postgres/webhooks/`) | Pattern only — **mimic** (separate tables, no reuse) |
| DBA mixins for a subscription/delivery domain | `dbs/postgres/webhooks/dbas.py` | Pattern only — **mimic** (tools has no `dbas.py`) |
| Payload-mapping template + resolver | `payload_fields` + `resolve_payload_fields` (`core/webhooks/delivery.py:95`) → `resolve_json_selector` (`sdk/utils/resolvers.py:114`) | Resolver **reused** (promote + rename); template **mimicked** as `inputs_fields` |
| Inbound, signature-verified provider webhook | billing `POST /billing/stripe/events/` (`ee/.../billing/router.py:106,240`) | Pattern only — **mimic** the ingress shape |
| Workflow dispatch seam | `WorkflowsService.invoke_workflow` (`core/workflows/service.py:1698`) | Reused **as-is** — no new execution path |
| `env.composio` (api_key/api_url/enabled) | `utils/env.py:507`; wiring `entrypoints/routers.py:578` | Reused; **add** `COMPOSIO_WEBHOOK_SECRET` |

> Tools never persisted a per-use record and webhooks never had a provider connection;
> **triggers is the first domain that needs both** a connection *and* a per-event standing
> record — which is why the connection is extracted (shared) and the subscription/delivery
> pair is mimicked (triggers-owned).

---

## 2. The gap, by domain

### 2.1 Shared `connections` domain (extract — A2-2)

The connection moves out of `/tools` into a routerless shared domain.

| # | Item | Kind | Source / note |
|---|---|---|---|
| C1 | `gateway_connections` table — rename `tool_connections` (+ `uq_`/`ix_`), no data transform | extract | `dbes.py:38`; table already domain-neutral |
| C2 | Migration authored **once in the shared `core_oss` chain** (runs in both editions), **not** the parked legacy `core` tree nor EE-only `core_ee` | extract | rename op only; `core` is frozen at `park00000000`; `gateway_connections` is shared schema. See `oss-ee-convergence/migration-chains-and-edition-switch.md` |
| C3 | `core/gateway/connections/` — service + DAO + interface, **no router** | extract | from `ToolsService` connection code (`service.py:138-383`) |
| C4 | `ConnectionsGatewayInterface` + Composio **auth** adapter (initiate/status/refresh/revoke) | extract | from `ComposioToolsAdapter` auth verbs |
| C5 | Repoint tools' connection auth at the shared service; `/tools/connections` contract frozen | extract | ~4 code refs: `dbes.py`, `dao.py:72`, `router.py:160` |
| C6 | `/tools/connections` and `/triggers/connections` both delegate to the one shared service over the same rows | mimic | no `/gateway/connections` route exists |
| C7 | **Cross-domain revoke rule**: revoke-for-everyone + show usage; deleting a subscription must not revoke the connection | net-new / decision | no prior connection had two consumers (`mimics.md` §6) |

### 2.2 `triggers` domain — events catalog + adapter (mimic Tools)

| # | Item | Kind | Source / note |
|---|---|---|---|
| E1 | Domain skeleton `apis/fastapi/triggers/`, `core/triggers/`, `dbs/postgres/triggers/` | mimic | tools layout |
| E2 | `ComposioTriggersAdapter` (own httpx client; `triggers_types`, `trigger_instances/...`) implementing `TriggersGatewayInterface` | mimic | `ComposioToolsAdapter` shape |
| E3 | Events catalog: `/triggers/catalog/.../integrations/{i}/events/{event_key}` returning the event's `trigger_config` schema | mimic | tools action catalog (`action → event`) |
| E4 | Wiring block in `entrypoints/routers.py` next to tools; adapter built only when `env.composio.enabled` | mimic | `routers.py:578` |
| E5 | **Exact Composio v3 REST paths** for trigger types/instances | decision | verify vs live OpenAPI (SDK names stable) |

### 2.3 `triggers` domain — subscriptions + deliveries (mimic Webhooks)

| # | Item | Kind | Source / note |
|---|---|---|---|
| S1 | `subscriptions` table: project-scoped, FlagsDBA (enabled/valid), DataDBA with `ti_*`, `trigger_config`, `inputs_fields`, destination `references`/`selector`, workflow ref; **FK → `gateway_connections`** | mimic | `webhook_subscriptions` (`types.py:116`) |
| S2 | `deliveries` table: one audit row per inbound event — resolved `inputs`, workflow `references`, `result`/`error`; migration defined once in `core_oss` | mimic | `webhook_deliveries` (`types.py:156`) |
| S3 | DBA mixins for both tables | mimic | `dbs/postgres/webhooks/dbas.py` (tools has none) |
| S4 | Subscription CRUD routes `/triggers/subscriptions/` · `/query` · `/{id}` · `/{id}/refresh` · `/{id}/revoke` + create/disable/delete the Composio `ti_*` via the adapter | mimic | `/webhooks/subscriptions/` + adapter calls |
| S5 | Delivery read routes `/triggers/deliveries` · `/{id}` · `/query` | mimic | `/webhooks/deliveries` |

### 2.4 `triggers` domain — ingress (mimic Billing)

| # | Item | Kind | Source / note |
|---|---|---|---|
| I1 | `POST /triggers/composio/events/` — read raw body before parsing | mimic | billing `/stripe/events/` |
| I2 | HMAC-SHA256 verify over `{id}.{ts}.{body}` with `COMPOSIO_WEBHOOK_SECRET`; 401 on bad sig; 200 no-op when secret unset | mimic | billing uses `stripe.Webhook.construct_event`; `research.md` § Webhook verification |
| I3 | Recover `project_id` from `metadata.user_id`; route `metadata.trigger_id` → local subscription; 200-skip unknown/disabled | mimic | billing's payload-scoping; `research.md` §1 |
| I4 | **Idempotency** dedup on `metadata.id` (store: column vs cache) | net-new / decision | billing leans on Stripe; we own it |
| I5 | Optional `target`-style env fan-out guard (one Composio webhook URL → many deployments) | decision | cf. `env.stripe.webhook_target` |
| I6 | **One-time project webhook-URL registration** with Composio (API vs dashboard, per-env) | net-new / decision | no precedent (`research.md` §4.2) |

### 2.5 `triggers` domain — mapping + dispatch (mimic Webhooks resolver + net-new binding)

| # | Item | Kind | Source / note |
|---|---|---|---|
| M1 | Promote `resolve_payload_fields` → `resolve_target_fields` into `agenta.sdk.utils.resolvers`; update the webhooks call site to the new name | mimic / extract | `mapping.md` §5/§6; lands at this point |
| M2 | `inputs_fields` template stored on the subscription; resolves into `WorkflowServiceRequest.data.inputs` **only** | mimic | `mapping.md` §3, §4.2 |
| M3 | `TRIGGER_EVENT_FIELDS` allowlist (event `data`/`type`/`timestamp`/curated `metadata`; never `ca_*`/secrets); context `{event, subscription, scope}` | mimic | `EVENT_CONTEXT_FIELDS` analogue |
| M4 | Destination = workflow `references` (+ `selector`), the `/retrieve` shape; drop into `request.references` at dispatch | mimic | `mapping.md` §4.1; `invoke_workflow` threads it (`service.py:556-557`) |
| M5 | **Trigger ↔ workflow binding** — store + resolve the workflow ref at dispatch | net-new | no domain binds a provider resource to a workflow |
| M6 | **System-initiated `invoke_workflow`** — what identity (`user_id`) a no-human invocation runs as | net-new / decision | seam only ever called request-scoped (`mimics.md` §2) |
| M7 | **Async dispatch** — ack-fast + enqueue vs inline (avoid webhook timeout → retry storm) | net-new / decision | proposal § Risks |
| M8 | **Default mapping** (`"$"` vs stricter) and **schema validation** of `inputs_fields` against the bound workflow's input schema | decision | `mapping.md` §6 |
| M9 | **Dispatch retry policy** for a failed invocation recorded in `deliveries` vs Composio redelivery | decision | `mapping.md` §6 |

### 2.6 Frontend

| # | Item | Kind | Source / note |
|---|---|---|---|
| F1 | "Triggers" surface on a connected integration: events browse, create subscription (pick event + bind workflow + mapping), list/disable/delete | mimic | tools UI (`web/.../gatewayTool`, `web/oss/.../settings/Tools`) |
| F2 | FE expects **overlapping connection reads** across `/tools/connections` and `/triggers/connections` (same rows) | net-new | consequence of A2-2 |
| F3 | Deliveries view (audit log) | mimic | could defer past v1 |

---

## 3. Cross-cutting decisions to lock (consolidated)

These appear above tagged `decision`; collected here because they gate multiple work items
and should be settled (some before code, some during).

| Decision | Gates | Lean / default | Lock by |
|---|---|---|---|
| Exact Composio v3 REST paths (E5) | E2, E3, S4 | verify vs live OpenAPI | before adapter code |
| Project webhook-URL registration (I6) | ingress end-to-end test | manual setup step documented if API-less | before ingress test |
| Cross-domain revoke rule (C7) | C3–C6, F2 | revoke-for-everyone + show usage | before connection extract lands |
| Idempotency store (I4) | I-lane, dispatch | column on `deliveries` (dedup on `metadata.id`) | with deliveries table |
| Sync vs async dispatch (M7) | dispatch lane | async (ack-fast) | before dispatch code |
| System-initiated `user_id` (M6) | dispatch lane | a project-system identity (resolve from project) | before dispatch code |
| Default mapping + validation (M8) | subscription create | inputs-only default; validation = stretch | before subscription activate |
| Dispatch retry policy (M9) | deliveries semantics | bounded retries, else rely on Composio | with dispatch |

---

## 4. Out of scope (restating non-goals so the gap isn't read as larger than it is)

- No merge with / routing through the outbound `webhooks` domain.
- No workflow-hooks involvement.
- No downstream consumer beyond a single `invoke_workflow` per event (no eval/queue/re-emit).
- No new workflow execution path.
- No custom-OAuth ingress registration; managed-auth only.
- No polling fallback we own (Composio normalizes to one webhook).
- No SDK dependency (httpx direct, as tools).
- No EE-only gating beyond what tools already carry.
