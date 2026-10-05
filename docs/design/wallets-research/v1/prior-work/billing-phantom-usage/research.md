# Research: Code Analysis and Gotchas

## Pattern Analysis

The reported spike dates:
| Month | Spike Days | Pattern |
|-------|-----------|---------|
| November | 13 | Single day |
| December | 11, 12, 13, 14 | 4 days |
| January | 10, 11, 12, 13, 14 | 5 days |
| February | 13, 14, 15, 16 | 4 days |

**Observations:**
1. All spikes occur around the 10th-16th of each month
2. The range varies by 1-3 days between months
3. The "4 days before billing" comment suggests anchor = ~9th (for Nov 13 billing start)

## The "4 Days" Mystery

The user mentioned "before November 13 we had four days before any billing in Stripe."

Current code shows `REVERSE_TRIAL_DAYS = 14`, but if it was previously 4 days:
- Customer signs up Nov 9 → anchor = Nov 13 (day 13)
- Usage from Nov 9-12 → goes to billing period (2024, 11)
- Nov 13 → billing period changes to (2024, 12)

**Question**: Was `REVERSE_TRIAL_DAYS` ever 4 instead of 14?

Git history shows the value was **always 14** since the file was created (Oct 14, 2025).

## Critical Code Paths

### 1. Billing Period Boundary Crossing

When the billing period changes (e.g., on anchor day):

```
Day before anchor (e.g., Nov 12):
  compute_billing_period(anchor=13) → (2024, 11)
  
Day of anchor (e.g., Nov 13):
  compute_billing_period(anchor=13) → (2024, 12)
```

This creates a **new meter row** for the new billing period with `synced=0`.

### 2. The `dump()` Query

```python
stmt = (
    select(MeterDBE)
    .filter(MeterDBE.synced != MeterDBE.value)  # ← Gets ALL unsynced meters
    ...
)
```

This returns meters from **ALL billing periods**, not just the current one.

### 3. The `bump()` Failure Scenario

```python
try:
    await self.bump(meters=meters_to_bump)
except Exception:
    log.error(...)
    total_errors += len(meters)
    continue  # ← Continues to next batch, meter stays unsynced
```

If `bump()` fails after Stripe reports succeed, the meter's `synced` field isn't updated. On the next cron run, the **same delta gets reported again**.

## Suspicious Patterns Found

### 1. Anchor Day Extraction from Stripe

```python
# billing/router.py line 358-361
anchor = datetime.fromtimestamp(
    stripe_event.data.object.billing_cycle_anchor,
    tz=timezone.utc,
).day
```

The `billing_cycle_anchor` from Stripe is a Unix timestamp. Converting to UTC and extracting `.day` could give a different day than what Stripe uses internally if:
- Stripe uses a different timezone for billing periods
- The anchor timestamp is at midnight in a non-UTC timezone

### 2. Meter Period Mismatch

The `adjust()` function computes the billing period at the time of span ingestion:

```python
year, month = compute_billing_period(anchor=anchor)
meter.year, meter.month = year, month
```

But the `report()` function sends **all** unsynced meters to Stripe, regardless of their period:

```python
# No period filtering - reports ALL meters where synced != value
for meter in meters:
    delta = max(meter.value - meter.synced, 0)
    stripe.billing.MeterEvent.create(...)
```

### 3. Anchor Change After Subscription

If a subscription's anchor changes (via Stripe webhook), the billing period computation changes, but **existing meter rows aren't migrated**.

Example scenario:
1. Subscription created with anchor = 13
2. Meters for (2024, 11) have value=1000, synced=1000
3. Stripe webhook updates anchor to 10
4. Next span comes in, billing period now = (2024, 12) instead of (2024, 11)
5. New meter row created for (2024, 12)
6. Old meter row (2024, 11) stays at value=1000, synced=1000 (correct, no issue)

This scenario alone doesn't explain phantom usage.

### 4. Cache Inconsistency

The subscription anchor is cached:

```python
# entitlements.py
subscription_data = await get_cache(
    namespace="entitlements:subscription",
    key=cache_key,
)
# ...
anchor = subscription_data.get("anchor")
```

If the cache has stale anchor data after a Stripe webhook update, the billing period computation could be wrong.

## Stripe MeterEvent Behavior

Stripe's metered billing expects:
- `delta` = usage since last report
- Events are aggregated per billing period

If we report to the **wrong billing period** in Stripe (because our internal computation differs from Stripe's), Stripe might aggregate usage incorrectly.

## Database Queries to Run

```sql
-- Check for meters with unusual patterns
SELECT 
    organization_id,
    key,
    year,
    month,
    value,
    synced,
    (value - synced) as unreported_delta
FROM meters
WHERE synced != value
ORDER BY organization_id, year, month;

-- Check subscription anchors
SELECT 
    organization_id,
    anchor,
    created_at
FROM subscriptions
WHERE anchor IS NOT NULL;

-- Check for multiple meter rows per org per key (different periods)
SELECT 
    organization_id,
    key,
    COUNT(*) as period_count
FROM meters
GROUP BY organization_id, key
HAVING COUNT(*) > 1;
```
