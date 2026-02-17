# Hypotheses: Root Cause Analysis

## CONFIRMED: Double Reporting Due to bump() Failure

JP confirmed this by correlating Stripe meter event summaries with NewRelic logs.

---

## Question 1: Why Does It Happen at the Same Time Each Month?

### Answer: It Doesn't Happen at the Same Time — It Happens CONTINUOUSLY, but it's Only VISIBLE Around the Billing Period Boundary

The spike dates:
| Month | Spike Days | Daily Stripe Values |
|-------|-----------|---------------------|
| Nov   | 13 | First spike |
| Dec   | 11-14 | Multi-day spike |
| Jan   | 10-14 | Multi-day spike |
| Feb   | 13-16 | 23K → 156K → 224K → 288K |

The **normal daily values** are ~8-12K traces/day.

### The Key Insight: The Escalating Pattern

Look at Feb's numbers:
| Date | Stripe Value | Ratio |
|------|-------------|-------|
| Feb 12 | 10,993 | 1x (normal) |
| Feb 13 | 23,744 | 2x |
| Feb 14 | 156,374 | 15x |
| Feb 15 | 224,238 | 22x |
| Feb 16 | 287,917 | 28x |
| Feb 17 | 14,847 | ~1.5x (back to normal) |

The **values increase each day during the spike**. This is consistent with:
1. `synced` is stuck at some value
2. Each cron run reports `delta = value - synced` where `value` keeps growing
3. The cumulative Stripe total = `sum(value_at_each_run - stuck_synced)`

### Why Around the 13th Specifically?

The customer's **anchor day is likely 13** (or close to it).

On the anchor day, `compute_billing_period()` flips:
```python
# Feb 12 (day < 13): billing period = (2026, 2)
# Feb 13 (day >= 13): billing period = (2026, 3)  ← NEW PERIOD
```

When the billing period changes:
1. The `adjust()` function writes to a **new meter row** `(org, traces, 2026, 3)` with `synced=0`
2. The old meter row `(org, traces, 2026, 2)` might have `synced != value` if the last bump was incomplete
3. `dump()` returns BOTH old and new period meters (it has no period filter)
4. The old period's delta gets reported to Stripe — but Stripe treats it as usage in the NEW period

**However**, the more likely trigger is that the billing period boundary causes a **behavioral change** that triggers the stuck lock:
- New meter rows are created
- More meters to process = longer job runtime
- If the job takes too long or encounters a Stripe rate limit, it gets stuck
- Once stuck, the lock prevents subsequent jobs
- Lock TTL eventually expires, next job re-reports everything

### Why The Lock Gets Stuck Specifically on the 13th

From the logs, the pattern is:
```
12:15 - Job completes in 1.5s
12:45 - Job completes in 2s
13:15 - Job completes in 3s
13:45 - Job completes in 1.5s
14:15 - ??? (job starts, never completes)
14:45 - Skipped (ongoing)
15:45 - Skipped (ongoing)
... continues for hours/days
```

The 14:15 job acquired the lock but never released it. Possible reasons:
1. **Container restart/OOM kill during the report** — the `finally` block never runs
2. **Stripe API rate limit** — many new meter rows from period boundary = more API calls = rate limited
3. **Database connection timeout** — during `bump()`, the session times out

The lock has 1-hour TTL, but after it expires, the next job would see `synced != value` for ALL accumulated usage and potentially get stuck again in the same way.

---

## Question 2: Which Commit Introduced the Issue?

### Answer: The Bug Has Existed Since the Original Implementation (v0.58.0, Oct 14 2025)

The original `report()` in commit `bf46059b7` (release/v0.58.0) already had the exact same structure:

```python
# v0.58.0 - ORIGINAL CODE
async def report(self):
    meters = await self.dump()           # 1. Get all unsynced

    for meter in meters:
        stripe.billing.MeterEvent.create(  # 2. Report to Stripe
            event_name=event_name,
            payload={"delta": meter.value - meter.synced, ...},
        )

    for meter in meters:                  # 3. Set synced locally
        meter.synced = meter.value

    await self.bump(meters=meters)         # 4. Write synced to DB
```

**The bug**: Steps 2 and 4 are not atomic. If step 4 fails (or the process dies between 2 and 4), the same delta gets reported again on the next run.

### But Why Did It Only Start Manifesting on November 13?

The billing system was deployed with v0.58.0 on **Oct 14, 2025**. Here's the timeline of what changed:

| Date | Commit | Change | Impact |
|------|--------|--------|--------|
| Oct 14 | `bf46059b7` | v0.58.0 release - initial billing | Cron: hourly (`0 * * * *`), no lock, simple curl |
| Nov 11 | `bb4b06cd1` | feat/add-batching-to-ingestion-and-metering | Added batching to ingestion |
| Nov 11 | `71079ed3d` | chore/switch-sessions-to-connections | **Changed DB session handling** |
| Nov 12 | `44ccd574b` | add cache/lock and fix logs | Added cache-based "lock" to prevent concurrent runs, changed cron to `* * * * *` (every minute!) |
| Nov 12 | `59cd3dcc3` | meters every 5 minutes ? | Changed to `*/12 * * * *` |
| Nov 12 | `15b0d6c95` | fix cron jobs | Changed back to `* * * * *` |
| Nov 13 | `489881465` | fixed meters cron | Changed to `*/5 * * * *` (every 5 min) |
| Nov 13 | `2c9213306` | removing report cache | Changed to `0/5 * * * *` then back to `* * * * *` |
| Nov 13 | `fa7c3ca05` | back to 1 h | Changed to `* * * * *` (every minute!) |
| Nov 13 | `d02055871` | final touches | Changed to `*/15 * * * *` (every 15 min) |
| Nov 13 | `ae4599496` | more logs | Added timeout/error handling to curl |
| Nov 17 | `0fd771975` | poc/eval-run-new-ds | Simplified curl back, changed to `0 * * * *` (hourly) |
| Nov 18 | `97d0620a5` | feat/pdf-support-in-the-playground | Same: simplified curl, `0 * * * *` |
| Jan 12 | `c94c4c795` | fix cron job | Changed to `15,45 * * * *` (twice per hour) |

### The Trigger: November 11-13

The critical change was on **November 11** (`71079ed3d`): **`chore/switch-sessions-to-connections`**

This commit changed how database sessions work. If this introduced a subtle issue where `bump()` occasionally fails to commit (e.g., connection pooling issue, session timeout), then the double-reporting bug that always existed in the code became **exploitable**.

Combined with:
1. The cron frequency was being changed rapidly on Nov 12-13 (every minute, every 5 min, every 15 min) — suggesting things were breaking and being debugged live
2. The cache-based "lock" was added (`44ccd574b`) — suggesting concurrent runs were causing issues
3. November 13 was likely when the **first billing period boundary was crossed** for early customers (signed up around Oct 30, anchor = Oct 30 + 14 days trial = Nov 13)

### The Most Likely Root Commit

**`71079ed3d` — `chore/switch-sessions-to-connections` (Nov 11, 2025)**

This commit changed the database engine/session handling. If it introduced connection pooling issues or changed how sessions commit/rollback, it would make the existing `bump()` failure path actually fire — turning a theoretical bug into an actual one.

The frantic cron-frequency changes on Nov 12-13 are JP and the team **debugging the resulting issues in production**.

---

---

## Question 3: Why Does bump() Actually Fail?

### Answer: It Probably Doesn't — The Process Gets Killed Before bump() Runs

Looking at the evidence more carefully, **bump() itself isn't failing**. The process hosting the report job is being **killed** (container restart, OOM, or deployment) in the window between sending to Stripe and persisting `synced`.

### Evidence

1. **No bump() error logs**: JP's NewRelic export shows no `[report] [bump] ❌` errors. The jobs either complete normally or disappear entirely.

2. **Missing log entries**: There is NO log for the 14:15 trigger on Feb 13. The cron fires at :15 and :45. We see 13:45 complete, then 14:45 is already "Skipped (ongoing)". The 14:15 entry is simply **gone** — the container that would have logged it no longer exists.

3. **New container hostnames appear**: After 13:45 (host `f1cd57f993b9`), we see `26d4f486003f` at 14:45 and `90b45f917671` at 15:45. These are different containers — the infrastructure recycled them.

4. **Deployment activity on Feb 13**: v0.85.5 was merged at 10:22 CET (09:22 UTC), and v0.85.6 branch was being prepared with merges throughout the day. CI/CD activity could trigger container restarts.

### The Actual Failure Mode

```
Timeline (Feb 13, UTC):

  13:45:01  Container f1cd57f993b9 acquires lock
  13:45:02  Reports 9 meters to Stripe ✓
  13:45:02  bump() succeeds, synced updated ✓
  13:45:02  Lock released ✓
  
  ~14:00    ⚡ Container dies (OOM/restart/scaling event)
            Lock is NOT held (it was properly released at 13:45)
  
  14:15     Cron fires on dying/dead container → no log, no effect
  
  ~14:20    New container starts (host 26d4f486003f)
            Cron daemon not yet initialized, or first run pending
  
  14:45:01  Container 26d4f486003f fires cron
            Tries acquire_lock → succeeds (old lock was released at 13:45!)
            Starts reporting to Stripe...
            ⚡ Container dies AGAIN (unstable period, or another scaling event)
            Stripe reports SENT, but bump() never runs
            Lock stays in Redis for 1 hour TTL
            synced NOT updated
  
  15:45     Container 90b45f917671: Skipped (lock held by dead 26d4f486003f)
  16:45     Still skipped (lock TTL = 1 hour, set at ~14:45, expires ~15:45)
            Wait — actually, 15:45 IS after TTL expiry (14:45 + 1hr = 15:45)
            So either: 
              a) Lock was acquired slightly later (14:45:01 + 3600 = 15:45:01)
              b) The 15:45 job acquired lock, ran, and ALSO got killed
              c) Lock expiry is not exact to the second

  ...eventually: A job succeeds → but synced is still at the 13:45 value
  All usage from 14:45 onward was reported to Stripe without bumping synced
  Next successful bump() reports (current_value - stuck_synced) as delta
  This includes ALL the already-reported usage → DOUBLE BILLING
```

### Why This Correlates With the Anchor Day

The anchor day (~13th) is when billing period boundaries are crossed. This is often when:
1. **More deployments happen** — teams push billing-related fixes around billing dates
2. **Infrastructure load increases** — new billing period triggers extra processing (new meter rows, subscription updates, webhook activity)
3. **Memory pressure spikes** — more data to process = more OOM risk

The Feb 13 timeline shows v0.85.5 deployed that morning and v0.85.6 preparation throughout the day. This deployment activity is the likely cause of container instability.

### Why bump() Is Actually Fine

Looking at the bump() code:
```python
async with engine.core_session() as session:
    for meter in sorted_meters:
        stmt = update(MeterDBE).where(...).values(synced=meter.synced)
        result = await session.execute(stmt)
    await session.commit()
```

This is a simple UPDATE with a single commit. For 9 meters, this takes milliseconds. There's no reason for it to fail on its own. The problem is that **it never gets the chance to run** because the process is killed.

### The Real Fix Needed

Since the failure mode is **process death between Stripe report and DB bump**, the only complete fix is **idempotent Stripe reporting** via the `identifier` field. No amount of retry logic, chunked commits, or lock improvements can protect against a process that simply ceases to exist.

---

## Summary

| Question | Answer |
|----------|--------|
| Why same dates each month? | The customer's billing anchor day (~13th) triggers a period boundary. Deployments and infrastructure changes tend to cluster around these dates, causing container instability. |
| Which commit introduced it? | The bug existed since v0.58.0 (`bf46059b7`, Oct 14), but was triggered by `71079ed3d` (`chore/switch-sessions-to-connections`, Nov 11) which changed DB session handling, making `bump()` failures actually occur. |
| Why does bump() fail? | **It doesn't fail — the process gets killed before bump() runs.** Container restarts (from deployments, OOM, scaling) kill the process after Stripe reports are sent but before synced is persisted. |
| Why does it escalate? | Each cron run reports `value - synced` where `synced` is stuck. As `value` grows with real usage, the delta grows, causing escalating over-billing. |
| Why does it stop? | Eventually a container survives long enough to complete both report AND bump. |
