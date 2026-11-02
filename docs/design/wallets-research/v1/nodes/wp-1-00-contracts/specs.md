# WP-1-00 specification: Wave 1 contract seed

## Purpose and fork point

This package is the only place that creates shared Wave 1 vocabulary before implementation worktrees
fork. It produces a reviewed seed commit: `WP-1-01` and `WP-1-02` fork from `IM-1-00`; `WP-1-03`
uses the same imports after `IM-1-01`. It contains no schema, Redis I/O, endpoint, worker loop,
pricing rule, or fake gateway body.

## Owned paths

Create `api/ee/src/core/wallets/contracts.py` (version-one Pydantic envelopes and components),
`streaming.py` (compressed JSON `data` serializers and publisher protocols, not a Redis implementation),
`interfaces.py` (wallet check/settlement ports), `runtime.py` (a deliberately unimplemented settlement
port factory), `errors.py`, and a deliberately small `__init__.py`. Also create a constructible
`api/ee/src/tasks/asyncio/wallets/worker.py` `DebitWorker` shell whose processing body raises
`NotImplementedError`. This lets WP-1-02 register both streams without owning later worker logic.
Create shared test builders in `api/ee/tests/pytest/utils/wallets/` and tests in
`api/ee/tests/pytest/unit/wallets/`. No existing stream or worker-registration file is owned here.

## Required contract

Both messages use compressed JSON Pydantic envelopes in the existing Redis field `data`, versioned as
`version = 1`. Constants select `streams:measurements` and `streams:debits`.

`MeasurementCommandV1` contains opaque gateway-minted `measurement_id`; optional `organization_id`;
required `project_id`; optional `user_id` and `agent_id`; `gateway_kind` (`llm`, `mcp`, `sbx`);
gateway-minted `request_id`; `resource_key`; structured `resource_locator`; optional `endpoint_id`;
`endpoint_kind`; optional `start_time`/`end_time`; repeatable optional components; structured
references; and `created_at`. A component is `{key, value, cost_musd?}` with integer value. The
envelope contains no user-controlled raw provider payload.

`DebitCommandV1` contains opaque gateway-minted `idempotency_key`; required `organization_id`;
`debit_kind`; strictly positive integer `amount_musd`; `pricing_version`; `resource_key`; structured
`resource_locator`; and `created_at`. It has no measurement ID, metric values, provider cost, request
ID, or workflow references: the gateway has already converted its complete measurement into a
domain-agnostic amount.

`WalletCheckPort.check(...)` is a synchronous, non-strict pre-dispatch admission read. It may reject
an organization already at/below its floor, but cannot write a debit, reservation, hold, or allocation.
`WalletSettlementPort.settle(DebitCommandV1)` is post-hoc. One posting may split into several debit
rows, whose `debit_key`s derive from its opaque key plus actual source (`wallet_credit_id` or explicit
`deficit`), never an invented sequence.

## Evidence, exclusions, and handoff

Unit tests prove serialization round trips; version rejection; optional measurement organization;
debit required fields/positive amount; LLM, MCP, and SBX component builders; and the absence of
provider metrics from a debit command. Do not create migrations, DAOs, workers, Redis clients,
configuration, concrete worker processing, or `worker_streams.py` edits. `IM-1-00` reviews public
imports/tests and records the merge commit as the only implementation fork point.
