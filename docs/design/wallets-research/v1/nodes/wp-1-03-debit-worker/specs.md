# WP-1-03 specification: debit-stream wallet worker

## Boundary and prerequisite

Fork from reviewed `IM-1-01`, which already contains the seed contracts, core settlement adapter,
measurement chain, and both `worker_streams.py` registrations. This package supplies only the concrete
processing body behind the already-registered debit worker. It must not edit
`api/entrypoints/worker_streams.py`, migrations, measurement persistence, fake gateways, or pricing.

## Owned implementation

Replace the seeded shell's processing body under `api/ee/src/tasks/asyncio/wallets/`; do not move its
registration or construction adapter. It subclasses/reuses the existing shared `StreamConsumer`
lifecycle and deserializes only `DebitCommandV1` from the seed contract. Its sole domain call is
`WalletSettlementPort.settle(command)`.

For a valid command, call settlement and ACK/delete the Redis entry only after the core transaction
returns success. A duplicate delivery is a normal successful settlement replay: it makes no second
debit/balance change and is ACKed. A malformed or unsupported envelope is logged and terminally ACKed.
A core transaction, database, or Redis error is retryable: leave the entry pending and do not ACK it.
The worker does not calculate amount, look at metric components, create a measurement, interpret a
provider, or select credits itself.

## Required evidence

Add unit tests under `api/ee/tests/pytest/unit/wallets/` for valid dispatch, duplicate delivery,
malformed terminal ACK, retryable settlement failure, and ACK-after-settlement ordering. Add one
Redis-plus-core-Postgres integration test under `api/ee/tests/pytest/integration/wallets/`: produce a
seed debit command twice, run the worker, and prove one financial effect. Record commands/results for
`IM-1-02`.

## Handoff

`IM-1-02` merges this body onto the reviewed foundation, then runs the two-stream test path. It is the
first node that can prove `streams:measurements -> streams:debits -> atomic settlement`; final local
deployment and acceptance remain the CU node.
