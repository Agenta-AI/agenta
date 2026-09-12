# Proposal B: credit system and model gateway

This document proposes a complete design for two connected systems. The first is a model
gateway, which is a service of ours that sits between a running agent and the model provider,
holds the real provider credential, and decides for each request whether to forward it. The
second is a credit ledger, which is a permanent list of entries we never edit and from which
we derive each organization's balance.

The proposal covers the first version we would build, and it covers the full system that
first version has to grow into. It states which correctness guarantees the first version
gives up, and what it would cost to add each one back.

---

## 1. The problem this design solves

A person who signs up for Agenta cloud today cannot run anything until they connect their own
model provider API key. That wall stops most people before their first agent conversation
happens. We want to pay for those first runs ourselves, and we now have the funding to do it
at a meaningful scale.

Paying for someone else's model calls is only safe if we can stop paying. That turns out to be
the hard part, and it is the reason this design exists.

### Why we cannot simply hand out a provider credential

When an Agenta agent runs, it runs inside a sandbox, which is an isolated cloud container.
Inside that container a harness runs. A harness is the agent runtime that owns the system
prompt, the skills, and the tool definitions, and it is the piece that actually calls the
language model. The user writes the agent instructions, so the user controls what runs inside
that container. Any credential we put in there must be assumed readable by the user.

That would be acceptable if the provider itself refused to let the credential overspend.
Google does not sell that. A Google Cloud billing budget sends alerts and explicitly does not
cap usage: "Setting an alerts-only budget doesn't automatically cap Google Cloud or Google
Maps Platform usage or spending" (https://docs.cloud.google.com/billing/docs/how-to/budgets).
Quotas are set per project rather than per key, and Gemini models no longer have per model
quotas at all because they use dynamic shared quota
(https://docs.cloud.google.com/vertex-ai/generative-ai/docs/dsq). Google shipped spend cap
budgets in public preview around July 2026, and those do stop usage, but they are limited to
one project and one service for one calendar month and they are lifted by hand
(https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps). The full survey of
every Google mechanism is in `research/01-gemini-and-caching.md`, section 5, and its
conclusion is that nothing Google sells can bound one end user's spending.

So the limit has to be ours, and it has to sit outside the container. That is the gateway.

### Why a counter is not enough

Once we are paying for usage, people will want to buy more, and we want to give credits away
for contributions such as writing a skill, publishing an article, or making a video. A single
"messages used" counter cannot express any of that. It cannot record where value came from, it
cannot expire a promotional grant while leaving purchased value alone, and it cannot answer a
customer who disputes a charge.

Dify is the clearest published example of what happens when a counter is chosen first. Dify
tracked hosted model usage as a mutable counter on a provider row, then had to move to credit
pools six months later, and the migration could not reconstruct history because the individual
deductions had never been written down (`research/03-project-dify.md`, section "The move from a
counter to credit pools, and what it cost"). That is the mistake this design is shaped to
avoid.

---

## 2. The words this document uses

These terms appear throughout. Each one is defined here and used consistently afterwards.

A **ledger** is a list of financial entries that we only ever add to. We never edit or delete
a row. A mistake is corrected by adding another entry that cancels it.

A **debit** is an entry that takes value out of an account. A **credit entry** is an entry
that puts value in. In this design a model call produces a debit against the organization's
balance, and a purchase produces a credit entry.

A **hold**, also called a reservation, is an amount we set aside before we know the final
price. For example, before a model call we reserve enough credits to cover the worst case that
call could cost. The reserved amount is not spent yet, but nobody else can spend it either.

**Settlement** is the step where we replace the hold with the true amount once the work has
finished and we know what it actually cost.

**Idempotency** means that performing the same operation twice has the same effect as
performing it once. A payment webhook that fires twice must create one purchase, not two. We
achieve this with a database uniqueness constraint on a caller supplied key.

**Metering** means counting units of consumption, such as tokens, tool calls, or seconds of
sandbox time.

An **entitlement** is a statement that an organization is allowed to use something, usually up
to a limit. Our existing plan quotas are entitlements.

A **gateway** is a service of ours that receives a model request from the sandbox, checks it,
swaps in the real provider credential, and forwards it to the provider.

A **dialect** is the request and response format an API speaks. Our runner speaks the OpenAI
chat completions dialect, which is the format with a `messages` array and a `choices` array in
the reply. Google's Vertex AI publishes an endpoint that speaks the same dialect
(https://docs.cloud.google.com/vertex-ai/generative-ai/docs/migrate/openai/overview).

**Prompt caching** means the provider charges less when a request repeats a prefix it has seen
recently. Our harness replays roughly 23,600 tokens of context on every model call, and one
user message with tool use typically causes two or three calls, so caching is the largest cost
lever we have (`research/01-gemini-and-caching.md`, section 2).

A **projection** is a stored row that holds a number we could have computed from the entries,
kept up to date so we do not have to recompute it on every request. The account balance row in
this design is a projection of the transfer log.

A **lot** is one batch of credits that entered the balance together, such as one signup grant
or one purchase. Lots let us record where value came from and when it expires while still
showing the user a single balance.

**Double entry** means every movement of value names both an account it left and an account it
entered. It is the standard bookkeeping arrangement, and it makes it impossible to record value
appearing from nowhere.

**Basis points** are hundredths of a percent. A multiplier of 12,000 basis points means 1.20
times. The design stores the margin multiplier this way so it is an integer.

**Application Default Credentials** is Google's standard way for a server to obtain a
short-lived access token from a service account without a long-lived key file in the
application code.

**Server-sent events**, abbreviated SSE in code, is the streaming format the OpenAI chat
completions dialect uses. The server writes a sequence of `data:` lines and finishes with
`data: [DONE]`.

---

## 3. Requirements

### 3.1 What the first version must do

The first version must establish the final trust boundary and the final accounting model, even
though it deliberately supports only one provider and a limited product surface. Getting the
boundary and the data model right now is what makes everything afterwards additive.

It must give an eligible organization a model connection managed by Agenta, so the user does
not have to supply a provider key. It must keep every real provider credential outside the
sandbox. It must give the sandbox a token that can be revoked, and that token must be scoped to
exactly one organization, one project, one run, one model, one expiry time, one ceiling on
output tokens, one ceiling on concurrent requests, and one credit limit for that run.

The gateway must expose the OpenAI chat completions dialect, because that is the dialect the
existing runner path already speaks. Our current custom connection route accepts an arbitrary
base URL, writes a one model configuration file for the harness, and places the supplied bearer
token in the `OPENAI_API_KEY` environment variable (`prior-work/repo-findings.md`, section
"Base URL override: only one route exists", line 52). The first version supports one managed
Gemini model family through Vertex AI's OpenAI-compatible endpoint.

Streaming must keep its speed. The time to the first token must not get worse, and the frames
the gateway emits must be valid for the dialect.

Gemini tool calling must work, and that requires one specific piece of work. Gemini 3 attaches
an encrypted blob called a thought signature to every function call it emits, and it rejects
the next step of the conversation if that blob is not sent back. Ordinary OpenAI dialect
clients parse the tool call into their own types and drop fields they do not recognise, so the
signature is lost (`research/01-gemini-and-caching.md`, line 338, and
https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thought-signatures). Our harness has
this bug today. The gateway must carry the signature across turns.

Pricing must be able to see tokens. A model charge must price uncached input, cached input,
cache writes, output, and reasoning tokens separately. Tool calls and sandbox compute must be
recorded in the same unit as model calls, with internal plumbing free and externally costly
tools and real sandbox time billable.

The ledger must maintain one balance per organization, derived from entries we never edit. It
must accept credits arriving as signup grants, purchases, contribution awards, refunds, and
corrections. Internally it must keep the source lots separate, so expiry and spending order
stay explainable, while the product shows the user a single number.

It must place a hold before work whose cost is unknown, settle the true charge afterwards, and
release whatever was not used. It must serialize concurrent spending so two requests cannot
both reserve the last credit. Every financial write must be made idempotent by a database
constraint, not by a cache inside one process.

Users must get an itemized history by run and by resource, showing the raw usage, the version
of the price list used, the credit charge, and the saving that prompt caching produced.

Agenta must charge nothing when Agenta or the provider fails. A client that disconnects
partway does not make a successful provider call free. The gateway keeps reading the upstream
response and charges for the completed call.

The gateway must fail closed before it dispatches to the provider. If authentication, the
ledger, the rate card, or the balance is unavailable, it refuses rather than guessing.

Bring your own key must keep working. A user supplied provider key means no model charge, but
tool and sandbox charges still apply.

All commercial funding, purchase, and gateway behaviour stays behind the enterprise edition
boundary. The open source and self-hosted installations must remain fully functional without
it.

Operationally, the first version needs a global kill switch and a per-organization kill switch,
token revocation, a model allowlist, limits on body size, request rate, and concurrency.

The provider relationship, the funding source, the private account details, the credit
amounts, and the deployment topology stay out of public code, public documentation, public
logs, and public pull requests.

One requirement is commercial rather than technical, and it blocks launch. We need written
confirmation that the intended arrangement, serving end users through our own account, is
permitted. The research treats this as a prerequisite rather than something to infer
(`research/01-gemini-and-caching.md`, line 654).

The initial product integration may support the Pi harness only. The gateway itself does not
care which harness calls it, because it only speaks HTTP. The limitation is that the managed
connection adapter that hands the harness its configuration is Pi specific today. Other
harnesses stay on bring your own key until they get an equivalent adapter.

Two more choices belong in the first version. Purchases should use the existing payment
processor's webhook as the event that makes a purchase idempotent. Contribution awards should
be approved by a human. The published precedent for automatically rewarding contributions is
thin and mostly discontinued, so an automatic scoring system would add fraud risk before it
adds any validated growth (`research/02-competitor-credit-products.md`, line 852).

### 3.2 What the full system must eventually do

The full system adds every supported harness and every product surface that can incur model,
tool, or sandbox cost. It adds more model providers and the dialect adapters they need. It
adds failover across provider accounts that is affine by conversation, meaning every call in
one conversation lands on the same account so the provider's cache still hits.

It adds explicit Gemini context caches keyed by agent revision, once measurements of the
implicit cache justify the extra machinery. It adds automated purchases, invoices, taxes,
payment refunds, and chargeback handling. It adds contribution campaigns, approval workflows,
fraud controls, referral rules, and budgets for awards.

It adds reconciliation against the provider's own usage exports and against payment processor
records. It adds durable delivery of settlements across gateway crashes, Postgres outages, and
host failure, and it adds highly available gateway processes and database infrastructure.

It adds organization level budget policies, administrator configured overage, and scheduled
replenishment. It adds detailed statements, exports, support tooling, and accounting reports.
It adds approval, scheduled activation, rollback, and audit for price cards. Finally it adds
anomaly detection based on cache misses, model mix, request velocity, run duration, attempts
to extract the token, and unusual token reuse.

One thing the full system must never add. Credits must not become transferable between users,
redeemable for cash, or usable as a currency between accounts. Those features change the legal
and accounting character of the product and they do nothing for the activation problem we are
trying to solve.

### 3.3 One requirement in the prior work that should not survive

The earlier plan proposed charging a flat number of credits per model call, using the existing
`credits_consumed` meter as the balance, and writing the ledger entry asynchronously after the
response had been returned. All three were reasonable for a disposable trial. None of them
should survive into a system where credits are bought and earned.

A flat per call price charges the same for a two hundred token call and a two hundred thousand
token call, and it cannot pass through the saving that prompt caching produces, which is the
largest lever we have. The existing meter is a mutable counter that may reset each period, so
it cannot represent purchases, expiry, allocation between sources, refunds, or where value came
from. Writing the ledger entry in the background after the response is a billing defect once
credits represent money someone paid or earned, because a lost background write is lost revenue
that nothing records.

The useful part of the existing metering system is its SQL pattern, an insert with
`ON CONFLICT DO UPDATE`, a condition on the update, and a `RETURNING` clause, which performs
the check and the charge in one statement (`api/ee/src/dbs/postgres/meters/dao.py`). This
design borrows that pattern. It does not borrow the counter as the balance.

The five part decomposition in the earlier plan does survive and stays useful.
`prior-work/revised-plan.md` line 40 separates eligibility (who gets credits), accounting (how
many have been used), authorization (whether this particular request may draw on them),
enforcement (what makes the limit hold against someone working around the product), and
experience (what the user sees). In this design, enforcement belongs to the gateway,
accounting belongs to the ledger, and eligibility and experience belong to the main product.

---

## 4. The credit unit

### 4.1 What one credit is

One Agenta credit permanently represents one tenth of a United States cent of priced usage
value. A thousand credits represent one dollar. Ten thousand credits represent ten dollars.

A credit is not cash, it is not refundable stored value, and it is not a claim on Agenta. The
conversion never changes. The price of an action may change when we publish a new rate card,
which is a versioned price list. The unit itself does not move.

Fixing the rate permanently removes the single biggest trust problem an abstract unit has. The
comparison of twelve credit products found that the complaints users make are almost always
about an exchange rate that moved quietly, and the recommendation there is the same one made
here (`research/02-competitor-credit-products.md`, line 878).

Internally the system stores **millicredits**, which are thousandths of a credit, in a signed
64 bit integer column. One credit equals one thousand millicredits, so one millicredit equals
one millionth of a dollar of usage value at a multiplier of one. That is precise enough to
price a single token and it leaves a range of roughly nine trillion dollars, which we will not
reach.

The design deliberately does not use floating point numbers or an unconstrained decimal for
the balance. OpenMeter stores its amounts in a `numeric` database column but performs its
arithmetic in 64 bit floating point, and that can round incorrectly
(`research/03-project-openmeter-credit-engine.md`, line 537).

### 4.2 How the price of an action is decided

A rate card is a versioned price list. Each component of a rate card records the resource kind
(model, tool, or sandbox), the provider, the stock keeping unit (which for a model is the model
identifier), the component being priced (uncached input, cache read, cache write, output,
reasoning, tool call, or sandbox second), the raw unit and how many of them a price covers, the
base price in millionths of a dollar, a charge multiplier in basis points, and an optional
minimum charge.

For one component the arithmetic is:

```text
exact_millicredits =
    quantity
    x base_price_microusd
    x charge_multiplier_bps
    / unit_size
    / 10,000
```

Sum the exact values of every component of one billable action, then round once, upward, to the
nearest millicredit:

```text
charge_millicredits = ceil(sum(exact_component_millicredits))
```

Rounding once at the end matters. Rounding each token component separately would systematically
overcharge any call that has several small components, and a model call has five.

Here is a worked example using illustrative prices rather than our real ones.

```text
uncached input:  3,600 tokens x $1.50 per 1M =  5,400 micro-USD
cached input:   20,000 tokens x $0.15 per 1M =  3,000 micro-USD
output:            600 tokens x $9.00 per 1M =  5,400 micro-USD
                                                --------
base cost                                       13,800 micro-USD
multiplier of 1.20                              16,560 millicredits
displayed to the user                           16.560 credits
```

The multiplier represents our margin and our risk. It does not change what a credit means. If
provider prices change we publish a new rate card. If we change our margin we publish a new
rate card. An action that is already in flight always settles under the rate card that was
pinned when its hold was authorized, so a price change never rewrites a call that has already
started.

The public price list should be visible even though the multiplier stays internal. A user needs
to know that cached input costs a stated number of credits per million tokens, and needs worked
examples. A user does not need our cost basis.

### 4.3 Model calls

A model charge uses the provider's own reported usage, not our estimate. The uncached input
count is derived:

```text
uncached input = total input - cache-read input - cache-write input
```

The piece of code that normalizes provider usage must keep the provider's raw usage numbers as
JSON, because providers disagree about whether cached tokens are included in the total. LiteLLM
carries a specific guard against double counting cached tokens inside the input total, which is
direct evidence that this cannot be reconstructed later from a credit amount alone
(`research/03-project-litellm-proxy.md`, line 726).

Every model charge stores the total input tokens, the uncached input tokens, the cache read
tokens, the cache write tokens, the output tokens, the reasoning tokens, the provider's request
identifier, the provider and model identifiers, the raw usage document, the rate card
identifier, and a copy of the pricing breakdown that produced the number.

If the provider returns a successful response but no authoritative usage, we do not guess a
customer charge. We treat it as a metering failure, release the hold, record an internal write
off, and open a circuit breaker if it keeps happening. Estimating is fine for deciding whether
to allow a call. It is not acceptable for the final bill, because the cache state alone can
change the true cost by roughly five times.

### 4.4 Tool calls

Tool calls fall into three groups. Internal control flow and platform plumbing cost zero
credits. Tools with a known external cost carry a fixed published price for each successful
invocation. Tools whose external usage varies get a hold sized at an upper bound, then settle
from the tool provider's reported usage.

The model's decision to call a tool is already paid for in the token charge for that model
call. The tool charge covers only the execution. A function call the model emits but that never
runs incurs no tool charge.

Failed tool execution is free to the user. If the external vendor charged us anyway, that cost
is an internal write off.

### 4.5 Sandbox compute

Sandbox compute is priced by the exact billable second, while the published rate is expressed
per minute because that is easier to read.

A long running sandbox is authorized in renewable slices, five minutes to begin with. The
manager holds five minutes of compute, measures the actual seconds used during the slice,
settles the slice, authorizes the next slice before continuing, and stops or parks the sandbox
when a renewal fails. This bounds the possible overrun to one slice, and it avoids placing an
enormous hold for a run whose duration nobody knows in advance.

### 4.6 Why the alternatives were rejected

A credit equal to one token fails because tokens have different prices depending on the model,
the direction, whether reasoning was used, and whether the prefix hit the cache. It also cannot
price a tool call or a second of compute at all.

A floating internal cost unit fails because its exchange rate can move without anyone noticing.
That is precisely the behaviour users read as devaluation.

A balance denominated directly in dollars is easy to understand, but it makes a grant look like
cash and invites requests for refunds and transfers. A credit with a fixed money equivalent
keeps the clarity without turning the wallet into a cash account.

Separate quotas for models, tools, and sandbox time fail because they strand value. A user with
plenty of model quota and no tool quota is blocked while holding unusable value. They also make
purchases and awards awkward to describe. Keep one fungible balance, and keep the separate
meters as line items in the history.

Flat pricing for each call fails for the reasons given in section 3.3. Dify adopted it for a
trial and outgrew it, and the migration could not reconstruct history
(`research/03-project-dify.md`, line 668).

---

## 5. The ledger design

### 5.1 How a balance is produced

The truth is an immutable log of transfers. The current balance is a row that we keep up to
date in the same database transaction that writes the transfer.

The available balance of an organization is:

```text
available = credits_posted - debits_posted - debits_pending
```

`debits_pending` is the total of all open holds. Subtracting it is what stops two simultaneous
requests from both spending the last credit.

This is not a running sum computed on every request, and it is not a snapshot refreshed on a
timer. Every ledger operation inserts an immutable transfer row and updates both affected
account projections inside one Postgres transaction. Because the two writes commit together,
the projection can never drift from the log, and the log can always rebuild the projection.

This is the TigerBeetle account model expressed in Postgres. TigerBeetle keeps four counters on
every account, `debits_pending`, `debits_posted`, `credits_pending`, and `credits_posted`, and
the research recommends mirroring all four rather than collapsing them into one balance, because
the whole hold mechanism lives in the gap between pending and posted
(`research/03-project-tigerbeetle.md`, line 185 and the field by field table).

The alternatives were considered and rejected. A pure running sum over the entries gets slower
as history grows and cannot authorize efficiently. A snapshot plus a tail of recent entries is
useful for historical reads but adds nothing for authorizing the current request. An
asynchronously maintained balance row creates a window during which the balance is wrong, and
that window is exactly when a runaway agent loop does its damage.

The existing meter row is not reused as this projection. Only its SQL pattern is reused.

### 5.2 The schema

The schema below is written to be valid Postgres on its own. It does not reference Agenta's
current organization tables, so the organization identifier is a plain `uuid` column rather
than a foreign key. Wiring it to the real organization table is a small change at
implementation time.

```sql
CREATE TABLE credit_rate_cards (
    id              uuid PRIMARY KEY,
    version         text NOT NULL UNIQUE,
    unit_code       text NOT NULL DEFAULT 'AGC'
                    CHECK (unit_code = 'AGC'),
    effective_at    timestamptz NOT NULL,
    expires_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    CHECK (expires_at IS NULL OR expires_at > effective_at)
);

CREATE TABLE credit_rates (
    id                          uuid PRIMARY KEY,
    rate_card_id                uuid NOT NULL
                                REFERENCES credit_rate_cards (id),
    resource_kind               text NOT NULL
                                CHECK (resource_kind IN ('model', 'tool', 'sandbox')),
    provider                    text NOT NULL,
    sku                         text NOT NULL,
    component                   text NOT NULL
                                CHECK (component IN (
                                    'input_uncached',
                                    'input_cache_read',
                                    'input_cache_write',
                                    'output',
                                    'reasoning',
                                    'tool_call',
                                    'sandbox_second'
                                )),
    quantity_unit               text NOT NULL
                                CHECK (quantity_unit IN ('token', 'call', 'second')),
    unit_size                   bigint NOT NULL CHECK (unit_size > 0),
    base_price_microusd         bigint NOT NULL
                                CHECK (base_price_microusd >= 0),
    charge_multiplier_bps       integer NOT NULL DEFAULT 10000
                                CHECK (
                                    charge_multiplier_bps >= 0
                                    AND charge_multiplier_bps <= 1000000
                                ),
    minimum_charge_millicredits bigint NOT NULL DEFAULT 0
                                CHECK (minimum_charge_millicredits >= 0),
    created_at                  timestamptz NOT NULL DEFAULT now(),
    metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (rate_card_id, resource_kind, provider, sku, component)
);

CREATE TABLE credit_pricing_state (
    singleton           boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    active_rate_card_id uuid NOT NULL REFERENCES credit_rate_cards (id),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credit_accounts (
    id                  uuid PRIMARY KEY,
    organization_id     uuid NOT NULL,
    unit_code           text NOT NULL DEFAULT 'AGC'
                        CHECK (unit_code = 'AGC'),
    kind                text NOT NULL
                        CHECK (kind IN (
                            'wallet',
                            'funding',
                            'consumption',
                            'expiry'
                        )),
    debits_pending      bigint NOT NULL DEFAULT 0
                        CHECK (debits_pending >= 0),
    debits_posted       bigint NOT NULL DEFAULT 0
                        CHECK (debits_posted >= 0),
    credits_pending     bigint NOT NULL DEFAULT 0
                        CHECK (credits_pending >= 0),
    credits_posted      bigint NOT NULL DEFAULT 0
                        CHECK (credits_posted >= 0),
    closed              boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, unit_code, kind),
    UNIQUE (id, organization_id, unit_code)
);

CREATE TABLE credit_transfers (
    sequence                bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    id                      uuid PRIMARY KEY,
    organization_id         uuid NOT NULL,
    unit_code               text NOT NULL DEFAULT 'AGC'
                            CHECK (unit_code = 'AGC'),
    debit_account_id        uuid NOT NULL,
    credit_account_id       uuid NOT NULL,
    phase                   text NOT NULL
                            CHECK (phase IN ('posted', 'hold', 'settle', 'void')),
    reason                  text NOT NULL
                            CHECK (reason IN (
                                'grant',
                                'purchase',
                                'earning',
                                'model_usage',
                                'tool_usage',
                                'sandbox_usage',
                                'refund',
                                'expiry',
                                'chargeback',
                                'correction',
                                'technical_failure'
                            )),
    amount_millicredits     bigint NOT NULL
                            CHECK (amount_millicredits >= 0),
    hold_transfer_id        uuid,
    idempotency_key         text NOT NULL,
    request_fingerprint     bytea NOT NULL
                            CHECK (octet_length(request_fingerprint) = 32),
    rate_card_id            uuid REFERENCES credit_rate_cards (id),
    reference_type          text,
    reference_id            text,
    actor_type              text NOT NULL DEFAULT 'system'
                            CHECK (actor_type IN (
                                'system',
                                'user',
                                'administrator',
                                'payment',
                                'contribution'
                            )),
    actor_id                 text,
    effective_at            timestamptz NOT NULL DEFAULT now(),
    created_at              timestamptz NOT NULL DEFAULT now(),
    metadata                jsonb NOT NULL DEFAULT '{}'::jsonb,

    CHECK (debit_account_id <> credit_account_id),
    CHECK (
        (phase = 'posted'
            AND hold_transfer_id IS NULL
            AND amount_millicredits > 0)
        OR
        (phase = 'hold'
            AND hold_transfer_id IS NULL
            AND amount_millicredits > 0)
        OR
        (phase = 'settle'
            AND hold_transfer_id IS NOT NULL)
        OR
        (phase = 'void'
            AND hold_transfer_id IS NOT NULL
            AND amount_millicredits = 0)
    ),

    UNIQUE (organization_id, idempotency_key),
    UNIQUE (id, organization_id, unit_code),

    FOREIGN KEY (
        debit_account_id,
        organization_id,
        unit_code
    ) REFERENCES credit_accounts (
        id,
        organization_id,
        unit_code
    ),

    FOREIGN KEY (
        credit_account_id,
        organization_id,
        unit_code
    ) REFERENCES credit_accounts (
        id,
        organization_id,
        unit_code
    ),

    FOREIGN KEY (
        hold_transfer_id,
        organization_id,
        unit_code
    ) REFERENCES credit_transfers (
        id,
        organization_id,
        unit_code
    )
);

CREATE UNIQUE INDEX credit_transfers_one_resolution_per_hold
    ON credit_transfers (hold_transfer_id)
    WHERE phase IN ('settle', 'void');

CREATE INDEX credit_transfers_org_sequence_idx
    ON credit_transfers (organization_id, sequence);

CREATE INDEX credit_transfers_org_reason_created_idx
    ON credit_transfers (organization_id, reason, created_at DESC);

CREATE INDEX credit_transfers_reference_idx
    ON credit_transfers (reference_type, reference_id)
    WHERE reference_id IS NOT NULL;

CREATE TABLE credit_hold_states (
    hold_transfer_id        uuid PRIMARY KEY,
    organization_id         uuid NOT NULL,
    unit_code               text NOT NULL DEFAULT 'AGC'
                            CHECK (unit_code = 'AGC'),
    reserved_millicredits   bigint NOT NULL
                            CHECK (reserved_millicredits > 0),
    status                  text NOT NULL
                            CHECK (status IN ('pending', 'settled', 'voided')),
    expires_at              timestamptz NOT NULL,
    resolved_transfer_id    uuid UNIQUE,
    resolved_at             timestamptz,
    updated_at              timestamptz NOT NULL DEFAULT now(),

    CHECK (
        (status = 'pending'
            AND resolved_transfer_id IS NULL
            AND resolved_at IS NULL)
        OR
        (status IN ('settled', 'voided')
            AND resolved_transfer_id IS NOT NULL
            AND resolved_at IS NOT NULL)
    ),

    FOREIGN KEY (
        hold_transfer_id,
        organization_id,
        unit_code
    ) REFERENCES credit_transfers (
        id,
        organization_id,
        unit_code
    ),

    FOREIGN KEY (
        resolved_transfer_id,
        organization_id,
        unit_code
    ) REFERENCES credit_transfers (
        id,
        organization_id,
        unit_code
    )
);

CREATE INDEX credit_hold_states_pending_expiry_idx
    ON credit_hold_states (expires_at)
    WHERE status = 'pending';

CREATE TABLE credit_lots (
    id                      uuid PRIMARY KEY,
    organization_id         uuid NOT NULL,
    unit_code               text NOT NULL DEFAULT 'AGC'
                            CHECK (unit_code = 'AGC'),
    source_transfer_id      uuid NOT NULL UNIQUE,
    source_kind             text NOT NULL
                            CHECK (source_kind IN (
                                'grant',
                                'purchase',
                                'earning',
                                'refund',
                                'adjustment'
                            )),
    original_millicredits   bigint NOT NULL
                            CHECK (original_millicredits > 0),
    spend_priority          smallint NOT NULL
                            CHECK (spend_priority >= 0),
    effective_at            timestamptz NOT NULL DEFAULT now(),
    expires_at              timestamptz,
    external_reference      text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    metadata                jsonb NOT NULL DEFAULT '{}'::jsonb,

    CHECK (expires_at IS NULL OR expires_at > effective_at),
    UNIQUE (id, organization_id, unit_code),

    FOREIGN KEY (
        source_transfer_id,
        organization_id,
        unit_code
    ) REFERENCES credit_transfers (
        id,
        organization_id,
        unit_code
    )
);

CREATE UNIQUE INDEX credit_lots_external_reference_idx
    ON credit_lots (source_kind, external_reference)
    WHERE external_reference IS NOT NULL;

CREATE INDEX credit_lots_spend_order_idx
    ON credit_lots (
        organization_id,
        (expires_at IS NULL),
        expires_at,
        spend_priority,
        created_at,
        id
    );

CREATE TABLE credit_lot_balances (
    lot_id                      uuid PRIMARY KEY,
    organization_id             uuid NOT NULL,
    unit_code                   text NOT NULL DEFAULT 'AGC'
                                CHECK (unit_code = 'AGC'),
    original_millicredits       bigint NOT NULL
                                CHECK (original_millicredits > 0),
    available_millicredits      bigint NOT NULL
                                CHECK (available_millicredits >= 0),
    pending_millicredits        bigint NOT NULL DEFAULT 0
                                CHECK (pending_millicredits >= 0),
    spent_millicredits          bigint NOT NULL DEFAULT 0
                                CHECK (spent_millicredits >= 0),
    expired_millicredits        bigint NOT NULL DEFAULT 0
                                CHECK (expired_millicredits >= 0),
    deficit_recovery_millicredits bigint NOT NULL DEFAULT 0
                                CHECK (deficit_recovery_millicredits >= 0),
    updated_at                  timestamptz NOT NULL DEFAULT now(),

    CHECK (
        available_millicredits
        + pending_millicredits
        + spent_millicredits
        + expired_millicredits
        + deficit_recovery_millicredits
        = original_millicredits
    ),

    FOREIGN KEY (
        lot_id,
        organization_id,
        unit_code
    ) REFERENCES credit_lots (
        id,
        organization_id,
        unit_code
    )
);

CREATE INDEX credit_lot_balances_org_available_idx
    ON credit_lot_balances (organization_id, available_millicredits)
    WHERE available_millicredits > 0;

CREATE TABLE credit_lot_events (
    id                      uuid PRIMARY KEY,
    organization_id         uuid NOT NULL,
    unit_code               text NOT NULL DEFAULT 'AGC'
                            CHECK (unit_code = 'AGC'),
    lot_id                  uuid NOT NULL,
    transfer_id             uuid NOT NULL,
    event_kind              text NOT NULL
                            CHECK (event_kind IN (
                                'hold_reserved',
                                'hold_consumed',
                                'hold_released_available',
                                'hold_released_expired',
                                'spent',
                                'expired',
                                'deficit_recovery'
                            )),
    amount_millicredits     bigint NOT NULL
                            CHECK (amount_millicredits > 0),
    created_at              timestamptz NOT NULL DEFAULT now(),
    metadata                jsonb NOT NULL DEFAULT '{}'::jsonb,

    UNIQUE (lot_id, transfer_id, event_kind),

    FOREIGN KEY (
        lot_id,
        organization_id,
        unit_code
    ) REFERENCES credit_lots (
        id,
        organization_id,
        unit_code
    ),

    FOREIGN KEY (
        transfer_id,
        organization_id,
        unit_code
    ) REFERENCES credit_transfers (
        id,
        organization_id,
        unit_code
    )
);

CREATE INDEX credit_lot_events_transfer_idx
    ON credit_lot_events (transfer_id);

CREATE TABLE credit_usage_records (
    transfer_id                    uuid PRIMARY KEY,
    organization_id                uuid NOT NULL,
    unit_code                      text NOT NULL DEFAULT 'AGC'
                                   CHECK (unit_code = 'AGC'),
    resource_kind                  text NOT NULL
                                   CHECK (resource_kind IN (
                                       'model',
                                       'tool',
                                       'sandbox'
                                   )),
    rate_card_id                   uuid NOT NULL
                                   REFERENCES credit_rate_cards (id),
    provider                       text NOT NULL,
    sku                            text NOT NULL,
    provider_request_id            text,
    project_id                     uuid,
    run_id                         uuid,
    input_tokens_total             bigint NOT NULL DEFAULT 0
                                   CHECK (input_tokens_total >= 0),
    input_tokens_uncached          bigint NOT NULL DEFAULT 0
                                   CHECK (input_tokens_uncached >= 0),
    input_tokens_cache_read        bigint NOT NULL DEFAULT 0
                                   CHECK (input_tokens_cache_read >= 0),
    input_tokens_cache_write       bigint NOT NULL DEFAULT 0
                                   CHECK (input_tokens_cache_write >= 0),
    output_tokens                  bigint NOT NULL DEFAULT 0
                                   CHECK (output_tokens >= 0),
    reasoning_tokens               bigint NOT NULL DEFAULT 0
                                   CHECK (reasoning_tokens >= 0),
    tool_calls                     bigint NOT NULL DEFAULT 0
                                   CHECK (tool_calls >= 0),
    sandbox_seconds                bigint NOT NULL DEFAULT 0
                                   CHECK (sandbox_seconds >= 0),
    cost_basis_microusd            bigint
                                   CHECK (
                                       cost_basis_microusd IS NULL
                                       OR cost_basis_microusd >= 0
                                   ),
    calculated_millicredits        bigint NOT NULL
                                   CHECK (calculated_millicredits >= 0),
    pricing_snapshot               jsonb NOT NULL,
    raw_usage                      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at                     timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (
        transfer_id,
        organization_id,
        unit_code
    ) REFERENCES credit_transfers (
        id,
        organization_id,
        unit_code
    )
);

CREATE UNIQUE INDEX credit_usage_provider_request_idx
    ON credit_usage_records (provider, provider_request_id)
    WHERE provider_request_id IS NOT NULL;

CREATE INDEX credit_usage_org_run_idx
    ON credit_usage_records (organization_id, run_id, created_at DESC);

CREATE INDEX credit_usage_resource_idx
    ON credit_usage_records (
        organization_id,
        resource_kind,
        created_at DESC
    );

CREATE FUNCTION reject_credit_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER credit_rate_cards_immutable
BEFORE UPDATE OR DELETE ON credit_rate_cards
FOR EACH ROW EXECUTE FUNCTION reject_credit_history_mutation();

CREATE TRIGGER credit_rates_immutable
BEFORE UPDATE OR DELETE ON credit_rates
FOR EACH ROW EXECUTE FUNCTION reject_credit_history_mutation();

CREATE TRIGGER credit_transfers_immutable
BEFORE UPDATE OR DELETE ON credit_transfers
FOR EACH ROW EXECUTE FUNCTION reject_credit_history_mutation();

CREATE TRIGGER credit_lots_immutable
BEFORE UPDATE OR DELETE ON credit_lots
FOR EACH ROW EXECUTE FUNCTION reject_credit_history_mutation();

CREATE TRIGGER credit_lot_events_immutable
BEFORE UPDATE OR DELETE ON credit_lot_events
FOR EACH ROW EXECUTE FUNCTION reject_credit_history_mutation();

CREATE TRIGGER credit_usage_records_immutable
BEFORE UPDATE OR DELETE ON credit_usage_records
FOR EACH ROW EXECUTE FUNCTION reject_credit_history_mutation();
```

Four of these tables are mutable projections: `credit_accounts`, `credit_hold_states`,
`credit_lot_balances`, and `credit_pricing_state`. Every other table is immutable history, and
the database triggers enforce that rather than trusting the application to behave.

The `unit_code` column exists on every table with a check constraint pinning it to a single
value, which is a short code standing for the Agenta credit. It costs nothing today and it is the
seam through which a second unit could be added later without a schema change.

Four of the immutable tables also carry a `schema_version smallint NOT NULL DEFAULT 1` column:
`credit_transfers`, `credit_lots`, `credit_lot_events`, and `credit_usage_records`. These rows
live forever, so a version stamp is what stops us from reading an old metadata document or an
old pricing snapshot with new rules five years from now. Adding this column later is possible,
but the backfill would have to guess which rows were written under which meaning, and that is
exactly the guess we cannot make.

### 5.3 Why every entry names two accounts

Each transfer names an account the value left and an account it entered. A grant moves value
from the organization's funding account into its wallet. Consumption moves value from the
wallet into its consumption account. A refund moves value in the opposite direction. Expiry
moves value from the wallet into its expiry account.

Each organization gets its own counterparty accounts rather than sharing one global consumption
account. A single global account would become a row that every customer's transaction has to
lock in turn, and that would serialize the whole platform.

Naming both sides on every row guarantees that value cannot appear from nowhere, and it does so
by construction. It does not need a deferred trigger that checks whether the entries of a
transaction sum to zero. It is also small enough to build in the first version.

### 5.4 How a charge is made safe against being applied twice

Every posting operation receives an idempotency key and a request fingerprint, which is a
SHA-256 hash of the meaningful contents of the operation.

The keys look like this:

```text
grant:signup-2026:019...
purchase:stripe:event_...
earning:approval:019...
model:<gateway-request-id>:hold
model:<gateway-request-id>:settle
refund:<original-transfer-id>:<case-id>
```

The write algorithm has four steps. Attempt to insert the transfer. If a row already exists
with that organization and that idempotency key, load it. If the stored fingerprint matches the
one we computed, return the original result as a success. If the fingerprint differs, return a
conflict and apply nothing.

The fingerprint is what separates a harmless network retry from a genuine bug where the same
key was reused for a different amount. OpenMeter's newer ledger states this problem explicitly:
atomic posting alone does not deduplicate a repeated business operation, and the domain that
starts the operation has to supply the key
(`research/03-project-openmeter-credit-engine.md`, line 638).

One consequence deserves emphasis. A retry against the model provider is not automatically the
same logical call. If the provider actually executes the request twice, we pay twice. The
gateway therefore performs no automatic retries of a generation, with a single exception: it
may retry once after a 429 rate limit response, and only before dispatch has been accepted. It
never deduplicates requests by hashing the body, because two identical prompts can be two
legitimate separate calls.

### 5.5 How two simultaneous requests cannot both spend the last credit

Every operation for one organization takes locks in the same order. First the gateway token row
or the run limit row. Then the organization wallet account. Then any other accounts of that
organization in ascending order of their identifier. Then the credit lots in spending order.

The transaction runs at Postgres's default `READ COMMITTED` isolation. A `SELECT ... FOR
UPDATE` on the wallet row is sufficient, because every operation that can change a balance obeys
the same lock order.

Placing a hold is nine steps inside one transaction. Lock the wallet. Expire any lots that are
due and not reserved. Read the available balance from the locked account. Reject the request if
the available balance is smaller than the hold. Insert the immutable hold transfer. Insert the
hold state row. Move the held amount from available to pending across the selected lot
projections. Increment `debits_pending` on the wallet and `credits_pending` on the counterparty
account. Commit.

A second request that arrives at the same time waits for the first. When it wakes, the first
request's reservation is already sitting in `debits_pending`, so the second request cannot see
that value as available.

Redis plays no part in this correctness path. Dify's Redis lock only reduces contention on the
database; its Postgres row lock is what provides correctness
(`research/03-project-dify.md`, line 343). At the request rate we expect, putting Redis in the
financial decision would add recovery states without buying useful throughput.

### 5.6 How a charge whose size is unknown until the end is handled

The estimator that sizes a hold uses the estimated input tokens plus a safety margin, the full
uncached input rate, the gateway enforced ceiling on output and reasoning tokens, one
completion (`n = 1` and `best_of = 1`), and the rate card pinned at authorization.

Reserving the input at the uncached rate is deliberately conservative. It refuses to bet the
organization's balance on the assumption that the provider's cache will hit. The hold is
released as soon as the real usage arrives, so it only limits what else can run at the same
moment, not what the call finally costs.

Settlement is thirteen steps inside one transaction. Lock the hold state row. If the same
idempotent operation already resolved it, return the existing settlement. Insert the settlement
transfer. Subtract the entire reserved amount from the pending counters. Add the actual charge
to the posted counters. Consume the corresponding reserved amounts on the lots. Return whatever
was not used to the lots that have not expired. Immediately expire any released value whose lot
expired while the work was running. If the actual amount came out higher than the reservation,
allocate the excess from lots that are currently available. Record any remainder that no lot
can cover as a deficit on the account. Mark the hold state settled. Insert the usage record.
Commit.

Settlement must never fail because the true amount exceeded the hold. The provider has already
charged us. The account may go negative, the balance shown to the user floors at zero, and all
new authorization stops until the deficit is cleared. TigerBeetle refuses a settlement larger
than its hold, which is correct for a bank authorization, and the research states plainly that
this rule has to be inverted for provider usage because our money is already gone
(`research/03-project-tigerbeetle.md`, line 661).

For a fixed price tool, the hold and the settlement are the same number. For sandbox compute,
each renewable slice is one hold.

The streaming case is the one that motivates all of this. In a streamed response the token
counts arrive in the final event, after the answer has already been written to the user. The
hold covers the whole call from the moment it is authorized. The settlement uses the numbers in
that final event.

### 5.7 Lots, expiry, and the order value is spent in

The product shows one balance. Internally, every incoming transfer creates a lot, and each lot
carries its own expiry and its own record of where it came from.

The default policies are as follows. Signup and promotional grants expire on a date the
campaign defines. Earned contribution credits expire after twelve months. Purchased credits do
not expire. Refund credits inherit non-expiry when the original value was purchased, and
otherwise expire at the later of the original expiry or thirty days after the refund. Manual
corrections carry an explicit policy set by the administrator who made them.

Lots are spent in this order: lots that expire before lots that never expire, then earliest
expiry first, then lower spend priority, then oldest creation time, then lowest identifier as
a deterministic tie break.

This deliberately rejects OpenMeter's recommended order, which puts source priority ahead of
expiry. That ordering can spend a promotional lot that expires next year while an earned lot
expires tomorrow, and the user then loses value they worked for. Earliest expiry first is the
customer fair rule. Source priority only breaks ties.

Expiry happens in two ways at once. Every authorization expires any due lots while it already
holds the wallet lock, which keeps the authorization decision correct. A scheduled sweeper runs
separately so displayed balances stay current even when nobody is spending.

Expiry only touches available value. Value that was reserved before the expiry stays reserved
for that work. If that value later comes back unused, it expires immediately rather than
becoming available again. An expiry writes a posted transfer from the wallet to the expiry
account, plus a lot event. Nothing deletes or edits the original grant.

### 5.8 How grants, purchases, and earned credits enter

All three are the same financial operation:

```text
organization funding account -> organization wallet account
```

They differ only in the reason recorded on the transfer, the source kind on the lot, the
idempotency key, the expiry, the priority, and the provenance recorded alongside.

A signup grant is unique per organization and campaign. A purchase is unique per payment
processor event or payment intent. An earned award is unique per contribution approval
identifier. A manual grant is unique per administrator request identifier.

A payment webhook that fires twice therefore returns the existing purchase. It never creates a
second lot.

One rule matters when the account is already negative. If credits arrive while the account
carries a deficit, the amount needed to clear the deficit is recorded as deficit recovery on
the new lot, and only the remainder becomes available. Without that rule, adding a hundred
credits to a balance of minus ten would appear to offer a hundred spendable credits and would
immediately recreate the deficit.

### 5.9 Refunds, failures, and partly streamed responses

A refund never edits the original debit. It posts a reverse transfer from the consumption
account back to the wallet, links the original transfer in its metadata, and creates a refund
lot.

The rules for each situation are these. A gateway or provider failure before any successful
model result voids the hold and produces no debit. A provider error after output has already
started streaming produces no user charge, even if the provider billed us. A user who
disconnects while the upstream call is still succeeding is charged normally, because the
gateway keeps reading the upstream response and settles the exact usage. A call that completes
with a finish reason of `stop`, `length`, or `tool_calls` is charged for its actual usage. A
safety rejection or a provider side validation failure produces no charge. A completed call
that is later found to be our billing error gets a refund transfer. A chargeback on purchased
credits posts a chargeback transfer, and if the value was already spent, the account goes
negative and managed usage is suspended.

The rule that failed actions are free follows the strongest product evidence in the research.
Users tolerate paying for what worked. They do not tolerate paying for a product's own failure
(`research/02-competitor-credit-products.md`, line 743).

### 5.10 Reconciliation

Two reconcilers run. A frequent internal reconciler compares each account projection and each
lot projection against a replay of the immutable transfers and lot events. A later external
reconciler compares our normalized provider usage and computed cost against the provider's own
billing exports.

A mismatch never edits history. It raises an incident, and if the customer needs an adjustment,
it produces a correction or refund transfer.

No snapshot table is needed at first. The global `sequence` column on the transfer table exists
so that a future snapshot can record the projection as of sequence N and replay only the tail,
without any change to the existing ledger.

---

## 6. The gateway design

### 6.1 Where the gateway runs

Build a dedicated FastAPI gateway process inside the Agenta monorepo, deployed as its own
Docker Compose service. It shares the existing Postgres database. It may use the existing Redis
instance for rate limiting, short lived caches, and emergency spooling of settlements.

Do not put long lived model streams into the main API worker pool. A separate process gives
independent worker counts and streaming timeouts, a narrow public attack surface, independent
health checks and circuit breakers, separate deployment and rollback, and no interference with
ordinary API latency. It needs no Kubernetes and no new stateful database, which matters
because we deploy with Docker Compose on EC2.

The enterprise edition API mints the tokens and exposes balance and history management. The
gateway container exists only in the commercial deployment. The open source API is unchanged.

Do not adopt LiteLLM as the proxy. Its useful ideas are the reservation lifecycle and the usage
normalization, and those ideas are borrowed here. Its implementation makes Redis counters
authoritative, keeps holds only in Redis and process memory, and can silently lose spend from
asynchronous queues. Its own issue tracker documents leaked reservations and loss that is not
bounded across repeated write failures (`research/03-project-litellm-proxy.md`, line 616).
Adopting it would also expose a much larger surface of dialects and routing than we need.

LiteLLM's model price registry is still useful as an input to a job that generates rate cards.
Every imported price must become an immutable Agenta rate card version before it can affect a
bill.

### 6.2 What the sandbox receives instead of a real credential

The sandbox receives three things:

```text
OPENAI_API_KEY=agenta_gateway_<256-bit-random-value>
baseUrl=https://<managed-model-gateway>/v1
model=google/<managed-gemini-model>
```

The token is an opaque random string, not a signed token that carries its own claims. Every
model call already needs a Postgres transaction in order to place a hold, so a self contained
signed token would save no database round trip, and it would make revocation harder.

We store only an HMAC-SHA-256 digest of the token, never the token itself.

```sql
CREATE TABLE model_gateway_tokens (
    id                          uuid PRIMARY KEY,
    token_digest                bytea NOT NULL UNIQUE
                                CHECK (octet_length(token_digest) = 32),
    organization_id             uuid NOT NULL,
    project_id                  uuid NOT NULL,
    run_id                      uuid NOT NULL,
    allowed_model               text NOT NULL,
    rate_card_id                uuid NOT NULL
                                REFERENCES credit_rate_cards (id),
    max_input_bytes             integer NOT NULL
                                CHECK (max_input_bytes > 0),
    max_output_tokens           integer NOT NULL
                                CHECK (max_output_tokens > 0),
    max_concurrency             smallint NOT NULL DEFAULT 1
                                CHECK (max_concurrency > 0),
    run_limit_millicredits      bigint NOT NULL
                                CHECK (run_limit_millicredits > 0),
    run_debits_pending          bigint NOT NULL DEFAULT 0
                                CHECK (run_debits_pending >= 0),
    run_debits_posted           bigint NOT NULL DEFAULT 0
                                CHECK (run_debits_posted >= 0),
    expires_at                  timestamptz NOT NULL,
    revoked_at                  timestamptz,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX model_gateway_tokens_run_idx
    ON model_gateway_tokens (organization_id, run_id);

CREATE INDEX model_gateway_tokens_active_expiry_idx
    ON model_gateway_tokens (expires_at)
    WHERE revoked_at IS NULL;
```

The token is minted when an authorized managed run starts, not at signup. Its plaintext value is
returned exactly once, to the server side connection resolver. The resolver places it in the
resolved secret environment and supplies a reserved managed connection slug, which is what makes
the current harness configuration builder activate. The earlier plan already identified that a
default connection without a slug does not trigger that builder, and that this must be fixed
before rollout (`prior-work/revised-plan.md`, line 315).

The expiry is set to the run's hard deadline plus a short grace period. The token is revoked
when the run ends, when the user cancels, when an administrator suspends the organization, when
abuse is detected, or when the global kill switch for managed models is activated.

The token is assumed readable by the user. Its safety comes entirely from the scope the server
enforces, not from keeping it secret.

### 6.3 The operational record of a request

Every inbound call creates a mutable operational row before anything is dispatched to the
provider. This table is operational state, not financial history, and it is allowed to change
as the request advances. Its identifiers are what produce the immutable idempotency keys for the
hold and the settlement.

```sql
CREATE TABLE model_gateway_requests (
    id                          uuid PRIMARY KEY,
    token_id                    uuid NOT NULL
                                REFERENCES model_gateway_tokens (id),
    organization_id             uuid NOT NULL,
    client_idempotency_key      text,
    request_fingerprint         bytea NOT NULL
                                CHECK (octet_length(request_fingerprint) = 32),
    state                       text NOT NULL
                                CHECK (state IN (
                                    'authorized',
                                    'dispatched',
                                    'streaming',
                                    'provider_succeeded',
                                    'provider_failed',
                                    'settled',
                                    'voided',
                                    'ambiguous'
                                )),
    hold_transfer_id            uuid UNIQUE
                                REFERENCES credit_transfers (id),
    reserved_millicredits       bigint NOT NULL
                                CHECK (reserved_millicredits >= 0),
    fallback_input_millicredits bigint NOT NULL
                                CHECK (fallback_input_millicredits >= 0),
    provider_request_id         text,
    usage                       jsonb,
    response_started_at         timestamptz,
    provider_finished_at        timestamptz,
    settled_at                  timestamptz,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX model_gateway_requests_client_idempotency_idx
    ON model_gateway_requests (token_id, client_idempotency_key)
    WHERE client_idempotency_key IS NOT NULL;

CREATE INDEX model_gateway_requests_unfinished_idx
    ON model_gateway_requests (created_at)
    WHERE state IN ('authorized', 'dispatched', 'streaming', 'provider_succeeded');
```

### 6.4 The request path, end to end

The gateway exposes exactly one route:

```http
POST /v1/chat/completions
Authorization: Bearer agenta_gateway_...
Content-Type: application/json
```

It processes a request in this order.

First it validates the perimeter, rejecting the wrong path, the wrong method, the wrong content
type, anomalies in a compressed body, or a body larger than a global limit. That global limit
applies before anyone is authenticated. The smaller limit configured on the token is applied
after authentication, because the gateway cannot know which token is calling until it has read
enough of the request to identify it. Second it authenticates the token by hashing the bearer
value, loading the row, and rejecting anything unknown, expired, or revoked. Third it parses a copy of the JSON, and it trusts nothing
in that body as the source of organization, project, run, price card, or provider identity.

Fourth it authorizes the model, requiring an exact match against the token's allowed model.
Fifth it validates that the request has a billable shape: one completion only, no batch
endpoint, no unsupported modalities, and no caller supplied Google cache resource. Sixth it
bounds the output, clamping or inserting `max_tokens` or `max_completion_tokens` up to the
token's ceiling. Seventh, for a streaming request, it inserts `stream_options.include_usage =
true` so the provider returns token counts. Eighth it restores the Gemini thought signatures onto
the matching assistant tool calls.

Ninth it applies idempotency. If the caller supplied a key, it returns the existing request or a
conflict when the fingerprint differs. Otherwise it treats this HTTP call as a new provider
attempt. Tenth it applies abuse controls: rate limits by token, run, organization, and network
address, plus the concurrency ceiling. Eleventh it checks that a valid Google access token is
available, before it reserves any of the user's value.

Twelfth it prices, loading the rate card pinned to the token, estimating the input, computing
the conservative hold, and computing an input only fallback amount. Thirteenth it authorizes
atomically: in one Postgres transaction it locks the gateway token and the organization wallet,
enforces the per run limit, places the hold, creates the operational request row, and commits.

Fourteenth it marks the operational request as dispatched before it writes anything upstream.
Fifteenth it calls the provider, replacing the Agenta bearer token with the Google access token.
Sixteenth it inspects the upstream status before it commits any downstream headers, and a non
2xx response voids the hold.

Seventeenth it relays the stream, forwarding chunks immediately while feeding a side parser.
Eighteenth, once authoritative usage arrives, it settles the hold and inserts the usage record
before it forwards the final marker. Nineteenth it forwards `data: [DONE]`, closes the stream,
and emits metrics.

When the balance is exhausted the gateway returns a clear, machine readable error rather than a
silent failure:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "error": {
    "type": "insufficient_credits",
    "code": "credit_balance_exhausted",
    "message": "This request needs 54.000 available credits.",
    "balance_credits": "21.375",
    "required_hold_credits": "54.000",
    "request_id": "..."
  }
}
```

The product can then offer a purchase, an earning path, or bring your own key, without losing
the message the user typed.

### 6.5 How the gateway talks to Google

The gateway calls Vertex AI's OpenAI-compatible endpoint:

```text
https://aiplatform.googleapis.com/
v1/projects/{configured-project}/locations/{configured-location}/
endpoints/openapi/chat/completions
```

The model identifier carries Google's required `google/` prefix. The gateway authenticates using
Application Default Credentials and caches the short lived access token in the process,
refreshing it before it expires. No Google credential and no access token ever crosses into the
sandbox.

This endpoint supports chat messages, tools, streaming, and references to an explicit cache,
which means we do not need a second dialect in the runner
(`research/01-gemini-and-caching.md`, section 3).

One contract test blocks launch. The published list of supported parameters for the Vertex
compatibility endpoint does not include `stream_options`, and unsupported parameters there are
ignored rather than rejected, so whether that endpoint returns usage on a streamed response is
unverified (`research/01-gemini-and-caching.md`, line 304). Two live calls settle it. This is a
launch blocking test rather than a reason to quietly estimate what we charge customers.

### 6.6 Carrying the Gemini thought signature

Gemini 3 attaches an encrypted blob to each function call it emits, and it returns a 400 error on
the next turn if that blob does not come back. Through the OpenAI-compatible endpoint it arrives
in a non standard place:

```json
{
  "tool_calls": [
    {
      "id": "call_123",
      "extra_content": {
        "google": {
          "thought_signature": "..."
        }
      }
    }
  ]
}
```

Our harness drops `extra_content`, because ordinary OpenAI dialect clients parse tool calls into
their own types. The gateway therefore parses streamed tool call deltas while relaying them,
accumulates the signature keyed by the gateway token and the tool call identifier, persists it
until the token expires, finds the matching assistant tool call on the next request, restores
`extra_content.google.thought_signature`, and rejects the continuation before dispatch if a
required signature is missing.

This state lives in Postgres, with Redis allowed only as a read cache. Losing Redis must not lose
a signature, because losing one signature breaks the next tool call outright.

```sql
CREATE TABLE model_gateway_thought_signatures (
    token_id              uuid        NOT NULL
        REFERENCES model_gateway_tokens (id) ON DELETE CASCADE,
    tool_call_id          text        NOT NULL,
    signature_ciphertext  bytea       NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    expires_at            timestamptz NOT NULL,
    consumed_at           timestamptz,
    PRIMARY KEY (token_id, tool_call_id),
    CHECK (expires_at > created_at)
);

CREATE INDEX model_gateway_thought_signatures_expiry_idx
    ON model_gateway_thought_signatures (expires_at);
```

The signature is encrypted with the same envelope key mechanism the platform already uses for
sensitive provider material. The run token's own expiry bounds how long any of these rows stay
useful.

This mutation happens inside the conversation history, after the large stable prefix that the
harness replays. It therefore does not change the roughly 23,600 token prefix of system prompt
and tool definitions whose caching is where the money is.

### 6.7 Streaming

The gateway uses `httpx.AsyncClient.stream()` on the way out and FastAPI's `StreamingResponse` on
the way back. The reverse proxy in front of it must have response buffering disabled, otherwise it
will silently turn a stream into a single slow batch.

The relay does not buffer the answer. It retains only one incomplete server-sent event with a hard
size limit, the provider request identifier, the usage data, the tool call identifiers and
signature fragments, and the final usage and completion events until settlement finishes. Content
bytes are forwarded as they arrive. The parser is a tee off the stream, not a read then re-emit
pipeline.

Once the first byte has reached the caller, the HTTP status can no longer change. A provider
failure that happens midstream therefore becomes an error event in the stream followed by closing
the connection. It voids the hold and charges nothing.

If the caller disconnects, the gateway stops writing downstream but keeps reading upstream. That
preserves the authoritative usage and it stops a deliberate disconnect from becoming a way to get
free calls. This behaviour is well documented in existing gateways
(`research/04-gateway-architecture.md`, line 786).

### 6.8 How usage becomes a ledger entry

For a successful stream, the provider's final usage event is normalized into a record like this:

```json
{
  "resource_kind": "model",
  "provider": "google_vertex",
  "sku": "google/gemini-...",
  "input_tokens_total": 23600,
  "input_tokens_uncached": 3100,
  "input_tokens_cache_read": 20500,
  "input_tokens_cache_write": 0,
  "output_tokens": 420,
  "reasoning_tokens": 0,
  "rate_card_id": "...",
  "pricing_snapshot": {
    "version": "2026-08-03",
    "components": []
  },
  "provider_request_id": "...",
  "raw_usage": {}
}
```

The pricing service turns that into an integer number of millicredits. The ledger then writes, in
one transaction, the settlement transfer, the account projection changes, the lot events and lot
projections, the usage record, the new state of the gateway request, and the change to the run
counters on the gateway token. The transfer amount and the calculated amount must agree before
the transaction commits.

### 6.9 What breaks prompt caching, and how this design avoids it

Prompt caching is the primary cost objective of the whole system. Our measured traffic sends
roughly 23,600 prompt tokens on every call, and cached Gemini input costs about one tenth of
ordinary input. The research calculates a difference of roughly 4.7 times at the level of a whole
conversation when most prompt tokens hit the cache (`research/01-gemini-and-caching.md`, line
201).

One earlier rule should be relaxed on the evidence. The prior research recommends forwarding the
HTTP body byte for byte and never re-serialising it. That rule is stricter than the provider
evidence supports. Providers cache the model prompt prefix, not the irrelevant whitespace of the
JSON envelope, so reordering the keys of a JSON object does not change the tokens the model sees.
Reordering the tools array, changing system content, or inserting a timestamp into the prompt
does.

The gateway still keeps mutations to a minimum, but the invariants that actually matter are these.
Never add request identifiers, timestamps, policy text, organization identifiers, or attribution
data into `messages`, the system prompt, the tool definitions, or the response schema. Never
reorder messages, tools, tool properties, or retrieved documents. Keep the model identifier stable
across a conversation. Keep one conversation on the same provider project, location, and model
backend. Never spread calls across funded provider accounts in a round robin, because that splits
one workload across several caches and the hit rate falls to roughly one over the number of
backends. Put gateway metadata in the bearer token, in headers, in operational tables, or in the
URL. Treat `max_tokens` and `stream_options` as transport level controls that sit outside the
prompt prefix. Restore thought signatures only where the provider's own transcript requires them.
Record the cache read tokens and the resulting saving on every call.

The gateway should also compute and store a fingerprint of the stable prefix for each agent
revision, purely for observability. It does not send that fingerprint upstream.

The first version uses implicit caching, which Gemini 2.5 and later apply automatically, and it
measures the result. Explicit caching, where we create a named cache resource and reference it, is
not a shortcut. It requires extracting the stable prefix, creating the cache resource, and then
removing exactly that prefix from every later request. Build it later, per agent revision, once
measurements show misses. Explicit caching can hold system instructions, contents, tools, and tool
configuration, and its economics are good for a reused prefix
(`research/01-gemini-and-caching.md`, section 2).

Four conditions gate a broad rollout. The second and later calls of a test conversation must
report a nonzero cache read count. At least 80 percent of the measured stable prefix must be
served from cache on calls after the first. Alerts must fire on a sudden regression in cache hit
rate, broken down by model and by gateway release. A continuous integration test must send a long
identical prefix twice and assert that the second response reports cached tokens.

### 6.10 What happens when things fail

| Failure | Gateway action | Financial action | What the user sees |
|---|---|---|---|
| Gateway unavailable before the request | No provider call | None | A retriable "managed model unavailable" error |
| Invalid, expired, or revoked token | Reject | None | 401; the turn is rerun or restarted |
| Requested model outside the token's scope | Reject and flag for abuse review | None | 403 |
| Organization or run cap exhausted | Reject | None | 402 with the balance and the required hold |
| Ledger unavailable before dispatch | Fail closed | None | 503; no credits consumed |
| Redis unavailable | Use Postgres for authentication and the ledger; disable the optional cache | None unless authorization succeeded | Normally invisible; fail closed if rate enforcement cannot be preserved |
| Provider returns 429 | Void the hold; retry once only when the provider states nothing executed | None | 503 or 429 with `Retry-After` |
| Provider times out before responding | No automatic retry of the generation | Void the hold | 504; no charge |
| Provider returns a non 2xx status | Relay a normalized error | Void the hold | The provider's error; no charge |
| Provider errors halfway through the stream | Emit an error event and close | Void the hold | Partial output plus a visible error; no charge |
| Caller disconnects while upstream succeeds | Keep reading upstream | Settle the actual usage | No response now; the history shows the charge |
| Usage missing on a successful response | Open the circuit for that model after a threshold | Void the hold and record an internal write off | The response succeeds; no user charge |
| Postgres fails during final settlement | Write a deterministic settlement to a Redis stream backed by an append only file, and retry | The hold stays pending until the retry succeeds | The response completes |
| Postgres and the settlement spool both fail | Open the global gateway circuit | A sweeper voids the hold; internal write off | The response completes; later managed calls are briefly unavailable |
| Gateway process dies midstream | The stale request becomes ambiguous | A sweeper voids the hold after its deadline | The stream drops; the turn is retryable |
| Actual charge exceeds the hold | Settle the full actual amount | The balance may go negative; future calls are blocked | The response completed; the displayed balance shows zero |

Model calls that use a user's own provider key should not pass through this managed gateway in the
first version. That way a gateway outage does not break runs that users are already funding
themselves.

### 6.11 Abuse detection

Some limits are enforced mechanically before anything is dispatched. Exactly one allowed model per
token. Exactly one route. One completion per request. Bounded request bytes, input context, output
tokens, and run duration. One concurrent request per managed run by default. Rate limits per
token, per organization, and per network address. A per run credit cap that sits below the
organization balance. No caller controlled cache resource. No caller controlled provider account,
project, location, or endpoint. Token expiry and immediate revocation. Rejection of any token use
after the run has ended.

Other patterns are detected behaviourally: the same token used from several networks, repeated
attempts to use a model that is not allowed, repeated disconnects after output has started, a
collapse in the cache hit rate for one organization, identical free tier behaviour across many
newly created organizations, repeated calls that request the maximum output, a high ratio of model
calls to user messages, and tool or sandbox loops that run right up to the run cap.

The automated response escalates in stages. First rate limit. Then revoke the run token. Then
suspend managed credits for the organization. Then require manual review. Purchases or lifetime
spend can later raise the limits, which follows the anti-abuse pattern OpenRouter uses and which
the competitor research recommends copying.

---

## 7. Which part of our system owns which piece of work

The controlling rule is short. The backend owns business policy and financial state. The gateway
owns the hot path of a model call. The Python SDK and the runner transport a resolved connection
and nothing more. The frontend only shows state the server calculated.

One clarification prevents a common misreading. The gateway runs as a separate process, but it
imports the same enterprise edition credit code as the backend. Saying that the backend owns the
ledger describes a code and data boundary. It does not mean the gateway makes an HTTP call to the
main API on every model request.

| Work | Owner | The boundary, and the alternative rejected |
|---|---|---|
| Decide whether an organization may receive a funded run | Backend API | `api/ee/src/core/credits` checks organization status, project access, campaign eligibility, balance, managed model policy, and abuse state. The SDK must not infer eligibility from an empty vault, because an empty vault does not imply a valid grant. |
| Mint the run token | Backend API | An internal authenticated endpoint generates 32 random bytes, stores only the digest and the scopes, and returns the plaintext once. The gateway must not mint tokens, because it does not own user sessions or project authorization. |
| Verify the run token | Gateway | The gateway hashes the bearer token, loads the row, and checks expiry, revocation, run, organization, model, request limits, and concurrency. Calling the backend API to verify every model request would add a second network dependency to every stream and would tie gateway availability to the main API process. |
| Resolve the connection the sandbox sees | Python SDK | The SDK asks the backend for a managed connection and returns an ordinary `ResolvedConnection` with `provider=openai`, `deployment=custom`, a reserved slug, the gateway base URL, the pinned model, and the run token in `OPENAI_API_KEY`. This extends the existing resolution seam instead of inventing a credential mechanism that only the runner knows about. |
| Carry the resolved connection into the sandbox | Runner | The runner writes the harness model configuration file, injects the token into the sandbox environment, removes stale configuration when a sandbox is reused, and fails closed when it cannot write the configuration. It never learns that the opaque value represents credits. |
| Publish and activate prices | Backend API | A pricing service validates and creates immutable rate cards, then switches the active pointer atomically. A price change is an authenticated administrative action. |
| Calculate a charge | Shared credit core, called by the gateway | A single `PricingService.price(usage, rate_card_id)` performs all the integer arithmetic. The gateway picks the rate card pinned to the token and supplies the raw usage. The frontend, the SDK, and the runner never reproduce a pricing formula. |
| Authorize and settle a model charge | Gateway, calling the shared ledger core | The gateway creates the hold before dispatch and settles it after usage arrives. The credit data access object performs the transaction and the row locking. An HTTP hop from gateway to main API is rejected, because the hold and the gateway request row must commit in one local database transaction. |
| Write immutable ledger records | Shared ledger service and data access object | Exactly four domain operations write transfers: grant, purchase, or award; authorize; settle or void; reverse or refund. Direct writes through the object relational mapper from routers, gateway handlers, background jobs, or administrative scripts are forbidden. |
| Measure model usage | Gateway | The gateway parses the provider's usage, its request identifier, and the cache, output, and reasoning token counts. The runner sees the downstream stream, but it must not become the billing authority. |
| Measure tool usage | The service that runs the tool, settling through the shared ledger | Agenta hosted tools already terminate in backend tool services, so those services know whether the tool succeeded and what the external action was. The runner may report attribution, but it does not decide the price. |
| Measure sandbox time | Runner measures, backend settles | The runner holds trustworthy start and stop timestamps from outside the user controlled sandbox, and emits idempotent lifecycle records. The backend prices the elapsed seconds and writes the debit. Code inside the sandbox must never report its own billable duration. |
| Balance and transaction endpoints | Backend API | `/credits/balance`, `/credits/transactions`, and `/credits/runs/{run_id}/cost` return the projections plus the immutable history. The frontend never sums transactions itself. |
| Show the balance and the cost of a run | Frontend | `web/ee` shows available, held, and recently spent credits. The conversation shows the settled cost next to the run that produced it. The competitor research is emphatic that the cost belongs next to the action rather than only on a billing page (`research/02-competitor-credit-products.md`, line 743). |
| Purchase checkout | Frontend and backend API | The frontend starts checkout and the backend creates the payment session. A signed payment webhook creates the purchase transfer, using the payment event identifier as the ledger idempotency key. The browser redirect never grants credits. |
| Contribution submission | Frontend and backend API | The frontend submits a claim with its evidence and the backend records the workflow status. Submitting creates no credits. |
| Approve an earned award | Backend API | An authorized reviewer approves a fixed award. The approval and the immutable award transfer commit together, keyed by the claim identifier and the award version. |
| Refund a purchase | Backend API | A verified payment refund event writes a reversing transfer and a refund lot. Support can start the refund at the payment provider, but support cannot edit a balance directly. |
| Support and administrative tools | Backend API plus `web/ee` | Administrative routes expose grant, award, refund, token revocation, hold release, organization freeze, transfer inspection, and reconciliation. Every mutation requires a reason, an actor, a case reference, and an idempotency key. |
| Reconcile against the provider | Backend job | A scheduled job compares gateway usage against the provider's billing exports and request identifiers. The gateway records the evidence. It does not decide how a discrepancy changes a customer balance. |
| Abuse detection | Gateway for request signals, backend for account policy | The gateway emits velocity, token reuse, request shape, and concurrency signals. The backend freezes eligibility or revokes an organization's tokens. |

### 7.1 How a managed connection is created

The SDK calls an internal endpoint of this shape:

```http
POST /internal/model-gateway/run-tokens
Authorization: Bearer <normal Agenta runtime credential>
Idempotency-Key: run:019...:model-connection

{
  "organization_id": "019...",
  "project_id": "019...",
  "run_id": "019...",
  "requested_model": "agenta-managed-default",
  "harness": "pi_core"
}
```

The backend replies:

```json
{
  "connection": {
    "mode": "agenta",
    "slug": "__agenta_managed_model"
  },
  "provider": "openai",
  "deployment": "custom",
  "model": "managed-model-v1",
  "endpoint": {
    "base_url": "https://model-gateway.example/v1"
  },
  "credential_mode": "env",
  "env": {
    "OPENAI_API_KEY": "agrt_..."
  },
  "expires_at": "2026-08-03T13:05:00Z"
}
```

The response names a product alias rather than the upstream model identifier. The gateway maps
that alias to the exact upstream model recorded on the token. A sandbox therefore cannot switch
to a more expensive model by editing the request body.

This fits the code that already exists. The SDK already resolves custom connections and carries
the secret separately, and the runner already writes a model configuration file in the OpenAI
completions dialect that refers to `$OPENAI_API_KEY` rather than embedding the key
(`prior-work/repo-findings.md`, line 52). The one change needed is a reserved identity for a
default funded connection, because the current default connection loses its slug and therefore
does not trigger the custom provider builder (`prior-work/revised-plan.md`, line 315).

### 7.2 Where the code lives

```text
api/ee/src/core/credits/
    types.py
    pricing.py
    service.py
    interfaces.py
    errors.py

api/ee/src/dbs/postgres/credits/
    dbas.py
    dbes.py
    dao.py

api/ee/src/apis/fastapi/credits/
    router.py
    models.py

api/ee/src/model_gateway/
    app.py
    auth.py
    request_policy.py
    upstream.py
    streaming.py
    usage.py
    abuse.py

api/entrypoints/model_gateway.py
```

Do not place the model gateway under `api/oss/src/core/gateway/`. That name already refers to
Agenta's tool and catalog gateway, and reusing it would create a permanent source of confusion
(`research/04-gateway-architecture.md`, line 680).

Both `api/entrypoints/routers.py` and the gateway entrypoint construct `CreditsService`,
`PricingService`, and `CreditsDAO`. The first exposes the product and administrative APIs. The
second exposes only the OpenAI-compatible model endpoint and the operational health endpoints.

### 7.3 What is open source and what sits behind the edition check

| Capability | Edition | Reason |
|---|---|---|
| The structured resolved connection, the custom OpenAI endpoint, the secret transport, and the runner's model configuration file | Open source | These are generic connection capabilities, useful to self-hosters, and they already live in open source code. |
| The reserved identity for a platform managed connection | Open source contract, with a neutral name | The SDK and the runner have to agree on the wire shape. The implementation stays provider neutral and contains no funding or cloud provider detail. |
| Ledger tables, rate cards, lots, purchases, awards, and balance endpoints | Enterprise edition | These implement the cloud product's money and promotions. A self-hosted user should not inherit unused financial schema or a mandatory billing subsystem. |
| Run token minting and the gateway token tables | Enterprise edition | They exist only to spend platform funded resources. |
| The model gateway process | Enterprise edition | Only cloud runs it. It should refuse to start when the edition check returns false. |
| Balance, purchase, earning, and administrative screens | `web/ee` | These screens have no valid open source backend. |
| Provider credentials, provider project identifiers, the active upstream models, the negotiated funding, and the infrastructure topology | Deployment secrets and database configuration only | None of this belongs in source, fixtures, screenshots, tests, pull request descriptions, or public documentation. |
| Generic gateway protocol tests | Open source where possible | Tests can use a fake provider and neutral names. Provider specific integration tests and configuration stay private. |

Putting a simplified ledger in the open source edition "for future reuse" is the wrong call. It
would impose migrations and maintenance on self-hosters with no open source product that needs
it. The generic seams belong in open source. The financial product belongs behind the edition
check.

---

## 8. Database migrations

Agenta already has an independent enterprise edition migration chain with its own
`alembic_version_ee` table. The local head is `ee0000000003`, so this work continues that chain
rather than touching the legacy or open source chains
(`api/ee/databases/postgres/migrations/core_ee/env.py:18` in the public Agenta repository).

### 8.1 The order of revisions

**`ee0000000004_credit_ledger_foundation`**, with `down_revision = "ee0000000003"`, creates
`credit_rate_cards`, `credit_rates`, `credit_pricing_state`, `credit_accounts`, and
`credit_transfers`, together with the balance check constraints on transfers, the triggers that
reject updates and deletes, and the indexes for idempotency, transfer sequence, account history,
source reference, and the active rate card.

This revision establishes the permanent unit and the permanent journal. It backfills no
organizations. An organization's wallet, funding, consumption, and expiry accounts are created
lazily, in one idempotent transaction, the first time that organization receives credits.

The migration must not create one globally shared funding or consumption account. Per
organization counterparties avoid a hot row and keep account locking local to a single customer.

**`ee0000000005_credit_lots_holds_usage`**, with `down_revision = "ee0000000004"`, creates
`credit_hold_states`, `credit_lots`, `credit_lot_balances`, `credit_lot_events`, and
`credit_usage_records`, plus the indexes for active lot spending order, unresolved holds, hold
expiry, and attribution by run, project, and provider.

This revision adds the machinery for expiring grants, preserving purchased credit,
authorize-then-settle, and the per request history a customer can see. Per charge attribution has
to exist before any public usage happens, because it cannot be reconstructed from aggregate burn
history afterwards (`research/03-project-openmeter-credit-engine.md`, line 621).

**`ee0000000006_model_gateway_runtime`**, with `down_revision = "ee0000000005"`, creates
`model_gateway_tokens`, `model_gateway_requests`, and `model_gateway_thought_signatures`, with
indexes on the token digest, active tokens, run, organization, request idempotency, unsettled
requests, and signature expiry.

**`ee0000000007_credit_award_claims`**, with `down_revision = "ee0000000006"`, is built only when
the contribution workflow ships. It creates `credit_award_claims` and `credit_award_reviews`, a
unique constraint on the pair of claim identifier and award version, the status and reviewer
queues, and metadata about the evidence rather than the uploaded content itself.

A claim is mutable workflow state. The award itself stays an immutable transfer and lot. Keeping
them apart is what stops an edit in the support workflow from rewriting money.

Purchases need no further ledger table. A verified payment webhook writes a transfer with a
source kind of `purchase` and an external reference such as `stripe:event:<event-id>`. The unique
idempotency constraint absorbs webhook retries. The existing subscription checkout code is a
useful integration seam, but credit packs need their own checkout product and their own webhook
branch rather than pretending to be subscriptions
(`api/ee/src/apis/fastapi/billing/router.py:106` in the public Agenta repository).

### 8.2 Seeding and activation

Rate card data is operational configuration, not schema. Do not bake live provider prices or
model names into a migration.

Deploy in this order. Run revisions 0004 through 0006. Deploy the backend and gateway code with
every route disabled by a feature flag. Create the first immutable rate card through an
idempotent management command. Verify its component rates and its multiplier, then point the
active pricing row at it in a single atomic step. Run shadow gateway traffic for internal
organizations. Compare the gateway's usage, its calculated charges, its cache counts, and the
provider's own reports. Enable manual grants and the balance display. Enable holds and real
debits for a small allowlist of organizations. Enable automatic grants at signup. Enable
purchases and awards only after the debit path has run cleanly.

The active pointer must never reference a rate card that is only half populated. Insert the card
and all of its rates in one transaction, and activate it in a later one.

### 8.3 What is reversible

| Change | Reversible before use? | Reversible after financial use? |
|---|---|---|
| Gateway operational tables | Yes | Yes, once tokens have expired and the request evidence has been exported |
| Award workflow tables | Yes | Yes, provided the immutable transfers remain |
| Indexes | Yes | Yes, subject to the effect on performance |
| The active pricing pointer | Yes | Yes, by pointing it at another immutable card |
| A rate card | It is never mutated; it can be left inactive | Do not delete it, because historical usage references it |
| Accounts, transfers, lots, lot events, usage records | Yes while they are empty | No destructive downgrade |
| The credit unit and its integer precision | Technically yes while empty | Effectively irreversible |

Once any grant, purchase, award, debit, expiry, or refund exists, the downgrade path must disable
the feature while leaving the financial tables in place. An Alembic `downgrade()` that drops the
historical credit tables would be data loss, so the production runbook must forbid it.

### 8.4 Columns included now because adding them later would be painful

Some of these fields are not needed to show a balance in the first version. They are included
anyway, because adding them later would either require a backfill that is impossible or a rewrite
of a very large table.

They are: the schema version on every immutable historical record; the unit code, even though
only one unit exists; the global monotonically increasing transfer sequence; the idempotency key
and the request fingerprint; the rate card identifier on every priced usage record; the raw
component counts for uncached input, cached input, cache writes, output, reasoning, tool units,
and sandbox seconds; the provider request identifier and the raw provider usage document; the
organization, project, run, session, and gateway request identifiers; the resource type and
resource identifier; the source kind, external reference, actor, reason, and support case
reference; the effective time, expiry time, priority, and the provenance of a voiding; four
account counters rather than one balance; the lot allocation events that link each debit to the
lots it consumed; the original transfer and lot references on a refund; the timestamps for when
the request was dispatched upstream and when the downstream client disconnected; and the basis on
which the settlement was made, which is one of `provider_reported`, `count_tokens`, `estimated`,
or `written_off`.

Dify's migration from a mutable provider counter into credit pools touched fourteen files before
it even added the stronger semantics we need (`research/03-project-dify.md`, line 668). Doing this
once, now, is much cheaper than doing it under pressure later.

---

## 9. The implementation plan

### 9.1 Probes to run before any production code

Each probe below produces a sanitized fixture or a private operational report, depending on
whether its output contains provider or infrastructure detail. Several of them can invalidate part
of the design, and that is the point of running them first.

| Probe | Method | What it can change |
|---|---|---|
| Non-streamed usage from the Vertex OpenAI-compatible endpoint | Send the same measured 24,000 token prefix twice and inspect the complete usage objects. | If cached token counts never appear, cache aware pricing cannot use this endpoint as designed. That invalidates the chosen upstream path until a native adapter or another authoritative source exists. |
| Streamed usage | Repeat with streaming and `stream_options.include_usage=true`, recording every event. | A missing final usage event does not invalidate the gateway, but it adds token counting work. Missing cache attribution does invalidate cache aware settlement. The research explicitly leaves this unverified (`research/01-gemini-and-caching.md`, line 815). |
| Implicit cache behaviour and lifetime | Repeat at 10 seconds, 30 seconds, 2, 5, 15, and 60 minutes. | If the second request does not hit, or if normal conversations fall below an 80 percent hit rate on the stable prefix, abandon implicit caching as the cost assumption for the first version. Use explicit caching or the native API before a broad launch. |
| Capture of a real harness request | Point the harness at a local fake chat completions endpoint and record the bodies and streams for plain text, a tool call, a tool result, and an error. | Establishes whether the harness streams, whether the gateway has to insert `stream_options`, which fields vary between calls, and whether tool identifiers stay stable. It can invalidate the thought signature design. |
| Thought signature round trip | Run a real Gemini tool call through the relay, let the harness drop the non standard field, restore it at the gateway, and execute the next call. | A 400 on the second call means the key or the restoration point is wrong. Gemini 3 cannot ship until this works, because Google requires the signature on subsequent calls (`research/01-gemini-and-caching.md`, line 338). |
| The default agent with a managed connection | Start from a new organization with an empty vault, the default agent, the Pi harness, and Daytona. Verify that the reserved connection writes the exact gateway base URL and token. | This can invalidate the SDK and runner integration estimate. It is the known gap in the current route. |
| Stability of the prompt prefix | Hash the normalized semantic prefix over the first three calls of representative conversations, comparing message order, tool order, schemas, and the upstream model and backend. | If the harness rebuilds or reorders the fixed prefix, no amount of gateway work preserves caching. The harness configuration has to change before launch. |
| Quality and tool use evaluation | Run the representative Agenta agent suite against the candidate managed models. | Selects the actual model. A cheap model that fails at tool use is not an activation feature. |
| Commercial confirmation | Obtain written confirmation that the intended model products, the caching products, and production usage all qualify under the applicable program and terms. | A negative answer invalidates the funding assumption, although the gateway and ledger remain reusable with a different funding source. |
| Capacity | Burst at the expected concurrency of the cohort and record latency, throttling, and cache behaviour. | Sets the initial concurrency caps and shows whether one provider project is operationally viable. |

### 9.2 The phases

**Phase 1, the ledger foundation and manual credits.** This delivers
migrations 0004 and 0005, the credit domain types, the pricing calculator, the ledger data access
object, the service operations and their invariants, lazy creation of accounts and lots, and the
grant, hold, settle, void, expiry, reverse, and refund operations. It delivers concurrency and
idempotency tests, manual administrative endpoints for granting and reversing, the balance and
transaction history endpoints, a command that reconciles the projections, tests for the
immutability triggers, and property tests proving every transfer balances.

This phase is deployable behind the edition check, and support can use it before any model traffic
exists.

It deliberately excludes the gateway, signup grants, purchases, contribution claims, tool
metering, sandbox metering, any Redis in the correctness path, and the customer facing balance
screens. Mixing payment and provider integration into the foundational ledger would make failures
much harder to isolate. The permanent data model and the concurrency behaviour come first.

**Phase 2, the gateway in shadow mode, once the probes pass.** This
delivers the separate gateway entrypoint and Compose service, opaque token verification with
scopes, revocation, request caps, and concurrency, upstream authentication, the relay for both
streamed and non streamed responses, request records with provider attribution, usage parsing and
immutable shadow usage records, rate card calculation that does not debit anyone, thought
signature storage and restoration, dashboards for cache hits and prompt prefix fingerprints, abuse
telemetry, and a global circuit breaker on dispatch.

Only internal organizations use it. The gateway calculates what each call would have cost. It
places no holds and debits no balances.

**Phase 3, the funded public cohort.** This delivers migration 0006,
the token minting endpoint, the SDK's managed connection resolver, the reserved connection
identity carried through the wire contract, updated golden fixtures for the runner and SDK, the
atomic hold before dispatch, settlement or voiding on every termination path, the sweeper for
stale holds, creation of the signup grant, hard caps per run and per organization, the balance,
pending amount, and per run cost in `web/ee`, the product states for a zero balance and a
temporary failure, and the cohort allowlist with emergency disable controls.

This is the first public experiment. For the enabled cohort, the wall that asks a new user to
connect a provider disappears.

**Phase 4, operational hardening.** This delivers the reconciliation
report between provider and gateway, the tooling and approval checks for activating a price card,
the Redis settlement spool backed by an append only file, automatic release of stale requests and
holds, alerts for cache hit regression, negative balances, projection drift, delayed settlement,
and usage that arrived with no price, a support console for transfers, lots, holds, requests,
token revocation, and account freezing, and failure injection tests covering database loss,
provider timeout, gateway restart, and client disconnect.

A broad rollout to all signups waits for this phase.

**Phase 5, credit purchases.** This delivers one time credit pack
checkout, signed webhook handling, purchase transfers keyed by the payment event, receipts and
balance refresh, the path from a payment provider refund to a reversing transfer, the pack catalog
and purchase history, and the finance export and reconciliation.

Do not overload the existing subscription checkout. Reuse its authentication, its customer
records, its signature verification, and its portal, but give credit packs their own product and
their own webhook semantics.

**Phase 6, contribution earnings.** This delivers migration 0007, the
submission form and evidence records, a fixed award catalog with versions, a reviewer queue with
two person approval above a configurable threshold, the award transfer with a twelve month lot
expiry, rejection, withdrawal, duplicate detection, clawback, and audit history, and reporting by
campaign and by contributor.

The first version is manual on purpose. The research found little evidence that competitors'
contribution credit programmes stay stable, so we should expect to iterate before automating
payouts (`research/02-competitor-credit-products.md`, line 861).

**Phase 7, tools and sandbox compute.** This delivers rate card
components for tool actions and sandbox seconds, a charging client interface shared by the API
services, tool authorize and settle integration, runner lifecycle usage events with durable
idempotency, periodic settlement of sandbox time for long sessions, a combined cost breakdown per
run, and reconciliation for timeouts and abandoned sandboxes.

The ledger, the lots, the unit, and the pricing code do not change. These are new charging
clients.

---

## 10. Guarantees the first version gives up

The first version keeps the guarantees that protect the journal and the race for the last credit.
It gives up availability, some reconciliation, and some guarantees at the provider boundary.

| Property relaxed | Worst outcome, and its bound | Why that is acceptable now | What restores it |
|---|---|---|---|
| One gateway host or process group | Every platform funded model call fails during a host or deploy outage. Runs using a user's own key are unaffected. No credits are lost, because a call that never dispatched has no debit. | The experiment can tolerate minutes of downtime on the funded tier. It cannot tolerate uncontrolled provider spend. | Run at least two gateway replicas on separate hosts behind a health checking load balancer, sharing Postgres and Redis, and deploy with connection draining. |
| Database availability during authorization | The gateway fails closed before dispatch, so the whole funded cohort is temporarily unavailable. | Financial authorization cannot safely fall back to a cached balance. An outage on activation is better than uncontrolled spend. | Highly available Postgres, tested failover, bounded connection pools, and a readiness check that removes unhealthy replicas. |
| Exactly one provider invocation | If the connection dies after dispatch but before the provider responds, the gateway cannot prove whether the provider ran. It does not retry automatically. A user retry may cause a second call. | Most providers do not offer a portable idempotency guarantee for generation. Automatic retry produces the more expensive failure. | Use provider request idempotency where it exists, store dispatch identifiers, and add provider specific retrieval and reconciliation. There is no fully general solution. |
| A perfect hold estimate | The actual cost can exceed the hold and drive the wallet negative. With one active request per token and an initial organization concurrency cap of three, the exposure is at most three times the per call underestimate. | The measured workload implies roughly $0.001 to $0.05 per call across the candidate models and cache outcomes. With the output and concurrency caps in place, the loss is cents rather than an unbounded deficit. | Improve provider specific estimation, reserve the uncached maximum when the balance is low, resize the hold during generation, or authorize output in chunks. |
| Settlement durability during a compound failure | If both the Postgres settlement and the Redis spool fail after the upstream call completed, we may write off that call. | The gateway opens its dispatch circuit after three consecutive settlement failures or one dollar of aggregate unsettled estimated exposure, whichever comes first. That bounds the loss while keeping the implementation small. | Add a durable queue with producer acknowledgements, a separate settlement worker, and reconciliation by provider request. |
| Immediate recovery of orphaned holds | A crashed gateway can leave credits held until the sweeper runs. A user may see an insufficient balance for up to 15 minutes. | The hold is durable and discoverable, unlike LiteLLM's process local hold state, which can stay leaked indefinitely under traffic (`research/03-project-litellm-proxy.md`, line 616). A temporary denial is recoverable. | Run the sweeper continuously with a lease, shorten the expiry using provider request status, and give support a way to release a hold. |
| Deterministic implicit cache hits | A repeated prefix can miss even when we preserve it correctly. The measured scenario of 30 messages and three calls moves from about $0.75 to $3.54 on the cited model, which is 4.7 times more (`research/01-gemini-and-caching.md`, line 201). Users also burn credits faster, because charges follow the real cache attribution. | Implicit caching needs no storage workflow and gives about a 90 percent discount on cached input when it hits (`research/01-gemini-and-caching.md`, section 2). A cohort rollout can measure whether it is reliable enough. | Create explicit cache resources, pin conversations to a cache identifier and a provider backend, manage expiry and cleanup, and price cache creation and storage separately. |
| Reconciliation against the provider invoice | Gateway usage can differ from the eventual bill through missing requests, differences in the provider's accounting, or a price error. The largest unobserved loss is roughly one reconciliation interval of traffic times the discrepancy. | The immutable usage record and the provider request identifier preserve the evidence. A daily manual comparison is enough for the first cohort. | Import the billing exports, match on request and product dimensions, produce discrepancy entries, and block activation of a rate card when reconciliation exceeds a tolerance. |
| Automatic price synchronization | A provider price change can leave us underpriced until an operator publishes a new card. The loss is the traffic during the stale interval times the price difference. Existing user history stays correct under its pinned card. | Provider prices change far less often than requests arrive, and immutable manual cards are safer than an unreviewed scraper. | Daily ingestion from the primary source, generated candidate rate cards, automated differences, human approval, and activation at an effective time. |
| Immediate expiry in the projection | An expired grant can stay visible until the next balance read or sweep. Authorization applies expiry lazily before spending, so the value cannot actually be consumed. | The failure is a stale display, not overspending. | Continuous scheduled expiry processing and push invalidation of the frontend's balance query. |
| Charging for partial provider failures | If the provider emitted useful tokens and then failed before a valid terminal usage record, we release the hold and pay for that call ourselves. | Charging for an errored result creates distrust out of all proportion to the money. The competitor research specifically recommends a written policy that failed actions are not charged (`research/02-competitor-credit-products.md`, line 759). The loss is capped at one call. | Provider specific reconciliation of partial usage could charge for delivered output. Changing the product promise is not recommended. |
| Failover between providers | An upstream outage stops funded model calls. The gateway does not silently move a live conversation to another project, region, or model. | Failover destroys cache locality, changes model behaviour, and multiplies cost. The research recommends conversation affinity before multiple backends (`research/04-gateway-architecture.md`, line 1238). | Add explicit backend pools, health state, conversation affinity, compatible model mappings, and a cache aware failover policy. |
| Sophisticated prevention of signup abuse | Someone can create several organizations or accounts and consume several grants. The direct loss per accepted identity is bounded by the grant, the model allowlist, the run cap, and the concurrency cap. | Filtering too hard early can suppress the very activation signal the experiment exists to measure. | Add verified email and domain reputation, device and payment fingerprints, address velocity, graph analysis, staged grants, and manual review. |
| Automated detection of contribution fraud | Reviewers can approve low quality, duplicated, or collusive claims. The loss is bounded by the award catalog and the campaign cap. | The first earning programme needs product learning more than it needs automation. Manual approval produces better evidence. | Similarity detection, provenance checks, separation of reviewers, reputation, claim limits, and delayed or revocable awards. |
| Formal financial audit tooling | Support relies on internal administrative views and reconciliation queries rather than a certified accounting export. | Credits are a closed product unit, not cash and not a bank balance. The immutable double entry records still preserve the audit trail. | Add a period close, signed exports, separation of roles, approval policies, and external audit controls. |

The following guarantees are not relaxed. Every posted movement of value is an immutable
balanced transfer. Two requests cannot both authorize the last available credit. Durable database
uniqueness prevents duplicate grants, purchases, awards, holds, settlements, and refunds. The
provider credential never enters the sandbox. A token cannot select an organization, run, model,
rate card, or output limit that was not approved. A new request cannot spend a negative or
exhausted balance. Every historical charge keeps the exact rate card and usage basis that priced
it. Redis is never the source of truth for a balance or for idempotency.

---

## 11. The decisions, with the options and the reasons

### 11.1 Unit, accounting, and product model

| Decision | Options considered | Trade offs | Choice and reason |
|---|---|---|---|
| The public unit | A dollar balance; a token; an action count; an abstract floating unit; a fixed value credit | Dollars imply cash-like expectations. Tokens cannot price tools or compute. Action counts expose us to inflation in our own agent's effort. Floating units allow silent devaluation. | One credit permanently equals $0.001 of priced usage value. It spans every resource and stays legible and stable. |
| Internal precision | Whole credits; decimal or numeric; floating point; integer millicredits | Whole credits over-round small actions. Decimal is exact but slower and easier to handle inconsistently. Floating point cannot preserve financial equality. | Signed 64 bit integer millicredits, where one millicredit equals $0.000001. |
| Rounding | Per token component; per model call; per user message; keep fractions forever | Component rounding systematically overcharges. Message rounding cannot settle independent calls. Endless fractions complicate reconciliation. | Sum the exact integer component costs and round upward once, at the boundary of a billable action. |
| Resource model | Separate quotas for model, tool, and sandbox; one pooled balance | Separate quotas are locally simple but strand value and produce confusing product rules. | One balance, with resource specific components on the immutable rate card. |
| Ledger representation | A mutable balance counter; append only single entries; double entry transfers; an external ledger product | A counter loses provenance. Single entries weaken the invariants. An external ledger adds another service and another operational model. | Immutable double entry transfers in the Postgres we already run. |
| Counterparty accounts | Global funding and consumption accounts; per organization counterparties | Global accounts create hot rows and cross customer deadlocks. Per organization accounts add rows. | A wallet, funding, consumption, and expiry account per organization. |
| How the balance is read | Sum all history; a snapshot plus a tail; a materialized projection; a Redis counter | Running sums degrade as history grows. Snapshot logic is complex. Redis is not durable. | Four Postgres counters on each account, updated in the same transaction as the immutable transfer, and reconciled continuously. |
| Concurrency control | Check in the application then write; a Redis lock; a serializable transaction; row locks in a fixed order | Check then write races. Redis introduces a second authority. Serializable isolation aborts unrelated work. | Lock the account and lot rows in a deterministic order inside one Postgres transaction. |
| Unknown cost | Charge afterwards; a fixed flat charge; charge the maximum; hold then settle | Charging afterwards permits overspend. A flat charge misprices cache and output. Holding the maximum rejects calls the user could afford. | A cache aware estimate, a durable hold, settlement at the actual amount, and release of what was not used. |
| The actual cost exceeds the hold | Reject the settlement; cap the debit at the hold; permit a negative wallet | Rejecting or capping hides real consumption. Permitting a negative balance creates a bounded deficit. | Settle the actual amount, allow the projection to go negative, and block further work. |
| Credit expiry | Nothing expires; everything expires; expiry depends on the source | Never expiring makes promotional liability permanent. Expiring purchased credit is hostile. | Promotional grants expire on the campaign's date, earnings expire after twelve months, purchases never expire. |
| What the user sees | Several public balances; one public balance with internal lots | Several balances expose the burn rules and confuse support. One balance hides provenance if the history is weak. | One public balance, internal lots, and an explicit transaction history that names the source. |
| Order of spending | Purchased first; oldest first; cheapest liability first; configurable priority plus expiry | Spending purchased credit first destroys paid value. Age alone mishandles expiry. | Expiring promotional and earned lots first and purchased last, ordered by priority, expiry, creation time, then identifier. This follows the three key approach the OpenMeter research describes (`research/03-project-openmeter-credit-engine.md`, line 730). |
| Charging for failures | Charge the actual provider cost; charge for delivered output; never charge a failed call | Charging protects margin but turns technical failures into billing disputes. | Our own or the provider's technical failures are free. An upstream call that completed successfully is charged even if the user disconnected. |
| Refunds | Edit or delete the original debit; adjust the balance directly; write a reversing transfer | Mutation destroys the audit trail. Direct balance edits bypass the lots. | An immutable reversing transfer plus a refund lot linked to the original movement. |

### 11.2 Gateway and model integration

| Decision | Options considered | Trade offs | Choice and reason |
|---|---|---|---|
| Where enforcement lives | A provider key in the sandbox; a route in the main API; a separate gateway; an existing proxy | Real credentials can be extracted. The main API shares the blast radius of long streams. Adopting a proxy imports accounting assumptions that do not match ours. | A separate Agenta gateway service that holds the real credential. |
| Build or adopt LiteLLM | Adopt it; fork it; build a narrow forwarder | LiteLLM offers breadth across providers, but its budget semantics live in process memory and Redis and do not meet a durable balance requirement. Forking inherits its whole surface. | Build the single chat completions route we need. Use external registries only as an input to rate cards. |
| The form of the token | A real provider key; a long lived virtual key; a signed token carrying claims; an opaque short lived token | Verifying a signed token is cheap, but immediate revocation still needs state. A long lived key is worth more when leaked. | An opaque 256 bit token per run, with only the digest stored, a short expiry, and a database check on every call. |
| The scope of the token | Organization only; project; run; one model request | An organization token is too valuable when leaked. A per request token complicates a multi call agent turn. | Scope it to organization, project, run, model alias, rate card, body and output caps, concurrency, and a credit ceiling for the run. |
| The upstream dialect | Translate to native Gemini; use the OpenAI-compatible Vertex endpoint; change the runner's dialect | Native Gemini gives full features but creates a large surface of streaming and tool translation. Changing the runner is real work. | Keep OpenAI chat completions end to end and use Vertex's compatible endpoint, subject to the cache and usage probes (`research/01-gemini-and-caching.md`, section 3). |
| Thought signatures | Make the harness preserve extension fields; relay them in the gateway; avoid Gemini 3 tool use | Changing the harness ties the feature to one harness and still needs provider specific handling. Avoiding tools defeats the product. | The gateway records and restores signatures, keyed by run token and tool call identifier. |
| The streaming relay | Buffer the whole response; parse and re-serialise every event; relay bytes with a parser tee | Buffering destroys time to first token. Re-serialising raises the risk of a compatibility bug. | Relay upstream bytes as they arrive while a side parser inspects a small tail and the usage events (`research/04-gateway-architecture.md`, section 7). |
| The source of usage numbers | The runner estimates; the gateway tokenizes; the provider reports; the billing export | The runner has no authoritative cache counts. Tokenizing locally cannot know about cache hits. Exports arrive too late. | The provider's reported usage is primary. Counting or tokenizing is marked as a fallback. The billing export reconciles later. |
| Missing usage on a stream | Refuse to stream; charge the estimate; count tokens ourselves; use the native API | Refusing streams breaks the experience. Estimates can misprice caching. Local counting may not match the provider's accounting. | Probe first. Use the provider's final usage where it exists. Otherwise move to a path that exposes cache counts before charging the public. |
| Mutating the prompt | Add attribution into system messages; add metadata into the body; keep identity out of the prompt entirely | Prompt changes can move or alter the repeated prefix and destroy caching. | Carry run identity in the token and in gateway state. Do not insert messages, reorder tools, rewrite schemas, or change the model or backend. |
| Cache strategy | Assume no cache; use the implicit cache; use explicit caches from day one | Pricing as if there were no cache wastes the dominant cost lever. Explicit caching adds lifecycle work and prompt partitioning. | The implicit cache for the measured cohort, with an 80 percent objective on the stable prefix. Explicit caching is the next step if the probe or the objective fails. |
| Cache aware routing | Round robin across provider backends; conversation affinity | Round robin looks like better balancing but destroys the cache hit rate on each backend. | Pin a conversation or run to one upstream project, region, model, and cache namespace. |
| When settlement happens | Asynchronously in a batch; after sending the completion marker; before it | Asynchronous settlement loses charges on a crash. Sending the completion marker first hides the failure. | Settle before releasing the final usage event and the completion marker, while streaming earlier content immediately. |
| A client that disconnects | Cancel upstream; keep reading upstream | Cancelling may not stop the provider billing us, and it loses the final usage. Continuing consumes output the user will not see. | Keep reading upstream, collect the usage, settle, and record that the downstream client disconnected. |
| Retry after a provider timeout | Retry automatically; never retry; let the user retry | Automatic retry can duplicate a request that is already running and already billable. | No automatic retry after dispatch. Return a typed retriable error and keep the same gateway idempotency record. |

### 11.3 Deployment and product boundaries

| Decision | Options considered | Trade offs | Choice and reason |
|---|---|---|---|
| Process topology | A router in the main API; a separate EC2 or Kubernetes stack; a separate Compose service | The main API couples long streams to product endpoints. Kubernetes is not our deployment model. | A separate Compose service, built from the same codebase and using the same database. |
| How the gateway reaches the ledger | HTTP from gateway to API; a shared library and database; an independent ledger in the gateway | HTTP adds latency and another failure mode. Duplicated ledger code will drift. | The gateway imports the credit core and data access object directly. |
| What Redis is for | The authoritative balance; a lock manager; rate limiting, caching, and spooling only | An authoritative Redis weakens durability. A distributed lock duplicates what a Postgres row lock already does. | Redis handles abuse velocity, caching, and the emergency settlement spool only. |
| Reusing the existing meter | Reuse the consumed credits counter; replace the meter system; reuse only its guarded SQL pattern | The existing meters are mutable periodic quotas. They cannot represent lots, purchases, attribution, or immutable transfers. | Build a separate credit ledger and reuse only the proven conditional SQL idea (`research/04-gateway-architecture.md`, section 6). |
| Product history | The balance only; an aggregate burn chart; a transaction per action | A balance alone creates support disputes. An aggregate chart cannot say which run spent the credits. | The balance plus immutable cost records per run, per tool, and per sandbox session. |
| How a purchase grants credit | The browser success redirect; creating the checkout; the verified webhook | A redirect can be forged or missed. Creating a checkout does not prove payment. | Only the signed payment webhook grants credits. |
| How much of earning is automated | Award automatically on submission; review manually; run an external cash programme | Automation invites fraud before the quality criteria are known. Cash brings payout regulation. | Versioned fixed credit awards after a manual review. |
| Edition placement | Everything open source; generic seams open source and the financial system in the enterprise edition; a private fork | Putting everything in open source burdens self-hosting. A private fork guarantees drift. | Generic connection contracts stay open source. The gateway, ledger, purchases, earnings, and screens stay in the enterprise edition. |
| How prices are updated | Mutable rows holding the current price; environment variables; immutable versioned cards | Mutable rows rewrite the meaning of history. Environment values are unaudited and cannot explain an old charge. | Immutable cards plus a single atomic active pointer. |
| Initial scope | Model, tool, sandbox, purchases, and earnings all at once; the ledger first and charging clients afterwards | A single large delivery delays learning and compounds failures. | Build the final ledger shape first, ship the model gateway next, then add the purchase, earning, tool, and compute clients. |

---

## 12. Questions only the founder can answer

### 12.1 What result makes the funded tier worth continuing?

The options are to optimize only for completing a first conversation, to optimize for
organizations still active after seven days, to optimize for conversion to a paid plan, or to use
a composite funnel with a ceiling on cost.

The recommendation is to define success as a statistically meaningful increase in the number of
organizations that complete a first agent conversation and come back within seven days, subject
to a maximum subsidy per retained organization. Fix the percentage lift, the cohort size, the
duration, and the point at which we stop, before launch. Without that, the system can meter spend
perfectly and still not tell us whether the spend worked.

### 12.2 How large is the signup grant, and how fast may it be spent?

The options are one large grant available immediately, small grants that refresh daily, or a small
initial grant followed by more after the user reaches an activation milestone.

The recommendation is to grant enough for one representative multi-turn conversation immediately,
then unlock a second tranche once the organization does something meaningful, such as saving an
agent or returning the next day. Put a hard ceiling per run on both tranches. That limits the
value of farming accounts without recreating the wall we are trying to remove.

The founder has to choose the actual credit amounts and the expiry of promotional credit.

### 12.3 Which model experience are we funding?

The options are the cheapest model that handles basic requests, one stronger default model, or a
cheap default plus a premium model that visibly costs more credits.

The recommendation is to launch with one model, specifically the least expensive candidate that
passes our real evaluation for tool use and instruction following. Do not offer a model picker
during the experiment. Add a premium choice only once users understand that models have different
prices.

### 12.4 What margin should the public rate card carry?

The options are to pass through the provider's public prices, to apply one uniform multiplier, or
to set a product price for each model and action independently.

The recommendation is a uniform multiplier of 1.25 applied to the externally priced resource
cost, with rounding at the action boundary, and with cache savings passed through to the user.
That pays for the gateway, sandbox orchestration, payment fees, errors, and unbilled partial
failures, while keeping the price explainable.

The fixed conversion of one credit to $0.001 must not change. Margin changes happen by publishing
a new rate card.

### 12.5 What credit packs do we sell?

The options are an arbitrary amount, a small set of fixed packs, or credits bundled only with a
subscription.

The recommendation is three fixed one-time packs, all at the same price per credit to begin with.
Purchased credits never expire and are spent after promotional and earned credits. Avoid volume
discounts until we understand real usage and support behaviour.

The founder has to set the denominations, the minimum purchase, the tax treatment, and the refund
policy shown to customers.

### 12.6 Which contributions deserve credits?

The options are discretionary awards, a published fixed catalog, negotiated sponsorships, or
automatic awards driven by views or installs.

The recommendation is a small versioned catalog covering accepted skills, technical articles, and
videos. Define the evidence required, the quality criteria, the maximum number of awards per
month, and a total cap for the campaign. Review manually. Do not pay on views, installs, or
submission alone, because those numbers are easy to manipulate.

### 12.7 Are credits transferable, refundable as cash, or redeemable elsewhere?

The options are transferable between organizations, redeemable for cash, usable only by the
organization that received them, or purchased credits refundable only through the original
payment.

The recommendation is that credits have no cash value, cannot be transferred, and cannot be
redeemed. Refund an eligible purchase only through its original payment transaction, then reverse
the corresponding unused or funded amount according to the published policy. That keeps the
ledger a product balance rather than a payment instrument.

### 12.8 What do customers using their own key pay credits for?

The options are nothing at all when they use their own model key, tools and sandbox compute only,
or an additional platform fee on every one of their model calls.

The recommendation is to charge zero model credits for calls funded by the user's own key for the
first six months, while still charging credits for Agenta funded tool calls and sandbox compute.
A surcharge on that traffic would confuse provider cost with platform cost and would discourage
the path that already works.

### 12.9 Do we make the failure policy a public promise?

The options are to leave it unspecified, to state that only successful actions consume credits,
or to charge for partially completed work.

The recommendation is to state clearly that technical failures on our side or the provider's side
do not consume credits, and that a completed model call is still chargeable if the user
disconnected after it was dispatched. Publish both rules together so the boundary is obvious.

### 12.10 How much friction against abuse is acceptable?

The options are signup with an email only, a verified email plus velocity limits, a payment method
required before any funded use, or an invitation-only rollout.

The recommendation is to start with a verified email, velocity limits by organization and network
address, staged grants, and a small cohort. Do not require a payment method before the first
conversation, because that recreates the activation wall. The founder has to choose which
countries are in scope, which regions are blocked, and what rate of false positives is
acceptable.

### 12.11 Has the intended provider usage been approved in writing?

The options are to rely on the programme's marketing language, to obtain written confirmation
covering production use, the eligible products, caching, and the proposed product behaviour, or
to postpone the funded tier.

The recommendation is that written confirmation is a launch requirement. Engineering cannot decide
commercial eligibility by observing how an API behaves.

---

## 13. Does the first version grow into the six month system?

Yes. The first version grows into it without replacing the credit unit, the journal, the balance
projection, the lot model, the idempotency scheme, the hold and settle protocol, or the pricing
model.

| Capability wanted in six months | What has to be added | What stays exactly as it is |
|---|---|---|
| Sell credits | One time checkout, a signed webhook, a receipt screen, and refund integration | The purchase transfer, the non-expiring lot, the balance projection, and the transaction history |
| Pay contributors in credits | A claim workflow, a review policy, an award catalog, and fraud controls | The award transfer, the expiring earned lot, source attribution, and reversal |
| Meter tool calls | Rates for tools, and calls to authorize and settle around hosted tool execution | The same wallet, rate card, usage record, hold, settlement, and per run history |
| Meter sandbox minutes | Lifecycle usage events and periodic settlement of long sessions | The same wallet, a time based rate component, and idempotent usage and settlement |
| Change margins or provider prices | Publish and activate a new immutable rate card | Old usage stays pinned to its original card |
| Add another harness | Another managed connection adapter that preserves that harness's streaming and tool metadata | The token, gateway, ledger, pricing, and balance |
| Add another model provider | An upstream adapter and a usage normalizer | Gateway authorization, the ledger, rate cards, and the product endpoints |
| Handle much more traffic | Replicas, a durable settlement queue, a highly available database, and affinity routing | The process boundary and the database schema |

Three outer components may still need substantial rebuilding.

The Pi specific connection adapter is the first. The generic managed connection contract survives,
but every new harness needs its own way of setting the base URL, the model, the token, the request
for streamed usage, and the provider extension fields.

The Vertex OpenAI-compatible upstream adapter is the second. If the probes show that it cannot
expose cached usage or cannot preserve the model's extension fields, we replace this adapter with
a translator that speaks Google's native format. That is a rebuild of one gateway adapter. It is
not a ledger migration and it is not a product migration.

The operational settlement path is the third. A Redis spool backed by an append only file is
acceptable for an experiment. Sustained paid volume should replace it with a durable queue and a
reconciliation worker.

The deployment topology also matures, from a small Compose service into several gateway hosts with
load balancing and database failover. That changes operations rather than domain boundaries.

One condition decides whether this answer holds. The design passes this test only if the team
implements the immutable transfer log, the usage attribution, rate card versioning, the four
counter projection, and internal lot allocation in the first release. If phase 1 is shortcut into
the existing consumed credits counter or into a mutable remaining balance column, the answer
becomes no. Purchases, expiry, contribution awards, refunds, and per run explanations would then
require taking the accounting system apart first. Dify's history shows exactly what that migration
costs, and we should not repeat it.

With the foundation described here, the work over the following six months consists of adding
charging clients and product workflows. The financial core stays where it is.
