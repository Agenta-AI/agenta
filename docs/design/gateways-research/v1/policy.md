# Gateways: the policy core

The shared plane both gateways evaluate against. This document exists because the sharing is
the reason the two gateways are one design — if this turns out not to be shared, they should
be separate systems.

**Status: skeleton.** The inputs are established; the evaluation and caching are open.

**All six are owned here (D12), and arrive incrementally.** Owned is not scheduled: a concern
may be unimplemented, but none is designed out, and no other system may route around this one
to get it. The test for each increment is whether it forecloses a later one.

## Six concerns, two nouns

| Concern | Model plane | Tool plane |
|---|---|---|
| Identity | which principal is calling | which principal is calling |
| Authorization | may they use this model, at this cost | may they use this server, this tool |
| Governance | model allowlists, spend ceilings | tool allowlists, approval, egress |
| Compliance | one audit record per call | the same record, different noun |
| Metering | tokens and cost, per principal and payer | calls, per principal |
| Routing | provider and deployment selection | which backend owns this target |

Only the rightmost columns differ. The claim this document has to make good on is that the
left column is one implementation.

## Identity — settled

Every authenticated call already resolves an organization, workspace, project and user
together, and is rejected outright if any is missing. Both gateways inherit that principal
unchanged.

Nothing to design. What the gateway adds is that the principal must reach the audit record and
the meter, not merely the authorization check.

## Authorization — inputs established, composition open

Existing pieces: role-based enforcement, and a two-layer entitlement check that runs a cached
soft check at ingestion and a hard check behind it.

*To establish:* the exact call the gateway makes into each, whether a model or a tool is a new
permission subject or an existing one, and how a denial is expressed on each north port —
these have externally-fixed error shapes and cannot simply return our own exception.

**Keep permissions and entitlements distinct.** They answer different questions and
conflating them in tests or in code is a known trap.

## Governance — open

Allowlists exist in part: per-server tool policy is already on the runner wire as an
all-or-include list with names, and approval already exists as a per-tool axis with runner
machinery behind it.

*To establish:* whether allowlists move to the gateway or stay declared per run and are merely
enforced there; where spend ceilings are evaluated; and how egress policy composes now that
one host serves all traffic — an allowlist of one becomes coherent where a list of provider
endpoints never was.

## Compliance — open

*To establish:* one audit record shape covering both planes. It must carry the principal, the
credential owner, the payer, the upstream target, the decision and its reason, and the
outcome. The owner and payer are the two fields that cannot be reconstructed later.

Open: whether audit rides the existing tracing pipeline or is a separate durable record. They
have different guarantees — tracing is sampled and lossy by design, compliance is not.

## Metering and billing — owned, later

Meters and entitlement layers exist. The gateway is the natural place to record model tokens
and tool calls, since it is the only point that sees all of both. Under D12 it owns billing
too, and a ledger or a grant is a **caller** rather than a parallel path.

Two things must be true from the first increment, because neither can be added retroactively:

- **Record real usage from day one**, even while charging a simpler price. The data to correct
  a pricing model later does not exist unless it was written at the time.
- **Record `secret_origin` and the owner** with every entry, so a call paid for by a customer's
  own secret is not billed as ours.

*To establish:* the meter keys, and where pricing lives. Parallel work has settled much of
this already — see `raw/related-work.md`.

## Routing — open

*To establish:* whether routing is pure derivation from the registry or a policy decision that
can be overridden. This is the difference between a gateway that enforces and a gateway that
also decides, and it should be chosen deliberately.

## Decision caching

Fail-closed on policy, with the data plane serving cached decisions through a control-plane
outage.

*To establish:* what is cached, keyed how, for how long, what invalidates it, and which classes
of call must never be served from cache. The existing soft-check/hard-check split is the
precedent to follow rather than invent around.

## The test that matters

If this document ends up being two documents — one per plane — with little in common, then
`decisions.md` D1 is wrong and the gateways should be separate systems with separate
lifecycles. **Watch for that outcome rather than defending against it.**
