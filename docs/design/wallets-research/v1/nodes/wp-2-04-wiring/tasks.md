# WP-2-04 tasks

Fork point: the reviewed `IM-2-01` merge, on both branches. Each item is one reviewable commit.

## Read first

1. `api/entrypoints/routers.py` where `GatewayPolicyService` is constructed, and the mounting
   of the two gateway proxies below it.
2. `api/entrypoints/worker_streams.py` — the existing `is_ee()`-plus-flag branch that Wave 1
   used to register the two streams. This is the precedent, including where the EE import sits.
3. `api/ee/src/core/wallets/runtime.py` — the singleton shape to copy, and why the settlement
   port and the wallets service are the same object.
4. `api/oss/src/core/gateways/llms/providers/mock/adapter.py` — the mock the acceptance test
   relays through, and the usage it reports.
5. `api/ee/tests/pytest/acceptance/wallets/` — the acceptance layout and fixtures this test
   joins, including how it gets an organization with a wallet.

## Wallet branch

1. Add `ee/src/core/measurements/runtime.py` with the two accessors. The admission accessor
   wraps the same `WalletsService` singleton `get_wallet_settlement_port` returns; the sink
   accessor wraps the existing `RedisMeasurementPublisher`.

## Gateway branch

1. Write the two composition tests first: flag off leaves both ports null, flag on binds both.
   Commit them before the wiring they describe.
2. Add the conditional construction in `routers.py` exactly as the specification writes it.
   Keep the EE import inside the branch.

## Acceptance

1. Add `ee/tests/pytest/acceptance/gateways/test_gateway_wallet_chain.py`: one relay through
   the mock adapter, with the flag on, asserting one measurement row, one debit posting, and a
   balance lower by the posted amount.
2. Add the repetition case: two identical relays produce two measurements and two postings.
   Write the assertion so a future reader sees why this differs from redelivery.
3. Add the refusal case: an organization at its floor gets a 403, the mock records no call,
   and no measurement row appears.
4. Add the no-run case: a direct API-key relay produces a measurement whose references carry
   no `gateway_run_id` at all.
5. Extend the measurement integration suite so a gateway-produced command, not a fake, travels
   the chain.

## Close

1. `ruff format` then `ruff check --fix` under `api/` on both branches.
2. Run every suite this wave touches, on both branches, and record the counts: the gateway
   unit, integration and acceptance suites; `ee/tests/pytest/unit`; the wallet and measurement
   integration suites; and the new acceptance module.
3. Confirm `routers.py` is the only entrypoint file this wave changed.
4. Hand `IM-2-02` the counts, the acceptance evidence, and a note on whether the flag-off
   build is byte-identical on the request path.
