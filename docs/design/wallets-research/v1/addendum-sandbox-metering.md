# Addendum: the sandbox-metering track and the credit ledger

## 1. What this document covers

Two pieces of work at Agenta charge users for what they consume. Neither one knows about the
other.

The sandbox-metering track built the first. It measures how much sandbox compute each organization uses, converts that
measurement into a billing unit, and blocks a run when an organization is over its allowance. A
**sandbox** is the isolated cloud container an agent run executes inside. The work lives on four
branches and two open draft pull requests, numbers 5039 and 5040.

We designed the second. It is a credit ledger and a model gateway, described in
`design/report.md`. It exists so a new user can run an agent on our money before they connect
their own model provider key, and so credits can later be bought and earned.

Both call their unit a "credit". The two units are not the same thing. That is the first problem
and it is not the only one.

**The recommendation fits in three sentences.** Land the measurement work as it stands, because
nothing in our design conflicts with measuring. Build one ledger, ours, and make sandbox compute
one more thing it charges for, so a user sees one balance in one unit. Drop the separate wallet
table from the Track C plan, keep his rate table as the price list for sandbox resources, and let
his gate read our balance instead of a meter counter.

---

## 2. Where the sandbox-metering work stands right now

The four branches form a stack, meaning each one is based on the one below it.

| Branch | Pull request | State | Base branch | Last commit |
|---|---|---|---|---|
| `feat/add-sandbox-metering` | 5037 | Merged 2 July 2026 | `big-agents` | 2 July 2026 |
| `feat/metering-track-b` | 5039 | Open draft | `feat/add-sandbox-metering` | 6 July 2026 |
| `feat/metering-track-c` | 5040 | Open draft | `feat/metering-track-b` | 6 July 2026 |
| `feat/metering-track-d` | none | no pull request | `feat/metering-track-c` | 6 July 2026 |

Two details in the usual summary of this stack are wrong. Pull request 5037 is merged, not closed,
and its base branch `big-agents` is now an ancestor of `main`.
`git merge-base --is-ancestor origin/big-agents origin/main` confirms it. So Track A already
shipped to production: users are no longer billed per seat, retention windows moved down one tier
per plan, and the base prices are now zero, twenty-nine, and two hundred ninety-nine dollars.

The second wrong detail is the date. Both open pull requests show 25 July 2026 as their last
update, but the last commit on each branch is 6 July 2026. The July update is a comment on each one, linking them to issue 5505, "Usage and cost telemetry". The code itself has
not moved since 6 July 2026.

Pull request 4783 is the earlier documentation-only design, closed on 5 July 2026 without merging.
Its research is still the best record we have of what Daytona's API can and cannot do, and section
7 comes back to it.

---

## 3. What the sandbox-metering system does

This section describes his design on its own terms. Judgement comes later.

### 3.1 The machinery he builds on, and what its words mean

Agenta's commercial edition already has a metering and entitlements layer, and the track adds keys to it
rather than building anything new. Five terms carry the whole thing.

A **meter** is a row in a Postgres table that holds one running number for one organization and
one named quantity. The file is `api/ee/src/dbs/postgres/meters/dao.py`. A meter row is bucketed
by time period when the quota that governs it declares a period, so a monthly meter has one row
per organization per calendar month (`api/ee/src/core/meters/types.py`, class `MeterPeriod`).

A **counter** is a meter that only goes up during its period, such as the number of traces
ingested. A **gauge** is a meter that holds a level rather than a total, so it goes up on a write
and down on a delete. The only gauge in production today counts users.

A **quota** is the rule attached to a meter: a free allowance, a limit, and whether the limit is
strict. Strict means the write is refused at the cap. Not strict means the write is allowed past
the cap and the overage gets billed.

An **entitlement check** is the single function that reads or writes a meter and answers whether
the caller may proceed. It is `check_entitlements` in
`api/ee/src/core/access/entitlements/service.py`. With `cache=True` it reads a Redis-cached value
and writes nothing. With `cache=False` it performs an atomic database write that applies the quota
rule in the same statement, through `MetersDAO.adjust()` at line 376 of the file named above.

`REPORTS` is a dictionary in `api/ee/src/core/access/entitlements/types.py`. A meter is sent to
Stripe if and only if its key appears there. On `main` today it contains exactly one entry,
`traces_ingested` mapped to `traces`.

Two more words matter for section 7. Billing **in arrears** means the customer uses something
first and pays afterwards, which is how the traces meter works: the meter accumulates and Stripe
invoices the total at the end of the cycle. **Prepaid** means the customer pays first and spends
down a balance, which is how our design works.

### 3.2 What his system measures, and how it gets the numbers

Two sandbox providers report usage in two different directions, and both feed one function.

E2B pushes. It calls a webhook, meaning an HTTP request that the provider sends to us when
something happens, on the events `created`, `paused`, `resumed`, and `killed`. The receiver lives
at `api/ee/src/apis/fastapi/sandboxes/router.py` on `feat/metering-track-b`, verifies a signature
against a shared secret, and deduplicates on the delivery identifier so a retry does not count
twice.

Daytona does not push, so we pull. A scheduled job calls
`GET /organization/{org}/usage/aggregated` and reads back cumulative totals for the period. Since
the totals are cumulative, the job writes the difference between the authoritative total and the
current meter value, which makes a missed run or a duplicate run self-correcting.

Both paths land in `SandboxMeteringService.record_usage()` in
`api/ee/src/core/sandboxes/service.py`. The measurement itself is four numbers per event: CPU
core-seconds, RAM gibibyte-seconds, disk gibibyte-seconds, and GPU core-seconds. His specification
is careful about a detail that is easy to get wrong. E2B stops charging for compute the moment a
sandbox is paused, while Daytona charges for the whole time the sandbox is alive. So a paused E2B
session over-bills unless the code closes the compute window on `paused` and opens a new one on
`resumed` (`prior-work/jp-sandbox-metering/metering-specs.md`, section 2).

A separate storage gauge tracks bytes at rest in the object store, reconciled on a schedule by
listing objects under each organization's prefix
(`api/ee/src/core/storage/adapters.py` on `feat/metering-track-b`).

Track B stops there. Nothing it writes reaches Stripe. `REPORTS` on that branch still contains
only traces, which I verified by reading the file on the branch.

### 3.3 How four raw numbers become one billable number

Track C converts. The reasoning in pull request 5040 is that core-seconds and gibibyte-seconds are
different physical quantities, so there is no single number to gate on until you convert them into
a common one.

The conversion lives in `api/ee/src/core/sandboxes/credits.py`. A `Dimension` enum names the four
resources. A `ProviderRates` model holds one rate per dimension, as a `Decimal`, and there is one
instance per provider in `DEFAULT_PROVIDER_RATES`. The `local` provider is rated at zero, because
a sandbox running on our own machine costs us no provider bill. An operator can override any rate
through the environment variable `AGENTA_SANDBOX_CREDIT_RATES`. The function `to_credits()` is
pure: it takes a provider, a dimension, and a quantity, and returns credits. It performs no
input or output and it never computes money.

The default rates are worth reading closely, because they encode a decision that the code does not
state. E2B is rated at 0.0014 credits per vCPU-second. His own specification says one credit is
about one cent of list price (`prior-work/jp-sandbox-metering/billing-specs.md`, part 1). The
metering specification quotes E2B's real price as $0.000014 per vCPU-second
(`metering-specs.md`, section 2). Multiply 0.0014 credits by one cent and you get exactly
$0.000014. So the default rate table is provider cost passed through at one credit per cent, with
no margin added. Margin, under his design, comes from the price Stripe charges per credit.

Credits are stored as **millicredits**, meaning credits multiplied by one thousand and truncated
to a whole number. The reason is mechanical and correct: the delta field on the meter data
transfer object is an integer, and a sandbox minute costs a fraction of a credit. The reference
machine in his own comment, two vCPU and two gibibytes of RAM and ten gibibytes of disk, costs
about 0.2232 credits per minute, which is 223 millicredits.

The sink in `api/ee/src/core/sandboxes/sink.py` writes each dimension's credits to its own meter,
sums them, and writes the total. One detail there shows real accounting instinct. The total is the
sum of the millicredit amounts actually written, not a fresh truncation of the exact sum, so the
total always reconciles against the per-dimension breakdown even when a dimension rounds to zero.

### 3.4 Where his system blocks a run

Gating lives in `api/ee/src/core/sandboxes/gating.py` and has two layers.

Layer one runs before a sandbox launches. It reads the cached meter value and adds an estimate of
what the new sandbox will consume, computed as two vCPUs for three hundred seconds by default and
converted through the same rate table that prices real usage. If the result is over quota, the
launch is refused with a message aimed at an HTTP 429 response.

Layer two runs after the usage has landed. It re-reads the meter with a delta of zero and reports
whether the organization is now over. When it is over, the code logs a warning and stops, because
the endpoint that kills a running session does not exist yet.

Both layers **fail open**, meaning any unexpected error allows the run and writes a warning to the
log. Every meter write in the sink is wrapped the same way. That posture is deliberate and it
matches the existing entitlements service, whose rule is that a metering glitch must never block a
customer request.

He also insists on a distinction I agree with completely and that we should keep. Permission and
entitlement are different questions. Role-based access control answers whether this user may run a sandbox.
The entitlement check answers whether the organization has quota left. Neither one is allowed to
stand in for the other.

### 3.5 What the branch tip does that its pull request description does not say

This matters, because the code and its own description disagree.

Pull request 5040 describes a design where each dimension converts to credits, the credits sum
into `SANDBOX_CREDITS`, that one key is added to `REPORTS`, and Stripe converts credits to money
through the plan price. The branch held exactly that at commit `a9fb0db958`.

The tip of `feat/metering-track-c` is one commit further, `c3d6b12879`, whose message is "WIP". It
changes the design. At that commit:

- Every key is renamed from credits to debits. `SANDBOX_CPU_CORE_CREDITS` becomes
  `SANDBOX_CPU_CORE_DEBITS`, and so on.
- Two new keys are reserved that have no sandbox meaning at all: `LLM_DEBITS` and
  `GATEWAY_DEBITS`.
- A grand total key appears, `WALLET_DEBITS`, defined in the code comment as the sum of the LLM,
  sandbox, and gateway families. Both gating layers now read that grand total rather than the
  sandbox subtotal.
- The raw resource-second meters leave the billing key list entirely, with a comment saying they
  explain cost rather than bill it.
- `REPORTS` goes back to traces only, with a new comment: the wallet total is prepaid, money moves
  at top-up time, so it must never be reported to Stripe in arrears.

That last bullet reverses the central decision in the pull request description. Some docstrings on
the branch still describe the old behaviour, which is normal for a commit labelled work in
progress. The direction is unmistakable, and it moves toward our design.

### 3.6 The wallet in his Track C specification

The specification file `prior-work/jp-sandbox-metering/billing-specs.md` goes further than any
code on the branch. It describes a prepaid wallet with these parts.

A new table, `wallet_credits`, holds one append-only row per arrival of credits. Its columns are
an organization, a kind, an amount in millicredits, a date it becomes spendable, an optional
expiry, a source reference, and a metadata blob. The five kinds are `signup_gift`,
`plan_allowance`, `card_topup`, `admin_promotion`, and `support_adjustment`. A partial unique
index on organization and source reference is the idempotency key. **Idempotency** means doing the
same operation twice has the same effect as doing it once, and a unique index is how you get it.

Balance is defined as one formula: the sum of unexpired credit rows minus the `WALLET_DEBITS`
meter value. His specification states plainly what that buys, and it reads as a considered
choice rather than an oversight: "One filtered sum, no FIFO, no per-grant allocation, no stored
mutable balance."

On top of that sit a monthly allowance created by a job that runs once a day, a signup gift,
one-time top-ups
through Stripe Checkout, automatic recharge against a stored card, and a tier number computed as a
plain monotonic sum of everything the organization has ever funded. Tier never falls except by
admin action, and running out of balance blocks a run without lowering the tier.

Track D, which has no pull request, extends the customer secret vault to sandbox and tool provider
keys and stamps every resolved connection with `secret_origin`, either `vault` for the customer's
own key or `local` for ours. Usage on a customer's own key contributes zero to the wallet. That is
the same rule our report reaches in section 9.10, arrived at independently, and his version is the
better mechanism because it is one stamp that covers models, sandboxes, and tools at once.

Three companion documents are cited throughout his specifications:
`tiers-and-unified-wallet.md`, `wallet-enforcement-matrix.md`, and `monetization-integration.md`.
None of them exist in the Agenta repository on any of the four branches, and I could not read
them. His own text says that where they and the specification disagree, they win. So parts of his
model may be better resolved than what I can see.

---

## 4. What our system does

Stated briefly, since `design/report.md` carries the full version.

A **model gateway** is a service of ours that stands between a running agent and the model
provider. It holds the real provider credential, so that credential never enters a container the
user controls, and it decides for each request whether to forward it. We need it because Google
sells no per-key spending limit, which the report establishes mechanism by mechanism in section
3.3.

A **ledger** is a list of entries that only grows. A **grant** is one arrival of credits, such as
a signup gift or a purchase. A **debit** is one departure, such as a model call. A **hold** is
value set aside before the true cost is known, which a model call needs because the cost depends
on tokens the model has not generated yet. **Settling** a hold replaces the reservation with the
true amount and releases the rest.

The unit is one credit, permanently equal to one tenth of a United States cent, stored as an
integer count of micro-dollars, meaning millionths of a dollar. Prices live in a **rate card**,
meaning a versioned and immutable price list, and every charge records which card priced it,
which run caused it, and the raw token counts behind it.

The plan is phased. No code exists yet.

---

## 5. The word credit already means three different things

Before any comparison, the vocabulary has to be fixed, because all three meanings are live right
now.

**The first meaning is in production today.** `Counter.CREDITS_CONSUMED` exists on `main` and it
gates access to the provider keys we supply. When an agent has no key of its own, the SDK asks the
backend whether it may use ours, and the backend charges one credit per request
(`api/oss/src/apis/fastapi/access/router.py`, the `local_secrets` branch). Every paid plan gets one
hundred of them per month, strict, so the hundred and first request is refused
(`api/ee/src/core/access/entitlements/types.py` on `main`). This is the small free trial the
report describes as the previous plan. It is a counter of requests. One credit is one request.

**The second meaning is the sandbox track's.** One credit is about one cent of provider list price for sandbox
compute, stored as millicredits. A minute of a reference sandbox costs about 0.22 credits.

**The third meaning is ours.** One credit is one tenth of a cent of usage value across models,
tools, and sandbox time, stored as micro-dollars. The same reference sandbox minute costs about
2.2 credits, and a cached model call costs about 1.6.

One product now carries three meanings of one word, and two of them already sit in the same file
of meter keys. Whatever we decide about the architecture, the naming has to be settled first, and
only one of these can keep the user-facing word.

I would keep our unit as the one the user sees, for one concrete reason rather than a matter of
taste. At one credit per cent, a sandbox minute is a fraction of a credit, so the number a user
watches barely moves while their sandbox burns. At one credit per tenth of a cent, a sandbox
minute is about two credits and a short conversation is about one hundred eighty, which are
numbers a person can feel. Both units are integers underneath, and his millicredit and our
micro-dollar are the same kind of decision, so this costs nothing to settle either way.

---

## 6. What the two systems actually share

The overlap is larger than the pull request titles suggest, and it is not where you would first
look.

| Layer | Sandbox-metering system | Credit-ledger system | Genuinely shared? |
|---|---|---|---|
| Raw measurement | E2B webhook, Daytona poll, storage listing | Provider usage on the model response | No. Different sources, no contact |
| Storage of the running total | Meter row per organization per month | Entry rows plus three counters on an account row | No. Same job, incompatible shapes |
| Grants and funding | `wallet_credits` table, five kinds, expiry, unique source reference | `credit_grant` table, six sources, expiry, idempotency key | Yes, almost line for line |
| Price list | Typed rate table in code, environment override | Rate card rows in the database, versioned | Yes, same job, different home |
| Gate before the work | Cached read plus an estimate, fails open | Durable hold in one transaction, fails closed | Partly. Same intent, different guarantee |
| Stripe relationship | Subscriptions plus one-time top-ups; usage no longer reported | Subscriptions plus credit packs; usage never reported | Yes, once the tip's change is taken as current |
| Plan catalog and per-plan tiers | `DEFAULT_ENTITLEMENTS` and `DEFAULT_CATALOG` | Untouched; the ledger sits beside them | Yes, and only his side touches them |
| Zero-rating a customer's own key | `secret_origin` stamp from Track D | A rule stated per resource in section 9.10 | Yes, and his mechanism is better |

Three of those rows deserve a sentence of their own.

**The grant tables are nearly the same table.** His `kind` maps onto our `source`. His
`amount_millicredits` maps onto our `amount`. His `granted_at` is our `effective_at`. His
`expires_at` is our `expires_at`. His unique index on organization plus source reference is our
idempotency index. Two people designed that independently and landed in the same place, which is
the strongest evidence available that the shape is right.

**The gate is the same intent with different strength.** He reads a cached number and adds an
estimate. We write a durable reservation inside a transaction. His version can be beaten by
concurrent launches, because a cached read reserves nothing. For sandboxes that barely matters, as
section 9 explains. For model calls it matters a great deal.

**The plan catalog is his alone.** Our ledger adds tables and touches no plan. His work edits the
per-plan quota table, the displayed pricing catalog, and the Stripe report set. If both land, his
is the only one that changes what the pricing modal says.

---

## 7. What we should take from his design

Each item states how his version works, then what we should do.

**The unit belongs in the meter name.** His locked scheme is
`SANDBOX_<RESOURCE>_<UNIT>_SECONDS`, so the key reads `SANDBOX_CPU_CORE_SECONDS` rather than
`SANDBOX_CPU_SECONDS` (`prior-work/jp-sandbox-metering/metering-NAMING.md`, and commit
`f6d747c69a` on `feat/metering-track-b`, which added the unit token after an earlier pass had
dropped it). It removes a whole class of bug where a number is stored in one unit and read in
another. Note that the findings file in the prior-work folder describes the shorter scheme and is
stale; the branch carries the longer one, and the pull request body is correct.

*Adopt it.* Our rate card has a `component` column whose values are things like `output` and
`sandbox_second`. When we add sandbox resources, the values should be `cpu_core_second`,
`ram_gibi_second`, `ssd_gibi_second`, and `gpu_core_second`, not four flavours of `sandbox_second`.

**He built a typed rate table with a pure conversion function.** His rates are a Pydantic model per
provider, all `Decimal`, and `to_credits()` performs no input or output. Unknown providers and
negative quantities return zero rather than raising.

*We already do the equivalent, and we should keep ours, with two borrowings.* Our prices live in
database rows rather than code, and section 6.2 of the report gives the reason: an operator edits
prices under pressure when a provider changes them, and a typo inside code needs a deploy while a
typo in a row can be caught by a constraint. What we should borrow is the zero-rated `local`
provider row, which is cleaner than a branch in code that says "if local, skip", and the rule that
an unknown input prices at zero rather than throwing inside a metering path.

**Conversion returns credits and never money.** His `to_credits()` computes a dimensionless unit,
and Stripe turns credits into money through the plan price. It is a clean separation and it copies
exactly how traces are billed today.

*We should differ deliberately, and his own branch tip already agrees.* Two reasons. First, we
have to compare our recorded consumption against Google's invoice, and that comparison is far
easier when our stored amount is already money. Second, and decisively, Stripe can only own the
credit-to-money step when credits are billed in arrears against a subscription. The moment credits
are prepaid, bought in packs, or earned by writing an article, no Stripe price exists to convert
them, because no invoice line is being produced. His tip states this in the code comment on
`REPORTS`: the wallet total is prepaid, so it must never be reported to Stripe in arrears. That is
our position, reached from his side.

**Store credits as thousandths because the meter delta column is an integer.** Sub-unit precision
survives without a schema change.

*Adopt the reasoning, and note it is the same reasoning as ours.* Our micro-dollar is his
millicredit scaled by ten. Integer storage of a fraction of the display unit is the correct
instinct and both designs have it. If we unify on our unit, his stored numbers convert by a
constant factor with no loss, because a millicredit at one cent per credit is exactly ten
micro-dollars.

**Split measuring from billing so one can ship without the other.** Track B measures and reports
nothing. Track C prices and gates. The split is real, not cosmetic: Track B adds nothing to
`REPORTS` and its quotas are non-blocking, so it cannot affect a customer.

*Adopt it, and it is the single most useful thing in his design for our sequencing.* Our phases
already have the same shape, since Phase 2 runs the gateway in shadow mode, meaning it prices calls
without debiting anyone. His track split is the reason his measurement work can land now even
though every pricing question is still open. Section 10 builds on that.

**Daytona exposes no per-sandbox usage or cost API.** Closed pull request 4783 recorded
this: CPU-seconds, gigabyte-seconds, and price are visible in the dashboard only; the one usage
endpoint returns live quota snapshots rather than cost; billing lags by up to forty-eight hours;
and our sandboxes are ephemeral, so a job that lists sandboxes finds them already destroyed.

*The finding stands and it shapes both designs.* It is why the design polls organization-level aggregates
instead of reading a per-sandbox bill, and it is why our report says sandbox time must be measured
by the runner from outside the container and priced by the backend (report section 7.4).

There is one unresolved tension between the two documents, and I cannot settle it. Pull request
4783 records that the organization usage endpoint was callable only with a signed browser session
token, called a JWT, and not with an API
key, citing the open issue daytonaio/daytona#4643. the sandbox-metering design polls that endpoint using an
organization-scoped API key plus an organization header
(`metering-specs.md`, section 4.3). Either Daytona changed, or he verified something 4783 did not,
or the polling design has a hole in it. Section 11 asks him.

I would add four more things to the list.

*He already reserved the keys that would let the two systems join.* `WALLET_DEBITS`,
`LLM_DEBITS`, and `GATEWAY_DEBITS` exist at his branch tip. He was already planning for model
spend and tool spend to share one balance with sandbox spend. Our report reaches the same
conclusion in section 3.2 and defers it to Phase 6. Whatever we build should keep those three
families as an explicit dimension of a charge, because both designs want to answer "what did this
organization spend on models versus sandboxes" without a schema change.

*He keeps a total reconcilable with its parts.* His sink sums the millicredits actually written
rather than re-truncating the exact sum, so the total always equals the sum of the breakdown. Our
allocation walk has the same hazard when one debit is paid from several grants, and the same rule
should be written into it.

*He treats the billable window as a fact about each provider.* His specification insists that an
E2B sandbox paused in the middle of a session over-bills if the code treats it like a Daytona one.
Our report prices sandbox time in renewable five-minute slices and never mentions a pause. His
version is more correct and our pricing should adopt it.

*He gates every ingestion path twice.* Every one of them is off
unless the provider is configured and the deployment is the commercial edition. We should copy the
pattern for the gateway, so a self-hosted deployment cannot accidentally start metering.

---

## 8. Where the two designs conflict

This section lists the real conflicts and skips the stylistic ones.

**Conflict one asks who converts credits into money.** His pull request 5040 gives that job to
Stripe through the plan price. Our report keeps it, through a versioned rate card, because credits that
are bought and earned have no invoice line for Stripe to price. *He has probably resolved this
already, in our direction.* His branch tip removed the sandbox key from `REPORTS` and wrote the
prepaid reasoning into the code. But the pull request description still says the opposite, so I
cannot call it settled without his confirmation.

**Conflict two is the sharpest one, and it decides where the debit side of the balance lives.** His
balance is the sum of unexpired grant rows minus one meter counter. Ours is a list of debit entries, one per
charge, with the run identifier, the raw measurement, and the rate card that priced it.

Only part of this is really in dispute. His grants are already an append-only
ledger with expiry and idempotency, so the funding half of his design is not a counter at all. The
disagreement is entirely on the consumption half. His `WALLET_DEBITS` is a single accumulating
number.

Our report argues at length why that cannot support what comes next, and section 2.4 gives the
evidence. A counter cannot say which run spent the credits, so a user whose balance vanished in
ten minutes gets no answer. It cannot refund one charge, because there is no charge to reverse. It
cannot say which grant paid for what, so an expiry cannot be applied correctly. And it cannot be
split later: Dify tracked hosted usage as a mutable counter, had to move to credit pools in
January 2026, and could not backfill the new pools, meaning they could not compute the missing
history for rows that already existed, because the individual deductions had never been written
down. They shipped a three-way branch instead, and a class of tenant whose deduction lands nowhere
(`research/03-project-dify.md`).

That is the conflict and I will not soften it. Everything else in his wallet specification is
compatible with a ledger. This one thing is not, and it is the one that gets more expensive every
month it stays.

**Conflict three is attribution.** His sink writes at organization scope only, with
`MeterScope(organization_id=...)`, even though the scope model supports project and user. No run
identifier is recorded anywhere. Our report lists run attribution among the decisions that cannot
be added afterwards (section 7.5). For sandbox compute this may be an acceptable trade today. For
model calls it is not, because the support question we will actually get is "which run spent my
credits".

**Conflict four: the wallet counter is bucketed by month.** Every plan gives `WALLET_DEBITS` a
`Quota(period=Period.MONTHLY)`, which I verified at all five occurrences in the plan table at the
branch tip. A monthly meter row starts at zero each month. His balance formula subtracts that
meter from the sum of unexpired grants, and his gift and top-up grants never expire. Read
literally, an organization's spending would appear to reset on the first of the month while its
grants stayed, so the balance would climb back up. That is plainly not the intent. The framework
supports a non-periodic meter, since `period=None` is how gauges work, so the fix is one field.
This is a flag rather than a conclusion, because the wallet code that reads the balance does not
exist yet and his intent may already be to change it.

**Conflict five decides what happens when the accounting breaks.** His paths fail open, so an error
allows the run and logs a warning. Our gateway fails closed and returns 503 when the ledger is
unreachable. Both are right for their own resource. Failing open on a sandbox meter loses cents.
Failing open at a model gateway means a user with zero balance keeps spending our provider budget
for as long as the database is down. If the two share one balance, the posture has to be decided
per call site rather than globally, and that has to be written down.

**Conflict six: migration numbers collide.** The enterprise migration chain on `main` ends at
`ee0000000003`. Track B adds `ee0000000004` and Track C adds `ee0000000005`. Our report claims the
same two numbers for the ledger foundation and the gateway runtime (section 7.5). Whoever lands
second renumbers. This is trivial to fix and expensive to discover during a deploy.

**Conflict seven is the vocabulary, and section 5 covers it.** Both designs want the word credit,
and a third meaning is already in production.

---

## 9. How they should fit together

### Option one: leave them separate

Sandbox compute keeps its own wallet, model calls get ours, and a user sees two balances in two
units.

It is the cheapest thing to do this week and the worst thing to have in six months. Every
question a user asks becomes two questions. Every grant has to be minted twice or arbitrarily
assigned to one wallet. Buying credits means buying two things. And the third meaning of credit
still sits in production underneath both. I do not recommend it, and I do not think anyone would
choose it deliberately; it is what happens if nobody decides.

### Option two: one wallet, built on the meter counter

Adopt his wallet for everything. Model calls and tool calls write into `LLM_DEBITS` and
`GATEWAY_DEBITS`, the balance stays one filtered sum minus one counter, and our ledger tables are
never built.

This is genuinely attractive on cost. The meter machinery exists, it is atomic, it is already
wired to Redis caching, and his wallet table would be the only new schema. It would probably reach
a working funded free tier faster than our plan does.

It fails on the four things section 8 lists: no per-charge record, no run attribution, no refund
of a single charge, and no correct expiry. It is precisely the design Dify had to migrate away
from, and their migration had no correct backfill. I recommend against it for the same reason our
report recommends against a counter in the first place.

### Option three: one ledger, and his metering becomes a debit source

This is the recommendation. Here is what it means in practice.

**His Track B lands unchanged.** Measurement is measurement. Nothing in our design wants it to be
different, and it is the only part of his stack that is finished.

**His rate table becomes rows in our rate card.** Four rows per provider, with
`resource_kind = 'sandbox'`, provider `e2b`, `daytona`, or `local`, and the four component names
from section 7. The numbers transfer directly: 0.0014 credits per vCPU-second at one cent per
credit is fourteen micro-dollars per vCPU-second in our unit. His `to_credits()` becomes the
sandbox caller of our pricing function, and the pure-function discipline survives intact.

**His sink writes a ledger entry instead of adjusting a debit meter.** One call that takes an
organization, an amount, a code of `sandbox_time`, and a usage record carrying the four raw
quantities. That is one function swap in `sink.py`, and everything above it is untouched.

**His `wallet_credits` table becomes our `credit_grant` table.** The five kinds map onto our
sources with no loss: `signup_gift` to `signup`, `plan_allowance` to `promotion` or a new
`allowance` source, `card_topup` to `purchase`, `admin_promotion` to `promotion`, and
`support_adjustment` to `support`. His source reference becomes our idempotency key. His monthly
allowance job, his top-up checkout, his automatic recharge, and his tier computation all sit on
top of grant rows and need no change in shape.

**His gate keeps its position and changes its source.** Layer one still runs at sandbox kickoff
and layer two still runs after usage lands, exactly where he put them, because those are the right
lifecycle moments. They read our balance instead of a meter counter. His task list already
anticipates this swap and says to keep the signature (`billing-tasks.md`, task C5).

**Raw resource-second meters stay as meters.** They are analytics, not money, and his tip already
says so. Keeping them out of the ledger keeps the ledger a record of value only.

**The storage gauge stays a gauge and stays out of the ledger.** Bytes at rest are a level, not a
consumption event. A quota with a cap is the right tool. Turning it into debits would bill
cumulative writes instead of held size, which his own specification warns against
(`metering-specs.md`, section 7).

**Does this raise or lower total work?** It lowers the total and it raises his share in the short
term. The short term is the honest cost of the change.

It deletes work from his plan: the whole `wallet_credits` schema task, the balance query and its
Redis caching and invalidation, and the balance half of the gate swap. That is most of tasks C2
and C5 in `billing-tasks.md`.

It adds a dependency: his sandbox gating cannot enforce anything until our Phase 1 ledger exists,
which has not started. If sandbox gating is urgent on its own
timetable, the in-between path is to land Track B now, hold Track C's gating at the create-time
soft check reading a plain per-plan quota, and not build the wallet. That is a smaller change to
his branch than either full option and it wastes nothing.

It removes a duplicate: without this, two people build a grant table, an expiry rule, an
idempotency key, and a top-up webhook, twice, in one product.

---

## 10. Judging both designs on simplicity

**The simplest thing that gives a user one balance they understand** is one unit, one list of
entries, one place that decides prices, and one number on screen. Neither design alone gets there.
His has one balance for one resource, priced in a unit that barely moves while a sandbox runs.
Ours has the right unit and the right entries but only knows about model calls in its first
phase. The merge is what produces the simple thing.

**Some machinery is more than the problem needs right now.** On his side: four per-dimension credit meters
whose only consumer is their own sum; a tier system with four axes and three thresholds before
anything can be bought; automatic recharge before one-time top-ups exist; and a GPU dimension with
no GPU product to sell. On our side: the reserved counterparty column for double-entry
bookkeeping, which the report already defers; explicit prompt caching, also deferred; and the
per-run credit cap, which is real but which nobody will hit before the balance does.

**Other machinery looks optional and is actually load bearing.** The hold belongs here, because
without it twenty concurrent calls each read the same balance and all twenty are allowed. Per-charge
rows with a run identifier belong here, because attribution cannot be reconstructed afterwards.
Grants as separate rows with their own expiry belong here, because a single number cannot be split.
The rate card version stamped on each charge belongs here, because otherwise an old charge cannot
be explained. On his side, three things look fussy and are not: the
per-provider billable window, deduplicating a webhook on its delivery identifier, and writing the
difference between Daytona's cumulative total and the current meter value, which makes a missed
poll correct itself.

**Merging the two systems would add complexity in four places for no gain.** Do not put sandbox
charges through a hold and a settlement. The cost of a sandbox is known within seconds and it is
small, so a single posted debit is enough and the reservation machinery earns nothing. Do not move
the storage gauge into the ledger. Do not route model calls through the meter store to reuse `check_entitlements`,
because that is option two under another name. And do not try to unify the three meanings of
credit inside the meter key list. Retire `CREDITS_CONSUMED` when the gateway replaces what it
gates, rather than renaming it now.

---

## 11. Sequencing, and what gets wasted if the order is wrong

**Track B goes first, and it can start now.** It measures and bills nothing, it is finished, and
both designs need the measurement. It depends on nothing in our work.

**Our Phase 0 runs in parallel.** Prove that a real default agent reaches a service of ours, and
run the six provider tests in report section 8.1. This touches none of his files. Two of those
tests can still change our design, so they should not wait.

**Our Phase 1 ledger comes next.** It builds grants, entries, holds, settlement, spend order,
idempotency, and the concurrency test. Everything else stands on it, and nothing can be
retrofitted onto it later.

**Sandbox debits and the gateway come after that, in either order.** His Track C Part 1 becomes a
rewrite of the sink and the gate against the ledger, which is small. Our Phase 2 runs the gateway
without debiting anyone.

**Enforcement comes next, and paid credits after it.** The gateway enforces for a cohort. Top-ups,
allowances, tiers, and automatic recharge get built once, from his specification, on our grant
rows.

**Three things get wasted if we pick the wrong order.** Building `wallet_credits` before deciding
this question costs schema and query work that then has to be reconciled with an almost identical
table. Adding a sandbox key to `REPORTS` and creating the Stripe meter and the
prices to match is worse than wasted, because Stripe prices are immutable and existing
subscriptions have to be swept by hand, which pull request 5037 documents in its own operational
notes. And shipping a
counter-based balance to real users is the expensive mistake, because from that moment there is no
correct backfill.

**The stack itself needs three decisions, and they belong to the track and platform owners.** Nothing in the
record says why the work stopped on 6 July, so these are questions rather than a verdict.

The stack is based on `feat/add-sandbox-metering`, whose own base `big-agents` has since merged
into `main`. So both open pull requests target a branch that is a month behind `main`, and their
diffs will not read cleanly against it. Should Track B be rebased onto `main` and reopened against
`main`, so it can land on its own?

The tip of Track C is a commit labelled work in progress that reverses a decision its own pull
request description still states. Which is current, and should 5040 be retitled and rewritten, or
closed and re-cut once the wallet question is settled?

Track D has no pull request and one documentation commit. Its `secret_origin` idea is the best
zero-rating mechanism either design has. Should it be lifted out of the stack and filed as its own
piece of work, so it does not sit behind two branches that are blocked on a pricing decision?

---

## 12. Questions for the sandbox-metering track

1. Is the branch tip of `feat/metering-track-c`, commit `c3d6b12879`, your current direction:
   debits rather than credits, a prepaid wallet, and nothing reported to Stripe in arrears? Should
   pull request 5040's description be read as superseded?
2. Where do `tiers-and-unified-wallet.md`, `wallet-enforcement-matrix.md`, and
   `monetization-integration.md` live? They are not in the repository on any of the four branches,
   and your specifications say they win where they disagree.
3. `WALLET_DEBITS` carries `Quota(period=Period.MONTHLY)` on all five plans. Is the wallet meant to
   reset monthly, or should that key be non-periodic so the balance is a lifetime total?
4. Pull request 4783 recorded that Daytona's organization usage endpoint was JWT-only and not
   callable with an API key, citing daytonaio/daytona#4643, and that billing lags up to
   forty-eight hours. Did you verify API key access since then, and how does the poll handle the
   lag?
5. Do you need per-run or per-project attribution for sandbox charges, or is organization scope
   enough for what you plan to show a user?
6. Can Track B rebase onto `main` and target `main` now, so measurement lands independently of any
   pricing decision?
7. Is one credit equal to one cent fixed for you, or can the sandbox rates be restated against a
   finer unit so the same number covers model calls?
8. If the sink called a ledger function instead of `check_entitlements`, does anything else in your
   design break?
