# WP-2-03 specification: admission before dispatch

## Boundary and ownership

Fork from `IM-2-01`. This package calls the wallet before the provider is contacted, and
refuses the call when the organization has nothing left to spend. It owns the one call site in
`relay_chat_completion` and the EE adapter behind it. It owns no price, no measurement, and no
composition-root edit.

This is the third of the three Wave 1 placeholders `seams.md` lists: `check()` exists, is
implemented, is tested, and is called by nothing.

## What the ceiling is for, in this wave

`SpendAdmission` carries two things, and only one of them is enforced here.

`allowed` is enforced: a refusal raises before the provider is contacted, before the secret is
resolved, and nothing is dispatched.

`ceiling_musd` is carried, not enforced. This package passes the `SpendAdmission` to the usage
sink, which writes the ceiling into the measurement's `references` under `admission`, so that a
later wave can ask how often a posting exceeded the ceiling it was admitted under — which is the evidence
item 2 needs before anyone builds a reserving admission, and which nobody has today. Enforcing
it pre-dispatch would mean pricing a request before it runs, and the only honest pre-dispatch
price is the caller's own declared output bound, which needs the rate card on the request path
and would refuse calls that go on to cost nothing. **Open-design item 17 holds that question**,
with the options and the evidence this package produces.

Nothing here silently clamps a request. `gateways-research/v1/open-designs.md` settled that:
when a ceiling rejects, it rejects visibly.

## Do and do not

| Do | Do not |
| --- | --- |
| Raise `EntitlementDeniedError`, already declared in `policy/types.py` and already mapped to 403 at both boundaries. | Raise `PolicyDeniedError`. Permission and entitlement are different questions and the two errors exist to keep them apart. |
| Admit only where a charge could follow: the `builtin` namespace. | Refuse a `standard` or `custom` call because our wallet is empty. The customer pays for those with their own credential and D30 says they need no charging path; refusing them would be charging them for our balance. |
| Call `policy.record` on the refusal, with a `PolicyDecision` built for the refusal, exactly as the permission-denied path already does. | Return early without recording, or record the allowed permission decision as though it were the outcome. A refused call is a fact the audit event should carry, and the sink's gating condition keeps it out of the measurement stream. |
| Place the call after `authorize` and before `target.secret_ref()`. | Place it before the permission check. Someone who may not call at all should not have their balance consulted. |
| Fail closed when the wallet cannot answer. | Fail open. `mechanics.md` §2 fixes this per resource class, and vendor pass-through fails closed because the alternative is spending cash we do not have. |
| Answer from one wallet read. | Add a second round trip for the ceiling. `check` already reads the row that carries it. |

## Files

On `feat/add-gateways`:

| File | New or edited |
| --- | --- |
| `api/oss/src/core/gateways/llms/service.py` | edited — the `admit` call in `relay_chat_completion`, and the `SpendAdmission` threaded to `_drain_and_record` |
| `api/oss/src/core/gateways/policy/service.py` | edited — `__init__` takes a `SpendAdmissionInterface`, defaulting to `NullSpendAdmission`; a thin `admit` that delegates and fails closed |
| `api/oss/tests/pytest/unit/gateways/test_gateways_llm_service.py` | edited |
| `api/oss/tests/pytest/unit/gateways/test_gateways_admission.py` | new |

On `feat/add-wallets`:

| File | New or edited |
| --- | --- |
| `api/ee/src/core/wallets/admission.py` | edited — `WalletSpendAdmission.admit` gets its body |
| `api/ee/tests/pytest/unit/wallets/test_wallets_admission.py` | new |

## Interfaces

Verbatim; do not rename. The adapter, which is the whole wallet side of this package:

```python
class WalletSpendAdmission(SpendAdmissionInterface):
    """Binds the gateway's admission port to `WalletsService.check`.

    Fails closed. A wallet that raises is a wallet that cannot say the organization has
    value, and dispatching a vendor call on that basis spends money we have not confirmed we
    have (`mechanics.md` §2). The refusal reason is the same string in both cases, because
    the caller is owed "your balance did not allow this", not our diagnosis of why we could
    not check.
    """

    async def admit(
        self,
        *,
        scope: AuthScope,
        target: GatewayTarget,
    ) -> SpendAdmission:
```

The refusal, on the gateway side:

```python
raise EntitlementDeniedError(
    key="wallet_balance",
    target=target.target_path(),
)
```

`key="wallet_balance"` names what ran out, in the vocabulary of the thing that ran out. The
reason recorded on the decision is `"entitlement_denied"`, which
`gateways-research/v1/open-designs.md` R6 settled as one of two permitted values. The code has
since grown a third, `"permission_check_failed"`, emitted by `authorize`'s own fail-closed
branch; this package adds no fourth, and the discrepancy between R6 and the code is the
gateway design's to reconcile, not this one's.

The refusal records a decision of its own:

```python
PolicyDecision(allowed=False, reason="entitlement_denied", ...)
```

not the allowed permission decision that got the call this far. Recording the latter would
make the audit event say the call was allowed and then not happen.

## Field roles

| Field | Role | Owner | Changes |
| --- | --- | --- | --- |
| `EntitlementDeniedError.key` | decision metadata — what limit was hit | this package | per refusal kind |
| `EntitlementDeniedError.target` | routing identity of what was refused | the gateway | per call |
| `SpendAdmission.allowed` | decision output, enforced here | the wallet | per call |
| `SpendAdmission.ceiling_musd` | derived data, carried not enforced | the wallet | per call |

## Required evidence

Gateway branch: a refused admission raises `EntitlementDeniedError`, the adapter is never
reached, the upstream is never contacted, `policy.record` is called once with a 403 outcome and
a refusal decision, and no measurement is published. A `standard` and a `custom` relay are not
admitted at all — the wallet is never consulted for them, proven by a test with a wallet that
would refuse. An allowed admission changes nothing observable about the relay. The null
implementation admits everything, so an OSS or flag-off deployment relays exactly as it does
today — assert that with a test, not with a claim. And admission runs after the permission
check, proven by a test where both would refuse and only the permission reason is recorded.

Wallet branch: an organization above its floor is admitted with a positive ceiling; one at its
floor is refused with a zero ceiling; a `WalletsService` that raises produces a refusal, not an
exception; and a `check` that provisions a missing row still returns within one call, which is
item 14's behaviour seen from the admission side.

## Explicit exclusions

No rate-card read on the request path, no reservation, no hold, no clamping of a caller's
parameters, no MCP admission, no `routers.py` edit, and no change to the `PolicyDecision`
reason vocabulary.
