# Sandbox Runtime Metering — Research

Grounding for [proposal.md](./proposal.md): how metering, billing, and the agent
sandbox actually work today, plus what Daytona's API does and does not expose.
File:line refs are approximate anchors.

## Metering subsystem (EE)

The whole metering subsystem lives in `api/ee/`; OSS only *calls into* it via
`check_entitlements`, guarded by `is_ee()`. There is no "usage event" table —
metering is pre-aggregated counter/gauge rows updated atomically in place.

- **Dimensions today** — `api/ee/src/core/access/entitlements/types.py`:
  `Counter = {EVALUATIONS_RUN, TRACES_INGESTED, TRACES_RETRIEVED, CREDITS_CONSUMED, EVENTS_INGESTED}`,
  `Gauge = {USERS}`. Mirrored to `Meters` in `api/ee/src/core/meters/types.py:23`
  (member **name** binds the DB enum; `Counter` carries the lowercase **value** —
  cross with `Meters[counter.name]`).
- **Scope** — `Scope` enum (`types.py:83`): `ORGANIZATION | PROJECT | USER`. There
  is **no `AGENT` scope** today; per-agent budgets are a future addition. `Quota`
  with `scope=None` defaults to organization.
- **Table** — `meters` (`api/ee/src/dbs/postgres/meters/{dbes,dbas,dao}.py`). PK
  `meter_id` (deterministic UUIDv5 via `compute_meter_id`), nullable scope
  (`organization_id/workspace_id/project_id/user_id`) and period (`year/month/day`),
  `key meters_type`, `value`, `synced` (last value pushed to Stripe). A
  project-scoped row still carries `organization_id`, so Stripe billing can roll up
  per org.
- **Write/enforce chokepoint** — `check_entitlements(key, delta, cache, scope, period)`
  at `api/ee/src/core/access/entitlements/service.py:272`. Soft mode (`cache=True`)
  = Redis read, **never writes** (`service.py:276`) — this is the pre-run *gate*.
  Hard mode = atomic upsert
  `INSERT ... ON CONFLICT (meter_id) DO UPDATE SET value = greatest(value+delta,0)
  WHERE <quota predicate> RETURNING value` (`dao.py:376`). Strict predicate:
  `greatest(value+delta,0) <= limit`. **Fails open** on non-`EntitlementsException`.
- **Existing write call-sites** — `TRACES_INGESTED`: soft-check at OTLP edge
  (`api/oss/.../otlp/router.py:224`), hard charge per-org in the tracing worker
  (`api/oss/.../tracing/worker.py:268`). `EVALUATIONS_RUN`: sync in
  `apis/fastapi/evaluations/router.py` with refund-on-failure. These show both the
  soft-gate-then-hard-charge shape and per-scope charging from a background job.
- **Read** — `/billing/usage` (`api/ee/.../billing/router.py` ≈ 932) emits one row
  per plan quota, projected to the caller's scope/period.
- **Adding a counter** — add to `Counter` → mirror in `Meters` → `Quota` per plan in
  `DEFAULT_ENTITLEMENTS` → enum migration (template
  `…/versions/b2c3d4e5f7a8_add_events_ingested_meter.py`) → optional `REPORTS` /
  `CONSTRAINTS` → call `check_entitlements` at the usage site. DAO, reader, and
  `compute_meter_id` are generic and need no change.

## Billing / plans / Stripe + the report cron (EE)

- **Plans** — `DefaultPlan` (`types.py:6`): hobby / pro / business / agenta-internal
  / self-hosted-enterprise. Grants in `DEFAULT_ENTITLEMENTS` (`types.py:332-670`),
  display in `DEFAULT_CATALOG` (`types.py:189-330`). Env-overridable via
  `AGENTA_ACCESS_PLANS` / `AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY`.
- **`Quota`** (`types.py:90`): `free, limit, strict, retention, scope, period`, all
  optional. `period ∈ {DAILY, MONTHLY, YEARLY}` is the **reset window**, not the
  unit. `scope=None ⇒ organization`.
- **Stripe push** — `MetersService.report()` (`api/ee/src/core/meters/service.py:75`):
  `dump()` selects rows where `synced != value`, batched; for each meter whose key is
  in `REPORTS`, counters → `stripe.billing.MeterEvent.create(delta = value - synced,
  customer_id, identifier=…)` (Stripe dedupes by identifier), gauges →
  `Subscription.modify`; then `bump()` sets `synced = value`. Reportable set =
  `REPORTS` dict (`types.py:677`). Price IDs from `AGENTA_BILLING_PRICING`
  (`api/oss/src/utils/env.py:214`), resolved by `get_stripe_meter_price()`
  (`api/ee/.../subscriptions/settings.py:453`).
- **The report cron is a push/sync job, not a pull.** `api/ee/src/crons/meters.txt`
  runs `meters.sh` at `:15` and `:45` (every 30 min). `meters.sh` is a thin wrapper:
  one `curl -X POST http://api:8000/admin/billing/usage/report` with
  `Authorization: Access ${AGENTA_AUTH_KEY}` (admin key), 15-min timeout. The
  endpoint (`billing/router.py:1051`, schema-hidden `/admin/billing`) takes a Redis
  lock (`namespace="meters:report"`, ~1h TTL; `/usage/report/unlock` force-releases)
  then calls `report()`. It reads the **local `meters` table** and flushes deltas
  **out to Stripe** — it never pulls usage from anywhere. Siblings `events.sh`,
  `spans.sh` follow the identical pattern; a new metering/reconcile cron would too.
- **Enforcement on exceed** varies by call-site: OSS routers raise `429`; EE routers
  return `NOT_ENTITLED_RESPONSE` (403 + upgrade copy); workers drop the batch. Rate
  limits are a *separate* path — `throttling_middleware`
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
  **billable minutes = Σ per-turn lifetimes**, and the runner is the only component
  that observes a complete lifetime.
- **Duration today** — **not captured**. No `elapsed/duration/perf_counter` for
  either sandbox. `AgentUsage` (`services/agent/src/protocol.ts:178`) tracks tokens
  + LLM cost only.
- **Entry point** — agent app `/invoke` & `/messages`
  (`services/oss/src/agent/app.py:76`); `record_usage(result.usage)` (≈ L127) stamps
  `gen_ai.usage.*` on the workflow span via `services/oss/src/agent/tracing.py:62`.
- **Attribution** — only `project_id` (OTel baggage) + credentials reach the runner;
  org/workspace/user are **not** propagated there. The EE invocation edge, however,
  has org+project+user resolved — which is where the gate and the `run_id → scope`
  record live.
- **Telemetry** — the TS runner exports OTel spans OTLP/HTTP to
  `{AGENTA_HOST}/api/otlp/v1/traces` (`services/agent/src/tracing/otel.ts`). Usable
  as a *fallback* duration channel (span attribute) but customer-influenceable on
  that ingest, so not the billing source of record.

## Daytona API reality

Findings verified against Daytona's official docs and SDK references (June 2026).
**Bottom line: you cannot pull per-sandbox runtime or cost from Daytona via API
today.** Build metering around the runner; use labels for audit only.

- **No per-sandbox usage/cost API.** CPU-seconds, RAM GB-seconds, disk GB-seconds,
  and total price exist **only in the dashboard "Spending" view** — no REST endpoint
  or SDK method exports them. ([Billing](https://www.daytona.io/docs/en/billing/))
- **`GET /organizations/:id/usage` is the wrong data and unreachable from a cron.**
  Returns live quota-vs-allocation snapshots (cores/GB in use now), org/region
  scoped — no cost, no time-integration, never per-sandbox. Currently **JWT-only
  (~1h expiry), not API-key callable**; API-key support + a `READ_ORGANIZATION_USAGE`
  permission is an **open, unimplemented request**
  ([daytonaio/daytona#4643](https://github.com/daytonaio/daytona/issues/4643)).
- **Billing lag up to 48h**, documented.
- **Lifecycle data that *does* exist** (on `list()`/`get()`, the metering-viable
  path, but see caveats): `id` (stable, unique, the idempotency key), `labels`,
  `createdAt`, `updatedAt`, `lastActivityAt`, `state`
  (`Started/Stopped/Archived/Deleted/…`), and auto-lifecycle fields
  `autoStopInterval` (default 15 min), `autoArchiveInterval` (default 7 days),
  `autoDeleteInterval` (default never). **No `startedAt`/`stoppedAt`** — exact
  runtime would require tracking state transitions yourself.
  ([TS Sandbox object](https://www.daytona.io/docs/en/typescript-sdk/sandbox/),
  [Sandboxes](https://www.daytona.io/docs/en/sandboxes/))
- **Why list-polling still fails for us:** our sandboxes are ephemeral (created and
  destroyed inside one run, seconds–minutes), so a periodic cron finds them already
  deleted, and **deleted-sandbox retention in `list` is undocumented**. Snapshot
  final state before delete if you ever rely on it.
- **Labels** — field `labels: Record<string,string>`; settable at creation
  (`CreateSandboxFromSnapshotParams`/`...BaseParams`), updatable later (set
  **replaces** the full set), filterable in `list({ labels: {…} })`. Count/length/
  charset constraints undocumented. ([TS Daytona class](https://www.daytona.io/docs/en/typescript-sdk/daytona/),
  [Python Daytona class](https://www.daytona.io/docs/python-sdk/sync/daytona/))
- **Auth** — API key as `Authorization: Bearer <KEY>` + `X-Daytona-Organization-ID`;
  keys are org-scoped with granular permissions (sandbox create/delete, etc.). No
  "read usage" permission exists. SDK sandbox ops (create/list/get/stop/delete) work
  with an API key. ([API Keys](https://www.daytona.io/docs/en/api-keys/))
- **SDKs** — Python `daytona` (formerly `daytona_sdk`), TS `@daytonaio/sdk`:
  `create(params, labels=…)`, `list(query with labels filter)`, `get(id_or_name)`,
  `start/stop/delete`. **No usage-related SDK methods.**

## Consequence for the design

- **Measurement source = the runner** (only component that observes the full
  ephemeral lifetime; Daytona exposes no usable per-sandbox usage/cost API).
- **Attribution + gate = the entitlements layer** — soft `check_entitlements`
  (`cache=True`) at the cached auth/invocation edge (the *gate*), `run_id → scope`
  recorded there, hard `check_entitlements(delta=minutes)` from a **trusted post-run
  report** keyed/idempotent on `sandbox_id`, attributed from the recorded scope
  (never the report payload).
- **Default scope = PROJECT** (the configurable "resource"); USER available today,
  AGENT is phase 2.
- **Daytona labels = audit/reconciliation/leak-detection only**, never the billing
  source. A reconciliation cron can `list()` non-deleted sandboxes by label to catch
  orphans and sanity-check the 48h-lagged dashboard. If #4643 ships an API-key usage
  endpoint, this can become a true correction step.
- **Stripe** = the existing report cron flushes the new counter once it is in
  `REPORTS`; project-scoped rows roll up per org via `organization_id`.
