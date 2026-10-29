# WP-2-02 specification: the rate card and the charge calculation

## Boundary and ownership

Fork from `IM-2-00`. Wallet branch only. This package replaces
`ee/src/core/measurements/pricing.py` — a fixture that multiplies the provider's own declared
cost by 1.05 and flat-rates anything without one — with a versioned rate card and an integer
charge calculation the measurement worker applies off the request path.

It owns the number. It does not own where the number is applied from, which is the worker
`WP-1-02` already built, and it does not own the measurement that feeds it.

**Who owns the rate card is recorded as open-design item 16.** `seams.md` places pricing with
the wallet; `wave-1.md`'s fixed inputs place the final `amount_musd` with the gateway. The
mechanism is identical either way and this package builds it either way: a versioned table
keyed by the gateway's own routing vocabulary, read after the response, stamped on the debit.
What the open item decides is who reviews a change to it, not what it looks like.

## Do and do not

| Do | Do not |
| --- | --- |
| Keep every rate an integer, in micro-dollars per million tokens. | Store a float rate. Money in this design is an integer count of micro-dollars and a float rate reintroduces the drift the unit was chosen to avoid. |
| Round once, at the end, upwards. | Round per component. Five components rounded up individually overcharge by up to five micro-dollars on every call. |
| Charge nothing when the model has no rate, and log it at error. | Fall back to a default rate. A guessed price is worse than a missed charge, and the log is the signal that the card has drifted from the catalogue. |
| Charge on the namespace, and let `secret_origin` veto: `endpoint_kind == "builtin"` and `secret_origin != "vault"`. | Require `secret_origin == "local"`. See "Why the veto and not the stamp" below — a positive test on a stamp that one code path sets makes the whole charging surface depend on one line. |
| Change `pricing_version` whenever any rate changes. | Edit a rate in place under the same version. A debit's version is how a charge is traced back to the table that produced it. |
| Keep the calculation a pure function of a `MeasurementCommandV1`. | Read a database, a clock, or an environment variable inside it. It is the most testable thing in the wave and should stay that way. |
| Carry MCP's existing flat charge forward. | Delete a charging path Wave 1 delivered. `calculate_fake_charge` prices MCP per request; the new card must too, or this is a regression wearing a cleanup's clothes. |
| Read the provider and model from `resource_locator`. | Parse them back out of `resource_key`. The producer puts them in `resource_locator` as separate values; splitting a display string to recover them is how a mis-keyed card goes unnoticed. |

## Why the veto and not the stamp

D30 put the billing boundary on the namespace: a `builtin` target is one whose account we own,
and `standard` and `custom` are the customer's own credential. That is the positive decision,
and `endpoint_kind` carries it.

`secret_origin` is the veto on top of it, not the decision. `VAULT` means the customer's own
stored secret answered, and a call paid that way is never ours to charge, whatever namespace it
arrived through. Everything else — `LOCAL`, or no stamp at all — leaves the namespace's answer
standing.

Requiring `secret_origin == "local"` positively was rejected because it makes every charge in
the system depend on one line in `_outcome_from` continuing to fire. A `builtin` LLM target
resolves no secret, so its origin is `None` until `WP-2-01` stamps it, and an MCP measurement
carries no origin at all because Wave 2 does not touch that plane's outcome. Under a positive
test both are silently unbillable. Under the veto both are billable, and `WP-2-01`'s stamp
makes the payer explicit in the audit trail without becoming load-bearing.

## Files

On `feat/add-wallets`:

| File | New or edited |
| --- | --- |
| `api/ee/src/core/measurements/rate_card.py` | new — the table, its version, and the lookup |
| `api/ee/src/core/measurements/charges.py` | new — `calculate_charge`, the pure function |
| `api/ee/src/core/measurements/pricing.py` | edited — `calculate_fake_charge` delegates, and is marked for `CU-2-01` to delete |
| `api/ee/src/tasks/asyncio/measurements/worker.py` | edited — calls `calculate_charge` |
| `api/ee/tests/pytest/unit/measurements/test_measurements_rate_card.py` | new |
| `api/ee/tests/pytest/unit/measurements/test_measurements_charges.py` | new |
| `api/ee/tests/pytest/utils/wallets/builders.py` | edited — `endpoint_kind` becomes a namespace |
| `api/ee/tests/pytest/acceptance/wallets/fakes/llm.py` | edited — same |
| `api/ee/tests/pytest/acceptance/wallets/fakes/mcp.py` | edited — same, and it is the only MCP producer there is |
| `api/ee/tests/pytest/unit/measurements/test_measurements_worker.py` | edited — same |
| `api/ee/tests/pytest/unit/measurements/test_measurements_pricing.py` | edited — becomes the charge tests, or goes |
| `api/ee/tests/pytest/integration/measurements/test_measurements_integration.py` | edited — same |

The last six are the Wave 1 test corpus, which writes `endpoint_kind="managed"` everywhere.
`WP-2-00` changed that vocabulary and this package is where the change bites: `calculate_charge`
refuses anything that is not `builtin`, so every one of those fixtures stops being chargeable
the moment the worker is rewired. They are listed here because a node that breaks a test corpus
owns fixing it.

`fakes/mcp.py` matters more than the others. It is the only thing in the repository that emits
an MCP measurement, Wave 2 adds no MCP producer, and it is therefore what "MCP still charges"
is tested against. `CU-2-01` keeps it for that reason when it retires the rest.

`WP-2-01` owns the sink's new integration coverage and adds its own file for it; this package
owns the existing module's vocabulary. Two nodes forking from one seed must not both edit one
file, which is why the split is written down rather than left to the merge.

## Interfaces

Verbatim; do not rename.

```python
# `rate_card.py`

RATE_CARD_VERSION = "llm-rate-card-1"


class TokenRates(BaseModel):
    """Our price for one million tokens of each kind, in micro-dollars. Four rates because
    the four are priced differently by every upstream that prices them at all — the split is
    not decoration, it is why `GatewayUsage` carries it."""

    input_musd_per_million: int
    cache_read_musd_per_million: int
    cache_write_musd_per_million: int
    output_musd_per_million: int


class RequestRates(BaseModel):
    """For planes that charge per call rather than per token. MCP is priced this way today and
    stays priced this way here: Wave 1 charged a flat rate per request and Wave 2 is not the
    place to stop."""

    musd_per_request: int


def token_rates_for(*, provider: str, model: str) -> Optional[TokenRates]:
    """The rates for one model, or `None` when the card does not price it. `None` is a
    measurement with no debit, never a fallback rate."""


def request_rates_for(*, server: str) -> Optional[RequestRates]:
    """The per-request rate for one MCP server, or `None`.

    Keyed by `server`, not `provider`: the MCP plane has no provider, and its
    `resource_locator` carries `{"server", "tool", "endpoint_id"}`. Using the key the
    producer actually writes is the point of reading the locator rather than splitting
    `resource_key`."""
```

```python
# `charges.py`

def calculate_charge(*, command: MeasurementCommandV1) -> Optional[Tuple[int, str]]:
    """`(amount_musd, pricing_version)`, or `None` when this measurement is not charged.

    Not charged means any of: the endpoint is not `builtin`; the call was paid on the
    customer's own credential (`secret_origin` is `vault`); the card prices no rate for the
    model or server; or every rate that applies is zero. Never returns a non-positive amount,
    and never returns an amount for a measurement it could not price.
    """
```

The arithmetic, stated once so that no implementation has to infer it:

```text
LLM   rates = token_rates_for(provider=locator["provider"], model=locator["model"])
      total_micro_musd = Σ over the four token components of (value × its rate)

MCP   rates = request_rates_for(server=locator["server"])
      total_micro_musd = request_count × musd_per_request × 1_000_000

      amount_musd      = ceil(total_micro_musd / 1_000_000)  when total_micro_musd > 0
                       = no charge                           when total_micro_musd == 0
```

`request_count` is emitted on every LLM measurement and priced at nothing on that plane, which
is deliberate rather than an oversight: an LLM call is priced by its tokens, and the request
count is carried because it is a fact about the call, not because it is billable. A component
the card does not price contributes zero and is not an error. A component the card *needs* and
does not receive is a different thing entirely, and that is what `IM-2-01` checks.

`value × rate_per_million` is an exact integer product; the single division at the end is the
only place precision is lost, and it is lost upwards, in our favour by at most one
micro-dollar per call. A charge that rounds to zero becomes one micro-dollar rather than
nothing, because a card that prices a model has decided it is chargeable.

## Field roles

| Field | Role | Owner | Changes |
| --- | --- | --- | --- |
| `TokenRates.*` | config — the price list | product, through a reviewed change | rarely, and never without a new version |
| `RATE_CARD_VERSION` | metadata stamped on each debit | the card itself | with every rate change |
| `command.secret_origin` | policy input — who paid, and here only a veto | the gateway, from the target's namespace | per call |
| `command.endpoint_kind` | routing identity that happens to be the billing boundary | the gateway's namespace | per call |
| `amount_musd` | derived output | this function | per call |

The rate card is **config**, not data and not policy: an operator-owned table with a long
lifetime, versioned like configuration and reviewed like configuration. Chargeability, by
contrast, is **policy** derived from two per-call facts, and it is deliberately not expressed
as a flag on the rate card — a model does not stop being priced because one caller brought
their own key.

## Required evidence

Unit tests: the four token rates applied to a full five-component measurement including an
unpriced `request_count`, checked against a hand-computed figure; the MCP flat rate producing
the same charge it produced under the fixture, driven by the MCP fake rather than a hand-built
command; a measurement carrying no `secret_origin` at all still charging, since that is every
MCP measurement and every un-stamped `builtin` one; rounding at the boundary, including the sub-micro-dollar charge that
must become one rather than zero; a zero total producing no charge; an unpriced model
producing no charge and one error log; `secret_origin` other than `local` producing no charge;
`endpoint_kind` other than `builtin` producing no charge; and a version-stamp test that fails
if `RATE_CARD_VERSION` is unchanged while the table's contents are.

## Explicit exclusions

No gateway-branch file, no admission, no wire-envelope change, no migration, no markup on a
vendor price — the card holds our price, and the vendor's is item 8's reconciliation problem,
not a factor in this arithmetic.
