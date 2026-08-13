# How a model gateway is built

## What this document covers

We have to put a service of our own between the agent sandbox and the model provider. This
document explains how other people have built that service, what breaks when you build it
naively, and what the smallest useful version looks like for us.

The document is written for a reader who has never built a proxy for a model provider. It
starts with the problem, then teaches the machinery, then evaluates the designs. Section 2
defines every term used later. If a term is already familiar, skip it.

Every claim carries its evidence. External claims carry a URL. Claims about our own code
carry a file path and a line number, verified against the working tree on 2026-08-03.
Claims that could not be verified are marked as such, together with the test that would
settle them.

---

## 1. Why we need a gateway at all

A person who signs up for Agenta cloud cannot run anything until they connect their own
model provider key. We want to pay for the first runs ourselves. To do that, something has
to hold a credential that we own and let a stranger spend against it.

The obvious approach is to hand the stranger a credential with a spending limit attached.
Our provider does not sell that. Google Cloud budgets send an email when you cross a
threshold and they change nothing else. Google's own documentation states that setting a
budget does not cap resource or API consumption
([Cloud Billing budgets](https://docs.cloud.google.com/billing/docs/how-to/budgets)). The
alternative control is a quota, which is set per project and per API service, is expressed
in requests or tokens per unit of time rather than in dollars, and is not attached to an
individual key.

There is a second reason, and it is stronger. Our agent runs inside a sandbox, which is a
container the user effectively controls, because the user writes the instructions the agent
follows. An agent with a shell tool can read its own environment variables. So any provider
credential we place inside that container is readable by the user, and any restriction we
write into a config file inside that container is advisory rather than enforced.

Our runner writes a per-run `models.json` that pins the run to exactly one model and one
base URL
(`services/runner/src/engines/sandbox_agent/pi-model-config.ts:85`, and the serializer just
below it, which writes `apiKey: "$OPENAI_API_KEY"` rather than the raw value). That pinning
stops honest users and it shapes the product surface. It does not stop a user who reads the
key out of the environment and calls a different, more expensive model at the same base URL.

So the limit has to live outside the container, on a machine we own, in the path of every
request. That machine is what this document calls a gateway.

---

## 2. Vocabulary

Read this section once. Everything later depends on it.

**Gateway.** A service that receives a request meant for a model provider, decides whether
to forward it, forwards it, and watches the response go by. It is a specialised reverse
proxy. "Reverse proxy" means it accepts connections on behalf of a server that is somewhere
else, as opposed to a forward proxy, which accepts connections on behalf of a client.

**Upstream and downstream.** Upstream is the model provider (further from the user).
Downstream is the caller (closer to the user). A request travels downstream to upstream; a
response travels upstream to downstream.

**Dialect.** The exact request and response shape a provider expects. OpenAI's chat
completions dialect posts a JSON body with a `messages` array to `/v1/chat/completions`.
Anthropic's messages dialect posts to `/v1/messages` with a separate `system` field and
different names for token counts. Google's native Gemini dialect uses `contents` and
`parts`. Two providers can serve the same model family and still speak different dialects.
Our agent runner speaks the OpenAI chat completions dialect and nothing else
(`services/runner/src/engines/sandbox_agent/pi-model-config.ts` sets
`api: "openai-completions"` in the plan it writes).

**Streaming and server sent events.** A model can return its answer all at once, or it can
return it a few words at a time so the user sees text appear immediately. The second mode
uses server sent events, usually shortened to SSE. SSE is a plain HTTP response with the
content type `text/event-stream` that never ends until the server closes it. The body is a
sequence of lines like `data: {...}` separated by blank lines, and the OpenAI dialect
finishes with the literal line `data: [DONE]`.

**Chunk.** One `data:` event in a stream. For a chat completion each chunk carries a small
piece of the answer.

**Time to first token.** How long the user waits before the first word appears. This is the
number that makes an application feel fast or slow, and a badly built gateway destroys it.

**Token.** The unit providers bill in. Roughly three quarters of an English word. Input
tokens are what you send. Output tokens are what the model generates. They are priced
differently, and output usually costs several times more than input.

**Usage.** The object a provider returns that says how many tokens the call consumed. In the
OpenAI dialect it looks like `{"prompt_tokens": 1200, "completion_tokens": 300,
"total_tokens": 1500}`, with a nested `prompt_tokens_details.cached_tokens` when part of the
input was served from cache.

**Prompt caching.** A provider optimisation. If the beginning of your request is identical
to the beginning of a request it processed recently, the provider can reuse the work and
charge you much less for that shared beginning. The shared beginning is called the
**prefix**. Cache hits are worth roughly a tenfold discount on the cached portion for
Google's implicit caching
([Gemini context caching](https://ai.google.dev/gemini-api/docs/caching)), and a similar
order of magnitude elsewhere.

**Ledger.** A list of entries that we append to and never edit. Each entry says an amount
moved, in which direction, for which organization, and why. The balance is not stored; it is
computed by adding the entries up (in practice you also keep a running total for speed, but
the entries stay the source of truth). The point of never editing is that you can always
reconstruct how a balance got to where it is.

**Debit.** A ledger entry that reduces a balance. Example: "organization 42, minus 137
credits, model call, run abc123".

**Credit entry.** A ledger entry that increases a balance: a grant, a purchase, or an
earning.

**Hold, also called a reservation.** A provisional debit taken before you know the true
cost. You guess an upper bound, subtract it from the available balance so nothing else can
spend it, run the call, and then correct the number. A hold is what a hotel puts on your
card at check in.

**Settlement.** Replacing a hold with the true amount. If you held 500 credits and the call
cost 137, settlement releases 363 back.

**Idempotency.** A property of an operation that makes running it twice have the same effect
as running it once. You get it by attaching a unique key to the operation and refusing to
apply the same key twice. It matters here because a retry after a timeout can otherwise
charge a person twice for one call.

**Metering.** Counting how much of something a customer used, in a form you can bill or
limit against. Our existing meters count traces ingested, evaluations run, and a few other
things (`api/ee/src/core/meters/types.py:23`).

**Entitlement.** What a plan allows. In our code an entitlement is a `Quota` attached to a
counter, with a limit, a period, a scope, and a strictness flag
(`api/ee/src/core/access/entitlements/types.py:92`).

**Virtual key.** A credential the gateway issues to a caller, which is not the provider's
credential. The gateway maps it to the real one internally. If it leaks, the attacker can
spend only whatever budget and model list you attached to it, not your entire provider
account.

**Bring your own key, usually shortened to BYOK.** The opposite arrangement, where the
caller supplies their own provider credential and the gateway just passes it through.

---

## 3. The request path, end to end

Here is what happens between a caller pressing enter and a word appearing on screen. Every
gateway in this document is a variation on this path.

**Step 1. The caller sends a request.** It goes to the gateway's address instead of the
provider's. The caller presents a virtual key. In the OpenAI dialect that means an
`Authorization: Bearer <key>` header and a JSON body containing `model`, `messages`,
optionally `tools`, and optionally `stream: true`.

**Step 2. The gateway authenticates.** It looks the virtual key up and finds out who is
calling: which organization, which project, which run. Every real implementation caches this
lookup, because doing a database read on every model call is expensive relative to doing
nothing. LiteLLM checks an in-memory cache, then Redis, then the database
([Life of a request](https://docs.litellm.ai/docs/proxy/architecture)).

**Step 3. The gateway decides whether to allow the call.** This is where a balance check, a
rate limit, and a model allowlist live. This step is the entire reason we are building the
thing. Section 9 is about how to do it correctly.

**Step 4. The gateway rewrites the request.** At a minimum it swaps the virtual key for the
real provider credential and points the request at the provider's address. It may also
translate the dialect, inject parameters, or choose between several provider accounts.
Section 10 explains why every additional edit here is dangerous.

**Step 5. The gateway forwards the request and gets a response.** If the request was not
streaming, this is one round trip and the response contains a usage object. If the request
was streaming, the gateway now holds an open connection that will deliver chunks over
several seconds.

**Step 6. The gateway relays the response to the caller.** For streaming it must pass each
chunk through as it arrives. Section 7 explains what goes wrong here.

**Step 7. The gateway records what happened.** It extracts the usage numbers, converts them
to money or credits, and writes a ledger entry. Every serious implementation does this after
the response has been handed to the caller, not before, so that bookkeeping never adds
latency. LiteLLM is explicit about it: spend logging, rate limit accounting, and logging
callbacks all run as background tasks, and no database write sits in the request path
([Life of a request](https://docs.litellm.ai/docs/proxy/architecture)).

Two structural choices distinguish the implementations.

The first is **where the accounting happens relative to the response**. Doing it before you
answer is accurate and slow. Doing it after is fast and can lose data when things go wrong.
Everyone chooses "after" and then spends years fixing the resulting gaps. Section 8 catalogues
those gaps.

The second is **how much of the request the gateway rewrites**. A gateway that only swaps a
header and a hostname is nearly free of failure modes. A gateway that parses, normalises, and
re-serialises the body inherits every bug in its own translation layer. Section 10 shows the
concrete money this costs.

---

## 4. Family one: gateways sold as products

These are projects where the gateway is the whole product. They are worth reading because
they have already hit the failure modes, and because their bug trackers are a free list of
the problems we are about to have.

### 4.1 LiteLLM

LiteLLM is the reference implementation for our situation. It is Python, it runs on FastAPI,
it stores state in Postgres, and it uses Redis for hot counters. Our stack is the same. Its
proxy exposes an OpenAI-compatible surface and forwards to about a hundred providers.

**The path.** A request arrives and `user_api_key_auth()` runs first. It extracts the key
from the header, hashes it, and validates it against a `LiteLLM_VerificationToken` table. It
checks budgets at the key, user, and team levels. Then `LiteLLMProxyRequestSetup` parses the
body, sanitises headers, and injects internal metadata such as `user_id`, `team_id`, and
`request_id` so that later stages can attribute cost. Then `route_llm_request()` picks the
call type and hands off to a `Router`, which selects a deployment, applies fallbacks and
retries, and makes the provider call. Provider responses are normalised into an OpenAI shaped
`ModelResponse`. Finally `DBSpendUpdateWriter` writes the cost to a `LiteLLM_SpendLogs` table
through a background queue
([architecture and request flow](https://deepwiki.com/BerriAI/litellm/3.1-architecture-and-request-flow)).

**How it enforces budgets.** Budget checks read the current spend from a counter in Redis
that is shared across worker processes, so enforcement is fast and consistent across
replicas. The counter is the authority on the hot path and the database is reconciled in the
background ([Life of a request](https://docs.litellm.ai/docs/proxy/architecture)).

**It implements the hold and settle pattern.** This is the single most useful piece of prior
art in the whole document, so it is worth describing precisely. The relevant file is
`litellm/proxy/spend_tracking/budget_reservation.py`
([source](https://github.com/BerriAI/litellm/blob/main/litellm/proxy/spend_tracking/budget_reservation.py)).
The flow, by function name:

- `reserve_budget_for_request()` runs before the provider call. It builds a list of counters,
  one per entity that has a budget (key, team, team member, user, end user, tag,
  organization). It computes `estimate_request_max_cost()`, which is the worst case price of
  this call. It then increments every counter by that estimate, atomically, in Redis. If a
  counter goes over its limit, it releases what it already applied and denies the request.
  If the cost cannot be estimated because the model is unknown to the price table, it gives
  up on reserving and falls back to checking the balance only.
- `reconcile_budget_reservation()` runs after the call. It computes
  `actual_cost - reserved_cost` and applies that difference to each counter. A call that cost
  less than the estimate gets money back. A call that cost more gets charged more.
- `release_budget_reservation_on_cancel()` handles the case where the caller disappears. Its
  docstring is worth quoting because it captures a decision we will have to make too: a
  client disconnect surfaces as a cancellation rather than an exception, so neither the
  success handler nor the failure handler runs, and the reservation is never reconciled. Left
  alone, the counter stays inflated and the next requests get rejected until the counter's
  time to live expires. Their answer is to settle to the **input token cost** rather than
  refund to zero, because by the time the request is cancelled the provider call was already
  dispatched and the input tokens were already billed. Refunding to zero would let a caller
  abort early to dodge the charge.

That last detail is the kind of thing you only learn by running the system in production, and
we get it for free by reading their code.

**What still goes wrong in LiteLLM.** Their issue tracker is the honest documentation.

- Usage is lost entirely when a streaming client disconnects before the final chunk. The
  exception handler logs the failure and never computes usage for the partial response, so
  the provider bills LiteLLM and LiteLLM cannot bill anyone
  ([issue 14457](https://github.com/BerriAI/litellm/issues/14457)).
- Streaming requests that time out mid stream get logged as successes, so operators cannot
  alert on them ([issue 29602](https://github.com/BerriAI/litellm/issues/29602)).
- Whole endpoint families have silently escaped spend logging. Streaming `/v1/responses`
  requests never got a spend row because the success callback crashed non blockingly on a
  missing `usage` attribute ([issue 32487](https://github.com/BerriAI/litellm/issues/32487)).
  Streaming `/v1/messages?beta=true` requests never fired the async success handler at all
  ([issue 23150](https://github.com/BerriAI/litellm/issues/23150)).
- Budget enforcement has been bypassed by regressions more than once, letting spend continue
  past `max_budget` ([issue 26672](https://github.com/BerriAI/litellm/issues/26672),
  [issue 23714](https://github.com/BerriAI/litellm/issues/23714)).
- A cached authorisation object leaked one end user's budget onto a different end user
  sharing the same virtual key ([issue 29142](https://github.com/BerriAI/litellm/issues/29142)).
- New budget scopes get added to the read time check but forgotten in the reservation path,
  so they can be overshot under concurrency
  ([issue 34101](https://github.com/BerriAI/litellm/issues/34101)).

The pattern in that list is the point. Every one of those bugs sits where two code paths
divide: streaming against non streaming, one dialect against another, the path that checks a
balance against the path that reserves one. The fewer times the code divides, the fewer of
these bugs you get.

### 4.2 Portkey

Portkey is a managed gateway with an open source core. It sits between an application and a
large number of providers, and it wraps the call in a governance layer: workspaces, roles,
budgets, rate limits, audit trails.

Its budget model is attached to virtual keys. You set a limit in dollars on a virtual key,
and when the limit is reached the key expires and stops working
([budget limits](https://portkey.ai/docs/product/ai-gateway/virtual-keys/budget-limits)).
Note the granularity: the unit of budget is the key, not the request and not the run. That is
a simpler design than LiteLLM's counter hierarchy and it is closer to what we actually need,
because we can mint one key per run.

Budget limits are an enterprise plan feature, which tells you something about how much of the
value in a gateway sits in the accounting rather than in the proxying.

### 4.3 Helicone

Helicone started as observability rather than control. Its original integration was a proxy
deployed on Cloudflare Workers that logged the request and response, counted tokens, computed
cost, and applied caching and rate limits before forwarding
([availability](https://docs.helicone.ai/references/availability)).

Two design choices are worth stealing.

First, it also offers an **asynchronous mode** where your application calls the provider
directly and reports the call to Helicone afterwards. That removes Helicone from the request
path entirely, so it cannot add latency or take your application down. This is the right
answer when you only need to observe. It is the wrong answer for us, because we need to
enforce, and you cannot enforce from outside the path.

Second, it logs **after** the response has gone back to the client, by publishing to Kafka
and consuming in a separate service. The consequence is that the logging pipeline can be slow
or briefly broken without affecting a single user request.

Their changelog shows the streaming problem being fixed repeatedly rather than once
([stream fixes](https://www.helicone.ai/changelog/20250227-stream-fixes),
[log builder](https://www.helicone.ai/changelog/20250305-helicone-log-builder)). Streaming is
where this class of product spends its maintenance budget.

### 4.4 Cloudflare AI Gateway

Cloudflare's gateway runs at their edge. You change your base URL and get analytics, caching,
rate limiting, and retries without changing anything else
([overview](https://developers.cloudflare.com/ai-gateway/)).

The interesting part for us is **Unified Billing**, because it is exactly the arrangement we
need to build. Cloudflare holds the provider credentials. The caller never supplies an
OpenAI, Anthropic, or Google key; they authenticate with a Cloudflare API token instead.
Credits are purchased up front and drawn down per request. Credential resolution has a
documented precedence: a provider key on the request wins, then a stored key under the
default alias, then Cloudflare's own credentials
([unified billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/)).

Two details from that page matter. The fee is 5 percent on credits purchased, which is what a
company with enormous scale charges to run this service. And credit balances can occasionally
go negative, which triggers an automatic charge. Cloudflare, with all of their engineering,
accepts that a credit balance can overshoot. That is strong evidence that we should accept it
too rather than build a system that makes overshoot impossible.

### 4.5 Kong AI Gateway

Kong is a general API gateway that grew plugins for models. The relevant ones are `ai-proxy`,
which transforms and forwards requests to providers, and `ai-rate-limiting-advanced`, which
limits by tokens rather than by request count
([Kong AI Gateway](https://developer.konghq.com/ai-gateway/)).

Their handling of streaming is instructive. In streaming mode Kong captures each batch of
events and translates them into its own inference format, and it reads the usage statistics
from the final SSE frame before the `[DONE]` terminator
([streaming](https://developer.konghq.com/ai-gateway/streaming/)). For providers that do not
report usage on a completed stream, Kong **estimates** the token count instead. That is the
pragmatic answer to the missing usage problem, and it is worth keeping in our pocket.

Their rate limiter counts using token data returned by the provider and stores counters in
Redis, with local, cluster, and Redis strategies
([ai-rate-limiting-advanced](https://developer.konghq.com/plugins/ai-rate-limiting-advanced/)).
Because the token count only exists after the call, the limiter necessarily enforces on the
previous call's data. It is a post hoc control.

### 4.6 Envoy AI Gateway

Envoy AI Gateway is Envoy plus an external processor, which is a gRPC sidecar that Envoy
calls to inspect and modify requests and responses. The sidecar handles request
transformation, model extraction, provider authentication, and extraction of the token counts
([system architecture](https://aigateway.envoyproxy.io/docs/0.1/concepts/architecture/system-architecture/)).

The token counts get written into Envoy's dynamic metadata, and a rate limiting policy
consumes that metadata to limit on actual token consumption rather than request count
([usage based rate limiting](https://aigateway.envoyproxy.io/docs/0.1/capabilities/usage-based-ratelimiting/)).
The check for whether the total has reached the limit happens on each request, and a request
over the limit is rejected with HTTP 429.

Read that carefully: the check uses the count accumulated from **previous** requests, because
this request's token count does not exist yet. So concurrent requests can all pass the same
check. This is the overshoot problem, built into the architecture, in a project run by the
Envoy maintainers. It is not a mistake anyone made; it is what happens when the cost is only
knowable afterwards.

Envoy AI Gateway assumes Kubernetes. We deploy with docker compose on EC2. It is not a
candidate for us, but its architecture is the clearest statement of the problem.

### 4.7 Bifrost

Bifrost is an open source gateway from Maxim, written in Go, Apache 2.0 licensed, with an
OpenAI-compatible surface and around fifteen providers. Its pitch is overhead: the vendor
publishes benchmarks claiming roughly 11 microseconds of added latency at 5,000 requests per
second, and dramatically better tail latency than LiteLLM under sustained load
([benchmarks](https://www.getmaxim.ai/bifrost/resources/benchmarks)). Those numbers come from
the vendor comparing itself to a competitor, so treat the multiples as marketing and the
order of magnitude as plausible.

The relevant lesson is not the benchmark. It is that a gateway's job is mostly copying bytes,
and a gateway that parses and re-serialises everything pays for it. If our gateway forwards
the body untouched, we get most of Bifrost's advantage in Python without writing Go.

### 4.8 Routing products: OpenRouter and Vercel AI Gateway

These sell access to many models behind one key and one balance. Their internals are not
public, but their user facing contracts tell us what a mature version of our system looks
like.

OpenRouter holds a prepaid balance in dollars, computes cost from the provider's reported
token usage, and deducts in real time. Failed attempts and fallback attempts are not billed;
charges apply only to successful model runs
([OpenRouter FAQ](https://openrouter.ai/docs/faq)). For streaming responses, the cost is
exposed on the `usage` object and in an activity record so a customer can verify the bill.

Vercel's gateway is credit based by default, with a small monthly free allowance, and it
exposes `GET /v1/credits` returning remaining balance and lifetime spend
([usage and billing](https://vercel.com/docs/ai-gateway/observability-and-spend/usage)). Two
details are worth copying. Generation identifiers are returned on every response, and on
streaming responses they are injected into the first content chunk so a client can capture
the identifier before the stream finishes. That is how you correlate a stream with its ledger
entry when the stream might not complete.

Their edge cases are also instructive. When a request using the customer's own credentials
fails, the gateway falls back to system credentials, and that fallback usage is billed
against the credit balance ([BYOK](https://vercel.com/docs/ai-gateway/authentication-and-byok/byok)).
And there is an open complaint that the gateway blocks all requests when credits are
depleted, even for customers who configured their own key and should not need credits at all
([vercel/ai issue 11280](https://github.com/vercel/ai/issues/11280)). We will have exactly
this decision to make: what happens to a person who has their own key and a zero balance.

### 4.9 Comparison

| Product | Where it runs | Who holds the provider credential | How it limits spend | When the limit is evaluated |
| --- | --- | --- | --- | --- |
| LiteLLM | Your own Python service | Gateway (encrypted in its database) | Budgets per key, user, team, org, tag | Hold before the call, settled after |
| Portkey | Managed, with an open source core | Gateway, behind a virtual key | Dollar budget per virtual key; the key expires when exhausted | On the key, checked per request |
| Helicone | Cloudflare edge, or out of path | Caller (it is mainly observability) | Rate limits | Per request, using past data |
| Cloudflare AI Gateway | Cloudflare edge | Gateway, for Unified Billing | Prepaid credits, drawn per request | Per request; balances can go negative |
| Kong AI Gateway | Your own Kong cluster | Gateway (plugin config) | Token based rate limits, Redis counters | Per request, using past data |
| Envoy AI Gateway | Kubernetes | Gateway (external processor) | Token based rate limits via dynamic metadata | Per request, using past data |
| Bifrost | Your own Go service | Gateway | Budgets and rate limits | Per request |
| OpenRouter | Managed | Gateway | Prepaid dollar balance | Deducted after each successful run |
| Vercel AI Gateway | Managed | Gateway, or caller under BYOK | Prepaid credits | Per request |

The column that matters is the last one. Only LiteLLM takes a hold before the call. Everyone
else checks a number that the previous requests produced and accepts that concurrent
requests can overshoot.

---

## 5. Family two: products that built a small gateway because they had to

This family is more useful to us. These are agent and workflow platforms with the same
problem we have: a hosted product, users who have not connected a key, and a desire to fund
the first runs. None of them sell a gateway. All of them built the minimum that solved their
problem, which is exactly the question we are asking.

### 5.1 Dify

Dify is an open source platform for building applications on top of models. Its cloud version
gives new workspaces a free allowance on models Dify pays for. The implementation is
readable and small.

**The credential.** Dify's cloud deployment defines a `HostingConfiguration` that holds one
set of provider credentials per provider, read from environment variables, and only when the
deployment edition is `CLOUD`
([api/core/hosting_configuration.py](https://github.com/langgenius/dify/blob/main/api/core/hosting_configuration.py)).
Each hosted provider carries a `quota_unit` and a list of quotas, and each quota carries a
list of `RestrictModel` entries. So the free allowance is not just an amount; it is an amount
plus an explicit allowlist of models it may be spent on. For hosted Azure OpenAI that list is
written out model by model in the source.

**The unit of account.** This is the design choice that made their system small.
`QuotaUnit` can be `TOKENS`, `TIMES`, or `CREDITS`. When the unit is `CREDITS`, the cost of a
call is looked up from a static table keyed by model name, configured as a plain string like
`gpt-4:20,gpt-4o:10`, defaulting to 1 for any model not listed
([api/configs/feature/hosted_service/__init__.py](https://github.com/langgenius/dify/blob/main/api/configs/feature/hosted_service/__init__.py),
`HostedCreditConfig.get_model_credits`). The default free pool is 200 of those credits.

In other words: Dify does not price a call by counting tokens. It charges a flat number of
credits per call, chosen per model. A call that produced ten tokens and a call that produced
ten thousand cost the same. That is wildly inaccurate as a measure of cost, and it removes an
entire category of complexity, because you know the exact price before the call runs. It is
worth sitting with that trade for a moment before dismissing it.

**When the charge happens.** After the message is created, not before. A signal handler on
`message_was_created` computes the usage and deducts it
([api/events/event_handlers/update_provider_when_message_created.py](https://github.com/langgenius/dify/blob/main/api/events/event_handlers/update_provider_when_message_created.py)).

**How the deduction is written.** Two shapes exist side by side. For the older `FREE` quota
type, the deduction is a single conditional SQL update with a `WHERE Provider.quota_limit >
Provider.quota_used` predicate, so a row already at its limit simply does not match and the
update affects zero rows
(`_execute_provider_updates` in the same file). For the newer trial and paid pools,
`CreditPoolService` takes a per tenant Redis lock, then selects the pool row `WITH FOR
UPDATE`, then deducts
([api/services/credit_pool_service.py](https://github.com/langgenius/dify/blob/main/api/services/credit_pool_service.py)).
The Redis lock is not there for correctness (the row lock provides that); the docstring says
it is there to stop concurrent accounting for one tenant from piling up database
transactions.

**They accept overshoot, deliberately and in two different ways.** `CreditPoolService`
exposes both `check_and_deduct_credits`, which deducts the full amount or raises without
touching the pool, and `deduct_credits_capped`, which deducts up to the remaining balance and
returns how much it actually took. The post generation accounting path calls the capped
version and merely logs a warning when the pool was exhausted mid deduction, because failing
there would fail the persistence of a message the user already received.

**They also have the full pattern, behind a flag.** When billing is enabled, the same service
delegates to a billing service with `quota_reserve`, `quota_commit`, and `quota_release`, with
a `reservation_id` and a `request_id` for idempotency. So Dify shipped the simple version in
the open source product and grew the reserve and settle version for the hosted one. That is
the ladder we should climb, in the same order.

**Pre-call check.** Separately from the deduction, `ensure_llm_quota_available_for_model()`
raises `QuotaExceededError` when the model's status is already `QUOTA_EXCEEDED`
([api/core/app/llm/quota.py](https://github.com/langgenius/dify/blob/main/api/core/app/llm/quota.py)).
It reads a status, not a live balance. The check is a coarse gate; the deduction is the
accounting.

**What they chose not to build.** No hold before the call in the open source path. No
per token pricing in the credits mode. No streaming aware accounting; the charge happens once
per message, from the persisted message record. No proxy at all, in fact, which is the next
point.

**The one structural difference from us.** Dify makes the model call from its own backend.
The credential never leaves Dify's server, so Dify does not need a proxy; the "gateway" is
just a branch inside the application that picks the hosted credential instead of the user's.
We cannot do that, because our model calls originate inside a container the user controls.
This is the single fact that forces us to build a network service where Dify only needed a
function call.

### 5.2 n8n

n8n is the closest analogue to our situation, and their implementation is the most direct
template for what we should build.

n8n is a workflow automation product. Workflows run nodes, and a model node needs a
credential. n8n cloud offers new users free model credits. Because n8n workflows can run on a
self hosted instance that n8n does not control, n8n faces the same problem we do: the thing
making the model call is not on their machine.

**The first version: a scoped key plus a base URL.** `FreeAiCreditsService.claim()` asks
n8n's cloud service for credits, gets back `{ apiKey, url }`, and stores them as a **managed
credential** of type `openAiApi` in the user's project
([packages/cli/src/services/free-ai-credits.service.ts](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/services/free-ai-credits.service.ts)).
The user then picks that credential in a node like any other. Their eligibility check is one
boolean expression: licensed for credits, a base URL is configured, not already licensed for
the newer gateway, and the user has not claimed before. A single `userClaimedAiCredits` flag
on the user record prevents a second claim.

The key insight is that they did not change the node. The OpenAI node already accepted an API
key and a base URL, so pointing it at n8n's proxy required no new code path in the node at
all. **We have the same property**: our runner already supports a custom OpenAI-compatible
connection with a base URL, and that path is already tested (see `prior-work/repo-findings.md`
for the full trace, and `services/runner/src/engines/sandbox_agent/pi-model-config.ts:85` for
the gate that enables it).

**The second version: short lived tokens and per run attribution.**
`AiGatewayService.getSyntheticCredential()` builds a credential on demand, at the moment a
node asks for its decrypted credential
([packages/cli/src/services/ai-gateway.service.ts](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/services/ai-gateway.service.ts)).
It returns the provider's expected API key field set to a JSON web token, and the provider's
expected URL field set to a URL pointing at n8n's gateway. The tokens are cached in memory
with an expiry and a refresh time, so a token is short lived rather than permanent.

The URL carries the run identity. When the execution identifier and the workflow identifier
are known, the gateway path becomes
`<base>/v1/gateway/exec/<executionId>/<workflowId>/openai/v1` instead of
`<base>/v1/gateway/openai/v1`, and the comment in the source says the gateway's rewriting
middleware strips the prefix before proxying upstream, so the client library never knows it
is there while the gateway records both identifiers in usage metadata.

That is an elegant trick and we should copy it. It gives per run attribution with no change
to the request body and no custom header that a client library might drop.

There is also a `providerConfig` fetched from the gateway and cached for an hour, mapping
each credential type to a gateway path, a URL field name, an API key field name, and
optionally a `routing` map so one credential can fan out to several gateway providers. A
failed config fetch is cached for a minute so a gateway that is down does not get hammered.

**The balance.** `getWallet()` returns `{ budget, balance }` from `GET /v1/gateway/wallet`,
and `getUsage()` returns a paginated history from `GET /v1/gateway/usage`. So the ledger lives
on the gateway side and the product reads it over HTTP.

**What they chose not to build, at least on the client side.** No local balance. No local
enforcement. The workflow does not know how many credits are left when it starts a node; it
just calls, and the gateway decides. Attribution is by user, resolved from the project or
workflow owner, not by organization.

### 5.3 Activepieces

Activepieces is an open source automation platform. It sells "AI credits" as a first class
unit and states the reason plainly: credits exist so people can try new models without
setting up API keys, and to avoid the friction of key generation
([Universal AI pieces](https://community.activepieces.com/t/universal-ai-pieces/6424)).

Their pricing unit is coarse in the same way Dify's is. A flow run costs one credit
regardless of how many steps it has. An AI step costs between 2 and 20 credits depending on
the model, or 1 credit if the user brings their own key
([AI credits usage table](https://community.activepieces.com/t/ai-credits-usage-table/10166)).
The free plan includes 200 AI credits ([pricing](https://www.activepieces.com/pricing)).

Two things to take from this. First, another independent team chose a flat price per call
over per token accounting for a free tier. Second, they use the credit price as a product
lever: bringing your own key costs 1 credit instead of 20, which nudges people toward
connecting a key without forbidding anything.

### 5.4 Flowise

Flowise is the control case. It is an open source builder with a hosted plan, and it did
**not** build a gateway. The user supplies their own provider key in the credentials section
of a node, and Flowise's own pricing is metered in "predictions", meaning workflow runs, with
100 per month on the free tier ([pricing](https://checkthat.ai/brands/flowise/pricing)).

So Flowise charges for its own product and lets the model bill go to the user directly. That
is a legitimate answer, and it is the answer we have today. It is worth naming because it is
the baseline the credit system has to beat.

### 5.5 What the embedded family teaches

Four patterns recur.

**They pick a coarse unit of account.** Dify charges a fixed number of credits per model
call. Activepieces charges 2 to 20 credits per AI step. Neither converts tokens to money in
real time for the free tier. This removes the need to know the true cost before the call, and
it makes the balance easy for a user to reason about.

**They charge after the fact and accept overshoot.** Dify's post generation path deducts up
to the remaining balance and logs a warning when the pool ran dry. Nobody fails a response
that the user already received.

**They keep the allowlist explicit.** Dify's hosted quotas name the exact models the free
allowance may be spent on. This is the control that actually bounds the cost, more than the
balance does, because it stops a cheap allowance being spent on an expensive model.

**They put run identity in the path, not the body.** n8n encodes the execution and workflow
identifiers as a URL prefix that the gateway strips. This gives attribution without touching
the request body, which as section 10 explains is the difference between preserving prompt
caching and destroying it.

---

## 6. What our own code already provides

Before designing anything, it is worth listing what already exists, because more exists than
you would expect.

**A conditional atomic counter with limits.** `MetersDAO.adjust()` at
`api/ee/src/dbs/postgres/meters/dao.py:376` performs a Postgres `INSERT ... ON CONFLICT DO
UPDATE ... WHERE ... RETURNING`. The `WHERE` clause encodes the limit. In strict mode the
predicate is `greatest(value + delta, 0) <= limit`, so a write that would cross the limit
matches no row, the statement returns nothing, and the caller learns it was denied. In non
strict mode the predicate is `value < limit`, so a request starting below the limit is
allowed to cross it once, and the next one is denied. Negative deltas are clamped at zero by
`greatest(..., 0)`, which means **refunds already work**. There is also a Python side fast
path that rejects any single write larger than the whole limit.

This is a hold and settle primitive. A positive delta is a hold. A negative delta is a
release. The `RETURNING` clause tells you the resulting value. We do not need to build the
atomic counter; we need to use it.

**A credits counter that already exists.** `Counter.CREDITS_CONSUMED` is defined at
`api/ee/src/core/access/entitlements/types.py:55` and appears in the quota table for several
plans, for example at line 348 with `free=100, limit=100, strict=True, period=MONTHLY`. It is
already wired to a check: `api/oss/src/apis/fastapi/access/router.py:81` calls
`check_entitlements(key=Counter.CREDITS_CONSUMED, delta=1)` to gate local secret usage, and
returns the resulting meter value.

**A quota model with the right knobs.** `Quota` at
`api/ee/src/core/access/entitlements/types.py:92` carries `free`, `limit`, `strict`,
`retention`, `scope` (organization, workspace, project, or user) and `period`.

**A tested path for pointing a run at our own base URL.** The runner writes a per run
`models.json` with a base URL and one pinned model whenever the connection is an
Agenta managed custom OpenAI-compatible provider
(`services/runner/src/engines/sandbox_agent/pi-model-config.ts:85`). It refuses to run rather
than fall back to a default provider when any piece is missing. The credential is referenced
as `$OPENAI_API_KEY` and never written as a literal.

**A naming collision to avoid.** `api/oss/src/core/gateway/` already exists and holds the
**tool** gateway (connections and catalogs for Composio). The model gateway needs a different
name.

---

## 7. Streaming

### 7.1 What a gateway has to do

A streaming model response is an HTTP response with `Content-Type: text/event-stream` whose
body arrives in pieces over several seconds. To relay it correctly a gateway has to do four
things.

**Read and write incrementally.** The gateway must start writing to the caller before it has
finished reading from the provider. In Python this means using an HTTP client that exposes
the response as an async iterator (`httpx`'s `stream()`), and returning a FastAPI
`StreamingResponse` that consumes it. Anything that calls `response.read()` or
`response.json()` has already destroyed the stream.

**Not buffer, anywhere in the chain.** This is where most implementations fail, and the
failure is invisible in development because a local test with a short answer completes fast
enough that nobody notices. If a reverse proxy in front of the gateway buffers, the entire
response accumulates before the first byte reaches the user. The concrete settings are
`proxy_buffering off;` and `chunked_transfer_encoding on;` for nginx
([configuring SSE through nginx](https://oneuptime.com/blog/post/2025-12-16-server-sent-events-nginx/view)).
Not disabling buffering causes the gateway to wait for the complete response before
forwarding, which defeats streaming entirely. The symptom is that time to first token becomes
equal to total generation time. For our workload, with roughly 23,600 tokens of context
replayed per call and two or three calls per user message, that is the difference between an
agent that feels alive and one that appears frozen for tens of seconds.

**Preserve the framing.** SSE has real syntax: `data: ` prefixes, blank lines as event
separators, and in the OpenAI dialect a terminating `data: [DONE]`. A gateway that reads the
stream in fixed size byte blocks and writes them straight out preserves the framing
automatically, because it never interprets it. A gateway that parses events and re-emits them
must get the separators exactly right or clients will hang waiting for an event boundary that
never comes.

**Handle a mid stream error.** Once the gateway has written the first byte, the HTTP status
line and headers are already committed and cannot be changed. If the provider fails at that
point, the gateway cannot return a 500. The error has to be delivered inside the stream, as
an event, and the client has to distinguish it from a dropped connection
([how streaming LLM APIs work](https://til.simonwillison.net/llms/streaming-llm-apis)). This
also means the gateway must decide the outcome of the whole call before it writes the first
byte, because after that it has no way to refuse.

### 7.2 Byte relay versus parse and re-emit

There are two implementations, and the choice has consequences all through the system.

**Byte relay.** Copy bytes from the upstream response to the downstream response without
interpreting them. This is fast, it cannot corrupt the framing, and it works for any dialect
including ones you have never seen. The cost is that you do not know what went past, so you
cannot extract usage.

**Parse and re-emit.** Decode each event, read its JSON, and forward it. Now you can capture
usage and inject fields. The cost is that you own the correctness of the framing, you add per
chunk overhead, and you inherit every difference between dialects.

**The useful middle.** Relay the bytes untouched and, in the same loop, keep a copy of the
last few events for inspection after the stream ends. You forward what you read, byte for
byte, and separately scan a small tail buffer for the usage object. You get the safety of
byte relay and the accounting of parsing, and the only cost is a few kilobytes of memory per
in flight stream. This is what we should build.

---

## 8. Usage accounting on a streamed response

### 8.1 Where the numbers come from

For a non streaming call, the response body contains a `usage` object and the problem does
not exist.

For a streaming call in the OpenAI dialect, usage is absent by default. The caller must ask
for it by sending `stream_options: {"include_usage": true}`. When they do, an extra chunk is
streamed as the final chunk; the `usage` field is null on every chunk except that one, and
the final chunk's `choices` array is empty
([how to stream completions](https://cookbook.openai.com/examples/how_to_stream_completions)).

Anthropic's messages dialect splits the numbers. The `message_start` event carries the input
token count, and the `message_delta` event carries the running output token count, so a
client must capture both to know the total. Cache related counts
(`cache_creation_input_tokens`, `cache_read_input_tokens`) also arrive on those events.

The practical consequences are three.

1. **If the caller does not ask for usage, you do not get it.** A gateway that wants usage on
   every call has to inject `stream_options` into the request itself.
2. **The numbers arrive last.** For most of a call's life the gateway does not know what the
   call cost.
3. **The numbers can be missing even when you asked.** Kong estimates tokens for providers
   that do not report them on a completed stream
   ([Kong streaming](https://developer.konghq.com/ai-gateway/streaming/)). Estimation is the
   accepted fallback.

**Unverified for our stack.** Whether our harness sets `stream: true`, and whether it sets
`stream_options.include_usage`, is not determined by anything in our repository. A search for
`stream_options` and `include_usage` across `services/`, `sdks/`, `api/oss/src`, and
`web/oss/src` returns nothing, and the harness that makes the call is a third party package
running inside the sandbox. **The test that settles it:** point a run at a throwaway HTTP
server that logs the request body and returns a canned stream, then read the logged body.
This should be done before any design is finalised, because the answer decides whether the
gateway has to modify the request.

### 8.2 What happens when the caller disconnects

The caller closes the connection halfway through. The provider is still generating, or has
already generated, and will bill for it. The gateway never sees the final chunk, so it never
learns the token counts.

This is not a hypothetical. It is
[LiteLLM issue 14457](https://github.com/BerriAI/litellm/issues/14457), reported with a code
reference showing the exception handler logging a failure and computing no usage, and titled
"Usage data lost when streaming responses are terminated early by client disconnect". The
consequence stated in the issue: the provider bills, and the gateway cannot bill downstream.

A related failure is subtler. A stream that times out mid flight is logged as a **success**,
because from the accounting code's point of view nothing raised
([LiteLLM issue 29602](https://github.com/BerriAI/litellm/issues/29602)). So the operator
cannot even see the problem in their metrics.

There are four possible responses, and they are not mutually exclusive.

**Charge the input only.** You always know the input token count, because you sent the
request and can count it yourself. LiteLLM's cancellation path does exactly this: it settles
the reservation to the input cost rather than refunding to zero, on the explicit reasoning
that the provider call was already dispatched, so the input was billed regardless, and
refunding to zero would let a caller abort early to avoid paying
(`release_budget_reservation_on_cancel` in
[budget_reservation.py](https://github.com/BerriAI/litellm/blob/main/litellm/proxy/spend_tracking/budget_reservation.py)).

**Estimate the output from what you relayed.** You saw every chunk that went past, so you can
count the characters you forwarded and divide by roughly four to estimate output tokens. This
is what Kong does for providers that report nothing. It undercounts, because the provider
kept generating after the caller left.

**Keep reading the stream after the caller has gone.** The provider does not know your caller
disconnected. If you keep consuming until the final chunk, you get the exact usage. You pay
for tokens nobody will read, but you were going to pay for them anyway, and you get accurate
accounting. This is the most accurate option and it is only a few lines: catch the write
failure, stop writing, keep iterating.

**Charge a fixed amount per call.** If the unit of account is a flat number of credits per
model call rather than a token count, then a disconnect changes nothing. You knew the price
before you started. This is Dify's and Activepieces' answer, and it makes the entire section
disappear.

### 8.3 Ambiguous outcomes

A call whose outcome is unclear is the hard case: the connection dropped, the provider
returned a 500 after streaming half an answer, or a timeout fired while generation was still
running. A timeout does not mean the provider did nothing; the model may have finished
generating after the caller stopped waiting.

Implementations converge on a rule that is worth stating as a principle: **charge for work
the provider actually performed, not for work the caller successfully received.** OpenRouter
does not bill failed or fallback attempts and charges only for successful runs
([FAQ](https://openrouter.ai/docs/faq)), which is the customer friendly end. LiteLLM charges
the input on cancellation, which is the accurate end. The two are consistent if you read
"successful" as "the provider ran the model".

---

## 9. Budget enforcement

### 9.1 Check before, or reconcile after

**Check before** means: read the balance, and if it is above zero, allow the call. It is one
read. It is fast. It is what Envoy AI Gateway does, what Kong's token limiter does, and what
Dify's `ensure_llm_quota_available_for_model()` does.

**Reconcile after** means: when the call finishes, subtract what it actually cost. It is one
write. It is accurate about the past.

The two together are the obvious design, and almost every implementation uses them.

### 9.2 Why checking alone lets concurrent calls overshoot

Here is the failure, concretely. An organization has 100 credits left. Twenty calls arrive at
the same moment. All twenty read the balance. All twenty see 100. All twenty are allowed. All
twenty run. Each costs 40. The organization has now spent 800 credits against a balance of
100.

Nothing in the check is wrong. The problem is that the check reads a number that only
reflects calls which have already **finished**, and the cost of a call is not knowable until
it finishes. Between the check and the write there is a window, and every request in flight
during that window is invisible to every other request.

The overshoot is bounded by a simple formula:

    worst case overshoot = (number of concurrent in-flight calls) x (maximum cost of one call)

Both factors are controllable. You can limit concurrency, and you can cap the maximum cost of
a single call by capping `max_tokens` and restricting which models may be called. That is the
key insight for our design: **you do not need a hold if you can make the product of those two
numbers small enough to not care about.**

### 9.3 The hold and settle pattern

A hold, also called a reservation, closes the window. Before the call:

1. Estimate the maximum this call could cost.
2. Atomically add that estimate to the spend counter and read the result back.
3. If the result exceeds the limit, subtract the estimate again and reject the call.
4. Otherwise, run the call.

After the call:

5. Compute the true cost from the usage.
6. Atomically apply the difference `true_cost - estimate` to the counter.

Now the twenty concurrent calls each add 40 to the counter as they arrive. The third one
takes the counter to 120, sees that it is over 100, and is refused. The overshoot is at most
one call's estimate.

LiteLLM's implementation matches this exactly, function for function
(`reserve_budget_for_request`, `reconcile_budget_reservation`, `release_budget_reservation`,
`release_budget_reservation_on_cancel` in
[budget_reservation.py](https://github.com/BerriAI/litellm/blob/main/litellm/proxy/spend_tracking/budget_reservation.py)).
Dify's billing path has the same three operations under different names (`quota_reserve`,
`quota_commit`, `quota_release`, with a `reservation_id` and a `request_id`).

**The estimate is the hard part.** You have to guess the worst case cost before the call. The
input side is easy: you can count the tokens in the request. The output side is bounded by
`max_tokens` if the caller supplied it, and unbounded if they did not, in which case you have
to substitute the model's maximum output length. That produces very pessimistic holds. If a
model can emit 8,000 output tokens and a typical answer is 300, your hold is more than twenty
times the real cost, and users will hit their limit long before they have actually spent
anything. LiteLLM's answer when it cannot estimate at all is to skip the reservation and fall
back to checking the balance only.

**Holds create their own failure modes.** A hold that is never settled leaks. LiteLLM's
cancellation docstring describes precisely this: an unreconciled reservation pins the counter
above real spend and causes 429 responses until the counter's time to live expires. So a hold
system needs a settlement path on every exit, including cancellation, and a time to live as a
backstop. That is three or four extra code paths, each of which is a place a bug can live.

### 9.4 What the real implementations actually do

The honest summary: almost nobody takes a hold. LiteLLM does, and it took them several
iterations and their tracker still carries issues about scopes that were added to the check
but forgotten in the reservation ([issue 34101](https://github.com/BerriAI/litellm/issues/34101)).
Cloudflare, at their scale, lets balances go negative and charges the card
([unified billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/)).
Dify's open source path deducts up to the remaining balance and logs a warning when it runs
out.

The lesson is not that holds are wrong. It is that overshoot is normally cheaper than the
complexity of preventing it, and the right first move is to bound the overshoot rather than
eliminate it.

### 9.5 Where the counter lives

Two options.

**Redis.** Fast, atomic through `INCRBY`, shared across processes. LiteLLM keeps the
authoritative hot counter in Redis and reconciles the database in the background. The risk is
that Redis is not durable by default; if it restarts, the counter is gone. LiteLLM handles
this with a reseed from the database, and a comment in their code records that an earlier
approach of deleting the inconsistent counter left budgets unenforced after a Redis reload.

**Postgres.** Slower, but durable and transactional. Our existing `MetersDAO.adjust()` does
the whole check and increment in one statement
(`api/ee/src/dbs/postgres/meters/dao.py:376`), which means no separate lock and no race. For
our expected call volume, one indexed upsert per model call is not a meaningful cost.

For us the answer is Postgres, because the code already exists and because our request rate
is far below the level where the difference matters.

---

## 10. Prompt caching through a proxy

This is the section with the most money attached to it. Our harness replays roughly 23,600
tokens of context on every model call. If those tokens hit the provider's cache, we pay a
fraction of list price for them. If they miss, we pay full price, on every call, two or three
times per user message.

### 10.1 How a provider decides to hit or miss

All three major providers work on the same principle with different controls.

**OpenAI.** Caching is automatic. A cache hit requires an **exact prefix match**, and only
prompts of at least 1,024 tokens are eligible; after that, hits occur in increments of 128
tokens. The cached portion includes the whole messages array, images in user messages, tool
definitions, and structured output schemas. Cached prefixes stay eligible for at least 30
minutes. Caches are not shared between organizations
([prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)).

There is a routing dimension that most people miss. Requests are routed to a specific machine
based on a hash of the beginning of the prompt, and the cache lives on that machine. The
`prompt_cache_key` parameter is combined with that hash. Sending the same
`prompt_cache_key` for requests that share a long prefix keeps them landing on the same
machine and raises the hit rate. OpenAI's guidance is to keep roughly 15 requests per minute
per key and to split traffic across several keys above that.

**Anthropic.** Caching is explicit. You mark a `cache_control` breakpoint on the last block
you want cached, and everything before it (tools, then system, then messages, in that order)
becomes the cached prefix. The prefix must be byte identical to hit. Reordering a tools array,
shuffling retrieved documents, or inserting a timestamp anywhere before the breakpoint causes
a miss, and the call still succeeds; you simply pay full price and get no error
([prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).

**Google.** Gemini 2.5 models have implicit caching on by default, with no action required.
A request that shares a common prefix with a recent request is eligible. The minimum input is
2,048 tokens for 2.5 Flash and 2.5 Pro, and the discount on cached tokens is around 90
percent. The guidance is to put large common content at the beginning and to send similar
requests close together in time
([Gemini context caching](https://ai.google.dev/gemini-api/docs/caching)). Vertex AI also
offers explicit context caching with a managed cache resource
([Vertex context cache overview](https://cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview)).
Both report the cached portion as `cachedContentTokenCount` in the response metadata, which
maps to `prompt_tokens_details.cached_tokens` on the OpenAI-compatible surface.

### 10.2 The four ways a proxy breaks it

**Reordering fields.** If a gateway deserialises the JSON body into objects and serialises it
back, the key order of every object can change, and so can the exact formatting. Whether that
breaks the cache depends on whether the provider hashes raw bytes or a normalised form.
Providers do not document this. The safe rule is: **do not re-serialise the body**. If you
must modify it, modify the bytes minimally rather than round tripping the whole document.
This is not a hypothetical concern; the cache miss is silent, so you will not find out from
an error.

**Changing content inside the prefix.** Anything a gateway injects into the messages array,
the system prompt, or the tools array becomes part of the prefix. Injecting a request
identifier, a timestamp, or a policy preamble into any of those changes the prefix on every
call and guarantees a permanent miss. Metadata belongs outside the cached region: in headers,
in the URL, or in body fields that are not part of the prefix.

This is exactly why n8n's choice to carry the execution identifier in the **URL path**
(`/v1/gateway/exec/<executionId>/<workflowId>/openai/v1`) rather than in a body field is the
right one.

**Splitting traffic across backends.** This is the least obvious failure and the most severe.
A gateway that load balances across several provider accounts, projects, or regions splits
one workload's traffic across several caches. With N backends chosen at random, the hit rate
falls to roughly 1/N even though nothing about the request changed. OpenAI's documentation
makes the mechanism explicit through `prompt_cache_key` and prefix hash routing, and their
statement that caches are not shared between organizations means a gateway that fails over to
a second organization's account starts from a cold cache. Google's guidance to send similar
requests within a short window is the same constraint stated differently.

The rule is: **route by conversation, not by round robin.** If you must have several
backends, hash something stable about the conversation to pick one, so every call in a run
lands on the same backend.

**Translating between dialects.** Translation breaks caching more often than anything else
here, and the LiteLLM
tracker documents it well. `cache_control` gets applied to every content item instead of only
the last, which Anthropic's API does not accept
([issue 15696](https://github.com/BerriAI/litellm/issues/15696)). An `anthropic-beta` header
gets set unconditionally and Vertex rejects it, so cache enabled requests routed to Vertex
fail outright ([issue 14293](https://github.com/BerriAI/litellm/issues/14293)). Anthropic's
multi point caching gets mapped onto Gemini's prefix caching with the wrong semantics
("first found" versus "last wins")
([issue 17201](https://github.com/BerriAI/litellm/issues/17201)). Cache token counts do not
get normalised into the standard field, so the metrics that would have shown you the problem
never increment ([issue 27763](https://github.com/BerriAI/litellm/issues/27763)).

**One more, specific to gateways that overwrite identity fields.** LiteLLM has an option
called `overwrite_user_with_key_hash` that force sets the outgoing `user` field on every
request to a hash of the calling key, always overriding whatever the client sent
([virtual keys](https://docs.litellm.ai/docs/proxy/virtual_keys)). It exists for attribution
and it is a reasonable feature. But the `user` field participates in cache bucketing, so a
gateway that rewrites it changes the routing without meaning to. Any field a gateway rewrites
for its own convenience should be checked against the provider's caching documentation first.

### 10.3 The rule to design against

State it once and put it in the code as a comment: **the gateway forwards the request body
byte for byte, and carries its own metadata in the URL and in headers.** Every exception to
that rule needs a named reason and a test that shows `cached_tokens` is still non zero after
the change.

The one exception we may be forced into is injecting `stream_options: {"include_usage":
true}` when the harness does not send it. That field is not part of the messages, tools, or
schema, so it should not participate in the prefix. **Unverified.** The test that settles it:
send two identical requests with a long shared prefix, one with `stream_options` and one
without, and compare `prompt_tokens_details.cached_tokens` on the second call of each pair.

---

## 11. Credential isolation

The requirement is that the real provider credential never enters the sandbox, and that
whatever does enter the sandbox is worth little if it leaks. Assume it will leak, because the
user writes the instructions the agent follows and an agent with a shell can read its own
environment.

**What the caller gets instead.** A token that identifies one run and nothing else. The
patterns in use:

- **A long lived virtual key stored in a database.** LiteLLM hashes the key and stores the
  hash; the real provider keys are stored encrypted under a salt
  ([virtual keys](https://docs.litellm.ai/docs/proxy/virtual_keys),
  [security FAQ](https://docs.litellm.ai/docs/proxy/security_encryption_faq)). The stated
  benefit is that a leaked virtual key is contained to its budget and its model list.
- **A short lived signed token minted per use.** n8n's gateway service fetches a JSON web
  token with an `expiresIn`, caches it in memory with an expiry and a refresh time, and
  builds the credential on demand when a node asks for it
  ([ai-gateway.service.ts](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/services/ai-gateway.service.ts)).
- **A platform credential that is not a model credential at all.** Cloudflare's Unified
  Billing has the caller present a Cloudflare API token; Cloudflare holds the provider keys
  ([unified billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/)).

**What the token must be scoped to.** This is where a design gets it wrong quietly. If the
token only says "this organization may spend", then a user who reads it out of their sandbox
can call our gateway from their laptop, with any body they like, forever. So the token needs:

- **An expiry** short enough that a leaked token dies with the run. The run's own timeout is a
  reasonable bound.
- **A single run identity**, so usage attributes correctly and so a per run cap is possible.
- **A model allowlist enforced at the gateway.** This is the one that converts our existing
  advisory pinning into a real boundary. Today `models.json` pins the model inside the
  container, where the user can ignore it. The gateway must reject a request whose `model`
  field is not on the list, because that is the only place the check counts. Dify's hosted
  quotas carry exactly such a list of `RestrictModel` entries.
- **A cap on `max_tokens`**, so a single call cannot be arbitrarily expensive. This is what
  bounds the overshoot arithmetic in section 9.2.
- **A per run credit cap**, separate from the organization balance, so one runaway agent
  cannot drain the whole allowance.

**The trade between a stored key and a signed token.** A stored key needs a database lookup
per call, which you then cache, which introduces the cache invalidation bugs LiteLLM has hit
(a cached authorisation object leaking one user's budget onto another,
[issue 29142](https://github.com/BerriAI/litellm/issues/29142)). A signed token needs no
lookup, because the claims travel inside it, but it cannot be revoked before it expires
unless you keep a revocation list, which is a lookup again. For short expiries the signed
token is simpler and the inability to revoke matters less.

---

## 12. Translating between providers

A gateway that speaks one dialect in and one dialect out is a byte forwarder. A gateway that
accepts OpenAI's dialect and speaks Anthropic's or Google's native dialect upstream has to
map every field in both directions: message shapes, tool call formats, streaming event names,
finish reasons, token count field names, and the caching annotations.

**The evidence says do it late.** The LiteLLM issues in section 10.2 are all translation
bugs, and they are all in the part of translation that touches caching, which is the part
where mistakes cost money silently. Adding a second dialect roughly doubles the surface where
a streaming or accounting bug can hide, and the LiteLLM tracker shows exactly that: separate
bugs for `/v1/messages` and `/v1/responses` that did not exist for `/v1/chat/completions`
([issue 23150](https://github.com/BerriAI/litellm/issues/23150),
[issue 32487](https://github.com/BerriAI/litellm/issues/32487)).

**For us specifically, translation may not be needed at all.** Vertex AI exposes an
OpenAI-compatible chat completions endpoint that accepts the OpenAI libraries directly
([using OpenAI libraries with Vertex AI](https://cloud.google.com/vertex-ai/generative-ai/docs/migrate/openai/overview)).
Our runner already speaks that dialect and only that dialect. So the first version can be a
pass through with an authentication swap: the same dialect in and out, no field mapping at
all.

The documented limitation is that Gemini features with no OpenAI equivalent must be passed
inside `extra_body` or they are ignored. That is acceptable for a free tier.

**Two things to verify before committing.** Whether the OpenAI-compatible endpoint honours
`stream_options: {"include_usage": true}`, and whether it reports cached tokens in
`prompt_tokens_details.cached_tokens`. Neither is stated plainly in Google's own
documentation. **The test that settles both:** send one long request twice through the
endpoint with streaming on and `stream_options` set, and read the final chunk of the second
response. If usage is absent, we need a different way to get token counts. If
`cached_tokens` is zero on the second call, implicit caching is not reaching us and the cost
model changes completely.

**When translation becomes worth it.** When we want a second provider for redundancy, or when
a user's own key is for a provider whose dialect differs. Both are later problems. The design
should leave room by keeping the provider specific parts in one module, and by not letting
the dialect leak into the ledger's schema.

---

## 13. Retries, timeouts, and who pays for a failure

**A retry can double the bill.** If the gateway times out at 30 seconds and retries, and the
first call was actually still running, the provider ran the model twice and will bill twice.
The gateway saw one success. Without an idempotency key, a network timeout during an
expensive call can charge several times over.

**A timeout is not evidence that nothing happened.** The model may finish generating after
the caller stops waiting. Timing out at 30 seconds is normal for a long context reasoning
call, so a short timeout turns routine slowness into a duplicate charge.

**Set timeouts that match the workload.** A gateway needs a long overall timeout and a short
time to first byte timeout. If the provider has not sent a single byte in ten seconds,
something is wrong and retrying is safe, because nothing has been generated. Once bytes are
flowing, the call is committed, and the right move is to wait. This split is the single most
useful timeout policy for a streaming gateway, and it also solves the retry safety question:
**only retry before the first byte.**

**Cap the retries in aggregate.** A provider having a bad minute causes every request to
retry, which multiplies load exactly when the provider is least able to take it. A global cap
on retry volume, small relative to base traffic, stops the amplification.

**Decide what a failure costs the user, and write it down.** OpenRouter does not bill failed
or fallback attempts and charges only for successful runs
([FAQ](https://openrouter.ai/docs/faq)). LiteLLM charges the input cost on cancellation. Both
are defensible. For a free tier funded by us, the generous rule is better: a call that
returned an error to the user costs the user nothing, and we absorb it. The exception should
be a caller who repeatedly aborts after the input was dispatched, which is the abuse
LiteLLM's cancellation reasoning is guarding against.

**Idempotency, concretely.** Attach a unique identifier to each attempt at charging. Write it
on the ledger entry with a unique constraint. A duplicate write then fails cleanly rather than
charging twice. Dify's billing calls carry a `request_id` for exactly this. It costs one
column and one index, and it is much easier to add now than to backfill later.

---

## 14. The complexity ladder

Each rung adds one capability. Each rung is useful on its own. The point of the ladder is
that you can stop at any rung and still have a working system, and that no rung invalidates
the data model of the rung below it.

**Rung 0. A dumb forwarder.** One endpoint that accepts an OpenAI chat completion, swaps the
authorization header for the real credential, forwards the request to the provider, and
streams the response back untouched. No balance, no accounting, no allowlist. About 100 lines.
This buys the thing we cannot get any other way: the provider credential is out of the
sandbox. It buys nothing else. It is worth building first because everything above it is an
addition rather than a change.

**Rung 1. Identity and an allowlist.** The caller presents a token instead of a provider key.
The gateway validates it, learns which organization and run it belongs to, checks the
requested model against a list, and rejects anything else. This converts our advisory model
pinning into an enforced one. Adds maybe 150 lines. This is the rung that stops the "read the
key and call an expensive model" attack, and it is worth more than the balance check.

**Rung 2. Usage recorded.** Extract the usage object from the response (the last chunk for a
stream) and write a ledger entry. Do it after the response has been delivered. Do not enforce
anything with it yet; just watch. Adds maybe 200 lines including the ledger tables. This buys
the data you need to choose sane limits, and a month of it will tell you more about pricing
than any amount of estimating.

**Rung 3. A balance checked before the call.** Read the organization's balance before
forwarding. Refuse when it is at zero. Accept the overshoot described in section 9.2, and
bound it with a `max_tokens` cap and the model allowlist. Adds maybe 100 lines on top of rung
2, and less than that for us because `MetersDAO.adjust()` already does the atomic conditional
work. This is the rung at which the product is real: a person can be given credits, spend
them, and be stopped.

**Rung 4. A per run cap.** A second, smaller limit scoped to one run, so one agent cannot
drain an organization's balance in a loop. Adds maybe 80 lines. This matters more than it
looks, because an agent in a tool calling loop is the realistic way a balance disappears in
90 seconds.

**Rung 5. Robust accounting for streams.** Handle the disconnect case: keep consuming the
upstream stream after the caller has gone so the usage is captured, or fall back to charging
the input plus an estimate of the output. Adds maybe 100 lines and a real test. This is the
rung that stops the uncharged calls LiteLLM issue 14457 describes.

**Rung 6. Holds and settlement.** Estimate the maximum cost, hold it, settle to the true cost
afterwards, release on every exit path including cancellation, and add a time to live as a
backstop. Adds 300 to 500 lines and several new failure modes. Buy this when the measured
overshoot from rung 3 actually costs money. The data from rung 2 will tell you.

**Rung 7. Several backends and failover.** More than one provider account or project, with
routing. Only do this with conversation affinity, as section 10.2 explains, or you will halve
the cache hit rate and pay far more than the failover saves.

**Rung 8. A second dialect.** Translate to a provider that does not speak OpenAI chat
completions. This is where the caching bugs live. Do it last, and only for a named reason.

---

## 15. The minimum version for Agenta

### 15.1 What it has to do

Four requirements, from the brief:

1. Keep our provider credential out of a container the user controls.
2. Enforce a per run budget.
3. Report usage into a ledger.
4. Break neither streaming nor prompt caching.

### 15.2 The shape

**A new FastAPI service, or a new router inside the existing API, exposing exactly one
endpoint: `POST /{run_scope}/v1/chat/completions`.**

The `run_scope` segment is a path prefix carrying the run identity, copied from n8n's design:
the gateway strips it before forwarding, so the request body is untouched and no client
library has to know it exists. If a per run token already carries the run identity in its
claims, the prefix is redundant and should be dropped; carry it in whichever place is easier
to verify, but not in the body.

The request path:

1. **Authenticate.** Read the bearer token. It is a short lived signed token minted when the
   run starts. Its claims name the organization, the project, the run, the allowed model, a
   `max_tokens` ceiling, and a per run credit cap. Verify the signature and the expiry. No
   database read.
2. **Authorise the model.** Compare the body's `model` field against the token's allowed
   model. Reject a mismatch with 403. Compare `max_tokens` against the ceiling; clamp it
   rather than reject, so a harness that omits it still gets a bound.
3. **Check the balance.** One call to the existing `MetersDAO.adjust()` against
   `Counter.CREDITS_CONSUMED`, with a delta equal to the flat per call price for that model.
   The statement is atomic and conditional, so the check and the charge are the same
   operation and there is no window between them
   (`api/ee/src/dbs/postgres/meters/dao.py:376`). If it returns no row, respond 402 with a
   clear message.
4. **Forward.** Swap the authorization header for a Google credential, rewrite the URL to the
   Vertex OpenAI-compatible endpoint, and send the body **unchanged**. Use `httpx` in
   streaming mode.
5. **Relay.** Return a `StreamingResponse` that iterates the upstream response and yields the
   bytes untouched. Keep the last few kilobytes in a rolling buffer.
6. **Account.** After the stream ends, parse the tail buffer for the usage object and write a
   ledger entry recording input tokens, output tokens, cached tokens, model, run, and the
   credits charged. This happens after the response, in a background task.

### 15.3 The decisions, stated with their costs

**Charge a flat number of credits per call, priced per model, and record real token counts
alongside.** This is Dify's choice
([HostedCreditConfig.get_model_credits](https://github.com/langgenius/dify/blob/main/api/configs/feature/hosted_service/__init__.py))
and Activepieces' choice, and it is right for a first version for one reason: the price is
known before the call runs, so the check and the charge collapse into one atomic statement
and every problem in sections 8 and 9 disappears. There is no estimate, no hold, no
settlement, and no disconnect problem, because a disconnected call costs exactly what a
completed one costs.

What we relax: a person who makes very long calls pays the same as a person who makes very
short ones, so our credits do not track our real cost per call. What it costs to add back:
nothing structural, provided we record the true token counts in the ledger from day one. Once
we have a month of real data we can switch the price function from a constant to a function
of tokens, and the ledger schema does not change. The migration is a code change, not a data
migration. **This is the single most important thing to get right: record real usage from the
first day even though we do not charge on it.**

**Enforce the model allowlist at the gateway, not in `models.json`.** Today the pinning is
advisory (section 1). Moving it to the gateway is what makes it a boundary, and it is the
control that actually bounds our exposure, more than the balance does. Dify's hosted quotas
carry the same explicit list.

**Check the balance, do not hold it.** With a flat per call price the check is exact for the
current call, and the only overshoot comes from calls that started before this one finished.
Our harness makes two or three calls per user message and it makes them in sequence, not in
parallel, so the concurrency within one run is about one. The bound from section 9.2 becomes
(number of runs an organization has in flight) times (one call's flat price). With a per run
cap in the token, that is a small, known number. What we relax: an organization running many
runs at once can end slightly over its balance. What it costs to add back: rung 6 of the
ladder, and the ledger does not change, because a hold is just a debit entry with a later
correcting entry.

**Keep the body byte for byte.** No parsing, no re-serialising, no injected fields inside
`messages`, `tools`, or the system prompt. The only candidate exception is
`stream_options`, and only if the harness turns out not to send it. Every metadata field we
need travels in the URL or a header.

**Record a `request_id` on every ledger entry, with a unique constraint.** One column and one
index, now, so a retried charge is a clean failure rather than a double charge.

**Deliver a clear 402 when the balance is exhausted.** n8n's undocumented quota running out
mid workflow produced silent failures where the model node returned empty strings
([n8n community](https://community.n8n.io/t/i-accepted-n8ns-offer-for-100-credits-for-openai-api/163427)).
The status code and the message body are part of the product, because the harness will
surface whatever we return.

### 15.4 The ledger, minimally

Two tables.

**`credit_entries`**, append only, never updated: identifier, organization, direction, amount
in credits, reason (grant, purchase, earning, model call, tool call, sandbox time), a
reference to the run or invoice, the `request_id` for idempotency, and a timestamp. Model
call entries also carry the model, the input tokens, the output tokens, and the cached tokens,
because those are the numbers we will need when we switch to token based pricing.

**The running balance** does not need a new table. `Counter.CREDITS_CONSUMED` already exists
with a quota per plan, and `MetersDAO.adjust()` already performs the atomic conditional
increment with refunds via negative deltas. Use it as the fast counter and treat
`credit_entries` as the record of truth. Adding a periodic job to verify that the counter and
the sum of entries agree is a later rung.

What we relax: the counter and the entries can disagree if a background write fails. What it
costs to add back: a reconciliation job that recomputes the counter from the entries. Since
the entries are complete and immutable, that job can always be written later, which is exactly
why the entries have to exist from the beginning.

### 15.5 An honest size estimate

| Piece | Estimate |
| --- | --- |
| Gateway service: routing, token verification, allowlist, forwarding, streaming relay | 300 to 400 lines of Python |
| Usage extraction from the stream tail, plus the non streaming case | 100 to 150 lines |
| Ledger tables, migration, and the write path | 150 to 250 lines |
| Token minting at run start, and wiring it into the connection the runner resolves | 100 to 150 lines |
| Configuration: model allowlist, per model prices, per run caps | 50 to 100 lines |
| Tests: streaming relay, disconnect, usage extraction, balance exhaustion, allowlist rejection, cache preservation | 400 to 600 lines |
| **Total** | **roughly 1,100 to 1,650 lines** |

Calendar estimate for one engineer who knows our codebase: **two to three weeks** to something
deployed behind a flag, plus a week of running it in the background against real traffic
before it gates anything. The tests are more than a third of the work, and that ratio is
correct, because every failure in this system is silent by nature. A broken cache costs money
without producing an error. A missed usage record costs money without producing an error. A
buffered stream produces a correct answer, slowly.

The three test cases that matter most, because nothing else will catch these:

1. **A cache preservation test.** Send the same long prefix twice through the gateway and
   assert `cached_tokens` is non zero on the second call. Run it in continuous integration.
   Without it, someone will add a helpful header or a request identifier to the body and
   quintuple our bill with no failing test.
2. **A disconnect test.** Start a stream, close the client, and assert a ledger entry was
   still written.
3. **A buffering test.** Assert that the first chunk reaches the client well before the last
   one. This is the only way to catch a reverse proxy configuration that silently turns
   streaming into batching.

### 15.6 What to verify before writing code

Three questions, each with a cheap test, and each capable of changing the design.

1. **Does the harness stream, and does it request usage?** Point a run at a logging server and
   read the request body. If it streams without `stream_options`, the gateway must inject it,
   and we then need the cache test from section 10.3 to confirm the injection is harmless.
2. **Does Vertex's OpenAI-compatible endpoint return usage on a stream, and does it report
   cached tokens?** Send one long request twice with streaming on and read the final chunk of
   the second response. If cached tokens never appear, the cost model in this document is
   wrong and the whole plan needs revisiting before anything is built.
3. **Does an Agenta managed custom connection still reach a Daytona sandbox correctly with a
   base URL we control?** The path exists and is tested
   (`services/runner/src/engines/sandbox_agent/pi-model-config.ts:85`, plus the replay test
   noted in `prior-work/repo-findings.md`), but it has never been pointed at a service of
   ours. Stand up rung 0, the dumb forwarder, and run one real agent conversation through it.
   That single test validates the entire delivery path before any accounting is written.

---

## 16. Claims that could not be verified

- Whether our harness sends `stream: true` and `stream_options: {"include_usage": true}`. No
  occurrence of either string exists in `services/`, `sdks/`, `api/oss/src`, or `web/oss/src`,
  and the harness is a third party package that runs inside the sandbox. Settled by logging a
  real request.
- Whether Vertex AI's OpenAI-compatible chat completions endpoint honours `stream_options`
  and populates `prompt_tokens_details.cached_tokens`. Google's compatibility page describes
  the endpoint and notes that Gemini specific features must travel in `extra_body`, but does
  not enumerate these two fields
  ([overview](https://cloud.google.com/vertex-ai/generative-ai/docs/migrate/openai/overview)).
  Settled by two live calls.
- Whether adding `stream_options` to a request changes the provider's cached prefix. Provider
  documentation describes the prefix as the messages, tools, and schemas, which suggests it
  does not, but none of them state it. Settled by an A/B comparison of `cached_tokens`.
- Whether providers hash raw request bytes or a normalised form when deciding a prefix match.
  No provider documents this. The design avoids the question by not re-serialising the body.
- Bifrost's performance multiples against LiteLLM come from Bifrost's own benchmark
  ([benchmarks](https://www.getmaxim.ai/bifrost/resources/benchmarks)) and are a vendor claim
  about a competitor.
- Activepieces' internal implementation. Their credit pricing and behaviour are documented in
  community and pricing pages, but the source of their proxy was not located, so the
  Activepieces section rests on product documentation rather than on code.
