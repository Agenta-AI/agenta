# WP-2-04 specification: binding the seam in a running process

## Boundary and ownership

Fork from `IM-2-01`. Two ports exist, two adapters exist, and nothing connects them. This
package owns the composition root and **every Wave 2 edit to
`api/entrypoints/routers.py`** — no other node touches that file, the way `WP-1-02` owned
`worker_streams.py` for Wave 1. It also owns the acceptance path that proves the whole chain
against a deployment.

It owns no port, no adapter body, no price, and no request-path logic. If this package finds
itself writing behaviour rather than construction, the behaviour belongs to whichever node
owns that seam.

## Do and do not

| Do | Do not |
| --- | --- |
| Construct the EE adapters only when `is_ee()` and `env.wallets.enabled` are both true. | Import an EE module at the top of an OSS file. The import itself must sit behind the branch. |
| Leave the null implementations as the defaults, so the construction is an override and reads like one. | Make the gateway's constructor require an adapter. A missing binding must degrade to today's behaviour, not to a crash. |
| Follow `worker_streams.py`'s existing EE branch as the precedent for how this repository does conditional EE construction. | Invent a second registry or a plugin mechanism for two objects. |
| Prove the flag-off path with a test that constructs the app and asserts both ports are null. | Assert it in a comment. This is the property the whole wave's safety rests on. |
| Reuse the process-wide singletons the wallet already exposes through `ee/src/core/wallets/runtime.py`. | Construct a second `WalletsService` or a second Redis client for the gateway's use. |

## Files

On `feat/add-gateways`:

| File | New or edited |
| --- | --- |
| `api/entrypoints/routers.py` | edited — the conditional construction around `GatewayPolicyService` |
| `api/oss/tests/pytest/unit/gateways/test_gateways_composition.py` | new — flag-off and flag-on binding |

On `feat/add-wallets`:

| File | New or edited |
| --- | --- |
| `api/ee/src/core/measurements/runtime.py` | new — the sink and publisher singletons, mirroring `wallets/runtime.py` |
| `api/ee/tests/pytest/acceptance/gateways/test_gateway_wallet_chain.py` | new — one real relay, one measurement, one posting, one moved balance |
| `api/ee/tests/pytest/integration/measurements/test_measurements_integration.py` | edited — the gateway-produced command end to end |

## Interfaces

Verbatim; do not rename.

```python
# `ee/src/core/measurements/runtime.py` — the same singleton shape as
# `ee/src/core/wallets/runtime.py`, for the same reason: one publisher, one sink, one process.

def get_measurement_usage_sink() -> MeasurementUsageSink:
    """The process-wide `UsageSinkInterface` implementation."""


def get_wallet_spend_admission() -> WalletSpendAdmission:
    """The process-wide `SpendAdmissionInterface` implementation, over the same
    `WalletsService` singleton the settlement port already uses."""
```

The construction, which is the only thing this package adds to the request path's wiring:

```python
# api/entrypoints/routers.py, where GatewayPolicyService is built today.
#
# Both defaults are the null implementations, so this branch is an override and an EE build
# with the flag off is indistinguishable from OSS on this path.
spend_admission = NullSpendAdmission()
usage_sink = NullUsageSink()

if is_ee() and env.wallets.enabled:
    from ee.src.core.measurements.runtime import (
        get_measurement_usage_sink,
        get_wallet_spend_admission,
    )

    spend_admission = get_wallet_spend_admission()
    usage_sink = get_measurement_usage_sink()

gateway_policy_service = GatewayPolicyService(
    resolver=secrets_resolver,
    spend_admission=spend_admission,
    usage_sink=usage_sink,
)
```

## The run dimension

`request.state.gateway_run_id` exists only when the caller authenticated with the minted
`Secret` token, which is the workflow-invocation path. A direct API-key call has no run, and
`GatewayCallContext.run_id` is `None` for it. That is correct and must not be papered over
with a synthesised value: a measurement with no run is a measurement of a call that had no
run. The acceptance test covers both, and the assertion for the direct call is that the
reference is absent, not that it is empty.

## Required evidence

Unit: the app builds with both ports null when the flag is off, and with both bound when it is
on. This is two tests and they are the ones to write first.

Acceptance, with the flag on, against the gateway's own mock adapter so no provider is
contacted: one relay produces exactly one `measurements` row with the expected components
including the cache split, exactly one `wallet_debits` posting, and a general balance lower by
the posted amount. A second, identical relay produces a second measurement and a second
posting, because two calls are two charges — the idempotency spine covers redelivery of one
call, not repetition of two.

Acceptance, refusal: an organization whose general balance is at its floor receives a 403 with
`code="policy_denied"`, the mock adapter records no call, and no measurement row appears.

## Explicit exclusions

No port change, no adapter body, no rate, no migration, no new environment variable — the flag
this wave uses is the one Wave 1 already added, and `api/oss/src/utils/env.py` needs no edit.
