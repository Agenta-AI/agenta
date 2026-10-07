# WP-1-02 tasks

Fork point: the reviewed `IM-1-00` seed.

## Read first

1. `api/oss/src/core/events/streaming.py` — the compressed-`data`, approximate-`MAXLEN`,
   log-and-return-`False` producer pattern.
2. `api/oss/src/tasks/asyncio/shared/consumer.py` — what `StreamConsumer` already provides, so this
   worker implements only its processing body.
3. `api/oss/src/tasks/asyncio/events/worker.py` and
   `api/oss/src/tasks/asyncio/sessions/records_worker.py` — the two closest worker precedents.
4. `api/entrypoints/worker_streams.py` — `ALL_STREAMS`, the selector, the builders, idle-consumer
   pruning, and the `asyncio.gather` convention.

## Tracing migration

1. Write `ee0000000002_add_measurements.py` in `tracing_ee` with `down_revision = "ee0000000001"`.
   Not the generic parked tracing chain; no OSS measurement table.
2. Create immutable `measurements`: generated primary key plus gateway-supplied `measurement_id`
   under `UNIQUE (measurement_id)`; `project_id`; nullable `user_id` and `agent_id`; `gateway_kind`;
   `request_id`; `resource_key`; nullable `endpoint_id`; `endpoint_kind`; structured
   `resource_locator`; structured references and data; optional start and end time; lifecycle
   timestamps. No organization or workspace column, and no wallet-debit FK.
3. Create `measurement_values`: own primary key, restrict/no-delete FK to `measurements`, stable
   metric `key`, integer `value`, nullable `cost_musd`, `created_at`, and
   `UNIQUE (measurement_id, key)` holding one component per key.
4. Add `api/ee/src/dbs/postgres/measurements/` so a parent and all of its children insert in one
   tracing transaction.
5. Hand-check `upgrade` → `downgrade` → `upgrade` against a local EE Postgres.

## Producers

1. Extend the seed's `api/ee/src/core/wallets/streaming.py` with the concrete best-effort publishers.
   Do not change the seed envelope types.
2. Both publishers use the existing compressed `data` field, bounded approximate `MAXLEN`, and
   return `False` with a log on failure rather than raising into their caller.
3. Publish `streams:measurements` from the fake result path after the fake managed result. A failed
   initial `XADD` means no persisted measurement and no debit, and must not change the caller's
   successful result.

## Measurement worker

1. Add `api/ee/src/tasks/asyncio/measurements/` following the existing `StreamConsumer` convention.
2. Per message: validate; resolve the optional organization from project scope before forming the
   debit command; idempotently insert the measurement and its value rows; calculate the fake
   gateway-owned positive `amount_musd` and `pricing_version`; `XADD` `DebitCommandV1` to
   `streams:debits`.
3. ACK and delete only after both the tracing write and the debit publish succeed.
4. Malformed or unsupported commands are logged and terminally ACKed. A tracing or Redis failure
   leaves the message pending.
5. Publish nothing for a result the gateway does not charge — never a zero-amount command.

## Registration

1. Add `measurements` and `debits` to `ALL_STREAMS` in `api/entrypoints/worker_streams.py`, with
   their two builders and consumer groups, matching the existing selector, durable Redis client,
   idle-consumer pruning and `asyncio.gather` conventions.
2. Construct the seeded debit-worker shell using the seeded runtime factory. `WP-1-01` replaces the
   factory body and `WP-1-03` supplies the processing body; neither changes a line of this file.
3. Put any new configuration in `api/oss/src/utils/env.py`, read through the shared `env` object.

## Fakes

1. Add wallet-owned fakes under `api/ee/tests/pytest/acceptance/wallets/fakes/` returning
   deterministic local built-in LLM and MCP results, each publishing exactly one valid measurement
   command.
2. Confirm nothing was written under `core/gateways/*/providers/fake/` — those belong to the
   gateways wave.

## Tests

1. `api/ee/tests/pytest/unit/measurements/`: serializer use; fake LLM and MCP message content;
   optional organization resolution; unique-measurement replay; parent/value atomicity; LLM and MCP
   component preservation; positive fake amount; malformed terminal ACK; pending retry and ACK
   ordering.
2. `api/ee/tests/pytest/integration/measurements/`: Redis plus tracing Postgres, full
   consume-persist-publish, and a transient failure converging to one measurement and one debit
   command.

## Close

1. `ruff format` then `ruff check --fix` under `api/`; run both suites.
2. Confirm the diff contains no core wallet table or query, no settlement body, no live provider, no
   SBX fake, no price-book table, and no gateway-wave provider path.
3. Record migration heads, the registration diff, owned paths and exact test results for `IM-1-01`.
