# Status: Root Cause CONFIRMED

## Current Status: ROOT CAUSE IDENTIFIED

## Confirmed Root Cause

**The report job is re-reporting the same deltas multiple times because the `bump()` operation (which updates `synced`) is failing or not completing after Stripe reports succeed.**

### Evidence from JP's Analysis

1. **Stripe data shows 15-28x normal usage on spike days** - this matches repeated reporting of the same deltas
2. **Logs show "Skipped (ongoing)" for hours** - meaning a job held the lock for extended periods
3. **JP confirmed: "we're re-sending the same information"**

### The Bug Flow

```
Normal flow:
  1. dump() → get meters where synced != value
  2. For each meter: report delta to Stripe
  3. bump() → set synced = value
  4. Next run: dump() returns nothing (synced == value)

Broken flow:
  1. dump() → get meters where synced != value  [meter: value=10000, synced=0]
  2. For each meter: report delta to Stripe      [reports 10000 to Stripe ✓]
  3. bump() → FAILS or TIMES OUT                 [synced stays at 0 ✗]
  4. Next run: dump() returns SAME meters        [meter: value=10100, synced=0]
  5. For each meter: report delta to Stripe      [reports 10100 to Stripe - DOUBLE!]
  6. ... repeat ...
```

### Log Timeline (Feb 13, 2026)

| Time | Event | Host | Status |
|------|-------|------|--------|
| 12:15:01 | Trigger | 2cea57d7af60 | ✅ Completed (1.5s) |
| 12:45:01 | Trigger | 1e802ab75cb0 | ✅ Completed (2s) |
| 13:15:01 | Trigger | 2cea57d7af60 | ✅ Completed (3s) |
| 13:45:01 | Trigger | f1cd57f993b9 | ✅ Completed (1.5s) |
| 14:15:01 | Trigger | ??? | ❓ Started but got stuck? |
| 14:45:01 | Trigger | 26d4f486003f | ⏭️ Skipped (lock held) |
| 15:45:01 | Trigger | 90b45f917671 | ⏭️ Skipped (lock held) |
| ... | ... | ... | Continues for hours |

### Why The Lock Stays Held

```python
# The lock gets renewed after EACH batch!
async def _renew_lock():
    return await renew_lock(namespace="meters:report", key={}, ttl=LOCK_TTL)

await self.meters_service.report(renew=_renew_lock)

# Inside report():
if renew:
    await renew()  # Lock extended for another hour
```

If a job is stuck in a long-running Stripe API call or database operation, the lock keeps getting renewed forever.

## Likely Failure Points

### 1. Stripe API Timeout/Error (HIGH)
```python
stripe.billing.MeterEvent.create(...)  # Can hang or fail
```
If this hangs, the job is stuck. If it fails silently, the meter is added to `meters_to_bump` but was never reported.

### 2. Database Commit Failure (HIGH)
```python
try:
    await session.commit()
except Exception:
    log.error(...)
    await session.rollback()
    raise  # But Stripe already received the reports!
```

### 3. The `continue` After Batch Error (MEDIUM)
```python
try:
    await self.bump(meters=meters_to_bump)
except Exception:
    log.error(...)
    total_errors += len(meters)
    continue  # ← Moves to next batch, doesn't retry or mark as "do not re-report"
```

## Required Fixes

### Immediate Fix: Add Idempotency to Stripe Reports

Stripe's MeterEvent supports an `identifier` field for deduplication:

```python
stripe.billing.MeterEvent.create(
    event_name=event_name,
    payload={"delta": delta, "customer_id": customer_id},
    identifier=f"{meter.organization_id}:{meter.key}:{meter.year}:{meter.month}:{meter.value}"
    #        ↑ Unique identifier prevents duplicate reports
)
```

### Fix 2: Don't Report if Bump Will Fail

Check bump capability BEFORE reporting:

```python
# Validate meter exists and can be updated BEFORE reporting
for meter in meters:
    if not await can_bump(meter):
        log.warn(f"Skipping meter {meter} - cannot update synced")
        continue
    
    # Only report if we know we can bump
    stripe.billing.MeterEvent.create(...)
    meters_to_bump.append(meter)
```

### Fix 3: Add Job Timeout

```python
# Don't renew lock forever - have a maximum job duration
MAX_JOB_DURATION = 30 * 60  # 30 minutes
start_time = time.time()

async def _renew_lock():
    if time.time() - start_time > MAX_JOB_DURATION:
        raise TimeoutError("Job exceeded max duration")
    return await renew_lock(...)
```

### Fix 4: Add Reconciliation Job

Create a job that compares:
- Sum of all `value - synced` in meters table
- Sum of all meter events sent to Stripe in current period

Alert if they differ significantly.

## Next Steps

1. [ ] Implement idempotency key in Stripe MeterEvent.create()
2. [ ] Add job timeout (don't renew lock forever)
3. [ ] Fix the bump() error handling to not leave meters in inconsistent state
4. [ ] Add monitoring/alerting for long-running report jobs
5. [ ] Build reconciliation report to detect discrepancies

## PR #3769 Assessment (2026-02-17)

Reviewed `https://github.com/Agenta-AI/agenta/pull/3769/changes`.

### What it fixes well

1. **Safer lock ownership** in `api/oss/src/utils/caching.py`
   - owner-token lock acquire
   - owner-checked renew/release via Lua
   - stricter error handling option (`strict=True`)
2. **Billing endpoints use strict locking** in `api/ee/src/apis/fastapi/billing/router.py`
   - avoids false "Skipped (ongoing)" when Redis errors occur
3. **Stops same-run resend loop** in `api/ee/src/core/meters/service.py`
   - `bump()` failure now breaks the run instead of continuing
4. **Improved bump resilience** in `api/ee/src/dbs/postgres/meters/dao.py`
   - chunked commit + row fallback

### Remaining gap (critical)

The Stripe counter reporting call in `api/ee/src/core/meters/service.py` still has **no idempotency identifier**:

```python
stripe.billing.MeterEvent.create(
    event_name=event_name,
    payload=payload,
)
```

If Stripe accepts an event but client-side flow fails before durable bump, a later retry can still duplicate billed usage across runs. The PR reduces probability, but does not make reporting exactly-once.

### Recommendation before/after merge

Add Stripe-side deduplication for meter events (e.g. stable event `identifier`, or explicit idempotency key strategy), then this is a strong fix. Without that, this PR is a good mitigation but not a complete fix.

## Customer Remediation

For affected customers:
1. Calculate total over-reported amount from Stripe meter event summaries
2. Issue credit or adjust next invoice
3. Optionally: Use Stripe's void/cancel meter events if within correction window
