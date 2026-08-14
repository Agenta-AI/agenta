# WP-1-01 specification: EE core wallet settlement

## Boundary and prerequisites

Fork only from the reviewed `IM-1-00` seed, after its base contains the metering revisions through
`ee0000000005`. This package owns the `core_ee` migration
`api/ee/databases/postgres/migrations/core_ee/versions/ee0000000006_add_wallet_tables.py`, whose
`down_revision` is exactly `ee0000000005`. It must not use the parked generic core chain or create an
OSS wallet table.

It owns the transaction behind `WalletCheckPort` and `WalletSettlementPort`; it does not own a Redis
consumer, measurement persistence, managed-gateway code, provider pricing, or worker registration.

## Owned code and schema

Create the EE domain/persistence paths `api/ee/src/core/wallets/types.py`, `service.py`, and the
concrete port adapter, plus `api/ee/src/dbs/postgres/wallets/dbes.py`, `dbas.py`, `dao.py`,
`mappings.py`, and package initializers. These paths may import the seed contracts but must not redefine
their stream DTOs.

The migration creates immutable `wallet_credits` and `wallet_debits`, and mutable
`wallet_balances`. All use validated logical `organization_id`, no organization FK/cascade.
`wallet_balances` has `balance_musd`, nullable `wallet_credit_id`, and partial uniqueness for exactly
one general row per organization plus one row per non-null credit. The non-null credit ID is a
restrict/no-delete FK to `wallet_credits`. Credits/debits are never updated or cascaded away.

`wallet_debits` has a positive `amount_musd`, `debit_kind`, nullable credit FK, posting
`idempotency_key`, source-composed `debit_key`, resource key/locator, pricing version, immutable data,
and lifecycle timestamps. `UNIQUE (organization_id, debit_key)` is the final replay guard. Add the
selection index needed to lock candidate per-credit balances by priority, end time, then credit ID.

## Operations and invariants

`check` is deliberately non-strict and write-free. It reads the organization general balance/floor and
rejects only when the already-committed balance is at or below its allowed floor. It creates no hold,
debit, credit allocation, or reservation; an accepted variable-cost request can still settle later
below the floor.

`settle(DebitCommandV1)` is one database transaction. Lock the organization general balance first.
If the posting was already settled, return the original successful result without another write. On a
first delivery, select unexpired resource-eligible credit balances in priority/end-time/credit-ID
order; lock selected rows in that stable order; insert one debit per actual credit source; update the
general balance and every selected per-credit balance; then create an explicit deficit debit for any
allowed remainder. Any error rolls back every debit/balance change. Per-credit balances never go
negative; the general balance may go only as far below zero as its configured floor permits.

The service evaluates only code-configured credit applicability against resource key/locator. It does
not recognise individual models, providers, metric keys, gateway kinds, or a measurement ID.

## Required evidence

Create `api/ee/tests/pytest/unit/wallets/` tests for no-write check semantics, already-at-floor
rejection, replay, eligibility/expiry/priority order, split funding, restricted-credit exclusion,
deficit creation, and source-derived debit keys. Create
`api/ee/tests/pytest/integration/wallets/` disposable-Postgres tests proving the EE migration applies,
all-or-nothing rollback, FK/partial-unique constraints, and competing deliveries cannot overspend one
credit. Record exact test commands/results for `IM-1-01`.

## Explicit exclusions

No gateway table, tracing migration, Redis call, `worker_streams.py` change, fake gateway, live
provider, wallet API endpoint, rollover/credit issuance job, or L1/concurrency implementation belongs
in this package.
