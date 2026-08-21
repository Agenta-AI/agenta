### PR 5037
number: 5037
state: MERGED
author: junaway
base: big-agents  head: feat/add-sandbox-metering
url: https://github.com/Agenta-AI/agenta/pull/5037

## Context

This is the first, standalone step of the metering rework: changes to the **existing** meters and **existing** billing only. New meters (sandbox compute, records, storage) and new billing land in later tracks. Three things change here, all entangled with current pricing so they ship together and ahead of everything else:

1. We stop billing for users.
2. Data-retention windows shorten by one tier per plan.
3. Base prices drop on Pro and Business.

Everything lives in `api/ee/src/core/access/entitlements/types.py` (the `DEFAULT_ENTITLEMENTS` quotas that are enforced, plus the `DEFAULT_CATALOG` metadata the pricing modal renders) and its `REPORTS` map (what gets synced to Stripe).

## Changes

**Stop billing users.** `Gauge.USERS` is removed from `REPORTS`, so user count is no longer synced to Stripe. The gauge stays in place, so users are still metered and still capped on the free plan (Hobby remains hard-capped at 2). The Pro users quota is loosened to uncapped (dropping `free=3, limit=10`, keeping `strict`). Business, Agenta-AI, and Self-Hosted were already uncapped. In the catalog, the Pro `users` tiered price block and the "3 seats included then $20 per seat" line are gone; Pro and Business now read "Unlimited seats".

**Retention shifts down one tier per plan.** A new `Retention.WEEKLY = 10080` (7 days, in minutes) is added, and `QUARTERLY` is corrected to 92 days (`132480`). The three data meters (`TRACES_INGESTED`, `EVENTS_INGESTED`, `RECORDS_INGESTED`) move:

```
             before              after
Hobby        MONTHLY   (1 month) WEEKLY    (1 week)
Pro          QUARTERLY (1 quarter) MONTHLY (1 month)
Business     YEARLY    (1 year)  QUARTERLY (1 quarter)
Enterprise   unlimited           unlimited (unchanged)
```

Both sides move together: the enforced `DEFAULT_ENTITLEMENTS` quotas and the displayed `DEFAULT_CATALOG` (`retention` field plus the feature text, now phrased "1 week / 1 month / 1 quarter retention period" rather than day counts). The retention sweep reads `quota.retention` as raw minutes, so `WEEKLY` needs no consumer change.

**Base prices lowered** (catalog display amounts): Hobby $0 (unchanged), Pro $49 -> $29, Business $399 -> $299.

## Stripe / manual steps (outside the codebase)

The code changes what we display and what we enforce, and it stops us *sending* user updates to Stripe. It does not change existing subscriptions on Stripe's side. Those need manual work, because of how Stripe models this:

- **Users is a gauge.** `report()` bills gauges with `stripe.Subscription.modify(items=[{id, quantity}])`, which sets an absolute subscription-item quantity that Stripe keeps charging every cycle until the item is removed. Removing the key from `REPORTS` stops the updates but does **not** stop the charge. For every existing Pro/Business subscription, the `users` subscription item must be removed (delete it, or set quantity 0) so current subscribers stop being charged.

- **Stripe Prices are immutable.** You cannot edit the amount on an existing price. For the base-price drop, create new base price IDs at $29 / $299, point `AGENTA_BILLING_PRICING[<plan>]["base"]["price"]` at them (covers new subscriptions), then migrate each existing subscription's base item to the new price with `SubscriptionItem.modify` (mind `proration_behavior` so mid-cycle isn't a surprise credit or charge). Traces pricing is unchanged; users pricing is disappearing.

Order of operations: merge/deploy the code first (stops new user updates and stops new subscriptions attaching a `users` item), then sweep existing subscriptions.

## Tests / notes

- `ruff format` + `ruff check` clean on the changed file.
- Verified by import: `DEFAULT_ENTITLEMENTS` (enforced) and `DEFAULT_CATALOG` (displayed) agree per plan on retention; `Gauge.USERS` is absent from `REPORTS`; base amounts are $0 / $29 / $299; the Pro `users` price block is gone.
- The frontend pricing modal renders from the backend catalog (`plan.price.base.amount`, `plan.features`), so these edits flow to the UI with no frontend change. The unused `PRICING_PLANS_INFO` constant in `web/ee` is dead code and is intentionally left out of scope.
- Base branch is `big-agents`. This PR is the base of the metering stack; the two design docs (`docs/designs/sandbox-metering/{specs,tasks}.md`) land here so they're committed once.

## What to QA

- Open the pricing modal: Hobby shows $0 and "1 week retention period"; Pro shows $29, "1 month retention period", "Unlimited seats"; Business shows $299, "1 quarter retention period", "Unlimited seats". No per-seat pricing line anywhere.
- On a Pro org, add users past the old cap of 10: it should succeed. On the free plan, adding a 3rd user should still be blocked.
- Trigger a `report()` run and check the `[stripe]` logs: no `users` line should appear.
- Retention sweep: confirm the flush job uses the new cutoffs (e.g. Hobby traces older than 7 days get swept).



### PR 5039
number: 5039
state: OPEN (draft)
author: junaway
base: feat/add-sandbox-metering  head: feat/metering-track-b
url: https://github.com/Agenta-AI/agenta/pull/5039

## Context

Track B of the metering rework adds the new sandbox metering as pure measurement. It records how much compute and storage each org uses, and records nothing to Stripe. Billing comes later in Track C. Base is Track A (`feat/add-sandbox-metering`).

Records is deliberately not here. `RECORDS_INGESTED` already exists on `big-agents`, so this branch does not touch it.

## Changes

Sandbox usage from E2B and Daytona now flows into meters. A new `sandboxes` domain (`core/sandboxes/` + `apis/fastapi/sandboxes/`) receives it two ways: an E2B webhook (leader-generated secret, HMAC-verified, self-registered) and a Daytona poll. Both feed one `record_usage()` sink at org scope.

The raw compute is metered per resource, per second, with an explicit unit token so the key reads unambiguously:

```
SANDBOX_CPU_CORE_SECONDS   (core-seconds)
SANDBOX_RAM_GIBI_SECONDS   (GiB-seconds)
SANDBOX_SSD_GIBI_SECONDS   (GiB-seconds)
SANDBOX_GPU_CORE_SECONDS   (core-seconds)
```

The full scheme is `SANDBOX_<RESOURCE>_<UNIT>_SECONDS` (see `docs/designs/sandbox-metering/NAMING.md`).

Storage is a gauge, `Gauge.STORAGE_BYTES`, with per-plan caps. Its reconcile job reads the object store through the existing `env.store` config (the SeaweedFS `ObjectStore` the mounts already use), not a new storage config.

Each meter gets a non-blocking `Quota(period=MONTHLY)` on every plan. `REPORTS` is unchanged, so none of this is sent to Stripe yet. Migration `ee0000000004` appends the sandbox and storage values to the `meters_type` enum (`down_revision = ee0000000003`).

## Tests / notes

- `ruff format` and `ruff check` are clean. All new modules import, including the full `ee.src.main` composition root.
- No billing wiring by design. Track C (credits + gating) stacks on top of this branch and is the layer that adds `REPORTS`, pricing, and gating.
- Base this PR on Track A so the diff shows only Track B.



### PR 5040
number: 5040
state: OPEN (draft)
author: junaway
base: feat/metering-track-b  head: feat/metering-track-c
url: https://github.com/Agenta-AI/agenta/pull/5040

## Context

Track B records raw sandbox usage but bills nothing. Track C adds the billing layer: it rolls the raw resource-seconds up into a single credits unit, gates on it, and reports that one unit to Stripe. Base is Track B (`feat/metering-track-b`).

The reason for a credits unit: not every provider bills per second, and the raw dimensions are heterogeneous (core-seconds vs GiB-seconds vs GPU-seconds), so there is no single number to gate or bill on. Credits is that common number.

## Changes

Each raw dimension converts to credits on its own rate, and the per-dimension credits sum into one total. So a usage event now records three layers instead of one:

```
raw:        SANDBOX_CPU_CORE_SECONDS, SANDBOX_RAM_GIBI_SECONDS, ...   (from Track B)
per-dim:    SANDBOX_CPU_CORE_CREDITS, SANDBOX_RAM_GIBI_CREDITS, ...   (new)
total:      SANDBOX_CREDITS = sum of the per-dimension credits        (new, the billable unit)
```

Conversion is a per-provider by per-dimension typed rate table (a `Dimension` enum plus a `ProviderRates` model), with a pure `to_credits()` that returns credits only as a `Decimal`. It never computes money. Stripe owns credit-to-money through the plan price, the same way traces work today. Rates are env-configurable via `AGENTA_SANDBOX_CREDIT_RATES`. Credits are stored as millicredits (value times 1000) because `MeterDTO.delta` is an integer.

Gating runs in two places on `SANDBOX_CREDITS`: a create-time soft pre-check before launching a sandbox, and a post-hoc true-up after usage lands. RBAC (`RUN_SESSIONS`) stays a separate check. Permission is may-run; entitlement is has-quota.

`REPORTS` gains exactly one entry, `sandbox_credits`. The raw seconds and the per-dimension credits are recorded but not reported, so splitting billing per dimension later is a config change, not a rewrite. Migration `ee0000000005` appends the five credit values to the `meters_type` enum (`down_revision = ee0000000004`).

## Tests / notes

- 42 unit tests pass: 30 for the credit conversion (rate round-trips, non-per-second providers, the reference-scenario cross-check) and 12 for gating. `ruff` is clean and the composition root imports.
- Pricing numbers are marked `# TODO(pricing)`. The quotas are non-blocking until pricing sets real free/limit values.
- Base this PR on Track B.



### PR 4783
number: 4783
state: CLOSED (draft)
author: mmabrouk
base: main  head: claude/git-butler-agent-prs-b227dz
url: https://github.com/Agenta-AI/agenta/pull/4783

## Context

We pay Daytona by the minute for the ephemeral VM that runs an agent, but that runtime never reaches our pricing surface — no meter, no per-plan limit, nothing reported to Stripe. This design adds sandbox wall-time as a first-class billable dimension, modeled as a **configurable, scoped resource** so it also lays the first rail for "limit usage per project / agent / user."

Documentation only. Adds a design under `docs/designs/sandbox-runtime-metering/` (proposal, research, tasks). No code or schema changes.

## The model

A **resource** is a named, scoped **entitlement with a quota** — exactly what the EE `check_entitlements` / `Quota` / `Scope` / `meters` layer already provides. A request declares the resource it's about to consume; the system checks entitlement at the same cached point it already checks auth, and only then runs; the consumed minutes are booked after. Shipped **project-scoped by default** (`Scope.PROJECT`), with `USER` available today and a new `AGENT` scope as an explicit phase 2.

## What changed since the first draft (and why)

The first draft pulled runtime out of the OTel trace pipeline. We then explored "tag sandboxes, let a cron pull usage from Daytona, never touch the run path." **Verifying Daytona's API killed that approach for our workload:**

- **No per-sandbox usage/cost API** — CPU-seconds / GB-seconds / price are **dashboard-only**.
- The one `/organizations/:id/usage` endpoint is **live quota snapshots, not cost**, org/region-scoped, and currently **JWT-only — not API-key callable** (open issue [daytonaio/daytona#4643](https://github.com/daytonaio/daytona/issues/4643)).
- **Up to 48h billing lag**, documented.
- Our sandboxes are **ephemeral** (cold VM per prompt turn, destroyed in a `finally`), so a `list()` cron finds them already gone, and there's **no `startedAt`/`stoppedAt`** to reconstruct runtime from.

So **measurement stays in the runner** (the only component that observes a full lifetime), and Daytona **labels** are repurposed for **audit / leak-detection / reconciliation**, not billing.

## Design (three insertion points + an audit cron)

- **(A) Gate** — a soft `check_entitlements(resource, cache=True)` folded into the cached auth check: "authenticated **and** entitled to run?" Returns 429 once the project is over its monthly minute budget. Records `run_id → resolved scope` for attribution.
- **(B) Measure** — `services/agent/src/engines/rivet.ts::runRivet()` already brackets `SandboxAgent.start()`→`destroySandbox()` (warmup included); capture `runtimeMs` and tag the sandbox with `labels`.
- **(C) Account** — the runner sends a **trusted post-run report** `(run_id, sandbox_id, minutes)` to an internal endpoint authed as the agent service's **existing** credential (not the admin key). Attribution comes from the run record (never the payload), so it can't bill arbitrary tenants and adds no new secret; idempotent on `sandbox_id`; charges via the same atomic, fail-open `check_entitlements` every meter uses.
- **Reconciliation cron** (audit only) — `list()` non-deleted sandboxes by label to flag orphaned/leaked VMs and sanity-check the 48h-lagged dashboard. Not a billing source.

Everything else is the well-worn "add a counter" path (`extend-meters`): one enum member, a `Quota(scope=PROJECT, period=MONTHLY, strict=True)` per plan, one Alembic enum migration (template exists), add the slug to `REPORTS` so the existing meters→Stripe cron flushes it (project rows roll up per org via `organization_id`), and `/billing/usage` surfaces it.

## Semantics worth flagging

Post-paid: a run already in flight finishes and is billed; the gate reads the last-booked value, so this is a **soft, slightly-lagged budget guardrail, not a hard real-time cutoff** (`strict` bounds overshoot to one run).

## Files

- `proposal.md` — the resource model, the Daytona verdict, the gate/measure/account flow, registry/Stripe/DB steps, reconciliation cron, risks.
- `research.md` — grounding in current metering/billing/sandbox code (file:line) **and** the cited Daytona API findings.
- `tasks.md` — ordered checklist + open inputs (per-plan numbers, join-key/store, internal report auth, #4643 tracking, phase-2 `Scope.AGENT`).

## Notes

- Still a draft on the product side: per-plan minute allotments and overage price are open.
- Open implementation decisions called out in `tasks.md`: the `run_id → scope` join store (durable vs Redis) and the exact existing internal credential for the report endpoint.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01MdaZVVA8e9LHk2ZrsEJEBj

---
_Generated by [Claude Code](https://claude.ai/code/session_01MdaZVVA8e9LHk2ZrsEJEBj)_


