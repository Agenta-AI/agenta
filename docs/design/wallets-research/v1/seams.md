# The seams

Four efforts have specified some part of "charge an organization for what it consumes."
None of the four read all of the others. This document says what each already settled, what
is genuinely contested, and what is nobody's yet.

State as of 13 August 2026.

## The four efforts

| Effort | Where | Status | What it settled |
| --- | --- | --- | --- |
| Meters and entitlements | shipped, on `main` | in production | Meter rows per organization, quotas with strict/non-strict caps, `check_entitlements` as the one gate, `MetersDAO.adjust()` as the atomic conditional write |
| Sandbox metering, tracks A–D | PR 5037 merged; 5039, 5040 open drafts; track D unfiled | code frozen since 6 July 2026 | Measurement from two providers with opposite billing windows, a typed rate table, the unit-in-the-name meter key scheme, `secret_origin` zero-rating, measure/bill split |
| Gateways | `docs/design/gateways-research/`, PR 5925 | wave-1 workstreams written, worktrees cut | The request path, one policy core under two protocol surfaces, the minted run token, D11 (this design owns the gateway) and D12 (the gateway owns all six concerns) |
| Credits and the ledger | this branch | design only, no code | Append-only entries with a stored balance projection, grants as lots, holds and settlement, a versioned rate card, micro-dollar storage |

## What the gateway design already took, and what it left

`gateways-research` D11 resolves the overlap that used to exist between it and `report.md`:
four efforts had specified an LLM gateway, and that design owns it. The run token, the north
port shape and the process placement were adopted from `report.md` rather than re-derived.
D12 goes further — the gateway owns metering and billing too, and a ledger is a **caller**,
never a second request path.

So the gateway half of `report.md` §6.3, §7.3 and §7.4 is **input, not plan**. Read those
sections for the reasoning behind a decision that has already been made elsewhere, and read
`gateways-research/v1/{architecture,policy}.md` for what is actually being built.

What survives here as unowned work is everything a caller decides:

- What a balance is, and how it is computed. §7.2 of `report.md`.
- Where credits come from — grant, purchase, contribution — and how lots expire and are
  spent in order. §4.4, §7.2.
- What a hold and a settlement mean, and which of them the gateway calls. §4.3.
- What a charge records so it can be explained a year later: raw token counts, run
  identifier, rate card version. §7.5 lists these as the decisions with no later backfill.
- The unit, the price list, and who converts credits to money. §7.1.
- The twelve product decisions in §9.

Two of the gateway design's own open items land squarely on this side and should be answered
here rather than there: `policy.md` leaves *"the meter keys, and where pricing lives"* to
establish, and *"where spend ceilings are evaluated."*

## What the sandbox-metering track already settled

`addendum-sandbox-metering.md` is the full comparison. Four things from that track are
better than anything the ledger design has, and should be adopted rather than re-argued:

- **The unit belongs in the meter name** — `SANDBOX_CPU_CORE_SECONDS`, not
  `SANDBOX_CPU_SECONDS`. The rate card's `component` values inherit this.
- **`secret_origin`** stamped on every resolved connection is the cleanest zero-rating
  mechanism either design has, and it covers models, sandboxes and tools with one stamp.
  `gateways-research/v1/policy.md` independently requires the same field.
- **The billable window is a fact about each provider.** One provider stops charging for
  compute on pause; the other charges for the whole alive window. Pricing that ignores this
  over-bills.
- **Measure before you bill.** Track B measures and reports nothing; Track C prices and
  gates. That split is why the measurement work can land while every pricing question is
  still open, and it is the same shape as the gateway's shadow-mode phase.

The one real conflict is the debit side: that track's balance is a sum of grant rows minus
one accumulating meter counter. A counter cannot say which run spent the credits, cannot
refund one charge, and cannot be split later — `research/03-project-dify.md` documents a
project that tried and had no correct backfill. The funding side of that design is already an
append-only ledger and is not in dispute.

## Three live meanings of one word

All three are real right now, and two already sit in the same file of meter keys.

| Meaning | Unit | Where |
| --- | --- | --- |
| One credit = one request against platform-supplied provider keys | a request count | `Counter.CREDITS_CONSUMED`, in production, 100/month on paid plans |
| One credit ≈ one cent of provider list price for sandbox compute | millicredits | `feat/metering-track-c` |
| One credit = one tenth of a cent of usage value across models, tools and sandbox | micro-dollars | `report.md` §7.1 |

`gateways-research` D24 leaves the first alone until the gateway is the sole mechanism.
Only one of the other two can keep the user-facing word, and the two stored units differ by
a constant factor of ten, so the conversion is lossless either way.

## Mechanical collisions to fix before anyone writes code

- **Migration numbers.** The EE chain head on `main` is `ee0000000003`. Track B claims
  `ee0000000004`, Track C claims `ee0000000005`, and `report.md` §7.5 claims both for the
  ledger and gateway runtime. Whoever lands second renumbers. Note the gateway workstreams
  target the OSS chain `core_oss` instead, so they do not collide with either.
- **Stale branch bases.** Both open metering PRs target `feat/add-sandbox-metering`, whose
  own base has since merged to `main`, so their diffs no longer read cleanly.
- **A PR body that its own branch tip contradicts.** PR 5040 describes Stripe converting
  credits to money through the plan price; the tip commit removes the sandbox key from
  `REPORTS` and writes the opposite reasoning into the code.

## What nobody owns yet

- **The failure posture when one balance serves several resources.** The metering track
  fails open, the gateway design fails closed. Both are right for their own resource. If
  they share a balance the posture has to be decided per call site and written down.
- **Reconciliation against the provider invoice.** Named as a relaxed guarantee in
  `report.md` §8.4 and absent from every other document.
- **The success criterion for a funded tier.** `report.md` §9.10 argues this is the decision
  most likely to be skipped and most expensive to skip.

## What is still unverified

`report.md` §10 lists seven facts the cost model rests on, each with the test that settles
it. Two can change the plan: whether the provider's OpenAI-compatible endpoint reports cached
tokens at all, and whether it reports usage on a streamed response. If the second is false,
token-derived pricing is unavailable on that path and the flat-rate contingency in §6.4
becomes the plan rather than the fallback.
