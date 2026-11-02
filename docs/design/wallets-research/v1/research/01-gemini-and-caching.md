# Gemini as the model behind a funded free tier

## What this document covers

We plan to pay for a new user's first agent runs out of Google Cloud credit. That plan rests
on four things being true. The credit has to actually pay for Gemini. Gemini has to hold an
agent conversation that calls tools. Prompt caching has to work on our traffic pattern,
because our harness replays about 23,600 tokens of context on every single model call.
And we have to be able to stop the spending when a user's allowance runs out.

This document establishes what is true, with sources, and then says what our own code would
have to change for a run to reach Google through a service of ours.

## Words used here

Some terms appear throughout. They are defined once, here.

A **token** is the unit a language model bills in. Roughly four characters of English text
make one token. A **prompt** is everything you send the model on one call. Every call to a
chat model re-sends the whole conversation, so the same words are paid for over and over.

**Prompt caching** means the provider stores the processed form of a repeated prefix and
charges less when the next request begins with the same bytes. Google calls its version
**context caching**. A **prefix** is the leading part of the prompt, counted from the very
first token. Caching only ever applies to a prefix, never to a passage in the middle.

A **dialect** is the request and response shape an API speaks. OpenAI's `chat/completions`
shape (a `messages` array, a `tools` array, `tool_calls` in the reply) is one dialect.
Google's own `generateContent` shape (a `contents` array of `parts`, `functionDeclarations`,
`functionCall` parts) is a different dialect that carries the same ideas under different
names. Our agent runner speaks the OpenAI dialect only.

A **gateway** here means a service we would run that sits between the user's sandbox and the
model provider. It holds the real provider credential so the credential never enters a
container the user controls, and it decides per request whether to forward the call.

**Metering** means counting what someone consumed so it can be charged. For model calls the
count comes from the `usage` block the provider returns: input tokens, output tokens, and
how many of the input tokens were served from cache.

A **quota** is a rate limit, expressed in requests or tokens per minute. A **budget** is a
dollar amount that Google watches. A **spend cap** is a budget that also blocks usage when it
is reached. These three are different mechanisms and they behave differently, which is most of
Section 5.

**Application Default Credentials** (ADC) is Google's standard way for a program to find a
Google credential without hard-coding one: a service account key file named by the
`GOOGLE_APPLICATION_CREDENTIALS` environment variable, or the identity of the machine it runs
on.

One naming change matters for reading Google's documentation. In 2026 Google renamed Vertex AI
to **Gemini Enterprise Agent Platform**. Every `cloud.google.com/vertex-ai/...` URL now
redirects to `docs.cloud.google.com/gemini-enterprise-agent-platform/...`, and the docs say
"Agent Platform" where they used to say "Vertex AI". This document says Vertex AI, because
that is the name in our own code and in most of the internet's writing about it. They are the
same product.

---

## 1. Which Google product the credit actually pays for

### The two doors to the same models

There are two ways to call Gemini, and they are separate products with separate billing.

**The Gemini Developer API** is the one you get from Google AI Studio. You create an API key
on `aistudio.google.com`, and you call `https://generativelanguage.googleapis.com`. It is
designed for a developer to get started in a minute. Its billing is run through a Cloud
Billing account, but on its own track, with its own tiers and its own prepaid credit balance.

**Vertex AI** is the Google Cloud product. You call
`https://LOCATION-aiplatform.googleapis.com/v1/projects/PROJECT/locations/LOCATION/...`, and
you authenticate with a Google Cloud identity rather than a product-specific key. It bills as
an ordinary Google Cloud service against your Cloud Billing account.

### The credit only opens one of those doors

Google's own Gemini API billing page states the exclusion plainly. Under "Can I use my Google
Cloud Welcome credit with the Gemini API?" it answers: "No, the Google Cloud Welcome credit or
free trial credit can't be used towards the Gemini API or AI Studio." It repeats the point for
the free trial: "No, starting March 2026, Gemini API usage costs are specifically excluded from
the $300 Google Cloud Free Trial program." Source:
https://ai.google.dev/gemini-api/docs/billing

The same page leaves a narrow door open for other credits. Under "How do Google Cloud credits
work with Prepay" it says that Prepay users must first purchase prepaid credits before "any
eligible Google Cloud credits can be applied to Gemini API usage", and then adds: "Not all
Google Cloud credits, such as the Google Cloud Welcome credit, can be used towards Gemini API
and AI Studio." So *some* Google Cloud credits are eligible for the Gemini Developer API, and
Google does not publish which. That is a question for Google, listed in Section 7.

The startup program's own page is unambiguous about where its credits go. It says credits "can
be applied toward Google Cloud Services and Select Google Cloud offerings", and separately:
"Program credits cover Google's state-of-the-art models like Gemini and Gemma." Source:
https://cloud.google.com/startup/ai

**Conclusion: we build on Vertex AI.** It is a first-party Google Cloud service, it is what
the program page describes, and it does not depend on an undocumented eligibility list. The
Gemini Developer API is the risky door, not the safe one.

### What that decision costs us

Vertex AI does not authenticate with a simple static API key by default. Google's own
authentication guide for the OpenAI-compatible endpoint says: "The Gemini Chat Completions API
uses OAuth to authenticate with a short-lived access token. By default, service account access
tokens last for 1 hour." Its sample code refreshes the token in a wrapper class. Source:
https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/migrate/openai/auth-and-credentials

There is a static-key path. Vertex accepts a Google Cloud API key as well as ADC: "To use
Gemini on Gemini Enterprise Agent Platform, authenticate by using a Google Cloud API key or
application default credentials. We recommend using an API key for testing and using
application default credentials for production." Source:
https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/api-keys

For us the OAuth requirement is not a problem; it is an argument. A one-hour token cannot be
handed to a sandbox that stays alive for a day, and it certainly cannot be handed to a
container the user controls. Something of ours has to hold the Google credential and refresh
it. That something is the gateway. The credential design and the spending-limit design point
at the same component.

One more restriction worth knowing before anyone proposes funding Claude this way. The startup
program page states: "Third-party models are billed directly and are not covered by the
program credits." Anthropic's Claude models are sold through Vertex AI as partner models and
are priced on the same Vertex pricing page, but they are third-party models. The credit funds
Google's own models. Source: https://cloud.google.com/startup/ai

---

## 2. Prompt caching on Gemini

### The two kinds, and how each one works

Google offers two forms of context caching, and they are described together on one page:
https://docs.cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview

**Implicit caching** is automatic. The page says: "All Google Cloud projects have implicit
caching enabled by default. Implicit caching provides a 90% discount on cached tokens compared
to standard input tokens." You do nothing to turn it on. The advice for getting hits is
mechanical: "Place large and common contents at the beginning of your prompt" and "Send
requests with a similar prefix in a short amount of time." There is no storage charge. There
is also no guarantee: if the cache misses, you pay full price and are not told why.

**Explicit caching** is a resource you create. You call the API to make a `CachedContent`
object, you get back a resource name like
`projects/111111111111/locations/global/cachedContents/1111111111111111111`, and you pass that
name on later requests. The overview page says the discount is the same: "On Gemini 2.5 or
later models, this discount is 90%; on Gemini 2.0 models, this discount is 75%." The difference
is certainty: "Explicit caching offers more control and ensures a discount on input tokens that
reference an existing context cache."

What you can put in an explicit cache matters for us. The `CachedContent` resource has fields
for `systemInstruction`, `contents`, `tools`, and `toolConfig`. Source:
https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/projects.locations.cachedContents

That list is almost exactly the shape of a harness prefix: a system prompt plus a set of tool
declarations. This is the thing our 23,600 tokens mostly is.

### The numbers

| Property | Implicit caching | Explicit caching |
|---|---|---|
| How you enable it | On by default for every project | You create a `CachedContent` resource and reference it by name |
| Discount on cached input tokens | 90% on Gemini 2.5 and later | 90% on Gemini 2.5 and later, 75% on Gemini 2.0 |
| Guaranteed? | No, best effort | Yes, for content that references the cache |
| Minimum tokens before it applies | Gemini 3 family: 4,096. Gemini 3 Flash Preview and 3.1 Pro Preview: 6,144. Gemini 2 family: 2,048 | Gemini 3 family: 4,096. Gemini 2 family: 2,048 |
| Lifetime | Not documented | Default 60 minutes, settable with `ttl` or `expire_time`, minimum 1 minute, no maximum |
| Storage charge | None | Yes, per million tokens per hour |
| Where the count appears | `cachedContentTokenCount` in response metadata | Same field |

Minimums and lifetimes are quoted from the overview page's Limits table and from the cache
creation page (https://docs.cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-create),
which states: "The default expiration time of a context cache is 60 minutes after it's
created."

Storage prices, from https://cloud.google.com/vertex-ai/generative-ai/pricing, section "Context
Cache Storage price for Explicit Caching":

| Model tier | Storage price |
|---|---|
| Gemini 3.1 Pro, Gemini 3 Pro, Gemini 2.5 Pro | $4.50 per million tokens per hour |
| Gemini 3 Flash, Gemini 3.1 Flash-Lite, Gemini 2.5 Flash, Gemini 2.5 Flash-Lite | $1.00 per million tokens per hour |

Note what the overview page says about the creation charge, which applies to both kinds: "For
both implicit and explicit caching, you're billed for the input tokens used to create the cache
at the standard input token price." Filling a cache costs the same as one uncached call.

### The one number Google does not publish

Neither Google's Vertex documentation nor its Gemini Developer API documentation states how
long an *implicit* cache entry lives. The Developer API page says only: "Try to send requests
with similar prefix in a short amount of time." Source:
https://ai.google.dev/gemini-api/docs/caching

That missing number is the single biggest uncertainty in the cost model below, because our
traffic is bursty. Two or three calls land within seconds of each other inside one user
message, then the conversation may pause for minutes, then the user may vanish for hours. If
the implicit lifetime is measured in minutes, we get hits inside a burst and across a live
conversation, and a miss on the first call after a long gap. If it is measured in seconds, we
only get hits inside a burst. Section 8 gives the test that settles it.

### Applied to our pattern

The assumptions, taken from the measurement recorded in `prior-work/findings.md`, which
observed a real agent call of 23,621 total tokens:

- 23,500 tokens of harness context replayed on every call.
- 130 tokens of conversation history added per turn.
- 120 output tokens per call.
- A conversation of 30 user messages.
- Either one model call per user message, or three (the tool-using case).

A 30-message conversation at three calls per message works out to about 2.30 million input
tokens and 10,800 output tokens. At one call per message it is about 765,000 input tokens.

Cost of one 30-message conversation, at published Vertex prices for the global endpoint:

| Model | 1 call/msg, no cache | 1 call/msg, cached | 3 calls/msg, no cache | 3 calls/msg, cached |
|---|---|---|---|---|
| Gemini 3.1 Pro Preview | $1.57 | $0.33 | $4.72 | $1.00 |
| Gemini 3.5 Flash | $1.18 | $0.25 | $3.54 | $0.75 |
| Gemini 3 Flash Preview | $0.39 | $0.08 | $1.18 | $0.25 |
| Gemini 3.1 Flash-Lite | $0.20 | $0.04 | $0.59 | $0.13 |
| Gemini 2.5 Flash | $0.24 | $0.05 | $0.72 | $0.16 |

The cached columns assume 90% of input tokens are read from cache. Caching is worth **4.7
times** on every Gemini 3 model, because Google prices cached input at exactly one tenth of
normal input across the whole lineup. The brief's "five times" estimate is right.

There is a middle case that is probably what we would actually see with implicit caching only.
If the first call of each user message misses the cache and the second and third calls hit it,
a 30-message tool-using conversation on Gemini 3.5 Flash costs **$1.68** rather than $3.54 or
$0.75. Caching that only works inside a burst recovers about half the money. Caching that works
across the whole conversation recovers about four fifths.

Output tokens are a smaller lever but not a free one. Gemini 3 bills reasoning tokens at the
output rate ("Text output (response and reasoning)" on the pricing page). If a thinking model
produces 600 output tokens per call instead of 120, the cached Gemini 3.5 Flash conversation
goes from $0.75 to about $1.14. Configuring a low thinking level is worth as much as some of
the caching work.

Per $1,000 of credit, on the three-calls-per-message assumption:

| Model | Conversations per $1,000, no cache | Conversations per $1,000, cached |
|---|---|---|
| Gemini 3.5 Flash | 282 | 1,330 |
| Gemini 3 Flash Preview | 847 | 3,984 |
| Gemini 3.1 Flash-Lite | 1,695 | 8,000 |

Multiply by the size of the grant to get the size of the free tier. The gap between the two
columns is the whole argument for taking caching seriously before launch rather than after.

### What explicit caching would cost us, and when it pays

Our 23,500-token prefix is 0.0235 million tokens. On a Flash-tier model that is $0.0235 per
hour of storage, which is $0.56 per day and about $17 per 30 days for one cache kept alive
continuously. On a Pro-tier model it is $0.106 per hour, $2.54 per day, about $76 per 30 days.
Creating the cache costs one uncached prefix, which is $0.035 on Flash and $0.047 on Pro.

Against that, one 30-message tool-using conversation on Gemini 3.5 Flash saves $2.79 when
cached. A single conversation pays for more than one hundred hours of cache storage. Explicit
caching is obviously worth it for any prefix that more than one conversation will use.

The catch is how many distinct prefixes we have. If the 23,500 tokens were identical for every
user, one shared cache would cover the entire platform for $17 a month, which is free in
practice. It is not identical: the user writes the agent instructions, and skills and tool
definitions vary per agent. The realistic unit is one cache per agent revision, created lazily
on the first call of a conversation with a short lifetime, say fifteen minutes, and allowed to
expire. On that scheme the storage bill is $0.0235 per active agent-hour, which stays small as
long as caches expire rather than being renewed forever.

The v1 recommendation is to rely on implicit caching, which costs nothing and needs no code,
and to measure the hit rate from the `cachedContentTokenCount` that every response carries. Add
explicit caching only where the measurement shows misses. That order avoids building a cache
manager before we know whether we need one.

---

## 3. The OpenAI-compatible endpoint

### It exists, and this is exactly what it is

Vertex AI publishes an endpoint that speaks the OpenAI `chat/completions` dialect. Google
describes it as: "The Chat Completions API works as an Open AI-compatible endpoint, designed to
make it easier to interface with Gemini on Gemini Enterprise Agent Platform by using the OpenAI
libraries for Python and REST." Source:
https://docs.cloud.google.com/vertex-ai/generative-ai/docs/migrate/openai/overview

The base URL is a Vertex resource path with the literal endpoint id `openapi`:

```
https://LOCATION-aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/LOCATION/endpoints/openapi
```

There is also a location-independent form that Google recommends for capacity reasons:

```
https://aiplatform.googleapis.com/v1/projects/PROJECT_ID/locations/global/endpoints/openapi
```

The model id is passed with a `google/` prefix, for example `google/gemini-3.5-flash`. The
authorization header carries a Google OAuth access token, not a product API key. All of that is
from the authentication and examples pages cited in Section 1.

### What it supports

Google publishes the supported parameter list. The ones that matter to us are all present:
`messages` (system, user, assistant, and tool roles), `model`, `stream`, `tools` (with `type`,
`function`, `name`, `description`, `parameters`), `tool_choice` (`none`, `auto`, `required`,
and a Google-specific `validated`), `temperature`, `top_p`, `stop`, `seed`,
`response_format`, and `reasoning_effort`. Unsupported parameters are silently ignored: "If you
pass any unsupported parameter, it is ignored."

Google-specific features ride in an `extra_body.google` object. Two of them matter here:
`cached_content`, which "corresponds to the Gemini generateContent.cached_content field", and
`thinking_config`. So **an explicit context cache can be referenced through the
OpenAI-compatible endpoint**. Caching is not lost by choosing this dialect. Source: the same
overview page.

Streaming works: `"stream": true` is in the supported list and Google publishes a streaming
curl example. Function calling works and Google publishes a streaming function-call example
using `extra_body.google.stream_function_call_arguments`. Source:
https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/migrate/openai/examples

One parameter is missing from the supported list and it is the one metering depends on.
`stream_options` (with `include_usage: true`) is how an OpenAI-dialect client asks for a final
chunk carrying token counts. It does not appear in the Vertex supported-parameter list, and
unsupported parameters are ignored rather than rejected. Google's *Developer API* OpenAI page
does document `stream_options: {'include_usage': True}` and prints `chunk.usage` in its example
(https://ai.google.dev/gemini-api/docs/openai), but that is the other product. **Whether the
Vertex OpenAI-compatible endpoint returns usage on a streamed response is unverified.**
Section 8 gives the test.

This is survivable either way. A gateway sees the whole upstream response and can meter from
whatever the upstream reports; if the upstream reports nothing on streams, the gateway can
count tokens itself or fall back to Google's `countTokens` API. But it changes how much work
the gateway does, so it should be settled early.

### The landmine: thought signatures

This is the finding that most affects the integration, and it is not a small one.

Gemini 3 models return an encrypted blob called a **thought signature** attached to any
function call they emit. It is a saved state of the model's reasoning. Google's documentation
states the requirement directly: "Gemini 3 models enforce stricter validation on thought
signatures than previous Gemini versions... you must return the thought signatures from
previous responses in your subsequent requests, even when using MINIMAL thinking levels. If a
required thought signature is not returned when using Gemini 3 models, the model will return a
400 error." Source:
https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thought-signatures

Through the OpenAI-compatible endpoint, the signature arrives in a non-standard place: inside
each tool call, at `tool_calls[N].extra_content.google.thought_signature`. Google's own
documentation shows the exact round trip a client must perform, sending the same
`extra_content` block back on the next request.

Ordinary OpenAI-dialect clients do not do this. They parse `tool_calls` into their own model
and drop fields they do not know about, so the signature is lost and the next request fails.
This is a widely reported failure, not a theoretical one. The Codex CLI issue reproduces it
against Vertex exactly as we would hit it:

> `unexpected status 400 Bad Request: "Unable to submit request because function call
> 'default_api:shell' in the 4. content block is missing a 'thought_signature'."`

with a config pointing `base_url` at
`https://aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/global/endpoints/openapi`
and `wire_api = "chat"`. Source: https://github.com/openai/codex/issues/7519. The same failure
is filed against VS Code (microsoft/vscode#296713), the OpenAI Python SDK (openai-python#2758),
the OpenAI Agents SDK (openai-agents-python#2137), and Goose (block/goose#5792).

**Our harness has this bug.** Pi's OpenAI adapter round-trips encrypted reasoning only in
OpenRouter's `reasoning_details` format. In
`services/runner/node_modules/.pnpm/@earendil-works+pi-ai@0.80.6_.../node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js`
it reads `choice.delta.reasoning_details` (line 326) and re-emits `assistantMsg.reasoning_details`
(line 795). It never reads or writes `extra_content`. So Pi driving Gemini 3 through the Vertex
OpenAI endpoint would fail on the second step of any tool-using turn.

There are four ways out, and they are worth stating plainly because they shape the gateway.

1. **The gateway carries the signature.** Our gateway sees both directions. It can record the
   signature per `tool_call` id on the way out and re-attach `extra_content.google.thought_signature`
   to matching assistant tool calls on the way in. Redis is enough state for this, keyed by tool
   call id with a short expiry. This is the smallest change and it keeps the harness untouched.
2. **The gateway translates dialects.** Instead of forwarding OpenAI-shaped requests to
   Vertex's compatibility layer, the gateway itself converts to `generateContent` and back. More
   code, but it removes a translation layer we do not control and gives us direct access to
   `cachedContentTokenCount` and to explicit cache references.
3. **Disable the validation.** Google documents an escape hatch: "You can set thought_signature
   to `skip_thought_signature_validator`, but this should be a last resort as it will negatively
   impact model performance." Cheap, and explicitly discouraged by Google.
4. **Speak Google's dialect from the harness.** Pi already has native Google adapters,
   described in Section 9. This avoids the problem entirely but is the largest change to our
   own code.

Option 1 is the recommendation for v1 and option 2 is the direction if the gateway grows.

---

## 4. Rate limits and the model lineup

### Which models suit a tool-calling agent

Every Gemini model on the shortlist supports function calling and both kinds of caching, and
every one of them whose model page was checked (3.5 Flash, 3.1 Pro, 3.1 Flash-Lite, 2.5 Flash)
has a context window of 1,048,576 tokens. None of that is the constraint. Price and rate limits
are. The shortlist, with Vertex standard prices per million tokens on the global endpoint:

| Model | Model id | Input | Cached input | Output (incl. reasoning) | Notes |
|---|---|---|---|---|---|
| Gemini 3.5 Flash | `gemini-3.5-flash` | $1.50 | $0.15 | $9.00 | GA. Google positions it as "near-Pro intelligence at Flash-tier cost" |
| Gemini 3.6 Flash | `gemini-3.6-flash` | $1.50 | $0.15 | $7.50 | Cheaper output than 3.5 Flash |
| Gemini 3 Flash Preview | `gemini-3-flash-preview` | $0.50 | $0.05 | $3.00 | Preview launch stage |
| Gemini 3.1 Flash-Lite | `gemini-3.1-flash-lite` | $0.25 | $0.025 | $1.50 | Cheapest sensible agent model |
| Gemini 3.1 Pro Preview | `gemini-3.1-pro-preview` | $2.00 | $0.20 | $12.00 | Preview. Input doubles above 200K tokens |
| Gemini 2.5 Flash | `gemini-2.5-flash` | $0.30 | $0.03 | $2.50 | Older generation, cheaper, 2,048-token cache minimum |

Prices: https://cloud.google.com/vertex-ai/generative-ai/pricing. Capabilities, context window
and launch stage for Gemini 3.5 Flash:
https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-5-flash

Two details on that model page are load-bearing elsewhere in this document. Its capability
table lists "Chat completions: Supported" and "Function calling: Supported", so the
OpenAI-compatible endpoint is a first-class surface for it. And it lists "Fixed quota: Not
supported", which Section 5 explains.

Note that the non-global endpoints cost 10% more for the Gemini 3 generally-available models
from 1 July 2026 (the pricing page marks these as "(Global) ... (Non-global)"). Using the
global endpoint is both cheaper and, per Google, better for capacity.

There are two real reasons to consider Gemini 2.5 Flash despite it being a generation behind.
Its cache minimum is 2,048 tokens rather than 4,096, and its prices are about a fifth of 3.5
Flash. More importantly, the thought-signature problem described in Section 3 is specific to
Gemini 3: Google's wording is that "Gemini 3 models enforce stricter validation on thought
signatures than previous Gemini versions" and that a missing signature produces a 400 on
Gemini 3. That strongly implies a Gemini 2.5 model would work through the OpenAI-compatible
endpoint with today's harness and no gateway relay, which makes it a good first target for the
end-to-end test in Section 8. Do not treat that as settled until the test runs.

### Rate limits at the scale of thousands of users

Gemini models on Vertex do not have a per-project rate limit you can raise or lower. They use
what Google calls **dynamic shared quota**: capacity is allocated from a shared pool. Instead
of a quota, each organization gets a baseline throughput that rises with spend over a rolling
30-day window. Source:
https://docs.cloud.google.com/vertex-ai/generative-ai/docs/dsq

| Model family | Tier | 30-day spend | Baseline throughput, per model, org-wide |
|---|---|---|---|
| Gemini Pro | Tier 1 | $10 to $250 | 500,000 tokens per minute |
| Gemini Pro | Tier 2 | $250 to $2,000 | 1,000,000 tokens per minute |
| Gemini Pro | Tier 3 | over $2,000 | 2,000,000 tokens per minute |
| Gemini Flash and Flash-Lite | Tier 1 | $10 to $250 | 2,000,000 tokens per minute |
| Gemini Flash and Flash-Lite | Tier 2 | $250 to $2,000 | 4,000,000 tokens per minute |
| Gemini Flash and Flash-Lite | Tier 3 | over $2,000 | 10,000,000 tokens per minute |

Google adds three things worth knowing. Traffic is not hard-capped at the baseline: "Agent
Platform lets traffic burst beyond this limit on a best-effort basis." There is no separate
request-per-minute tier limit, but "the system limit of 30,000 RPM per model per region
applies." And a 429 error "doesn't indicate that you've hit a fixed quota. It indicates
temporary high contention."

**Does any of this bite before the money runs out?** Do the arithmetic with our own numbers. At
23,500 input tokens per call, a Tier 1 Flash baseline of 2,000,000 tokens per minute is about
85 model calls per minute, which at three calls per user message is about 28 user messages per
minute across the entire platform. Tier 3 is five times that, about 425 calls per minute. Note
that credit spend counts toward the tier (the tier is computed from spend on eligible Agent
Platform services), so a funded free tier that is actually being used will climb to Tier 3
quickly.

So the honest answer is: **throughput could bite before the money does, at Tier 1, on a busy
day.** Roughly thirty concurrent conversations sending a message each per minute would reach
the Tier 1 Flash baseline. It is a soft limit that bursts rather than a wall, and the tier
climbs with usage, but a launch that goes well could see 429s before it sees an empty balance.
The mitigations Google names are the global endpoint, exponential backoff, and smoothing
traffic rather than sending it in spikes. A gateway is the natural place to implement all
three.

---

## 5. Hard limits: can anything replace a gateway?

This is the claim to settle. The belief going in was that nothing Google sells can bound one
end user's spending. That belief is correct, but the picture changed in July 2026 and the
change is useful to us, so it is worth going through every mechanism.

### Alerts-only budgets

A Cloud Billing budget with alert thresholds sends email or a Pub/Sub message when spend
crosses a percentage of a target. Google's documentation is explicit that it does not stop
anything: "Setting an alerts-only budget doesn't automatically cap Google Cloud or Google Maps
Platform usage or spending. Alerts-only budgets trigger alerts to inform you of how your usage
costs are trending over time... they don't automatically prevent the use or billing of your
services." Source: https://docs.cloud.google.com/billing/docs/how-to/budgets

Budgets can drive automation through Pub/Sub, and Google lists "Limit spending by disabling
billing when you reach your budget" as a supported pattern
(https://docs.cloud.google.com/billing/docs/how-to/notify). That is the classic hard stop. It
operates on a whole project, it takes effect only after billing data arrives, and disabling
billing on a project stops far more than model calls.

**Scope: whole project. Speed: hours. Can it bound one end user? No.**

### Spend caps (public preview)

This is new and it is genuinely a hard limit. Google shipped spend cap budgets in public
preview around July 2026. The documentation says: "The spend cap is enforced when your usage
costs exceed 100% of your budget amount. When a spend cap budget is enforced, usage of your
specified services is automatically paused until you manually lift the spend cap." Source:
https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps

The eligible service list includes exactly the two products in this document: "Gemini API,
Gemini Enterprise Agent Platform (formerly Vertex AI), Cloud Run, and Cloud Run functions."

Enforcement is fast by billing standards because it does not wait for real invoicing: "For
faster enforcement, spend caps use gross, estimated costs to trigger alerts and enforce the
spend cap." Google's blog and press coverage describe minutes for AI services. Google still
warns: "the enforcement of spend caps aren't instant and any cost overages are billed as
normal."

The limitations are the point for us:

- "Spend caps are limited to budgets that are scoped to a single Google Cloud project and a
  single eligible service within the specified project."
- "The time range budget period for a spend cap budget is limited to Monthly, starting on the
  first day of each month."
- "The cost calculations for spend caps are based on gross costs and don't include savings and
  credits."
- Lifting an enforced cap is manual, and "If the cap was enforced and lifted within the same
  billing month, it won't trigger again for the rest of the month, unless you increase the
  target amount of the cap."

So a spend cap cannot bound a user, and it cannot bound a week. It bounds one project, for one
service, for one calendar month, and it needs a human to undo.

**Scope: one project and one service. Speed: minutes. Can it bound one end user? No.**

It is still worth having. A spend cap on the project that funds the free tier is a real
catastrophe backstop: if the gateway has a bug and lets through a hundred times the intended
traffic, Google stops the bleeding within minutes without anyone being awake. Set it above the
monthly budget we intend to spend, and treat a trigger as an incident. The one hazard to plan
for is that a triggered cap pauses the entire free tier for every user until someone lifts it
by hand, so it must be paired with paging.

Note also that the cap counts gross costs and ignores credits. A monthly cap of, say, $20,000
means $20,000 of gross Vertex usage in that project, whether or not credits are paying for it.
That is convenient: it is a direct control on burn rate.

### Quotas, including setting a model's quota to zero

Setting a model's quota to zero used to be a real access-control technique on Vertex, and
articles about it still circulate. It no longer applies to Gemini.

The reason is dynamic shared quota. Google's documentation states that with DSQ, capacity "is
dynamically distributed among all customers for a specific model and region, removing the need
to set quotas and to submit quota increase requests. There are no quotas with DSQ." The
per-model capability pages confirm it individually: Gemini 3.5 Flash, Gemini 3.1 Pro, Gemini
3.1 Flash-Lite and Gemini 2.5 Flash all list "Fixed quota: Not supported". The generative AI
quotas page no longer lists a `generate_content_requests_per_minute_per_base_model` metric at
all; the only per-model metrics that remain are multimodal input limits and embedding limits.
Sources: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/dsq,
https://docs.cloud.google.com/vertex-ai/generative-ai/docs/quotas, and the per-model pages
under `.../docs/models/gemini/`.

Where quota overrides do still exist, the unit of control is wrong for us anyway. Google's
Service Usage documentation says the supported consumers for a quota override are "projects,
folders, and organizations". There is no per-user or per-key consumer. Source:
https://docs.cloud.google.com/service-infrastructure/docs/manage-consumer-quota

**Scope: project, folder, or organization, and not available for Gemini models at all. Can it
bound one end user? No.**

### API key restrictions

Google Cloud API keys can carry restrictions, but they restrict *what* a key may call, not
*how much*. Google's own description of what a key does for accounting: "Both keys let you
associate a request with a project for billing and quota purposes." The available restrictions
are application restrictions (which websites, apps, or IP addresses may use the key) and API
restrictions (which APIs the key may call). Source:
https://docs.cloud.google.com/docs/authentication/api-keys

There is no per-key dollar limit and no per-key rate limit. Quota is a property of the project,
not of the key.

**Scope: which APIs and callers, not how much. Can it bound one end user? No.**

### Service accounts and IAM

Identity and Access Management decides who may call which API. It has no spending dimension at
all. A service account can be permitted or denied `aiplatform.endpoints.predict`, and that is
a binary. Revoking it stops that identity everywhere in the project at once.

**Scope: binary allow or deny, per identity, project-wide. Can it bound one end user? Only by
giving every end user their own Google identity and project, which means one Google Cloud
project per signup. Projects are a limited resource, project creation is slow, and DSQ tiers
are computed per organization, so this does not work.**

### Anything inside Vertex AI itself

Provisioned Throughput is a purchase of reserved capacity, so it caps throughput at a fixed
cost rather than capping spend per caller. Priority and Flex PayGo change price and latency,
not limits. Explicit context caches, tuning jobs and batch jobs have their own quotas, none of
which are per end user. Nothing in Vertex AI exposes a per-caller budget.

### The verdict

| Mechanism | What it bounds | Smallest unit | Time to take effect | Bounds one end user? |
|---|---|---|---|---|
| Alerts-only budget | Nothing. It sends email | Project or billing account | Hours | No |
| Budget plus Pub/Sub automation to disable billing | Everything in a project | Project | Hours | No |
| Spend cap budget (preview) | One service in one project, per calendar month | Project and service | Minutes | No |
| Quota override to zero | Not available for Gemini (no quotas under DSQ) | Project, folder, org | Minutes when it applies | No |
| API key restrictions | Which APIs and callers | Key | Immediate | No |
| IAM and service accounts | Allow or deny | Identity | Immediate | No |
| Vertex AI features | Throughput, not spend | Project | Varies | No |

**Nothing Google sells can replace the gateway.** The finest-grained spending control Google
offers is one project, one service, one calendar month, lifted by hand. Our requirement is one
organization, per conversation, resuming automatically when the user buys or earns more
credit. The gap is not narrow; it is a different kind of control.

The belief the brief asked us to try to disprove holds. What changed is that spend caps are now
worth adopting as a second layer under the gateway, which was not true before July 2026.

---

## 6. What is publicly documented about the credits

The startup program's public pages state the following, and nothing more.

Credits are granted in two annual tranches for the Scale tier: "Year 1: 100% up to $100,000 USD
in Google Cloud credits" and "Year 2: 20% up to an additional $100,000 USD", with a larger
year-one figure for AI-first startups. The Start tier gets "Up to $2,000 USD in Google Cloud
credits, valid for one year". Source: https://cloud.google.com/startup/benefits

Credits "can be applied toward Google Cloud Services and Select Google Cloud offerings, subject
to the Google for Startups Cloud Program-Startup Terms", and "Program credits cover Google's
state-of-the-art models like Gemini and Gemma", while "Third-party models are billed directly
and are not covered by the program credits". Source: https://cloud.google.com/startup/ai

The program terms handle expiry by pointing elsewhere rather than naming a period: credits
"will expire within the period of time (x) as specified by Google in writing at the time of
credit issuance or (y) as shown in the Company's online console(s) or dashboard". The same
terms state that credits "may only be used against qualifying Services usage fees accrued
after the time Google issues such credit", that the company "will be responsible for all
Service usage fees or charges not covered by, or in excess of, the credits", and that "Google
is not required to notify Company when the credit is exhausted". Source:
https://cloud.google.com/terms/startup-program-tos

Two clauses in those terms deserve attention beyond the money. Section 3(a) says the credits
"are not transferable, refundable, redeemable for cash, and may not be sold, purchased, or
bartered". Section 7 says the company "may not disclose the terms, conditions or existence of
any non-public aspect of the Programs to any third party". The second is why this work lives in
a private repository.

### What is not documented, and what to ask Google

Two questions matter to the design and neither has a published answer.

**Which non-welcome Google Cloud credits are eligible for the Gemini Developer API?** The
billing page implies a list exists and does not publish it. The answer only matters if we ever
want a fallback path off Vertex, but it is cheap to ask at the same time.

**What is the exact expiry date on our grant, and is there a per-service or per-SKU
restriction?** The terms defer to what Google states at issuance and what the console shows.
Read the console, screenshot it, and record the date in this repository. A credit system whose
funding expires on a date nobody wrote down is a bad credit system.

One more thing to verify against the console rather than the docs: whether credits apply to
context cache storage SKUs and not only to token SKUs. The dynamic shared quota page lists
"All related Gemini SKUs for features like Caching, Caching Storage" among eligible Agent
Platform spend for tier calculation, which is suggestive but is about tiers, not about credit
eligibility.

---

## 7. What our own code would have to change

### How a run reaches a model today

The path has four parts.

**The agent config carries a model reference.** Somewhere upstream the user picks a model and
a connection. That resolves into a small set of wire fields on the run request, defined in
`services/runner/src/protocol.ts` lines 460 to 501: `model`, `provider`, `connection` (a mode
and an optional slug), `deployment`, `endpoint` (a base URL, API version, region, and public
headers), and `credentialMode`. Secrets ride separately and never appear in these fields.

**The SDK resolves a connection.** `sdks/python/agenta/sdk/agents/platform/connections.py`
fetches `GET /secrets/` with the caller's auth and builds a catalog of candidates from two
kinds of vault record, `provider_key` and `custom_provider`. `_custom_provider_candidate` (line
344) reads the stored slug, URL and key. It runs the URL through `assert_endpoint_url_allowed`
(line 361), which rejects non-HTTPS and private addresses unless
`AGENTA_INSECURE_EGRESS_ALLOWED` is set. A custom record with no known provider family
normalizes to the `openai` family and the `custom` deployment (`resolved_provider`, line 263),
its key is placed in `OPENAI_API_KEY` (`resolved_env`, line 303), and a chosen custom
connection that has no usable base URL fails the run loudly rather than silently falling back
to a default provider (`requires_endpoint`, line 277).

**Capabilities gate the pair.** `sdks/python/agenta/sdk/agents/capabilities.py` decides what a
harness may reach. `PI_VAULT_PROVIDERS` (line 51) already contains `gemini`, and
`PROVIDER_ENV_VARS` (line 127) already maps `gemini` to `GEMINI_API_KEY`. But
`harness_allows_pair` (line 361) narrows the `custom` deployment hard: for Pi it is allowed
only with the `openai` provider family.

**The runner writes Pi's model registry.** `services/runner/src/engines/sandbox_agent/pi-model-config.ts`
turns the run request into Pi's `models.json`. Line 16 fixes the dialect to a single value,
`"openai-completions"`. Line 22 fixes the credential environment variable to `OPENAI_API_KEY`.
`buildPiModelConfigPlan` (line 85) applies only when the harness is Pi, the provider is
`openai`, the deployment is `custom`, and the connection mode is `agenta`, and it throws rather
than degrade when such a request is incomplete. `serializePiModelsJson` (line 135) writes a
document naming one provider with a `baseUrl`, an `api`, an `apiKey` of `$OPENAI_API_KEY`, and
one model. `environment-setup.ts` line 241 calls it, and `pi-assets.ts` or `daytona.ts` writes
the file into the sandbox.

### Option A: the gateway speaks the OpenAI dialect. No runner change at all

If our gateway exposes `POST /v1/chat/completions` in the OpenAI dialect and authenticates with
a token we mint, then a run reaches it today with **zero changes to the runner**. The existing
`custom_provider` path already does exactly this: base URL points at the gateway, key is the
gateway token in `OPENAI_API_KEY`, provider family normalizes to `openai`, deployment is
`custom`, `harness_allows_pair` permits Pi with `openai` and `custom`, and `pi-model-config.ts`
emits a `models.json` naming the gateway.

What has to be built is on the platform side, not the runner side:

1. A way to create that connection record for a user without the user typing it, so a new
   signup gets the managed connection automatically. Today `custom_provider` records are
   user-created vault secrets. A managed connection has to be minted by us, be visible to the
   resolver, and carry a per-organization token rather than a shared secret.
2. The token itself must be short-lived or revocable, because it lands in the sandbox's
   environment and the user controls that sandbox. Treat it as public the moment it is issued.
3. The gateway must hold the Google credential and refresh the OAuth token hourly, or use a
   Google Cloud API key.
4. The gateway must re-attach thought signatures, per Section 3, or tool-using runs on Gemini 3
   will fail on the second step.
5. The gateway must meter. If the Vertex compatibility layer does not return usage on streamed
   responses, the gateway counts tokens itself.

The single most important consequence: **the fastest path to a working funded free tier does
not require touching the runner.** The wire contract already has the shape.

### Option B: the gateway speaks Google's dialect to Pi

Pi can speak Google's own dialect. Its model library `@earendil-works/pi-ai` version 0.80.6
ships adapters at `dist/api/google-generative-ai.js` and `dist/api/google-vertex.js`, and its
type union `KnownApi` (in `dist/types.d.ts` line 13) includes both `google-generative-ai` and
`google-vertex`. The Vertex adapter builds a `GoogleGenAI` client with `vertexai: true`,
accepts either a Vertex API key or ADC through `GOOGLE_APPLICATION_CREDENTIALS`, honours a
custom `baseUrl`, maps `usageMetadata.cachedContentTokenCount` into its own `cacheRead` usage
field (line 173), and preserves thought signatures through a shared helper
(`dist/api/google-shared.js`, `retainThoughtSignature`).

Pi's documented `models.json` API list (`node_modules/@earendil-works/pi-coding-agent/docs/models.md`,
"Supported APIs") names `openai-completions`, `openai-responses`, `anthropic-messages` and
`google-generative-ai`, and shows a working example that points `google-generative-ai` at a
custom `baseUrl` with an `apiKey` read from `$GEMINI_API_KEY`. So a gateway speaking the
`generativelanguage`-style dialect is a documented configuration, and it sidesteps the thought
signature problem entirely because Pi's Google path handles signatures.

The cost is real work in three files:

- `pi-model-config.ts` must stop hard-coding one dialect and one environment variable. Both the
  `api` value and the credential variable become functions of the resolved provider family.
- `capabilities.py` must allow the pair (Pi, `gemini`, `custom`) in `harness_allows_pair`, and
  the `gemini` custom deployment must resolve its key into `GEMINI_API_KEY` rather than
  `OPENAI_API_KEY` in `connections.py`.
- `connections.py` `resolved_provider` must stop normalizing every provider-less custom
  connection to `openai`, or the managed Google connection must always carry an explicit
  provider.

The wire contract itself needs nothing new. `protocol.ts` already documents `"vertex"` as a
legal `deployment` value (line 483) and `capabilities.py` already lists `vertex_ai` and
`vertex` as Claude deployments (line 250), so the vocabulary exists.

### Option C: no gateway, direct Vertex from the sandbox

For completeness, and to reject it. Pi's `google-vertex` adapter could authenticate straight to
Vertex with a service account file mounted into the sandbox. That would work technically and it
is unacceptable: the user controls the agent instructions, so the user can read any credential
placed in that container, and a Google service account credential has no per-user spending
limit behind it (Section 5). This is exactly the case the gateway exists to prevent.

### Recommendation

Ship Option A. It requires no runner change, it exercises the whole platform-side machinery we
need anyway (managed connection, per-organization token, metering, ledger), and it keeps the
harness on its most-tested code path. Build the thought-signature relay into the gateway from
day one, because without it Gemini 3 tool calling does not work at all. Keep Option B in view
as the migration if the compatibility layer proves lossy on usage numbers or on caching.

---

## 8. What is not yet verified, and the test that settles each one

Four things in this document are inference rather than documentation. Each one has a cheap
test, and all four can be answered by one afternoon of scripting against a real project.

**Does implicit caching apply through the OpenAI-compatible endpoint, and does the response
report it?** Google documents implicit caching as a project-level behaviour of the model
serving stack and documents `cachedContentTokenCount` as the field that reports it, but nothing
states how that surfaces on the `chat/completions` shape. *Test:* send the same 24,000-token
prefix twice, ten seconds apart, to
`https://aiplatform.googleapis.com/v1/projects/PROJECT/locations/global/endpoints/openapi/chat/completions`
with `google/gemini-3.5-flash`, non-streamed. Print the whole `usage` object from both replies.
A non-zero `prompt_tokens_details.cached_tokens` on the second reply answers both halves of the
question.

**Does the same endpoint return usage on a streamed response?** `stream_options` is not in
Google's supported parameter list and unsupported parameters are ignored. *Test:* repeat the
call above with `"stream": true` and `"stream_options": {"include_usage": true}`, and print
every chunk. Look for a final chunk with an empty `choices` array and a populated `usage`.

**How long does an implicit cache entry live?** Undocumented, and it decides whether our real
cost per conversation is the $0.75 column or the $1.68 middle case. *Test:* send the same
prefix, then repeat it after 30 seconds, 2 minutes, 5 minutes, 15 minutes, and 60 minutes,
recording `cached_tokens` each time. The point where it drops to zero is the practical
lifetime.

**Does Pi actually fail on Gemini 3 tool calling through this endpoint, and does re-attaching
`extra_content.google.thought_signature` fix it?** The failure is well documented in other
clients and Pi's adapter visibly lacks the handling, but we have not reproduced it on our own
stack. *Test:* configure a Pi run with a `custom_provider` connection pointing at the Vertex
`openapi` base URL, give the agent one tool, and ask a question that needs two sequential tool
calls. Expect a 400 naming a missing `thought_signature`. Then put a trivial proxy in front
that stores the signature by tool call id and re-attaches it, and confirm the same run
succeeds. That proxy is the first version of the gateway.

One further question belongs to Google rather than to a test, and is listed in Section 6:
whether the credit covers context cache storage as well as tokens.
