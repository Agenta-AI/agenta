# Context: Agenta Billing System

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BILLING DATA FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  [Span Ingestion]                                                            │
│        │                                                                     │
│        ▼                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │ OTLP Router │───►│ Redis Queue │───►│   Worker    │───►│   Meters    │  │
│  │ (Layer 1)   │    │             │    │  (Layer 2)  │    │   (DB)      │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
│                                                                    │        │
│                                                                    ▼        │
│                                                           ┌─────────────┐   │
│                                                           │  Cron Job   │   │
│                                                           │ (30 min)    │   │
│                                                           └─────────────┘   │
│                                                                    │        │
│                                                                    ▼        │
│                                                           ┌─────────────┐   │
│                                                           │   Stripe    │   │
│                                                           │  MeterEvent │   │
│                                                           └─────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Meters Table Schema

```sql
CREATE TABLE meters (
    organization_id UUID,
    key ENUM('traces', 'evaluations', 'credits', 'users', 'applications'),
    year SMALLINT,      -- Billing period year (0 for gauges)
    month SMALLINT,     -- Billing period month (0 for gauges)
    value BIGINT,       -- Current usage count
    synced BIGINT,      -- Last reported to Stripe
    PRIMARY KEY (organization_id, key, year, month)
);
```

### 2. Billing Period Computation

From `api/ee/src/utils/billing.py`:

```python
def compute_billing_period(*, now=None, anchor=None) -> Tuple[int, int]:
    if now is None:
        now = datetime.now(timezone.utc)

    if not anchor or now.day < anchor:
        return now.year, now.month

    # Advance to next month if day >= anchor
    if now.month == 12:
        return now.year + 1, 1
    else:
        return now.year, now.month + 1
```

**Example** (anchor = 13):
- Nov 12 → billing period (2024, 11)
- Nov 13 → billing period (2024, 12) ← Period advances!

### 3. Anchor Day Setting

When a subscription is created (reverse trial):

```python
# api/ee/src/core/subscriptions/service.py
now = datetime.now(tz=timezone.utc)
anchor = now + timedelta(days=REVERSE_TRIAL_DAYS)  # REVERSE_TRIAL_DAYS = 14

subscription = await self.create(
    subscription=SubscriptionDTO(
        organization_id=organization_id,
        plan=FREE_PLAN,
        active=True,
        anchor=anchor.day,  # Just the day number (1-31)
    )
)
```

### 4. Meter Adjustment (Span Counting)

From `api/ee/src/dbs/postgres/meters/dao.py`:

```python
async def adjust(self, *, meter, quota, anchor):
    # Compute billing period
    if quota.monthly:
        year, month = compute_billing_period(anchor=anchor)
        meter.year, meter.month = year, month

    # Atomic upsert
    stmt = (
        insert(MeterDBE)
        .values(
            organization_id=meter.organization_id,
            key=meter.key,
            year=meter.year,
            month=meter.month,
            value=desired_value,
            synced=0,  # ← Always 0 on INSERT
        )
        .on_conflict_do_update(
            set_={"value": func.greatest(MeterDBE.value + meter.delta, 0)}
            # synced is NOT updated on conflict
        )
    )
```

### 5. Stripe Reporting Cron

From `api/ee/src/core/meters/service.py`:

```python
async def report(self):
    # Get all meters where synced != value
    meters = await self.dump(limit=BATCH_SIZE)
    
    for meter in meters:
        delta = max(meter.value - meter.synced, 0)
        
        if delta == 0:
            continue
            
        # Report to Stripe
        stripe.billing.MeterEvent.create(
            event_name="traces",
            payload={"delta": delta, "customer_id": customer_id},
        )
        
        meters_to_bump.append(meter)
    
    # Update synced = value
    for meter in meters_to_bump:
        meter.synced = meter.value
    
    await self.bump(meters=meters_to_bump)
```

## Key Files

| File | Purpose |
|------|---------|
| `api/ee/src/utils/billing.py` | Billing period computation |
| `api/ee/src/utils/entitlements.py` | Entitlement checking + meter adjustment |
| `api/ee/src/core/meters/service.py` | Meter reporting to Stripe |
| `api/ee/src/dbs/postgres/meters/dao.py` | Meter DB operations (adjust, dump, bump) |
| `api/ee/src/core/subscriptions/service.py` | Subscription creation + anchor setting |
| `api/ee/src/core/subscriptions/types.py` | `REVERSE_TRIAL_DAYS = 14` |
| `api/ee/src/apis/fastapi/billing/router.py` | Billing API endpoints |
| `api/ee/src/crons/meters.sh` | Cron script for reporting |
