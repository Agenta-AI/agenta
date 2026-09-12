# WP-2-00 tasks

Fork point: `feat/add-gateways` and `feat/add-wallets` at their current tips. Two worktrees,
two throwaway branches, two commits. Each item below is one reviewable commit.

## Read first

1. `api/oss/src/core/gateways/policy/dtos.py` and `interfaces.py` — the existing DTO and port
   style on the gateway side, including `SecretsResolverInterface`, which both new ports copy.
2. `api/oss/src/core/gateways/policy/types.py` — `EntitlementDeniedError` and
   `CeilingExceededError`, both already declared and mapped, both reserved for this wave.
3. `docs/design/gateways-research/v1/decisions.md` D29 and D30 — why the entitlement gate was
   deferred to the wave that adds metering, and why `builtin` is the billing boundary.
4. `api/ee/src/core/wallets/interfaces.py` — the current `check` contract, and the paragraph
   explaining why it carries no amount.
5. `docs/design/wallets-research/v1/entities.md` §"Gateway stream contracts" — the envelopes
   this node must not change.

## Gateway branch

1. Extend `GatewayUsage` with `cache_read_tokens` and `cache_write_tokens`, and rewrite the
   docstring so `input_tokens` means fresh input only. No adapter changes yet — `WP-2-01`
   fills them and until then every new field is `None`.
2. Add `SpendAdmission` and `GatewayCallContext` to `policy/dtos.py`.
3. Add `SpendAdmissionInterface` and `UsageSinkInterface` to `policy/interfaces.py`, and add
   the two optional keyword arguments to `GatewayPolicyService.record`'s signature with the
   sink-gating condition written out. No sink is called yet — `WP-2-01` supplies one — but the
   condition belongs with the signature, because it is the reason both arguments are optional.
4. Add `policy/null.py` with `NullSpendAdmission` (allows, no ceiling, no reason) and
   `NullUsageSink` (returns immediately). These are the defaults a flag-off deployment gets,
   so they must be constructible with no arguments.
5. Unit tests in `oss/tests/pytest/unit/gateways/test_gateways_seam_contracts.py`: the null
   pair's answers; `GatewayUsage` with every optional field absent; and the import guard that
   no gateway module reaches into `ee`.

## Wallet branch

1. Add `WalletAdmissionDTO` to `ee/src/core/wallets/types.py`.
2. Change `WalletCheckPort.check` to return it, and update the port docstring: it still writes
   no debit, reservation, hold or allocation, and it still provisions a missing general
   balance row, which item 14 settled.
3. Change `WalletsService.check` to build the DTO from the row it already reads. The ceiling
   is `max(balance_musd - floor, 0)`; `allowed` is the existing predicate, unchanged.
4. Update `FakeWalletsDAO`'s callers and the `check` tests in
   `ee/tests/pytest/unit/wallets/test_wallets_service.py` to the new return type. Keep every
   existing assertion about the allow/reject boundary: this is a return-type change, not a
   policy change.
5. Add `secret_origin: Optional[str] = None` to `MeasurementCommandV1`, and only that. It is
   the one envelope field this wave adds, and it is additive with a default so a Wave 1
   message still deserialises.
6. Add `ee/src/core/wallets/admission.py` with `WalletSpendAdmission`, and
   `ee/src/core/measurements/ingress.py` with `MeasurementUsageSink`. Both take their
   collaborators in `__init__` and raise `NotImplementedError` from every other method, so
   `WP-2-03` and `WP-2-01` replace a body rather than a signature.
7. Add `ee/src/core/measurements/components.py` with the five key constants, and make the
   existing fakes and `calculate_fake_charge` import them instead of repeating string
   literals. Rename the fake LLM producer's `cached_tokens` component to `cache_read_tokens`
   as part of this: no persisted row uses the old key, because the flag has never been on.

## Close

1. `ruff format` then `ruff check --fix` under `api/` on both branches.
2. Run `oss/tests/pytest/unit/gateways` and `ee/tests/pytest/unit` and record the counts.
3. Confirm the diff contains no request-path edit, no wiring, no rate, and no Redis call.
4. Hand `IM-2-00` both commit SHAs, the two test counts, and the list of public names four
   nodes are about to import.
