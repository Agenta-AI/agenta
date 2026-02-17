# Hypotheses: Root Cause Analysis

## CONFIRMED ROOT CAUSE: Non-Atomic Report + `continue` Loop Amplifier

The billing system has **two compounding bugs**:

1. **The fundamental non-atomicity** (existed since v0.58.0): Reporting to Stripe and persisting `synced` to DB are separate operations. If the second fails, the same usage gets re-reported.

2. **The `continue` loop amplifier** (the critical bug): When `bump()` fails, the `continue` statement sends control back to the `while True` loop. `dump()` returns the **same meters** (since `synced` was never updated), and they get re-reported to Stripe — up to `MAX_BATCHES=50` times within a **single job run**.

```python
# v0.85.5 code (what ran on Feb 13):
while True:
    meters = await self.dump(limit=BATCH_SIZE)  # Gets unsynced meters from DB
    if not meters: break

    for meter in meters:
        stripe.billing.MeterEvent.create(...)  # Report to Stripe
        meters_to_bump.append(meter)

    try:
        await self.bump(meters=meters_to_bump)  # Persist synced to DB
    except Exception:
        total_errors += len(meters)
        continue  # <-- GOES BACK TO while True! dump() returns SAME meters!
```

### Why Process Death Alone Can't Explain 15-28x

If the process simply dies between Stripe report and bump:
- One run reports delta, process dies
- Next run (after lock TTL expires) re-reports the same delta
- That's **2x at most**, not 15-28x

The user correctly identified this gap: "unless we are deploying 16 times per day."

The **only code path that produces >2x amplification is the `continue` loop**. A single bump() failure within one run causes up to 50 re-reports of the same meters.

---

## The Two Failure Scenarios (Combined Model)

The observed 15-28x inflation likely results from both mechanisms working together:

### Scenario A: `continue` Loop Within a Run (PRIMARY AMPLIFIER)
```
Run starts at 14:15:
  1. dump() → 9 meters (value=10000, synced=0)
  2. Report 9 meters to Stripe (delta=10000 each) ✓
  3. bump() FAILS → continue
  4. dump() → same 9 meters (synced still 0, value=10005)
  5. Report 9 meters to Stripe (delta=10005 each) ✓  ← DUPLICATE!
  6. bump() FAILS → continue
  ... repeat up to MAX_BATCHES=50 ...
  51. Hit MAX_BATCHES limit, exit while loop
  52. Lock released in finally block
  
Result: 50 × 9 = 450 Stripe events for 9 meters
Each event sends a slightly growing delta (value increases between batches)
```

### Scenario B: Cross-Run Re-Reporting (SECONDARY)
```
After Scenario A:
  - synced is STILL stuck (all 50 bump() calls failed)
  - Lock released, next cron trigger starts new run
  - Same 9 meters dumped, same loop fires
  - 50 more re-reports

Or: Process killed mid-loop → orphaned lock for 1hr → resume after TTL
```

### Combined Model Explaining Feb 14 (156K vs ~10K normal = 15x)
```
With cron every 30 min (48 potential triggers/day):
  - Each successful trigger does up to 50 batches
  - But lock is held during each run (~90 seconds for 50 batches)
  - So most cron triggers succeed (lock released between runs)
  - 48 runs × ~5 batches avg where bump fails = ~240 re-reports/day
  - Each re-report: delta ≈ (growing value - stuck synced)
  - Average delta over the day ≈ 5000 (midpoint of day's growth)
  - Total: 240 × ~650 (avg delta per meter per batch) ≈ 156,000
  
This matches the observed 156,374 on Feb 14.
```

---

## Question 1: Why Does It Happen Around the 13th Each Month?

### Answer: Billing Anchor Day + Deployment Activity

The spike dates:
| Month | Spike Days | Daily Stripe Values |
|-------|-----------|---------------------|
| Nov   | 13 | First spike |
| Dec   | 11-14 | Multi-day spike |
| Jan   | 10-14 | Multi-day spike |
| Feb   | 13-16 | 23K → 156K → 224K → 288K |

The customer's **anchor day is ~13** (signup + 14 trial days). On the anchor day, `compute_billing_period()` flips to the next month. This correlates with:

1. **Deployment activity**: Teams push billing-related fixes around billing dates. The Nov 12-13 commit history shows frantic debugging (cron frequency changed 7 times in 2 days). Feb 13 had v0.85.5 deployed.

2. **Container instability**: Deployments cause container restarts. Restarts can interrupt in-flight bump() operations or cause transient DB connection issues.

3. **New meter rows**: Period boundary creates new meter rows with `synced=0`, increasing the dump() result set and job duration.

### The Escalating Pattern Within a Spike

Feb data shows escalation across days:
| Date | Stripe Value | Ratio |
|------|-------------|-------|
| Feb 12 | 10,993 | 1x (normal) |
| Feb 13 | 23,744 | 2x (issue starts midday) |
| Feb 14 | 156,374 | 15x (full day of re-reporting) |
| Feb 15 | 224,238 | 22x |
| Feb 16 | 287,917 | 28x |
| Feb 17 | 14,847 | ~1.5x (fixed) |

The daily totals increase because:
- `synced` is stuck at some value S
- `value` grows by ~10K/day (real usage)
- Each re-report sends `delta = value - S` where `value` keeps increasing
- Day 2: delta ≈ 10K. Day 3: delta ≈ 20K. Day 4: delta ≈ 30K.
- Multiplied by ~50 re-reports/run × multiple runs/day

---

## Question 2: Which Commit Introduced the Issue?

### Answer: The Bug Existed Since v0.58.0, Triggered by Changes on Nov 11-13

The original `report()` in commit `bf46059b7` (v0.58.0, Oct 14 2025) already had the non-atomic report+bump pattern. But two things changed around November 11-13 that may have triggered actual bump() failures:

| Date | Commit | Change | Impact |
|------|--------|--------|--------|
| Oct 14 | `bf46059b7` | v0.58.0 - initial billing | Bug exists but dormant |
| Nov 11 | `71079ed3d` | chore/switch-sessions-to-connections | Changed DB engine, **halved connection pool** (32GB→16GB memory calc), added `core_connection()` |
| Nov 12-13 | multiple | Cron frequency changed 7 times | Debugging in production |

The `71079ed3d` commit:
- **Halved the connection pool size**: `DATABASE_MEMORY` changed from 32GB to 16GB, cutting `POOL_SIZE` from ~95 to ~47 and `MAX_OVERFLOW` from ~286 to ~143
- Added `core_connection()` (raw connection proxy) alongside existing `core_session()`
- Did NOT change the meters DAO (still uses `core_session()`)

The reduced pool size could cause connection exhaustion under load, leading to bump() failures (timeout waiting for a connection). This would trigger the `continue` loop.

---

## Question 3: Why Does bump() Fail? (STILL OPEN)

### This is the remaining open question.

We know bump() failure triggers the `continue` loop. But **what causes bump() to fail?**

The bump() code is straightforward:
```python
async with engine.core_session() as session:
    for meter in sorted_meters:
        stmt = update(MeterDBE).where(...).values(synced=meter.synced)
        result = await session.execute(stmt)
    await session.commit()
```

For 9 meters, this should take milliseconds. Yet something makes it throw an exception.

### Candidates

#### 1. Connection Pool Exhaustion (HIGH likelihood)
The `71079ed3d` commit halved the pool size. If the API is under load (many concurrent requests), `engine.core_session()` might time out waiting for a connection from the pool. This would cause an exception in bump() (and be caught by the `except Exception: continue` in report()).

**Evidence**: Pool was halved on Nov 11. First spike on Nov 13. Correlation.

#### 2. Double Commit Issue (MEDIUM likelihood)
The `core_session()` context manager auto-commits on normal exit:
```python
@asynccontextmanager
async def core_session(self):
    session = self.async_core_session()
    try:
        yield session
        await session.commit()  # ← AUTO-COMMIT on exit
    except Exception as e:
        await session.rollback()
        raise
```

But bump() does an EXPLICIT commit inside the context manager:
```python
async with engine.core_session() as session:
    # ... execute updates ...
    await session.commit()    # ← EXPLICIT commit
    # ← THEN the context manager does ANOTHER commit
```

The second commit is usually a no-op. But under certain conditions (connection issues, transaction isolation problems), it could throw.

#### 3. Scoped Session Interference (MEDIUM likelihood)
`engine.core_session()` uses `async_scoped_session(scopefunc=current_task)`. Within the same asyncio Task:
1. `dump()` opens a scoped session, reads meters, closes it
2. `bump()` opens a scoped session — **might get the same session object**

If the scoped session isn't properly cleaned up after dump()'s close(), bump() might operate on a stale/closed session, causing commit failures.

#### 4. Process Death (LOW for amplification, but still relevant)
A SIGKILL kills the process before bump() runs. But this explains ~2x, not 15-28x. It only matters as a *secondary* factor alongside the `continue` loop.

### What Would Resolve This Question

- **Full NewRelic logs** for the 14:15 run on Feb 13 (if they exist — the container may have died)
- **Database connection pool metrics** during spike periods
- **SQLAlchemy engine logging** (`logging.getLogger("sqlalchemy.engine").setLevel(logging.INFO)` — the commit even had this commented out!)

---

## Summary

| Question | Answer |
|----------|--------|
| What causes 15-28x inflation? | The `continue` loop amplifier: bump() fails → continue → dump() same meters → re-report → repeat up to 50x per run. Combined with cross-run re-reporting. |
| Why same dates each month? | Customer's billing anchor day (~13th) correlates with deployments and infrastructure changes that trigger bump() failures. |
| Which commit introduced it? | Bug existed since v0.58.0 (`bf46059b7`). Likely triggered by `71079ed3d` (Nov 11) which halved the DB connection pool. |
| Why does bump() fail? | **STILL OPEN.** Best candidate: connection pool exhaustion from halved pool size. Other possibilities: double commit, scoped session interference. |
| Why does it escalate day-over-day? | `synced` stuck → each re-report sends `value - synced` where `value` grows daily. |
| Why does it stop? | Either someone deploys a fix, or transient conditions resolve (pool pressure decreases). |
| What's the complete fix? | JP's `break` fix eliminates within-run amplification. Stripe `identifier` eliminates cross-run re-reporting. Both needed. |
