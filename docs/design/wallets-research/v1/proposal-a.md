# Proposal A: credit system and model gateway

## 1. What this document decides

We want a person who signs up for Agenta cloud to run an agent immediately, on our money,
without connecting a provider key. We then want that same balance to become something people
buy, and something people earn by contributing to Agenta. Two systems have to exist for any of
that to work.

The first is a **gateway**. That means a service of ours that sits between the user's agent
container and the model provider. It holds the real provider credential, so the credential never
enters a container the user controls, and it decides per request whether to forward the call.

The second is a **ledger**. That means a balance per organization that we derive from a list of
entries we never edit. Credits arrive as grants, purchases, and earnings. Credits leave as debits
when someone consumes a model call, a tool call, or sandbox time.

This proposal answers, at the level a team can build from: what one credit is, how prices are
set, what the database looks like, how the gateway forwards a request without destroying prompt
caching, which part of our system owns which job, what we deliberately do not build first, and
what each shortcut costs to undo.

The short version of the design is this. One integer unit, micro-dollars, stored on every entry,
displayed to users as credits at a fixed rate of 1,000 micro-dollars to one credit. One
append-only entry table, with grants as separate rows so that promotional, earned, and purchased
credits can expire and burn in a defined order. One cached balance on the organization's account
row, kept correct by writing it in the same transaction as the entry. One conditional SQL
statement as the whole concurrency answer, copied from a pattern our metering system already runs
in production. A gateway that forwards the request body byte for byte, carries a hold before the
call, and settles the true cost afterwards.

The rest of this document builds that picture from the ground up.

---

## 2. The words used here

Read this once. Everything later depends on it.

A **token** is the unit language models bill in. Roughly four characters of English text make one
token. A **prompt** is everything you send the model on one call. Chat models re-send the whole
conversation on every call, so the same words get paid for over and over.

**Prompt caching** means the provider stores the processed form of a repeated beginning of a
prompt and charges much less when the next request starts with the same bytes. The repeated
beginning is called the **prefix**. Google discounts cached input tokens by 90 percent
(https://docs.cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview).
Caching only ever applies to a prefix, never to a passage in the middle.

A **dialect** is the request and response shape an API speaks. OpenAI's chat completions dialect
posts a `messages` array to `/v1/chat/completions` and returns `tool_calls`. Google's native
dialect uses `contents` and `parts` and carries the same ideas under different names. Our agent
runner speaks the OpenAI chat completions dialect and nothing else
(`services/runner/src/engines/sandbox_agent/pi-model-config.ts:120` fixes the value to
`"openai-completions"`).

**Streaming** means the model returns its answer a few words at a time so the user sees text
appear immediately. It uses **server sent events**, a plain HTTP response whose body is a
sequence of `data: {...}` lines that ends with the literal line `data: [DONE]`. Each such line is
a **chunk**.

**Usage** is the object a provider returns saying how many tokens the call consumed. In the
OpenAI dialect it looks like `{"prompt_tokens": 24000, "completion_tokens": 120}`, with a nested
`prompt_tokens_details.cached_tokens` when part of the input came from cache.

**Metering** means counting what someone consumed, so it can be charged. An **entitlement**
answers a different question: is this organization allowed to do this at all. We already have
both concepts in code (`api/ee/src/core/meters/`, `api/ee/src/core/access/entitlements/`).

A **ledger** is a list of entries that only grows. You never edit a row. A mistake is corrected
by adding a correcting row. The **balance** is not stored as the truth. It is the sum of the
entries, and any stored balance is a cache of that sum.

A **debit** is an entry that reduces a balance. A **credit entry** is one that increases it. A
**grant** is one deposit of allowance, for example "2,000 credits on signup, valid 90 days". A
system that keeps grants as separate rows instead of adding them all into one number is said to
use **credit lots**. Lots matter when grants expire on different dates or must be spent in a
particular order, which is exactly our case.

A **hold**, also called a reservation or an authorization, is value set aside before the true
amount is known. A fuel station holds a round number on your card, you pump an unknown amount,
and the station then **settles** for the true amount and releases the rest. That is our shape,
because we do not know what a model call costs until the response comes back.

**Idempotency** is the property that applying the same operation twice has the same effect as
applying it once. An **idempotency key** is an identifier the caller attaches to a write so the
database can recognise a repeat and refuse it.

**Reconciliation** means comparing our numbers against an outside record, such as the provider's
invoice, and explaining every difference.

A **virtual key** is a credential the gateway issues to a caller, which is not the provider's
credential. **Bring your own key** is the opposite arrangement, where the user supplies their own
provider credential and the model bill goes to them.

A **harness** is the agent runtime inside the sandbox that owns the system prompt, the skills,
and the tool definitions, and that makes the actual model calls. A **sandbox** is the isolated
cloud container the harness runs in. The user writes the agent instructions, so the user
effectively controls what runs in that container.

---

## 3. The requirements

### 3.1 What the first version must do

**Keep our provider credential out of the sandbox.** The user writes the agent instructions, and
an agent with a shell tool can print its own environment variables. Any credential we place in
that container is readable. Anything we write into a configuration file in that container is
advice, not a rule. Today the runner pins a run to one model by writing a per-run `models.json`
(`services/runner/src/engines/sandbox_agent/pi-model-config.ts:85`), and that pinning stops
honest users and shapes the product surface, but it does not stop somebody who reads the key and
calls a different model at the same base URL.

**Stop the spending when a balance runs out.** Nothing Google sells can do this for us. A Cloud
Billing budget with alerts does not cap usage; Google states plainly that alerts-only budgets
"don't automatically prevent the use or billing of your services"
(https://docs.cloud.google.com/billing/docs/how-to/budgets). Spend caps, which shipped in public
preview around July 2026, are a real hard limit but their smallest unit is one project, one
service, one calendar month, lifted by hand
(https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps). Gemini models on Vertex
have no fixed quota at all under dynamic shared quota
(https://docs.cloud.google.com/vertex-ai/generative-ai/docs/dsq). API key restrictions limit
which APIs a key may call, never how much it may spend
(https://docs.cloud.google.com/docs/authentication/api-keys). So the limit has to live on a
machine we own, in the path of every request.

**Count consumption in a way that is auditable.** A person whose free credits vanished in ten
minutes will ask which agent run did it. That question can only be answered by a per-charge
record that carries the run identifier, and that record cannot be backfilled after the fact.

**Give new organizations a balance automatically.** A signup grant, written once, with a rollout
control so we can fund ten percent of signups before funding all of them.

**Show the balance and the price of the last thing the user did.** Dust prints the credit cost of
each interaction inside the conversation (https://docs.dust.tt/docs/credits). That single
behaviour teaches an invented unit better than any definition, and nothing else in the comparable
product set does it.

**Refuse cleanly at zero.** The gateway returns a payment-required response and the product shows
a clear state with the connect-your-key path. Silence is the worst possible outcome, and we have
a known class of bug where an errored turn renders as an empty message
(`prior-work/revised-plan.md`, section 8).

**Break neither streaming nor prompt caching.** Our harness replays roughly 23,600 tokens of
context on every model call, and one user message with tool use typically causes two or three
calls. Caching is worth about 4.7 times on every Gemini 3 model, because Google prices cached
input at exactly one tenth of normal input across the lineup (`research/01-gemini-and-caching.md`,
section 2). Any design that breaks the repeated prefix makes the same conversation about five
times more expensive.

### 3.2 What the full system must eventually do

Sell credits for cash, with a payment record attached to the resulting grant. Pay contributors in
credits for a written skill, an article, or a video, with an approver and a reason recorded, and
with the ability to backdate the award to the date of the contribution. Meter tool calls and
sandbox minutes in the same unit as model calls. Expire grants on different dates and burn them
in a defined order, so a promotional grant disappears before a purchased one. Reconcile our
recorded consumption against the provider's invoice. Refund a charge when a run failed for our
reasons. Restate a period after a pricing change, without rewriting history. Serve more than one
provider account, with conversation affinity so a cache is never split.

### 3.3 A stated requirement I think is wrong

The brief describes the earning path as a growth engine. The design must support it, and this
proposal does. But the evidence says building it as an automatic mechanism first is a mistake.
Precedent for paying contributors in platform balance is thin and mostly discontinued.
Activepieces ran a rewards program from 2024 paying contributors for templates and connectors,
and a community member noted in August 2025 that the program was gone
(https://community.activepieces.com/t/introducing-rewards/3870). n8n rewards contributors with
status, distribution, and cash commission rather than usage balance
(https://n8n.io/affiliates/). We are ahead of the field here, not behind it.

So the requirement should be restated as: the ledger must make an earned credit
indistinguishable from a purchased one at the data layer, and the first version of the earning
path should be a human approving an award through an admin endpoint against a published award
schedule. Do not build contribution scoring. That is a one-line entry in the ledger and a
one-week product decision, and it can be automated later without touching the schema.

One more correction, smaller. The brief says the first version should be simple and fast to
build. It also says it must extend without a painful migration. Those pull against each other in
exactly one place, and I want to name it up front. Recording a running counter is simpler than
recording entries. Dify shipped a counter, then had to add credit pools, and could not backfill
them, because a counter cannot be split. The cost shows today as a permanent three-way fallback
branch in their provider manager and a class of tenant whose deduction lands nowhere
(`research/03-project-dify.md`, section "The move from a counter to credit pools"). Writing
entries from day one is the one place where we should spend the extra work rather than save it.

---

## 4. The credit unit

### 4.1 What one credit is

**One credit equals one tenth of a United States cent. One thousand credits equal one dollar.
That rate is fixed and we never change it.**

Internally the ledger stores integers of **micro-dollars**, meaning millionths of a dollar. One
credit is 1,000 micro-dollars. Every amount in the database is a `bigint` count of micro-dollars.
Every amount shown to a user is that number divided by 1,000 and labelled credits.

Two separate decisions are packed in there, so take them one at a time.

**Why an abstract credit rather than money in the display.** Money as the unit needs no teaching
and cannot be quietly devalued, and v0 and OpenRouter both use it successfully
(https://vercel.com/blog/updated-v0-pricing). It also publishes our cost basis at a moment when
our cost basis is unusual, and it makes a gift of balance look like a gift of cash, which invites
refund and transfer expectations. An abstract credit lets one number cover model calls, tool
calls, and sandbox minutes without exposing three price lists.

The whole risk of an abstract credit is that the vendor controls the conversion and can move it.
A pricing consultancy compares this to airline miles, which it says devalue at about 15 percent a
year (https://softwarepricing.com/blog/credit-based-pricing-ai/). Cursor's June 2025
redenomination produced a public apology and refunds
(https://cursor.com/blog/june-2025-pricing). We remove that risk by construction: fix the rate
once, state it on the pricing page, and treat it as immutable. What moves is the price list, and
a price list change is a visible price change rather than a hidden one.

**Why micro-dollars in storage.** Amounts must be integers, because floating point money produces
rounding bugs that nobody ever fully cleans up. OpenMeter carries a standing note about exactly
this in its own engine (`openmeter/credit/engine/run.go:274`, "calculations happen on inexact
representations as float64"). Cents are far too coarse: a cached model call on a small model
costs about 1,600 micro-dollars, which rounds to zero cents. Micro-dollars in a `bigint` give a
range of roughly plus or minus nine trillion dollars and make the smallest interesting charge a
three-digit number.

Storing money and displaying credits also gives us a property we want later. When we compare our
recorded consumption against Google's invoice, both sides are already in dollars. No conversion
step sits between our number and theirs.

### 4.2 How the price of an action is decided

Prices live in a **rate card**, meaning a versioned row of prices with an identifier. Every debit
records which rate card produced it. That single column is what lets us change prices later and
still explain an old charge.

A rate card holds three sections.

**Model rates**, per model identifier, in micro-dollars per million tokens, with five separate
numbers: input, cached input, cache write, output, and reasoning output. Five numbers rather than
one is not optional for us. A price table with a single input rate cannot express the difference
between a cached and an uncached prefix, and would misprice our workload by roughly a factor of
ten. OpenMeter's own model pricing structure carries exactly these five fields
(`openmeter/llmcost/llmcost.go:36-51`).

**Tool rates**, a fixed price per tool category. Following Dust, internal operations such as
memory and file handling cost nothing, ordinary actions cost a small number, and heavy external
integrations cost more (https://docs.dust.tt/docs/credits). Charging nothing for our own plumbing
is a pattern both Zapier and Gumloop follow, and users resent paying for structure while
accepting paying for capability (https://zapier.com/pricing).

**Sandbox rate**, a price per minute of sandbox time, rounded up to the next whole minute.

The arithmetic is integer only, so it is deterministic and testable:

```
cost_micro_usd = (quantity * rate_per_million + 500_000) // 1_000_000
```

Worked example, using Gemini 3 Flash Preview at published Vertex prices of $0.50 per million
input tokens, $0.05 per million cached input tokens, and $3.00 per million output tokens
(https://cloud.google.com/vertex-ai/generative-ai/pricing), and assuming we charge list price
with no margin for a moment. One model call with 23,500 cached input tokens, 100 fresh input
tokens, and 120 output tokens costs 1,175 plus 50 plus 360, which is 1,585 micro-dollars, or
about 1.6 credits. Three calls make one user message cost about 4.8 credits. A thirty-message
conversation costs about 143 credits, which is about fourteen cents.

The same call with a cache miss costs 11,800 plus 360, which is about 12 credits. So caching
shows up directly in the number the user sees, which is honest and is also a competitive fact
worth naming on the pricing page.

Our own rate card should sit above cost, and the multiple is a business decision listed in the
open questions. The arithmetic above is what the machine does; the numbers in the card are what
we choose.

### 4.3 How three different things share one unit

Everything is priced into micro-dollars first and displayed as credits second. A model call is
priced from its token counts. A tool call is priced from its category. A sandbox minute is priced
from its duration. Three formulas, one output unit, one balance.

This is the split Relevance AI uses, separating what the platform did from what the model
provider charged, and it is what makes bring your own key a clean subtraction rather than a
special case (`research/02-competitor-credit-products.md`, section 5). A user who connects their
own model key has the model line go to zero. The tool line and the sandbox line keep running.

### 4.4 The alternatives, and why they lose

**A count of user actions, for example one credit per agent message.** This is the most legible
option available and it was what our earlier plan assumed. It fails now for a specific reason:
our own harness decides how many model calls a user message causes. Under an action count, every
capability improvement we make is a silent price increase that we absorb. Replit lived that
exactly. After a more autonomous agent shipped in September 2025, users reported bills jumping by
an order of magnitude, with one saying "I spent $1k this week alone" against a previous average
of $180 to $200 a month (https://www.theregister.com/2025/09/18/replit_agent3_pricing/). Nothing
about their price list changed. The agent simply did more work per sentence. For a free tier we
fund ourselves, that exposure is unbounded.

**A flat number of credits per model call, priced per model.** This is Dify's choice
(`api/configs/feature/hosted_service/__init__.py`, `HostedCreditConfig.get_model_credits`) and
Activepieces' choice, and it is genuinely attractive: the price is known before the call runs, so
the check and the charge collapse into one statement and the entire hold problem disappears. It
loses because it cannot see the one number that dominates our cost. A call whose 23,500 token
prefix hit the cache and a call whose prefix missed differ by about eight times in real cost and
would be priced identically. We would be blind to our largest cost lever inside our own billing
data. Note that adopting it later remains cheap, because a rate card can express a constant, so
this is a choice we can revisit without a migration.

**Pure money as the displayed unit.** Honest, needs no teaching, and rejected for the reasons in
section 4.1.

**A separate unit per resource, for example prompt credits and flow credits.** Windsurf ran two
balances and removed one, and users still checked whether the collapse was revenue neutral
(https://geekflare.com/news/windsurf-made-its-pricing-plans-a-lot-simpler/). Lovable runs three
pools with three different expiry rules and it is a permanent support burden
(https://docs.lovable.dev/introduction/plans-and-credits). One unit, one balance.

---

## 5. The ledger design

### 5.1 The shape, in one paragraph

Six tables. An **account** per organization holding three cached counters. A **grant** row per
arrival of credits, immutable, with a priority and an optional expiry. An **entry** row per
movement, append only, carrying the raw measurement and the rate card that priced it. A **hold**
row per reservation, which is the only mutable state in the design and the guard against settling
twice. An **allocation** row saying which grant a debit came out of, which is what makes the
question "why is my balance this" answerable per run rather than per period. A **rate card** row
per version of the price list. A seventh table, a daily rollup, is derived and comes later.

The balance is the account's three counters, and it always equals a sum over the entries. Writing
both in one Postgres transaction is what keeps that true.

### 5.2 The schema

```sql
-- ---------------------------------------------------------------------------
-- One row per version of the price list. Rows are never edited; a price
-- change writes a new row and retires the old one.
-- ---------------------------------------------------------------------------
CREATE TABLE credit_rate_card (
    id           text        PRIMARY KEY,        -- 'v1', 'v2-2026-11'
    effective_at timestamptz NOT NULL,
    retired_at   timestamptz,
    -- { "models": { "gemini-2.5-flash": { "input_per_million": 300000,
    --                                     "cached_input_per_million": 30000,
    --                                     "cache_write_per_million": 0,
    --                                     "output_per_million": 2500000,
    --                                     "reasoning_per_million": 2500000 } },
    --   "tools":  { "internal": 0, "default": 2000, "web_search": 10000 },
    --   "sandbox": { "per_minute": 3000 } }
    rates        jsonb       NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- One row per organization. The only mutable row in the design apart from
-- credit_hold. All three counters are caches of a sum over credit_entry;
-- section 5.3 gives the query that proves them.
-- ---------------------------------------------------------------------------
CREATE TABLE credit_account (
    organization_id  uuid        PRIMARY KEY,
    -- Left open on purpose so a second unit is possible without a migration.
    -- v1 only ever writes 'micro_usd'.
    unit             text        NOT NULL DEFAULT 'micro_usd',
    posted_credits   bigint      NOT NULL DEFAULT 0 CHECK (posted_credits >= 0),
    posted_debits    bigint      NOT NULL DEFAULT 0 CHECK (posted_debits  >= 0),
    pending_debits   bigint      NOT NULL DEFAULT 0 CHECK (pending_debits >= 0),
    -- 'hard_stop' refuses a call that does not fit. 'allow_negative' lets it
    -- through and records the deficit. Per organization, not a constant in code.
    spend_policy     text        NOT NULL DEFAULT 'hard_stop'
                                 CHECK (spend_policy IN ('hard_stop','allow_negative')),
    closed           boolean     NOT NULL DEFAULT false,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- One row per arrival of credits. Immutable except for voided_at.
-- No "amount remaining" column: the remainder is amount minus its allocations.
-- ---------------------------------------------------------------------------
CREATE TABLE credit_grant (
    id                 uuid        PRIMARY KEY,
    organization_id    uuid        NOT NULL REFERENCES credit_account (organization_id),
    amount             bigint      NOT NULL CHECK (amount > 0),   -- micro-dollars
    -- 'signup' | 'promotion' | 'purchase' | 'contribution' | 'support'
    source             text        NOT NULL,
    -- Lower burns first. v1 defaults: signup 10, promotion 20,
    -- contribution 50, purchase 100, support 100.
    priority           smallint    NOT NULL DEFAULT 100,
    -- v1 always sets this to now(). The column exists so scheduled and
    -- backdated grants need no migration later.
    effective_at       timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz,                                -- NULL = never
    voided_at          timestamptz,
    -- Stripe payment intent, contribution URL, campaign name, approver.
    external_reference jsonb,
    note               text,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX credit_grant_burn_order
    ON credit_grant (organization_id, priority, expires_at NULLS LAST, created_at, id)
    WHERE voided_at IS NULL;

CREATE INDEX credit_grant_expiry_sweep
    ON credit_grant (expires_at)
    WHERE expires_at IS NOT NULL AND voided_at IS NULL;

-- ---------------------------------------------------------------------------
-- Append only. Never updated. Never deleted. A mistake is a new row.
-- ---------------------------------------------------------------------------
CREATE TABLE credit_entry (
    -- Chosen by the caller before the work starts, so a retry reuses it.
    id               uuid        PRIMARY KEY,
    organization_id  uuid        NOT NULL REFERENCES credit_account (organization_id),
    direction        text        NOT NULL CHECK (direction IN ('credit','debit')),
    amount           bigint      NOT NULL CHECK (amount >= 0),     -- micro-dollars
    -- 'single' moves value now. 'hold' reserves it. 'settle' resolves a hold
    -- for the true amount; a settle of 0 is a release.
    phase            text        NOT NULL CHECK (phase IN ('single','hold','settle')),
    hold_id          uuid        REFERENCES credit_entry (id),     -- set on 'settle' only
    -- 'model_call' | 'tool_call' | 'sandbox_time' | 'grant' | 'purchase'
    -- | 'contribution' | 'grant_expired' | 'correction' | 'refund'
    code             text        NOT NULL,
    grant_id         uuid        REFERENCES credit_grant (id),     -- set on credit entries
    -- Attribution. Cannot be backfilled, so it is here from day one.
    run_id           uuid,
    project_id       uuid,
    -- The idempotency key. 'model_call:<gateway request id>',
    -- 'purchase:<stripe payment intent>', 'grant_expired:<grant id>'.
    idempotency_key  text,
    -- Which price list produced `amount`. Without this, restating history
    -- after a price change is impossible.
    rate_card_id     text        REFERENCES credit_rate_card (id),
    -- The raw quantities, so the price can be recomputed later:
    -- {"model": "...", "input_tokens": 24000, "cached_input_tokens": 23500,
    --  "cache_write_tokens": 0, "output_tokens": 120, "reasoning_tokens": 0}
    measurement      jsonb,
    -- 'provider' when the numbers came from the provider's usage object,
    -- 'estimate' when we counted them ourselves.
    metered_by       text        CHECK (metered_by IN ('provider','estimate')),
    reference        jsonb,      -- trace id, invoice id, approver, free text
    created_at       timestamptz NOT NULL DEFAULT now(),
    CHECK (phase <> 'settle' OR hold_id IS NOT NULL),
    CHECK (phase <> 'hold'   OR direction = 'debit')
);

-- The whole double-charge defence. Partial so that NULL means "no idempotency
-- requested" and does not collide with other NULLs.
CREATE UNIQUE INDEX credit_entry_idempotency
    ON credit_entry (organization_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX credit_entry_org_time ON credit_entry (organization_id, created_at DESC);
CREATE INDEX credit_entry_run      ON credit_entry (run_id) WHERE run_id IS NOT NULL;
CREATE UNIQUE INDEX credit_entry_one_settle_per_hold
    ON credit_entry (hold_id) WHERE hold_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- One row per hold. The hold's own entry stays immutable; the status lives
-- beside it. This separation is what makes "resolve exactly once" a single
-- guarded update.
-- ---------------------------------------------------------------------------
CREATE TABLE credit_hold (
    entry_id        uuid        PRIMARY KEY REFERENCES credit_entry (id),
    organization_id uuid        NOT NULL REFERENCES credit_account (organization_id),
    status          text        NOT NULL
                                CHECK (status IN ('pending','settled','expired')),
    expires_at      timestamptz NOT NULL,
    resolved_by     uuid        REFERENCES credit_entry (id),
    resolved_at     timestamptz
);

CREATE INDEX credit_hold_sweep ON credit_hold (expires_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Which grant a debit came out of. The sum of a debit's allocations may be
-- LESS than the debit amount; the difference is uncovered consumption.
-- ---------------------------------------------------------------------------
CREATE TABLE credit_allocation (
    entry_id  uuid   NOT NULL REFERENCES credit_entry (id),
    grant_id  uuid   NOT NULL REFERENCES credit_grant (id),
    amount    bigint NOT NULL CHECK (amount > 0),
    PRIMARY KEY (entry_id, grant_id)
);

CREATE INDEX credit_allocation_grant ON credit_allocation (grant_id);

```

Two columns deserve a note because they look optional and are not. `measurement` is the raw token
counts on every debit. Without it, a price change means we can never restate an old charge, and a
customer dispute becomes an argument. `run_id` is the attribution. OpenMeter's burn-down history
can say which grant was drained and when, and cannot say which request did it
(`research/03-project-openmeter-credit-engine.md`, section "Is it enough to answer a customer
asking why their balance is what it is"). Neither column can be backfilled.

### 5.3 How a balance is produced

The fast read is one row:

```sql
SELECT posted_credits - posted_debits - pending_debits AS available
  FROM credit_account
 WHERE organization_id = $1;
```

The counters are a cache. The truth is this query, which must always agree with them:

```sql
SELECT
  coalesce(sum(e.amount) FILTER (
      WHERE e.direction = 'credit' AND e.phase = 'single'), 0)  AS posted_credits,
  coalesce(sum(e.amount) FILTER (
      WHERE e.direction = 'debit'  AND e.phase IN ('single','settle')), 0) AS posted_debits,
  coalesce(sum(e.amount) FILTER (
      WHERE e.phase = 'hold' AND h.status = 'pending'), 0)      AS pending_debits
  FROM credit_entry e
  LEFT JOIN credit_hold h ON h.entry_id = e.id
 WHERE e.organization_id = $1;
```

TigerBeetle makes the same choice, and its reasoning is worth repeating because the instinct runs
the other way. Storing the balance is not the sloppy option and recomputing it on every read is
not the rigorous one. The rigorous option is to store the balance, write the entry in the same
transaction, and keep the entries so that the stored number can be proven
(`research/03-project-tigerbeetle.md`, section "How a balance is produced").

The reconciliation job that runs the second query nightly and alerts on any mismatch is roughly
twenty lines. It arrives in Phase 3.

The remaining amount on one grant is likewise derived:

```sql
SELECT g.amount - coalesce(sum(a.amount), 0) AS remaining
  FROM credit_grant g
  LEFT JOIN credit_allocation a ON a.grant_id = g.id
 WHERE g.id = $1
 GROUP BY g.amount;
```

### 5.4 How a charge is made safe against being applied twice

Every write carries a caller-chosen identifier, and the database refuses the second one. There
are two layers, and both are needed.

The entry's primary key is chosen by the caller before the work starts, so a retry that reuses it
collides on the primary key rather than inserting a second row. On top of that, the partial
unique index `credit_entry_idempotency` catches the case where the caller generated a fresh
identifier but the logical operation is the same, which is the real-world failure. The gateway
mints one request identifier before it calls the provider and derives the key from it, so a retry
of the whole settle path lands on the same key.

`credit_entry_one_settle_per_hold` is the second guard. A hold can have at most one settle entry,
enforced by a unique index rather than by application logic. Combined with the guarded update in
section 5.6, settling twice is impossible even from two different processes.

This is where I part from LiteLLM. Their only durable idempotency guard is on the log table, and
the guard against settling a hold twice is a Python dictionary in one worker's memory that dies
with the process (`research/03-project-litellm-proxy.md`, section "Idempotency"). OpenMeter's own
newer ledger warns about exactly this: "Atomicity is not idempotency"
(`openmeter/ledger/README.md`). Put the key in the database.

Grants use the same mechanism. A purchase writes an entry whose key is
`purchase:<stripe payment intent id>`, so a webhook delivered twice grants once. A signup grant
uses `grant:signup:<organization id>`, so a retried signup hook grants once.

### 5.5 How two simultaneous requests cannot both spend the last credit

One conditional SQL statement. There is no lock, no advisory lock, and no compare-and-swap loop.

```sql
UPDATE credit_account
   SET pending_debits = pending_debits + :amount,
       updated_at     = now()
 WHERE organization_id = :organization_id
   AND closed = false
   AND (spend_policy = 'allow_negative'
        OR posted_credits - posted_debits - pending_debits >= :amount)
RETURNING posted_credits - posted_debits - pending_debits AS available_after;
```

Zero rows returned means refused, and the surrounding transaction rolls back. One row means the
reservation is taken. The condition is evaluated inside the same statement that applies the
change, and Postgres's row lock serialises two concurrent statements against the same row, so two
requests cannot jointly pass. Under the default read committed isolation level, the second
statement waits for the first to commit and then re-evaluates its own `WHERE` clause against the
newly committed row (https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED).

We already run this exact shape in production. `MetersDAO.adjust()` at
`api/ee/src/dbs/postgres/meters/dao.py:376` performs an `INSERT ... ON CONFLICT DO UPDATE` with
the limit written into the `WHERE` clause and a `RETURNING` that tells the caller whether the
write landed. The `RETURNING` is the part that matters, and it is what Dify's equivalent statement
lacks: their update reads `rowcount` and logs, so the caller cannot refuse the next request or
show the user a real number (`research/03-project-dify.md`, section "Their conditional statement
compared with our meters DAO").

Three properties of this check are worth stating because they are easy to lose.

**The check includes pending amounts.** An organization with 100 credits posted, 70 spent, and 50
held will refuse a new hold, because 70 plus 50 already reaches the ceiling. A hold is money we
have promised away.

**The check runs when the hold is created and never when it settles.** Settlement can never be
refused, because it settles at most what was already reserved, or records an overshoot
deliberately. That is what makes the whole model safe: we refuse before spending money, and we
can always record what we spent.

**Deadlock is impossible because one transaction touches exactly one account row.** If a future
change ever makes a transaction touch two accounts, sort the identifiers and lock in that order,
which is what OpenMeter's newer ledger does (`openmeter/ledger/account/service/service.go:116-160`).

I considered a Redis counter as the authoritative gate, which is what LiteLLM does with a single
`INCRBYFLOAT` whose returned value is the admission decision. It is elegant and race free. I am
not copying it for the hot path, for three reasons. Our call volume is a few requests per second,
not thousands. A Redis counter is not durable, and LiteLLM's own code carries a comment recording
what deleting an inconsistent counter cost them: it "left budgets unenforced after a Redis
reload". And a Redis increment cannot join the Postgres transaction that writes the entry, which
reintroduces the two-system failure the hold exists to contain. Redis stays in the design for one
narrower job, described in section 6.5.

### 5.6 How a charge whose size is unknown until the work finishes is handled

Two phases, following TigerBeetle's two-phase transfer exactly
(https://docs.tigerbeetle.com/coding/two-phase-transfers/).

**Phase one, before the call.** In one transaction: run the conditional update above; insert a
`credit_entry` with `phase = 'hold'`, `direction = 'debit'`, and the estimated amount; insert a
`credit_hold` with `status = 'pending'` and an `expires_at` a few minutes out. If the update
returned no row, roll back and return payment required.

**Phase two, after the response.** In one transaction:

```sql
SELECT status, entry_id FROM credit_hold WHERE entry_id = :hold_id FOR UPDATE;
```

If the status is `settled`, this settle already happened; commit and return. Otherwise insert a
`credit_entry` with `phase = 'settle'`, `hold_id` set, and the true amount; set the hold row to
`settled`; walk the grants in burn order and write the allocation rows; and update the account:

```sql
UPDATE credit_account
   SET pending_debits = pending_debits - :held_amount,   -- only if the hold was 'pending'
       posted_debits  = posted_debits  + :actual_amount,
       updated_at     = now()
 WHERE organization_id = :organization_id;
```

The whole reservation comes out of `pending_debits` and only the settled amount goes into
`posted_debits`. The difference is released automatically. There is no third entry to write and
no remainder to track.

A call that failed and cost nothing settles for zero. That is a legal settle, not a special
release path, which removes a concept and a code branch. TigerBeetle allows a post of amount zero
for the same reason (`src/state_machine_tests.zig:1426-1428`).

**Settling an expired hold is allowed.** TigerBeetle refuses this, and it is right to for a bank,
because an expired authorization must not be captured. It is wrong for us. If the hold expired
while the model call was still running, the provider already charged us. Refusing to record the
cost loses real money and hides it. So the settle path accepts a hold whose status is `expired`,
skips the `pending_debits` subtraction because the sweeper already released it, and adds the true
cost to `posted_debits`. Every late settlement raises an alert, because a healthy system should
not produce them.

**The true cost may exceed the hold.** We record it. The balance can go below zero, and the
display floors at zero without the data doing so. Dify clamps the deficit out of existence with
`max(0, limit - used)` and `min(required, remaining)`, which means their system cannot represent
the money it lost and therefore cannot report it (`api/models/model.py:2786`). The floor belongs
in the display, never in the data.

**A sweeper bounds the leak.** A background job every minute finds holds where
`expires_at < now()` and `status = 'pending'`, sets them to `expired`, and subtracts their amount
from `pending_debits`. This is the part LiteLLM does not have, and it is why their leaked
reservations can pin a counter above real spend for an unbounded time on a busy key
(`research/03-project-litellm-proxy.md`, section "What happens if the proxy dies mid request").
Our hold is a durable row with a state and a deadline, so a crashed worker leaves evidence a
recovery job can find.

### 5.7 How grants, purchases, and earnings all enter the same system

They are the same operation with a different `source` and a different `priority`. Each one writes
a `credit_grant` row and a `credit_entry` row with `direction = 'credit'`, `phase = 'single'`, and
`grant_id` pointing at the grant, and adds the amount to `posted_credits`. All in one transaction,
all idempotent on the key.

| Arrival | `source` | `priority` | `expires_at` | Idempotency key |
| --- | --- | --- | --- | --- |
| Signup grant | `signup` | 10 | 90 days | `grant:signup:<organization id>` |
| Campaign grant | `promotion` | 20 | campaign end | `grant:<campaign>:<organization id>` |
| Earned for a contribution | `contribution` | 50 | 12 months | `grant:contribution:<award id>` |
| Bought with cash | `purchase` | 100 | 12 months | `purchase:<payment intent id>` |
| Given by support | `support` | 100 | none | `grant:support:<ticket id>` |

The **burn order** is priority ascending, then soonest expiry, then oldest creation, then lowest
identifier. That is OpenMeter's three-key sort verbatim
(`openmeter/credit/engine/grant.go:176-229`), and their own tests confirm the behaviour: two lots
of 100 with priorities 1 and 2, given 120 units of usage, end at 0 and 80
(`openmeter/credit/engine/run_test.go:508-543`). The defaults above mean a promotional grant
burns before an earned one, and an earned one burns before money somebody paid us. Note that Dify
burns paid credits first, because for them a paid credit means the customer is on a plan
(`api/core/provider_manager.py:1678`). Our order is the opposite on purpose.

**Expiry is an explicit debit, not an implicit rule.** A daily job finds grants whose
`expires_at` has passed and whose remainder is above zero, writes one debit entry with
`code = 'grant_expired'`, an allocation of the whole remainder to that grant, and the idempotency
key `grant_expired:<grant id>`. The remainder leaves `posted_credits` by way of `posted_debits`,
so the account counters stay a simple sum at all times.

This is a deliberate departure from OpenMeter, which handles expiry implicitly by clamping a
grant's active window at read time. Their way needs no job. Ours makes the event visible in the
user's history, keeps the balance a single subtraction, and means a stale snapshot cannot make an
expired grant spendable. The cost is that if the job stops, users can spend expired credits until
it runs again. That is listed in section 11.

**Voiding a grant** writes `voided_at` and, in the same transaction, an expiry-style debit for the
unspent remainder. Understand what that means: the unspent remainder disappears and
already-spent credits are not reversed. If somebody was rewarded 500 credits for an article,
spent 300, and we then void the grant, they keep the benefit of the 300 and lose the 200. A true
clawback of the 300 is a separate debit with `code = 'correction'`, and it is a deliberate act
with an approver recorded, not a side effect of voiding.

**Backdating an earned grant is free for us.** OpenMeter rejects a grant whose `effective_at`
predates the current usage period, because a period reset already computed a rollover
(`openmeter/credit/grant.go:72-79`). We do not build usage periods, resets, or rollover, so we
do not inherit the restriction. Somebody publishes an article, we review it a week later, and we
credit them dated to publication. That was one of the headline requirements and it comes free
because of a feature we chose not to build.

### 5.8 Two worked examples

**A model call that costs less than its hold.** An organization has one grant of 2,000,000
micro-dollars (2,000 credits) and nothing spent. The gateway estimates 14,200 micro-dollars and
holds it. `pending_debits` becomes 14,200 and `available` becomes 1,985,800. The call returns
usage showing 23,500 cached input tokens, 100 input tokens, and 120 output tokens, priced at
1,585 micro-dollars. Settlement writes a settle entry of 1,585, subtracts 14,200 from
`pending_debits`, adds 1,585 to `posted_debits`, and writes one allocation row against the grant.
`available` is now 1,998,415. The 12,615 difference was released by the same statement pair that
posted the charge.

**A debit that spans two grants.** An organization has 300 micro-dollars left on a signup grant
(priority 10) and 50,000 on a purchased grant (priority 100). A call settles at 1,585. The burn
walk takes 300 from the signup grant and 1,285 from the purchased one, and writes two allocation
rows against one entry. The signup grant's remaining is now zero and it will never be selected
again.

---

## 6. The gateway design

### 6.1 What the sandbox receives

Not a provider credential. A **run token**: a short-lived signed token, meaning a string carrying
signed claims that our gateway can verify without a database read. Its claims are the
organization, the project, the run, the single allowed model, an output token ceiling, a per-run
credit cap, an expiry, and a token identifier.

It travels the only channel that carries secrets, `ResolvedConnection.env`
(`sdks/python/agenta/sdk/agents/connections/models.py:180`), placed in `OPENAI_API_KEY`. That
field is masked in any dump by a field serializer and `to_wire()` never emits it
(`sdks/python/agenta/sdk/agents/connections/models.py:186-210`).

Assume the token leaks, because it will. What it is worth to a thief: calls to one model, with
output length capped, against a per-run credit cap, until the run's deadline passes. That is a
completely different object from a Google service account credential, which has no per-user
spending limit behind it at all (`research/01-gemini-and-caching.md`, section 5).

The alternative was a stored virtual key looked up per request, which is what LiteLLM does. It
allows revocation but needs a database read on every call, which you then cache, which is where
LiteLLM's cache-invalidation bugs live, including one where a cached authorization object leaked
one end user's budget onto another (https://github.com/BerriAI/litellm/issues/29142). For an
expiry measured in the length of one run, a signed token is simpler and the inability to revoke
matters less. Section 11 prices adding revocation back.

### 6.2 How the token reaches the run, and the one code change that makes it work

The route already exists and is already tested. A connection that resolves to provider `openai`,
deployment `custom`, connection mode `agenta`, and a base URL causes the runner to write a per-run
`models.json` naming our base URL and one pinned model
(`services/runner/src/engines/sandbox_agent/pi-model-config.ts:85`). The dialect it writes is
`openai-completions`, which is what the Vertex OpenAI-compatible endpoint speaks. So no new runner
contract, no new dialect field, and no new base URL mechanism.

There is one gap and it must be closed on day one. The gate at
`services/runner/src/engines/sandbox_agent/pi-model-config.ts:89-94` requires
`request.connection?.mode === "agenta"` and a slug. But a default agent emits no connection object
at all: `wire_model_ref` omits it when the connection is the project default, and the comment at
`sdks/python/agenta/sdk/agents/dtos.py:838-841` explains why ("the project default is `agenta`
with no slug and carries no info beyond the model"). Meanwhile `ResolvedConnection.to_wire()` emits
provider, model, deployment, credential mode, and endpoint, and no connection object at all
(`sdks/python/agenta/sdk/agents/connections/models.py:191-210`). With no connection on the wire the
runner writes no plan, the run falls back to the default provider host, and our token gets sent to
api.openai.com.

The fix is small and specific. Reserve one connection slug, `agenta-managed`, and have
`wire_resolved_connection` emit `{"mode": "agenta", "slug": "agenta-managed"}` when the resolved
connection is a platform-funded one. One change in the SDK, one reserved name, one test in
`services/runner/tests/unit/sandbox-agent-pi-model-config.test.ts`. Prove it end to end from a
real default agent with an empty vault before writing any accounting code, because it is the one
correction that could still change the plan.

Two limits of that route are worth stating now rather than discovering later. It works for the Pi
harness only; the plan builder returns nothing for a Claude request. And the pinning is
configuration, not a boundary, which is precisely why the model allowlist has to be checked again
at the gateway.

### 6.3 The request path, end to end

1. **The harness calls our base URL.** Pi reads its per-run `models.json`, which names
   `https://cloud.agenta.ai/api/model-gateway/v1` and one model, and sends
   `POST /api/model-gateway/v1/chat/completions` with `Authorization: Bearer <run token>`.

2. **Verify the token.** Check the signature and the expiry. No database read, no Redis read. A
   bad token gets 401.

3. **Inspect the body without consuming it.** Read the raw bytes once. Parse a copy into a
   dictionary to read `model`, `stream`, and `max_tokens` or `max_completion_tokens`. The parsed
   copy is only ever read. The bytes are what gets forwarded.

4. **Check the model against the token's allowlist.** A mismatch gets 403. This is the check that
   converts our advisory pinning into a real boundary, and it bounds our exposure more than the
   balance does, because it stops a cheap allowance being spent on an expensive model. Dify's
   hosted quotas carry exactly such a list (`api/core/hosting_configuration.py`).

5. **Bound the output.** If `max_tokens` is missing or above the token's ceiling, splice it in.
   How to splice it without breaking caching is section 6.6.

6. **Check the per-run cap.** One Redis increment keyed by the run identifier, with a time to
   live. Over the cap gets 402. If Redis is unavailable, log and continue; the organization
   balance still bounds the damage.

7. **Place the hold.** One database transaction: the conditional account update, the hold entry,
   the hold row. No row returned means 402 with an OpenAI-shaped error body, so the harness
   surfaces something readable.

8. **Forward.** Swap the `Authorization` header for a Google credential, point at the Vertex
   endpoint, and send the original bytes. Use `httpx` in streaming mode. Do not call `.read()` or
   `.json()` on the upstream response; either one destroys the stream.

9. **Relay.** Return a FastAPI `StreamingResponse` that iterates the upstream response and yields
   each block of bytes untouched, while keeping the last sixteen kilobytes in a rolling buffer.

10. **Settle.** After the response has been handed to the caller, in a background task, parse the
    tail buffer for the usage object, price it against the current rate card, and run the
    settlement transaction from section 5.6.

Steps 2 through 7 are the only work before the first upstream byte, and none of them is a network
call except one optional Redis increment. Time to first token stays dominated by the provider.

### 6.4 Streaming, precisely

**Never buffer.** If a reverse proxy in front of the gateway buffers, the whole response
accumulates before the first byte reaches the user, and time to first token becomes equal to
total generation time. The concrete nginx settings are `proxy_buffering off;` and
`chunked_transfer_encoding on;`
(https://oneuptime.com/blog/post/2025-12-16-server-sent-events-nginx/view). For our workload,
with two or three calls per user message, the difference is an agent that feels alive against one
that appears frozen for tens of seconds.

**Relay bytes, inspect a tail.** Do not decode each event and re-emit it. A gateway that copies
bytes cannot corrupt the framing, because it never interprets it. A gateway that parses and
re-emits owns the correctness of every `data: ` prefix and blank line, and clients hang when it
gets one wrong. Keeping a small rolling tail buffer gives us the usage object anyway, and the
whole cost is a few kilobytes of memory per stream.

**Errors after the first byte go inside the stream.** Once the first byte is written the status
line is committed and cannot be changed. Every refusal decision therefore has to happen before
step 8. That is why the balance check is at step 7 and not later.

**Handle the disconnect by continuing to read.** When the caller closes the connection, the
provider does not know and keeps generating, and will bill us. If we stop reading, we lose the
usage entirely, which is exactly LiteLLM issue 14457, titled "Usage data lost when streaming
responses are terminated early by client disconnect"
(https://github.com/BerriAI/litellm/issues/14457). Our rule is to catch the write failure, stop
writing, and keep iterating the upstream response until it ends or a deadline passes. We were
going to pay for those tokens regardless, and this way we account for them. If the drain itself
times out, settle to the input cost plus an estimate of the output from what we relayed, and mark
the entry `metered_by = 'estimate'`.

The reasoning behind charging the input rather than refunding to zero is LiteLLM's and it is
sound: by the time a request is cancelled the provider call was already dispatched, so the input
tokens were billed, and refunding to zero would let a caller abort early to dodge the charge
(`litellm/proxy/spend_tracking/budget_reservation.py:280-310`).

### 6.5 Where the usage numbers come from

For a non-streaming call, the response body contains `usage` and there is no problem.

For a streaming call in the OpenAI dialect, usage is absent unless the caller sends
`stream_options: {"include_usage": true}`. When they do, one extra final chunk carries `usage`
and an empty `choices` array
(https://cookbook.openai.com/examples/how_to_stream_completions).

Two things are unverified here and both must be settled before the design is frozen.

**Does our harness send `stream_options`?** No occurrence of `stream_options` or `include_usage`
exists anywhere in `services/`, `sdks/`, `api/oss/src`, or `web/oss/src`, and the harness is a
third-party package running inside the sandbox. The test: point a run at a throwaway HTTP server
that logs the request body and returns a canned stream, then read the logged body. If the harness
omits it, the gateway must splice it in.

**Does the Vertex OpenAI-compatible endpoint honour `stream_options` and report cached tokens?**
`stream_options` does not appear in Google's supported-parameter list for that endpoint, and
Google states that unsupported parameters are ignored rather than rejected
(https://docs.cloud.google.com/vertex-ai/generative-ai/docs/migrate/openai/overview). Their
Developer API page does document it, but that is a different product
(https://ai.google.dev/gemini-api/docs/openai). The test: send one long request twice with
streaming on and `stream_options` set, read the final chunk of the second response, and look for
a populated `usage` with a non-zero `prompt_tokens_details.cached_tokens`. If `cached_tokens`
never appears, the cost model in this document is wrong and the plan needs revisiting before
anything is built.

The fallback if usage never arrives is Kong's: estimate. Count the characters we relayed and
divide by four for output, count the request bytes and divide by four for input, and mark the
entry `metered_by = 'estimate'` (https://developer.konghq.com/ai-gateway/streaming/). A daily
report of the share of entries metered by estimate tells us how much of our billing is a guess.

### 6.6 What breaks prompt caching, and how we avoid it

This is the section with the most money attached to it. State the rule once and put it in the
code as a comment: **the gateway forwards the request body byte for byte, and carries its own
metadata in the URL and in headers.** Every exception needs a named reason and a test that shows
`cached_tokens` is still non-zero after the change.

Four things break caching and we avoid each one deliberately.

**Re-serialising the body.** Deserialising JSON into objects and serialising it back can change
key order and formatting. Whether that breaks a provider's cache depends on whether the provider
hashes raw bytes or a normalised form, and no provider documents this. We never find out, because
we forward the original bytes.

**Injecting anything into the prefix.** OpenAI's cached portion includes the whole messages array,
tool definitions, and structured output schemas
(https://developers.openai.com/api/docs/guides/prompt-caching). Anthropic requires the prefix to
be byte identical; reordering a tools array or inserting a timestamp anywhere before the
breakpoint causes a silent miss with no error
(https://platform.claude.com/docs/en/build-with-claude/prompt-caching). So nothing of ours ever
enters `messages`, `tools`, or the system prompt. Our run identity travels in the token.

**Splitting traffic across backends.** With N provider accounts chosen at random, the hit rate
falls to roughly one over N even though nothing about the request changed. OpenAI's caches are
not shared between organizations, and Google's guidance is to send similar requests close
together in time. If we ever run more than one backend, we route by conversation, never round
robin.

**Translating dialects.** Every cache-related bug in LiteLLM's tracker is a translation bug:
`cache_control` applied to every content item instead of the last
(https://github.com/BerriAI/litellm/issues/15696), an `anthropic-beta` header set unconditionally
so Vertex rejects cache-enabled requests (https://github.com/BerriAI/litellm/issues/14293), and
cache token counts not normalised into the standard field so the metric that would have shown you
the problem never increments (https://github.com/BerriAI/litellm/issues/27763). We speak one
dialect in and the same dialect out.

**The two edits we may be forced into, and how to make them safe.** We may have to add
`max_tokens` and `stream_options` to the body. Neither is part of the messages, tools, or schema,
so neither should participate in the prefix. That is reasoning, not documentation, so it gets a
test. The implementation is a surgical byte splice rather than a round trip: find the last `}` in
the body, insert `,"max_tokens":8192,"stream_options":{"include_usage":true}` before it, and
leave every other byte where it was. That function is about fifteen lines, it needs its own unit
tests for whitespace and for a body that already carries the key, and it preserves the byte order
of everything the harness sent.

**The cache preservation test is a release gate.** Send the same long prefix twice through the
gateway and assert `cached_tokens` is non-zero on the second call. Run it in continuous
integration. Without it, somebody will add a helpful header or a request identifier to the body
and multiply our bill by five with no failing test.

### 6.7 The thought signature problem, and why it decides which model we launch on

Gemini 3 models return an encrypted blob called a thought signature attached to any function call
they emit, and they enforce its return. Google states that "if a required thought signature is
not returned when using Gemini 3 models, the model will return a 400 error"
(https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thought-signatures). Through the
OpenAI-compatible endpoint the signature arrives at
`tool_calls[N].extra_content.google.thought_signature`, a non-standard location that ordinary
OpenAI-dialect clients drop. This is a widely reproduced failure, filed against the Codex CLI
(https://github.com/openai/codex/issues/7519), VS Code, the OpenAI Python SDK, the OpenAI Agents
SDK, and Goose.

Our harness has this bug. Pi's OpenAI adapter round-trips encrypted reasoning only in
OpenRouter's `reasoning_details` format and never reads or writes `extra_content`
(`research/01-gemini-and-caching.md`, section 3). So Pi driving Gemini 3 through the Vertex
OpenAI endpoint would fail on the second step of any tool-using turn.

There are four ways out and they are not equally good.

Relaying the signature in the gateway is the smallest change, but it forces us to modify
`messages` on the way out, which is the one thing section 6.6 forbids. It would still work,
because the modification is consistent across every call in a run, but it moves us from byte
relay to parse and re-emit and makes the cache test load-bearing rather than a safety net.

Google's documented escape hatch, setting `thought_signature` to
`skip_thought_signature_validator`, is cheap and Google explicitly discourages it, saying it will
negatively affect model performance.

Switching Pi to its native Google adapter avoids the problem entirely, because Pi's `google-vertex`
and `google-generative-ai` adapters preserve signatures through a shared helper
(`dist/api/google-shared.js`, `retainThoughtSignature`). The cost is real work in three files:
`pi-model-config.ts` must stop hard-coding one dialect and one credential variable,
`capabilities.py` must allow the Pi and Gemini and custom triple in `harness_allows_pair`, and
`connections.py` must stop normalising every provider-less custom connection to `openai`.

Launching on Gemini 2.5 Flash avoids it for now. Google's wording is that Gemini 3 models enforce
"stricter validation on thought signatures than previous Gemini versions", which strongly implies
a 2.5 model works through the OpenAI-compatible endpoint with today's harness and no relay. Its
cache minimum is also lower at 2,048 tokens and its prices are about a fifth of Gemini 3.5 Flash.

**The recommendation: launch on Gemini 2.5 Flash, verified by test, and if we later need Gemini
3, switch Pi to its native Google adapter rather than build a signature relay.** The relay buys a
month and costs the byte-relay guarantee forever.

### 6.8 What happens when things fail

| Failure | What the user sees | What the ledger records | Who eats the cost |
| --- | --- | --- | --- |
| Balance empty at hold time | 402 with a readable message, run stops | Nothing | Nobody |
| Model not on the allowlist | 403 | Nothing | Nobody |
| Provider returns an error before the first byte | The error, relayed | Settle of zero | Us |
| Provider fails mid stream | An error event inside the stream | Settle of the true or estimated usage | The user |
| Caller disconnects mid stream | Nothing | Settle of the drained usage, marked provider or estimate | The user |
| Gateway crashes after forwarding | The run fails | Hold expires, sweeper releases it, alert fires | Us |
| Settle write fails after a served response | Nothing | Retry on the same key, then the sweeper, then an alert | Us |
| Redis unavailable | Nothing | Per-run cap not enforced for that call | Possibly us |

Two rules sit behind that table. **Charge for work the provider actually performed, not for work
the caller successfully received.** And **accounting must never be able to destroy the artefact it
is accounting for.** Dify's chat path can lose a message from the conversation history because a
Redis lock timed out after the user already read the answer
(`research/03-project-dify.md`, section "What happens to the user's response when the deduction
fails"). Our settle runs after the response is delivered, in a background task, and cannot take
the response down with it.

---

## 7. Responsibilities

### 7.1 Who owns what

**The backend API service** owns the ledger. It owns the tables, the hold and settle functions,
the grant and void endpoints, the balance and history endpoints, the expiry job, the hold sweeper,
and the nightly reconciliation. It owns the funding decision: at request acceptance it decides
whether this run may draw on credits, and it mints the run token. It owns the signup grant hook.

**The model gateway** owns the request path. It verifies tokens, enforces the allowlist and the
output ceiling, calls the ledger's hold function, forwards, relays, extracts usage, prices it
against the rate card, and calls the ledger's settle function. It holds the Google credential and
refreshes the OAuth access token, which service accounts issue with a one-hour life
(https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/migrate/openai/auth-and-credentials).

**The Python SDK** owns exactly one new behaviour: when the backend has marked a run as funded,
`resolve_connection` returns a `ResolvedConnection` whose provider is `openai`, deployment is
`custom`, `endpoint.base_url` is the gateway, `env["OPENAI_API_KEY"]` is the run token, and whose
wire form carries the reserved slug. It does not decide eligibility and it does not count
anything.

**The runner** owns nothing new. Its existing custom-connection path carries the base URL and pins
the model. It must never learn what a credit is.

**The frontend** owns the display: the balance as two labelled numbers, the credit cost of each
run shown inside the run, the history view, and the exhausted state with the connect-your-key
path. It reads numbers from the backend and computes none of them.

### 7.2 The boundaries worth arguing

**The gateway lives in the API codebase, in its own process.** A separate service means a second
deployment, a second image, a second set of alerts, and an internal HTTP call between the gateway
and the ledger on the hot path. Sharing the codebase means the hold and the request handling
share one database session and one transaction, which removes half of the two-system failure the
research says nobody solves. But sharing a *process* with the product API means a flood of
long-lived streaming connections competes with ordinary requests on the same event loop. So: one
codebase, one image, a new entrypoint next to the existing ones in `api/entrypoints/`, running its
own container with its own worker count. That is the pattern the repository already uses for
worker processes (`api/entrypoints/worker_queues.py`).

**The funding decision belongs at request acceptance, not in the resolver.** Every surface
converges on the workflow invoke path, so that is where we can tell a playground message from a
nightly evaluation. The one field that looks like a purpose marker, `meta.run_kind`, comes from
the client and is read after credential resolution, so it cannot be trusted. Putting
authorization and counting inside `resolve_connection` is exactly the coupling a ledger would
later have to pull back out.

**The gateway prices; the ledger stores.** The ledger takes an amount and a measurement and does
not know what a token is. That keeps model pricing, tool pricing, and sandbox pricing as three
callers of one interface, rather than three branches inside the ledger.

**Tool metering belongs at the tool execution endpoint, not in the gateway.** Server-side tool
execution already funnels through one place
(`api/oss/src/apis/fastapi/tools/router.py:1218`, `execute_tool`). Charging there is one hold and
one settle against the same ledger, with a different `code`.

**Sandbox metering belongs to the runner reporting and the backend pricing.** The runner knows
when a sandbox started and stopped. It reports the interval. The backend prices it. The runner
never sees a rate card.

**The name.** `api/oss/src/core/gateway/` already exists and holds the tool gateway, meaning
connections and catalogs for Composio. The new code is `model_gateway`, everywhere, with no
exceptions.

---

## 8. Migrations

### 8.1 The order

All of this is commercial-edition and cloud-only, behind the existing `is_ee()` check
(`api/oss/src/utils/common.py:51`). Revisions go in
`api/ee/databases/postgres/migrations/core/versions/`. Open-source and self-hosted behaviour does
not change.

**Revision 1, before anything else.** Create `credit_rate_card`, `credit_account`,
`credit_grant`, `credit_entry`, `credit_hold`, and `credit_allocation`, in that order, because of
the foreign keys. Seed one rate card row. This is purely additive and fully reversible by
dropping the tables, up until the moment real balances exist.

**Revision 2, with the reporting phase.** Create `credit_usage_daily`. It is derived from
`credit_entry` by a nightly job, so it can be dropped and rebuilt at any time. Fully reversible.

**Revision 3, with the purchase phase.** Add nothing. Purchases are grants with a different
`source`, which is the point of the design. If Stripe needs its own record of a checkout session
before the payment succeeds, that is a separate table in the subscriptions domain, not a change
to these tables.

**Revision 4, if and when we want accounting-grade books.** Add a nullable
`counterparty_account_id` to `credit_entry` and backfill it from `code`. Additive and reversible.

There is no data migration anywhere in that list, and that is the design working.

### 8.2 What is expensive to change later

These are the decisions to get right now, because changing any of them means rewriting rows
rather than adding them.

**The unit of `amount`.** Micro-dollars. Changing the scale later rewrites every row and every
reader. Decide once.

**Recording entries at all, rather than a counter.** This is the Dify lesson and it is the most
expensive mistake available. A counter cannot be split, so when the meaning of the number changes
there is no correct backfill. Dify's cost shows as a permanent three-way fallback branch in their
provider manager, a three-way match statement in their quota code, and a class of tenant whose
deduction lands nowhere.

**`measurement` on every debit.** Raw token counts, including cached and cache-write tokens.
Without them we can never restate a charge after a price change, and we can never answer a
dispute exactly. Impossible to backfill.

**`run_id` on every debit.** Attribution. Impossible to backfill.

**`rate_card_id` on every debit.** Which price list produced the number. Impossible to backfill.

**Grants as rows rather than an addition to one number.** The whole credit-lot model, expiry,
burn order, and provenance rest on this. Retrofitting lots onto a single number has no correct
answer, because you do not know which part of the number came from where.

**The hold as a durable row rather than a Redis number.** LiteLLM's hold is a Python dictionary
plus a Redis increment with no durable record, which is why a crashed worker leaves an inflated
counter that only sixty seconds of silence can clear. Turning that into a durable row afterwards
means rewriting the whole reservation path.

**Three counters on the account rather than one balance column.** The entire hold mechanism lives
in the gap between pending and posted. Collapsing them to one number and splitting them later
means touching every read and every write.

### 8.3 What is cheap to change later

The burn order, because it is a sort in code over an indexed column. The rate values, because
they are data. The credit-to-dollar display ratio, because it is one constant and the stored unit
does not move. Whether tool calls and sandbox minutes are metered, because they are new callers
of an existing interface. Adding a second unit, because the `unit` column already exists. Moving
from a flat price per call to a token-derived price, or the reverse, because both are functions
over the same recorded measurement.

---

## 9. The implementation plan

Estimates are for one engineer who knows this codebase. Treat them as estimates, not
measurements. Every phase is shippable on its own and no phase invalidates the data model of the
one below it.

### Phase 0: prove the delivery path.
Build the dumb forwarder: one endpoint that accepts an OpenAI chat completion, swaps the
authorization header for a Google credential, forwards to the Vertex OpenAI-compatible endpoint,
and streams the response back untouched. No balance, no token, no accounting. About a hundred
lines. Ship the connection slug fix from section 6.2 with it.

Then run the four tests that can still change the design.

1. Does a real agent conversation, starting from a default agent with an empty vault, reach
   Gemini through our forwarder? This validates the whole delivery path before any accounting is
   written.
2. Does the harness stream, and does it send `stream_options`?
3. Does the Vertex OpenAI-compatible endpoint return usage on a stream, and does it report
   `prompt_tokens_details.cached_tokens` above zero on a repeated prefix?
4. Does Gemini 2.5 Flash complete a two-step tool-using turn through that endpoint with today's
   harness, without a thought signature error?

**What we learn:** whether the cost model in section 4 is real, and which model we launch on. If
test 3 shows no cached tokens, stop and rethink, because the economics change completely.

### Phase 1: the ledger, with no enforcement.
The six tables and the migration. The hold, settle, and grant functions with their idempotency
keys. The burn walk and the allocation writer. The hold sweeper. An admin endpoint that writes a
grant. A read endpoint that returns the balance and a paged history. The signup hook that grants
to a configurable share of new organizations.

**The test that decides whether this phase is done** is the concurrency test: many workers racing
for the last unit of one balance, asserting that exactly one wins. Budget for it specifically. It
is the one thing the design cannot survive getting wrong. Port OpenMeter's burn-order table tests
as well; `openmeter/credit/engine/run_test.go` reads as a specification and translating the tables
into pytest gives us a conformance suite almost free.

**What we learn:** nothing about users yet. This phase exists so Phase 2 has somewhere to write.

### Phase 2: the gateway enforces.
Run token minting at request acceptance, and the resolver change that carries it. Token
verification, the model allowlist, the output ceiling splice, and the per-run cap. The hold before
the call and the settle after. Usage extraction from the stream tail and from a non-streaming
body. The rate card lookup and the pricing function. The 402 path with an OpenAI-shaped error
body. The frontend states: balance, cost per run shown inside the run, and the exhausted state
with the connect-your-key path.

The three tests that nothing else will catch: the cache preservation test, the disconnect test
asserting a ledger entry is still written, and the buffering test asserting the first chunk
reaches the client well before the last one.

**What we ship:** a person signs up, runs an agent immediately, watches a number go down, and
hits a clear wall. That is the product.

### Phase 3: see what is happening.
The daily rollup table, built nightly from entries with an insert-select. The nightly
reconciliation that recomputes the account counters from the entries and alerts on a mismatch. A
report of the cache hit rate and of what caching saved in dollars, which is nearly free once the
token counts are in the rollup. A report of the share of entries marked `metered_by = 'estimate'`.
The blended hold estimate from section 11, item 2, which uses the previous call's observed cache
rate.

**What we learn:** whether caching is working, what a conversation really costs, and whether our
rate card is above our cost.

### Phase 4: money in.
Stripe checkout for credit blocks at the published rate, with the webhook writing a purchase
grant keyed on the payment intent. The grant expiry job. The admin award flow for contributions,
with an approver, a reason, a published award schedule, and backdating. The void and correction
endpoints.

**What we ship:** people can buy credits and we can pay people in credits.

### Phase 5: meter everything else.
Tool call metering at `execute_tool`. Sandbox time metering, reported by the runner and priced by
the backend. Extend the rollup and the history to show the three categories separately.

**What we ship:** the unit finally covers everything the brief said it should.

### What Phase 2 deliberately does not build

Double-entry counterparty accounts. Any second dialect. More than one provider backend, and
therefore any routing or failover. A Redis counter as the authoritative balance. Recurring grants
as a schema feature; a monthly refill is a cron job inserting a grant row. Usage periods, resets,
and rollover, which OpenMeter needs and which would cost us the ability to backdate an earned
grant. Explicit context caching, which needs a cache manager and which we should only build after
the measurement in Phase 3 shows implicit caching missing. Automatic contribution scoring. Token
revocation. Per-organization concurrency limits beyond what the hold already provides.

---

## 10. The decisions and their trade-offs

| Decision | Options | Choice and why |
| --- | --- | --- |
| The unit | Money, abstract credit, action count, no meter | **Abstract credit pegged to money at a fixed public rate.** An action count exposes us to our own capability improvements, which is what happened to Replit. Money publishes our cost basis. A fixed peg removes the devaluation risk that is the only real objection to a credit. |
| Storage unit | Cents, micro-dollars, floating point, decimal | **Integer micro-dollars in `bigint`.** Cents round a real charge to zero. Floating point produces rounding bugs, which OpenMeter still carries a note about in its own engine. Micro-dollars reconcile directly against the provider invoice. |
| Where the balance lives | Recompute from entries, cached counters, Redis | **Cached counters on the account, written in the same transaction as the entry, provable by a sum.** Recomputing on read is what OpenMeter does and it assumes an analytical database we do not have. Redis is not durable and cannot join the transaction. |
| Concurrency | Row lock, advisory lock, Redis increment, serial execution | **One conditional `UPDATE` with the limit in the `WHERE` clause.** No lock to manage, one round trip, race free. Our metering system already runs this shape (`api/ee/src/dbs/postgres/meters/dao.py:376`). |
| Unknown cost | Charge after the fact, hold and settle, flat price per call | **Hold and settle.** Charging after the fact is what Dify does, and their worst case is a workspace with one credit left starting up to a hundred model calls. A flat price removes the problem entirely but makes us blind to caching, which is our largest cost lever. |
| Hold estimate | Model maximum output, typical output, no hold | **Uncached input plus a configured typical output, with `max_tokens` clamped.** LiteLLM's blind hold of 16,384 output tokens reserves about twenty-four times what a call settles at. A typical output plus a hard clamp keeps the over-reservation near three to nine times and bounds the true overshoot. |
| Settling an expired hold | Refuse, allow | **Allow, and alert.** TigerBeetle refuses, correctly for a bank. For us the provider already charged, so refusing to record it loses real money and hides it. |
| Balance below zero | Clamp in data, clamp in display, forbid | **Allow in data, floor in display.** Dify clamps in data and therefore cannot report the money it lost. The floor belongs in the display. |
| Grants | One balance number, grant rows with priority and expiry | **Grant rows.** Three funding sources with different expiry and a required burn order cannot be expressed by one number, and retrofitting lots has no correct backfill. |
| Burn order | Purchased first, promotional first, oldest first | **Priority ascending, then soonest expiry, then oldest.** Promotional at 10, earned at 50, purchased at 100, so money somebody paid us survives longest. Dify burns paid first, which is right for a plan and wrong for us. |
| Expiry | Implicit at read time, explicit debit entry | **Explicit debit written by a daily job.** Keeps the balance a single subtraction, makes expiry visible in the user's history, and cannot be undone by a stale cache. Costs a job that must run. |
| Credential in the sandbox | Provider key, stored virtual key, signed short-lived token | **Signed token, expiring with the run.** No database read on the hot path, therefore none of LiteLLM's authorization cache bugs. Revocation is the price, and section 11 says what buying it back costs. |
| Model restriction | `models.json` only, gateway allowlist | **Both, and the gateway one is the real boundary.** The file inside the sandbox is advice. This control bounds our exposure more than the balance does. |
| Body handling | Byte relay, parse and re-emit | **Byte relay, with a surgical splice for the two fields we may have to add.** Parsing owns the framing and every cache-related bug in LiteLLM's tracker is a translation bug. |
| Dialect | Chat completions pass-through, translate to Google's native | **Pass-through.** The runner speaks only chat completions and Vertex publishes a compatible endpoint. Adding a dialect roughly doubles the surface where a streaming or accounting bug can hide. |
| Launch model | Gemini 3 with a signature relay, Gemini 2.5 Flash | **Gemini 2.5 Flash, verified by test.** The relay would force us to modify `messages`, which is the one thing that breaks caching by design. |
| Gateway deployment | Separate service, router in the API process, own process in the API image | **Own process, same image and codebase.** No new infrastructure and no internal HTTP on the hot path, but a stream flood cannot starve the product API. |
| Enforcement failure mode | Fail open, fail closed | **Fail closed.** The generic entitlements wrapper fails open on infrastructure errors, and its own docstring explains why that is right for a feature gate (`api/ee/src/core/access/entitlements/service.py:299`). It is wrong for spending money. |
| Charging for our own failures | Charge, absorb | **Absorb, and say so publicly.** Zapier states "Failed actions are not counted" in writing (https://zapier.com/pricing). The strongest single association in the complaint data is between error loops and rage. |
| Contribution rewards | Automatic scoring, manual approval | **Manual approval against a published award schedule.** The precedent for paying contributors in platform balance is thin and mostly discontinued. Automate later; the ledger does not change. |
| Ledger technology | TigerBeetle, Blnk, LiteLLM's schema, our own tables | **Our own tables, copying TigerBeetle's model.** TigerBeetle's own documentation says running it in Docker is not recommended, a replica wants 6 to 32 GiB of RAM, it has no authentication of any kind, and its writes cannot join a Postgres transaction. Its value to us is its specification, not its binary. |

---

## 11. The guarantees we are relaxing

Each item states what we give up, the worst outcome, why that is acceptable, and exactly what
buying it back costs.

**1. Settlement is not exactly once across the gateway and the provider.** If the gateway process
dies after forwarding the request and before writing the settle, the provider served a call we
never charged for.

*Worst outcome:* we pay for a call and record nothing. *Why acceptable:* the hold row is a durable
record that the call was attempted, so a sweeper finds it and an alert fires. We know the size of
the loss even when we cannot attribute it, which is strictly better than LiteLLM, whose in-memory
queues drop data on failure and log a line. *Cost to add back:* write the upstream request
identifier and status onto the hold row before forwarding, and add a recovery job that queries
Google's own usage export for calls with no settle. Roughly two days plus a dependency on the
export.

**2. Holds over-reserve by roughly three to nine times on a cached call.** The estimate prices the
whole prefix at the uncached rate because it cannot know whether the cache will hit.

*Worst outcome:* an organization near zero is refused a call it could actually afford, up to about
nine times the true cost of one call. *Why acceptable:* it only bites in the last few credits of a
balance, so the loss is at most one message of value at the very end. *Cost to add back:* keep the
previous call's observed cache fraction per run in Redis and blend the input rate. About thirty
lines and one Redis read, scheduled for Phase 3.

**3. Run tokens cannot be revoked before they expire.** Verification is signature-only, with no
lookup.

*Worst outcome:* somebody extracts a token from their own sandbox and spends up to the per-run cap
on the allowed model until the run's deadline passes. *Why acceptable:* the blast radius is one
model, one capped output length, one run's credits, and minutes of time. *Cost to add back:* a
Redis set of revoked token identifiers and one `GET` on the hot path, plus an admin endpoint. About
twenty lines and one round trip per call.

**4. Some usage is estimated rather than provider-reported.** When a stream dies before the final
chunk, or the provider omits usage, we count characters instead.

*Worst outcome:* individual charges are wrong by tens of percent, in either direction. *Why
acceptable:* the entry carries `metered_by = 'estimate'`, so we can measure how much of our
billing is a guess and refund on request. *Cost to add back:* keep draining the upstream stream
after a client disconnect, which Phase 2 already does; beyond that, reconcile against Google's
usage export monthly. Roughly a week for the export path.

**5. The account counters can drift from the entries if a bug writes one without the other.**

*Worst outcome:* a wrong balance shown and enforced. *Why acceptable:* every write goes through
one function and one transaction, so drift requires a bug rather than a race. *Cost to add back:*
the nightly reconciliation query in section 5.3 plus an alert, about twenty lines, scheduled for
Phase 3. Note that the recovery is always possible because the entries are complete, which is
exactly why they have to exist from the beginning.

**6. Expired grants stay spendable until the daily job runs.**

*Worst outcome:* up to twenty-four hours of free spend against an expired grant. *Why acceptable:*
the amounts are small and the direction of the error favours the user. *Cost to add back:* run the
job hourly, or add `AND (g.expires_at IS NULL OR g.expires_at > now())` to the burn walk and
accept that the account counter is then briefly optimistic. Under an hour of work either way.

**7. Tool calls and sandbox minutes are not metered in the first version.**

*Worst outcome:* our cost per active organization is understated, and a user who runs many tool
calls on few model calls is under-charged. *Why acceptable:* the model call dominates our cost
today, at roughly 23,600 replayed tokens per call. *Cost to add back:* two new callers of the
existing hold and settle interface, no schema change. Phase 5.

**8. Nothing reconciles our numbers against Google's invoice.**

*Worst outcome:* the rate card drifts from reality and we lose money on every call without
noticing. *Why acceptable:* only for the first months, and only because we set the card above cost
deliberately. *Cost to add back:* a monthly manual comparison first, then an automated one against
the billing export. Two days for the manual version.

**9. The per-run cap is enforced in Redis and is skipped when Redis is unavailable.**

*Worst outcome:* one runaway agent loop spends an organization's remaining balance rather than
just its own run cap. *Why acceptable:* the organization balance still bounds the loss absolutely,
and Redis being down is rare and visible. *Cost to add back:* move the per-run cap into the same
database transaction as the hold, as a second conditional update against a per-run row. Half a
day, at the price of one more row write per model call.

**10. The gateway is a single point of failure for funded runs.**

*Worst outcome:* funded runs stop while runs on a user's own key keep working. *Why acceptable:*
the population that breaks is the one we are trying to activate, which is bad, but the paying
population is untouched. *Cost to add back:* nothing structural; it is ordinary availability work,
namely more replicas and a health check.

**11. There is no double-entry counterparty account.** Entries are single sided with a signed
direction and a reason code.

*Worst outcome:* we cannot produce an accounting-grade trial balance, and an arithmetic bug does
not announce itself by failing a sum-to-zero check. *Why acceptable:* the account counters are
already provable against the entries, which catches the same class of bug. *Cost to add back:* a
nullable `counterparty_account_id` column and a backfill derived from `code`. Additive, about two
days.

---

## 12. Open questions only the founder can answer

**1. How large is the signup grant, and does anything refresh it?** *Options:* one larger one-time
grant; a small daily refill; a monthly allowance. *Recommendation:* ship one-time in Phase 2,
sized so a new user can hold a real thirty-message conversation and still have room, and add a
small daily refill in Phase 4. A daily refill turns "I ran out" into "I will try again tomorrow",
which is a far smaller emotional event than a month-long lockout, and both Lovable and Manus use
it. The exact number is a business decision; the machinery does not care.

**2. What gates the free grant against abuse?** *Options:* nothing; email verification; a card on
file; OpenRouter's rule of raising limits once an account has ever purchased credits
(https://openrouter.ai/docs/api-reference/limits). *Recommendation:* grant on the signup path only,
never on explicit organization creation, so nobody can farm grants in a loop, and hold the
purchase-based escalation in reserve for when we see farming. It is cheap to implement and hard to
game.

**3. Hard stop or soft limit at zero, and for whom?** The account row carries `spend_policy` per
organization, so this is configuration rather than code. *Options:* hard stop for everyone; hard
stop for free organizations and allow-negative for paying ones. *Recommendation:* hard stop
everywhere in Phase 2, and flip specific paying customers to allow-negative by hand when a payment
is being sorted out. Cloudflare, at their scale, lets balances go negative and charges the card
(https://developers.cloudflare.com/ai-gateway/features/unified-billing/), which is evidence that
overshoot is normal, but that only works when there is a card.

**4. What do we charge above our cost?** The rate card holds list prices, and the multiple over
our real cost is a business decision. *Options:* charge cost, so credits are a pure pass-through;
charge a fixed multiple; charge a fixed multiple on model calls and a flat platform price on tool
calls, which is the Relevance AI split. *Recommendation:* a fixed multiple on everything for the
first version, chosen so a typical thirty-message conversation costs a number that reads well on
the pricing page. Publish the rate card and four worked examples in the Lovable style, showing
what a short conversation, a tool-using task, a long autonomous run, and a scheduled daily job
cost (https://lovable.dev/pricing).

**5. Do earned credits expire, and can they be clawed back?** *Options:* never expire; expire in
twelve months like purchases; expire faster than purchases. *Recommendation:* twelve months, the
same as purchases, because it is the least controversial expiry rule in the comparable set, and a
contributor should not feel their reward is worth less than a customer's. Clawback for a reversed
contribution stays a manual correction entry with an approver, never an automatic void.

**6. Does the Google credit cover context cache storage as well as tokens?** This matters only if
Phase 3's measurement pushes us toward explicit caching, where storage is billed by the hour
separately from tokens.

**7. Do we announce the credit system before it can be bought?** *Options:* ship the free tier
quietly and announce when purchases work; announce the whole thing at once. *Recommendation:* ship
quietly. Every public failure in the comparable set involved changing a unit after users had
learned it. Nothing forces us to publish a rate card before Phase 4.

---

## 13. Judging this design against the six-month test

The test: in six months we want to sell credits, pay people in credits for contributions, and
meter tool calls and sandbox minutes as well as model calls. Does the first version grow into
that, or does it have to be taken apart first?

**Selling credits: it grows.** A purchase is a `credit_grant` row with `source = 'purchase'`,
`priority = 100`, and a Stripe payment intent as the idempotency key. Zero schema change. The
Stripe webhook calls the same grant function the signup hook calls. What is not free is the
checkout flow, the tax handling, and the invoice, and none of that touches the ledger.

**Paying people in credits: it grows, and better than most.** A contribution award is a grant with
`source = 'contribution'` and a backdated `effective_at`. Backdating is free specifically because
we chose not to build usage periods and rollover, which is the only reason OpenMeter cannot do it.
The approver and the contribution URL live in `external_reference`. What is not free is the
product surface, the award schedule, and the review workflow.

**Metering tool calls and sandbox minutes: it grows.** Both are new callers of the same hold and
settle functions with a different `code` and a different pricing branch. The rate card already has
sections for both. The history view already groups by `code`. No schema change.

**Where it would have to be taken apart, honestly.** Three places, and I want to name them rather
than claim there are none.

If we decide we want accounting-grade double-entry books, for example to recognise revenue on sold
credits properly, we add a counterparty account column and backfill it. That backfill is derivable
from `code`, so it is real work but not a rewrite. I judged the double-entry invariant not worth
its cost now, because the account counters are already provable against the entries.

If we ever run more than one provider backend, the gateway grows conversation-affinity routing,
and the ledger grows nothing. That is a gateway change, not a ledger change, and the research is
clear that doing it naively halves the cache hit rate.

If we abandon token-derived pricing for a flat price per call, or the reverse, nothing breaks,
because both are functions over the same recorded `measurement` and both stamp a `rate_card_id`.
That is the one place where I deliberately paid a small cost now, in the `measurement` and
`rate_card_id` columns, to buy a whole category of future flexibility.

**The honest summary.** The parts that are expensive to change later are the parts I have made
concrete and specific: entries rather than a counter, integer micro-dollars, grants as rows, raw
measurement and run identifier on every debit, three counters rather than one, and a durable hold
row. Everything I deferred is either a new caller of an existing interface, a value in a table, or
a function in code, and I do not see a piece of it that a later phase has to demolish.
