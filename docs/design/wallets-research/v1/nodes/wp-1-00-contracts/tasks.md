# WP-1-00 tasks

Fork point: the current base branch. Nothing else in Wave 1 forks until `IM-1-00` merges this.

## Read first

1. `api/oss/src/core/events/streaming.py` — the compressed-`data` producer shape these serializers
   must match.
2. `entities.md` §"Gateway stream contracts" — the field list both envelopes come from.

## Contracts

1. Add `api/ee/src/core/wallets/contracts.py` with `MeasurementCommandV1` and `DebitCommandV1`, both
   versioned `version = 1`, plus the component model `{key, value, cost_musd?}` with an integer
   value.
2. `MeasurementCommandV1`: opaque `measurement_id`, optional `organization_id`, required
   `project_id`, optional `user_id` and `agent_id`, `gateway_kind` (`llm`/`mcp`/`sbx`), `request_id`,
   `resource_key`, structured `resource_locator`, optional `endpoint_id`, `endpoint_kind`, optional
   `start_time`/`end_time`, repeatable optional components, structured references, `created_at`.
3. `DebitCommandV1`: opaque `idempotency_key`, required `organization_id`, `debit_kind`, strictly
   positive integer `amount_musd`, `pricing_version`, `resource_key`, structured `resource_locator`,
   `created_at`. Nothing else.
4. Declare the two stream-name constants, `streams:measurements` and `streams:debits`.

## Serializers and ports

1. Add `api/ee/src/core/wallets/streaming.py` with the compressed-JSON serializer pair for each
   envelope and the publisher protocols. Pure functions over bytes and protocol declarations only —
   no Redis client, no `xadd`.
2. Add `api/ee/src/core/wallets/interfaces.py` with `WalletCheckPort.check` and
   `WalletSettlementPort.settle(DebitCommandV1)`. Both bodies raise `NotImplementedError`; add an
   equally unimplemented settlement factory in `runtime.py`.
3. Write the split-identity rule into `WalletSettlementPort.settle`'s docstring verbatim: one
   posting may split into several debit rows, whose `debit_key`s derive from the opaque posting key
   plus the actual source — `wallet_credit_id`, or explicit `deficit` — never an invented sequence.
   Three packages depend on that sentence.
4. Add `api/ee/src/core/wallets/errors.py` distinguishing terminal (malformed envelope, unsupported
   version) from retryable (transient settlement failure), each stating which it is in its docstring.
5. Add `runtime.py` with the settlement-port factory, deliberately unimplemented.
6. Add a constructible `DebitWorker` shell at `api/ee/src/tasks/asyncio/wallets/worker.py` whose
   processing body raises `NotImplementedError`. This is what lets `WP-1-02` register both streams
   without owning later worker logic, and what lets `WP-1-03` supply only a body.
7. Keep `__init__.py` deliberately small — it is the import surface three packages bind to.
6. Add a constructible `api/ee/src/tasks/asyncio/wallets/worker.py` `DebitWorker` shell whose
   processing body raises `NotImplementedError`. It permits WP-1-02 to register the worker without
   owning WP-1-03's business logic.

## Fixtures

1. Add builders under `api/ee/tests/pytest/utils/wallets/` for both commands, overriding one field
   at a time, plus LLM, MCP and SBX component builders. Follow the style of
   `api/oss/tests/pytest/utils/accounts.py`.

## Tests

1. Add `api/ee/tests/pytest/unit/wallets/` covering: round-trip serialization of both envelopes;
   version rejection; `MeasurementCommandV1` accepting a `None` `organization_id` and rejecting a
   missing `project_id`; `DebitCommandV1` rejecting a missing `organization_id` and a zero or
   negative `amount_musd`; the three component builders; and an `asyncpg` `UUID` serializing rather
   than raising.
2. Assert the absence of provider metrics from `DebitCommandV1` over
   `DebitCommandV1.model_fields.keys()`, not as a comment. This is the test that keeps the boundary
   honest as the envelope evolves.

## Close

1. `ruff format` then `ruff check --fix` under `api/`; run the unit tests (`cd api && py-run-tests`).
2. Confirm the diff contains no migration, DAO, Redis client, configuration, concrete worker body, or
   change to `api/entrypoints/worker_streams.py`; the seeded `DebitWorker` shell is the sole worker
   exception.
3. Hand to `IM-1-00`; it records the merge commit as the only implementation fork point.
