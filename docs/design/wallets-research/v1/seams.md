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
| Gateways | `docs/design/gateways-research/`, PR 5925 | wave-1 workstreams written, worktrees cut | The request path, one policy core under two protocol surfaces, the minted run token, D11 (that design owns the gateway) |
| Wallets — the ledger | this branch | design only, no code | Append-only entries with a stored balance projection, grants as lots, holds and settlement, a versioned rate card, micro-dollar storage |

## The line between the gateway and the wallet

**The gateway owns the request path. The wallet owns metering and billing.** D11 stands: four
efforts had specified an LLM gateway and that design owns it — the run token, the north port
shape and the process placement were adopted from `report.md` rather than re-derived. D12's
claim that the gateway also owns metering and billing does not; it is being removed from that
design.

So the gateway half of `report.md` §6.3, §7.3 and §7.4 is **input, not plan** — read
`gateways-research/v1/{architecture,policy}.md` for what is actually being built on the
request path. But the accounting half of §7.4 is now wrong in the other direction: it gives
pricing to the gateway. Pricing belongs here, with the rate card.

The split follows the distinction the metering track already insists on, that permission and
entitlement are different questions and neither may stand in for the other. Extended one
step: **the gateway enforces, the wallet accounts.**

| Question | Owner |
| --- | --- |
| May this principal call at all, and against which model | gateway |
| Does this organization have value left to spend | wallet |
| What is this call allowed to cost | wallet decides the number, gateway enforces it |
| What did it actually consume | gateway measures, wallet records |
| What is that worth in credits | wallet, from the rate card |
| What does the balance say now | wallet |

That makes the seam a **port, not a shared table**: an authorization call before dispatch that
returns a spending ceiling, and a usage call after the response that hands over raw
measurement. The gateway holds the interface; the wallet holds both implementations. It is
the same shape the sandbox sink needs, so model calls, tool calls and sandbox time end up
three callers of one interface rather than three accounting systems.

Four things the gateway must still carry from its first day, because none can be added
retroactively — they are the test that an increment forecloses nothing:

- the principal on every emission: organization, project, and **run**;
- `secret_origin` and the credential owner, so a call paid on a customer's own key is not
  billed as ours;
- the raw measurement, including cache reads separately from fresh input;
- a decision point before dispatch, even while it always answers yes.

What is wholly ours: the balance and how it is computed (§7.2), where credits come from and
how lots expire and are spent (§4.4, §7.2), what a charge records (§7.5), the unit and the
price list and who converts credits to money (§7.1), and the twelve product decisions in §9.
Plus the two items `gateways-research/v1/policy.md` still leaves open — *"the meter keys, and
where pricing lives"* and *"where spend ceilings are evaluated"* — which are now questions
with a home rather than questions between two designs.

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

- ~~**The failure posture when one balance serves several resources.**~~ Answered in
  `mechanics.md` §2: it is fixed per resource class, not per call site. Fail closed on
  vendor pass-through, because the alternative is spending cash we do not have. Fail open on
  platform capacity, because dropping telemetry to protect billing is the wrong trade. The
  two existing designs were each right about their own resource and wrong to generalise.
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
