# Track B — tasks

Execution order for `feat/metering-track-b`. Safety tag before re-partition:
`safety-track-b-pre-repartition`.

## B1 — enum + quota swap
- [ ] `api/ee/src/core/access/entitlements/types.py`: remove the 4 `*_SECONDS`
      `Counter` members; add the 8 `*_DEBITS` members (values lowercase).
- [ ] Same file: per plan, remove `*_SECONDS` quotas; add the 8 `*_DEBITS`
      quotas as `Quota(period=Period.MONTHLY)` with the `TODO(pricing)` note.
- [ ] Same file: update `DEFAULT_CATALOG` pricing-TODO comments
      (`sandbox_debits`, prepaid/no-REPORTS).
- [ ] Grep the file for any remaining `*_SECONDS` reference (constraints /
      read-only lists) and swap to the `*_DEBITS` set.
- [ ] `api/ee/src/core/meters/types.py`: mirror the member swap in `Meters`.

## B2 — migrations
- [ ] Add `ee0000000005` migration: 8 uppercase `*_DEBITS` `ADD VALUE IF NOT
      EXISTS` labels; docstring "add sandbox + wallet debit meters to
      meters_type"; revises `ee0000000004`.
- [ ] `ee0000000004_add_sandbox_and_storage_meters.py`: delete the 4
      `*_SECONDS` `ADD VALUE` lines; keep `BYTES`.

## B3 — measurement-only service
- [ ] `api/ee/src/core/sandboxes/service.py`: remove the `meter_deltas`
      `*_SECONDS` block from `record_usage()`; do NOT add a sink call; drop
      now-unused imports.

## B4 — Daytona poll idempotency
- [ ] Read the current poll path (`service.py` / `router.py`); confirm whether
      delta adjustment diffs provider-cumulative totals against the meter.
- [ ] If confirmed: make the poll idempotent (diff cumulative totals, adjust
      the positive delta only); unit-test overlapping-window redelivery.

## B5 — verify + commit
- [ ] `grep -rn "SECONDS" api/ee/src/core api/ee/databases` → no sandbox
      seconds meter references remain.
- [ ] `grep -rn "record_usage_credits\|record_usage_debits\|sink"
      api/ee/src/core/sandboxes/service.py` → empty.
- [ ] ruff format + check on touched files.
- [ ] Run the existing sandbox metering unit tests (skip gating tests — they
      live in Track C and are expected red here only if they import removed
      members; they should not, since sink/gating files are absent on B).
- [ ] Commit on `feat/metering-track-b` (conventional message, e.g.
      `refactor(metering): define wallet debit meters, drop seconds meters`).
