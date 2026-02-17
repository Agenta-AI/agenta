# Billing Phantom Usage Investigation

## Problem Statement

Two customers are seeing usage in Stripe that does **not exist in the database**. The pattern:

| Date Range | Observation |
|------------|-------------|
| November 13 | Spike of spans added |
| December 11-14 | Spike of spans added |
| January 10-14 | Spike of spans added |
| February 13-16 | Spike of spans added |

**Key context**: Before November 13, there was a "4-day buffer before any billing in Stripe."

## Workspace Contents

| File | Description |
|------|-------------|
| [context.md](./context.md) | Background on the billing system architecture |
| [research.md](./research.md) | Deep dive into code, caveats, and gotchas |
| [hypotheses.md](./hypotheses.md) | Potential root causes with investigation steps |
| [status.md](./status.md) | Current progress and next steps |

## Quick Summary

The billing system uses:
1. **Meters table** with `(organization_id, key, year, month)` composite key
2. **`value`** field incremented on span ingestion
3. **`synced`** field tracking what's been reported to Stripe
4. **Cron job** every 30 min reports `delta = value - synced` to Stripe

The suspicious pattern of dates (~10th-16th of each month) suggests an issue with:
- Billing period anchor day computation
- Timezone handling between Agenta and Stripe
- Possible double-reporting on billing period boundaries
