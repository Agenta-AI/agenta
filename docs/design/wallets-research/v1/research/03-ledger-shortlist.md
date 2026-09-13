# Shortlist of open source projects to study before we design the credit system

## Why this file exists

We are about to build two things. The first is a gateway, meaning a service of ours that sits
between a user sandbox and a model provider, holds the real provider credential, and decides per
request whether to forward the call. We need it because our funding provider sells no per key
spending cap, so nothing outside our own code will stop an overspend. The second is a ledger,
meaning a balance per organization that we compute from a list of entries we never edit.

Balance accounting is old and well understood. The failure modes are old too. Double charges, lost
updates, and balances nobody can reconcile have been solved and re-solved for decades. Before we
write our own design, we should read the ones that got it right.

This file lists the projects worth reading, in priority order, with the questions each deep study
should answer. It also records what was searched and what was set aside, so nobody repeats the
sweep.

## The words you will meet in these projects

These terms appear in every system below. They are used loosely in blog posts and precisely in
source code, so here are the precise meanings.

A **ledger** is a list of entries that only ever grows. You never edit a row. If you made a
mistake, you add a correcting row. The **balance** is not stored as the truth; it is derived by
summing the entries, and any stored balance is a cache of that sum.

An **entry** records that value moved. A **debit** takes value out of an account and a **credit**
puts value in. In **double entry** bookkeeping every movement writes at least two entries that sum
to zero, so a transfer of 10 credits from a user balance to a consumption account writes minus 10
in one place and plus 10 in the other. The check that they sum to zero is what catches bugs.

A **hold** (also called an authorization, a reservation, or an inflight transaction) is money set
aside before the real amount is known. Your card at a gas pump is the classic case. The station
holds a round number, you pump an unknown amount, and the station then **settles** (also called
capture, or commit) for the true amount and releases the rest. This is exactly our shape. We do not
know what a model call costs until the response comes back.

An **idempotency key** is a caller supplied identifier attached to a write, so that the same write
sent twice is applied once. If our gateway retries a charge after a timeout, the key is what stops
the user paying twice.

**Metering** means counting what someone used, for example tokens or seconds of sandbox time. It
answers "how much did they consume". An **entitlement** answers a different question: "are they
allowed to consume it at all", for example a feature flag or a monthly allowance. A **grant** is
one deposit of allowance, and a system that keeps grants separate rather than adding them into one
number is said to use **credit lots**. Lots matter when grants expire at different dates or must be
spent in a particular order, which is our case: a promotional grant should burn before a purchased
one.

**Reconciliation** means comparing our numbers against an outside record, for example the
provider's own invoice, and explaining every difference.

A **dialect** is the request and response shape of a model API. Our runner speaks the OpenAI chat
completions dialect only.

## What a candidate has to teach us

Five questions decide whether a project is worth a deep read.

1. Does it handle a charge whose amount is unknown until the work finishes? This is the hold and
   settle question, and it is the one most billing projects skip.
2. Does it handle concurrency and idempotency explicitly, meaning two calls landing at once and the
   same call arriving twice?
3. Is the source readable, and is the project alive?
4. Are its scale assumptions near ours? A design built for millions of transfers per second can
   still teach us, but the cost of its complexity has to be named.
5. Can we legally copy from it? A project under the GNU Affero General Public License, or under a
   source available license, can be read but not lifted into our commercial edition.

## How the search was run

Searches used the vocabulary that appears inside these systems rather than marketing words: double
entry ledger, immutable entries, balance transactions, credit lots, prepaid balance, wallet, hold,
authorization and capture, reserve and settle, idempotency key, usage based billing, metering,
entitlement, quota, spend tracking, and reconciliation. Three pools were swept. Dedicated ledger and
billing projects. Products in our own space, meaning agent platforms and model gateways that had to
grow a credit feature. Systems from outside our industry, meaning financial ledgers and payment
processors, where the constraints are harder.

Repository facts (stars, language, license, last push) come from the GitHub API on 3 August 2026.
Source claims come from files read directly at the paths given.

## The shortlist

### 1. LiteLLM proxy

**What it is.** A proxy that speaks the OpenAI dialect, holds the real provider keys, and hands out
its own "virtual keys" to users. Each virtual key, user, team, or organization can carry a dollar
budget, and the proxy refuses calls once the budget is spent. It is written in Python on FastAPI
with Postgres and Redis, which is our stack exactly.
Repository: https://github.com/BerriAI/litellm (55,431 stars, last push 3 August 2026).

**How it works.** Cost is not known before the call, so the proxy estimates the maximum cost of a
request and writes that estimate into a shared counter in Redis before forwarding. That is a hold,
built for our exact problem. After the response arrives, the real cost replaces the estimate. The
reservation code lives in `litellm/proxy/spend_tracking/budget_reservation.py`, which is 1,316 lines
and contains the interesting parts, including a `_BudgetCounter` type and a
`_CounterReservationUnavailable` exception. The enforcement hook is
`litellm/proxy/hooks/max_budget_limiter.py`. Writes to Postgres do not happen per request. They pass
through an in memory queue and a Redis buffer, in
`litellm/proxy/db/db_transaction_queue/spend_update_queue.py` and
`litellm/proxy/db/db_transaction_queue/redis_update_buffer.py`, then a single writer flushes them.

**Why it earns the top slot.** It is both a domain twin and a stack twin. It has already made every
trade we are about to make, and it has published the resulting failures. A known bug report,
https://github.com/BerriAI/litellm/issues/27735, describes a virtual key being refused while
`/key/info` shows spend below the budget, because the cached counter and the database disagree.
There is a configuration flag, `fail_closed_budget_enforcement`, that forces every budgeted request
to check the authoritative database instead of the cache, per
https://docs.litellm.ai/docs/proxy/users. That flag is the price list for the guarantee we would be
relaxing.

**License warning.** The repository is MIT except for the `enterprise/` directory, which is under a
commercial license that forbids production use without a subscription. The LICENSE file states this
in its first lines. Any code we copy has to come from outside that directory.

**Questions a deep study must answer.**
- What exactly is reserved before a call, how is the maximum cost estimated for a streaming
  response, and what happens to the reservation if the process dies mid request?
- How does the reservation get reconciled with the true cost, and can a reservation leak forever?
- How much spend can be lost when the queue flush fails, and is the loss bounded?
- How does its cost calculation treat prompt caching, meaning the cheaper rate a provider charges
  for a repeated prefix? Cache reads and cache writes carry different prices. Getting this wrong is
  our largest cost error, because our harness replays about 23,600 tokens of context per call.
- What is the database schema for keys, budgets, and spend logs, and would it survive being extended
  into a full ledger?

### 2. OpenMeter, specifically its credit and entitlement engine

**What it is.** A metering and billing platform for AI and API products. The part we care about is
narrow: the credit engine that tracks grants and burns them down. Go, Apache 2.0, Postgres for
state.
Repository: https://github.com/openmeterio/openmeter (2,172 stars, last push 3 August 2026).

**How it works.** A grant is a first class row with an amount, a `Priority`, an `EffectiveAt`, an
optional `ExpiresAt`, and a rollover rule for what carries across a reset. When usage arrives, the
engine burns grants in order: lower priority number first, then the grant expiring soonest, then the
oldest. Balance is computed by replaying usage over grants for a period, starting from a stored
snapshot. The code is small and readable: `openmeter/credit/engine/engine.go` is 96 lines and
defines `RunParams.StartingSnapshot` (the balance at the start of a period) and `RunResult.Snapshot`
(the balance at the end). `openmeter/credit/engine/grant.go` holds `PrioritizeGrants` and the sort
on `grants[i].Priority`, and reads `EffectiveAt` and `ExpiresAt` to find the moments where the
balance changes. Sibling files cover burn phases, history, and resets.

**Why it earns a high slot.** Our credits arrive from three different places (a signup grant, a
purchase, and an earning for a contribution) and those should not expire together or burn in
arbitrary order. This is the credit lot model done properly, in about a thousand lines, with the
burn order written down as code rather than assumed. It also solves the snapshot question, which is
how you avoid replaying the entire history of a busy organization on every balance read.

**Questions a deep study must answer.**
- What is the exact grant table, and what does a snapshot row contain?
- When is a snapshot taken, and what invalidates it? Specifically, what happens when a grant is
  added with an `EffectiveAt` in the past, behind an existing snapshot?
- How is a usage event made idempotent, so a duplicate does not burn twice?
- What locking or serialization protects two concurrent burns against each other?
- How much of the engine can be lifted into Python without dragging in the ClickHouse dependency
  their metering side uses?

### 3. TigerBeetle

**What it is.** A database that does nothing except double entry accounting. Written in Zig, Apache
2.0, deployed as a single binary, and verified by an independent Jepsen audit.
Repository: https://github.com/tigerbeetle/tigerbeetle (16,708 stars, last push 3 August 2026).
Audit: https://jepsen.io/analyses/tigerbeetle-0.16.11.

**How it works.** Two primitives exist, accounts and transfers, and both are fixed size records. A
**two phase transfer** puts a pending amount into `debits_pending` on one account and
`credits_pending` on the other, which reserves it without moving it. A later transfer either posts
it or voids it, and each pending transfer can be resolved exactly once. The detail that matters most
to us: when posting, you may pass the constant `AMOUNT_MAX` to post the entire reserved amount, or
you may post less, and the remainder is automatically restored to the original accounts. See
https://docs.tigerbeetle.com/coding/two-phase-transfers/. Idempotency is structural rather than
bolted on. Every transfer carries a caller chosen 128 bit id, and creating a transfer with an
existing id returns an "exists" result instead of writing a second one.

**Why it earns a slot even though we will not deploy it.** This is the most rigorous public statement
of the hold and settle model, and it names the invariants we will otherwise discover the hard way.
Its scale target is far above ours; it is built for millions of transfers per second on one machine,
and the complexity it carries is complexity we do not need. We should read the data model and the
documented rules, not the storage engine.

**Questions a deep study must answer.**
- Write out the account fields (`debits_posted`, `credits_posted`, `debits_pending`,
  `credits_pending`) and the flags, and state which of them our Postgres tables should mirror.
- What are the exact rules for resolving a pending transfer: expiry, partial post, double resolve,
  void after expiry?
- How do the balance limit flags (an account that may not go negative) work, and what error is
  returned when a transfer would breach one?
- What does the Jepsen report say actually broke, and does the same class of bug apply to a Postgres
  implementation of the same model?
- What is the cost of copying only the model into Postgres rather than adopting the database?

### 4. Dify

**What it is.** An open source platform for building LLM apps, and the closest public analogue to
our exact business problem. Dify hosts model access for its cloud users out of its own provider
keys, with a trial quota and paid credit pools per tenant. Python on Flask with SQLAlchemy and
Postgres.
Repository: https://github.com/langgenius/dify (151,198 stars, last push 3 August 2026). The license
is a modified Apache 2.0 with extra conditions, so check it before copying code.

**How it works, and this is the interesting part, it is the cheap version.** Quota is deducted
**after** the message is created, from a signal handler in
`api/events/event_handlers/update_provider_when_message_created.py`. The free quota path issues a
single conditional statement: an `UPDATE providers SET quota_used = quota_used + n WHERE
quota_limit > quota_used`, and if zero rows change it writes a warning to the log. The paid and
trial paths call `CreditPoolService.deduct_credits_capped`, whose docstring says it applies "post
generation credit accounting without failing message persistence on quota exhaustion", and which
logs a warning when it deducts less than was required. The quota unit is configurable between
tokens, credits, and calls, in `api/core/app/llm/quota.py`. The file even carries a comment from
its own authors admitting that under load "multiple concurrent requests might check the same cache
key simultaneously" and that Redis cache operations are not atomic with the database updates.

**Why it earns a slot.** It shows us the shape of the version we could ship in a week, and it shows
precisely what that version costs. Their model is deduct after the fact, allow the overshoot, never
block the user response. Note that our own existing metering already does something more careful
than Dify's, in `api/ee/src/dbs/postgres/meters/dao.py` around lines 440 to 510: an atomic insert
with an `ON CONFLICT DO UPDATE`, a guarded `WHERE`, and `RETURNING`, with an explicit
"predictable overshoot" rule where a request from below the limit may cross the line once. Comparing
those two is the fastest way to decide how much more we need.

**Questions a deep study must answer.**
- What is the full data model: `providers`, the credit pools, and whatever table records
  individual deductions, if any exists.
- Is there any record of individual charges, or only a running counter? Can they answer "why is my
  balance 37" for a customer?
- How far can a tenant overshoot in the worst case, and what user visible harm results?
- How do they stop a user from starting a long agent run with one credit left?
- What did they have to change when they moved from a plain quota counter to credit pools, and
  would that migration have hurt if the original design had recorded entries instead of a counter?

### 5. Blnk

**What it is.** A standalone double entry ledger built for fintech products, in Go on Postgres,
Apache 2.0, with an HTTP API. It runs as a container, which suits our docker compose deployment.
Repository: https://github.com/blnkfinance/blnk (489 stars, last push 31 July 2026).

**How it works.** Setting `inflight: true` on a transaction reserves the amount in separate balance
fields (`inflight_credit_balance`, `inflight_debit_balance`, `inflight_balance`) and puts the
transaction in `INFLIGHT` status until it is committed or voided, per
https://docs.blnkfinance.com/transactions/inflight. The source shows the part the documentation
omits, which is the part we need. In `transaction_inflight.go`, `CommitInflightTransaction` takes an
explicit amount, `validateAndUpdateAmount` computes an `amountLeft` remainder,
`validateRequestedAmount` rejects a commit larger than the remainder, and a separate void path
releases what is left. So a hold can be settled for less than it reserved, more than once, until it
is used up. The file also mentions that retries are made idempotent by a reference collision, and it
uses a Redis based distributed lock (`internal/lock`) around the commit.

**Why it earns a slot.** It is the closest thing to a ledger we could actually run or port. It puts
holds, partial settlement, idempotency, and reconciliation in one readable codebase, in plain SQL
against Postgres, at a scale that is not absurd for us.

**Questions a deep study must answer.**
- What are the Postgres tables and indexes, and how is the balance kept consistent with the
  transaction rows? Is the balance a materialized column, and if so what protects it?
- Exactly how does the reference collision make a retry safe, and what does the caller see on the
  second attempt?
- What does the reconciliation module compare, and what would it take to point it at a provider's
  usage report?
- Is the Redis lock required for correctness, or only for throughput? If Redis is down, what breaks?
- How are fractional amounts handled? They store precise integers with a precision factor, and we
  need the same discipline for fractions of a cent.

### 6. Polar

**What it is.** A merchant of record and billing platform, written in Python on FastAPI with
SQLAlchemy and Postgres, Apache 2.0. It bills on usage meters and can grant credits to a customer as
a purchase benefit.
Repository: https://github.com/polarsource/polar (10,159 stars, last push 3 August 2026).
Credit guides: `docs/guides/grant-meter-credits-after-purchase.mdx` and
`docs/features/benefits/credits.mdx` in the repository.

**How it works.** The balance of a customer against a meter is a row in `customer_meters`
(`server/polar/models/customer_meter.py`) holding `consumed_units`, `credited_units`, `balance`, and
a cursor named `last_balanced_event_id` that points at the last event folded into that balance.
Balance is therefore derived from an immutable event stream, with the row acting as a checkpoint
rather than the truth. The service that advances it,
`server/polar/customer_meter/service.py`, imports `non_negative_running_sum` and a lock helper
`polar.kit.db.locking.is_lock_not_available_error`, which shows they use Postgres advisory locks and
handle the case where the lock is already taken.

**Why it earns a slot.** Everything above is in another language or another framework. Polar is the
one production grade example in our exact toolchain, so it answers "what does this look like in
SQLAlchemy" without translation. Its Alembic migrations also show how a billing schema was grown
over time without breaking, which is the migration risk we were told to avoid.

**Questions a deep study must answer.**
- How is the event stream made idempotent on ingest, and what identifies a duplicate?
- What advisory lock key do they take, at what granularity, and what happens to a request that
  cannot get it?
- What does `non_negative_running_sum` protect against, and what does it hide?
- Do they hold anything before work starts, or only account afterwards? If only afterwards, how do
  they stop a customer running far past zero?
- What is the shape of the credit benefit: is it a lot with an expiry, or an addition to a single
  number?

## What was set aside, and why

| Project | What it is | Why it is not on the list |
| --- | --- | --- |
| Formance Ledger (https://github.com/formancehq/ledger, MIT, Go, 1,327 stars) | A programmable double entry ledger service with idempotency keys and an immutable log, backed by Postgres | A strong runner up and the first substitute if a slot frees up. It was cut because a hold is a convention there, not a primitive: you model pending funds by posting into a dedicated pending account, per https://docs.formance.com/modules/ledger/example-implementations/omnibus. Blnk covers the same ground with holds built in. |
| Lago (https://github.com/getlago/lago, AGPL 3.0) | Usage based billing with prepaid wallets | The AGPL license makes copying into our commercial edition unsafe. Reading it for the wallet model is still allowed and cheap. |
| Kill Bill (https://killbill.io/platform/wallet-credits, Apache 2.0, Java) | Mature subscription billing with an account wallet and an immutable credit ledger | Java, plugin heavy, and built around invoices and subscriptions rather than per call charging. High cost to read for the amount we would learn. |
| Apache Fineract (https://github.com/apache/fineract, Apache 2.0, Java) | Core banking with full double entry journal | Rigorous but buried in banking domain concepts (loan products, accruals, accounting rules) that we would have to strip out. TigerBeetle gives the same rigor in far less reading. |
| Hyperswitch (https://github.com/juspay/hyperswitch, Apache 2.0, Rust) | Payment orchestration with authorization and capture, and idempotency across unreliable external processors | Keep as a targeted follow up if we hit the "the provider call timed out and we do not know if it cost money" problem. Its answer to that is the best available, but the rest of the codebase is not about balances. |
| Midaz (https://github.com/LerianStudio/midaz, Elastic License 2.0) | Open core ledger from a fintech vendor | The Elastic License 2.0 is source available, not open source. Read only, and its ideas overlap Blnk. |
| Flexprice (https://github.com/flexprice/flexprice, Go, 3,772 stars) | Usage based billing with a credit wallet | Younger and thinner than OpenMeter on the part we care about, which is grant burn down. Worth a skim only if OpenMeter's engine disappoints. |
| pgledger (https://github.com/pgr0ss/pgledger), go-ledger (https://github.com/sohag-pro/go-ledger) | Small double entry ledgers, one implemented entirely in Postgres functions and views | Useful as short reading on how to express the invariant in SQL, but they are demonstrations rather than production systems and neither handles holds. |
| Beancount, ledger-cli and other plain text accounting tools | Double entry bookkeeping over text files | Single user, no concurrency, no idempotency. Nothing to learn for a concurrent service. |
| OpenRouter, Vercel AI Gateway, Cloudflare AI Gateway spend limits | Commercial gateways with prepaid credits and per user spend caps | Closed source. Their public documentation is still worth reading for product behaviour, for example https://blog.cloudflare.com/ai-gateway-spend-limits/, but there is no design to copy. |
| Helicone, Portkey gateway | Open source model gateways with observability | They record spend but do not enforce a prepaid balance in the way LiteLLM does, so LiteLLM dominates them for our purpose. |

## What none of these projects solves for us

Three problems stay ours after all this reading, and every deep study should note where its project
touches them.

The first is that the party we bill controls the code that spends. The user writes the agent
instructions that run inside the sandbox, so a runaway loop is a normal event, not an attack. None
of these systems assume a hostile consumer of their own balance.

The second is prompt caching. Our harness replays roughly 23,600 tokens of context on every model
call, and a single user message with tool use typically causes two or three calls. A design that
breaks the repeated prefix makes the same conversation about five times more expensive. Only
LiteLLM has any opinion about pricing a cached prefix, and no ledger project has one at all.

The third is what happens at the boundary between the gateway and the ledger when either side fails
midway. A hold placed in the ledger and a call sent to the provider are two writes to two systems.
TigerBeetle and Blnk tell us how to make each ledger write safe. Neither tells us what to do when
the provider call succeeds and our settlement write does not.
