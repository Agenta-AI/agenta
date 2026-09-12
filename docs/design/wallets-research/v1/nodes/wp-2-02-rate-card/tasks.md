# WP-2-02 tasks

Fork point: the reviewed `IM-2-00` seed, wallet branch only. Each item is one reviewable
commit.

## Read first

1. `api/ee/src/core/measurements/pricing.py` — the fixture this replaces, and its docstring
   saying exactly that.
2. `api/ee/src/tasks/asyncio/measurements/worker.py` `_process_one` — where the charge is
   applied and what happens when it is `None`. Note that nothing there enforces a positive
   amount: `pricing.py`'s `max(amount_musd, 1)` and `DebitCommandV1`'s `amount_musd: int =
   Field(gt=0)` are what make a zero-amount command impossible, and the new calculation
   inherits that obligation.
3. `api/oss/src/core/tracing/utils/trees.py` `calculate_costs` — how the tracing path prices
   the same tokens through litellm, and what it passes for cache reads.
4. `api/oss/src/core/gateways/llms/catalog.py` — what each namespace actually serves.
   `standard_llm_endpoint` is built from the SDK's `supported_llm_models`; `builtin_llm_endpoint`
   serves only `agenta` and `mock`, only behind `env.mock_gateways.enabled`, against
   `_MOCK_MODELS`. Since `builtin` is the only chargeable namespace, that list is today's whole
   chargeable surface, and `sdks/python/agenta/sdk/utils/assets.py` `_get_model_costs` is the
   only per-model cost data already in the repository.
5. `docs/design/wallets-research/v1/open-designs.md` items 16 and 19 — who owns the card, and
   how it stays in step with that catalogue.

## The card

1. Add `rate_card.py` with `TokenRates`, `RequestRates`, `RATE_CARD_VERSION`,
   `token_rates_for` and `request_rates_for`. Seed the token table with the models the
   `builtin` namespace actually serves, which today is `_MOCK_MODELS` behind
   `env.mock_gateways.enabled` — three mock models and nothing else. Write that down in the
   file rather than padding the table with models nobody can reach: a rate nobody can trigger
   is a rate nobody reviewed, and the empty state is the honest report on where the charging
   surface stands.
2. Carry MCP's flat rate across from `FIXTURE_MCP_RATE_MUSD_PER_REQUEST` into `RequestRates`,
   at the same value. Changing it here would be a price change hidden inside a refactor.
3. Source each rate from the provider's published price, and put the source and the date in a
   comment above the table the way `plans.py` records its product decision. A rate without a
   provenance line is a number somebody will be afraid to change.
4. Add the version-stamp test: a checksum over the table's contents, asserted against a
   constant that the author must update in the same commit as any rate change.

## The calculation

1. Add `charges.py` with `calculate_charge`, pure and total: every input produces either a
   charge or `None`, and it raises nothing.
2. Implement the chargeability predicate first, with its three refusals separately testable:
   not `builtin`, not `local`, not priced. Read the provider and model from
   `resource_locator`, never from `resource_key`.
3. Implement the arithmetic exactly as the specification states it — integer products, one
   ceiling division at the end, a positive total never rounding to nothing.
4. Log at error level, once per unpriced model, with provider and model. This log is the
   alert that the card has drifted from the catalogue; write it so that it can be alerted on.

## Wiring it in

1. Update the Wave 1 test corpus to the namespace vocabulary before rewiring the worker:
   `builders.py`, the measurement worker tests, the pricing tests and the measurement
   integration test all write `endpoint_kind="managed"`, which `calculate_charge` refuses.
   Doing this first means the rewiring commit shows a behaviour change and not a wall of red.
2. Change `MeasurementWorker._process_one` to call `calculate_charge` instead of
   `calculate_fake_charge`. Nothing else in the worker changes: the `None` path, the
   no-organization path, the publish and the ACK ordering are all already correct.
3. Leave `pricing.py` in place, delegating, with a comment naming `CU-2-01` as its executioner.
   Deleting it here would touch the acceptance fakes, which `WP-2-01` is editing in parallel.

## Close

1. `ruff format` then `ruff check --fix` under `api/`.
2. Run `ee/tests/pytest/unit/measurements` and `ee/tests/pytest/unit`; record the counts.
3. Confirm the diff touches no gateway file, no envelope, and no migration.
4. Hand `IM-2-01` the table, its provenance, the version string, and the hand-computed
   worked example the tests assert against.
