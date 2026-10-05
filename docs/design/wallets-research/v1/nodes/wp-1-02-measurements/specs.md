# WP-1-02 specification: wallet-owned fake gateway measurement chain

## Boundary and ownership

Fork from `IM-1-00`. This package owns the first stream, measurement persistence, fake managed LLM/MCP
test support, and **every Wave 1 edit** to `api/entrypoints/worker_streams.py`. `WP-1-03` may implement
the debit worker body but must not touch that registration file.

It owns `api/ee/databases/postgres/migrations/tracing_ee/versions/
ee0000000002_add_measurements.py`, with `down_revision = ee0000000001`. It does not use the generic
tracing chain or add an OSS measurement table. It must not touch the gateways-wave fake provider paths
under `core/gateways/*/providers/fake/`.

## Owned paths

Create the EE measurement domain/persistence/worker paths under `api/ee/src/core/measurements/`,
`api/ee/src/dbs/postgres/measurements/`, and `api/ee/src/tasks/asyncio/measurements/`. The package may
extend the seed `api/ee/src/core/wallets/streaming.py` with concrete best-effort publishers, but must
not change the seed envelope types. It creates wallet-owned acceptance support only under
`api/ee/tests/pytest/acceptance/wallets/fakes/`; these fakes return deterministic local built-in LLM or
MCP results and publish one valid measurement command per successful result.

## Tracing schema

`measurements` is immutable, has a generated primary key plus gateway-supplied `measurement_id`, and
enforces `UNIQUE (measurement_id)`. Its selected columns are `project_id`, nullable `user_id` and
`agent_id`, `gateway_kind`, `request_id`, `resource_key`, nullable `endpoint_id`, `endpoint_kind`,
structured `resource_locator`, structured references/data, optional start/end time, and lifecycle
timestamps. It has no organization/workspace column and no wallet-debit FK.

`measurement_values` has its own primary key, restrict/no-delete FK to `measurements`, stable metric
`key`, integer `value`, nullable `cost_musd`, and `created_at`; `UNIQUE (measurement_id, key)` holds
the aggregate-one-component-per-key contract. Insert a parent and all children in one tracing
transaction. Metrics may be absent. Wave 1 supports LLM/MCP request/token/cost components; SBX names
are valid contract values but have no fake acceptance path.

## Producer, worker, and registration

The fake result path performs a best-effort `XADD` to `streams:measurements` after the fake managed
result. It uses the existing compressed `data`, bounded approximate `MAXLEN`, and false/log-on-failure
producer pattern. An initial XADD failure means no persisted measurement and no debit; it does not
change the caller's successful fake result.

The measurement worker follows the existing `StreamConsumer` convention. It validates the command,
resolves optional organization from project scope before forming a debit command, idempotently inserts
the measurement/value rows, calculates the fake gateway-owned positive `amount_musd` and
`pricing_version`, and XADDs `DebitCommandV1` to `streams:debits`. It ACKs/deletes only after both the
tracing write and debit publish succeed. Malformed/unsupported commands are logged then terminally
ACKed; tracing or Redis failure leaves the message pending.

In `worker_streams.py`, add `measurements` and `debits` to `ALL_STREAMS`, add the two builders and
consumer groups, and construct the seeded debit-worker shell through the seeded runtime factory.
WP-1-01 replaces the factory body and WP-1-03 replaces only the worker processing body. Match the
existing selector, durable Redis client, idle-consumer pruning, and `asyncio.gather` conventions.
MAXLEN is the same approximate-trimming mechanism as every other stream; individual values may be
configured by workload.

## Required evidence

Add unit tests under `api/ee/tests/pytest/unit/measurements/` for serializer use, fake LLM/MCP message
content, optional organization resolution, unique measurement replay, parent/value atomicity,
LLM/MCP component preservation, positive fake amount, malformed terminal ACK, and pending retry/ACK
order. Add Redis-plus-tracing-Postgres integration coverage under
`api/ee/tests/pytest/integration/measurements/`. Acceptance tests invoke only the wallet-owned fakes.
`IM-1-01` receives migration heads, registration diff, paths, and exact test results.

## Explicit exclusions

No core wallet table/query, debit settlement body, live provider, custom/standard credential flow,
SBX fake, price-book table, database outbox, or gateway-wave provider path belongs here.
