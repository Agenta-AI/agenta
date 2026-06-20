# Sandbox Runtime Metering — Design Proposal

Meter the wall-clock minutes an agent-runner **sandbox** (Daytona VM) is alive,
record it as a billable usage dimension, enforce per-plan limits, and report it
to Stripe as a usage-based price.

We pay Daytona per-minute of ephemeral VM lifetime; this puts that cost into the
product's pricing surface as a first-class meter, with guardrails.

> Status: proposal. Builds directly on the `extend-meters` work
> ([../extend-meters/proposal.md](../extend-meters/proposal.md)), which already
> reshaped `meters` around a deterministic `meter_id` with flexible scope/period
> and made "add a billable counter" a well-worn path.

## Locked decisions

1. **Unit & rounding.** Whole minutes, **rounded up per run** (`ceil`). Each
   sandbox lifetime is one run; a 12s run counts as 1 minute, a 61s run as 2.
2. **What we meter.** Only the **agent-runner (rivet) sandbox** — the new path.
   We do **not** retrofit the legacy code-evaluator Daytona runner
   (`sdks/python/agenta/sdk/engines/running/runners/daytona.py`). The design is
   provider-neutral so the same meter can later cover other sandboxes without a
   schema change.
3. **Outcome.** Both **limits** (per-plan monthly minute quota, enforced) and
   **billing** (reported to Stripe as usage).

## The one idea that makes this clean

The rivet runner already emits an OTel span tree and exports it OTLP/HTTP to
`{AGENTA_HOST}/api/otlp/v1/traces` — the **same** ingest pipeline that today
charges `TRACES_INGESTED`. Trace ingestion already:

- resolves the **organization** per trace (attribution is solved), and
- charges `check_entitlements(...)` per-org, batched, in the background worker
  `api/oss/src/tasks/asyncio/tracing/worker.py` (≈ line 268).

So runtime minutes become **a span attribute** on the agent's root span, and the
worker that already counts root spans gains a few lines to *also* sum that
attribute and charge a second counter. No new tenant-propagation, no new
transport, no synchronous coupling to the runner.

```
client ─▶ api gateway ─▶ workflow invoke ─▶ agent service ─▶ rivet runner ─▶ Daytona VM
                                                  │                              │
   (A) pre-run soft gate (429 if over) ◀──────────┘        (B) bracket start→destroy,
                                                                 stamp sandbox.runtime_ms
                                                                 on the root span
        OTLP spans ─────────────────────────────────────────────────────┘
            │
            ▼
   api/otlp ingest ─▶ tracing worker  ──(C) per-org: charge TRACES_INGESTED (today)
                                       └─(C') per-org: Σ ceil(ms/60000) ⇒ charge SANDBOX_RUNTIME_MINUTES (new)
                                                  │
                                                  ▼
                            meters table ─▶ report cron ─▶ Stripe MeterEvent (billing)
                                          └▶ /billing/usage (display + limit)
```

Three insertion points: **(B)** capture in the runner, **(C')** charge in the
worker, **(A)** gate before the run. Everything else is config.

## Naming

New dimension slug: **`sandbox_runtime_minutes`** (enum `SANDBOX_RUNTIME_MINUTES`).
Provider-neutral on purpose — the meter measures *sandbox wall-time we pay for*,
not "Daytona" specifically, so swapping providers or adding the evaluator
sandbox later reuses the same meter. Span attribute: **`sandbox.runtime_ms`**
(raw milliseconds, for fidelity/observability); the per-run `ceil`-to-minutes
rounding is applied once, in the worker, so the policy lives in exactly one place.

## (B) Capture — agent runner

`services/agent/src/engines/rivet.ts::runRivet()` brackets the exact billable VM
lifetime in a single function:

- `t0 = performance.now()` immediately before `SandboxAgent.start()` (≈ L883).
- in the `finally`, after `destroySandbox()` (≈ L1079):
  `runtimeMs = Math.round(performance.now() - t0)`.

This deliberately includes provisioning **and** the `npm install` warmup (up to
~180s) — that VM time is real Daytona spend and should be billed.

Surface it two ways (they converge):

1. **On the result** — add `sandboxRuntimeMs` to `AgentRunResult`
   (`services/agent/src/protocol.ts`, alongside `usage`). The Python adapter
   `sdks/python/agenta/sdk/agents/adapters/rivet.py` already threads the result
   back; `services/oss/src/agent/app.py` (≈ L127) → `record_usage()`
   (`services/oss/src/agent/tracing.py` ≈ L62) is where `gen_ai.usage.*` is
   stamped on the workflow span — stamp `sandbox.runtime_ms` there too.
2. The span then flows through OTLP ingest like any other usage attribute.

Only the agent's **root span** carries the attribute (one run = one sandbox =
one root span), which is what the worker keys on. Non-Daytona backends (local
runner) simply don't set it ⇒ they meter zero, no special-casing.

## (C') Charge — tracing worker (EE path, per-org, batched)

The worker already groups root spans by org and calls
`check_entitlements(key=Counter.TRACES_INGESTED, delta=<root span count>, ...)`.
Extend the same loop:

```python
# per org, over the batch's root spans:
minutes = sum(
    math.ceil(span.attributes["sandbox.runtime_ms"] / 60_000)
    for span in root_spans
    if span.attributes.get("sandbox.runtime_ms")          # per-run ceil
)
if minutes:
    allowed, _, _ = await check_entitlements(
        key=Counter.SANDBOX_RUNTIME_MINUTES,
        delta=minutes,
        scope=scope_from(organization_id=org_id),          # worker has no ambient ctx
    )
    # post-paid: we charge what already ran; `allowed=False` just means the
    # org is now over and the *next* run's pre-gate will reject. Do not drop.
```

`check_entitlements` is the single chokepoint that records usage and enforces
quota in one atomic upsert (`api/ee/.../entitlements/service.py` ≈ L272 →
`MetersDAO.adjust` ≈ `dao.py:376`). It fails open on any infra glitch, so a
metering hiccup never blocks ingestion.

**Post-paid semantics.** Unlike pre-paid counters, minutes are only known after
the run. We therefore *charge after* (here) and *gate before* (A). A run already
in flight is always allowed to finish and is billed; enforcement bites on the
*next* run. This matches how cloud usage billing normally behaves.

## (A) Gate — agent invocation edge (EE, soft pre-check)

Before dispatching an agent run, soft-check the meter at the HTTP boundary
(mirroring the OTLP soft-check at `api/oss/.../otlp/router.py` ≈ L224):

```python
allowed, _, _ = await check_entitlements(
    key=Counter.SANDBOX_RUNTIME_MINUTES,
    delta=0,                # read-only: "are we already at/over?"
    cache=True,             # Redis-cached, never writes
)
if not allowed:
    raise HTTPException(429, "You have reached your agent runtime minutes quota for this period.")
```

`delta=0` + `strict` quota means "reject once `value >= limit`". This is a cheap
Redis read on the hot path; it fails open.

## Config — registry changes (EE)

All in `api/ee/src/core/access/entitlements/types.py` unless noted:

1. **`Counter`**: add `SANDBOX_RUNTIME_MINUTES = "sandbox_runtime_minutes"`.
2. **`Meters`** (`api/ee/src/core/meters/types.py`): mirror
   `SANDBOX_RUNTIME_MINUTES = Counter.SANDBOX_RUNTIME_MINUTES.value` (required —
   DAO/cache cross-reference by name).
3. **`DEFAULT_ENTITLEMENTS`** — add a `Quota` under `Tracker.COUNTERS` for every
   plan:
   - Hobby: `Quota(free=<F>, limit=<F>, strict=True, period=Period.MONTHLY)` — a
     real cap (this is the cost-control plan).
   - Pro/Business: `Quota(free=<P>, limit=<P or None>, strict=True, period=Period.MONTHLY)`
     — included allotment, optionally uncapped with overage billed.
   - Enterprise/Agenta-internal: `Quota(period=Period.MONTHLY)` (unlimited).

   `scope=None` ⇒ organization-scoped, which is what we want (Daytona spend is an
   org-level cost). `period=Period.MONTHLY` is the *reset window* — the quantity
   is minutes; there is **no** need for a per-minute `Period` granularity.
4. **`CONSTRAINTS[Constraint.READ_ONLY][Tracker.COUNTERS]`**: include the new
   counter so a blocked/over org can't keep burning sandbox time.
5. **`REPORTS`**: add `Counter.SANDBOX_RUNTIME_MINUTES.value: "sandbox_runtime_minutes"`
   (internal slug → Stripe meter slot). Membership here is exactly "is billed to
   Stripe".
6. **`DEFAULT_CATALOG`** (display): add a feature/price line so the pricing modal
   shows the allotment + overage.

## Billing — Stripe

The report cron (`api/ee/src/crons/meters.sh` → `POST /admin/billing/usage/report`
→ `MetersService.report()` at `api/ee/src/core/meters/service.py` ≈ L75) already
pages unsynced meter rows and, for any counter in `REPORTS`, calls
`stripe.billing.MeterEvent.create(event_name="sandbox_runtime_minutes",
payload={delta = value - synced}, identifier=...)` with deterministic
idempotency. So once the slug is in `REPORTS`, reporting is automatic.

Stripe-side, two non-code steps + one config:

- Create a Stripe **Meter** named `sandbox_runtime_minutes`.
- Create a usage-based **Price** per plan bound to that meter (e.g. N minutes
  included, $X per minute overage).
- Add the price slot to `AGENTA_BILLING_PRICING` (env `BillingConfig`,
  `api/oss/src/utils/env.py` ≈ L214); `get_stripe_meter_price()`
  (`api/ee/src/core/subscriptions/settings.py` ≈ L453) resolves it per plan.

## Database migration

One Alembic revision adding `SANDBOX_RUNTIME_MINUTES` to the `meters_type`
Postgres enum. Copy the self-contained template at
`api/ee/databases/postgres/migrations/core/versions/b2c3d4e5f7a8_add_events_ingested_meter.py`
(create temp type / alter column / drop / rename; downgrade deletes new-key rows
first). No table/DAO/`compute_meter_id` changes — the metering core is generic
over the enum.

## Read & display

`/billing/usage` (`api/ee/.../billing/router.py` ≈ L932) iterates the plan's
counters and emits one row per quota automatically — the new meter appears with
`value/limit/free/period/scope` once the `Quota` is declared. Frontend: add the
label/descriptor to the usage card (`web/ee/src/services/billing/types.d.ts` +
the card renderer) and the pricing catalog line.

## What this is NOT

- Not metering the legacy evaluator sandbox (explicitly out — no retrofit). The
  generic naming leaves the door open later.
- Not a per-minute *rate* limit (that's the separate throttle/token-bucket path).
  This is a *quantity* of minutes over a monthly window.
- Not changing `compute_meter_id` or the meters schema shape.

## Risks & edges

- **Re-ingested traces would double-charge.** Same property the existing
  `TRACES_INGESTED` charge has; if it matters, dedupe by root-span id. Parity
  with today's behavior is the default.
- **Warmup dominates short runs.** Cold sandbox + `npm install` (~up to 180s)
  means even trivial prompts cost ≥ a few minutes. That's real spend; surface it
  in docs so customers aren't surprised, and it's an argument for sandbox pooling
  later (separate work).
- **Post-paid overshoot.** One run can cross the limit before the gate trips on
  the next. Acceptable; strict quota keeps it to a single run's overage.
- **Fail-open everywhere.** A metering outage neither blocks runs nor charges —
  we under-bill rather than break the product. Intentional.

See [tasks.md](./tasks.md) for the implementation checklist and
[research.md](./research.md) for the grounding in current code.
