# Wallet mechanics

What a wallet holds, everything that can put value into it, everything that can take value
out, how those numbers become money, and how a subscription relates to any of it.

This document is a working draft for a decision, not a settled design.

---

## 1. Three stores, not one

The instinct to grow away from meters is right, but the replacement is not one thing. Three
stores answer three different questions, and every current problem comes from one store being
asked a question that belongs to another.

| Store | Question it answers | Shape | Resets? | Carries money? |
| --- | --- | --- | --- | --- |
| **Meters** | how much of your allowance is left this period | one number per key per period | yes | no |
| **Usage journal** | what physically happened | one row per measured event | never | no |
| **Wallet ledger** | how much value do you own, and where did it come from | one row per movement of value | never | yes |

**Pricing is the function from the journal to the ledger.** **Entitlement is a predicate over
the meters.** Keeping those two apart is the whole design.

What this rules out, concretely:

- **Value never lives in a meter.** A meter is periodic by construction, so a balance stored
  in one silently resets. The sandbox track's `WALLET_DEBITS` carries `Period.MONTHLY` on all
  five plans, which would make spending appear to vanish on the first of the month while the
  grants stayed — a real instance of exactly this error.
- **Measurement never lives in the ledger.** The ledger records a value and a reference; the
  four raw quantities behind a sandbox charge or the five token counts behind a model call
  live in the journal. Otherwise a price change makes old charges unexplainable.
- **Meters do not disappear.** Seats, retention, trace allowances, daily read limits and rate
  buckets are periodic entitlements and belong exactly where they are.

**One ledger, one unit.** The point of a wallet is a single number a person can act on. More
than one value ledger means more than one balance, and every user question becomes two. What
looks like "several ledgers" is really several **kinds** of movement in one, which section 3
and 4 enumerate. A second ledger becomes justified only if a second *unit of account* appears
that cannot be pegged to the first.

### The one live overlap

Traces are metered monthly with an allowance, and the overage is reported to Stripe in
arrears — the only key in `REPORTS` today. That is genuinely the same job the wallet does,
done the other way round. It is the one existing product that could move, and whether it
should is the real test of whether the wallet is general or just a model-call feature. It
cannot be both: an allowance meter and a wallet debit for the same event double-charges.

**Proposal:** the wallet absorbs anything variable-cost and pay-as-you-go. Meters keep
anything that is a plan entitlement with a hard cap. Traces move only when we want them
prepaid.

---

## 2. Naming

Generic names are how two systems end up meaning the same word. Three rules.

**The unit goes in the column name.** This is the sandbox track's own meter-key rule —
`SANDBOX_CPU_CORE_SECONDS`, never `SANDBOX_CPU_SECONDS` — applied to the ledger. So
`amount_micro_usd`, never `amount`. It removes the entire class of bug where a number is
written in one unit and read in another, and it is free.

**A row is named for what it is, not for the table it is in.** `entry`, `record`, `value` and
`data` are placeholders.

**One word, one meaning, across the whole domain.** `grant` currently means both *the
container of arrived value* and *the free kind of arrival*. Those must be two words.

| Concept | Proposed name | Why not the obvious one |
| --- | --- | --- |
| The account, one per organization | `wallet` | — |
| One movement of value, append-only | `wallet_movement` | `entry` and `record` say nothing; `transaction` collides with database transactions |
| One arrival of spendable value | `wallet_lot` | `grant` is one *origin* of a lot, not the container |
| Which lot paid for which movement | `wallet_allocation` | — |
| Value reserved before the true cost is known | `wallet_hold` | — |
| A versioned price list | `price_book` | `rate` collides with rate limiting; "price book" is standard commerce vocabulary |
| One priced component in that list | `price_line` | — |
| The physical measurement behind a charge | `usage_event` | `usage_record` is a placeholder name |
| A promotion and its total exposure cap | `campaign` | — |
| Permission to spend past zero | `credit_line` | — |

A movement carries a **direction** (`inbound` / `outbound`), a **kind** from sections 3 and 4,
and a **phase** (`posted` / `held` / `settled`). Direction and kind are separate on purpose: an
expiry and a model call are both outbound and nothing else about them is alike.

---

## 3. Everything that can put value in

Thirteen kinds. Each needs an idempotency key, and the key is different for each — that is the
main reason to enumerate them rather than write "grant".

| Kind | Trigger | Idempotency key | Expires? | Notes |
| --- | --- | --- | --- | --- |
| `signup_grant` | signup path only | organization + campaign | yes | never on explicit org creation, or it is farmable |
| `plan_allowance` | subscription period start | organization + plan + period | at period end | see §5; the only recurring inbound |
| `purchase` | checkout completed | payment identifier | long or never | |
| `auto_recharge` | balance crossed a threshold | payment identifier | long or never | same shape as purchase, different trigger; §7 |
| `promotion` | a code, a campaign, a conference | organization + campaign | yes | must debit a campaign budget, §7 |
| `contribution_award` | approved contribution | contribution identifier | yes | backdatable; approver recorded |
| `referral_bonus` | referral converted | referral identifier | yes | both sides get one |
| `goodwill` | a human deciding | support case identifier | choice | not tied to any one charge |
| `charge_refund` | a specific charge reversed | the movement being reversed | inherits | points at an outbound movement; distinct from goodwill |
| `chargeback_reversal` | card dispute upheld | dispute identifier | — | negative inbound; can drive a balance negative |
| `opening_balance` | migration or seeding | organization + migration name | choice | the one everybody forgets, and the one that most needs a key |
| `partner_allocation` | funded from another organization's pool | source movement | inherits | needs the counterparty column; not first version |
| `correction` | an operator fixing arithmetic | ticket identifier | — | never an edit to an existing row |

Two of these are structural, not cosmetic. **`charge_refund` must point at the movement it
reverses**, or a refund is indistinguishable from a gift and reconciliation cannot close.
**`opening_balance` must exist from day one**, because the moment the old 100-request monthly
allowance is converted for real customers, that conversion is a movement someone will ask
about.

---

## 4. Everything that can take value out

Two families, and conflating them is a mistake. A **charge** is value exchanged for something
the customer got. An **adjustment** is value leaving for any other reason.

**Charges** — always paired with a `usage_event`:

| Kind | Measured by | Priced from |
| --- | --- | --- |
| `model_call` | gateway | five components: fresh input, cached input, cache write, output, reasoning |
| `tool_call` | gateway, tool plane | per category |
| `sandbox_compute` | provider webhook or poll | four components: vCPU-second, RAM GiB-second, disk GiB-second, GPU-second |
| `storage_at_rest` | gauge, sampled | derived: a periodic charge computed from a level, not from an event |
| `trace_ingestion` | ingestion pipeline | only if traces move off the meter, §1 |
| `evaluation_run` | evaluation service | only if it moves off the meter |
| `egress` | not measured today | — |

**Adjustments** — no `usage_event`:

| Kind | Meaning |
| --- | --- |
| `lot_expiry` | a lot reached its expiry with value unspent |
| `clawback` | an award voided after the fact |
| `correction` | an operator fixing arithmetic |
| `write_off` | we served something and chose not to charge for it |

Four notes that decide schema:

- **Expiry has to be a movement.** If a lot expiring is not written as an outbound row, the
  balance stops being the sum of the ledger and the reconciliation query stops working.
- **`storage_at_rest` is derived from a level**, not from events. Billing cumulative writes
  instead of held size is a real and easy error, and the sandbox track's specification already
  warns about it.
- **`hold` and `settle` are phases, not kinds.** A hold is a `model_call` movement in phase
  `held`. This keeps the kind list about resources.
- **`write_off` is not the absence of a charge.** It is a recorded decision, so the circuit
  breaker in the report has a number to count.

---

## 5. How numbers become money

Two conversions, opposite directions, and they must be governed differently. Every credit
system that has angered its users moved both.

**Money in → credits. A fixed peg.** One credit is one tenth of a United States cent, and
that never changes. Twenty dollars always buys twenty thousand credits. A "20% more credits"
promotion mints a **bigger lot**, never a better exchange rate. This is what makes the unit
learnable, and it means we can never be accused of devaluing a balance somebody paid for.

**Consumption → credits. A versioned price book.** `quantity × unit_price × margin`, summed
across components, rounded once at the end. Every charge stamps the `price_book_id` that
priced it. A price change publishes a new book and repoints the active pointer; old charges
stay explainable because the book they used still exists.

The separation is the whole point: the peg is frozen, so **every price change is a visible
price change** rather than a quiet devaluation.

**Where money actually moves.** Only three places: a checkout, an auto-recharge, and a
subscription invoice. Consumption never produces a Stripe line, because the value was bought
before it was spent. This is the prepaid rule, and the sandbox track's branch tip already
reached it from the other side — its comment on `REPORTS` says the wallet total is prepaid and
must never be reported in arrears.

---

## 6. How a subscription relates to a wallet

A subscription does three separate things. Today they are one thing, and that is why the
question is hard.

**1. It sets entitlements.** Features, seats, retention, hard caps, rate buckets. These stay
in meters and flags. The wallet is not involved.

**2. It mints a recurring `plan_allowance` lot.** One lot per period, expiring at period end,
priority "spend first". A plan change mid-period does not rewrite anything: it voids the
remainder of the current allowance lot and mints the new one. Because lots are rows, both are
visible afterwards.

**3. It sets the wallet's commercial terms.** This is the part nobody has written down:

- which `price_book` this wallet prices against — an enterprise negotiation is a different
  book identifier on the wallet, not a special case in code;
- the `credit_line` — how far past zero this wallet may go, and under what conditions;
- whether auto-recharge is permitted, and its ceiling;
- whether unspent allowance rolls over.

**Spend order falls out of this and needs no separate rule.** Soonest expiry first, priority
as tie-break. Which means: plan allowance (worthless if unspent) → promotions → earned →
purchased (never expires, somebody paid for it). That is the order a user would choose for
themselves, and it protects earned value from being stranded behind a grant that outlives it.

---

## 7. Extending: the number nobody has defined

"Am I able to spend more, and by how much" is not the balance. Four numbers, and the product
needs all four:

```
balance    = inbound_posted − outbound_posted        value owned right now
available  = balance − outbound_held                 what a new call may draw against
headroom   = available + credit_line + recharge_capacity
             what could be spent, if we let them
runway     = available ÷ recent burn rate           how long that lasts
```

The report has only `spend_policy ∈ {hard_stop, allow_negative}` — a boolean where a number
belongs. Replace it with a **credit line**: a limit, a reason it was granted, and an expiry.
Then "can I extend" has one answer with one explanation, and enterprise net-terms customers
are configuration rather than a code branch.

**Auto-recharge** needs five things to be safe, and the fifth is the one that gets skipped:
a threshold, an amount, a stored payment method, a lock so two concurrent calls do not both
trigger it, and **a ceiling per period** so a runaway agent cannot bill a card repeatedly. The
ceiling being hit is a support event, not a failure.

**Promotions need a campaign, not just a lot.** A campaign carries a code, a window, an
eligibility rule, a per-organization cap, and a **total budget**. Minting promotional lots
without a campaign budget means the only bound on a farming attack is how fast people can sign
up. The campaign is also what makes "what did this conference cost us" answerable.

---

## 8. What has to be decided

1. **Does the wallet absorb traces and evaluations, or only the new resources?** The answer
   decides whether this is a billing system or a model-call feature.
2. **Which of the three names for the user-visible unit survives**, and what the old
   100-request monthly allowance converts to as an `opening_balance`.
3. **Is the peg fixed at one tenth of a cent**, and is the price book the only thing that
   moves?
4. **Does plan allowance roll over**, or expire at period end?
5. **Is there a credit line at launch**, or is hard-stop-everywhere the first version with the
   column present and always zero?
6. **Do the three families — model, tool, sandbox — stay a dimension of a charge** so
   "what did we spend on models versus sandboxes" is a `GROUP BY` rather than a schema change?
