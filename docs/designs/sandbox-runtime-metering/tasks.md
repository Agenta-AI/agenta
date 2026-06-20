# Sandbox Runtime Metering — Implementation Checklist

Ordered so each step is independently reviewable. See
[proposal.md](./proposal.md) for rationale.

## 1. Capture in the runner (TS) — point (B)

- [ ] `services/agent/src/engines/rivet.ts::runRivet()`: `t0 = performance.now()`
      before `SandboxAgent.start()`; in the `finally` after `destroySandbox()`,
      `runtimeMs = Math.round(performance.now() - t0)`.
- [ ] `services/agent/src/protocol.ts`: add `sandboxRuntimeMs?: number` to
      `AgentRunResult` (next to `usage`). Populate it from `runRivet`. Local /
      non-Daytona backends leave it unset.
- [ ] (optional) also set it on the runner's `invoke_agent` root span attribute
      directly in `services/agent/src/tracing/otel.ts` for runner-side traces.

## 2. Propagate + stamp the span (Python) — bridge to OTLP

- [ ] `sdks/python/agenta/sdk/agents/adapters/rivet.py`: surface
      `sandboxRuntimeMs` from the runner result onto the Python result object.
- [ ] `services/oss/src/agent/tracing.py::record_usage()` (and its call in
      `app.py` ≈ L127): stamp `sandbox.runtime_ms` on the workflow/root span
      alongside `gen_ai.usage.*`. Only the root span.

## 3. Registry / config (EE)

- [ ] `api/ee/src/core/access/entitlements/types.py`:
  - [ ] `Counter.SANDBOX_RUNTIME_MINUTES = "sandbox_runtime_minutes"`.
  - [ ] `DEFAULT_ENTITLEMENTS`: add a `Quota(... period=Period.MONTHLY, strict=True)`
        under `Tracker.COUNTERS` for **every** plan (real `limit` on Hobby/Pro,
        `None` on Business/Enterprise/Agenta). Numbers TBD by product.
  - [ ] `CONSTRAINTS[Constraint.READ_ONLY][Tracker.COUNTERS]`: include it.
  - [ ] `REPORTS`: `Counter.SANDBOX_RUNTIME_MINUTES.value: "sandbox_runtime_minutes"`.
  - [ ] `DEFAULT_CATALOG`: display line (allotment + overage).
- [ ] `api/ee/src/core/meters/types.py`: mirror
      `SANDBOX_RUNTIME_MINUTES = Counter.SANDBOX_RUNTIME_MINUTES.value` in `Meters`.

## 4. Database migration (EE)

- [ ] New Alembic revision adding `SANDBOX_RUNTIME_MINUTES` to the `meters_type`
      enum — copy `…/core/versions/b2c3d4e5f7a8_add_events_ingested_meter.py`
      (type-swap up; downgrade deletes new-key rows first).

## 5. Charge in the worker (EE) — point (C')

- [ ] `api/oss/src/tasks/asyncio/tracing/worker.py` (≈ L268): in the existing
      per-org loop, sum `ceil(span.attributes["sandbox.runtime_ms"] / 60_000)`
      over root spans and `await check_entitlements(key=Counter.SANDBOX_RUNTIME_MINUTES,
      delta=minutes, scope=scope_from(organization_id=org_id))` when `> 0`.
      Do not drop the batch on `allowed=False` (post-paid).

## 6. Gate before the run (EE) — point (A)

- [ ] At the agent invocation entry (gateway/invoke handler): soft
      `check_entitlements(key=Counter.SANDBOX_RUNTIME_MINUTES, delta=0, cache=True)`;
      raise `HTTPException(429, "…agent runtime minutes quota…")` when not allowed.

## 7. Stripe (config, not code)

- [ ] Create Stripe Meter `sandbox_runtime_minutes`.
- [ ] Create usage-based Price per plan bound to it (included minutes + overage).
- [ ] Add the price slot to `AGENTA_BILLING_PRICING` env so
      `get_stripe_meter_price()` resolves it.

## 8. Frontend

- [ ] `web/ee/src/services/billing/types.d.ts` + usage card: render the new
      counter (label, unit = "minutes").
- [ ] Pricing modal: surface the catalog line.

## 9. Tests / verification

- [ ] Unit: `ceil` rounding (12s→1, 60s→1, 61s→2, 0→0); attribute-missing ⇒ 0.
- [ ] Worker: per-org sum + charge with a synthetic batch of root spans.
- [ ] Gate: 429 once `value >= limit`; fail-open when metering errors.
- [ ] `/billing/usage` shows the counter with correct value/limit/period.
- [ ] Manual: run an agent on the Daytona backend, confirm minutes accrue and
      report to a Stripe test meter.

## Open product inputs (need numbers/decisions)

- Per-plan minute allotments + limits (Hobby cap, Pro/Business included + overage).
- Overage price per minute.
- Whether to dedupe re-ingested traces (double-charge guard) now or accept
  parity with `TRACES_INGESTED`.
