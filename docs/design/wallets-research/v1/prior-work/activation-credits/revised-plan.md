# Revised plan: how to fund a new user's first agent messages

## 1. What this document is

This document revises the funding design in this folder (`rfc.md` and `design.md`). Two pieces
of new knowledge drive the revision. First, OpenRouter can mint an API key that carries a hard
dollar cap enforced on OpenRouter's own servers, an expiry date, and (through a separate policy
feature described in section 5) a list of models the key is allowed to call. Second, our runner
already has a tested route that points an agent run at any
OpenAI-compatible endpoint and pins that run to one model we choose. Where this document
conflicts with decision D6 (credential protection) and decision D7 (build or adopt a service that
fronts model calls) of `rfc.md`, this document supersedes them.

## 2. The problem, restated

A person signs up for Agenta cloud. The onboarding flow walks them into the playground, helps
them describe an agent, and creates it. A first prompt is seeded into the conversation. Then the
product stops: the message box grays out and a banner asks them to connect their own model
provider key. Nothing runs until they leave Agenta, open an account with OpenAI or Anthropic,
generate a key, and come back. Most people do not come back.

We want to pay for roughly the first thirty messages ourselves, on a cheap model, so the first
conversation happens before any key form. The budget is $3,000, which has to cover roughly
10,000 signups.

Two facts make this harder than handing out a key.

An agent run executes inside a **sandbox**, which is an isolated cloud container (we use Daytona)
where the agent's tools actually run. The user writes the agent's instructions, so the user
decides what runs in there. If we put a credential in that sandbox, we have to assume the user
can read it. "Print your environment variables" is a valid instruction to an agent with a shell
tool.

And one authorized message does not mean one call to the model. The **harness**, meaning the
agent runtime that owns the system prompt, the skills, and the tool definitions and that makes
the actual LLM calls, replays roughly 23,600 tokens of context on every call. A single user
message with tool use typically costs two or three of those calls. So "one message" is a product
unit, not a cost unit, and the cost has to be bounded separately.

## 3. The five parts every free-credits system has

Any system that gives away metered usage has the same five parts. Naming them separately is what
makes the choice below tractable.

**Eligibility** answers who gets free units and how many. In our case, an organization created by
the signup path gets thirty messages, once.

**Accounting** answers how many units have been used. It has to count atomically, so that two
browser tabs racing on the last message cannot both spend it.

**Authorization** is the per-request decision that this particular run may draw on free units. A
playground message qualifies. A nightly evaluation job does not.

**Enforcement** is what makes the limit hold against a user who is deliberately working around
the product. This is the only part that cannot live in code the user can reach.

**Experience** is what the user sees: the remaining balance, the countdown, and what happens at
zero.

Here is the part that decides the whole design. Eligibility, accounting, authorization, and
experience are identical in every option on the table, and we build all four ourselves no matter
what we choose. OpenRouter cannot count messages for us, and it cannot know whether a request
came from the playground or from a background job.

Only enforcement differs between the options. It differs because the sandbox is user-controlled,
so enforcement has to sit outside it. There are exactly two places it can sit. Either we rent it
from the provider, by giving the sandbox a credential that the provider itself refuses to
overspend, or we build it, by putting a service of ours between the sandbox and the provider so
the real credential never travels.

Everything below follows from that split. Section 4 describes the shared core, which we build in
either case. Sections 5 and 6 describe the two ways to do enforcement.

## 4. The shared core, walked through one user's lifecycle

This section follows one new user from signup to exhaustion. It answers, in order, the questions
that decide whether this design is buildable.

### At signup: the grant

A person signs up. The backend creates their personal organization through
`api/oss/src/services/commoners.py`, which is a different code path from explicit organization
creation in `api/ee/src/core/organizations/service.py`. That difference matters: it lets us fund
signups without letting anyone farm free messages by creating organizations in a loop.

At that moment we write one row that we call a **grant**: an append-only record saying this
organization is entitled to thirty free messages under a named campaign. The row holds the
organization, the amount, the timestamp, and the campaign name, with a uniqueness constraint on
(organization, campaign) so a retried signup hook cannot grant twice.

The grant is also the rollout control. No grant means no trial, so shipping to ten percent of
signups is just granting to ten percent.

### At the first funded run: the credential

The user types their first message. Now we need a way for that run to reach a model on our money.

**Where do we save the key?**

In a new, small table on the cloud backend. One row per organization. It holds the OpenRouter
key encrypted with the platform's own encryption, using the existing secrets domain at
`api/oss/src/core/secrets/`, plus the key's hash, the dollar cap, the expiry, and a state field.
We call this row a **credential lease**: a record that says "this organization is currently
holding one platform-funded credential, and here is what bounds it". A uniqueness constraint on
(organization, campaign) stops two simultaneous first messages from minting two keys.

We store the key value, not only its hash, because OpenRouter returns the plaintext key exactly
once at creation and will never show it again. We store the hash too, because the cleanup and
usage endpoints address keys by hash.

The lease is a separate table from the grant on purpose. The grant says who is eligible. The
lease says how that eligibility is currently being funded. Putting OpenRouter fields on the
grant row would weld our eligibility record to one vendor, and the next funding mechanism would
have to unpick it.

The lease matters most in Option 1 (section 5), where every organization gets its own provider
key. Option 2 (section 6) holds one provider key for the whole platform and never mints a
per-organization credential, so its lease row records only the run budget and its state.

**Is it a new vault?**

No. The **vault** is the existing per-project store of the user's own provider API keys, which
is what today's key wall checks. The credential lease is one new table, not a new subsystem, and
it deliberately does not live in the vault. Two reasons, both verified in code.

The vault is user-readable by design. `VaultService.list_secrets` in
`api/oss/src/core/secrets/services.py` decrypts secret values and returns them with no masking.
Anyone with view access to the project can read a vault secret over the normal API without ever
starting a sandbox. That is correct behavior for a key the user pasted in. It is the wrong place
for a key we are paying for.

And a key in the vault makes the frontend believe the user connected their own key. The gate in
`web/oss/src/components/AgentChatSlice/hooks/useAgentModelKeyStatus.ts` computes `vaultEmpty`
from the raw list of vault rows, project-wide, of any kind. One platform secret in there makes
`vaultEmpty` false forever, which permanently hides the connect-your-key banner. The user would
then hit an exhausted trial with no guidance at all, which is worse than the wall we are trying
to move.

**How do we create it without showing it to the user?**

The key value never appears in an API response and never appears in the UI. Nothing on the read
path exposes the lease table. Only the server-side **resolver** decrypts it. The resolver is the
component that decides which credential a given run uses; it lives at
`sdks/python/agenta/sdk/agents/platform/resolve.py` and runs inside our own service, not inside
the sandbox.

One caveat, stated plainly because it is the risk in this design. In Option 1 (section 5) the
decrypted key does reach the sandbox environment, because that is how the model call is
authenticated. An agent with a shell tool can read it there. What bounds that exposure is the
cap, the expiry, and the model allowlist attached to that key. The exposure disappears entirely
in Option 2 (section 6), where the
sandbox never receives a real key, and it also disappears if the Daytona secrets delivery work
(PR #5277) re-lands, because that mechanism replaces the value in the sandbox with a placeholder
that only Daytona's egress proxy can resolve.

**Which part of the code creates the key, and is it in EE?**

New code, roughly two hundred lines, in `api/ee`. It calls OpenRouter's **provisioning API**,
which is OpenRouter's REST interface for creating, listing, and deleting API keys
programmatically. We mint the key on the first funded run rather than at signup, for two
reasons: most signups never start an agent run, so minting at signup produces a key population
mostly made of dead keys, and the expiry window would burn down while the user is not there. The
cost of minting at first run is that a first message now depends on a third-party API being up,
so that failure has to degrade into the normal connect-your-key wall rather than a broken
playground.

Alongside it, a daily sweep lists keys and deletes expired ones, and a bulk revoke walks active
leases and deletes their keys at OpenRouter. The sweep is hygiene, not safety, because
`expires_at` is enforced by OpenRouter whether or not we clean up. The bulk revoke is what makes
the word "reversible" honest: turning off new grants does nothing to a key someone has already
read out of a sandbox.

Everything in this design is EE and cloud-only, behind the established `is_ee()` pattern. OSS
and self-hosted behavior does not change.

**Where do we track the number of calls?**

In our own counter, in the existing EE metering engine at `api/ee/src/core/meters/`. A **meter**
there is a Postgres row that a single conditional upsert increments, with the limit check
written into the SQL statement, so two concurrent requests cannot jointly overshoot.

We add a new lifetime counter, meaning a counter with no period, so it never resets. We do not
reuse the existing `credits_consumed` counter, which is monthly: a monthly reset would silently
refill every user's trial on the first of the month.

The counter increments when the backend accepts a funded run, at the workflow service's
`/invoke` endpoint, before the run starts. The balance the user sees is computed as grant minus
counter and is never stored as its own number, so there is no second source of truth to drift.

Two deliberate deviations from how the metering engine is normally used. The generic
entitlements wrapper at `api/ee/src/core/access/entitlements/service.py` **fails open** on
infrastructure errors, meaning a Redis or database blip lets the request through. That is right
for a feature gate and wrong for spending money, so the trial path must fail closed instead. And
the wrapper reads limits from the subscription plan catalog rather than from a grant row, so the
trial's limit has to be passed in explicitly.

The increment is keyed by an invocation id, meaning a unique identifier minted server-side for
each accepted request. That gives us **idempotency**: if the client retries the same submission,
the second attempt lands on the same identifier and does not consume a second message.

Nothing counts an agent message today. The existing counters are `evaluations_run`,
`traces_ingested`, `traces_retrieved`, `credits_consumed`, `events_ingested`, and
`records_ingested`. An agent run is currently billed as one ingested trace no matter how many
turns or tokens it burned. So this counter is new work, and it is new work in both options.

OpenRouter's dollar cap is never the number we show the user. It is the abuse backstop that
holds when someone goes around the product. Our counter is the product number.

**How do we decide when to inject it?**

Two moments, and keeping them separate is what makes the design safe.

The first moment is request acceptance, at `/invoke`. Every surface converges there: the
playground posts to it directly, and evaluations, triggers, detached background jobs,
conversation resumes, and nested workflow runs all reach the same endpoint through
`api/oss/src/core/workflows/service.py`. The one field that looks like a purpose marker,
`meta.run_kind`, comes from the client and is read after credential resolution, so it cannot be
trusted. At acceptance we establish the organization, decide from server-side knowledge whether
this is a fundable interactive run, check the balance, consume one message fail-closed against
the invocation id, and pass a trusted funded flag down into resolution.

Only playground runs and direct invokes qualify. Evaluations, triggers, and background jobs
never do. Skipping this check would let a nightly trigger drain a user's whole trial before they
ever type a word, and the user would have no way to understand what happened.

The second moment is credential resolution, inside `resolve_connection`. Its job here stays
narrow: given a run that has already been authorized as funded, return a connection that points
at our funding endpoint with our credential and pins the model. A user's own key always wins, so
anyone who has connected a key never touches this path at all. Authorization and counting do not
belong here, partly because the resolver runs after tool resolution and partly because moving
them here is exactly the coupling a later ledger would have to unpick.

### Through the trial: what the user sees

**How do we show it to the user?**

We never show the key. We show the balance.

Today the frontend has a single boolean that disables the composer when the vault is empty. That
becomes a small state machine with five states: loading, user key available, trial available
with a countdown, trial exhausted, and trial unavailable.

Three rules keep it honest. The countdown appears after the first response rather than before
the first send, so nothing adds friction ahead of the payoff moment. A balance query that fails
or is still loading renders as unknown, never as zero, because telling a new user they have zero
free messages because a query flaked is the worst outcome available. And at zero, the send is
refused before any model call is made, the connect-your-key message appears, the typed draft is
kept, and it auto-sends once a key lands. The existing auto-send machinery covers only the
seeded first prompt, so retaining an arbitrary refused draft is new state with its own tests.

Refusing the send at zero is also what keeps the user from ever meeting a provider error. The
dollar cap only fires for someone who went around the product.

### Cost, for the whole lifecycle above

One completed thirty-message trial on a nano-class model costs about $0.04 with prompt caching
working and about $0.12 with no caching at all, assuming three model calls per message.
OpenRouter adds no markup on inference itself; its fee is 5.5% when buying credits. A $0.30 cap
per user therefore covers the worst case with headroom, and 10,000 signups at that cap is a
$3,000 hard ceiling against a realistic bill closer to $400.

## 5. Option 1: per-user capped OpenRouter keys

### How it works

We mint one OpenRouter key per organization on its first funded run. The create-key call takes
`name` (required), `limit` (the dollar cap, enforced by OpenRouter), `limit_reset` (set to null,
which makes the cap a lifetime cap rather than a monthly one), `expires_at` (an ISO 8601 UTC
timestamp), and `include_byok_in_limit`. There is no model field on the key itself.

Model restriction comes from a separate OpenRouter feature called **Guardrails**. A guardrail is
a named policy object that can carry a model allowlist, a provider allowlist, a spending cap,
and data-retention rules, and OpenRouter enforces it before the request leaves their
infrastructure. A guardrail is attached to a key through the management API, one guardrail per
key. We would create one guardrail once and attach it to every trial key, so minting a
restricted key costs two API calls instead of one.

The key then reaches the run through a route that already exists. A vault `custom_provider`
record with `kind = "custom"` and a base URL resolves to provider `openai` and deployment
`custom`. The runner writes a per-run `models.json` file carrying that base URL and forces the
model string to the single model we named
(`services/runner/src/engines/sandbox_agent/environment.ts` around line 1032). The dialect is
fixed at OpenAI chat completions, which is exactly what OpenRouter speaks, so no new dialect
field is needed anywhere.

We set `expires_at` to the end of the advertised trial window, not to twenty-four hours. A
short-lived key against a thirty-message allowance creates a conflict nobody has defined: what
happens when the key dies with twenty messages left. Either the trial silently ends early or we
mint a replacement and hand out a second full dollar cap, which doubles the ceiling we told
ourselves we had. Making the window part of the product promise ("thirty messages within seven
days") removes the question. One key, one cap, one window.

### What is verified and what is not

The key fields are verified against OpenRouter's API reference. The dollar cap, the null reset,
and the native expiry all do what we need.

Guardrails are not fully verified. OpenRouter's documentation says that on an organization
account you must be an organization admin to manage guardrails, which implies a personal account
can manage them, but implication is not proof. The exact allowlist field names are also
unverified, because the guardrails API reference pages return 404 to an unauthenticated fetch. A
probe script (`probe_openrouter_keys.py`, sitting with the OpenRouter research notes) settles
both in about twenty minutes and a few cents.

Two more things are documented nowhere: whether there is a cap on how many keys one account may
hold, and whether the key-creation endpoint is rate limited. One email to OpenRouter answers
both.

One trap is already pinned by a test in our own repo and is worth naming so nobody walks into
it. A `custom_provider` record whose `kind` is `openrouter` rather than `custom` normalizes back
to deployment `direct`, and then no runner code consumes the stored base URL. The URL becomes
silently inert and the run goes to OpenRouter's default routing instead of ours. Use
`kind = "custom"`.

### The known gap

The route above is reachable only when the agent's configuration names a custom connection by
slug. The trial case is the opposite: a brand new user's default agent with an empty vault.

For a default connection the SDK omits the `connection` object from the wire entirely
(`sdks/python/agenta/sdk/agents/dtos.py` around line 826, whose own comment explains that the
project default carries no information beyond the model), and `ResolvedConnection.to_wire()`
emits provider, model, deployment, credential mode, and endpoint but no slug. The runner's
builder then declines, because it requires a named `agenta` connection with a slug
(`services/runner/src/engines/sandbox_agent/pi-model-config.ts` lines 89 to 97, pinned by
`services/runner/tests/unit/sandbox-agent-pi-model-config.test.ts`). With no plan written, the
run falls back to the default provider host and would send our OpenRouter key to api.openai.com,
which fails.

So version one needs a reserved connection identity that a platform-funded resolved connection
can carry onto the wire, so the existing builder fires. It is one small change on each side plus
a test. It has to be proven end to end from a real default agent on day one, before anything
else is built, because it is the one correction that could still sink the plan.

The same code shows a second limit. This route works for the Pi harness only; the builder
returns no plan for a Claude request. A funded trial can be offered on Pi agents and not on
Claude agents, so confirm the onboarding default agent is Pi before promising a number to
anyone.

### What gets thrown away later, and what we accept

The pieces specific to this option are the key issuer, the daily sweep, the bulk revoke, and the
guardrail wiring. That is a few hundred lines behind one interface, and all of it is discarded
when we move enforcement in-house.

The accepted risk is that a spendable third-party key sits readable inside a user-controlled
sandbox for the length of the trial window. It is bounded by the dollar cap, by the model
allowlist if guardrails work, and by the expiry, and it is traceable to the organization it was
minted for. That is a very different object from a platform provider key with no limits, which
is what made this dangerous in the original analysis. It is still a risk we would be choosing to
take.

## 6. Option 2: a thin gateway route in our existing API

### How it works

A **gateway** here means a service of ours that sits between the sandbox and the model provider,
holds the real provider credential, and decides per request whether to forward the call.

This option adds one new route to the API service we already run. There is no new service and no
new infrastructure: FastAPI, httpx, and Redis are already in the API's dependency set.

We hold one OpenRouter key. It never leaves our backend. The sandbox receives a short-lived
signed token instead, meaning an opaque string that proves this run was authorized and carries
its budget, and that is worth nothing to anyone outside our gateway.

Per request, the route does five things. It validates the token and rejects expired ones. It
checks the requested model against an allowlist. It atomically decrements this run's remaining
budget in Redis, with a per-call ceiling so one oversized call cannot take the whole thing. It
forwards the request to OpenRouter with our real key. It streams the response back through
unchanged, reading the usage numbers off the final frame and recording them in our own metering.

That is roughly 600 to 900 lines.

### How this differs from the gateway in the original design.md

The gateway in `design.md` is a bigger thing than this, in two specific ways.

It spoke the OpenAI Responses API directly to the provider, because that is the vendor's
agent-native surface. Our runner speaks only the OpenAI chat completions dialect, so that design
needed a new API-dialect field on the connection, plus validation that tool calling behaves the
same on the new surface. The thin route speaks chat completions, which is what the runner
already emits and what OpenRouter already accepts, so that whole branch of work disappears.

And it implemented full **hold and settle** accounting. A hold is a provisional debit taken
before the work starts, for an amount we cannot know yet; settlement replaces the estimate with
the real cost once the response arrives. Holds are the right mechanism when the amount at stake
is large enough that an estimate has to be corrected. The thin route uses a simple atomic
decrement with a per-call cap instead, which is enough when the entire budget under management
is thirty cents. If a call ends ambiguously, we have overcharged a run by a fraction of a cent.

### What it buys over Option 1

There is no per-user credential lifecycle at all. No minting, no sweep, no revoke, no guardrail,
no per-key state machine, and no question about undocumented key-count caps or provisioning rate
limits.

The real key never enters the sandbox. That removes the risk-acceptance question in Option 1
entirely, and it removes any dependence on PR #5277 re-landing. A token extracted from a sandbox
buys minutes of one cheap model inside a budget we are already counting.

Usage lands in our own metering, exactly, at the one chokepoint that cannot be bypassed. That
matters more than it sounds, because per-run cost is currently missing from our traces (see the
end of this section).

And the budget code is the first real piece of the future credit system, rather than a rental we
give back.

### What it costs

Roughly one extra week of engineering over Option 1.

Trial runs now pass through our API on the hot path. A bug in that route breaks trials. Runs on
a user's own key never touch the route, so paying customers are unaffected, but the population
that does break is exactly the one we are trying to activate.

### What is the same in both options

Both options need the runner contract fix from section 5, for the same reason: a default agent
emits no connection slug today, so no per-run model configuration is written and the run goes to
the wrong host. Both options need the entire shared core from section 4. The difference between
them is enforcement and nothing else.

One observability note that applies to both. Tokens do reach our traces for agent runs. Cost
does not, because the runner never stamps the span type or the model name that the backend's
cost calculator reads (`api/oss/src/core/tracing/utils/trees.py`). Stamping those two attributes
would make the existing cost machinery work for agent runs on every provider. It is a small fix
and it is worth doing regardless of which option we pick.

## 7. The long-run goal and what each option contributes

The stated end goal is a credit system that funds model calls, tool calls, sandbox compute, and
whatever else costs money, with credits that can be earned and purchased. That system is out of
scope now. Version one should still be an honest first step toward it rather than a detour.

Systems like that share a standard shape, and naming it makes the comparison concrete.

At the center is a **ledger**: an account balance per organization that is derived from
immutable entries rather than stored as a mutable number. Entries are grants (we gave you this),
purchases (you bought this), and debits (you spent this). Every entry carries an idempotency key
so a retried write cannot post twice. On top of the entries sit holds, for work whose cost is
unknown until it finishes, and settlements that convert a hold into a real debit.

Around the ledger sit charging clients: every service that costs money asks the ledger before
doing the work and reports back after. Model calls are one client. Tool execution would be
another. Sandbox compute would be a third.

Two things follow for our decision.

First, the grant, the counter, and the debit taken at request acceptance are the ledger's seed,
and both options build all three. They can only ever live with us. OpenRouter can meter model
calls and it will never meter a tool call or a sandbox minute. This is the part of the work that
is genuinely not wasted under either option.

Second, enforcement is where the options diverge in what they leave behind. Option 1 rents
enforcement from OpenRouter and builds none of it, so when we want to fund anything other than
model calls we start from zero. Option 2's per-request budget check is enforcement muscle: it is
small, but it is the real thing, in our code, at the right chokepoint, and the ledger's hold
logic grows out of it rather than replacing it.

The honest limit on all of this: neither option builds holds, settlement, refunds, expiry,
payment provenance, or a reconciler. Counting messages is not money accounting. A message is a
product unit with no price attached; a credit is a monetary unit that has to reconcile against
what we actually paid. The ledger remains real work either way. What version one buys is that
the seams the ledger needs already exist and are already exercised in production, instead of
being invented alongside a new product surface.

Two shapes to avoid, because either one would make the ledger harder rather than easier: putting
OpenRouter key fields directly on the grant row, which welds eligibility to one vendor, and
letting `resolve_connection` own authorization and counting, which the ledger would then have to
pull back out.

## 8. Comparison and recommendation

| | Option 1: capped OpenRouter keys | Option 2: thin gateway route | Self-hosted LiteLLM | Original full gateway |
|---|---|---|---|---|
| Effort beyond the shared core | About 5 days | About 2 weeks | About 2 weeks plus ongoing operations | 1 to 2 weeks, on the hardest code |
| Who enforces the spend limit | OpenRouter, server side, per key | Us, atomically per call | LiteLLM, batched after the fact | Us, with holds and settlement |
| Can the model be pinned | Yes, through a guardrail, if guardrails work on our account. Unverified | Yes, in our allowlist | Yes, per virtual key | Yes |
| Credential that lands in the sandbox | A real, spendable third-party key | An opaque short-lived token | A LiteLLM virtual key, spendable | An opaque reservation token |
| New infrastructure to operate | None | None. FastAPI, httpx, and Redis are already dependencies | A service and its own Postgres | None |
| Spend visibility | Exact, per key, in OpenRouter's system, not ours | Exact, in our own metering | LiteLLM's spend logs | Exact, in our own metering |
| Protocol the runner must speak | Chat completions, which it already speaks | Chat completions, which it already speaks | Chat completions | Responses API, needing a new dialect field |
| What survives into the credit system | Grant, counter, authorization point, resolution seam, runner fix. Issuer discarded | All of the above, plus the budget enforcement itself | The same as Option 1, plus a service we would want to delete | Everything |

Two of these four are rejected outright.

**Self-hosted LiteLLM** genuinely does what we need on paper: per-key budgets, per-key model
allowlists, and key expiry, without writing a proxy. It costs a service to deploy, monitor,
upgrade, and page on, with its own database, in a cloud environment we deliberately keep small.
Its spend tracking is batched rather than atomic, so concurrent calls can overshoot, which
matters at a thirty-cent cap in a way it would not at a fifty-dollar one. And it still puts a
spendable key inside the user's sandbox, so it does not improve the trust boundary over Option 1
at all. For this job it is dominated by Option 1.

**The original full gateway** from `design.md` is the right end state and the wrong starting
point. It front-loads the hardest correctness work in the whole design, the atomic hold and its
reconciler, before we have any data on whether a funded first conversation moves activation. If
the experiment says no, we will have built it for nothing. If it says yes, we will build it with
real usage numbers and a real reason.

### The recommendation

**Build Option 2, the thin gateway route.**

The reason is the end goal, not the experiment. Option 1's largest specific piece is the key
lifecycle, and that piece is thrown away the moment we fund anything other than a model call,
which leaves us having built no enforcement at all. Option 2 costs roughly one extra week, and
in exchange it removes the sandbox credential risk entirely, gives us exact usage in our own
metering, and every line of it survives into the credit system.

If the activation experiment were the only goal, Option 1 would be the right call. It is
cheaper, it is less code, and the cap makes the risk bounded. The recommendation flips only
because the credit system is stated as the destination.

### What must be proven before building either one

Four things, in order of how badly each could hurt.

The runner contract fix, end to end, starting from a default agent with an empty vault rather
than from a hand-made custom connection. This is day one work and it is the finding that could
still change the plan.

Prompt caching surviving the extra hop. The harness sends roughly 23,600 tokens of context per
call, so caching is the dominant cost lever, and one existing measurement suggests the agent
path may not be hitting cache at all today. Read `prompt_tokens_details.cached_tokens` off five
real messages and settle it.

The exhaustion moment in the playground, tested with a real budget running out mid-stream. We
have a known class of bug where an errored turn renders as an empty message. A trial that ends
in silence is worse than no trial.

A half-day quality check of the candidate cheap model in our own harness with real tool calls.
If a nano-class model cannot hold a simple agent conversation, the experiment measures the wrong
thing.

## 9. Decisions requested

**1. Option 1 or Option 2.** The recommendation is Option 2, the thin gateway route, because it
costs about one extra week and every part of it survives into the credit system, while Option
1's biggest piece is discarded and leaves no enforcement behind.

**2. Model class and cap.** Recommendation: a nano-class model at a $0.30 budget per user for
the first cohort, with a second cohort on a mini-class model if activation comes back flat.
Running mini first costs 2.5 times as much and does not isolate the variable.

**3. Trial window.** Recommendation: seven days, stated in the product ("thirty free messages,
good for seven days"), so the credential's lifetime and the product promise are the same number.

**4. A dedicated OpenRouter account funded only for trials.** Recommendation: yes, with
auto top-up off and a balance alert. A negative balance on a shared account returns 402 for
every key on it, so separating the balance turns a shared outage into a contained one.

**5. Whether to run the probe script before implementation.** It is strictly needed only for
Option 1, where the guardrail question decides whether the model is bounded or only the money
is. It is still cheap insurance for Option 2, because it also answers the prompt-caching
question. Recommendation: run it either way, on the dedicated account, before writing product
code.
