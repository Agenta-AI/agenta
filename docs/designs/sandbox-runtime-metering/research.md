# Sandbox Runtime Metering — Research

Grounding for [proposal.md](./proposal.md): how metering, billing, and the agent
sandbox actually work in the tree today. File:line refs are approximate anchors.

## Metering subsystem (EE)

The whole metering subsystem lives in `api/ee/`; OSS only *calls into* it via
`check_entitlements`, guarded by `is_ee()`. There is no "usage event" table —
metering is pre-aggregated counter/gauge rows updated atomically in place.

- **Dimensions today** — `api/ee/src/core/access/entitlements/types.py`:
  `Counter = {EVALUATIONS_RUN, TRACES_INGESTED, TRACES_RETRIEVED, CREDITS_CONSUMED, EVENTS_INGESTED}`,
  `Gauge = {USERS}`. Mirrored to `Meters` in `api/ee/src/core/meters/types.py:23`
  (member **name** binds the DB enum; `Counter` carries the lowercase **value** —
  cross with `Meters[counter.name]`).
- **Table** — `meters` (`api/ee/src/dbs/postgres/meters/{dbes,dbas,dao}.py`). PK
  `meter_id` (deterministic UUIDv5 via `compute_meter_id`), nullable scope
  (`organization_id/workspace_id/project_id/user_id`) and period
  (`year/month/day`), `key meters_type`, `value`, `synced` (last value pushed to
  Stripe).
- **Write/enforce chokepoint** — `check_entitlements(key, delta, cache, scope, period)`
  at `api/ee/src/core/access/entitlements/service.py:272`. Soft mode
  (`cache=True`) = Redis read, never writes; hard mode = atomic upsert
  `INSERT ... ON CONFLICT (meter_id) DO UPDATE SET value = greatest(value+delta,0)
  WHERE <quota predicate> RETURNING value` (`dao.py:376`). Strict predicate:
  `greatest(value+delta,0) <= limit`. **Fails open** on non-`EntitlementsException`.
- **Existing write call-sites** — `TRACES_INGESTED`: soft-check at OTLP edge
  (`api/oss/src/apis/fastapi/otlp/router.py:224`), hard charge per-org in
  `api/oss/src/tasks/asyncio/tracing/worker.py:268`. `EVALUATIONS_RUN`: sync in
  `apis/fastapi/evaluations/router.py` with refund-on-failure.
- **Read** — `/billing/usage` (`api/ee/src/apis/fastapi/billing/router.py` ≈ 932)
  emits one row per plan quota, projected to the caller's scope/period.
- **Adding a counter** — add to `Counter` → mirror in `Meters` → `Quota` per plan
  in `DEFAULT_ENTITLEMENTS` → enum migration (template
  `…/versions/b2c3d4e5f7a8_add_events_ingested_meter.py`) → optional `REPORTS` /
  `CONSTRAINTS` → call `check_entitlements` at the usage site. DAO, reader, and
  `compute_meter_id` are generic and need no change.

## Billing / plans / Stripe (EE)

- **Plans** — `DefaultPlan` (`types.py:6`): hobby / pro / business /
  agenta-internal / self-hosted-enterprise. Grants in `DEFAULT_ENTITLEMENTS`
  (`types.py:332-670`), display in `DEFAULT_CATALOG` (`types.py:189-330`).
  Env-overridable via `AGENTA_ACCESS_PLANS` / `AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY`.
- **`Quota`** (`types.py:90`): `free, limit, strict, retention, scope, period`,
  all optional. `period ∈ {DAILY, MONTHLY, YEARLY}` is the **reset window**, not
  the unit. `scope=None ⇒ organization`.
- **Stripe** — billing router `api/ee/src/apis/fastapi/billing/router.py`
  (webhooks, checkouts, portals, `/usage`, `/catalog`, admin report). Lazy-loaded;
  no-ops without `STRIPE_API_KEY`. Usage push: `MetersService.report()`
  (`api/ee/src/core/meters/service.py:75`) → counters via
  `stripe.billing.MeterEvent.create(delta=value-synced)`, gauges via
  `Subscription.modify`. Reportable set = `REPORTS` dict (`types.py:677`). Price
  IDs from `AGENTA_BILLING_PRICING` (`api/oss/src/utils/env.py:214`), resolved by
  `get_stripe_meter_price()` (`api/ee/src/core/subscriptions/settings.py:453`).
  Cron: `api/ee/src/crons/meters.{sh,txt}` → `POST /admin/billing/usage/report`.
- **Enforcement on exceed** varies by call-site: OSS routers raise `429`; EE
  routers return `NOT_ENTITLED_RESPONSE` (403 + upgrade copy); workers drop the
  batch. Rate limits are a *separate* path — `throttling_middleware`
  (`api/ee/src/middlewares/throttling.py`), token-bucket per `Category`.

## Agent sandbox runtime

Two distinct Daytona systems — **do not conflate**:

| | Code-evaluator (shipped, OSS) | **Agent runner (rivet, target)** |
|---|---|---|
| Runs | user evaluator code | a coding agent over ACP |
| Core | `sdks/python/agenta/sdk/engines/running/runners/daytona.py` | `services/agent/src/engines/rivet.ts` |
| Lifetime | one sandbox per `run()` | one **cold** sandbox per prompt turn |

- **Lifetime bracket (target)** — `runRivet()` (`rivet.ts` ≈ L782): VM lives from
  `SandboxAgent.start()` (≈ L883) to `destroySandbox()` (≈ L1079, in `finally`).
  Includes provisioning + `installPiInSandbox()` warmup (up to ~180s). No pooling,
  no reuse — conversation continuity is by replaying history into a fresh VM. So
  **billable minutes = Σ per-turn lifetimes**.
- **Duration today** — **not captured**. No `elapsed/duration/perf_counter` for
  either sandbox. `AgentUsage` (`services/agent/src/protocol.ts:178`) tracks
  tokens + LLM cost only.
- **Entry point** — agent app `/invoke` & `/messages`
  (`services/oss/src/agent/app.py:76`); `record_usage(result.usage)` (≈ L127)
  stamps `gen_ai.usage.*` on the workflow span via
  `services/oss/src/agent/tracing.py:62`. **This is where a
  `sandbox.runtime_ms` attribute slots in.**
- **Attribution** — only `project_id` (OTel baggage) + credentials reach the
  runner; org/workspace/user are **not** propagated there. ⇒ resolve org at trace
  ingestion (the worker already does) rather than in the runner.
- **Telemetry** — TS runner exports OTel spans OTLP/HTTP to
  `{AGENTA_HOST}/api/otlp/v1/traces` (`services/agent/src/tracing/otel.ts`). No
  separate metrics pipeline — duration is a **span attribute**, not a metric.

## Consequence for the design

Because the runner already feeds the OTLP ingest that charges `TRACES_INGESTED`
per-org in a worker, the runtime-minutes charge piggybacks on that exact path:
stamp `sandbox.runtime_ms` on the root span (B), extend the worker to sum
`ceil(ms/60000)` per org and charge `SANDBOX_RUNTIME_MINUTES` (C'), and soft-gate
at the invocation edge (A). No new attribution or transport.
