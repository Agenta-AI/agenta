# Status

## Current Status: ROOT CAUSE CONFIRMED — Docs Updated (2026-02-17)

### Root Cause (Corrected)

**The `continue` loop amplifier is the primary mechanism**, not process death alone.

When `bump()` fails (throws an exception), the `continue` statement sends control back to `while True`. `dump()` returns the same meters (synced unchanged), and they get re-reported to Stripe — up to 50 times within a single job run. Combined with cross-run re-reporting (when synced never gets updated), this produces the observed 15-28x inflation.

Process death alone would give ~2x at most (one failed run + one re-report on the next successful run). The `continue` loop is the only code path that can produce the observed amplification.

### Remaining Open Question

**What causes bump() to initially fail?** The bump() code is a simple UPDATE + commit of ~9 rows, which should take milliseconds. Candidates:

1. **Connection pool exhaustion** (HIGH) — The `71079ed3d` commit on Nov 11 halved the DB pool size (32GB→16GB memory calc). Under load, `core_session()` might timeout waiting for a connection.
2. **Double commit in core_session()** (MEDIUM) — bump() does an explicit commit, then the context manager does another auto-commit on exit. Edge cases could cause the second commit to throw.
3. **Scoped session interference** (MEDIUM) — dump() and bump() share the same scoped session (same asyncio Task). If cleanup isn't perfect, bump() could operate on stale state.

We cannot confirm without full logs from the 14:15 run on Feb 13 (container died, logs lost).

---

## Completed

- [x] Researched and documented full billing system architecture
- [x] Traced git history to find what changed Nov 11-13
- [x] Analyzed Stripe meter event summaries and NewRelic logs from JP
- [x] Identified root cause: non-atomic report/bump + `continue` loop amplifier
- [x] Explained why process death alone can't account for 15-28x (user's insight)
- [x] Explained why it recurs monthly (anchor day + deployment activity)
- [x] Reviewed PR #3769 in detail
- [x] Confirmed Stripe `identifier` field exists and provides 24hr dedup
- [x] Created investigation docs, pushed to branch `docs/billing-phantom-usage-investigation`
- [x] Updated docs with corrected root cause analysis

## Recommendations

### For PR #3769 (JP's Fix)
**Merge it.** The `break` instead of `continue` eliminates the within-run amplification loop — this is the most critical fix. The lock ownership improvements and chunked bump are also valuable.

### Follow-Up: Add Stripe `identifier` (Critical)
Open a follow-up PR to add idempotent Stripe reporting:
```python
stripe.billing.MeterEvent.create(
    event_name=event_name,
    payload={"delta": delta, "customer_id": customer_id},
    identifier=f"{org_id}:{key}:{year}:{month}:{synced}:{value}",
)
```
This eliminates cross-run re-reporting entirely. Even if a process dies between Stripe report and bump, the duplicate event is rejected by Stripe within 24 hours.

### Follow-Up: Investigate bump() Failure Trigger (Nice to Have)
Understanding WHY bump() fails would help prevent future issues. Suggestions:
- Enable SQLAlchemy engine logging temporarily in production
- Monitor connection pool utilization during billing runs
- Review if the halved pool size from `71079ed3d` should be reverted

### Customer Remediation
For affected customers:
1. Calculate total over-reported amount from Stripe meter event summaries
2. Issue credit or adjust next invoice
3. Consider using Stripe's void/cancel meter events if within correction window

---

## Timeline

| Date | Action |
|------|--------|
| 2026-02-13 | Spike observed in production (v0.85.5 deployed that morning) |
| 2026-02-16 | JP begins investigation, gathers Stripe data and NewRelic logs |
| 2026-02-17 | Investigation docs created, root cause identified |
| 2026-02-17 | PR #3769 reviewed |
| 2026-02-17 | Corrected analysis: `continue` loop is the amplifier, not process death |
