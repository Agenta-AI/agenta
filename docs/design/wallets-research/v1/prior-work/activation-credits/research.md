# Research: what we verified before designing

Eight research threads ran against the codebase, production traces, provider
documentation, and the market (2026-07-23). Each section states what was found,
where the evidence lives, and what it forced in the design. File references are
repo-relative with line numbers from the day of research.

## 1. How the key wall works today (frontend)

The yellow banner is `ConnectModelBanner`
(`web/oss/src/components/AgentChatSlice/components/ConnectModelBanner.tsx:44-57`),
rendered above the composer in
`web/oss/src/components/AgentChatSlice/AgentConversation.tsx:2190`. Its copy:
"Connect {provider} to run this agent with your own key", with a "Set up
credentials" button that opens the model-and-harness drawer.

The gate condition lives in
`web/oss/src/components/AgentChatSlice/hooks/useAgentModelKeyStatus.ts:98-99`:

```
gateActive = !loading && vaultEmpty && !selfManaged && !keySetupDone && !!providerEntry
```

The load-bearing facts:

- `vaultEmpty` means the project vault has **zero secrets of any kind**. The
  gate is project-wide, not per-provider or per-model.
- `keySetupDone` is a persisted localStorage flag
  (`agenta:provider-key-setup-done`); once a user has ever completed key setup,
  the gate never fires again on that browser.
- Entitlements and billing play **no part** in the decision. The wall is purely
  "vault empty".
- While `gateActive`, the composer is disabled client-side
  (`AgentConversation.tsx:750, 2237-2248`); the run is never attempted.

The onboarding flow stages the wall precisely at the payoff. Signup lands on
`/apps` (`web/oss/src/state/url/postLoginRedirect.ts`, EE inserts a post-signup
survey); with no agents yet, `OnboardingEntry` redirects into the ephemeral
onboarding playground, where the banner is deliberately suppressed
(`AgentConversation.tsx:2186-2190`). The user describes an agent, commits it,
a first prompt is seeded, and only then does the gate fire. When a key is
connected, the seeded prompt auto-sends (`AgentConversation.tsx:1692-1739`,
comment: "Connecting the key IS the go-ahead").

Two adjacent findings:

- The template setup drawer already **promises** platform keys: `ModelRow.tsx`
  labels Agenta-managed models "Ready" with the comment "Agenta-managed is Ready
  by default (platform keys, no input)". The runtime does not honor that
  promise; the product half-claims the feature this project builds.
- The classic prompt playground (`web/oss/src/components/Playground/`) has no
  client-side key gate at all; a keyless run there fails at the backend.

**Design consequence.** The frontend change is small: the gate becomes "no vault
key AND no trial balance", plus a countdown, an exhausted state, and draft
retention. The auto-send machinery is reusable but only covers the seeded first
prompt; retaining an arbitrary refused draft is new state. The real work is
below the frontend.

## 2. Prior art: PR #2957 and the severed wire (backend)

The platform-funded idea was built once. PR #2957 ("Limit usage of agenta
provided keys via credits") shipped two halves:

**Key supply, still live.** The SDK's vault middleware
(`sdks/python/agenta/sdk/middlewares/running/vault.py`, `get_secrets()` around
lines 282-425) reads provider keys from the service process environment
(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …), injects them as "local secrets", and
merges them under the user's vault keys: the user's key wins, the platform key
fills gaps. The deploy files carry the slots
(`hosting/docker-compose/oss/.env.oss.gh:80-91`,
`hosting/docker-compose/ee/env.ee.gh.example:256-268`).

**Credit gate, orphaned.** `_allow_local_secrets` (`vault.py:126`) calls
`GET /api/access/permissions/check?resource_type=local_secrets`, which on EE
meters a `credits_consumed` counter and denies when exhausted
(`api/oss/src/apis/fastapi/access/router.py:65-90`). The denial copy still
exists: "Out of credits. Please set your LLM provider API keys or contact
support." But `git grep _allow_local_secrets` returns exactly one hit, the
definition. The call site was lost in the SDK reorganization (last live in
commit `55bb45468a`). The server half works; nothing calls it.

**The part that invalidates simple reuse.** The agent playground does not use
this path at all. `services/oss/src/agent/secrets.py` says it outright: the
`/invoke` path "no longer calls this: it resolves ONE least-privilege connection
for the configured model via `resolve_connection` … instead of the model-blind
whole-vault dump." The agent resolver
(`sdks/python/agenta/sdk/agents/platform/connections.py:537+`) fetches only
vault secrets and fails with a typed error when none match (default and
self-managed modes instead degrade to runtime-provided credentials,
`sdks/python/agenta/sdk/agents/handler.py:160`). There is no platform fallback
on the agent path, which is why the frontend wall exists.

Two loose ends worth acting on regardless of this project:

- If any `*_API_KEY` values are set on the cloud completion service today,
  **legacy-path** runs can use them unmetered. Audit and remove.
- A separate, newer `sandbox_credits` system meters Daytona compute for agent
  sandboxes. It is unrelated to LLM spend; do not confuse the two.

**Design consequence.** "Reconnect the severed wire" was the original plan and
it is wrong for the surface that matters. The enforcement point must live on the
agent path's connection-resolution seam, where the selected model is known. The
meter machinery from #2957 is the piece we keep.

## 3. The entitlements engine (what we reuse)

The EE entitlements domain (`api/ee/src/core/access/entitlements/`,
`api/ee/src/core/meters/`, `api/ee/src/dbs/postgres/meters/`) is a generic quota
engine with exactly the primitives a trial needs:

- **Vocabulary**: boolean `Flag`s, metered `Counter`s, level `Gauge`s, and
  rate-limit `Throttle`s, with per-plan `Quota(free, limit, strict, scope,
  period)` in a code-constant catalog (`types.py:321-675`). Hobby already
  carries `credits_consumed: Quota(free=100, limit=100, strict=True,
  period=MONTHLY)` (`types.py:348`).
- **Atomicity**: `MetersDAO.adjust` (`dao.py:376-518`) is a single
  `INSERT … ON CONFLICT DO UPDATE SET value = greatest(value+delta, 0) WHERE
  <limit predicate> RETURNING`. The limit check happens in SQL, so concurrent
  requests cannot jointly overshoot; negative deltas (refunds) clamp at zero.
- **Lifetime counters exist natively**: the meter row's identity is a
  deterministic UUID of (scope, period, key) (`meters/types.py:96-141`). A
  monthly quota "resets" because the month rolls the identity to a fresh row; a
  quota with `period=None` is one row forever. No reset job anywhere.
- **Checks are explicit calls**, not middleware: handlers call
  `check_entitlements(key=…, delta=…)` (`service.py:272`). On infrastructure
  errors it **fails open** (`service.py:302-314`), a sensible policy for
  feature gates and the wrong one for spending money.
- **Signup provisioning**: `create_organization_and_project`
  (`api/oss/src/services/commoners.py:252`) hands EE
  `provision_signup_subscription`, which starts either a reverse trial or the
  free plan (`cloud_v0_hobby`). Notably, **explicit org creation runs a
  different provisioning path** (`api/ee/src/core/organizations/service.py:931`)
  than signup; the two are distinguishable.
- **Frontend**: `/billing/usage` reports every counter with
  `{value, limit, free, period, scope}`; `UsageProgressBar` on the Billing page
  renders any counter present, and the TypeScript types already declare
  `credits_consumed`. A quota-exceeded 403 today falls through to a generic
  error toast (`axiosConfig.ts:147-173` intercepts only auth-upgrade codes);
  nothing renders a "you hit the limit" state.

Two impedance points that matter:

- `credits_consumed` is monthly. Reusing it for a lifetime trial would silently
  refill the trial every month. A new counter with `period=None` is required.
- Quota limits are plan constants. There is **no per-org override mechanism**,
  and a plan-level lifetime quota would grant the full allowance to every
  existing org on the plan the day it ships, not just new signups.

**Design consequence.** Consumption accounting reuses the meter engine as-is
(new lifetime counter). Eligibility cannot come from the plan catalog; it needs
a per-org grant record written at signup. The exhausted-state UX needs a real
frontend state, not the 403 fallthrough.

## 4. What an activation session actually costs (measured)

We queried production traces on EU cloud
(`POST /api/tracing/spans/query`, token metrics in span attributes
`ag.metrics.tokens.{incremental,cumulative}.*`). The API key is project-scoped,
so the sample is our own team project: 148 spans / 80 traces over 180 days, of
which 8 are agent-playground traces. Small and non-organic, but it contains the
number that matters.

The one fully instrumented agent call (claude-haiku-4-5, user message "hey"):
`input_tokens=10`, `output_tokens=119`, `total_tokens=23,621`, billed cost
$0.02997. The arithmetic closes only as a **~23.5K-token cache write of harness
context** (23,492 × $1.25/M write + 10 × $1/M + 119 × $5/M = $0.0300). Every
agent call carries the harness (system prompt, skills, tool definitions);
99.5% of activation cost is our own context, not the conversation.

For contrast, the legacy prompt playground's calls are trivial: median 40 input
/ 24 output tokens, about $0.000025 per call.

A 10-turn activation session, modeled from these measurements (history grows
~130 tokens/turn): roughly **242K input tokens, 1.2K output tokens**. Cost per
session at July 2026 prices, without and with prompt caching (85% input
discount):

| Model | No caching | Cached |
|---|---|---|
| Gemini 2.5 Flash-Lite | $0.025 | $0.004 |
| DeepSeek V4 Flash | $0.034 | $0.005 |
| OpenAI gpt-5.4-nano | $0.050 | $0.009 |
| Claude Haiku 4.5 | $0.248 | ~$0.05 (cross-checked against the real Anthropic cache math: ~$0.057) |

Caveats: the sampled turns made one LLM call each; real tool-using sessions run
2-3x. Two data-quality findings came out of the measurement:

- **Agent runs routed through OpenRouter record no token usage at all**
  (`ag.metrics` and `gen_ai.usage` both empty). Cheap-model spend is invisible
  to our own observability today. This needs an issue filed regardless.
- Cache tokens are inconsistently folded into `total_tokens` across providers,
  so `total` is not a billed-token count.

**Design consequence.** 10,000 signups cost roughly $500 uncached / under $100
cached on the cheap models: inside the $3,000 budget with room for the 2-3x
tool-use multiplier. Prompt caching is the dominant lever, so the trial model
must cache well through our stack. Any per-user cap denominated in tokens must
be in the millions, which is why the design counts runs instead. And the
gateway must do its own usage metering, because harness-side instrumentation
provably drops it for at least one provider.

## 5. Model pricing, provider mechanics, abuse math

Verified prices (per 1M tokens in/out, official pages, 2026-07-23):

| Model | Input | Output | Notes that matter |
|---|---|---|---|
| DeepSeek V4 Flash | $0.14 ($0.0028 cache-hit) | $0.28 | Prepaid wallet, hard stop at zero. `deepseek-chat` alias dies 2026-07-24; thinking mode is on by default and must be disabled. PRC processing is a sales objection for EU-conscious prospects. |
| Groq Llama 3.1 8B | $0.05 | $0.08 | Cheapest, 840 tok/s, but 8B-class quality would make the first session feel bad; false economy. |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | Newer Flash-Lite generations cost 3-6x more. Free tier trains on data (never route users through it). Paid is postpaid: budgets alert, they do not cap. |
| Mistral Small 3.2 | $0.10 | $0.30 | EU vendor; official page omits per-model rates (lower confidence). |
| OpenAI gpt-5.4-nano | $0.20 | $1.25 | Reasoning model; supports effort `none`. Prepaid at low tiers plus project-level **hard spend limits** (enforcement can lag). Auto-recharge is on by default and delayed cutoffs can overdraw, so prepaid is defense-in-depth, not a hard cap. Vendor positions nano for classification-style workloads: agent-chat quality needs testing, not assuming. |
| Claude Haiku 4.5 | $1.00 | $5.00 | 10-20x the alternatives; not the value pick for a trial. |

Abuse math. These models accept up to 1M-token contexts; uncapped, one crafted
DeepSeek message costs $0.14 and a scripted account multiplies that. Capping
output per call bounds almost nothing for an agent, because one user turn can
trigger many large-input calls. The bound has to sit at the request boundary:
per-call input/output caps plus a per-account total budget. With sane caps the
worst case per account lands at cents on the cheap models; the residual risk is
mass fake signups, which is bounded by grant size (cents each) and signup
verification, not by pricing.

**Design consequence.** gpt-5.4-nano and Gemini 2.5 Flash-Lite are the two
candidates (D2 in the RFC), decided by a real tool-using quality test. Provider
spend controls are a backstop only; our own gateway budget enforcement is the
actual bound. The trial provider account must be isolated, hard-capped, and
have auto-recharge disabled.

## 6. Competitor free-tier patterns (anonymized)

Six direct and adjacent competitors were analyzed by their pricing pages, docs,
and community forums. Names are withheld from the repo by policy; the named
notes exist locally.

The pattern among AI-first agent platforms is uniform: **grant a platform-funded
allowance at signup, let the first session run a real agent with zero key setup,
stop or throttle at zero, upsell**. Monthly grants land between a few hundred
and a few thousand credit-units, roughly **$1-5 of model cost per month**. The
two workflow-engine incumbents are the holdouts (bring-your-own-key for all
workflow AI; one offers a token-sized one-time promo credential), and their
time-to-first-agent-magic is documented in reviews as the worse for it.

Denominations cluster three ways: a single abstract credit pool with model-tier
multipliers (simple to show, generates "why did this cost 200 credits" tickets);
two meters splitting platform actions from LLM spend at zero markup (most
honest); and no AI meter at all (the incumbents). Bring-your-own-key semantics
diverge sharply: one platform charges half-credits even on your own key
(documented resentment in its forum), others bypass metering entirely on BYOK,
one has no BYOK at all and sells model choice as a plan feature.

Documented mistakes worth avoiding: hard stops that do not auto-resume after
top-up (a support rage point), hiding the denominator ("3x more usage" with no
numbers; reviews weaponize it), killing a free tier outright (every review
since leads with it), and one-time-only grants as the entire free tier (a cliff
before habit forms; fine as a bonus). One platform runs an earn-credits
onboarding (credits for social follows, a large tutorial-completion reward),
converting free-tier COGS into distribution; nobody else does; it validates the
gamification roadmap.

Nobody publishes abuse handling. The observable mitigations are structural:
small grants, cheap default models, per-account concurrency caps, daily message
caps, no rollover, email-verified signups.

**Design consequence.** Our funnel differs from the credit-sellers in one
decisive way: their credits are the business model; ours end at "connect your
own key", after which usage is unmetered on the user's key. That makes a
one-time grant correct for us where recurring grants are correct for them. The
denominator stays visible ("N free messages left"), exhaustion degrades
gracefully with the draft preserved, and the unit stays legible (a message, not
a token).

## 7. Daytona secret delivery (#5223 / #5277 / #5278)

Today the runner injects resolved provider keys straight into the sandbox
environment (`services/runner/src/engines/sandbox_agent/environment-setup.ts:176`
does `Object.assign(env, plan.secrets)`; `daytona.ts` spreads them into the
Daytona create call). Anything in the sandbox is readable by the user's agent.

PR #5223 (design) and PR #5277 (implementation, flag
`AGENTA_DAYTONA_OPAQUE_SECRETS=process_local`, off by default) change the
delivery: the SDK contract becomes a typed
`modelConnection.credentials[{binding, value, usage}]` where `usage` is
`opaque_http` or `local_use`, classified fail-closed. For `opaque_http`
credentials the runner creates one Daytona organization Secret per binding with
a random name and `hosts: [exactHttpsHost]` (IP literals, wildcards, non-443
ports, and localhost are rejected), and passes only the secret name to the
sandbox. Inside the sandbox the env var holds a `dtn_secret_*` placeholder.
**Daytona's egress proxy substitutes the real value into outbound HTTPS
requests, and only toward the allowlisted host.** No process inside the sandbox
can read the value; that is real possession-hiding, verified in the PR's live
QA. PR #5278 (design only, nothing implemented) proposes a reconciliation
domain so a crashed runner cannot orphan those Daytona Secrets.

What the mechanism cannot do: bound **usage**. The only lever is the
destination hostname. A trial agent could loop
`curl https://api.openai.com/... -H "Authorization: Bearer $KEY"` and the proxy
would happily substitute the platform key: any model on that host, any volume,
outside all Agenta metering, for the sandbox's lifetime (15-minute auto-stop,
30-minute auto-delete, renewable by starting runs). The #5223 design says it
itself: "Move the provider call behind an Agenta gateway. This is the general
solution."

Status: #5277 is deliberately parked (maintainer comment 2026-07-17): the
in-flight runner refactor reshapes the sandbox-provider interface it builds on,
so it will re-land on the new seam. It is currently conflicting with its base.

**Design consequence.** Daytona Secrets solve possession, not usage. Funding a
trial on #5277 alone would hide the key while letting it be spent without
limit; the gateway is still mandatory. But the two compose exactly: the trial
connection's endpoint is the gateway host, the delivered credential is a
short-lived reservation token instead of any provider key, and #5277's typed
contract, host validation, and secret lifecycle carry it. Then even the token
is unreadable inside the sandbox, and a token that leaks anyway buys minutes of
one cheap model inside a metered budget.

## 8. Gateway landscape: adopt or build

Surveyed against five requirements: (R1) validate our reservation-bound opaque
token; (R2) model allowlist; (R3) atomic per-call budget hold settled to actual
usage, hold kept on ambiguous timeout; (R4) transparent streaming pass-through
of the provider's agent API with key injection; (R5) usage records into our
metering.

The decisive finding: **no surveyed system implements R3.** LiteLLM's spend
tracking is post-hoc and batched (concurrent calls can overshoot a small
budget); its custom-auth hook and native Responses API support are real, but it
is a heavy operational dependency (its own Postgres, documented memory-growth
issues, community sizing of 4 vCPU / 8 GB) whose weight buys provider breadth
we do not need. BricksLLM, conceptually closest (TTL keys, budgets enforced via
Redis), is dead: last commit January 2025, before the Responses API existed,
and its budgets are dollar-denominated. Portkey's OSS gateway is light, MIT,
actively maintained, with excellent Responses API pass-through, but it is
deliberately stateless: keys, budgets, and usage logs are the hosted product,
so we would write R1/R2/R3/R5 inside their plugin framework. TensorZero was
archived June 2026. Envoy AI Gateway v1.0 has genuine token-budget primitives
but is a Kubernetes platform (we deploy docker compose on EC2) and its quotas
are windowed buckets, not reservation holds. Kong's equivalent is
enterprise-only; APISIX drags in the nginx+etcd platform. The handful of tiny
OSS "budget proxy" projects validate the hold-estimate/forward/reconcile
pattern but support no Responses API and are not production-grade.

DIY sizing, grounded in the repo: FastAPI, httpx 0.28, and redis are already in
the API's dependency set, with existing Redis locking/caching/throttling
utilities (`api/oss/src/utils/`). The build is one route plus a small ledger:
token lookup (~50 lines), model check (~10), atomic hold via one Redis Lua
script or one conditional Postgres `UPDATE … RETURNING` (~150 plus a
reconciler; ambiguous timeouts keep the hold, and OpenAI's stored responses
allow late settlement via `GET /v1/responses/{id}`), byte-faithful SSE
pass-through that taps the final usage event without re-encoding frames
(~150-250), metering emit (~30). Roughly 600-900 lines plus tests; one to two
engineer-weeks; zero new infrastructure.

**Design consequence.** Build it (D7 in the RFC). Whatever we adopted, we would
still write the hold-and-settle ledger, and the ledger is the asset that
carries into a future paid managed-credits product. If that product later goes
multi-provider, a translation layer (Portkey's OSS gateway is the natural
candidate) slots in behind our ledger.
