# Findings: lifecycle, cost, and observability

This file answers questions 2, 6, and 7 of `BRIEF.md`. It also records one finding that
extends `openrouter-api-facts.md` in an important way.

Two files already carry verified answers and are not repeated here:

- `repo-findings.md` answers questions 4 and 5. A trial credential reaches a run through a
  vault `custom_provider` record with `kind="custom"`. That route already exists, is tested,
  and pins the run to one model.
- `openrouter-api-facts.md` answers question 1 and half of question 3. A minted key can carry
  a dollar cap, no reset, and a native expiry. The create-key body has no model field.

Verified on 2026-08-02 against OpenRouter's live documentation and against the working tree.

---

## A correction that matters: model restriction IS possible, through a different feature

`openrouter-api-facts.md` says model restriction is "not supported". That statement is
accurate about the endpoint it was checking. The create-key request body carries no model
field. But OpenRouter has a second feature that does the job, and the earlier pass did not
reach it.

**Guardrails.** A guardrail is a named policy object. It can carry a model allowlist, a
provider allowlist, a spending cap, and data-retention rules. OpenRouter enforces it on its
own side: "Detection runs before the request is sent to the model provider, so blocked
traffic never leaves OpenRouter." A request for a model outside the allowlist fails. The
documentation gives two different codes for a blocked request, 404 in one place and 403 in
another, so the exact code is unverified.

A guardrail can be attached to an individual API key. The management API has a bulk-assign
call that takes a list of key hashes. One key holds at most one guardrail, and assigning a
new one replaces the old one. So one guardrail, created once, can be attached to every trial
key we mint. Minting a restricted key costs two API calls instead of one.

This changes the picture from `openrouter-api-facts.md` in one specific way. That file
concluded the model question was a product-experience problem rather than a spend problem,
because the dollar cap bounds the damage either way. That conclusion still holds. But if
guardrails work on our account, the model question stops being a problem at all: a user who
breaks out of the sandbox and calls the base URL directly still cannot reach an expensive
model.

**What is unverified.** Whether a personal (non-organization) OpenRouter account can create
and assign guardrails. The guardrails page says "If you're using an organization account, you
must be an organization admin to create and manage guardrails", which implies personal
accounts can, but implication is not proof. The exact field names for the allowlist are also
unverified, because the API reference pages for guardrails return 404 to an unauthenticated
fetch. Steps 3 and 5 of `probe_openrouter_keys.py` settle both.

Sources: [Guardrails overview](https://openrouter.ai/docs/guides/features/guardrails),
[Guardrails announcement](https://openrouter.ai/blog/announcements/guardrails/),
[Enterprise quickstart](https://openrouter.ai/docs/enterprise-quickstart).

---

## Question 2: scale and lifecycle

### Limits on key count and on the provisioning endpoint

**Neither is documented.** I read the provisioning guide, the rate-limits page, and the
enterprise quickstart. None of them states a maximum number of keys per account, and none of
them states a rate limit on key creation. The rate-limits page covers free-model request
limits and account balance only. It adds one sentence that reads as a general policy:
"Making additional accounts or API keys will not affect your rate limits, as we govern
capacity globally."

Two facts we do know shape the design anyway. The list endpoint returns at most 100 keys per
page and pages with an `offset` parameter. Cloudflare sits in front of the API and "will
block requests that dramatically exceed reasonable usage".

**Unverified. The test:** step 9 of the probe mints ten keys back to back and records the
first 429 with its `Retry-After` header. Step 10 lists keys and reports the page size. If ten
rapid creates all pass, the endpoint is not a bottleneck for a signup-rate workload, which is
at most a few per minute.

Sources: [Provisioning API keys](https://openrouter.ai/docs/features/provisioning-api-keys),
[Rate limits](https://openrouter.ai/docs/api-reference/limits).

### One correction to `repo-findings.md` found in review

`repo-findings.md` says the `custom_provider` route "needs no new runner contract". That is
true for the case it was describing, which is a user who configured a custom connection. It is
**not** true for the trial case, which is a brand new user's default agent with an empty vault.

For a default connection the SDK omits the `connection` object from the wire entirely
(`sdks/python/agenta/sdk/agents/dtos.py:826-835`), and `ResolvedConnection.to_wire()` carries
provider, model, deployment, credential mode, and endpoint but no connection slug. The runner's
`buildPiModelConfigPlan` requires a named `agenta` connection with a slug
(`services/runner/src/engines/sandbox_agent/pi-model-config.ts:89-97`), so it declines and no
`models.json` is written. The run then falls back to the default provider and would send our
OpenRouter key to api.openai.com.

So a platform-funded connection needs a reserved connection identity that reaches the wire. It
is a small change on both sides plus a test, and it has to be proved end to end before anything
else is built. The same code also shows the route is Pi-only: the builder returns no plan for a
Claude request (`services/runner/tests/unit/sandbox-agent-pi-model-config.test.ts:73`).

### Who mints, and when

Three options, and they are not equal.

**Mint at signup.** Simple to reason about, and wrong. Most signups never start an agent run.
Every one of them would still get a key, so the key population equals the signup population
and most of it is dead weight. It also burns the expiry window on people who are not there, so
a user who signs up on Friday and comes back later finds a dead key.

**Mint at the first funded run.** This is the right point. The key's lifetime starts when the
user actually engages, the key population equals the population that ran at least once, and
one HTTP call to OpenRouter joins a request path that is already doing several. The cost is
that a first run now depends on a third-party API being up. That failure has to degrade to
the normal "connect your key" wall, not to a broken playground.

**Mint per session or per run.** This gives the tightest blast radius, because each key dies
with its run. It also multiplies the key count by 30 and puts a provisioning call on every
message. Not worth it at this stage.

**Recommendation: mint at the first funded run, and reuse that one key for the whole trial.**

### Where the key is stored, and the landmine in the obvious answer

The obvious answer is to write the key into the user's project vault as a `custom_provider`
secret. The resolver would then find it with no new code at all
(`sdks/python/agenta/sdk/agents/platform/connections.py:548`). That is genuinely tempting.

**It breaks the key wall.** The frontend gate is
`web/oss/src/components/AgentChatSlice/hooks/useAgentModelKeyStatus.ts:96`:

```
gateActive = !loading && vaultEmpty && !selfManaged && !keySetupDone && !!providerEntry
```

and `vaultEmpty` is computed at line 67 from the raw list of vault rows, project-wide, of any
kind. Put one trial secret in the vault and `vaultEmpty` becomes false forever. The connect
banner never fires again. When the trial runs out, the user gets a failing run and no
guidance at all. The proposal already plans to change this gate to "no user key AND no trial
balance", so the fix is known. It just has to happen in the same change, not after.

**The user can read the key.** `VaultService.list_secrets`
(`api/oss/src/core/secrets/services.py:74`) decrypts and returns secret values, and
`SecretResponseDTO` (`api/oss/src/core/secrets/dtos.py:256`) carries the data through. There
is no masking on the read path. So a platform-funded key placed in a user's project vault is
readable over the normal API by anyone with view access to that project, without ever
starting a sandbox. Given a $0.30 lifetime cap, a short expiry, and a model allowlist, the
damage is bounded. It is still worth knowing that this is what we are doing.

**The better seam already exists.** The resolver fetches connections with a plain
`GET /secrets/` against our own backend, using the caller's Authorization
(`connections.py:576`). The backend controls that response. It can append a synthetic trial
connection for a funded run without ever persisting a platform key in the user's vault. That
keeps `vaultEmpty` true, keeps the key out of the UI, and keeps the platform credential on
the platform side of the boundary.

The catch is that the run's fetch and the browser's fetch are the same call with the same
credentials today, so the backend cannot yet tell them apart. Distinguishing them is exactly
the "funding provenance" component from the existing proposal. That component is small in its
minimal form (a server-minted claim on the run, checked at the secrets fetch), and it is one
of the pieces that carries into the long-run gateway. See `recommendation.md`.

### What happens when a key expires or hits its cap mid-run

OpenRouter's documented behaviour:

| Situation | Response |
|---|---|
| Cap exhausted | `402`, "The account or API key has insufficient credits." |
| Key expired, revoked, or invalid | `401`, "The API key is missing, invalid, or revoked." |
| Blocked by a guardrail | `403` or `404`, the docs disagree |
| Rate limited | `429` with a `Retry-After` header |

If the failure happens after streaming has started, it does not arrive as an HTTP status. It
arrives as an SSE frame:

```json
{"choices":[{"finish_reason":"error","delta":{"content":""}}],
 "error":{"code":402,"message":"...","metadata":{"error_type":"..."}}}
```

**What our harness shows the user is unverified, and it matters.** Pi receives that frame
from an OpenAI-compatible endpoint it was pointed at through `models.json`. Whether it
surfaces a readable error, a generic failure, or an empty turn is not knowable from reading
OpenRouter's docs. We have a known bug of exactly this class already, where an errored turn
renders as an empty message. A trial that ends in a blank message is worse than a trial that
ends in a clear "you have used your free messages".

**The test:** mint a key with a $0.01 cap, point a real agent run at it through the
`custom_provider` path on the dev stack, and burn it with two or three messages. Watch what
the playground renders. Steps 6 and 8 of the probe capture the raw wire shape; the playground
half needs a live run and cannot be done by the probe alone.

**This is also the argument for our own meter being the product bound.** If our counter stops
the user at 30 messages and refuses the 31st before any model call, the user never sees
OpenRouter's error at all. The cap only fires for someone who went around the product, and
they get whatever error the harness gives, which is acceptable for that audience.

### Orphan cleanup

`expires_at` does the enforcement, so an expired key is already harmless whether or not we
delete it. Cleanup is hygiene, not safety. That is a meaningful simplification over the
alternative where we would have to run a sweep to make expiry real.

A daily sweep is still worth having, for three reasons: the key list is a page-at-a-time
resource and we do not want it to grow to six figures, an undocumented key-count cap might
exist, and a key we cannot account for is a key we cannot reason about. The sweep is a loop
over `GET /keys?offset=N&include_disabled=true`, deleting anything whose name carries our
trial prefix and whose `expires_at` is in the past. At 10,000 lifetime keys that is 100
requests.

The sweep needs the key **hash**, not the key. The plaintext key comes back exactly once, at
creation, and cannot be read again. So whatever we store must include the hash, even if we
choose not to store the key itself.

One orphan case has no sweep: we mint a key, the request that was going to store it fails,
and we never learn the hash. Naming every key after the organization id makes those
recoverable from the list endpoint. Do that from the start.

---

## Question 6: cost

### OpenRouter's margin over direct provider pricing

**OpenRouter states there is none on inference.** The FAQ says: "We pass through the pricing
of the underlying providers; there is no markup on inference pricing."

The fee is on money coming in, not on tokens going out. Credit purchases by card cost
**5.5%** with an **$0.80 minimum**. By crypto they cost 5%. There is a separate 5% fee on
bring-your-own-key requests after the first million per month, which does not apply to us.

Our own generated model catalog agrees. Comparing the direct rows against the `openrouter/`
rows in `sdks/python/agenta/sdk/agents/data/pi_models.generated.json`, dollars per million
tokens:

| Model | Direct in / out / cache read | Via OpenRouter |
|---|---|---|
| `gpt-5-mini` | 0.25 / 2.00 / 0.025 | 0.25 / 2.00 / 0.025 |
| `gpt-5-nano` | 0.05 / 0.40 / 0.005 | 0.05 / 0.40 / 0.010 |
| `gpt-5.1` | 1.25 / 10.00 / 0.125 | 1.25 / 10.00 / 0.130 |

Input and output match exactly. Two cache-read figures differ slightly. That is more likely a
rounding or catalog-generation artifact than a real markup, but I did not verify it against
OpenRouter's own model pages, so treat it as unverified. Either way the effect is pennies on
a cent.

**Practical answer: budget 5.5% on top of provider list prices.** That is the top-up fee, and
it is the whole margin.

Source: [FAQ](https://openrouter.ai/docs/faq).

### Does prompt caching survive the hop

**Yes, for the right model family, and this is the most load-bearing fact in this section.**

OpenRouter passes provider-native prompt caching through. The split that matters:

- **Automatic, no request changes needed:** OpenAI, DeepSeek, Grok, Moonshot, Groq, Z.AI, and
  Gemini 2.5 implicit caching.
- **Requires explicit `cache_control` breakpoints in the request:** Anthropic Claude, Alibaba
  Qwen, and Gemini when you want explicit control.

Cache read prices, as multiples of the model's input price: OpenAI 0.25x to 0.5x depending on
model, Anthropic 0.1x, Gemini 0.25x, Grok 0.25x, Moonshot 0.25x, Groq 0.5x, DeepSeek 0.1x.
Cache writes are free on OpenAI models before the GPT-5.6 family and 1.25x from GPT-5.6 on.
Anthropic charges 1.25x to write with a five minute time to live and 2x with a one hour time
to live.

**Pick a model from the automatic list and caching needs no cooperation from anyone.** An
OpenAI-family model through OpenRouter caches by itself.

**We have more control than I first assumed, and it comes from Pi's own `models.json`
schema.** The request body is built by Pi inside the sandbox, but the file we write configures
how Pi builds it. Pi's bundled documentation
(`services/runner/node_modules/@earendil-works/pi-coding-agent/docs/models.md:405-455`) lists a
`compat` block on a custom provider that carries, among others:

| Field | What it does |
|---|---|
| `openRouterRouting` | "This object is sent as-is in the `provider` field of the OpenRouter API request." That is the provider-selection block, so we can pin one upstream provider and keep the cache warm |
| `cacheControlFormat: "anthropic"` | Puts Anthropic-style `cache_control` markers on the system prompt, the last tool definition, and the last user or assistant text. This is exactly what an Anthropic model through an OpenAI-compatible endpoint needs |
| `sendSessionAffinityHeaders` | Sends `x-session-affinity` derived from the session id when caching is enabled |
| `supportsLongCacheRetention` | Sends `prompt_cache_retention: "24h"` for OpenAI caching, or a one hour `cache_control.ttl` for Anthropic |

Pi's own documentation uses OpenRouter as its worked example for this block.

**Our runner does not emit any of it today.** `serializePiModelsJson`
(`services/runner/src/engines/sandbox_agent/pi-model-config.ts:135-147`) writes only
`{baseUrl, api, apiKey, models: [{id}]}`. Adding a `compat` block is a contained change in
that one file, plus a wire field to carry it.

**So provider drift is solvable, not just avoidable.** OpenRouter can route the same model to
different upstream providers on different turns, and a warm cache on one provider is useless
on another. For a first-party model such as `openai/gpt-5-nano` there is effectively one
upstream provider, so drift is not a live risk and we can ignore it. If we ever want an
open-weights model served by ten providers, `openRouterRouting` is the lever.

OpenRouter presets are a third route, worth knowing about and not worth using. A preset can
carry routing preferences and is referenced by putting `@preset/slug` in the model field. It
is a default a request can override, so it is not an enforcement boundary, and `compat` does
the same job inside a file we already write.

Sources: [Prompt caching](https://openrouter.ai/docs/features/prompt-caching),
[Prompt caching and sticky routing](https://openrouter.ai/blog/tutorials/prompt-caching-sticky-routing/).

### One caveat about caching that the existing measurement raises

The proposal measured a real agent call: 23,621 total tokens, $0.02997 billed, on
claude-haiku-4-5. The arithmetic only closes if that 23.5K of harness context was a cache
**write** at 1.25x, not a cache read. In other words, on the call that was measured, the
cache was not being hit. Every call paid full price plus the write premium.

If that pattern is normal rather than a one-off cold start, caching is not currently saving
us anything on the agent path, and the cost table below should be read at its uncached
column. The most likely explanations are a cold cache on a fresh session and Anthropic's five
minute time to live expiring between user messages.

**The test:** run five messages through the `custom_provider` OpenRouter path on the dev
stack and read `prompt_tokens_details.cached_tokens` off the responses, or read the same from
OpenRouter's activity view. Step 4 of the probe does the wire-level half with a synthetic
prefix.

### What a trial session actually costs

Grounding assumptions, all from the proposal's measured numbers:

- Each call carries about 23,500 tokens of harness context. This dominates everything.
- Conversation history adds about 130 tokens per turn.
- A tool-using session makes two to three LLM calls per user message.

For a 30-message trial at one call per message, that is about 765,000 input tokens and about
3,600 output tokens. At three calls per message it is about 2.3 million input tokens.

Cost per 30-message trial, before the 5.5% top-up fee:

| Model | 1 call/msg, no caching | 1 call/msg, cached | 3 calls/msg, no caching | 3 calls/msg, cached |
|---|---|---|---|---|
| `gpt-5-nano` class | $0.040 | $0.012 | $0.119 | $0.036 |
| `gpt-5-mini` class | $0.198 | $0.044 | $0.596 | $0.131 |

The cached columns assume 90% of input tokens read from cache.

**The decision this table forces.** On a nano-class model, a $0.30 cap covers a full
30-message trial even if caching fails completely and the agent makes three calls per
message. Caching is then an optimisation, not a dependency. On a mini-class model, the same
$0.30 cap runs out around message 15 in the uncached, tool-heavy case. Caching becomes
load-bearing, and the caveat above says we have not yet proven it works on this path.

So: **pick a nano-class model for the trial, or raise the cap to about $0.75 if product
quality demands mini.** The first option is safer and the second is honest about what it
costs.

**Budget check.** At 10,000 signups with a $0.30 cap, the absolute worst case is $3,000, and
that only happens if every single signup deliberately burns their whole cap. The realistic
figure is the cost of a completed trial, so roughly $0.04 each, or about $400 for 10,000
signups, plus the 5.5% fee. Most signups will not use all 30 messages, which pushes it lower.

---

## Question 7: observability

The proposal's `research.md` section 4 states: "Agent runs routed through OpenRouter record
no token usage at all (`ag.metrics` and `gen_ai.usage` both empty)."

**Read against the code, that claim is refuted as stated, and true in a narrower and more
useful way.** A code-reading pass across the runner, the SDK, and the OTLP ingest found the
following.

### Tokens are recorded

Both agent tracers write token attributes:

- The Pi in-process tracer writes `gen_ai.usage.input_tokens`, `output_tokens`,
  `prompt_tokens`, `completion_tokens`, `total_tokens`, plus
  `gen_ai.usage.cache_read.input_tokens` and `cache_creation.input_tokens`, at
  `services/runner/src/tracing/otel.ts:581-605`. Run totals land on the `invoke_agent` span at
  `otel.ts:833-844`.
- The ACP tracer, used for Daytona and Claude runs, writes the same token attributes at
  `otel.ts:1165-1173`.
- The Python SDK stamps run totals onto the `/invoke` workflow span at
  `sdks/python/agenta/sdk/agents/tracing.py:213-236`.

At ingest, the token keys are mapped
(`api/oss/src/apis/fastapi/otlp/extractors/adapters/logfire_adapter.py:161-194`), renamed to
`ag.metrics.tokens.incremental.*`
(`api/oss/src/apis/fastapi/otlp/extractors/span_data_builders.py:175-178`), and rolled up the
trace tree (`api/oss/src/core/tracing/utils/trees.py:353-471`).

Nothing on the `custom_provider` path suppresses this. Pi asks the endpoint for usage in
streaming by default, and OpenRouter returns it.

### Cost is not recorded, for any agent run

The runner and the SDK both write `gen_ai.usage.cost` (`otel.ts:604`, `otel.ts:843`,
`otel.ts:1172`, `tracing.py:234`). **No OTLP adapter maps any cost key.** A grep for cost keys
across the whole of `api/oss/src/apis/fastapi/otlp/` returns nothing, so the reported cost is
dropped at the door.

That is only half the story, and the other half changes what the fix should be. The backend
does not need the provider to report cost, because **it computes cost itself**.
`calculate_costs` (`api/oss/src/core/tracing/utils/trees.py:579-618`) reads the span's prompt
and completion token counts plus its model name and calls litellm's `cost_per_token`, then the
result is rolled up the trace tree. That is exactly why the classic playground shows cost.

It does not fire for agent spans, and the reason is two missing attributes rather than a
missing feature:

1. **The span has no type.** The calculator only runs when `span.span_type` is one of
   `embedding`, `query`, `completion`, `chat`, `rerank` (`trees.py:570-576`). `span_type` is
   parsed from the `ag.type.span` attribute (`api/oss/src/core/tracing/utils/parsing.py:294`),
   and the runner's tracer never sets any `ag.type.*` attribute. It sets `ag.meta.skills.*` and
   `ag.exception.*` and nothing else in that namespace.
2. **The model is not where the calculator looks.** It reads `ag.meta.response.model` or
   `ag.data.parameters.model` (`trees.py:587-589`). The runner sets neither.

**So the better fix is not "map `gen_ai.usage.cost`".** It is to have the agent tracers stamp
`ag.type.span = "chat"` and the model name on their LLM spans. Then the cost machinery that
already works for the classic playground works for agent runs too, on every provider, with no
pricing table shipped into the sandbox and no dependence on what the provider reports. That is
a smaller change with a wider blast radius of benefit, and it is worth filing regardless of
what we decide about the trial.

The classic prompt playground does record cost, because it goes through litellm and writes
into the `ag.metrics.*` namespace directly
(`sdks/python/agenta/sdk/litellm/litellm.py:166-176`). That is the real asymmetry: tokens
work on both paths, cost works only on the classic one.

### On a custom provider, the cost number is zero at the source anyway

The `models.json` document the runner writes carries no pricing block
(`services/runner/src/engines/sandbox_agent/pi-model-config.ts:135-147`), and Pi defaults
custom-model pricing to all zeros (its bundled docs,
`services/runner/node_modules/@earendil-works/pi-coding-agent/docs/models.md:208`, list the
`cost` field as optional with a default of all zeros). So even if the ingest mapped cost, the
number arriving would be zero on this path.

The fix is small and the schema is already there. Pi accepts
`"cost": {"input": …, "output": …, "cacheRead": …, "cacheWrite": …}` per model, in dollars per
million tokens, and even supports tiered rates above a token threshold (`models.md:211-226`).
We already carry those four numbers per model in
`sdks/python/agenta/sdk/agents/data/pi_models.generated.json`. Emitting them would make Pi's
computed cost real on the custom-provider path.

### Cache token counts do not cross the run boundary

The wire type `AgentUsage` is `{input, output, total, cost}`
(`services/runner/src/protocol.ts:426-431`). Cache-read and cache-creation counts exist only
on Pi's in-process LLM spans. On the Daytona path the ACP tracer emits no cache attributes at
all. That is inconvenient here, because cache hit rate is exactly the number we most want to
watch during a trial.

### Reconciling this with the proposal's measurement

The proposal queried production traces and found empty usage on OpenRouter runs. The code says
tokens are emitted. Both can be true if the sampled traces predate the current
instrumentation, or if those particular runs took a path that drops usage. I could not settle
it by reading, and I am not going to declare one side wrong from a distance.

**The test:** run one agent turn through the OpenRouter `custom_provider` path on the dev
stack, then query `POST /api/tracing/spans/query` for that trace and read
`ag.metrics.tokens.incremental.*`. That takes about ten minutes and settles it.

### What we would be blind to

Assuming tokens do arrive:

- **We would know tokens, not dollars.** Per-run spend would not be in our traces. We would
  have to compute it ourselves from tokens and a price table, or read it from OpenRouter's own
  activity API.
- **We would not know cache hit rate** on the Daytona path, which is where trial runs execute.
  So the single biggest cost lever would be invisible in our own tooling.
- **Nothing counts an agent run for billing.** The meter counters are `evaluations_run`,
  `traces_ingested`, `traces_retrieved`, `credits_consumed`, `events_ingested`,
  `records_ingested`, and a `users` gauge
  (`api/ee/src/core/access/entitlements/types.py:52-61`). An agent run is billed as one trace
  ingested (`api/oss/src/apis/fastapi/otlp/router.py:221`), no matter how many turns or tokens
  it burned. The `session_turns` table
  (`api/oss/src/dbs/postgres/sessions/turns/dbas.py:19-44`) has no token or cost column.

**The fallback that makes this survivable.** OpenRouter itself is a complete, authoritative
ledger. `GET /keys/{hash}` reports `usage`, `usage_daily`, `usage_weekly`, `usage_monthly`,
and `limit_remaining` per key. If each key is named after one organization, we get exact
per-organization trial spend with one API call, without touching our tracing at all. That is
better spend data than the gateway design would have given us on day one, though it lives
outside our system.

**Three small fixes would close most of the gap**, and all three are worth filing regardless
of what we decide about the trial:

1. Stamp `ag.type.span` and the model name on the agent tracers' LLM spans, so the backend's
   existing `calculate_costs` fires for agent runs the way it already does for the classic
   playground. This is the one that matters.
2. Optionally also map `gen_ai.usage.cost` at ingest, for providers that report a real number,
   and emit a `cost` block in the runner's `models.json` so Pi computes one. Both are
   belt-and-braces once item 1 lands.
3. Carry cache-read and cache-creation counts across the `/run` wire in `AgentUsage`.

---

## Summary of what is still unverified

Each item names the test that settles it.

| Unverified | Test |
|---|---|
| Guardrails work on our account type, and the allowlist field names | Probe steps 3 and 5 |
| The exact code for a guardrail block, 403 or 404 | Probe step 5 |
| A rate limit on key creation | Probe step 9 |
| A cap on keys per account | Probe steps 9 and 10, plus asking OpenRouter support |
| What the playground shows a user when the cap is hit mid-run | A live run on the dev stack with a $0.01 key |
| Whether prompt caching is actually hitting on the agent path | Probe step 4, plus reading `cached_tokens` from a real run |
| Whether a fresh key per user resets the prompt cache | Probe step 4 with two different minted keys |
| Whether tokens really do reach our traces on the OpenRouter path | One live run plus a `POST /api/tracing/spans/query` |
| Whether the runner can emit a Pi `compat` block end to end (routing, cache format, cost) | Add the block in `pi-model-config.ts`, run once, read the request OpenRouter received |
| Whether the small cache-read price differences are real markup | Compare against OpenRouter's own model pages |

`probe_openrouter_keys.py` in this folder covers the OpenRouter half. **It has never been
run.** It spends real money and creates real objects in a real account. It needs a management
API key and Mahmoud's approval before anyone runs it. `--plan` prints every request it would
make without touching the network.

---

## One compliance item to raise before building

OpenRouter's terms prohibit "access[ing] the Site or Service for purposes of reselling API
access to Models or otherwise developing a competing service"
([Terms of Service](https://openrouter.ai/terms), section 7).

Funding a trial inside our own product is not reselling. But the mechanism hands a working
OpenRouter key to a user-controlled sandbox, and that user can extract it and use it for
arbitrary inference outside Agenta for the life of the key. A $0.30 cap and a model allowlist
make that defensible. It is still a gray area, and it is cheap to remove the doubt with one
email to OpenRouter describing the pattern. Do that before shipping, not after.
