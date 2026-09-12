# WP-2-00 specification: the seam contracts

## Purpose and fork point

The only node that creates shared Wave 2 vocabulary. It produces two reviewed seed commits,
one per branch, and every other node forks from `IM-2-00`. It contains no body, no wiring, no
Redis call, no price, and no edit to a request path.

The wave spans two branches, so the seed does too. The gateway branch declares the ports and
their DTOs, because `seams.md` gives the interface to the gateway. The wallet branch changes
one port signature and adds two adapter modules whose bodies raise `NotImplementedError`.

## Do and do not

| Do | Do not |
| --- | --- |
| Declare both ports as abstract base classes next to `SecretsResolverInterface`, which is the precedent. | Add a method to `GatewayPolicyService` that a later node has to move. |
| Ship a null implementation of each port, and make it the default. | Make the gateway import anything from `ee/`. OSS cannot, and the seam exists because of it. |
| Fix the measurement component key vocabulary in one place. | Redesign `MeasurementCommandV1` or `DebitCommandV1`. Exactly one additive optional field is in scope, and it is named below. |
| Separate fresh input tokens from cache reads and cache writes on `GatewayUsage`. | Add a field per provider quirk. One field per distinct price, never one per distinct provider spelling. |
| Change `WalletCheckPort.check` to return a decision object carrying the ceiling. | Reintroduce an `amount_musd` parameter on `check`. Item 2 holds that question and a reserving admission is not this wave. |
| Leave `EntitlementDeniedError` and the `"entitlement_denied"` reason exactly as the gateway declared them. | Rename either. The type is already mapped to 403 at both boundaries and D29 reserved it for precisely this. |

## Files

On `feat/add-gateways`:

| File | New or edited |
| --- | --- |
| `api/oss/src/core/gateways/policy/interfaces.py` | edited — add `SpendAdmissionInterface` and `UsageSinkInterface` beside `SecretsResolverInterface` |
| `api/oss/src/core/gateways/policy/dtos.py` | edited — add `SpendAdmission` and `GatewayCallContext`; extend `GatewayUsage` |
| `api/oss/src/core/gateways/policy/null.py` | new — `NullSpendAdmission` and `NullUsageSink` |
| `api/oss/tests/pytest/unit/gateways/test_gateways_seam_contracts.py` | new |

On `feat/add-wallets`:

| File | New or edited |
| --- | --- |
| `api/ee/src/core/wallets/contracts.py` | edited — `MeasurementCommandV1` gains `secret_origin` |
| `api/ee/src/core/wallets/interfaces.py` | edited — `WalletCheckPort.check` returns `WalletAdmissionDTO` |
| `api/ee/src/core/wallets/types.py` | edited — add `WalletAdmissionDTO` |
| `api/ee/src/core/wallets/service.py` | edited — `check` returns the DTO it already has the numbers for |
| `api/ee/src/core/wallets/admission.py` | new — `WalletSpendAdmission`, body raises `NotImplementedError` |
| `api/ee/src/core/measurements/ingress.py` | new — `MeasurementUsageSink`, body raises `NotImplementedError` |
| `api/ee/src/core/measurements/components.py` | new — the component key vocabulary |
| `api/ee/tests/pytest/unit/wallets/test_wallets_service.py` | edited — `check`'s new return type |
| `api/ee/tests/pytest/utils/wallets/fakes.py` | edited — the fake follows the port |

The two adapter modules live beside the services they delegate to rather than in a new
`ee/src/core/gateways/` package. That package does not exist on either branch today, and
inventing it here would claim a name the gateway wave may want.

## Interfaces

Verbatim. Do not rename a field, a method, or a class; four nodes fork from this commit and a
rename after the fork is a merge conflict in every one of them.

On `feat/add-gateways`, in `api/oss/src/core/gateways/policy/dtos.py`:

```python
class GatewayUsage(BaseModel):
    """What the meter needs, plane-neutral. One field per distinct price, not per provider
    spelling: `input_tokens` is what the upstream charges at its fresh-input rate,
    `cache_read_tokens` at its cache-read rate, `cache_write_tokens` at its cache-write rate.
    Their sum is the prompt. Adapters normalise into this; the protocols disagree and the
    disagreement stops here (`wave-2.md` invariant 6)."""

    calls: int = 1
    input_tokens: Optional[int] = None
    cache_read_tokens: Optional[int] = None
    cache_write_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    cost: Optional[float] = None


class SpendAdmission(BaseModel):
    """The spend answer, returned before dispatch. Distinct from `PolicyDecision`, which
    answers the permission question — same shape by coincidence, different question by
    design."""

    allowed: bool
    reason: Optional[str] = None
    ceiling_musd: Optional[int] = None


class GatewayCallContext(BaseModel):
    """Per-call identity that is not a tenant attribute.

    `request_id` is minted once per relay and is the idempotency spine for everything the
    call produces downstream: the measurement's id derives from it, and so, through the
    measurement, does the debit's posting key. `run_id` is the workflow-invocation nonce
    minted in `WorkflowsService._prepare_invoke`, signed into the derived credential as a
    claim, and read back onto `request.state.gateway_run_id` by `verify_secret_token`; the auth
    middleware keeps it off `AuthScope` deliberately and this DTO honours that. It is None
    for a call that had no run, and that absence is a fact, not a gap to fill.
    """

    request_id: str
    run_id: Optional[str] = None
```

In `api/oss/src/core/gateways/policy/interfaces.py`:

```python
class SpendAdmissionInterface(ABC):
    """Asked before dispatch: does this organization have value left to spend, and how much.

    Deliberately not called `authorize`. That name belongs to the permission check on the
    same service, and permissions and entitlements answer different questions — conflating
    them is the trap `policy.md` names and D29 acts on.
    """

    @abstractmethod
    async def admit(
        self,
        *,
        scope: AuthScope,
        target: GatewayTarget,
    ) -> SpendAdmission:
        raise NotImplementedError


class UsageSinkInterface(ABC):
    """Handed the raw measurement once the response body has been drained. Never on the
    caller's latency path, and never able to fail a relay: implementations swallow their own
    failures the way `publish_gateway_call` already does."""

    @abstractmethod
    async def record(
        self,
        *,
        scope: AuthScope,
        context: GatewayCallContext,
        target: GatewayTarget,
        decision: PolicyDecision,
        admission: Optional[SpendAdmission],
        outcome: GatewayOutcome,
    ) -> None:
        raise NotImplementedError
```

`admission` is declared here and stays `None` until `WP-2-03` fills it. It is the ceiling the
call was admitted under, and it belongs with the decisions rather than in the context object,
because nothing about it describes the call — it describes what the wallet answered about it.

**A measurement describes a dispatched call, and `GatewayPolicyService.record` sees more than
those.** It is called on a permission denial, on an admission refusal, and from `list_models`,
which is not a relay and has no call context at all. So `record` gains both new arguments as
optional keywords, and the sink is called only when all three of these hold:

```python
# The audit event records every one of these; the sink records only the ones that reached a
# provider. A refusal is not a usage fact, and `list_models` is not a relay.
if context is not None and decision.allowed and (admission is None or admission.allowed):
    await self.usage_sink.record(...)
```

`context` is therefore `Optional[GatewayCallContext] = None` on `GatewayPolicyService.record`
and non-optional on the sink itself, which only ever sees a call that had one.

On `feat/add-wallets`, in `api/ee/src/core/wallets/types.py`:

```python
class WalletAdmissionDTO(BaseModel):
    """What one admission read learned. `ceiling_musd` is headroom, not a budget: the
    committed balance less the floor, never below zero. It is derived from the row `check`
    already read, so it costs nothing beyond the read."""

    allowed: bool
    ceiling_musd: int
```

and in `api/ee/src/core/wallets/interfaces.py`:

```python
    async def check(self, *, organization_id: UUID) -> "WalletAdmissionDTO":
```

In `api/ee/src/core/wallets/contracts.py`, the wave's one additive envelope field:

```python
    # Who paid for the call this measurement describes: `local` is the platform's own
    # credential, `vault` the customer's. The rate card reads it to decide whether there is a
    # charge at all, so it cannot live in `references` — a free-form dictionary is the wrong
    # home for the field a charge decision turns on. Optional because a Wave 1 producer does
    # not set it and a replayed Wave 1 message must still deserialise.
    secret_origin: Optional[str] = None
```

`endpoint_kind` keeps its name and changes its vocabulary. Wave 1's fixture wrote `"managed"`;
from `WP-2-01` it carries the gateway's own namespace — `builtin`, `standard` or `custom` —
because D30 put the billing boundary on the namespace and the field that decides chargeability
should hold the value the decision is written in.

In `api/ee/src/core/measurements/components.py`:

```python
# The component key vocabulary. The unit is in the name, per the rule `seams.md` adopts from
# the sandbox-metering track: SANDBOX_CPU_CORE_SECONDS, not SANDBOX_CPU_SECONDS. The rate
# card is keyed by these, so adding one is a rate-card change, not a producer change.
REQUEST_COUNT = "request_count"
INPUT_TOKENS = "input_tokens"
CACHE_READ_TOKENS = "cache_read_tokens"
CACHE_WRITE_TOKENS = "cache_write_tokens"
OUTPUT_TOKENS = "output_tokens"
```

## Field roles

Every field above, classified by what it is rather than by the feature it serves. The
classification is the argument for where it lives.

| Field | Role | Owner | Changes |
| --- | --- | --- | --- |
| `GatewayUsage.*_tokens`, `calls` | measurement output | the provider, read by the adapter | per call |
| `GatewayUsage.cost` | the provider's own declared price | the provider | per call, and only when it declares one |
| `SpendAdmission.allowed` | decision output | the wallet | per call |
| `SpendAdmission.reason` | decision metadata | the wallet, vocabulary shared with `PolicyDecision` | per call |
| `SpendAdmission.ceiling_musd` | derived data, not policy | the wallet | per call, from a row that changes per settlement |
| `GatewayCallContext.request_id` | per-call protocol context, and the idempotency spine | the gateway, minted per relay | per call |
| `GatewayCallContext.run_id` | per-call protocol context | the platform, minted at invocation | per call |
| `MeasurementCommandV1.secret_origin` | policy input — who paid | the gateway's secret resolver | per call |
| component keys | routing key into the rate card | the rate card | never, without a rate-card version |
| `WalletAdmissionDTO.ceiling_musd` | derived data | the wallet | per call |

Two roles that were kept apart on purpose. `ceiling_musd` is **derived data**, not policy:
nobody sets it, it is a projection of `balance_musd - floor_musd`, and it belongs with the
decision rather than in a config block. And `run_id` is **context**, not a principal: it does
not go on `AuthScope`, because a nonce scoped to one invocation is not a tenant attribute and
the auth middleware says so in as many words.

## Required evidence

On the gateway branch: unit tests that the null implementations answer `allowed=True` with a
`None` ceiling and record nothing; that `GatewayUsage` round-trips with every token field
absent, which is the "unknowable" case `interfaces.py` already documents; and a test asserting
no module under `oss/src/core/gateways/` imports from `ee`.

On the wallet branch: `check` returns a `WalletAdmissionDTO` whose `ceiling_musd` is the
headroom for a funded organization, zero at the floor, and zero rather than negative below it.
The existing `check` tests move to the new return type without changing what they assert about
the allow/reject boundary.

## Explicit exclusions

No `relay_chat_completion` edit, no `GatewayPolicyService` constructor change, no
`routers.py` edit, no rate card, no Redis publish, no `worker_streams.py` edit, no migration,
and no change to either stream envelope.
