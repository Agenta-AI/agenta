# WP-2-03 tasks

Fork point: the reviewed `IM-2-01` merge, on both branches. Each item is one reviewable commit.

## Read first

1. `api/oss/src/core/gateways/llms/service.py` `relay_chat_completion`, lines around the
   `authorize` call — the ordering of `_check_active`, `_check_allowlist`, `_check_ceilings`,
   `authorize`, secret resolution and dispatch, and how the permission denial records before
   it raises.
2. `api/oss/src/core/gateways/policy/types.py` — `EntitlementDeniedError`'s constructor and
   its docstring explaining why it is distinct from `PolicyDeniedError`.
3. `api/oss/src/apis/fastapi/gateways/llms/proxy.py`, where that error is already mapped to
   403 with `code="policy_denied"`, and `api/oss/src/apis/fastapi/gateways/exceptions.py`,
   where the same error becomes a bare 403 with no code. Both are 403; only the first carries
   the code, and this package changes neither.
4. `docs/design/gateways-research/v1/decisions.md` D29 — why the entitlement gate was deferred
   to this wave and what it said would stay.
5. `api/ee/src/core/wallets/service.py` `check` — the predicate, and what item 14 made it do
   when the row is missing.
6. `docs/design/wallets-research/v1/open-designs.md` items 2 and 17 — why admission is
   non-strict and reserves nothing, and what the ceiling is not yet enforcing.

## Gateway branch

1. Give `GatewayPolicyService.__init__` a `spend_admission: SpendAdmissionInterface =
   NullSpendAdmission()` parameter and a thin `admit` method that delegates to it inside
   `try/except Exception`, returning a refusal on failure. This mirrors `authorize`, which
   already wraps its own check and fails closed.
2. Call it from `relay_chat_completion`, after the `authorize` block and before
   `ref = target.secret_ref()`, and only when the target's namespace is `builtin`. On refusal:
   record with a 403 outcome and a `PolicyDecision(allowed=False,
   reason="entitlement_denied", ...)`, then raise `EntitlementDeniedError`.
3. Thread the returned `SpendAdmission` into `_drain_and_record` and on to the usage sink's
   `admission` parameter, which `WP-2-00` reserved for it.
4. Tests per the evidence list, including the one proving the null implementation leaves the
   relay unchanged.

## Wallet branch

1. Implement `WalletSpendAdmission.admit`: `scope.organization_id` into
   `WalletsService.check`, its `WalletAdmissionDTO` out as a `SpendAdmission`.
2. Wrap it so a raising wallet becomes `SpendAdmission(allowed=False,
   reason="entitlement_denied", ceiling_musd=None)` with an error log — never an exception
   into the relay, and never an allow.
3. Tests per the evidence list.

## Close

1. `ruff format` then `ruff check --fix` under `api/` on both branches.
2. Run the gateway unit and integration suites and `ee/tests/pytest/unit`; record the counts.
3. Confirm no rate-card import appears anywhere under `oss/src/apis/` or in
   `relay_chat_completion`'s call graph.
4. Hand `IM-2-02` the call ordering as implemented, and the measured latency the admission
   read adds to a relay — one indexed read on a locked-free path, but measure it rather than
   asserting it.
