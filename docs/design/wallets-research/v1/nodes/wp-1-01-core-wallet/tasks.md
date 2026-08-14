# WP-1-01 tasks

Fork point: the reviewed `IM-1-00` seed, on a base containing the metering revisions through
`ee0000000005`.

## Read first

1. `api/ee/databases/postgres/migrations/core_ee/versions/ee0000000003_add_records_ingested_meter.py`
   — the EE migration file shape.
2. `api/ee/src/dbs/postgres/meters/dao.py` — `adjust()` is the existing precedent for an atomic
   conditional write whose `RETURNING` is the decision.
3. The seed's `interfaces.py`, so the ports are implemented rather than redeclared.

## Migration

1. Write `ee0000000006_add_wallet_tables.py` in `core_ee` with `down_revision = "ee0000000005"`.
   Not the parked generic `core/` chain; no OSS wallet table.
2. Create immutable `wallet_credits` and `wallet_debits`, and mutable `wallet_balances`, all with a
   validated logical `organization_id` and no organization FK or cascade.
3. `wallet_balances`: `balance_musd`, nullable `wallet_credit_id`, and the two partial uniques —
   one general row per organization, one row per non-null credit. The non-null credit ID is a
   restrict/no-delete FK to `wallet_credits`.
4. `wallet_debits`: positive `amount_musd`, `debit_kind`, nullable credit FK, posting
   `idempotency_key`, source-composed `debit_key`, resource key and locator, `pricing_version`,
   immutable `data`, timestamps, and `UNIQUE (organization_id, debit_key)` as the final replay guard.
5. Add the selection index that locks candidate per-credit balances in priority, end-time, credit-ID
   order.
6. Hand-check `upgrade` → `downgrade` → `upgrade` against a local EE Postgres. This is a by-hand
   Docker check, never a pytest case.

## Storage and service

1. Add `api/ee/src/dbs/postgres/wallets/` — `dbes.py`, `dbas.py`, `dao.py`, `mappings.py`, package
   initializers. DBE ↔ DTO mapping lives in the DB layer only.
2. Add `api/ee/src/core/wallets/types.py`, `service.py`, and the concrete port adapter; implement the
   seeded `runtime.py` settlement factory. Import the seed contracts; never redefine a stream DTO.
3. Open one session per DAO call at the top of the method and thread it down — no session opened
   inside a loop over credits.

## `check`

1. Implement it write-free: read the organization general balance and floor, reject only when the
   already-committed balance is at or below the floor.
2. Create no hold, debit, allocation or reservation. An accepted variable-cost request may still
   settle below the floor later, and that is intended.
3. Keep it distinct from `check_entitlements` in
   `api/ee/src/core/access/entitlements/service.py`. Different question, different answer; no test
   may assert one through the other.

## `settle(DebitCommandV1)`

1. One transaction. Lock the organization general balance first.
2. If the posting already settled, return the original successful result with no second write.
3. On a first delivery, select unexpired resource-eligible credit balances in priority, end-time,
   credit-ID order, and lock the selected rows in that same stable order.
4. Insert one debit per actual credit source; update the general balance and every selected
   per-credit balance.
5. Create an explicit deficit debit for any allowed remainder.
6. Derive every `debit_key` from the posting key plus its actual source. Never a sequence or a loop
   index.
7. Roll back every debit and balance change on any error. Per-credit balances never go negative; the
   general balance goes below zero only as far as its configured floor permits.
8. Evaluate only code-configured credit applicability against resource key and locator. Recognise no
   model, provider, metric key, gateway kind, or measurement ID.

## Unit tests

1. `api/ee/tests/pytest/unit/wallets/`: no-write check semantics, already-at-floor rejection, replay,
   eligibility and expiry and priority order, split funding, restricted-credit exclusion, deficit
   creation, and source-derived debit keys.
2. Build the ordering fixture so credits tie on priority and end time, forcing the credit-ID tiebreak
   to be the thing under test.

## Integration tests

1. `api/ee/tests/pytest/integration/wallets/`, disposable Postgres: the EE migration applies;
   all-or-nothing rollback; the FK and partial-unique constraints hold.
2. **Competing deliveries cannot overspend one credit.** Budget real time for this one — it is the
   test the design cannot survive failing.

## Close

1. `ruff format` then `ruff check --fix` under `api/`; run both suites.
2. Confirm the diff contains no gateway table, tracing migration, Redis call,
   `worker_streams.py` change, fake gateway, endpoint, or issuance job.
3. Record exact test commands and results, and the migration id, for `IM-1-01`.
