# IM-1-01 specification: foundation fan-in review

Merge and review the core-settlement package and the measurement-chain package. This is the review
that has to catch a divergence between two worktrees that could not see each other.

## What must be true to merge

| Check | How to verify |
| --- | --- |
| Migrations do not conflict | `core_ee` is `ee0000000006` after `ee0000000005`; `tracing_ee` is `ee0000000002` after `ee0000000001`; neither touches a parked `core/` or `tracing/` chain |
| Both migrations reverse | `upgrade` → `downgrade` → `upgrade` by hand against a local EE Postgres, both chains |
| Ownership held | the two diffs are disjoint except for seed imports; only `WP-1-02` touched `api/entrypoints/worker_streams.py` |
| Engines are right | wallet DAO on `TransactionsEngine`, measurements DAO on `AnalyticsEngine` |
| The boundary held | the measurement worker imports no core wallet DAO or service; the wallet service imports no measurement table |
| The debit contract is the seed's | the message `WP-1-02` publishes is exactly the envelope `WP-1-01`'s posting DTO accepts — compare field by field |
| No pricing in the wallet | the wallet package derives no amount from tokens, duration, or provider data |
| Constraints exist | `UNIQUE (organization_id, debit_key)` and both partial uniques on `wallet_balances` are in the migration, not only in the specification |
| Attribution rule held | no FK on any `organization_id`; no `organization_id` column on `measurements` |
| Tests pass | both unit suites, and both Postgres integration suites |
| The concurrency test is real | read it: N workers, one under-covering credit, per-credit projection never negative |

## Output

A reviewed branch, and the record of what was checked, released to `WP-1-03`.
