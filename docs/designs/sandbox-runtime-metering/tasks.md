# Sandbox Runtime Metering — Implementation Checklist

Ordered so each step is independently reviewable. See [proposal.md](./proposal.md)
for rationale and [research.md](./research.md) for code/API grounding.

## 1. Measure in the runner (TS) — point (B)

- [ ] `services/agent/src/engines/rivet.ts::runRivet()`: `t0 = performance.now()`
      before `SandboxAgent.start()`; in the `finally` after `destroySandbox()`,
      `runtimeMs = Math.round(performance.now() - t0)`.
- [ ] At sandbox creation, set `labels = { org, project, run_id, [agent, user] }`
      (Daytona `labels` create-param) for reconciliation/leak-detection.
- [ ] Carry `runtimeMs` (+ `sandbox.id`, `run_id`) back to where the post-run report
      is sent. Local / non-Daytona backends leave it unset ⇒ they meter zero.

## 2. Gate — fold into the cached auth check (EE) — point (A)

- [ ] At the agent invocation edge (where org/project/user are resolved): soft
      `check_entitlements(key=Counter.SANDBOX_RUNTIME_MINUTES, delta=0, cache=True,
      scope=scope_from(project_id=...))`; raise `HTTPException(429, "…agent runtime
      minutes quota…")` when not allowed. Fail-open on error.
- [ ] Record `run_id → resolved scope` (org/project/[user]) for the post-run join.
      **Decide the store**: durable run record vs short-TTL Redis key. (Load-bearing
      for correct attribution — pick the durable option unless there's a reason not
      to.)

## 3. Account — trusted post-run report (EE) — point (C)

- [ ] New **internal** metering endpoint in `api/` (EE), authenticated as the agent
      service's **existing** credential (NOT the admin `AGENTA_AUTH_KEY`). Accepts
      `(run_id, sandbox_id, runtime_ms)`.
- [ ] Handler: load scope via `run_id` (from step 2), `minutes = ceil(runtime_ms /
      60_000)` (per-run ceil, applied here once), then
      `check_entitlements(key=Counter.SANDBOX_RUNTIME_MINUTES, delta=minutes,
      scope=<loaded>, idempotency_key=sandbox_id)`. Never read tenant from the
      payload. Post-paid: do not reject on `allowed=False`.
- [ ] Runner/agent-service: send the report after `destroy()` (at-least-once;
      `sandbox_id` makes retries idempotent). Failure to send ⇒ unbilled (fail-open),
      caught later by reconciliation.

## 4. Registry / config (EE)

- [ ] `api/ee/src/core/access/entitlements/types.py`:
  - [ ] `Counter.SANDBOX_RUNTIME_MINUTES = "sandbox_runtime_minutes"`.
  - [ ] `DEFAULT_ENTITLEMENTS`: add `Quota(scope=Scope.PROJECT, period=Period.MONTHLY,
        strict=True, ...)` under `Tracker.COUNTERS` for **every** plan (real `limit`
        on Hobby/Pro, `None` on Business/Enterprise/Agenta). Numbers TBD by product.
  - [ ] `CONSTRAINTS[Constraint.READ_ONLY][Tracker.COUNTERS]`: include it.
  - [ ] `REPORTS`: `Counter.SANDBOX_RUNTIME_MINUTES.value: "sandbox_runtime_minutes"`.
  - [ ] `DEFAULT_CATALOG`: display line (allotment + overage).
- [ ] `api/ee/src/core/meters/types.py`: mirror
      `SANDBOX_RUNTIME_MINUTES = Counter.SANDBOX_RUNTIME_MINUTES.value` in `Meters`.

## 5. Database migration (EE)

- [ ] New Alembic revision adding `SANDBOX_RUNTIME_MINUTES` to the `meters_type`
      enum — copy `…/core/versions/b2c3d4e5f7a8_add_events_ingested_meter.py`
      (type-swap up; downgrade deletes new-key rows first).

## 6. Stripe (config, not code)

- [ ] Create Stripe Meter `sandbox_runtime_minutes`.
- [ ] Create usage-based Price per plan bound to it (included minutes + overage).
- [ ] Add the price slot to `AGENTA_BILLING_PRICING` env so `get_stripe_meter_price()`
      resolves it. (Existing report cron then flushes it automatically; project rows
      roll up per org via `organization_id`.)

## 7. Reconciliation cron (EE) — audit only, optional but recommended

- [ ] Sibling of `meters.sh` (`daytona_reconcile.{sh,txt}`) → internal endpoint,
      Redis-locked, same shape. Does **not** bill.
- [ ] Handler: Daytona SDK `list({labels})` over non-deleted sandboxes; flag
      orphans/leaks (alive longer than a turn ⇒ skipped `destroy()`), optionally reap;
      log drift vs the dashboard's 48h-lagged figures for manual sanity-check.

## 8. Frontend

- [ ] `web/ee/src/services/billing/types.d.ts` + usage card: render the new counter
      (label, unit = "minutes"); it's the **project's** budget by default.
- [ ] Pricing modal: surface the catalog line.

## 9. Tests / verification

- [ ] Unit: `ceil` rounding (12s→1, 60s→1, 61s→2, 0→0); missing runtime ⇒ 0.
- [ ] Account endpoint: attribution comes from the `run_id` record, not the payload;
      duplicate `sandbox_id` charges once (idempotency); fail-open on metering error.
- [ ] Gate: 429 once `value >= limit` for the project scope; fail-open when metering
      errors.
- [ ] `/billing/usage` shows the counter with correct value/limit/period at PROJECT
      scope.
- [ ] Reconciliation: a synthetic orphaned sandbox (matching labels, long-lived) is
      flagged.
- [ ] Manual: run an agent on the Daytona backend; confirm minutes accrue against the
      project budget and report to a Stripe test meter.

## Open inputs / decisions

- **Product numbers:** per-plan minute allotments + limits (Hobby cap, Pro/Business
  included + overage), overage price per minute.
- **Join key + store** (step 2): durable run record vs Redis stash, and the exact
  `run_id`/session identifier shared by gate and runner.
- **Internal report auth:** confirm the exact existing agent-service credential /
  internal auth mechanism for the metering endpoint (must not be the admin key).
- **Daytona usage API:** track daytonaio/daytona#4643 — if an API-key-callable
  per-sandbox usage endpoint ships, promote the reconciliation cron to a true
  correction step. (We have team access; ask Daytona to confirm/prioritize.)
- **Phase 2:** `Scope.AGENT` + request-addressable resource selection (per-agent
  budgets, multiple resources per project).
