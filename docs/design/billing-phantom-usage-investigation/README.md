# Billing Phantom Usage Investigation

## Problem Statement

Two customers are seeing usage in Stripe that does **not exist in the database**. The pattern:

| Date Range | Observation |
|------------|-------------|
| November 13 | Spike of spans added |
| December 11-14 | Spike of spans added |
| January 10-14 | Spike of spans added |
| February 13-16 | Spike of spans added (23K → 156K → 224K → 288K vs ~10K normal) |

## Root Cause (Confirmed)

**The `continue` loop amplifier**: When `bump()` fails (persisting `synced` to DB after reporting to Stripe), the `continue` statement sends control back to the `while True` loop. `dump()` returns the same meters (since `synced` was never updated), and they get re-reported to Stripe — up to **50 times within a single job run** (MAX_BATCHES=50).

This is NOT simple process death (which would give ~2x). The `continue` loop is the only code path that produces the observed 15-28x amplification.

**JP's PR #3769** correctly fixes this by changing `continue` to `break`. The remaining gap is cross-run re-reporting, fixable with Stripe's `identifier` field for idempotent event dedup.

## Workspace Contents

| File | Description |
|------|-------------|
| [context.md](./context.md) | Background on the billing system architecture |
| [research.md](./research.md) | Deep dive into code, caveats, and gotchas |
| [hypotheses.md](./hypotheses.md) | Root cause analysis — `continue` loop amplifier + open questions |
| [pr-3769-review.md](./pr-3769-review.md) | Detailed review of JP's fix PR |
| [status.md](./status.md) | Current progress, recommendations, and next steps |

## Key Findings

1. **The `continue` loop** in `report()` turns a single `bump()` failure into 50x re-reporting within one run
2. **JP's `break` fix** (PR #3769) eliminates this amplification — **merge it**
3. **Stripe `identifier`** would make reporting fully idempotent — needed as follow-up
4. **Still open**: What causes `bump()` to fail? Best candidate: connection pool exhaustion from halved pool size (`71079ed3d`, Nov 11)
