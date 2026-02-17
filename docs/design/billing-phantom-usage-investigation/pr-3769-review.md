# PR #3769 Review: [fix] Investigate and resolve billing issue

## Overall Assessment

**Good PR that significantly reduces the blast radius, but does NOT fully prevent double-reporting.** The core non-atomicity between "report to Stripe" and "persist synced to DB" remains. The PR makes the system much more resilient and observable, but a sufficiently unlucky failure can still cause the same bug.

---

## What It Fixes Well ✅

### 1. Ownership-Safe Distributed Locks (caching.py)
**Excellent fix.** Uses Lua scripts for atomic owner-checked renew/release. This eliminates the class of bugs where:
- Worker A's lock TTL expires
- Worker B acquires the lock
- Worker A's `finally` block runs and deletes Worker B's lock

The dedicated `r_lock` Redis client with a longer timeout (2.0s vs 0.5s) is also smart — lock operations should be more reliable than cache lookups.

### 2. `break` Instead of `continue` on bump() Failure (service.py)
**Critical fix.** The old code:
```python
except Exception:
    total_errors += len(meters)
    continue  # ← Re-dumps same unsynced rows in the SAME job run
```
The new code:
```python
except Exception:
    total_errors += len(meters)
    break  # ← Stops the job, prevents re-reporting in the same run
```
This eliminates the **intra-run** re-reporting loop.

### 3. Break on Lock Renewal Failure (service.py)
**Good fix.** If the lock is lost mid-job, the job stops instead of continuing without lock protection. This prevents scenarios where two workers report the same meters concurrently.

### 4. Chunked bump() with Row-by-Row Fallback (dao.py)
**Good resilience improvement.** A single bad meter row won't take down the entire batch commit. The chunk_size=25 with row-by-row fallback is a sensible strategy.

### 5. `strict=True` for Lock Acquisition (router.py)
**Good observability fix.** Raises on Redis errors instead of silently returning None and logging "Skipped (ongoing)" — which was masking infrastructure issues.

### 6. Force-Unlock Admin Endpoint (router.py)
**Good operational recovery tool.** Allows manual intervention when a lock is stuck. Though the owner-safe locks should prevent most stuck-lock scenarios, this is a useful escape hatch.

### 7. Structured Logging with job_id (service.py)
**Good for debugging.** The `attempt/success/error` logs with `job_id`, `org`, `key`, `period`, `synced`, `value`, and `delta` will make future investigations much faster.

---

## What It Does NOT Fix ❌

### 1. The Core Non-Atomicity (STILL PRESENT)

The fundamental bug is that "report to Stripe" and "persist synced to DB" are not atomic:

```python
# STILL IN THE PR — this sequence hasn't changed:
for meter in meters:
    stripe.billing.MeterEvent.create(...)   # Step 1: Report to Stripe ✓
    meters_to_bump.append(meter)

# ... later ...
await self.bump(meters=meters_to_bump)       # Step 2: Persist synced ✗ (can fail)
```

**If the process is killed between Step 1 and Step 2** (OOM, container restart, deployment), the Stripe events are sent but synced is never persisted. The next run will re-report the same deltas.

The `break` fix only prevents re-reporting **within the same job run**. It doesn't help if the process dies entirely.

**Fix**: Use Stripe's `identifier` field for deduplication ([Stripe API docs](https://docs.stripe.com/api/billing/meter-event/create)):

> **`identifier`** *(string, optional)* — A unique identifier for the event. If not provided, one is generated. We recommend using UUID-like identifiers. **We will enforce uniqueness within a rolling period of at least 24 hours.** The enforcement of uniqueness primarily addresses issues arising from accidental retries or other problems occurring within extremely brief time intervals.

```python
stripe.billing.MeterEvent.create(
    event_name=event_name,
    payload={"delta": delta, "customer_id": customer_id},
    identifier=f"{org_id}:{key}:{year}:{month}:{synced}:{value}",
)
```
This would make reporting **idempotent** — even if the same delta is sent twice within 24 hours, Stripe ignores the duplicate. This is the only way to truly eliminate the double-reporting risk.

**Note**: The 24-hour uniqueness window covers our use case since the cron runs every 30 minutes and a stuck lock expires in 1 hour. Any re-report would happen well within the 24-hour window.

### 2. Cross-Run Re-Reporting (STILL PRESENT)

Scenario:
1. Job Run #1: Reports 10K to Stripe for meter (org, traces, 2026, 3), then process is OOM-killed before bump()
2. Lock TTL expires after 1 hour
3. Job Run #2: dump() returns the same meter with synced still at old value, reports 10.5K (includes the 10K already sent)
4. Stripe now has 20.5K for 10.5K of real usage

The PR's `break` on bump failure only applies within a single run. Between runs, the same bug exists.

### 3. No Period Filtering in dump() (STILL PRESENT)

```python
# dump() still returns ALL unsynced meters from ALL billing periods:
stmt = select(MeterDBE).filter(MeterDBE.synced != MeterDBE.value)
```

Old billing period meters can still be reported to Stripe, potentially causing confusion about which period the usage belongs to.

### 4. No Reconciliation Mechanism

There's still no way to detect when Stripe's totals diverge from the database. A reconciliation check (compare sum of reported deltas with actual meter values) would catch issues early.

---

## Specific Code Concerns

### 1. Force-Unlock Endpoint Has No Owner Check

```python
async def unlock_report_usage(self):
    released = await release_lock(
        namespace="meters:report",
        key={},
        # owner is NOT passed — bypasses ownership check
    )
```

This is intentional (it's a force-unlock), but it means if Worker A is actively running and someone calls this endpoint, Worker A's lock is yanked out from under it. Worker A won't know until its next `renew()` call. Between the force-unlock and Worker A's next renew, Worker B could start and both would be reporting concurrently.

**Suggestion**: Log a more prominent warning, or consider having the endpoint set a "poison pill" that the active job checks, rather than directly deleting the lock.

### 2. `_bump_commit_chunk` Session Scope

Each call to `_bump_commit_chunk` creates a new `engine.core_session()`. This is fine for isolation, but means each chunk is a separate transaction. If chunks 1-3 succeed and chunk 4 fails, meters from chunks 1-3 are persisted but chunk 4's meters remain unsynced. This is actually better than the old all-or-nothing approach for resilience.

### 3. The `break` After bump Failure Leaves Meters Unsynced

After `break`, the meters that were reported to Stripe but not bumped remain in the "unsynced" state. The next job run will dump them again and re-report to Stripe. This is the exact same bug, just deferred to the next run.

---

## Severity Assessment

| Issue | Before PR | After PR | Status |
|-------|-----------|----------|--------|
| Lock stolen by another worker | HIGH RISK | Fixed | ✅ |
| Intra-run re-reporting loop | HIGH RISK | Fixed | ✅ |
| Lock stuck forever (no expiry) | MEDIUM RISK | Mitigated (break on renew fail + force-unlock) | ⚠️ |
| Cross-run re-reporting | HIGH RISK | Still present | ❌ |
| Process death between report & bump | HIGH RISK | Still present | ❌ |
| Redis errors masked as "Skipped" | MEDIUM RISK | Fixed (strict mode) | ✅ |
| Single meter row kills entire batch | LOW RISK | Fixed (chunked + row fallback) | ✅ |

---

## Recommendation

**Merge this PR** — it's a significant improvement. But **open a follow-up** for:

1. **Add Stripe `identifier` for idempotent reporting** — This is the only complete fix for the fundamental non-atomicity. The identifier should encode enough state to be unique per "logical report" (e.g., `{org}:{key}:{year}:{month}:{synced}:{value}`).

2. **Add a reconciliation check** — A periodic job that compares the database meter values with what Stripe has received, alerting on discrepancies.

3. **Consider bump-per-meter instead of batch** — Report one meter to Stripe, immediately bump that one meter, then move to the next. This minimizes the window where report-without-bump can occur.
