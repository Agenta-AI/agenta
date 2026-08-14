# IM-1-02 acceptance procedure: local deployment

Run this on a LOCAL DEPLOYMENT you own (not the shared EE dev stack on `localhost:5432`
used by other worktrees — pick a distinct `COMPOSE_PROJECT_NAME` / env file per
`hosting/AGENTS.md`). Every step is self-contained; no other document is required.

## HANDOFF: three unresolved items IM-1-02 conditioned its approval on — ALL THREE CLOSED (WP-1-04)

IM-1-02 was approved to merge on the condition that these three items carry forward, verbatim and
unmissable, to whoever runs this deployment or picks up the next wave. WP-1-04 (`wallets/wp-1-04-provisioning`)
closed all three; the original text is kept below for the record, with a CLOSED note on each.

**(i) Wallet general-balance provisioning is a poison-message gap.** NOTHING in this repository
provisions a `wallet_balances` general row (`wallet_credit_id IS NULL`) for any organization, and
`WalletGeneralBalanceNotFoundError` is treated as retryable (caught by `DebitWorker`'s broad
`except Exception`), so a debit for an unprovisioned organization redelivers indefinitely — a
poison message that wedges redelivery for that message without corrupting anything or blocking
other messages. The two legitimate remedies are (a) auto-provisioning the general balance row at
organization creation, or (b) reclassifying `WalletGeneralBalanceNotFoundError` as terminal/alerted
instead of infinite silent retry. That is a provisioning-design decision for a later wave, not a
one-line patch. See step 2 and step 8 below for where this surfaces during acceptance.

> **CLOSED (remedy a, plus a backfill for pre-existing organizations).**
> `ee.src.core.organizations.service.provision_signup_subscription` / `provision_user_subscription`
> now call `WalletsService.provision_general_balance` (via `ee.src.core.wallets.runtime.get_wallets_service`)
> after subscription provisioning, in its own transaction, idempotently guarded by the partial
> unique index `uq_wallet_balances_org_general`. Migration `ee0000000005_backfill_wallet_general_balances.py`
> backfills the row for every organization that predates this change. Manual step 2 below is
> therefore no longer required on a deployment built from this revision forward, but is left as-is
> for deployments built from an older revision.

**(ii) `WalletCheckPort.check` accepts `amount_musd` and never reads it.** The non-strict admission
predicate (`ee/src/core/wallets/service.py`) rejects only on already-committed balance versus floor;
the request's own `amount_musd` argument is dead — deliberately, per the non-strict design (variable
cost is priced after the fact, at `settle()`), but the signature still advertises a parameter the
implementation ignores. Flagged here so a caller does not assume passing a larger `amount_musd`
changes the admission outcome.

> **CLOSED (parameter dropped, not just unused).** `WalletCheckPort.check` / `WalletsService.check`
> no longer take `amount_musd` at all — the signature is now `check(*, organization_id) -> bool`. A
> future L1 exposure-estimate check would reintroduce an amount deliberately, with reservation
> semantics behind it; until then no signature advertises a parameter nothing honours.

**(iii) `WalletsService._run_blocking` spins a fresh thread pool and event loop per call.** When
called from a running event loop, it submits `asyncio.run(coro)` to a brand-new
single-worker `ThreadPoolExecutor` on every invocation rather than reusing one loop/pool across
calls. The running-loop branch is untested against a real engine, and asyncpg loop-affinity (a
connection/pool bound to the loop that created it) may be unsafe across that thread boundary. This
has not been exercised against `TransactionsEngine` under load.

> **CLOSED (deleted, not fixed).** `check` is now `async def` end to end — it directly `await`s the
> DAO, matching every other streams: worker/service in the repo. `_run_blocking` (and its
> `ThreadPoolExecutor`/`asyncio.run` bridge) no longer exists; there is nothing left to be unsafe
> across a thread boundary.

**All integration tests in this wave are WRITTEN BUT NOT RUN.** The review worktree is not allowed
to touch the shared EE dev stack, so every suite below needs a real Postgres + Redis run on the
deployment this procedure stands up. Run them in this order — the first is the one that matters
most:

1. `ee/tests/pytest/integration/wallets/test_wallets_settlement_concurrency_postgres.py::test_competing_deliveries_cannot_overspend_one_credit`
   — **run this first.** It is the concurrency guarantee itself: proves competing deliveries cannot
   overspend one credit. Sufficient on its own to catch a broken locking strategy.
2. `ee/tests/pytest/integration/wallets/test_wallets_migration_postgres.py` — FK restrict behavior,
   check constraints, partial unique indexes, all-or-nothing rollback.
3. `ee/tests/pytest/integration/wallets/test_wallets_debit_worker_integration.py::test_duplicate_debit_command_produces_one_financial_effect`
   — debit worker against real Postgres: duplicate delivery produces one financial effect.
4. `ee/tests/pytest/integration/measurements/test_measurements_integration.py` — measurement worker
   against real Postgres/tracing + Redis: full consume-persist-publish chain, and convergence after a
   transient debit-publish failure.

Exact commands, and the failure meaning of each, are in step 9 below.

## 0. Bring up the EE dev stack

`run.sh` resolves a bare (no-slash) `--env-file` name relative to the edition directory
(`./hosting/docker-compose/<license>/<name>`, see `hosting/docker-compose/run.sh`), so the copy
must land inside `hosting/docker-compose/ee/`, not the repo root — copying it to the repo root
and passing the same bare name silently makes `run.sh` fall through to its committed default
env file instead of this one. Load the same file into the shell with `load-env` (a user-profile
shell function per root `AGENTS.md` "Local dev loop") before running the pytest commands in step
9, so `POSTGRES_URI`/`REDIS_URI_DURABLE`/etc. are set for the test process.

```bash
cp hosting/docker-compose/ee/env.ee.dev.example \
   hosting/docker-compose/ee/.env.ee.dev.wallets-im-1-02
# edit the copy only if a port/project-name collides with another running instance

load-env hosting/docker-compose/ee/.env.ee.dev.wallets-im-1-02

COMPOSE_PROJECT_NAME=agenta-ee-dev-wallets-im-1-02 \
  ./hosting/docker-compose/run.sh --ee --dev \
  --env-file .env.ee.dev.wallets-im-1-02 --build
```

The `alembic` compose service runs `python -m ee.databases.postgres.migrations.runner` on
every start, which in order applies: `core` -> `core_oss` -> `core_ee` -> `tracing` ->
`tracing_oss` -> `tracing_ee`. There is no manual alembic invocation.

**Applied revisions to verify (both chains must reach these heads):**

```bash
docker compose -p agenta-ee-dev-wallets-im-1-02 exec postgres \
  psql -U username -d agenta_ee_core -c \
  "select version_num from alembic_version_core_ee;"
# expect: ee0000000005  (add_wallet_tables -> backfill_wallet_general_balances; WP-1-04)

docker compose -p agenta-ee-dev-wallets-im-1-02 exec postgres \
  psql -U username -d agenta_ee_tracing -c \
  "select version_num from alembic_version_tracing_ee;"
# expect: ee0000000002  (add_measurements)
```

**Failure meaning:** a lower revision means the wallet/measurement tables do not exist
yet — every later step will fail with `relation does not exist`. A revision that fails to
apply (alembic container exits non-zero) means a migration bug; check `docker compose logs
alembic`, do not skip ahead.

## 1. Confirm both new workers are running

The default `AGENTA_WORKER_STREAMS=""` in `docker-compose.dev.yml` selects
`ALL_STREAMS`, which is `("records", "events", "spans", "measurements", "debits")` in the
EE edition — both new workers already run inside the single `worker-streams` container. To
isolate just the two wallet streams (e.g. to watch their logs without records/events/spans
noise), override:

```bash
AGENTA_WORKER_STREAMS=measurements,debits
```

Set it in the env file, or for a one-off:

```bash
docker compose -p agenta-ee-dev-wallets-im-1-02 exec worker-streams env | grep AGENTA_WORKER_STREAMS
docker compose -p agenta-ee-dev-wallets-im-1-02 logs worker-streams | grep -E "STREAMS|WALLETS|MEASUREMENTS"
```

Expect one `[STREAMS] Starting worker-streams selected=[...]` log line listing
`measurements` and `debits` (or all five, if left unset), and no traceback.

**Failure meaning:** if `measurements`/`debits` are missing from `selected=`, the env var
is wrong or the container is not on the EE image (`is_ee()` false). If the container
crash-loops, read the traceback — a missing `ee.*` import in an OSS-built image is the most
likely cause and would itself be a P0 finding.

## 2. Provision a general wallet balance row (automatic as of WP-1-04; manual fallback kept below)

**CLOSED as of WP-1-04:** organization creation (`provision_signup_subscription` /
`provision_user_subscription` in `ee/src/core/organizations/service.py`) now provisions the
general `wallet_balances` row itself, and migration `ee0000000005_backfill_wallet_general_balances.py`
backfills it for organizations created before this revision. On a deployment built from this
revision forward, every organization created via the admin endpoint already has its general row —
this step's manual SQL is unnecessary; skip straight to step 3. The rest of this section is kept
for a deployment built from an older revision (before WP-1-04), where the gap still applies as
originally documented:

**Known gap (pre-WP-1-04 deployments only):** nothing in that revision inserts a `wallet_balances`
general row (`wallet_credit_id IS NULL`) for an organization. `WalletGeneralBalanceNotFoundError`
is documented in `ee/src/core/wallets/types.py` as an explicit out-of-scope provisioning
job. Every organization used in this procedure needs its general row inserted by hand. Skipping
this step means the debit worker will retry the debit message forever (see the poison-message
finding in the node report) — the message never ACKs and the stream entry never leaves pending,
but nothing else breaks.

Get (or create) an organization/project via the admin endpoint per `AGENTS.md` §"Local dev
loop", then:

```sql
-- run against agenta_ee_core
insert into wallet_balances (id, organization_id, wallet_credit_id, balance_musd, floor_musd, created_at)
values (gen_random_uuid(), '<organization_id>', null, 0, -1000000, now());
```

`floor_musd = -1000000` lets the general balance go deep into deficit so every fake-gateway
debit in this procedure settles without needing a `wallet_credits` row too (it lands as a
`deficit`-sourced debit, `wallet_credit_id IS NULL`).

**Failure meaning:** a unique-violation on this insert means the row already exists (fine,
skip). Any other error means the migration in step 0 did not actually apply — go back.

## 3. Trigger the fake LLM path

The fake LLM/MCP calls are wallet-owned test support
(`ee/tests/pytest/acceptance/wallets/fakes/`), not an HTTP endpoint — no gateway request
route exists yet (out of scope for Wave 1; see `wave-1.md`). Drive them directly against
the running Redis with a one-off script inside the `api` container:

```bash
docker compose -p agenta-ee-dev-wallets-im-1-02 exec -T api python <<'PY'
import asyncio
from uuid import UUID
from ee.src.core.wallets.streaming import RedisMeasurementPublisher
from ee.tests.pytest.acceptance.wallets.fakes.llm import run_fake_llm_request

async def main():
    result = await run_fake_llm_request(
        project_id=UUID("<project_id>"),
        publisher=RedisMeasurementPublisher(),
    )
    print("published:", result.published)
    print("measurement_id:", result.measurement_command.measurement_id)

asyncio.run(main())
PY
```

`published: True` means the `XADD` to `streams:measurements` succeeded — this is the
producer-side commit point. Note the printed `measurement_id`; you will query for it.

**Failure meaning:** `published: False` means Redis was unreachable or the XADD itself
failed — per `wave-1.md`, this is the ONE intentional loss boundary: no measurement row
will ever be written and no debit will ever be charged for this call. That is correct
behavior, not a bug, as long as the caller's own fake-LLM result (`result.managed_result`)
is unaffected — confirm it printed regardless.

## 4. Trigger the fake MCP path

Same shape, swap the fake:

```bash
docker compose -p agenta-ee-dev-wallets-im-1-02 exec -T api python <<'PY'
import asyncio
from uuid import UUID
from ee.src.core.wallets.streaming import RedisMeasurementPublisher
from ee.tests.pytest.acceptance.wallets.fakes.mcp import run_fake_mcp_request

async def main():
    result = await run_fake_mcp_request(
        project_id=UUID("<project_id>"),
        publisher=RedisMeasurementPublisher(),
    )
    print("published:", result.published)
    print("measurement_id:", result.measurement_command.measurement_id)

asyncio.run(main())
PY
```

## 5. Prove one measurement, one set of measurement_values, one debit, and the balance change

Wait a few seconds (worker batch window is `max_delay_ms=250ms`, well under a second in
practice; a couple of seconds covers scheduling jitter), then:

```sql
-- agenta_ee_tracing: exactly one measurement row per fake call
select id, measurement_id, gateway_kind, resource_key, endpoint_kind
from measurements where measurement_id = '<measurement_id from step 3 or 4>';

-- agenta_ee_tracing: its component values (4 rows for LLM: request_count, input_tokens,
-- cached_tokens, output_tokens; 1 row for MCP: request_count)
select key, value, cost_musd from measurement_values
where measurement_id = (select id from measurements where measurement_id = '<measurement_id>');
```

```sql
-- agenta_ee_core: exactly one debit for this posting (idempotency_key = "measurement:<measurement_id>")
select id, debit_kind, amount_musd, wallet_credit_id, idempotency_key, debit_key
from wallet_debits where idempotency_key = 'measurement:<measurement_id>';
-- expect exactly 1 row, wallet_credit_id IS NULL (deficit-funded, per step 2's floor)

-- balance moved by exactly amount_musd
select balance_musd from wallet_balances
where organization_id = '<organization_id>' and wallet_credit_id is null;
```

Expected LLM amount: `ceil((1200*0.2 + 1000*0.02 + 380*2.0) * 1.05)` musd (fixture rates in
`ee/tests/pytest/acceptance/wallets/fakes/llm.py`, markup in
`ee/src/core/measurements/pricing.py`) = `ceil((240+20+760)*1.05)` = `1071` musd.
Expected MCP amount: `50` musd (flat `FIXTURE_MCP_RATE_MUSD_PER_REQUEST`).

**Failure meaning:**
- No measurement row: the measurement worker did not consume/insert — check `docker
  compose logs worker-streams` for `[MEASUREMENTS]` tracebacks, and confirm the stream
  actually received the entry (`XLEN streams:measurements` in `redis-cli`).
- Measurement row exists but no debit and no `measurement_values`-empty: check
  `calculate_fake_charge` was reached and `endpoint_kind == "managed"` (it is, in both
  fakes) — if amount is `None`, no debit is correct, not a bug.
- Debit row missing but measurement exists: the measurement worker's publish to
  `streams:debits` failed after the tracing write already committed — this is the
  documented "measurement with no debit" possibility only when pricing legitimately
  returns `None`; for a `managed` fake call it should never happen, so treat it as a bug
  and check `[MEASUREMENTS] Debit publish failed, leaving message pending` in the logs
  (the measurement message stays pending and will redeliver; the tracing row is not
  rolled back — this is intended per the module docstring in
  `ee/src/tasks/asyncio/measurements/worker.py`).
- More than one debit row for the same `idempotency_key`, or a balance change that isn't
  exactly `amount_musd`: the settlement transaction or the replay check is broken — this
  is a P0, stop and escalate.

## 6. Prove idempotency: replay the same measurement, expect no second financial effect

Redeliver the exact same debit posting by re-running the measurement worker's own publish
path is not directly triggerable (the measurement worker only republishes on measurement
redelivery, and measurement inserts are themselves idempotent on `measurement_id`). The
sharper and more direct proof is to replay the DEBIT message itself, which is what
`WalletSettlementPort.settle` guarantees is safe:

```bash
docker compose -p agenta-ee-dev-wallets-im-1-02 exec -T redis redis-cli \
  XRANGE streams:debits - + COUNT 5
# Copy the `data` field bytes of the entry for your idempotency_key (or, simpler: use
# XADD to publish a byte-identical DebitCommandV1 envelope — same idempotency_key,
# same amount_musd, same everything — via the RedisDebitPublisher, exactly as the
# measurement worker would on a duplicate delivery):
```

```bash
docker compose -p agenta-ee-dev-wallets-im-1-02 exec -T api python <<'PY'
import asyncio
from datetime import datetime, timezone
from uuid import UUID
from ee.src.core.wallets.contracts import DebitCommandV1, DebitKind
from ee.src.core.wallets.streaming import RedisDebitPublisher

async def main():
    command = DebitCommandV1(
        idempotency_key="measurement:<measurement_id>",  # SAME key as step 3/4
        organization_id=UUID("<organization_id>"),
        debit_kind=DebitKind.GATEWAY_USAGE,
        amount_musd=1071,  # SAME amount as the original posting
        pricing_version="wallet-v1-fake-1",
        resource_key="llm:google:gemini-2.5-flash",
        resource_locator={},
        created_at=datetime.now(timezone.utc),
    )
    print("published:", await RedisDebitPublisher().publish(command))

asyncio.run(main())
PY
```

Wait a few seconds, then re-run the step-5 SQL:

```sql
select count(*) from wallet_debits where idempotency_key = 'measurement:<measurement_id>';
-- expect: still 1, not 2

select balance_musd from wallet_balances
where organization_id = '<organization_id>' and wallet_credit_id is null;
-- expect: unchanged from step 5
```

**Failure meaning:** a second debit row or a second balance decrement means the replay
check in `WalletsDAO.settle` (the `existing_stmt` query before the insert) is broken — this
is the core exactly-once guarantee from `wave-1.md`'s replay invariant; a P0.

## 7. Confirm consumer groups register idempotently across a restart

```bash
docker compose -p agenta-ee-dev-wallets-im-1-02 restart worker-streams
docker compose -p agenta-ee-dev-wallets-im-1-02 logs worker-streams | grep -c BUSYGROUP
# any count is fine — BUSYGROUP is caught and swallowed by StreamConsumer.create_consumer_group
docker compose -p agenta-ee-dev-wallets-im-1-02 exec redis redis-cli \
  XINFO GROUPS streams:debits
```

Re-run the step-5/6 SQL: no new rows, no changed balance. The restart must not reprocess
anything that was already ACKed and deleted.

**Failure meaning:** a crash on restart (not a swallowed BUSYGROUP) means
`create_consumer_group`'s exception string match broke; a changed balance after restart
means old, already-ACKed entries got reprocessed, which should be structurally impossible
since `ack_and_delete` both ACKs and `XDEL`s (a re-read of a deleted entry cannot happen).

## 8. Feed a poisoned message; confirm it terminally ACKs instead of wedging

```bash
docker compose -p agenta-ee-dev-wallets-im-1-02 exec redis redis-cli \
  XADD streams:debits '*' data "not-a-valid-compressed-envelope"
```

```bash
sleep 2
docker compose -p agenta-ee-dev-wallets-im-1-02 exec redis redis-cli \
  XLEN streams:debits
docker compose -p agenta-ee-dev-wallets-im-1-02 exec redis redis-cli \
  XPENDING streams:debits worker-debits
```

**Expected:** `XLEN` does not grow unboundedly and `XPENDING` shows 0 pending for this
entry — `DebitWorker.process_batch` catches the `MalformedEnvelopeError` from
`deserialize_debit_command`, logs `[WALLETS] Terminal envelope error, ACKing without
retry`, and includes the message id in `processed_ids`, so `ack_and_delete` removes it.

**Failure meaning:** if the entry stays pending (`XPENDING` count grows and never clears),
malformed-envelope handling regressed from terminal to retryable — this wedges the
consumer group behind it and is a P0.

**CLOSED as of WP-1-04 (remedy a):** a debit for an organization with no general balance
row raises `WalletGeneralBalanceNotFoundError`, which is NOT a `WalletTerminalError` and
is still caught by `DebitWorker`'s broad `except Exception` in the settle stage — that
part of the mechanism is unchanged. What closed the gap is upstream of it: organization
creation now provisions the general balance row itself
(`ee.src.core.organizations.service._provision_wallet_general_balance`, called from
`provision_signup_subscription`/`provision_user_subscription`), and migration
`ee0000000005_backfill_wallet_general_balances.py` backfills it for organizations that
predate this change — so on a deployment built from this revision forward, an
organization used in this procedure already has its row, and this failure mode should not
occur in practice. It remains possible in principle (a provisioning call that failed and
was never retried, or an organization created through a path this wave did not find) —
remedy (b), reclassifying `WalletGeneralBalanceNotFoundError` as terminal/alerted, was not
taken and remains open for a future wave if that residual risk needs closing too.

## 9. Pytest commands for the suites that could not be run in the review worktree

These need Postgres + Redis and were WRITTEN BUT NOT RUN during review (the review
worktree is not allowed to touch the shared EE dev stack). Run each individually against
YOUR local stack's database, from `api/`:

```bash
# 1. MOST IMPORTANT — the concurrency guarantee itself: proves competing deliveries
#    cannot overspend one credit. This is the test that validates the general-balance
#    row lock actually serializes settlement; everything else in the suite is necessary
#    but this one is sufficient on its own to catch a broken locking strategy.
uv run --no-sync python -m pytest \
  ee/tests/pytest/integration/wallets/test_wallets_settlement_concurrency_postgres.py::test_competing_deliveries_cannot_overspend_one_credit -v

# 2. Migration-level invariants: FK restrict behavior, check constraints, partial unique
#    indexes, all-or-nothing rollback.
uv run --no-sync python -m pytest \
  ee/tests/pytest/integration/wallets/test_wallets_migration_postgres.py -v

# 3. Debit worker against real Postgres: duplicate delivery produces one financial effect.
uv run --no-sync python -m pytest \
  ee/tests/pytest/integration/wallets/test_wallets_debit_worker_integration.py::test_duplicate_debit_command_produces_one_financial_effect -v

# 4. Measurement worker against real Postgres/tracing + Redis: full consume-persist-publish
#    chain, and convergence after a transient debit-publish failure.
uv run --no-sync python -m pytest \
  ee/tests/pytest/integration/measurements/test_measurements_integration.py -v

# 5. WP-1-04: the ee0000000005 (backfill) migration, and the real WalletsDAO
#    provisioning/plan-change methods.
uv run --no-sync python -m pytest \
  ee/tests/pytest/integration/wallets/test_wallets_backfill_migration_postgres.py \
  ee/tests/pytest/integration/wallets/test_wallets_provisioning_postgres.py -v
```

**Failure meaning, per suite:**
- (1) failing means two concurrent settlements can both read the same stale credit
  balance and both fund from it — real double-spend under load; the highest-severity
  possible failure in this design. Do not ship past a failing (1).
- (2) failing on the FK/constraint tests means the schema migration
  (`ee0000000004_add_wallet_tables.py`) does not actually enforce the invariants the
  design depends on (e.g. a credit could be hard-deleted out from under a debit, or a
  negative-amount debit could be inserted). The rollback test failing means a partial
  settlement can persist on error — breaks the "one core transaction" guarantee.
- (3) failing means the DebitWorker's ACK/settle wiring against a real DB doesn't match
  the in-memory-fake-backed unit test's model of duplicate delivery — the real replay
  guard doesn't actually engage.
- (4) failing means the measurement worker's tracing-insert-then-debit-publish sequence,
  or its retry convergence after a transient publish failure, doesn't hold against real
  infrastructure — could mean either double-charging or silently losing a charge, which
  are opposite but equally unacceptable failure modes.
- (5) failing on the migration test means `ee0000000005` doesn't actually backfill what
  WP-1-04 claims (the idempotent `ON CONFLICT DO NOTHING` guard). Failing on the
  provisioning tests means `WalletsDAO.provision_general_balance`/`apply_plan_change`
  don't hold against a real engine the way the `FakeWalletsDAO`-backed unit tests assume —
  check locking/ON CONFLICT behavior first, and for `apply_plan_change` specifically,
  check that the replay guard (a `wallet_debits` lookup by `idempotency_key`, plus a
  `wallet_credits` lookup by the embedded `plan_change_idempotency_key` reference — see
  `WalletsDAO.apply_plan_change`) actually finds a prior application on redelivery.

## 10. Unit-only commands (already run and passing during review; safe to re-run any time)

```bash
cd api && uv run --no-sync python -m pytest ee/tests/pytest/unit/wallets/ ee/tests/pytest/unit/measurements/ -q
# review result (IM-1-02): 80 passed, 0 failed, 0 skipped
# review result (WP-1-04, adds the check-is-async and B1/B2/B3 unit tests): 103 passed, 0 failed, 0 skipped

cd api && uv run --no-sync ruff format --check . && uv run --no-sync ruff check .
# review result: both clean
```
