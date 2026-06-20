# Sandbox Runtime Metering — Design Proposal

Meter the wall-clock minutes an agent-runner **sandbox** (Daytona VM) is alive,
model it as a **configurable, scoped resource** that callers must be entitled to
consume, **gate** each run against that resource before it starts, and **bill**
the consumed minutes to Stripe.

We pay Daytona per-minute of ephemeral VM lifetime. Today that cost never reaches
the pricing surface: no meter, no per-plan limit, nothing reported to Stripe.
This design closes that gap and, in doing so, lays the first rail for a general
"limit usage per project / agent / user" capability.

> Status: proposal. Builds on the `extend-meters` work
> ([../extend-meters/proposal.md](../extend-meters/proposal.md)), which reshaped
> `meters` around a deterministic `meter_id` with flexible scope/period and made
> "add a billable counter" a well-worn path.

## The resource model (the frame)

Think of a **resource** as a named, configurable **entitlement with a quota**,
attached to a scope. A request declares which resource it is about to consume;
the system checks — at the same cached point where it already checks
authentication — whether the caller is *entitled to run*, and only then proceeds.
After the work runs, the consumed amount is booked against that resource.

This is not a new subsystem: it is exactly what the EE **entitlements** layer
already does (`check_entitlements`, `Quota`, `Scope`, `meters`). We are giving it
one new dimension (sandbox runtime minutes) and using it the way it was built to
be used — as a budget you check before acting and debit after.

**Scope ladder.** The entitlement `Scope` today is `ORGANIZATION | PROJECT | USER`.
We ship the resource **project-scoped by default** — every run in a project draws
from that project's runtime budget — because that matches "a team has a sandbox
budget." The same key can later be instanced at:

- **USER** scope ("this user can't spend more than X") — available today, no new code.
- **AGENT** scope ("this agent can't spend more than X") — a *future* rung; needs a
  new `Scope.AGENT` and a way for the request to name which resource instance it
  draws from. Explicitly phase 2.

Org-wide budgets remain expressible (`Scope.ORGANIZATION`) for customers who want a
single cap. The point is that the *grain is configuration*, not a rewrite — start
with one project-scoped resource, grow into per-agent / per-user / multi-resource
without touching the metering core.

## Why measurement comes from the runner, not from Daytona

The tempting design is "tag sandboxes, let a cron pull usage from Daytona, never
touch the run path." We verified Daytona's API against this and it does **not**
hold for our workload (sources in [research.md](./research.md#daytona-api-reality)):

- **No per-sandbox usage/cost API.** CPU-seconds, GB-seconds, disk, and price exist
  **only in the Daytona dashboard "Spending" view**. No REST endpoint or SDK method
  exports them.
- **The one `/organizations/:id/usage` endpoint is the wrong data and unreachable.**
  It returns live *quota-vs-allocation snapshots* (cores/GB in use now), org/region
  scoped — no cost, no time-integration, never per-sandbox. It also currently
  requires an interactive **JWT, not an API key** (open request:
  daytonaio/daytona#4643), so a server cron can't call it cleanly.
- **Up to 48h billing lag**, documented.
- **Our sandboxes are ephemeral.** The rivet runner creates a **cold sandbox per
  prompt turn** and destroys it in a `finally` — lifetime is seconds to a few
  minutes, entirely inside one run. A periodic `list()` cron would find them
  already deleted (and deleted-sandbox retention in `list` is undocumented). The
  sandbox object also has **no `startedAt`/`stoppedAt`** — only `createdAt` /
  `lastActivityAt` / `state` — so even catching a live one wouldn't give an exact
  billable lifetime.

The runner, by contrast, already brackets the *exact* billable window
(`start()` → `destroy()`) for free. So **the runner is the measurement source**,
and Daytona **labels** are repurposed for what they *can* do reliably:
attribution-audit, orphan/leak detection, and a manual cross-check against the
48h-lagged dashboard. Labels are not the billing path.

## Data flow

```
                       (A) GATE — soft check_entitlements(resource, cache=True),
                            folded into the cached /access/permissions check;
                            429 if the project is already over its minute budget
                                  │ records  run → resolved scope
client ─▶ api gateway ─▶ agent invocation (EE) ───────────────┐
                                  │                            ▼
                                  ▼                      (run record / Redis stash)
                            agent service ─▶ rivet runner ─▶ Daytona VM
                                  │              │   labels: org / project / [agent,user]
                                  │              │   (B) MEASURE: t0 before start()…
                                  │              ▼        destroy() in finally
                                  │        runtimeMs ⇒ ceil → minutes
                                  ▼
   (C) ACCOUNT — trusted report (run_id, sandbox_id, minutes)
        ─▶ internal metering endpoint (api, EE), authed as the agent service
           (NOT the admin key); idempotent on sandbox_id
        ─▶ join run_id → recorded scope  (attribution from the run record,
           never from the report payload — a report can only attach minutes
           to a run the auth layer already scoped)
        ─▶ check_entitlements(resource, delta=minutes)   ← books the meter
                                  │
                                  ▼
        meters table ─▶ report cron ─▶ Stripe MeterEvent (billing, per org)
                     └▶ /billing/usage (display + the cached value the gate reads)

   Daytona labels ─▶ reconciliation cron (AUDIT ONLY): list non-deleted sandboxes
        by label, flag orphans/leaks, sanity-check against the dashboard.
        Not a billing source — usage/cost is dashboard-only and 48h-lagged.
```

Three insertion points — **(A)** gate, **(B)** measure, **(C)** account — plus a
non-billing reconciliation cron. Everything else is registry/config.

## Naming

Dimension slug: **`sandbox_runtime_minutes`** (enum `SANDBOX_RUNTIME_MINUTES`).
Provider-neutral on purpose — it measures *sandbox wall-time we pay for*, not
"Daytona" — so swapping providers or adding the legacy evaluator sandbox later
reuses the same resource. Rounding policy (per-run `ceil` to whole minutes) is
applied **once**, at the accounting step, so it lives in exactly one place.

## (A) Gate — folded into the cached auth check

Your "the service calls me before doing the thing" is a **soft entitlement check**
at the point that already runs on every invocation. `check_entitlements` already
supports this exact mode — `cache=True` is a "Redis-cached read, never writes"
soft-check (`api/ee/.../entitlements/service.py:272`, the same pattern the OTLP
edge uses at `api/oss/.../otlp/router.py:224`):

```python
allowed, _, _ = await check_entitlements(
    key=Counter.SANDBOX_RUNTIME_MINUTES,
    delta=0,                # read-only: "are we already at/over budget?"
    cache=True,             # Redis-cached, never writes; fails open
    scope=scope_from(project_id=project_id),   # project-scoped resource (default)
)
if not allowed:
    raise HTTPException(429, "Agent runtime minutes quota reached for this period.")
```

This extends the cached permissions/auth resolution from "are you authenticated?"
to "are you authenticated **and** entitled to run this?" It is a cheap Redis read
on the hot path and **fails open**. Because consumption is booked post-run
(below), the gate reads the *last-booked* value — see "Limit semantics".

At the same point, record **`run_id → resolved scope`** (org/project/[user]) so the
post-run report can be attributed without trusting the report payload. The run
already has a server-side record; stashing the scope there (or in a short-TTL Redis
key) is the join target for (C). *(Exact join key + store — run record vs Redis —
is an implementation detail to finalize; see tasks.)*

## (B) Measure — agent runner

`services/agent/src/engines/rivet.ts::runRivet()` already brackets the exact
billable VM lifetime:

- `t0 = performance.now()` immediately before `SandboxAgent.start()` (≈ L883).
- in the `finally`, after `destroySandbox()` (≈ L1079):
  `runtimeMs = Math.round(performance.now() - t0)`.

This intentionally includes provisioning **and** the `npm install` warmup (up to
~180s) — that VM time is real Daytona spend and must be billed. At sandbox
creation, also set **`labels`** = `{ org, project, [agent, user], run_id }`
(`labels` is a create-param, `Record<string,string>`; see research) so the
reconciliation cron can attribute and detect leaks.

## (C) Account — trusted report joined to the recorded scope

The runner reports the measured minutes out-of-band to an **internal metering
endpoint** in `api/` (EE), authenticated as the **agent service's existing
credential** — *not* the admin `AGENTA_AUTH_KEY`. The report carries
`(run_id, sandbox_id, minutes)` and **never names a tenant**:

```python
# internal endpoint, EE
scope = load_scope_for_run(run_id)        # from the run record stashed at the gate
minutes = ceil_minutes(report.runtime_ms) # per-run ceil, applied here, once
await check_entitlements(
    key=Counter.SANDBOX_RUNTIME_MINUTES,
    delta=minutes,
    scope=scope,                          # attribution from the run record
    idempotency_key=report.sandbox_id,    # at-least-once safe; one charge per sandbox
)
```

Why this shape:

- **No new secret, no god-key.** It reuses the credential the agent service
  already holds. The admin key never leaves the cron host.
- **Not spoofable into cross-tenant billing.** Attribution comes from the
  server-side run record, not the request body. A compromised reporter could only
  mis-state minutes for runs that already exist and are already scoped — bounded
  blast radius — and can never bill a different tenant. This is the property the
  customer-emitted OTLP-span approach lacked.
- **Idempotent.** Keyed on `sandbox_id` (stable, unique, returned by Daytona), so
  retries/at-least-once delivery never double-charge. Multi-turn sessions create
  one sandbox per turn ⇒ one charge per turn, naturally.

`check_entitlements` is the single chokepoint that records usage and enforces quota
in one atomic upsert (`dao.py:376`), and **fails open** — a metering hiccup never
blocks a run.

> **Lighter alternative (rejected as primary).** The runner already exports OTel
> spans to `/api/otlp/v1/traces`; we could stamp `sandbox.runtime_ms` on the root
> span and sum it in the tracing worker. It is simpler, but spans on that ingest
> are customer-influenceable, so it is spoofable to *under-bill* and is lossy on
> dropped traces. Acceptable for a v0 internal rollout; not the billing source of
> record. Kept here as a fallback, not the plan.

## Limit semantics (state this plainly)

Minutes are only known **after** a run, so this is a **post-paid** meter with a
**soft, slightly-lagged** gate:

- A run already in flight always finishes and is billed.
- The gate reads the last-booked value, so a project can cross its budget on one
  run before the *next* run is blocked. `strict` quota keeps the overshoot to a
  single run's worth.

This is a **budget guardrail, not a hard real-time cap** — the right model for
spend control, and consistent with how cloud usage billing behaves. Do not design
UX that promises a hard cutoff at exactly N minutes.

## Config — registry changes (EE)

All in `api/ee/src/core/access/entitlements/types.py` unless noted:

1. **`Counter`**: add `SANDBOX_RUNTIME_MINUTES = "sandbox_runtime_minutes"`.
2. **`Meters`** (`api/ee/src/core/meters/types.py`): mirror
   `SANDBOX_RUNTIME_MINUTES = Counter.SANDBOX_RUNTIME_MINUTES.value` (required —
   DAO/cache cross-reference by name).
3. **`DEFAULT_ENTITLEMENTS`** — add a `Quota` under `Tracker.COUNTERS` for every
   plan, **`scope=Scope.PROJECT`** (the default resource grain), `period=Period.MONTHLY`,
   `strict=True`:
   - Hobby: a real cap (the cost-control plan).
   - Pro/Business: included allotment, optionally uncapped with overage billed.
   - Enterprise/Agenta-internal: unlimited.

   `period=Period.MONTHLY` is the **reset window**, not the unit; the quantity is
   minutes. Project-scoped rows still carry `organization_id`, so Stripe billing
   still aggregates per org (below).
4. **`CONSTRAINTS[Constraint.READ_ONLY][Tracker.COUNTERS]`**: include the new
   counter so a blocked/over project can't keep burning sandbox time.
5. **`REPORTS`**: add
   `Counter.SANDBOX_RUNTIME_MINUTES.value: "sandbox_runtime_minutes"` (internal slug
   → Stripe meter slot). Membership here *is* "is billed to Stripe".
6. **`DEFAULT_CATALOG`** (display): a feature/price line so the pricing modal shows
   allotment + overage.

## Billing — Stripe

The report cron (`api/ee/src/crons/meters.sh` → `POST /admin/billing/usage/report`
→ `MetersService.report()` at `api/ee/src/core/meters/service.py:75`) already pages
unsynced meter rows and, for any counter in `REPORTS`, calls
`stripe.billing.MeterEvent.create(event_name="sandbox_runtime_minutes",
payload={delta = value - synced, customer_id=<org's customer>}, identifier=...)`
with deterministic idempotency. Because every row carries `organization_id`,
project-scoped rows roll up to the org's Stripe customer automatically. Once the
slug is in `REPORTS`, reporting is automatic.

Two non-code steps + one config:

- Create a Stripe **Meter** `sandbox_runtime_minutes`.
- Create a usage-based **Price** per plan bound to it (N minutes included, $X/min
  overage).
- Add the price slot to `AGENTA_BILLING_PRICING` (`api/oss/src/utils/env.py:214`);
  `get_stripe_meter_price()` (`api/ee/.../subscriptions/settings.py:453`) resolves
  it per plan.

## Reconciliation cron (audit only — new, optional)

A sibling of `meters.sh` (e.g. `daytona_reconcile.sh` → internal endpoint, Redis
lock, same shape) that does **not** bill. It uses the Daytona SDK with the existing
API key to `list()` non-deleted sandboxes filtered by our `labels`, and:

- flags **orphans/leaks** — sandboxes alive longer than a turn should be (a runner
  crash that skipped `destroy()`), which is real money walking; optionally stop them.
- cross-checks the accounted minutes against the dashboard's 48h-lagged figures as a
  **manual** drift sanity-check.

It is a safety net and observability aid, not a source of billing truth. (If
Daytona later ships an API-key-callable per-sandbox usage endpoint — see #4643 — we
can promote this to a true reconciliation/correction step.)

## Database migration

One Alembic revision adding `SANDBOX_RUNTIME_MINUTES` to the `meters_type` Postgres
enum. Copy the self-contained template at
`api/ee/databases/postgres/migrations/core/versions/b2c3d4e5f7a8_add_events_ingested_meter.py`
(create temp type / alter column / drop / rename; downgrade deletes new-key rows
first). No table/DAO/`compute_meter_id` changes — the metering core is generic over
the enum.

## Read & display

`/billing/usage` (`api/ee/.../billing/router.py` ≈ L932) emits one row per quota,
projected to the caller's scope/period — the new resource appears with
`value/limit/free/period/scope` once the `Quota` is declared. Frontend: add the
label/descriptor to the usage card (`web/ee/src/services/billing/types.d.ts` + the
card renderer) and the pricing catalog line. Because the default scope is PROJECT,
the card shows the **project's** runtime budget.

## What this is NOT

- **Not** a Daytona-usage-pull pipeline — verified infeasible for ephemeral
  sandboxes (no per-sandbox cost API, JWT-only `/usage`, 48h lag, sandbox gone
  before a cron sees it). Labels are for audit/reconciliation only.
- **Not** metering the legacy evaluator sandbox
  (`sdks/python/agenta/sdk/engines/running/runners/daytona.py`) — no retrofit. The
  provider-neutral name leaves the door open later.
- **Not** a per-minute *rate* limit (that's the separate throttle/token-bucket
  path) — this is a *quantity* of minutes over a monthly window.
- **Not** a hard real-time cutoff — it's a post-paid budget with a lagged soft gate.
- **Not** per-agent yet — that's the phase-2 `Scope.AGENT` rung.

## Risks & edges

- **Post-paid overshoot.** One run can cross the budget before the next is gated.
  Bounded to a single run by `strict`. Intentional.
- **Warmup dominates short runs.** Cold sandbox + `npm install` (~up to 180s) means
  even trivial prompts cost a few minutes of real spend. Surface in docs; it's the
  argument for sandbox pooling later (separate work).
- **Orphaned sandboxes.** A runner crash that skips `destroy()` keeps a VM (and the
  meter) running; the reconciliation cron is the backstop — flag and optionally
  reap by label.
- **Report delivery loss.** If the trusted post-run report is dropped, that run goes
  unbilled (fail-open under-bills rather than breaking). At-least-once delivery +
  `sandbox_id` idempotency keeps retries safe; the reconciliation cron catches gross
  drift.
- **Join-key correctness.** (C) is only as good as the `run_id → scope` record from
  (A); get that stash/lookup right (durability, TTL) or minutes attach to the wrong
  (or no) project.

See [tasks.md](./tasks.md) for the implementation checklist and
[research.md](./research.md) for the grounding in current code and the Daytona API
findings.
