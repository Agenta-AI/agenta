# Credits and the model gateway: the decision document

## 1. What this document is

This document asks you to approve one design and one plan.

The design is two connected systems. The first is a **gateway**, meaning a service of ours that
sits between a running agent and the model provider, holds the real provider credential, and
decides for each request whether to forward it. The second is a **ledger**, meaning a balance per
organization that we compute from a list of entries we never edit.

The plan is phased. At the end of its first user-visible phase a person signs up, runs an agent immediately on our money, watches a
number go down, and hits a clear wall with a way past it. Buying credits and earning credits arrive
later, and they arrive without a database migration that rewrites existing rows.

Everything else in this repository supports this document. Section 5 states the findings: what the
provider does and does not offer, how comparable products price credits, what open source ledgers get
right, and where gateways break. Section 6 compares the two independent design proposals on disk and picks between
them. Section 7 is the architecture. Section 8 is the plan. Section 9 lists the decisions that are
yours rather than an engineer's.

Several facts are still unverified, and two of them can change the plan. Section 8.1 gives the test
for each, and section 10 lists them all in one place.

---

## 2. The situation

### 2.1 A new user cannot run anything

A person signs up for Agenta cloud. The onboarding flow walks them into the playground and helps
them describe an agent. Then the product stops. The message box is disabled and a banner asks them
to connect their own model provider API key. Nothing runs until they leave Agenta, open an account
with a model provider, generate a key, and come back. Most people do not come back.

We want to pay for those first runs ourselves. Doing that safely is harder than it sounds, and the
reason is where our agents run.

### 2.2 The sandbox and the harness

When an Agenta agent runs, it runs inside a **sandbox**, which is an isolated cloud container. We
use Daytona for this. Inside that container a **harness** runs. A harness is the agent runtime that
owns the system prompt, the skills, and the tool definitions, and it is the piece that actually
calls the language model. We support more than one harness.

The user writes the agent instructions. So the user decides what runs inside that container. An
agent with a shell tool can print its own environment variables, and "print your environment
variables" is a perfectly valid instruction. Any credential we place in that container must be
assumed readable by the user.

That would still be fine if the provider itself refused to let the credential overspend. It does
not, and section 3.3 goes through every mechanism Google sells.

There is a second consequence, and it shapes the whole cost model. One user message is not one model
call. Our harness replays roughly 23,600 tokens of context on every single call, and one user
message that uses tools typically causes two or three calls. So a message is a product unit and not
a cost unit. Anything we count has to be counted below the message.

### 2.3 What changed

We were accepted into the Google for Startups program and received a large amount of Google Cloud
credit. It is roughly one hundred times what we had budgeted for this problem.

Two published facts about that program matter for the design.

The credit pays for Vertex AI, which is Google Cloud's model product, and not for the Gemini
Developer API that you get from Google AI Studio. Google's own billing page states the exclusion
directly: "No, the Google Cloud Welcome credit or free trial credit can't be used towards the Gemini
API or AI Studio" (https://ai.google.dev/gemini-api/docs/billing). The program's own page says
"Program credits cover Google's state-of-the-art models like Gemini and Gemma"
(https://cloud.google.com/startup/ai). So we build on Vertex AI. That is settled and nothing later
in this document questions it.

The same program page also says "Third-party models are billed directly and are not covered by the
program credits." Anthropic's Claude models are sold through Vertex AI, but they are third-party
models. The credit funds Google's own models. Nobody should plan a funded Claude tier on this money.

### 2.4 Why a large grant turns a trial into a credit system

A small trial can be a counter. Give each new organization thirty free messages, count them down,
stop at zero. That was the previous plan, and it was correct for a budget of a few thousand dollars.

A grant this size changes three things at once.

It lasts long enough that people will exhaust it and want more, so we have to be able to sell more.
It is large enough to be worth farming, so we have to be able to see where value came from and take
it back. And it makes the earning path realistic, because paying a contributor in usage balance is
only interesting when the balance is worth something.

Once people can buy a balance and earn a balance, a counter stops working. A counter cannot say
where value came from. It cannot expire a promotional grant while leaving purchased value alone. It
cannot answer a customer who disputes a charge. And the moment its meaning changes, there is no
correct way to split it.

Dify is the clearest published example. Dify tracked hosted model usage as a mutable counter on a
provider row. In January 2026 they had to move to credit pools, and the counter could not be split,
because nothing had ever recorded the individual deductions. There was no backfill, so they wrote a
fallback branch instead. The cost is still visible today as a three-way branch in their provider
manager and a class of tenant whose deduction lands nowhere
(`research/03-project-dify.md`, section "The move from a counter to credit pools, and what it
cost").

That is the mistake this design is shaped to avoid. It is also the only place where "simple and fast
to build" and "extensible without a painful migration" genuinely pull against each other, and it is
the one place where I recommend spending the extra work now.

---

## 3. Requirements and constraints

### 3.1 What the first version must do

**Keep our provider credential out of the sandbox.** Assume anything inside the container is
readable by the user.

**Stop the spending when a balance runs out.** Nothing the provider sells can do this for us, which
section 3.3 establishes.

**Count consumption in a way we can explain.** A person whose free credits vanished in ten minutes
will ask which agent run did it. Only a per-charge record with a run identifier can answer that, and
that record cannot be created after the fact.

**Give new organizations a balance automatically**, with a control that lets us fund ten percent of
signups before we fund all of them.

**Show the balance, and show the price of the thing the user just did.** Dust prints the credit cost
of each interaction inside the conversation itself (https://docs.dust.tt/docs/credits). Nothing else
in the comparable product set does this, and it teaches an invented unit better than any definition.

**Refuse cleanly at zero.** The gateway returns a payment-required response with a readable message,
and the product shows a state with a way forward. Silence is the worst possible outcome, and we have
a known class of bug where an errored turn renders as an empty message.

**Break neither streaming nor prompt caching.** Section 4.7 explains why the second one is worth
roughly five times our model bill.

**Stay inside the commercial edition.** All of this sits behind the existing `is_ee()` check
(`api/oss/src/utils/common.py:51`). The open source and self-hosted product does not change.

### 3.2 What the full system must eventually do

Sell credits for cash, with a payment record attached to the resulting grant. Pay contributors in
credits for a skill, an article, or a video, with an approver and a reason recorded, and with the
ability to date the award to when the contribution happened rather than when we noticed it. Meter
tool calls and sandbox minutes in the same unit as model calls. Expire different grants on different
dates and spend them in a defined order. Refund a charge when a run failed for our reasons. Compare
our recorded consumption against the provider's invoice and explain every difference. Restate a
period after a price change without rewriting history. Eventually serve more than one provider
account, with each conversation pinned to one account so a cache is never split.

One thing the full system must never add. Credits must not become transferable between users,
redeemable for cash, or usable as currency between accounts. That changes the legal character of the
product and it does nothing for the activation problem.

### 3.3 The constraints that are not negotiable

**Our provider does not sell a per-key spending limit.** This is the constraint that forces the whole
architecture, so it is worth going through every mechanism rather than asserting it.

| Mechanism | What it bounds | Smallest unit | Time to take effect | Bounds one end user? |
|---|---|---|---|---|
| Alerts-only budget | Nothing. It sends email | Project or billing account | Hours | No |
| Budget plus automation that disables billing | Everything in a project | Project | Hours | No |
| Spend cap budget (public preview) | One service in one project, per calendar month | Project and service | Minutes | No |
| Quota override set to zero | Not available for Gemini at all | Project, folder, org | Not applicable | No |
| API key restrictions | Which APIs and callers, never how much | Key | Immediate | No |
| Identity and access management | Allow or deny | Identity | Immediate | No |
| Anything inside Vertex AI | Throughput, not spend | Project | Varies | No |

The sources, in order. Google states that alerts-only budgets "don't automatically prevent the use
or billing of your services" (https://docs.cloud.google.com/billing/docs/how-to/budgets). Spend caps
shipped in public preview around July 2026 and are a genuine hard stop, but Google states they are
"limited to budgets that are scoped to a single Google Cloud project and a single eligible service",
that the period "is limited to Monthly", and that lifting one is manual
(https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps). Gemini models on Vertex use
dynamic shared quota, and Google's page says plainly "There are no quotas with DSQ"
(https://docs.cloud.google.com/vertex-ai/generative-ai/docs/dsq). API keys carry restrictions on
which APIs they may call, never on how much they may spend
(https://docs.cloud.google.com/docs/authentication/api-keys).

The finest control Google offers is one project, one service, one calendar month, lifted by hand. We
need one organization, per conversation, resuming by itself when the user buys or earns more. That
is not a narrow gap. It is a different kind of control. So the limit has to sit on a machine we own,
in the path of every request.

The spend cap is still worth adopting, as a second layer under our own. If our gateway has a bug and
lets through a hundred times the intended traffic, Google stops the bleeding within minutes with
nobody awake. Set it above the amount we intend to spend in a month and treat a trigger as an
incident. Note that it counts gross costs and ignores credits, so it is a direct control on burn
rate, and note that it pauses the whole free tier for everyone until a human lifts it.

**Our runner speaks one dialect.** A **dialect** is the exact request and response shape an API
expects. OpenAI's chat completions dialect posts a `messages` array to `/v1/chat/completions` and
returns `choices` and `tool_calls`. Google's own dialect uses `contents` and `parts` and carries the
same ideas under different names. Our runner emits the OpenAI dialect and only that one:
`services/runner/src/engines/sandbox_agent/pi-model-config.ts` declares
`export type PiProviderApi = "openai-completions"` and calls it "the only value v1 supports". Adding
a second dialect is possible and it is real work.

We get lucky here. Vertex AI publishes an endpoint that speaks the OpenAI chat completions dialect
(https://docs.cloud.google.com/vertex-ai/generative-ai/docs/migrate/openai/overview). So the first
version can be a pass-through with an authentication swap, and no field mapping at all.

**Prompt caching dominates cost.** Our harness replays about 23,600 tokens on every call. Google
prices cached input at exactly one tenth of normal input across the Gemini 3 lineup. Caching is
therefore worth about 4.7 times on a whole conversation. Any design that breaks the repeated prefix
makes the same conversation about five times more expensive.

**We deploy with docker compose on EC2.** Anything that assumes Kubernetes is out, which rules out
Envoy AI Gateway. It also weighs against TigerBeetle, whose own documentation says running it in
Docker "is not recommended", which wants 6 to 32 GiB of RAM per replica, and which has no
authentication of any kind.

**The provider relationship stays private.** The funding source, the credit amounts, the account
details, and the deployment topology never appear in the public repository, in public pull requests,
in public documentation, or in logs that leave our infrastructure. The program terms require it.
Section 7 of those terms says the company "may not disclose the terms, conditions or existence of
any non-public aspect of the Programs to any third party"
(https://cloud.google.com/terms/startup-program-tos).

### 3.4 One stated requirement that should change

The brief describes the earning path as a growth engine. The design must support it and this one
does. But the first version should not build automatic contribution scoring, and both design
proposals reached that conclusion independently.

The precedent is thin and mostly discontinued. Activepieces ran a rewards program from 2024 that
paid contributors for templates and connectors, and a community member noted in August 2025 that the
program was gone (https://community.activepieces.com/t/introducing-rewards/3870). n8n rewards
contributors with status, distribution, and cash commission rather than usage balance
(https://n8n.io/affiliates/). We are ahead of the field here, not behind it.

So the requirement becomes this. The ledger must make an earned credit indistinguishable from a
purchased one at the data layer. The first version of the earning path is a human approving an award
against a published schedule. That is one entry in the ledger and a product decision. Automating it
later touches no schema.

---

## 4. The machinery

This section teaches the parts. Everything after it is short because of it.

### 4.1 What a ledger is, and why balances are derived

A **ledger** is a list of entries that only ever grows. You never edit a row. If you got something
wrong, you add a correcting row that cancels it. The **balance** is not stored as the truth. It is
the sum of the entries.

A **debit** is an entry that takes value out. A **credit entry** is one that puts value in. A grant,
a purchase, and a contribution award are credit entries. A model call is a debit.

Here is the concrete difference from a counter. A counter says `credits_used = 1500`. That number
cannot tell you whether those 1,500 came from a signup grant or a purchase, which run spent them, or
what the price list said at the time. A ledger says:

```
2026-08-03 10:14  +2000  grant       signup campaign, expires in 90 days
2026-08-03 10:31    -12  model_call  run 4f2a..., gemini-3-flash, 23,500 cached input tokens
2026-08-03 10:31     -4  model_call  run 4f2a..., gemini-3-flash, 23,600 cached input tokens
```

The balance is 1,984. Every question a customer or an accountant can ask is answerable from those
rows.

Storing the balance is still allowed, and it is what everybody serious actually does. TigerBeetle,
which is a database that does nothing except double entry accounting, stores the balance on the
account and updates it in the same step that writes the transfer
(`research/03-project-tigerbeetle.md`, section "How a balance is produced"). The instinct that
recomputing on every read is the rigorous option is wrong. The rigorous option is to store the
balance, write the entry in the same database transaction, and keep the entries so the stored number
can be proven. A nightly query that recomputes the balance from the entries and alerts on a mismatch
is about twenty lines, and it is only possible because the entries exist.

### 4.2 What idempotency means, and the failure it prevents

**Idempotency** is the property that doing the same operation twice has the same effect as doing it
once. You get it by attaching a unique identifier to the operation and refusing to apply the same
identifier twice.

The failure it prevents is concrete. A payment webhook fires, we grant 10,000 credits, our response
is lost, the payment provider retries the webhook, and we grant 10,000 credits again. Or our gateway
writes a charge, the write times out but actually committed, we retry, and the user pays twice for
one model call.

The fix is one database column and one unique index. The key for a purchase is the payment
identifier. The key for a signup grant is the organization identifier plus the campaign name. The
key for a model charge is the gateway's own request identifier, minted before the provider is
called, so a retry lands on the same key.

The important detail is where the check lives. LiteLLM, which is the closest thing to our gateway in
the open source world, has exactly one durable idempotency guarantee, and it is on the log table
rather than on the charge. Its guard against settling the same reservation twice is a Python
dictionary in one worker's memory that dies when the process dies
(`research/03-project-litellm-proxy.md`, section "Idempotency"). OpenMeter's newer ledger states the
rule in its own README: atomicity is not idempotency, and the domain that starts the operation has
to supply the key. Put the key in the database.

### 4.3 What a hold is, and why an unknown cost needs one

A **hold**, also called a reservation, is value set aside before the real amount is known. The
everyday version is a fuel station. It holds a round number on your card, you pump an unknown
amount, and the station then **settles** for the true amount and releases the rest.

That is exactly our shape. We do not know what a model call costs until the response comes back,
because the cost depends on how many tokens the model produced and on whether the provider's cache
was hit.

Here is what goes wrong without one. An organization has 100 credits left. Twenty calls arrive at
the same moment. All twenty read the balance, all twenty see 100, all twenty are allowed, and each
one costs 40. The organization has now spent 800 credits against a balance of 100. Nothing about the
check was wrong. The check read a number that only reflects calls which have already finished, and
the cost of a call is not knowable until it finishes.

The overshoot is bounded by a simple formula:

```
worst case overshoot = (calls in flight at once) x (maximum cost of one call)
```

Both factors are controllable. That matters, because it means you do not always need a hold. If you
can make that product small enough to ignore, checking the balance is enough. That is the argument
behind the alternative design in section 6.4.

With a hold, the sequence is:

1. Estimate the most this call could cost.
2. In one atomic step, add that estimate to the reserved total and read the result back.
3. If the result exceeds the balance, undo it and refuse the call.
4. Otherwise run the call.
5. When it finishes, replace the reservation with the true amount and release the difference.

Now the twenty concurrent calls each add 40 as they arrive. The third one takes the total to 120,
sees that it is over 100, and is refused. The overshoot is at most one call's estimate.

Holds bring their own failure modes and they have to be designed for. A hold that is never settled
leaks, and the balance stays wrongly low until something clears it. LiteLLM's cancellation code
records exactly this: an unreconciled reservation pins the counter above real spend and causes
refusals until a cache entry expires, and because their counter's expiry is refreshed on every write,
a busy key can stay wrong indefinitely. Our answer is that a hold is a durable database row with a
state and a deadline, so a background job can find it and release it.

Two rules from TigerBeetle deserve to be stated, because they are what make the pattern safe.

The balance check happens when the hold is placed and never when it settles. Settlement can then
never be refused, because it settles at most what was already reserved. We refuse before spending
money, and we can always record what we spent.

The check includes reserved amounts, not only settled ones. An organization with 100 received, 70
spent, and 50 held will refuse a new hold, because 70 plus 50 already reaches the ceiling. A hold is
money you have promised away.

### 4.4 What a lot is, and why grants stay separate

A **lot**, also called a credit lot, is one batch of credits that arrived together. A signup grant is
one lot. A purchase is another. An award for writing a skill is a third.

Keeping them separate matters because they are not interchangeable. A promotional grant should
expire; a purchase should not expire for a long time. A promotional grant should be spent before
money somebody paid us. And when a customer asks why their balance changed, the answer often is that
a promotion expired.

The product still shows one number. The lots are internal. OpenMeter implements exactly this, and its
grant row is worth copying almost verbatim: an amount, a priority, a date it becomes effective, an
optional expiry, and a nullable field marking it as cancelled. There is no "amount remaining" column,
because the remainder is derived
(`research/03-project-openmeter-credit-engine.md`, section "The data model").

The order in which lots are spent is a real product decision, and section 6.2 makes it.

### 4.5 What a gateway does

A **gateway** here means a service that receives a request meant for the model provider, decides
whether to forward it, forwards it with the real credential swapped in, and watches the response go
past. It is a specialised reverse proxy.

The path has seven steps, and every gateway in existence is a variation on it.

1. The caller sends a request to the gateway's address instead of the provider's, presenting a
   credential the gateway issued rather than the provider's own.
2. The gateway works out who is calling: which organization, which project, which run.
3. It decides whether to allow the call. This is the entire reason the thing exists.
4. It rewrites the request. At a minimum it swaps the credential and the address.
5. It forwards and receives a response.
6. It relays the response back.
7. It records what happened.

Two structural choices separate the implementations. The first is whether the accounting happens
before or after the response reaches the caller. Doing it before is accurate and slow. Doing it after
is fast and can lose data. The second is how much of the request the gateway rewrites. A gateway that
swaps a header and a hostname has almost no failure modes. A gateway that parses, normalises, and
rebuilds the body inherits every bug in its own translation layer, and section 4.7 explains what
those bugs cost in money.

### 4.6 Why streaming makes this harder

A model can return its answer all at once, or a few words at a time so the user sees text appear
immediately. The second mode uses **server-sent events**. That is a plain HTTP response whose body is
a sequence of lines like `data: {...}` separated by blank lines, and in the OpenAI dialect it ends
with the literal line `data: [DONE]`. Each such line is a **chunk**.

Four things go wrong.

**Buffering destroys the feature silently.** If anything in the chain accumulates the whole response
before forwarding it, the user waits for the entire answer before seeing the first word, and the
answer is still correct so no test fails. For nginx the settings are `proxy_buffering off;` and
`chunked_transfer_encoding on;`. For our workload, with two or three calls per user message, this is
the difference between an agent that feels alive and one that appears frozen for tens of seconds.

**The status code is committed after the first byte.** Once the gateway has written one byte
downstream, it cannot return a 402 or a 500 any more. Every refusal decision has to happen before
forwarding. An error that happens mid stream has to be delivered as an event inside the stream.

**The token counts arrive last, or not at all.** In the OpenAI dialect a streamed response carries no
usage numbers unless the caller sends `stream_options: {"include_usage": true}`. When they do, one
extra final chunk carries the usage and an empty `choices` array. So for most of a call's life the
gateway does not know what the call cost.

**A caller who disconnects takes the numbers with them.** The user closes the tab. The provider does
not know and keeps generating, and it will bill us. If the gateway stops reading, it never sees the
final chunk and never learns the cost. This is not hypothetical. It is LiteLLM issue 14457, titled
"Usage data lost when streaming responses are terminated early by client disconnect", where the
provider bills LiteLLM and LiteLLM cannot bill anyone
(https://github.com/BerriAI/litellm/issues/14457). The fix is small: catch the write failure, stop
writing downstream, and keep reading upstream until the response ends.

### 4.7 Why caching makes it harder, and what it is worth

**Prompt caching** means the provider stores the processed form of a repeated beginning of a prompt
and charges much less when the next request starts with the same bytes. The repeated beginning is
called the **prefix**. Caching only ever applies to a prefix. It never applies to a passage in the
middle.

Our harness replays roughly 23,600 tokens on every call, and Google discounts cached input by 90
percent. So caching is the single biggest lever we have, and a proxy sitting in the middle can
destroy it in four ways.

**Rebuilding the body.** If the gateway parses the JSON into objects and writes it back out, the key
order and the exact formatting can change. Whether that breaks the cache depends on whether the
provider hashes raw bytes or a normalised form, and no provider documents this. The failure is
silent: you pay full price and get no error.

**Injecting anything into the prefix.** OpenAI's cached portion includes the whole messages array,
tool definitions, and structured output schemas. Anthropic requires the prefix to be byte identical,
and reordering a tools array or inserting a timestamp before the cache marker causes a miss with no
error. So nothing of ours may enter `messages`, `tools`, or the system prompt. Our metadata travels
in the URL, in headers, or in the credential.

**Splitting traffic across backends.** If a gateway spreads one workload across several provider
accounts at random, each account gets a cold cache and the hit rate falls to roughly one over the
number of accounts, even though nothing about the request changed. The rule is to route by
conversation, never round robin.

**Translating between dialects.** Every cache-related bug in LiteLLM's tracker is a translation bug.
A cache marker applied to every content item instead of the last one
(https://github.com/BerriAI/litellm/issues/15696). A beta header set unconditionally so Vertex
rejects the request outright (https://github.com/BerriAI/litellm/issues/14293). Cached token counts
not normalised into the standard field, so the metric that would have shown you the problem never
increments (https://github.com/BerriAI/litellm/issues/27763).

### 4.8 Where the two systems meet, and the one failure nobody solves

A hold written in our database and a call sent to the provider are two writes to two systems. Every
ledger project tells us how to make each of our own writes safe. None of them tells us what to do
when the provider call succeeds and our settlement write does not.

There is no general solution, and pretending otherwise would be dishonest. What we can do is bound
it. The hold is a durable row, so a call that was attempted always leaves evidence even when the
result is lost. A background job finds unsettled holds after a deadline, releases them, and raises an
alert. We then know the size of the loss even when we cannot attribute it, which is strictly better
than the state LiteLLM is in, where in-memory queues drop data on failure and write a log line.

---

## 5. Findings

### 5.1 The provider and caching

**Caching on Gemini comes in two forms and both discount by 90 percent.** Implicit caching is on by
default for every Google Cloud project and costs nothing to use, but it is best effort and Google
does not tell you when it misses. Explicit caching is a resource you create and reference by name,
and Google guarantees the discount for content that references it
(https://docs.cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview).
An explicit cache can hold a system instruction, contents, tools, and tool configuration, which is
almost exactly the shape of our 23,600-token prefix.

**Google does not publish how long an implicit cache entry lives.** Their only guidance is to "send
requests with similar prefix in a short amount of time". That missing number is the largest
uncertainty in the cost model, because our traffic is bursty. Two or three calls land within seconds
inside one user message, then the conversation may pause for minutes, then the user may vanish for
hours.

**What that means in money.** Taking our measured 23,500-token replayed prefix, 130 tokens of new
conversation per turn, 120 output tokens per call, three calls per user message, and a thirty-message
conversation:

| Model | No cache | Cached | Conversations per $1,000, no cache | Conversations per $1,000, cached |
|---|---|---|---|---|
| Gemini 3.1 Pro Preview | $4.72 | $1.00 | 212 | 1,000 |
| Gemini 3.5 Flash | $3.54 | $0.75 | 282 | 1,330 |
| Gemini 3 Flash Preview | $1.18 | $0.25 | 847 | 3,984 |
| Gemini 3.1 Flash-Lite | $0.59 | $0.13 | 1,695 | 8,000 |
| Gemini 2.5 Flash | $0.72 | $0.16 | 1,389 | 6,250 |

Prices come from https://cloud.google.com/vertex-ai/generative-ai/pricing. The cached column assumes
90 percent of input tokens are read from cache.

There is a middle case that is probably what implicit caching alone actually gives us. If the first
call of each user message misses and the second and third hit, a thirty-message conversation on
Gemini 3.5 Flash costs $1.68 rather than $3.54 or $0.75. Caching that works only inside a burst
recovers about half the money. Caching that works across a whole conversation recovers about four
fifths.

**Explicit caching is obviously worth it if we need it.** Storing our 23,500-token prefix costs
$0.0235 per hour on a Flash-tier model, which is about $17 for a month of continuous storage. One
cached thirty-message conversation saves $2.79. A single conversation pays for more than a hundred
hours of storage. The catch is that the prefix is not identical across users, because the user writes
the agent instructions. The realistic unit is one cache per agent revision, created on the first call
of a conversation and allowed to expire.

**Vertex AI publishes an OpenAI-compatible endpoint and it supports what we need.** Streaming, tools,
tool choice, and a Google-specific `extra_body` that can carry an explicit cache reference. So
choosing this dialect does not cost us caching.

**One parameter is missing from Google's supported list and it is the one metering depends on.**
`stream_options` with `include_usage` is how an OpenAI-dialect client asks for token counts on a
streamed response. It does not appear in Vertex's supported parameter list, and Google states that
unsupported parameters are ignored rather than rejected. Google's separate Developer API page does
document it, but that is the other product. **Whether the Vertex compatible endpoint returns usage on
a streamed response is unverified.** Two live calls settle it, and section 8.1 gives the test.

**Gemini 3 has a landmine and it has a name.** Gemini 3 models attach an encrypted blob called a
**thought signature** to every function call they emit, and they reject the next turn if it is not
sent back. Google's wording: "If a required thought signature is not returned when using Gemini 3
models, the model will return a 400 error"
(https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thought-signatures). Through the
OpenAI-compatible endpoint the blob arrives at
`tool_calls[N].extra_content.google.thought_signature`, which is not a standard field, so ordinary
clients parse the tool call into their own types and drop it. This is reproduced against the Codex
CLI (https://github.com/openai/codex/issues/7519), VS Code, the OpenAI Python SDK, the OpenAI Agents
SDK, and Goose. Our harness has this bug. Pi's OpenAI adapter round-trips encrypted reasoning only in
OpenRouter's format and never reads or writes `extra_content`.

Google's own wording is that "Gemini 3 models enforce stricter validation on thought signatures than
previous Gemini versions", which strongly implies a Gemini 2.5 model works through this endpoint with
today's harness and no extra work. That is an implication, not a documented fact, and section 8.1 has
the test.

**Throughput could bite before the money does.** Gemini on Vertex has no fixed quota. Each
organization gets a baseline throughput that rises with spend over a rolling thirty-day window. At
Tier 1, a Flash model gets 2,000,000 tokens per minute across the whole organization. At 23,500 input
tokens per call that is about 85 calls per minute, which at three calls per user message is about 28
user messages per minute across the entire platform. Traffic bursts above the baseline on a
best-effort basis, and the tier climbs as spend accumulates, so this is a soft limit rather than a
wall. It is still worth knowing before a launch that goes well.

**One thing belongs to Google rather than to a test.** Whether the credit covers context cache storage
as well as tokens.

### 5.2 How comparable products price and present credits, and what users hate

Twelve products answer the same questions in public: what the unit is, what consumes it, whether a
price list is published, how much is free, what happens at zero, and what happens when a user brings
their own key.

**There are only four ways to name the unit.** Money, as Cursor and v0 and OpenRouter do. An abstract
credit, as Gumloop, Dust, Lindy, Manus, Lovable, and Make do. A count of user actions, as Zapier and
n8n do. Or no meter at all, with usage included in a seat price, as Langdock does and as Dust did
until mid 2026.

**The direction of travel is clear and it goes one way.** Products that started with action counts or
unlimited seats have moved toward credits or money, because agents made the variance too large to
absorb. Every one of those moves produced a public backlash. Dust ran a flat seat with unlimited
messages for two years and converted to credits in June 2026. GitHub is retiring its premium request
unit, which was the most elaborate abstract unit in the set. That pattern, and not any individual
price, is the most useful thing here.

**Users complain about six things, and each one has evidence.**

They cannot learn the price before they commit. Manus states this about itself: "At present, Manus
does not possess the capability to autonomously judge or regulate the consumption of credits"
(https://help.manus.im/en/articles/13185575-is-there-a-way-to-check-how-many-credits-a-task-will-cost-before-i-begin).
That single sentence explains most of their complaint volume.

The vendor's own failures spend their balance. Bolt users report burning ten million tokens failing
to fix one bug. Two companies handle this correctly and say so in writing. Zapier's pricing page
states "Failed actions are not counted" (https://zapier.com/pricing). Manus refunds credits for tasks
that failed for technical reasons on its side.

The unit maps to nothing they can picture. An industry write-up quotes a go-to-market lead saying
"Our finance team likes it. Our customers don't know what a credit does".

The exchange rate moves under them. A pricing consultancy compares credits to airline miles, which it
says devalue at about 15 percent a year. Cursor replaced a request-based allowance with a money-based
one in June 2025, apologised publicly, and offered refunds
(https://cursor.com/blog/june-2025-pricing).

The balance display gets worse over time, and they read that as dishonesty. At the end of July 2026
Cursor removed dollar amounts from the usage page for self-service plans. Users called the page
"completely useless" and "sketchy", and asked "How can I track the per-user and per-model spend like
before???" (https://forum.cursor.com/t/usage-page-to-token-amount-what/167153). Cursor's stated reason
is instructive and not unreasonable: showing a customer that they consumed $60 of usage on a $20 plan
made them think they owed $60. That is a real problem, and it is solved with a label rather than with
a deletion.

Refresh and expiry dates surprise people. A Gumloop user assumed a calendar-month refill and learned
that free credits refill on the signup anniversary. Lovable runs three pools with three different
expiry rules at once.

**The most important single behaviour to copy comes from Dust.** Their documentation says: "After
each message, Dust shows the credit cost of that interaction directly in the conversation"
(https://docs.dust.tt/docs/credits). Nothing else in the set does this. It turns a meaningless unit
into a learned intuition after about ten messages, and it removes the need to visit a billing page at
all.

**The second is Lovable's worked examples.** Their pricing page prices four ordinary sentences. "Make
the button gray" is 0.50 credits and "Build me a landing page, use images" is 1.70
(https://lovable.dev/pricing). A reader places their own intended work between those in seconds. A
formula involving tokens takes minutes and is usually skipped.

**One pattern is directly relevant to a funded free tier being farmed.** OpenRouter raises the daily
free-model limit from 50 requests to 1,000 once an account has ever purchased at least $10 of
credits, and blocks free models entirely at a negative balance
(https://openrouter.ai/docs/api-reference/limits). That is cheap to implement and hard to game.

**One pattern is a direct warning about our own harness.** Replit moved to what it calls effort-based
pricing, where the charge depends on how much work the agent decided to do. In September 2025, after
a more autonomous agent shipped, The Register reported users seeing bills jump by an order of
magnitude, with one saying "I spent $1k this week alone" against a previous average of $180 to $200 a
month (https://www.theregister.com/2025/09/18/replit_agent3_pricing/). Nothing about their price list
changed. The agent simply did more work per sentence. Our harness has exactly this property, because
we decide how many model calls a user message causes.

### 5.3 What open source ledgers teach

Four projects matter here, and in each one the source says more than the documentation does. Each
answers a different question.

**LiteLLM is the domain twin and the stack twin.** It is Python on FastAPI with Postgres and Redis, it
holds real provider keys, hands out its own keys, and refuses calls once a budget is spent. It is the
only gateway in the comparison that takes a hold before the call rather than checking a number the
previous calls produced.

Four things are worth copying from it directly. The admission gate is a single atomic Redis increment
whose returned value is the decision, with no lock and no compare-and-swap loop. The settle applies a
delta of `actual - reserved`, and tracks what has already been applied so a repeat is harmless.
Settlement runs on all four exit paths, including client cancellation, wrapped so it completes even
while the surrounding task is being cancelled. And the daily rollup table has a unique constraint with
increment upserts, and separate columns for cache reads and cache writes.

Their cancellation reasoning is the kind of thing you only learn in production, and it applies to us
unchanged: settle a cancelled call to the input token cost rather than refunding to zero, because the
provider call was already dispatched so the input was billed, and refunding to zero would let a caller
abort early to dodge the charge.

Three things must not be copied. The mutable `spend` column as the source of truth, which has no entry
for a grant, no entry for a purchase, and no way to answer where credits came from. The silent loss:
their queues drop data on failure and write a log line, and the design cannot tell you afterwards how
much it lost. And holds that exist only in memory, which is why a crashed worker leaves an inflated
counter that only sixty seconds of silence can clear.

The licence is clean for us. LiteLLM is MIT except for its `enterprise/` directory, and every budget
file we care about lives outside it.

**OpenMeter has the grant model done properly.** Its grant row is immutable, and carries an amount, a
priority, an effective date, an optional expiry, and no "amount remaining" column. Its burn order is
three stable sorts, and its own tests confirm the behaviour. Its snapshot design answers how to avoid
replaying history on every read, and its rule that a snapshot is only a cache, so a writer that cannot
get the lock simply skips it, is a good instinct.

Two of its properties are traps for us. It has no debit rows at all, because it re-queries usage from
an analytical database on every read. We do not have that database and should not adopt one. And its
history can say which lot was drained and when, but it cannot say which request drained it. A person
whose free credits vanished will ask which run did it, and a segment-level history cannot answer.

One finding is directly useful. OpenMeter refuses to backdate a grant before the current usage period,
and the only reason is that a period reset may already have computed a rollover. We are not building
usage periods or rollover. So backdating a contribution award to the date the article was published is
free for us, because of a feature we chose not to build.

**TigerBeetle is the specification for holds.** Four counters on the account: `debits_pending`,
`debits_posted`, `credits_pending`, and `credits_posted`. A hold moves value into the pending fields.
A second, separate transfer posts or voids it, and posting less than the reserved amount releases the
rest automatically, with no third transfer to write. Transfers are never edited, and the hold's status
lives in a small separate row, which is what makes "resolve exactly once" a single guarded update.
Idempotency is structural, through a caller-chosen identifier.

Its concurrency answer is the one thing we cannot copy, because it has no concurrency: one thread, one
core, one leader, with requests ordered by consensus before the accounting code ever sees them. Jepsen
tested it and found no violation of the accounting invariants, and nine of its ten findings sit in
layers we would not be writing. The class of bug the audit does not protect us from is the one we are
most likely to write, which is a lost update, and avoiding it is the single thing our implementation
must get right.

Two of its rules must be inverted for us, deliberately. TigerBeetle refuses to settle a hold that has
expired, and refuses a settlement larger than its hold. Both are correct for a bank, where an expired
authorization must not be captured. Both are wrong for us, because by the time we find out, the
provider has already charged us. Refusing to record the cost loses real money and hides it.

**Dify shows us the cheap version and what it costs.** Dify charges a flat integer number of credits
per model call, chosen per model from a comma-separated environment variable, and deducts after the
message is created. There is no table of deductions anywhere. Their capped deduction takes whatever is
left in the pool and writes a warning to the log when it comes up short.

That design is genuinely attractive, and section 6.4 takes it seriously as an alternative. Its
failures are also instructive.

Their worst case overshoot is severe. The pre-flight check only asks whether the balance is above
zero, so a workspace with one credit left can start an agent loop of up to a hundred model calls, and
the counter still moves by exactly one credit.

Their accounting can destroy the thing it is accounting for. If Redis is unreachable when the
deduction runs, the exception escapes the signal handler and the message row is never committed, so
the user watches an answer stream in and finds an empty message when they reload.

And their balance clamps a deficit out of existence, with `max(0, limit - used)` in the model and
`min(required, remaining)` in the deduction. The system cannot represent the money it lost, so it
cannot report it or alert on it. The floor belongs in the display, never in the data.

### 5.4 How gateways are built, and where they break

**Almost nobody takes a hold.** Cloudflare, Kong, Envoy, and the routing products all check a number
that previous requests produced, and accept that concurrent requests overshoot. Envoy AI Gateway is
the clearest statement of the problem: the limit check uses the count accumulated from previous
requests, because this request's token count does not exist yet. That is not a mistake anyone made. It
is what happens when the cost is only knowable afterwards.

**Cloudflare, at their scale, lets balances go negative** and charges the card
(https://developers.cloudflare.com/ai-gateway/features/unified-billing/). Their fee for running this
service is 5 percent on credits purchased. Both numbers are useful calibration.

**The embedded family teaches four patterns.** These are the platforms that built the minimum gateway
they needed rather than selling one.

They pick a coarse unit. Dify charges a fixed number of credits per model call, and Activepieces
charges 2 to 20 credits per AI step. Neither converts tokens to money in real time for a free tier.

They charge after the fact and accept overshoot. Nobody fails a response the user already received.

They keep the model allowlist explicit. Dify's hosted quotas name the exact models the free allowance
may be spent on. This is the control that actually bounds cost, more than the balance does, because it
stops a cheap allowance being spent on an expensive model.

They put run identity in the URL, not the body. n8n encodes the execution and workflow identifiers as
a path prefix that the gateway strips before proxying, so the client library never knows it is there
and the request body is untouched. That is the difference between preserving prompt caching and
destroying it, and we should copy it or carry the identity in the credential.

**n8n is the closest analogue to our situation and their first version is tiny.** They ask their cloud
service for credits, get back an API key and a base URL, and store them as a managed credential in the
user's project. The user then picks that credential in a node like any other. They did not change the
node at all, because the node already accepted a key and a base URL. We have the same property.

**Dify has one structural difference from us that decides everything.** Dify makes the model call from
its own backend, so the credential never leaves their server and they do not need a proxy at all.
Their "gateway" is a branch inside the application that picks the hosted credential. We cannot do
that, because our model calls originate inside a container the user controls. That single fact is why
we have to build a network service where Dify only needed a function call.

### 5.5 What already exists in our own code

More exists than you would expect, and two pieces are load-bearing.

**We already run the atomic conditional write.** `MetersDAO.adjust()` at
`api/ee/src/dbs/postgres/meters/dao.py:376` performs an `INSERT ... ON CONFLICT DO UPDATE` with the
limit written into the `WHERE` clause, a `greatest(value + delta, 0)` clamp, and a `RETURNING` that
tells the caller whether the write landed. The `RETURNING` is what makes it a decision rather than a
fire-and-forget write, and it is exactly what Dify's equivalent statement lacks. Negative deltas
already work, so refunds already work. We do not need to invent the concurrency primitive. We need to
reuse its shape.

**A route already exists that points a run at a base URL we choose.** When a connection resolves to
provider `openai`, deployment `custom`, and connection mode `agenta`, the runner writes a per-run
`models.json` naming our base URL and exactly one model
(`services/runner/src/engines/sandbox_agent/pi-model-config.ts`, `buildPiModelConfigPlan`). The
credential is referenced as `$OPENAI_API_KEY` and the raw value never enters the file. This path is
tested, including by a replay test with a recorded fixture. So the first version needs no new runner
contract, no new dialect field, and no new base URL mechanism.

**That route has one gap, and it must be closed on day one.** The builder requires a connection object
with mode `agenta` and a slug. A brand new user's default agent emits no connection object at all,
because the project default carries no information beyond the model. With no connection on the wire,
the runner writes no plan, the run falls back to the default provider host, and our credential goes to
api.openai.com. The fix is one reserved connection slug emitted by the SDK when the resolved
connection is platform-funded, plus one test on each side. It has to be proven end to end from a real
default agent with an empty vault before anything else is built.

**Two more facts to know.** The model pinning inside `models.json` is configuration, not a boundary,
because an agent with a shell can read the credential and call a different model at the same base URL.
And `api/oss/src/core/gateway/` already exists and holds the tool gateway, meaning connections and
catalogs for Composio. The new code is called `model_gateway`, everywhere, with no exceptions.

**The enterprise migration chain is separate and its head is `ee0000000003`**, in
`api/ee/databases/postgres/migrations/core_ee/versions/`, with its own version table. New revisions
continue that chain.

---

## 6. The proposals

Two complete design proposals sit on disk, written independently. They are `design/proposal-a.md` and
`design/proposal-b.md`. This section says where they agree, where they differ, and what I would
build.

### 6.1 Where they agree

Agreement between two independent designs is itself evidence, so this list is stated once and then
treated as settled.

Both propose one abstract credit permanently pegged to money at one tenth of a United States cent, so
a thousand credits equal one dollar, and both say the peg must never move. Both store integers and
reject floating point. They even chose the same granularity under different names, because proposal
A's micro-dollar and proposal B's millicredit are the same amount of money.

Both build an append-only entry log with the balance stored as a projection, written in the same
Postgres transaction as the entry. Both mirror TigerBeetle's separation of pending and posted amounts.
Both take a hold before the call and settle after. Both invert TigerBeetle's two refusal rules for the
same reason, which is that our money is already spent, so a settlement must never be refused for
exceeding its hold or for arriving after the hold expired.

Both put idempotency in the database as a unique constraint, and both explicitly reject LiteLLM's
in-process guard. Both keep Redis out of the correctness path and use Postgres row locking, on the
grounds that our request rate is a few per second and that Redis cannot join the transaction that
writes the entry. Both keep grants as separate lots with priorities and expiry while showing the user
one number. Both store an immutable versioned rate card and stamp its identifier on every charge. Both
store the raw token counts on every charge, including cache reads, and both insist that run
attribution cannot be added later.

On the gateway, both run it as a separate process built from the same codebase and using the same
database, and both reject an internal HTTP call between the gateway and the ledger. Both reject
adopting LiteLLM. Both give the sandbox a run-scoped credential that is worthless outside our gateway,
and both assume it leaks. Both enforce the model allowlist at the gateway rather than trusting the
file inside the sandbox. Both relay stream bytes with a small parser watching a tail buffer, both keep
reading upstream after the caller disconnects, and both name proxy buffering as the thing that
silently destroys the feature. Both use the Vertex OpenAI-compatible endpoint with no dialect
translation, and both start with implicit caching and measure before building explicit caching.

Both put all of it behind the enterprise edition check. Both make contribution awards a manual
approval. Both name the same day-one blocker, which is the missing connection slug. Both list roughly
the same tests before any production code.

That is a large amount of agreement, and it covers every decision that is expensive to reverse.

### 6.2 Where they differ, and which one I would take

Ten differences matter. Each is stated as the choice, the trade-off, and my call.

**1. The form of the run credential.** Proposal A mints a signed token that carries its own claims, so
the gateway verifies a signature and reads no database. Proposal B mints an opaque random string and
stores only its digest, so the gateway reads a row on every call.

**Take B.** A's advantage is a saved database round trip, and that advantage is zero here, because
every model call already needs a Postgres transaction in order to place a hold. So we would be paying
for statelessness we never use, and paying in the currency of revocation. B's token can be revoked the
moment a run ends, a user cancels, an organization is suspended, or the kill switch is pulled. B's row
is also the natural place to keep the per-run credit cap, which removes A's dependence on Redis for
that job.

**2. Single-sided entries or double entry.** Proposal A writes one row per movement with a direction
and a reason code, and reserves a column for a counterparty account later. Proposal B writes true
double entry, with a wallet, a funding account, a consumption account, and an expiry account per
organization.

**Take A, with B's column reserved.** Double entry's benefit is that value cannot appear from nowhere.
But in a credit system value does appear from nowhere, legitimately, every time we mint a grant, and
B's funding account is a bookkeeping fiction that represents us. So the invariant is hygiene rather
than a safety property, until we want to recognise revenue on sold credits properly. Against that,
A's version has a property worth real money in the first version: one transaction touches exactly one
account row, so deadlock is impossible by construction and there is no lock ordering discipline to get
wrong. Adding the counterparty later is a nullable column plus a backfill derived from the reason
code, and it touches no existing value.

**3. The order lots are spent in.** Proposal A follows OpenMeter: lowest priority number first, then
soonest expiry. Proposal B inverts the first two keys, so soonest expiry comes first and priority
breaks ties.

**Take B, and this one is not close.** Under A's order, imagine a user with a signup grant that
expires in ninety days at priority 10 and a contribution award that expires tomorrow at priority 50.
A spends the signup grant, and the award the user earned expires unused. B's order spends the award
first and the user keeps what they earned. Source priority is still useful as the tie-break between
two lots with the same expiry, which is where it puts money somebody paid us last.

**4. Rounding.** Proposal A rounds each priced component to the nearest unit. Proposal B sums the
exact component values and rounds up once at the boundary of a billable action.

**Take B.** A model charge has five components. Rounding each one separately systematically
overcharges every call that has several small components, which is every call we make.

**5. What happens on a mid-stream provider failure.** Proposal A charges the user for whatever the
provider actually did. Proposal B charges nothing and absorbs it.

**Take B.** The strongest single association in the complaint data is between error loops and rage.
Zapier's "Failed actions are not counted" is a written promise and it is worth more than the money.
The loss is bounded at one call, and repeated deliberate failures are an abuse signal rather than a
billing problem. Note that A's own stated rule agrees with B, and only A's failure table disagrees
with it.

**6. What happens when the provider reports no usage.** Proposal A estimates by counting the
characters it relayed and marks the entry as an estimate. Proposal B refuses to bill an estimate,
releases the hold, records an internal write-off, and opens a circuit breaker if it keeps happening.

**Take B for what the customer is charged, and take A's column.** We should record how the number was
arrived at on every charge, because that tells us how much of our billing is a guess. But we should
not put a guess on a customer's bill, because the cache state alone moves the true cost by roughly
eight times, so our guess could be wrong by that factor in either direction. There is a second reason
to be strict here. If the Vertex endpoint turns out never to report usage on a streamed response, that
is a fact we need to confront before launch, and an estimate lets us paper over it and discover it
three months later in a support conversation.

**7. Which model we launch on.** Proposal A launches on Gemini 2.5 Flash to sidestep thought
signatures entirely, and argues that relaying signatures forces the gateway to modify the messages
array, which is the one thing that breaks caching by design. Proposal B builds the signature relay and
argues that the modification lands in the recent conversation, after the large stable prefix, so the
cached prefix is unaffected.

**B's technical argument is right and A's decision rule is right.** Caching applies to a prefix, and a
tool call in the recent conversation sits after our 23,500-token prefix, so restoring a field there
does not invalidate the prefix. But building the relay is still real work plus a permanent
obligation to parse and rebuild request bodies, and we should only take that on for a model that earns
it. So the rule is this: launch on the cheapest candidate that passes a real evaluation of tool use
and instruction following. If Gemini 2.5 Flash passes, launch on it and skip the relay. If it does
not, build the relay for the model that does. Section 8.1 makes that evaluation a gate.

There is a third path worth holding in reserve. Pi already ships native Google adapters that preserve
thought signatures through a shared helper, and Google's own dialect exposes the cached token count
directly. Switching to it is real work in three files. It becomes the right answer if two tests fail
at once: if the compatible endpoint gives us no usage on streams, and if we also need Gemini 3. Both
failures point at the same fix, which is worth knowing before either one happens.

**8. Where the per-run cap lives.** Proposal A increments a Redis counter keyed by the run, and
accepts that the cap is skipped when Redis is down. Proposal B keeps two counters on the token row in
Postgres.

**Take B.** The token row is already being locked in the hold transaction, so the run cap costs
nothing extra and it is durable. This removes one of A's relaxed guarantees entirely.

**9. How the rate card is stored.** Proposal A stores a JSON document per version. Proposal B stores
one row per priced component plus a pointer to the active card.

**Take B.** The rate card is the thing an operator edits under pressure when a provider changes
prices, and a typo inside a JSON blob has no database defence. Rows give us a unique constraint per
component, and they let the activation of a card be a separate atomic step, so a half-populated card
can never go live.

**10. Schema size.** Proposal A has six tables. Proposal B has eleven plus database triggers.

**Take A's shape and four of B's additions.** B's extras that earn their place are cheap now and
impossible to add later: database triggers that reject updates and deletes on the historical tables, a
`schema_version` column on every immutable row, a monotonic `sequence` column that a future snapshot
can anchor to, and the operational request row that records a call's state from authorized through to
settled. That last one is what makes an ambiguous outcome recoverable rather than invisible. B's lot
balance projection and lot event log can wait, because at our volume the remaining amount on a grant
is a small aggregate query.

One small correction matters for the first commit. Proposal A points migrations at
`api/ee/databases/postgres/migrations/core/versions/`. The enterprise chain is `core_ee`, and its head
is `ee0000000003`.

### 6.3 The recommended design, in one page

Build a **model gateway** as a new FastAPI entrypoint in the existing API codebase, deployed as its
own docker compose service against the same Postgres. It exposes one route, `POST
/v1/chat/completions`, in the OpenAI chat completions dialect.

Build a **credit ledger** in the enterprise edition. The unit is one credit, permanently equal to one
tenth of a United States cent, stored as an integer count of micro-dollars. Entries are append only,
and the balance is three counters on one account row per organization, written in the same transaction
as the entry. Grants are separate lots with a priority and an optional expiry, spent by soonest expiry
first. Every charge carries the raw token counts, the identifier of the rate card that priced it, the
run that caused it, and an idempotency key.

When a funded run starts, the backend mints an opaque run token, stores its digest, and returns the
plaintext once to the connection resolver. The resolver returns a connection with provider `openai`,
deployment `custom`, a reserved slug, the gateway base URL, one pinned model, and the token in
`OPENAI_API_KEY`. The runner writes its usual per-run `models.json` and learns nothing new.

Each model call then verifies the token by digest, checks the requested model against the token's
allowlist, clamps the output ceiling, and in one transaction locks the token row, enforces the per-run
cap, locks the account row, enforces the balance, and writes a hold. It forwards the body with the
provider credential swapped in, relays the bytes untouched while a parser watches the tail, and
settles the true cost from the provider's reported usage before the final marker goes out.

The whole thing sits behind `is_ee()`. Nothing about the open source product changes.

### 6.4 The one genuine alternative

There is a real alternative and it deserves a decision rather than a dismissal. It is Dify's and
Activepieces' choice: **charge a flat number of credits per model call, priced per model, and record
the true token counts anyway.**

What it buys is large. The price is known before the call runs, so the balance check and the charge
collapse into a single atomic statement. There is no estimate, no hold, no settlement, no client
disconnect problem, and no dependency on whether the provider reports usage on a streamed response. A
disconnected call costs exactly what a completed one costs. Most of sections 4.3 and 4.6 disappear,
and the first version gets materially shorter.

What it costs is that our credits stop tracking our costs. A call whose 23,500-token prefix hit the
cache and one whose prefix missed differ by roughly eight times in real money, and would be priced
identically. We would be blind to our largest cost lever inside our own billing data, at exactly the
moment we are trying to learn what a funded free tier costs.

**I recommend against it as the plan, and for it as the contingency.** The reason is specific. If the
test in section 8.1 shows that the Vertex compatible endpoint does not report cached tokens on a
streamed response, then token-derived pricing is not available on that path, and the flat price
becomes the right answer rather than a compromise. So the two are not really rival architectures.
They are the same ledger and the same gateway with a different pricing function, and a rate card can
express a constant. That is why storing the raw measurement is worth the extra table: it makes this
switch a code change in both directions, forever.

One other option should be named and closed. We could keep renting enforcement from a third party
that does sell per-key spending caps, which was the previous plan. That still works technically and it
is cheaper. It fails now for a business reason: it spends cash instead of the credit we
were given, which is the entire reason this project changed shape. Its largest component is a key
lifecycle that we throw away the moment we fund anything other than a model call.

---

## 7. The architecture

### 7.1 The credit unit and its pricing

**One credit equals one tenth of a United States cent. One thousand credits equal one dollar. That
rate is fixed and we never change it.**

Internally the ledger stores integers of **micro-dollars**, meaning millionths of a dollar. One credit
is 1,000 micro-dollars. Every amount in the database is a `bigint` count of micro-dollars. Every
amount shown to a user is that number divided by 1,000 and labelled credits.

Three decisions are packed into that, so take them one at a time.

**Why an abstract credit rather than money on screen.** Money needs no teaching and cannot be quietly
devalued, and v0 and OpenRouter both use it successfully. It also publishes our cost basis at a moment
when our cost basis is unusual, and it makes a gift of balance look like a gift of cash, which invites
requests for refunds and transfers. An abstract credit lets one number cover model calls, tool calls,
and sandbox minutes without exposing three price lists.

**Why the peg is permanent.** The only real objection to an abstract credit is that the vendor
controls the conversion and can move it, which is what users read as devaluation. We remove that
objection by construction. What moves is the price list, and a price list change is a visible price
change rather than a hidden one.

**Why micro-dollars in storage.** Amounts must be integers, because floating point money produces
rounding bugs that never get fully cleaned up, and OpenMeter still carries a standing note about
exactly this in its own engine. Cents are far too coarse, because a cached model call on a small model
costs about 1,600 micro-dollars, which rounds to zero cents. And storing money rather than credits
means that when we compare our records against Google's invoice, both sides are already in dollars.

**How a price is decided.** Prices live in a **rate card**, meaning a versioned and immutable price
list with an identifier. Every charge records which rate card produced it. That single column is what
lets us change prices later and still explain an old charge.

A rate card holds one row per priced component. For a model that is five rows: uncached input, cached
input, cache write, output, and reasoning output. Five rather than one is not optional for us. A price
table with a single input rate cannot express the difference between a cached and an uncached prefix,
and it would misprice our workload by roughly a factor of ten.

The arithmetic is integer only, and it rounds once:

```
exact_component = quantity * base_price_micro_usd * multiplier_bps / unit_size / 10000
charge_micro_usd = ceil(sum of exact_component over all components)
```

Here is a worked example on Gemini 3 Flash Preview, at published Vertex prices of $0.50 per million
input tokens, $0.05 per million cached input tokens, and $3.00 per million output tokens, with a
margin multiplier of 1.00 for clarity. One model call with 23,500 cached input tokens, 100 fresh input
tokens, and 120 output tokens:

```
cached input   23,500 x $0.05 per 1M  =  1,175 micro-dollars
fresh input       100 x $0.50 per 1M  =     50 micro-dollars
output            120 x $3.00 per 1M  =    360 micro-dollars
                                         ------
total                                     1,585 micro-dollars  =  1.585 credits
```

The same call with no cache hit costs 11,800 plus 360, which is 12.16 credits. So caching shows up
directly in the number the user sees. That is honest, and it is a competitive fact worth naming on the
pricing page.

At a margin multiplier of 1.25, that cached call is about 2 credits, a user message of three calls is
about 6 credits, and a thirty-message conversation is about 180 credits, or eighteen cents of usage
value. A 2,000-credit signup grant is therefore about eleven such conversations, and it costs us about
$1.60 of provider spend.

**Tool calls** are priced by category, following Dust. Internal operations such as memory and file
handling cost nothing, ordinary actions cost a small fixed number, and heavy external integrations
cost more. Charging nothing for our own plumbing is a pattern both Zapier and Gumloop follow, and
users resent paying for structure while accepting paying for capability. The model's decision to call
a tool is already paid for in the tokens of that model call, so the tool charge covers only the
execution. A failed tool execution is free.

**Sandbox time** is priced per billable second and published per minute. A long-running sandbox is
authorized in renewable slices of five minutes, so an abandoned sandbox costs at most one slice.

**Bring your own key** becomes a clean subtraction rather than a special case. The model line goes to
zero and the tool and sandbox lines keep running. That is the split Relevance AI uses, and it is what
lets our platform price hold steady while model prices move underneath it.

### 7.2 The ledger schema

This is enterprise-edition only. All of it is additive, and section 7.5 says what is hard to reverse.

```sql
-- ---------------------------------------------------------------------------
-- Prices. Immutable. A price change writes a new card and repoints the active
-- pointer in a separate transaction, so a half-populated card can never go live.
-- ---------------------------------------------------------------------------
CREATE TABLE credit_rate_card (
    id             uuid        PRIMARY KEY,
    version        text        NOT NULL UNIQUE,        -- 'v1', '2026-11-gemini'
    effective_at   timestamptz NOT NULL,
    schema_version smallint    NOT NULL DEFAULT 1,
    note           text,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credit_rate (
    id                    uuid     PRIMARY KEY,
    rate_card_id          uuid     NOT NULL REFERENCES credit_rate_card (id),
    resource_kind         text     NOT NULL
                          CHECK (resource_kind IN ('model','tool','sandbox')),
    provider              text     NOT NULL,           -- 'google_vertex', 'agenta'
    sku                   text     NOT NULL,           -- model id, or tool category
    component             text     NOT NULL
                          CHECK (component IN ('input_uncached','input_cache_read',
                                               'input_cache_write','output',
                                               'reasoning','tool_call','sandbox_second')),
    unit_size             bigint   NOT NULL CHECK (unit_size > 0),   -- 1000000 for tokens
    base_price_micro_usd  bigint   NOT NULL CHECK (base_price_micro_usd >= 0),
    multiplier_bps        integer  NOT NULL DEFAULT 10000            -- 12500 means 1.25x
                          CHECK (multiplier_bps BETWEEN 0 AND 1000000),
    UNIQUE (rate_card_id, resource_kind, provider, sku, component)
);

CREATE TABLE credit_pricing_state (
    singleton           boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
    active_rate_card_id uuid        NOT NULL REFERENCES credit_rate_card (id),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- One row per organization. The only mutable ledger row apart from credit_hold.
-- The three counters are a cache of a sum over credit_entry. The query that
-- proves them is below the schema.
-- ---------------------------------------------------------------------------
CREATE TABLE credit_account (
    organization_id uuid        PRIMARY KEY,
    unit            text        NOT NULL DEFAULT 'micro_usd',
    credits_posted  bigint      NOT NULL DEFAULT 0 CHECK (credits_posted >= 0),
    debits_posted   bigint      NOT NULL DEFAULT 0 CHECK (debits_posted  >= 0),
    debits_pending  bigint      NOT NULL DEFAULT 0 CHECK (debits_pending >= 0),
    -- 'hard_stop' refuses a call that does not fit. 'allow_negative' lets it
    -- through and records the deficit. Per organization, not a constant in code.
    spend_policy    text        NOT NULL DEFAULT 'hard_stop'
                    CHECK (spend_policy IN ('hard_stop','allow_negative')),
    closed          boolean     NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- One row per arrival of credits. Immutable except for voided_at.
-- No "amount remaining" column: the remainder is amount minus its allocations.
-- ---------------------------------------------------------------------------
CREATE TABLE credit_grant (
    id                 uuid        PRIMARY KEY,
    organization_id    uuid        NOT NULL REFERENCES credit_account (organization_id),
    amount             bigint      NOT NULL CHECK (amount > 0),   -- micro-dollars
    source             text        NOT NULL
                       CHECK (source IN ('signup','promotion','contribution',
                                         'purchase','support','refund')),
    -- Tie-break only. Expiry decides first. Purchases sit last.
    priority           smallint    NOT NULL DEFAULT 100,
    effective_at       timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz,                               -- NULL means never
    voided_at          timestamptz,
    external_reference jsonb,      -- payment identifier, contribution URL, approver
    schema_version     smallint    NOT NULL DEFAULT 1,
    note               text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at IS NULL OR expires_at > effective_at)
);

-- Spend order: lots that expire before lots that never expire, then soonest
-- expiry, then priority, then oldest, then lowest identifier.
CREATE INDEX credit_grant_spend_order ON credit_grant (
    organization_id, (expires_at IS NULL), expires_at, priority, created_at, id
) WHERE voided_at IS NULL;

CREATE INDEX credit_grant_expiry_sweep ON credit_grant (expires_at)
    WHERE expires_at IS NOT NULL AND voided_at IS NULL;

-- ---------------------------------------------------------------------------
-- Append only. Never updated. Never deleted. A mistake is a new row.
-- ---------------------------------------------------------------------------
CREATE TABLE credit_entry (
    -- Chosen by the caller before the work starts, so a retry reuses it.
    id               uuid        PRIMARY KEY,
    sequence         bigint      GENERATED ALWAYS AS IDENTITY UNIQUE,
    organization_id  uuid        NOT NULL REFERENCES credit_account (organization_id),
    direction        text        NOT NULL CHECK (direction IN ('credit','debit')),
    amount           bigint      NOT NULL CHECK (amount >= 0),     -- micro-dollars
    -- 'single' moves value now. 'hold' reserves it. 'settle' resolves a hold
    -- for the true amount, and a settle of 0 is a release.
    phase            text        NOT NULL CHECK (phase IN ('single','hold','settle')),
    hold_id          uuid        REFERENCES credit_entry (id),     -- set on 'settle' only
    code             text        NOT NULL
                     CHECK (code IN ('grant','purchase','contribution','refund',
                                     'model_call','tool_call','sandbox_time',
                                     'grant_expired','correction')),
    grant_id         uuid        REFERENCES credit_grant (id),     -- set on credit entries
    -- Attribution. Cannot be added later.
    run_id           uuid,
    project_id       uuid,
    -- 'purchase:<payment id>', 'model:<gateway request id>:settle', and so on.
    idempotency_key  text,
    rate_card_id     uuid        REFERENCES credit_rate_card (id),
    -- How the amount was arrived at.
    settlement_basis text        CHECK (settlement_basis IN ('provider_reported','counted',
                                                             'estimated','written_off',
                                                             'not_metered')),
    -- Reserved for full double entry later. Always NULL in the first version.
    counterparty     uuid,
    reference        jsonb,      -- trace id, invoice id, approver, support case
    schema_version   smallint    NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CHECK (phase <> 'settle' OR hold_id IS NOT NULL),
    CHECK (phase <> 'hold'   OR direction = 'debit')
);

-- The whole double-charge defence. Partial, so NULL means "no idempotency
-- requested" and many NULLs do not collide with each other.
CREATE UNIQUE INDEX credit_entry_idempotency
    ON credit_entry (organization_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX credit_entry_one_settle_per_hold
    ON credit_entry (hold_id) WHERE hold_id IS NOT NULL;

CREATE INDEX credit_entry_org_time ON credit_entry (organization_id, created_at DESC);
CREATE INDEX credit_entry_run      ON credit_entry (run_id) WHERE run_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- One row per hold. The hold's own entry stays immutable and the status lives
-- beside it. That separation makes "resolve exactly once" a single guarded update.
-- ---------------------------------------------------------------------------
CREATE TABLE credit_hold (
    entry_id        uuid        PRIMARY KEY REFERENCES credit_entry (id),
    organization_id uuid        NOT NULL REFERENCES credit_account (organization_id),
    reserved        bigint      NOT NULL CHECK (reserved > 0),
    status          text        NOT NULL CHECK (status IN ('pending','settled','expired')),
    expires_at      timestamptz NOT NULL,
    resolved_by     uuid        REFERENCES credit_entry (id),
    resolved_at     timestamptz
);

CREATE INDEX credit_hold_sweep ON credit_hold (expires_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Which grant a debit came out of. The sum of a debit's allocations may be LESS
-- than the debit amount, and the difference is consumption no grant covered.
-- ---------------------------------------------------------------------------
CREATE TABLE credit_allocation (
    entry_id uuid   NOT NULL REFERENCES credit_entry (id),
    grant_id uuid   NOT NULL REFERENCES credit_grant (id),
    amount   bigint NOT NULL CHECK (amount > 0),
    PRIMARY KEY (entry_id, grant_id)
);

CREATE INDEX credit_allocation_grant ON credit_allocation (grant_id);

-- ---------------------------------------------------------------------------
-- The raw measurement behind a metered debit, in typed columns, so the reports
-- we already know we want are a GROUP BY rather than JSON parsing.
-- ---------------------------------------------------------------------------
CREATE TABLE credit_usage_record (
    entry_id                 uuid   PRIMARY KEY REFERENCES credit_entry (id),
    organization_id          uuid   NOT NULL,
    resource_kind            text   NOT NULL
                             CHECK (resource_kind IN ('model','tool','sandbox')),
    provider                 text   NOT NULL,
    sku                      text   NOT NULL,
    provider_request_id      text,
    run_id                   uuid,
    project_id               uuid,
    input_tokens_total       bigint NOT NULL DEFAULT 0,
    input_tokens_uncached    bigint NOT NULL DEFAULT 0,
    input_tokens_cache_read  bigint NOT NULL DEFAULT 0,
    input_tokens_cache_write bigint NOT NULL DEFAULT 0,
    output_tokens            bigint NOT NULL DEFAULT 0,
    reasoning_tokens         bigint NOT NULL DEFAULT 0,
    tool_calls               bigint NOT NULL DEFAULT 0,
    sandbox_seconds          bigint NOT NULL DEFAULT 0,
    cost_micro_usd           bigint,          -- what we paid, before margin
    charged_micro_usd        bigint NOT NULL, -- what the user paid
    cache_saving_micro_usd   bigint NOT NULL DEFAULT 0,
    pricing_snapshot         jsonb  NOT NULL, -- the components that made the number
    raw_usage                jsonb  NOT NULL DEFAULT '{}'::jsonb,
    schema_version           smallint NOT NULL DEFAULT 1,
    created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX credit_usage_provider_request
    ON credit_usage_record (provider, provider_request_id)
    WHERE provider_request_id IS NOT NULL;

CREATE INDEX credit_usage_org_run
    ON credit_usage_record (organization_id, run_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- History is append only, and the database enforces it rather than trusting
-- every future contributor to remember.
-- ---------------------------------------------------------------------------
CREATE FUNCTION reject_credit_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$fn$;

CREATE TRIGGER credit_entry_immutable BEFORE UPDATE OR DELETE ON credit_entry
    FOR EACH ROW EXECUTE FUNCTION reject_credit_history_mutation();
CREATE TRIGGER credit_usage_record_immutable BEFORE UPDATE OR DELETE ON credit_usage_record
    FOR EACH ROW EXECUTE FUNCTION reject_credit_history_mutation();
CREATE TRIGGER credit_rate_immutable BEFORE UPDATE OR DELETE ON credit_rate
    FOR EACH ROW EXECUTE FUNCTION reject_credit_history_mutation();
CREATE TRIGGER credit_rate_card_immutable BEFORE UPDATE OR DELETE ON credit_rate_card
    FOR EACH ROW EXECUTE FUNCTION reject_credit_history_mutation();
```

The grant table needs a narrower trigger rather than a blanket one, because `voided_at` is written
after insert. Use a trigger that raises unless `voided_at` is the only column that changed.

**Reading a balance** is one row:

```sql
SELECT credits_posted - debits_posted - debits_pending AS available
  FROM credit_account WHERE organization_id = $1;
```

**Proving that row** is one query, and a nightly job runs it and alerts on any mismatch:

```sql
SELECT
  coalesce(sum(e.amount) FILTER (
      WHERE e.direction = 'credit' AND e.phase = 'single'), 0)              AS credits_posted,
  coalesce(sum(e.amount) FILTER (
      WHERE e.direction = 'debit'  AND e.phase IN ('single','settle')), 0)  AS debits_posted,
  coalesce(sum(e.amount) FILTER (
      WHERE e.phase = 'hold' AND h.status = 'pending'), 0)                  AS debits_pending
  FROM credit_entry e
  LEFT JOIN credit_hold h ON h.entry_id = e.id
 WHERE e.organization_id = $1;
```

**Two concurrent calls cannot both spend the last credit**, and there is no lock to manage:

```sql
UPDATE credit_account
   SET debits_pending = debits_pending + :amount, updated_at = now()
 WHERE organization_id = :organization_id
   AND closed = false
   AND (spend_policy = 'allow_negative'
        OR credits_posted - debits_posted - debits_pending >= :amount)
RETURNING credits_posted - debits_posted - debits_pending AS available_after;
```

Zero rows means refused, and the surrounding transaction rolls back. The condition is evaluated inside
the same statement that applies the change. Under Postgres's default read committed isolation, a
second statement waits for the first to commit and then re-evaluates its own `WHERE` clause against
the newly committed row. This is the same shape `MetersDAO.adjust()` already runs in production.

**Settling** is guarded so it can happen only once:

```sql
UPDATE credit_hold
   SET status = 'settled', resolved_by = :settle_entry_id, resolved_at = now()
 WHERE entry_id = :hold_entry_id AND status IN ('pending','expired')
RETURNING status, reserved;
```

Then, in the same transaction, insert the settle entry, subtract the reserved amount from
`debits_pending` if the hold was still pending (an expired one was already released by the sweeper),
add the true amount to `debits_posted`, walk the grants in spend order and write the allocation rows,
and insert the usage record.

Two consequences of this shape are worth stating. A call that failed and cost nothing settles for
zero, so there is no separate release path and one fewer concept exists. And a deficit needs no special
machinery: if the true cost exceeds the balance, `debits_posted` simply exceeds `credits_posted`, the
available balance goes negative, and the next grant absorbs it automatically. The display floors at
zero. The data never does.

**Two worked examples.**

A model call that costs less than its hold. An organization has one grant of 2,000,000 micro-dollars
and nothing spent. The gateway estimates 24,088 micro-dollars and holds it, so the available balance
reads 1,975,912. The call returns usage showing 23,500 cached input tokens, 100 input tokens, and 120
output tokens, priced at 1,585 micro-dollars. Settlement writes a settle entry of 1,585, subtracts
24,088 from `debits_pending`, adds 1,585 to `debits_posted`, and writes one allocation row. Available
is now 1,998,415, and the difference was released by the same pair of statements that posted the
charge.

A debit that spans two grants. An organization has 300 micro-dollars left on a contribution award that
expires next week and 50,000 on a purchase that never expires. A call settles at 1,585. The spend walk
takes 300 from the award and 1,285 from the purchase, and writes two allocation rows against one entry.
The award is now empty and will never be selected again.

### 7.3 The gateway request path

The gateway exposes one route. Everything before step 13 happens before a single byte goes upstream,
because after that the status code is committed and we can no longer refuse.

1. **Perimeter.** Reject the wrong method, the wrong content type, or a body over a global size limit.
   This runs before authentication, because we do not yet know whose limit applies.
2. **Authenticate.** Hash the bearer token, load the token row, and reject anything unknown, expired,
   or revoked. Nothing in the body is trusted to say which organization, project, or run this is.
3. **Read the body once.** Keep the original bytes. Parse a copy into a dictionary and only ever read
   from that copy.
4. **Authorize the model.** Require an exact match against the token's allowed model. A mismatch
   returns 403 and raises an abuse signal. This is the check that turns our advisory pinning into a
   real boundary, and it bounds our exposure more than the balance does, because it stops a cheap
   allowance being spent on an expensive model.
5. **Validate the shape.** One completion only, no batch route, no caller-supplied cache resource, no
   caller-supplied provider or endpoint.
6. **Bound the output.** Clamp `max_tokens` to the token's ceiling, or insert it when it is absent.
7. **Ask for usage.** For a streamed request, ensure `stream_options.include_usage` is set.
8. **Restore thought signatures**, if the launch model needs them.
9. **Apply rate limits** by token, run, organization, and network address, plus the concurrency
   ceiling.
10. **Check that a provider access token is available**, before we reserve any of the user's value.
11. **Price the hold.** Load the rate card pinned to the token. Estimate input tokens from the body.
    Price the whole input at the uncached rate and the output at the enforced ceiling, so the hold is a
    true upper bound.
12. **Authorize atomically.** One Postgres transaction: lock the token row and enforce the per-run cap,
    then lock the account row and enforce the balance, then write the hold entry, the hold row, and the
    operational request row. Lock the token first and the account second, always, so no cycle can form.
    Zero rows from either statement returns 402 with a readable body.
13. **Forward.** Swap the authorization header for the Google access token, point at the Vertex
    endpoint, and send the body. Use `httpx` in streaming mode, and never call `.read()` or `.json()`
    on the upstream response, because either one destroys the stream.
14. **Inspect the upstream status** before committing any downstream headers. A non-2xx response
    settles the hold to zero and relays a normalised error.
15. **Relay.** Return a `StreamingResponse` that yields upstream bytes untouched while a side parser
    watches a small rolling tail for the usage object, the provider request identifier, and any tool
    call signatures.
16. **Settle** before forwarding the final marker, using the provider's reported usage.
17. **Forward `data: [DONE]`**, close the stream, and emit metrics.

Two more tables carry the gateway's own state. `model_gateway_token` holds the digest of the run
token, the organization, project, and run, the allowed model, the rate card, the output ceiling, the
concurrency ceiling, the per-run credit limit, two per-run counters, an expiry, and a revocation
timestamp. `model_gateway_request` holds one mutable operational row per inbound call, moving through
`authorized`, `dispatched`, `streaming`, `provider_succeeded` or `provider_failed`, and then `settled`,
`voided`, or `ambiguous`. That second table is what makes an ambiguous outcome recoverable rather than
invisible, and its identifiers are what produce the immutable idempotency keys for the hold and the
settlement.

The refusal at zero is part of the product, because the harness surfaces whatever we return:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "error": {
    "type": "insufficient_credits",
    "code": "credit_balance_exhausted",
    "message": "This run needs 54 credits and 21 are available.",
    "balance_credits": 21,
    "required_credits": 54,
    "request_id": "..."
  }
}
```

**The one rule to write into the code as a comment: the gateway forwards the request body without
rebuilding it, and carries its own metadata in the token, in headers, and in the URL.** Every
exception needs a named reason and a test that shows cached tokens are still non-zero after the
change. The exceptions we already know about are `max_tokens`, `stream_options`, and thought
signatures. The first two are transport controls that sit outside the prompt, and the third lands after
the stable prefix. All three are reasoning rather than documentation, which is why the cache test is a
release gate rather than a nice thing to have.

**What happens when things fail:**

| Failure | What the user sees | What the ledger records | Who pays |
|---|---|---|---|
| Balance empty at hold time | 402 with a readable message | Nothing | Nobody |
| Model not on the allowlist | 403, plus an abuse signal | Nothing | Nobody |
| Ledger or database unavailable | 503, fail closed | Nothing | Nobody |
| Provider error before the first byte | The relayed error | Settle of zero | Us |
| Provider fails mid stream | An error event inside the stream | Settle of zero | Us |
| Caller disconnects mid stream | Nothing | Settle of the drained usage | The user |
| Successful response with no usage | The answer | Settle of zero, written off, circuit breaker counts it | Us |
| Gateway crashes after forwarding | The run fails | Hold expires, sweeper releases it, alert fires | Us |
| Settlement write fails | The answer | Retry on the same key, then the sweeper, then an alert | Us |
| True cost exceeds the hold | The answer | Full true cost, balance may go negative, new calls blocked | Us, once |

Two rules sit behind that table. **Charge for work the provider actually performed and the user
actually received.** And **accounting must never destroy the artefact it is accounting for**, which is
the exact failure Dify has, where a Redis timeout loses a message the user already read.

### 7.4 Which part of our system owns which job

**The backend API owns business policy and financial state.** It owns the ledger tables and the four
operations that write them: grant, hold, settle or void, and reverse. It owns eligibility, meaning the
decision about whether this run may draw on credits at all. It mints run tokens. It owns the balance
and history endpoints, the expiry job, the hold sweeper, and the nightly reconciliation.

**The gateway owns the hot path of a model call.** It verifies tokens, enforces the allowlist and the
ceilings, prices, calls the ledger's hold and settle functions directly as library code, forwards,
relays, and extracts usage. It holds the Google credential and refreshes the access token, which
service accounts issue with a one-hour life.

The gateway runs as its own process from the same image and codebase, next to the existing entries in
`api/entrypoints/`. That gives it its own worker count and its own streaming timeouts, so a flood of
long-lived streams cannot compete with ordinary product requests on the same event loop. It shares the
codebase so the hold and the operational request row commit in one local database transaction, which
removes half of the two-system failure in section 4.8. An internal HTTP call between the two would add
a second network dependency to every stream, and it is rejected for that reason.

**The Python SDK owns exactly one new behaviour.** When the backend has marked a run as funded,
`resolve_connection` returns a connection whose provider is `openai`, deployment is `custom`, base URL
is the gateway, environment carries the run token in `OPENAI_API_KEY`, and whose wire form carries the
reserved slug. It does not decide eligibility and it counts nothing.

**The runner owns nothing new.** Its existing custom-connection path carries the base URL and pins the
model. It must never learn what a credit is.

**The frontend owns the display.** The balance as two labelled numbers, the credit cost of a run shown
inside the run, a history filtered by run and by category, and the exhausted state with a way forward.
It reads numbers from the backend and computes none of them.

Three boundaries are worth arguing explicitly.

**The funding decision belongs at request acceptance, not in the resolver.** Every surface converges on
the workflow invoke path, which is where we can tell a playground message from a nightly evaluation.
The one field that looks like a purpose marker comes from the client and is read after credential
resolution, so it cannot be trusted. Putting authorization and counting inside `resolve_connection` is
exactly the coupling a ledger would later have to pull back out.

**The gateway prices and the ledger stores.** The ledger takes an amount and a measurement and does not
know what a token is. That keeps model, tool, and sandbox pricing as three callers of one interface
rather than three branches inside the ledger.

**Sandbox time is measured by the runner and priced by the backend.** The runner holds trustworthy
start and stop timestamps from outside the container. Code inside the sandbox must never report its own
billable duration.

### 7.5 Migrations, and which ones are hard to reverse

New revisions continue the enterprise chain in
`api/ee/databases/postgres/migrations/core_ee/versions/`, whose head is `ee0000000003`.

**`ee0000000004`, the ledger foundation.** Creates `credit_rate_card`, `credit_rate`,
`credit_pricing_state`, `credit_account`, `credit_grant`, `credit_entry`, `credit_hold`,
`credit_allocation`, and `credit_usage_record`, with their indexes and immutability triggers. It
backfills no organizations, because an account row is created on first use. It seeds no prices,
because a rate card is operational configuration and must not be baked into a migration.

**`ee0000000005`, the gateway runtime.** Creates `model_gateway_token`, `model_gateway_request`, and,
if the launch model needs it, `model_gateway_thought_signature`.

**`ee0000000006`, the award workflow.** Built only when contribution earnings ship. A claim is mutable
workflow state and the award itself stays an immutable grant, and keeping them apart is what stops an
edit in a support workflow from rewriting money.

**Purchases need no migration at all.** A purchase is a grant with `source = 'purchase'` and the
payment identifier as the idempotency key. That is the point of the design.

**Reversibility.** Everything is reversible while the tables are empty. Once any grant, purchase,
award, debit, or expiry exists, the only safe downgrade disables the feature and leaves the financial
tables in place. A downgrade that drops them is data loss, and the runbook must say so.

**The decisions that are expensive to change later.** This is the real answer to what is hard to
reverse, because none of the migrations above are.

The unit of `amount`. Changing the scale rewrites every row and every reader.

Recording entries at all, rather than a counter. This is the Dify lesson and it is the most expensive
mistake available, because a counter cannot be split and there is no correct backfill.

The raw token counts on every charge. Without them we can never restate a charge after a price change
and we can never answer a dispute exactly. They cannot be reconstructed.

The run identifier on every charge. Attribution cannot be added afterwards.

The rate card identifier on every charge. Which price list produced a number cannot be recovered once
the card has been superseded.

Grants as rows rather than an addition to one number. Retrofitting lots onto a single number has no
correct answer, because you do not know which part of the number came from where.

The hold as a durable row rather than a number in a cache. Turning a cached number into a durable row
afterwards means rewriting the whole reservation path.

Three counters on the account rather than one balance. The entire hold mechanism lives in the gap
between pending and posted.

**The decisions that are cheap to change later** deserve naming too, because they should not consume
argument now. The spend order is a sort over an indexed column. Every price is data. The
credit-to-dollar display ratio is one constant and the stored unit does not move. Whether tool calls
and sandbox minutes are metered is a question of new callers of an existing interface. And whether we
price by tokens or by a flat rate per call is a function over the same recorded measurement, in both
directions.

---

## 8. The plan

### 8.1 What must be proven before building starts

Six things. Each has a cheap test. Several can change the design, and that is why they come first.

**1. Does a real default agent reach a service of ours?** Start from a new organization with an empty
vault, the default agent, and the Pi harness on Daytona. Point it at a hundred-line forwarder that
swaps the credential and relays the response. Confirm the runner writes our base URL and our token.
This is the day-one test, because the missing connection slug is a known gap and it is the one
correction that could still change the plan.

**2. Does the Vertex OpenAI-compatible endpoint report cached tokens?** Send the same 24,000-token
prefix twice, ten seconds apart, without streaming, and print the whole usage object from both
replies. A non-zero `prompt_tokens_details.cached_tokens` on the second reply answers it. **If cached
tokens never appear, the cost model in this document is wrong and the plan needs revisiting before
anything is built.**

**3. Does the same endpoint return usage on a streamed response?** Repeat the call with streaming on
and `stream_options` set, and print every chunk, looking for a final chunk with an empty `choices`
array and a populated `usage`. If it does not, we cannot price by tokens on that path, and the
alternative in section 6.4 becomes the plan.

**4. How long does an implicit cache entry live?** Send the same prefix, then repeat it after 30
seconds, 2 minutes, 5 minutes, 15 minutes, and 60 minutes, recording the cached count each time. The
point where it drops to zero decides whether a conversation costs the cached column or the middle
case, which is a factor of about two on our whole model bill.

**5. Does the harness stream, and does it ask for usage?** Point a run at a logging server and read the
body. Neither `stream_options` nor `include_usage` appears anywhere in our repository, and the harness
is a third-party package that runs inside the sandbox, so this cannot be settled by reading. If the
harness omits the field, the gateway must add it, and that edit then needs the cache test.

**6. Which model can actually hold an agent conversation, and does it need thought signatures?** Run
the candidate models through a real evaluation of tool use and instruction following. Separately, give
one agent a tool and ask a question that needs two sequential tool calls. A 400 naming a missing
thought signature tells us the relay is required for that model. A cheap model that fails at tool use
is not an activation feature, so this is a product test as much as a technical one.

### 8.2 The phases

Every phase is shippable on its own, and no phase invalidates the data model of the one
below it.

**Phase 0. Prove the path.** The forwarder, the connection slug fix, and tests 1
through 6. What we learn is whether the cost model is real, and which model we launch on.

**Phase 1. The ledger, with no enforcement.** The migration, the pricing calculator, the
grant, hold, settle, and void operations with their idempotency keys, the spend-order walk, the
allocation writer, the hold sweeper, an admin endpoint that writes a grant, and read endpoints for the
balance and a paged history.

The test that decides whether this phase is done is the concurrency test: many workers racing for the
last unit of one balance, asserting that exactly one wins. Budget for it specifically. It is the one
thing the design cannot survive getting wrong. OpenMeter's burn-order tests read as a specification,
and translating their tables into pytest gives us a conformance suite almost free.

Support can use this phase before any model traffic exists.

**Phase 2. The gateway, in shadow mode.** The separate entrypoint and compose service,
token minting and verification, the allowlist and the ceilings, upstream authentication, the streaming
relay, usage parsing, the operational request row, and pricing that calculates what a call would have
cost without debiting anyone. Only internal organizations use it. Add dashboards for the cache hit rate
and for the share of calls that arrive with no usage.

**Phase 3. The gateway enforces, for a cohort.** The hold before dispatch,
settlement on every exit path, the signup grant on the signup path only, the per-run cap, and the
frontend states: the balance as two labelled numbers, the credit cost printed inside the run, and the
exhausted state with a way forward. A cohort allowlist and an emergency disable.

Three tests here catch things nothing else will. A cache preservation test that sends the same long
prefix twice through the gateway and asserts cached tokens are non-zero on the second call, run in
continuous integration. A disconnect test that closes the client mid stream and asserts a ledger entry
was still written. And a buffering test that asserts the first chunk reaches the client well before the
last one.

**What we ship at the end of Phase 3:** a person signs up, runs an agent immediately, watches a number
go down, and hits a clear wall. That is the product.

**Phase 4. See what is happening, and harden.** A daily rollup built from the entries, the
nightly reconciliation that recomputes the account counters and alerts on a mismatch, a report of the
cache hit rate and of what caching saved in dollars, alerts for negative balances and delayed
settlements, and a support console for entries, holds, and token revocation. A broad rollout to all
signups waits for this.

**Phase 5. Money in.** Credit pack checkout, the signed webhook writing a purchase
grant keyed on the payment identifier, the grant expiry job, and the admin award flow with an approver,
a published schedule, and backdating.

**Phase 6. Meter everything else.** Tool call metering at the tool execution
endpoint, sandbox time reported by the runner and priced by the backend, and the history grouped by the
three categories.

### 8.3 What the first version deliberately leaves out

Double-entry counterparty accounts. Any second dialect. More than one provider backend, and therefore
any routing or failover. Redis anywhere in the correctness path. Recurring grants as a schema feature,
because a monthly refill is a scheduled job that inserts a grant row. Usage periods, resets, and
rollover, which OpenMeter needs and which would cost us the ability to backdate an earned grant.
Explicit context caching, which needs a cache manager and should wait until the measurement shows
implicit caching missing. Automatic contribution scoring. A balance history table, because entries can
rebuild a past balance and nobody will ask in the first months. Per-organization concurrency limits
beyond what the hold already provides.

### 8.4 The guarantees we relax, and what buying each one back costs

**Settlement is not exactly once across the gateway and the provider.** If the gateway dies after
forwarding and before writing the settle, the provider served a call we never charged for. The bound is
that the hold row is durable, so the sweeper finds it and an alert fires, and we know the size of the
loss even when we cannot attribute it. To add back: write the upstream request identifier onto the
operational row before forwarding, and reconcile against Google's usage export. It depends on that
export existing.

**Holds over-reserve by roughly ten to fifteen times on a cached call.** The estimate prices the whole
prefix at the uncached rate, because it cannot know whether the cache will hit, and it prices output at
the enforced ceiling. On the worked numbers a hold is about 24 credits against a settle of about 1.6.
The bound is that this only bites in the last few credits of a balance, so a user loses at most one
message of value at the very end. To add back: keep the previous call's observed cache fraction per run
and blend the input rate. It needs the data from Phase 2.

**Some ambiguous calls are written off rather than charged.** If a successful response carries no usage,
we release the hold and pay for it. The bound is the circuit breaker: after a small number of
consecutive write-offs, or a small aggregate exposure, the gateway stops dispatching. To add back:
count tokens ourselves, or move to Google's own dialect where the cached count is a first-class field.

**Expired grants stay spendable until the daily job runs.** The bound is twenty-four hours, and the
direction of the error favours the user. To add back: run the job hourly, or add an expiry predicate to
the spend walk.

**The account counters can drift from the entries if a bug writes one without the other.** The bound is
that every write goes through one function and one transaction, so drift requires a bug rather than a
race. To add back: the nightly reconciliation query in section 7.2, about twenty lines. The recovery is
always possible because the entries are complete, which is exactly why they have to exist from the
beginning.

**Tool calls and sandbox minutes are not metered.** The bound is that the model call dominates our cost
today, at roughly 23,600 replayed tokens per call. To add back: two new callers of the existing hold
and settle interface, with no schema change.

**Nothing reconciles our numbers against Google's invoice.** The bound is that we set the rate card
above cost deliberately, and only for the first months. To add back: a monthly manual comparison first,
then an automated one.

**The gateway is a single point of failure for funded runs.** Runs on a user's own key keep working, so
the population that breaks is exactly the one we are trying to activate. To add back: nothing
structural, just more replicas and a health check.

**There is no double-entry sum-to-zero invariant.** The bound is that the account counters are already
provable against the entries, which catches the same class of arithmetic bug. To add back: fill in the
reserved counterparty column and backfill it from the reason code. It is additive.

**Signup abuse prevention is basic.** Someone can create several organizations and consume several
grants. The bound per accepted identity is the grant, the model allowlist, the per-run cap, and the
concurrency cap. To add back: the OpenRouter pattern of raising limits once an account has ever
purchased, plus verified email and velocity limits. Filtering too hard early would suppress the very
signal the experiment exists to measure.

---

## 9. The decisions that are yours

### 9.1 How large is the signup grant, and does anything refresh it?

The machinery does not care about the number. For calibration: on the worked example a thirty-message
conversation costs about 180 credits, so a 2,000-credit grant is roughly eleven conversations and costs
us about $1.60 of provider spend.

Options: one larger one-time grant; a small daily refill; a small grant followed by a second tranche
once the user does something meaningful.

**Recommendation: one grant sized for a real first conversation with room to spare, plus a second
tranche unlocked by an activation milestone such as saving an agent or returning the next day.** A
one-time grant is simplest to explain, and the tranche limits the value of farming accounts. Add a
small daily refill later if exhaustion turns out to be a common complaint, because a daily refill turns
"I ran out" into "I will try again tomorrow", which is a far smaller emotional event than a lockout.
Both Lovable and Manus use daily refills for exactly that reason.

### 9.2 What gates the free grant against abuse?

Options: nothing; a verified email; a payment method on file; OpenRouter's rule of raising limits once
an account has ever purchased credits.

**Recommendation: grant on the signup path only, never on explicit organization creation, plus a
verified email and velocity limits by network address.** Do not require a payment method, because that
recreates the wall we are removing. Hold the purchase-based escalation in reserve for when we actually
see farming, because it is cheap to add and hard to game.

### 9.3 Hard stop or soft limit at zero, and for whom?

The account row carries a spend policy per organization, so this is configuration rather than code.

Options: hard stop for everyone; hard stop for free organizations and allow-negative for paying ones.

**Recommendation: hard stop everywhere at launch, and flip specific paying customers by hand when a
payment is being sorted out.** Cloudflare lets balances go negative and charges the card, which is
evidence that overshoot is normal, but that only works when there is a card.

### 9.4 What margin does the public rate card carry?

Options: pass through the provider's prices; one uniform multiplier; a product price set per model and
per action.

**Recommendation: one uniform multiplier, around 1.25, applied to the externally priced resource
cost.** The reason is that it is explainable in one sentence, and it pays for the gateway, sandbox
orchestration, payment fees, and the calls we absorb when something fails. Pass the cache saving
through to the user, because it is true and because it is a competitive fact worth naming. Publish the
rate card and four worked examples in Lovable's style: a short conversation, a tool-using task, a long
autonomous run, and a scheduled daily job.

### 9.5 Do purchased credits expire?

Options: never; twelve months; sooner than twelve months.

**Recommendation: twelve months.** It is the least controversial rule in the comparison set, matching
v0, Bolt, and Lovable, and it bounds the liability we carry. Expiry can always be extended later
without anyone objecting. Shortening it later is a public failure.

### 9.6 Do earned credits expire, and can they be taken back?

**Recommendation: twelve months, the same as purchases.** A contributor should not feel their reward is
worth less than a customer's. Taking back an award for a contribution that turns out to be plagiarised
or fake stays a manual correction entry with an approver recorded, never an automatic void. Understand
what voiding does: it removes the unspent remainder and does not reverse credits already consumed.
Reversing spent value is a separate, deliberate act.

### 9.7 Which model do we fund, and do users get a choice?

Options: the cheapest model that handles basic requests; one stronger default; a cheap default plus a
premium model that visibly costs more credits.

**Recommendation: one model, no picker, chosen as the cheapest candidate that passes a real evaluation
of tool use.** A model picker during the experiment adds a variable we cannot control and a support
burden we do not need, and a cheap model that cannot hold an agent conversation measures the wrong
thing. Add a premium choice once users understand that models have different prices.

### 9.8 Do we make the failure policy a public promise?

Options: leave it unspecified; state that only successful actions consume credits; charge for partially
completed work.

**Recommendation: publish both halves together.** Technical failures on our side or the provider's side
do not consume credits. A model call that completed successfully is charged even if the user closed the
tab. Publishing both makes the boundary obvious, and the strongest association in the complaint data is
between error loops and rage. Zapier's one-sentence promise is the model to copy.

### 9.9 What do customers using their own key pay for?

Options: nothing; tools and sandbox compute only; a platform fee on their model calls too.

**Recommendation: zero model credits for calls funded by the user's own key, with tool calls and
sandbox time still charged once those are metered.** A surcharge on that traffic would confuse provider
cost with platform cost, and it would discourage the path that already works. This is revisitable:
Gumloop halves the credit cost of model calls when you bring your own key rather than removing it, and
Make charges one credit per operation regardless.

### 9.10 What result makes the funded tier worth continuing?

This is the decision that is easiest to skip and most expensive to skip. The system can meter spend
perfectly and still not tell us whether the spend worked.

Options: optimise for a first conversation completed; for organizations still active after seven days;
for conversion to a paid plan; for a composite with a ceiling on cost.

**Recommendation: define success as a stated increase in the share of new organizations that complete a
first agent conversation and return within seven days, subject to a maximum subsidy per retained
organization.** Fix the lift, the cohort size, the duration, and the point at which we stop, before
launch rather than after.

### 9.11 Do we announce the credit system before it can be bought?

Options: ship the free tier quietly and announce when purchases work; announce the whole thing at once.

**Recommendation: ship quietly.** Every public failure in the comparison set involved changing a unit
after users had learned it. Nothing forces us to publish a rate card before people can act on it, and a
quiet launch lets us change the numbers while they are still cheap to change.

---

## 10. What is still unverified

Stated plainly, because parts of everything above rest on it.

**Whether the Vertex OpenAI-compatible endpoint reports cached tokens, and whether it reports usage at
all on a streamed response.** Google's supported parameter list does not include `stream_options`, and
Google states that unsupported parameters are ignored rather than rejected. Their separate Developer API
documentation does document it, but that is a different product. Two live calls settle both questions.

**How long an implicit cache entry lives.** Google publishes no number, and their only guidance is to
send similar requests close together in time. This decides whether a conversation costs the cached
column or roughly twice that.

**Whether our harness streams and whether it asks for usage.** Neither string appears anywhere in our
repository, and the harness is a third-party package that runs inside the sandbox.

**Whether adding `stream_options` or `max_tokens` to a request changes the provider's cached prefix.**
Provider documentation describes the prefix as the messages, the tools, and the schemas, which suggests
it does not, but none of them state it.

**Whether providers hash raw request bytes or a normalised form when matching a prefix.** No provider
documents this. The design avoids the question by not rebuilding the body. Proposal B's argument that
JSON key order is irrelevant because providers tokenize the prompt content is reasonable, and it is
unverified.

**Whether Gemini 2.5 Flash completes a tool-using turn through the compatible endpoint with today's
harness.** Google's wording that Gemini 3 enforces stricter validation strongly implies it, and an
implication is not proof.

**Whether the credit covers context cache storage as well as tokens.** This only matters if the cache
measurement pushes us toward explicit caching.
