# WP-1-03 tasks

Fork point: the reviewed `IM-1-01`, which already contains the seed contracts, the core settlement
adapter, the measurement chain, and both `worker_streams.py` registrations.

## Read first

1. `api/oss/src/tasks/asyncio/shared/consumer.py` — the shared `StreamConsumer` lifecycle this
   reuses.
2. `WP-1-02`'s debit builder in `api/entrypoints/worker_streams.py` — it already names this
   package's class, stream and consumer group. Match them; do not edit the file.
3. The seed's `errors.py`, so terminal-versus-retryable matches the measurement worker exactly.

## Implement

1. Fill in the `DebitWorker` shell the seed created at `api/ee/src/tasks/asyncio/wallets/worker.py`,
   replacing its raising body and reusing the shared `StreamConsumer` lifecycle. The builder
   `WP-1-02` registered already constructs it.
2. Deserialize only `DebitCommandV1` from the seed contract.
3. Make `WalletSettlementPort.settle(command)` the sole domain call. Derive no amount, read no
   metric component, create no measurement, interpret no provider, and select no credits.
4. ACK and delete the Redis entry only after the core transaction returns success.
5. Treat a duplicate delivery as a normal successful settlement replay: no second debit or balance
   change, and still ACK.
6. Log and terminally ACK a malformed or unsupported envelope.
7. Leave the entry pending, unacknowledged, on a core transaction, database or Redis error.

## Tests

1. `api/ee/tests/pytest/unit/wallets/`: valid dispatch, duplicate delivery, malformed terminal ACK,
   retryable settlement failure, and ACK-after-settlement ordering asserted against a fake
   settlement port.
2. `api/ee/tests/pytest/integration/wallets/`: one Redis-plus-core-Postgres test that produces a
   seed debit command twice, runs the worker, and proves one financial effect.

## Close

1. `ruff format` then `ruff check --fix` under `api/`; run both suites.
2. Confirm the diff contains no migration, no producer, no pricing, and **no change to
   `api/entrypoints/worker_streams.py`**.
3. Record commands and results for `IM-1-02`.
