# Free trial credits at signup

**Status:** proposal, for review
**Scope:** Agenta cloud only. Self-hosted deployments keep today's behavior.

## Summary and decisions requested

New signups today must paste an LLM provider API key before the playground sends
their first message. This proposal removes that wall: every new cloud organization
gets a small number of free agent runs, funded by an Agenta-owned provider key on
one cheap model. When the free runs are gone, we ask for the user's key at a moment
when the product has already shown its value.

The build reuses the existing entitlements meter for consumption and adds four
pieces: a grant record written at signup, a reservation that authorizes each funded
run, a server-side funding policy that decides which surfaces may reserve, and a
small inference gateway so the provider key never enters user-controlled runtime.
The gateway is the one genuinely new component; it is also the first slice of the
credential-isolation boundary we already designed for secrets generally, and the
substrate a future paid managed-credits product would extend.

Decisions requested from this review:

1. The trial model (D2) and the starting allowance (D3).
2. The grant-record eligibility design (D4) and its signup-only scope (D5).
3. The credential-protection composition (D6): the gateway as the usage bound,
   with the in-flight Daytona secret-delivery work (#5277) as its hardened
   transport, built in-house rather than adopted (D7, sized at one to two
   engineer-weeks).
4. Sign-off on the guardrail set before any platform key goes live.

## The problem and the hypothesis

A new user signs up, lands in the playground, describes the agent they want, and
commits it. At that exact moment the message box grays out, a yellow banner asks
them to connect an API key, and the payoff they just worked for is withheld.

This proposal takes the funnel problem as its premise: the key wall sits directly
on the signup-to-first-message step, and removing it is the motivating goal of
this work. The experiment below measures how much the wall actually costs us
rather than assuming it.

Competitors do not have this wall. The AI-first agent platforms we compete with
fund a new user's first AI usage; a signup runs a real agent without seeing a key
form. Only the older workflow-engine incumbents require your own key. Competitor
names and per-product details are withheld from the repo by policy; the named
research notes are available on request.

**Hypothesis:** letting the first conversation happen before the key ask raises
activation (first successful playground message per signup) without collapsing the
key-connection rate; it moves the wall, it does not remove it.

## Cost envelope and guardrails

We measured production traces on EU cloud (2026-07-23, via
`POST /api/tracing/spans/query`, reading the `ag.metrics.tokens.*` span
attributes). Every agent LLM call carries roughly 23,600 tokens of harness context
(system prompt, skills, tool definitions); the user's words and the model's replies
are noise next to it. A 10-turn session totals about 242K input tokens and 1.2K
output tokens. Caveats: the sample was small (8 agent traces from our own team
project; API keys are project-scoped, so organic cross-tenant data needs database
access), and the sampled turns made one LLM call each, so sessions with heavy tool
use will run 2-3x higher.

Cost per 10-turn session at July 2026 list prices:

| Model | No caching | With prompt caching |
|---|---|---|
| Gemini 2.5 Flash-Lite | $0.025 | $0.004 |
| DeepSeek V4 Flash | $0.034 | $0.005 |
| OpenAI gpt-5.4-nano | $0.050 | $0.009 |
| Claude Haiku 4.5 | $0.248 | ~$0.05 (verified against a real bill) |

At 10,000 signups on gpt-5.4-nano this is roughly $500 without caching and under
$100 with caching, against a $3,000 budget. Prompt caching is the largest cost
lever because our workload replays a large stable prefix on every call.

The budget survives honest users easily; the guardrails exist for dishonest ones.
An agent run is a loop: one user message can trigger many model calls with large
inputs, and the agent's instructions and tools are user-controlled. The guardrails,
all enforced server-side:

- **The provider key never enters user-controlled runtime.** Agent runs execute in
  a sandbox the user's instructions effectively control; a raw key placed there can
  be extracted and reused outside every other control. Funded runs therefore talk
  to an Agenta inference gateway with a short-lived token instead of a key
  (architecture below). This is the load-bearing guardrail; the rest assume it.
- **Per-call and per-run budgets at the request boundary.** The gateway enforces
  the model allowlist, a max output size per call, and the reservation's call and
  token budgets before forwarding anything to the provider. Enforcement after the
  fact cannot cap an oversized first call; enforcement at the request boundary can.
  The runner's existing wall-clock limit stays as the outer bound.
- **Reservation before spend:** no reservation, no gateway token, no funded run.
- **Isolated provider project:** the trial key lives in its own provider project
  with a hard project-level spend limit (OpenAI supports these; enforcement can lag
  slightly), auto-recharge disabled, budget alerts, and easy revocation.
- **Kill switch:** a backend flag that marks managed funding unavailable; the
  frontend reads it and falls back to today's connect-a-key behavior. Deleting the
  env key is not the mechanism, because the frontend would still show credit and
  then fail mid-run.

Mass fake signups remain bounded by the grant size (cents per org), signup-only
eligibility (D5), and existing email verification; we accept that residual risk for
the MVP.

## The user experience

Vocabulary for this section: the **composer** is the playground's message input
box; the **vault** is the per-project store of the user's own provider API keys.

### First session (free runs remaining)

Signup and onboarding stay exactly as they are. The one change: when the user
commits their agent, the composer stays enabled and their first message sends. The
run is funded by Agenta on the trial model. The payoff arrives on message one.

After the first response, a quiet balance badge appears near the composer: "29 free
messages left". It exists so the later wall is expected rather than sudden. The
Billing settings page shows the same balance through its existing usage meters.

Model choice during the trial: the model picker stays visible, but models other
than the trial model show their normal "connect a key" affordance. Funded runs
never execute on any other model, and the gateway enforces that, not the picker.

We also fix a related inconsistency: the template setup drawer currently labels
Agenta-managed models "Ready", promising platform keys the runtime does not
provide. After this change the label becomes true for the trial model.

### The wall (free runs exhausted)

When the balance reaches zero, the next send is refused before any model call. The
existing yellow banner slot shows: "You've used your free messages. Connect your
API key to keep going, it takes a minute." with the same button that opens the
provider-credentials drawer. The user's typed message must survive this refusal and
send automatically once a key is connected. The playground has a similar
connect-then-send behavior today, but only for the seeded first message; a refused
arbitrary draft currently becomes a transcript error, so retaining and resuming it
is new frontend state, called out in the plan below.

Users who connected a key never see any of this: their runs resolve their own vault
key and consume nothing.

### Frontend states

The gate today is one boolean (vault empty). It becomes a small state machine with
explicit states: loading, user key available, funded run available, allowance
exhausted, funding unavailable (kill switch or outage), and selected model not
funded. Two rules keep it honest: the server's reservation outcome is the authority
on whether a run proceeds and on the remaining balance (the polled usage query is
display-only and can be minutes stale), and a failed or loading balance query must
never be rendered as "you have zero left".

## Architecture

### Where credentials come from today, and what we do not build on

Agent playground runs resolve credentials through `resolve_connection`
(`services/oss/src/agent/app.py`, `sdks/python/agenta/sdk/agents/platform/`): given
the selected model, the resolver fetches the project's vault secrets and picks the
one matching connection. When no connection exists, vault-backed resolution fails
with a typed error (default and self-managed modes instead degrade to
runtime-provided credentials); for a keyless new user on a standard provider, that
failure is today's wall. The resolved credential then travels into the run as
environment variables, which is fine for the user's own key and is exactly what the
gateway exists to avoid for ours.

An older, model-blind path in the SDK's vault middleware can fall back to provider
keys taken from the service environment. It is a leftover of PR #2957, which built
a first version of platform-funded usage with a `credits_consumed` meter; the agent
service explicitly abandoned that path, its metering call is orphaned, and only
legacy completion workflows still traverse it. This proposal does not build on it.
We reuse its meter machinery for consumption accounting, and we schedule one
hygiene task (out of scope here): audit the cloud service environment for stray
provider keys, since any that exist make legacy-path runs free and unmetered today.

### In-flight work this composes with: Daytona secret delivery

Three open PRs already attack the "secrets inside the sandbox" problem and shape
this design. PR #5223 plans, and PR #5277 implements (flag-gated, currently parked
until the runner refactor reshapes the sandbox-provider interface it builds on),
delivery of credentials through Daytona Secrets: the sandbox environment holds
only an opaque placeholder, and Daytona's egress proxy substitutes the real value
into outbound HTTPS requests, but only toward the credential's allowlisted
hostname. PR #5278 proposes (design only, nothing implemented yet) a
reconciliation domain so crashed runners cannot orphan those Daytona Secret
bundles. Together this gives true possession-hiding: no process inside the
sandbox can read the value.

What it deliberately does not give is usage control. The only lever is the
destination hostname, so a delivered provider key could still be spent without
limit against the provider's own host: any model, any volume, outside our
metering, for the sandbox's lifetime. Its own design doc names the general
solution: move the provider call behind an Agenta gateway. That division of labor
drives D6 below, and this proposal reuses the #5277 machinery wholesale where it
fits: the typed credential contract with fail-closed classification, the exact-
hostname validation, and the per-sandbox secret lease lifecycle. Expired trial
reservations are cleaned by the reservation service's own sweep, described
above; they do not ride #5278's Daytona-scoped reconciliation.

### The four pieces

**1. Grant record (eligibility).** When a user signs up, their newly provisioned
personal organization gets an immutable grant row: amount, granted-at, and a
stable campaign identifier (not descriptive prose), with a uniqueness constraint
on (organization, campaign) so a retried signup hook cannot grant twice. No grant, no free runs, which cleanly
excludes every existing organization (a plan-level quota alone would gift the full
allowance to all of them the day we ship). Organizations created later by an
existing user get no grant; that closes the create-orgs-to-farm-credits hole.
The balance is never stored: remaining = grant total minus the consumption meter.
Later gamification ("connect GitHub, earn more runs") and sales promos become
additional grant rows with their own reasons; nothing else changes.

**2. Reservation (authorization and spend).** A durable record with an explicit
lifecycle: `reserved → started → charged`, or `reserved → refunded`, or
`reserved → expired` for runs that never start, with a reconciliation sweep for
abandoned rows. It is created server-side (not by the frontend), keyed uniquely by
a server-minted invocation identity (below) so retries cannot double-charge, and
bound to the server-authenticated organization, project, and model. One
reservation authorizes exactly one run. The economic invariant: the reservation's
state transition and the consumption-counter change commit in **one database
transaction**, so no crash window can charge twice, charge without counting, or
refund twice; a retried handler lands on the same transition. Consumption uses a
new dedicated lifetime meter (working name `trial_runs_consumed`); the monthly
`credits_consumed` quota, the plan catalog, and the billing projection stay
untouched. The exact sequence: the strict conditional increment and the
reservation's authorizing transition commit in the same transaction, and only
after that commit does the gateway mint a token; the gateway rejects tokens for
any reservation that has not completed it. A refund pairs the terminal transition
with the decrement in the same way. This needs one named refactor: the meter DAO
currently opens and commits its own session, so it must learn to join a
caller-owned transaction (or the conditional upsert moves into the reservation
repository). The reservation service supplies the grant-derived total as the
meter's strict limit, and it fails closed on any infrastructure error, a
deliberate deviation from the entitlements house pattern (feature gates fail
open; spending our money must not). Charge policy: the committed reservation is
the charge; it is refunded if the run dies before its first model call and kept
for anything after.

**3. Funding policy and provenance (which surfaces may reserve).** Today
interactive playground runs, direct API calls, and evaluations converge on the
same workflow invocation path, and wire metadata is caller-controlled, so the
funding decision cannot rest on anything the client sends. Instead, the API
orchestration layer, at the point where it still knows how the run was invoked,
mints a short-lived signed invocation-purpose claim bound to organization,
project, and a fresh idempotency identity. Only interactive playground and direct
invoke acceptance mint the claim; evaluation, batch, and background paths never
do. The reservation service accepts only this claim, which also supplies the
reservation's unique key (the runner's own turn identifier is created too late to
serve). Request metadata can never turn funding on.

**4. Inference gateway (the trust boundary).** Funded runs receive no provider
key. The resolver returns a connection whose endpoint is an Agenta gateway URL and
whose credential is an opaque, short-lived, single-reservation token bound to
organization, model, request count, token budget, and expiry. The gateway holds
the real provider key, validates the token, canonicalizes the request (allowed
parameters only, intended provider retention settings forced, expired tokens
refused), enforces the model allowlist, and applies budgets at the request
boundary: each provider call takes an atomic hold against the reservation's
remaining budget before it is forwarded and settles to actual usage after, so
concurrent calls cannot overrun the budget between a check and a decrement. A
token allows several provider calls within its budgets, so replay protection is
per call (a call identity plus a canonical request hash), not per token; a call
that times out ambiguously keeps its hold until reconciliation, so a duplicate
retry cannot be funded twice. Extracting the token from the sandbox yields
minutes of access to one cheap model inside one already-metered budget, instead
of an open provider key. Scope for the MVP: one provider, one model, one API
surface, and we choose the provider's agent-native API as that surface (for
OpenAI, the Responses API), because our runs are tool-using and that is the
protocol the vendor builds agent features on; the pre-launch check below
verifies tool calling end to end rather than trusting either API's
documentation. The runner side needs one contract addition, not new key trust:
the platform-resolved connection must carry an explicit API-dialect field, since
the runner's custom-provider path currently assumes and emits only the
chat-completions dialect and would otherwise call the wrong API through the
gateway.
This is deliberately the smallest version of the credential-isolation gateway
already designed for the secrets roadmap, and the same chokepoint gives us trial
usage metering that does not depend on harness-side instrumentation. Delivery
composes with the Daytona secret work above: the trial connection's endpoint is
the gateway host, and the reservation token rides the #5277 delivery path as an
ordinary opaque credential once that path re-lands on the refactored provider
interface, so even the token is unreadable inside the sandbox (D6).

### Surface matrix

| Surface | Trial behavior |
|---|---|
| Agent playground (cloud) | Funded: reservation on the invoke path + gateway token |
| Direct agent API calls (invoke path) | Same as the playground; reservations and rate limits apply |
| Evaluations, batch, background runs | Never funded; user keys only (funding policy) |
| Classic prompt playground | Not funded in MVP; different credential path, near-zero message cost, not the activation surface |
| OSS / self-hosted | No grants, no gateway; resolver behavior unchanged |

The grant, reservation, policy, and gateway are cloud-only, behind the established
`is_ee()` seams. The SDK and agent-service touchpoints are shared code that no-ops
when the backend issues no grants.

### Deployment notes

The consumption counter needs the Python enums, a Postgres enum-value migration,
and usage-API surfacing, deployed migration-first. The grant and reservation
tables are new and small. The gateway is a new small service (or route on an
existing one) holding the only copy of the trial key. The runner needs no trust
changes; its wall-clock limit stays.

## Decisions

### D1: What is the unit?

- **Option A: one unit = one accepted agent run** (one user turn, however many
  model calls it makes inside its budgets). Legible in product copy, maps
  one-to-one to reservations, and the cost variance between cheap and expensive
  turns is bounded by the per-run budgets and small in dollars.
- **Option B: token-denominated credits.** Precise, but meaningless to a new user,
  and the 23.6K harness context makes even "hi" cost thousands.

**Recommendation: A.** Call them "free messages" in product copy for the MVP. We
adopt the word "credits" product-wide only when the unit becomes fungible (earned,
purchased, model-tiered), which is the roadmap but not this build.

### D2: Which model funds the trial?

- **Option A: OpenAI gpt-5.4-nano.** Hard project-level spend limits on the
  provider side, strong prompt caching, a brand new users recognize so demo
  quality is attributed correctly. ~$0.05 per session uncached. Reasoning effort
  `none`.
- **Option B: Gemini 2.5 Flash-Lite.** Half the cost, fast, but postpaid billing
  with alert-only budgets, so runaway spend depends entirely on our gateway.
- **Option C: DeepSeek V4 Flash.** Cheapest with prepaid billing, but routing
  every signup's first prompt through a China-hosted API is an avoidable objection
  for GDPR-conscious European prospects.

**Recommendation: A, conditional on a quality check.** Price and brand argue for
nano, but its vendor positions it for classification-style workloads, not agent
chat, and the first session must feel good, not just cost little. Before launch,
run our agent harness over a handful of representative activation sessions on nano
and Flash-Lite, including real tool use, and pick on quality-per-dollar. Sequence
matters: the candidates are compared directly against the provider APIs first, and
the production gateway is then built for the winner only, so the one-provider MVP
scope holds and we never build a throwaway adapter. "Model-agnostic" applies to
the grant, reservation, and policy pieces; the gateway itself is
provider-specific work.

### D3: How large is the grant?

- **Option A: one-time grant, sized around 30 runs.** Covers the measured
  activation session (~10 turns) three times over at an expected $0.05-0.15 per
  active user. One-time fits our funnel: unlike competitors who sell credits as
  the business model, ours exist only to carry users to connecting their own key,
  after which usage is unmetered on their key.
- **Option B: monthly recurring grant.** What most competitors do, but they
  monetize credits forever; for us it reopens abuse monthly and makes the meter a
  permanent product surface.

**Recommendation: A, with the amount as an experiment parameter, not a constant.**
The grant record carries the amount per cohort, so we can ship cohorts at 20 and
50 and let the funnel data pick. Thirty is a starting point, not a finding.

### D4: How is eligibility stored?

- **Option A: plan-level constant.** Simplest, but wrong: lifetime quotas on a
  plan grant the full allowance to every existing organization, there is no
  cohorting, and no per-org grants later.
- **Option B: mutable per-org balance column.** Supports variable grants but
  creates a second writable source of truth beside the meter.
- **Option C: immutable grant record plus the existing consumption meter.** Grants
  are append-only rows with amount and reason; the meter stays the only thing that
  moves; remaining is computed. New-orgs-only falls out naturally, as do cohorts,
  promo grants, and the gamification seam.

**Recommendation: C.**

### D5: Who is eligible?

- **Option A: the personal organization provisioned at signup, only.** Matches the
  goal (activation of new users), keeps grant issuance on the one code path that
  runs exactly once per signup, and closes the farming hole of creating
  organizations for fresh grants. Accepted consequence: an invited teammate joins
  an org whose balance may be exhausted, which is fine because such orgs usually
  have keys already.
- **Option B: every newly created organization.** Simpler to state, but the
  signup and explicit organization-creation provisioning paths are distinct in the
  backend, and funding the latter invites farming.

**Recommendation: A.** Org-scoped accounting (the grain of plans, subscriptions,
and every existing quota), granted only at signup.

### D6: How is the platform credential protected?

- **Option A: Daytona Secrets alone (the #5277 path).** The provider key is
  delivered as an opaque placeholder that only Daytona's egress proxy resolves,
  toward the provider's host. Kills key theft with work that is already built and
  QA'd, but leaves usage unbounded: the sandbox can spend the key freely against
  the provider host, unmetered, while it lives. Also covers only Daytona runs.
- **Option B: inference gateway alone.** The sandbox receives a short-lived
  reservation-bound token; the gateway holds the key and enforces model, budgets,
  and metering. Bounds usage on every execution path, but the token sits readable
  in the sandbox environment for its lifetime.
- **Option C: composed.** The gateway is the connection's endpoint; the
  reservation token is the delivered credential and rides the Daytona Secrets
  path where available. Theft of the token requires beating Daytona's egress
  proxy, and even then yields minutes of one cheap model inside a metered budget.

**Recommendation: C**, built in that order: the gateway is the piece the trial
cannot ship without (it is the only usage bound), and the Daytona delivery
hardens it when #5277 re-lands on the refactored provider interface. Option A
alone is not safe for a platform-funded key.

### D7: Build the gateway or adopt one?

We surveyed the July 2026 landscape (LiteLLM proxy, BricksLLM, Portkey's
open-source gateway, TensorZero, Envoy AI Gateway, Kong, APISIX, and the small
budget-proxy projects). The decisive finding: none implements our hard
requirement, the reservation-bound atomic hold-and-settle. LiteLLM records spend
asynchronously after calls, so concurrent requests can overshoot a small budget;
the Kubernetes-native gateways do windowed rate buckets, not reservation ledgers;
the closest conceptual match has been unmaintained for 18 months and predates the
Responses API. Whatever we adopt, we write the ledger ourselves.

- **Option A: adopt LiteLLM.** Buys provider breadth and pass-through we don't
  need, costs a second Postgres-backed service with documented memory-growth
  issues, and the ledger still gets written by us inside its hook system.
- **Option B: build small.** One FastAPI route in the existing stack: token
  lookup, model check, atomic hold via one Redis script or one conditional
  Postgres update, byte-faithful streaming pass-through that taps the final
  usage event, metering emit, plus a hold reconciler. Roughly 600-900 lines and
  one to two engineer-weeks; no new infrastructure, since the stack already runs
  Redis and Postgres.

**Recommendation: B.** The ledger is also the piece that carries into the future
managed-credits product (a trial reservation generalizes to a purchased balance),
and it should live in our code as the budget authority regardless. If that
product later goes multi-provider, a translation layer (Portkey's MIT gateway is
the natural candidate) slots in behind our ledger without rework.

## Rollout and measurement

Gate the whole feature on the backend funding flag plus the presence of grants;
no cohort, no change from today. Ship to a percentage of new signups first, watch
spend per signup against the measured envelope, then widen.

Success metrics: activation rate (first successful playground message per signup),
key-connection rate within 7 days, and platform spend per signup. Kill criteria:
spend per signup exceeding 3x the envelope, or key-connection collapsing while
activation merely shifts messages onto our key.

Prerequisite fix: agent runs routed through OpenRouter record no token usage in
our tracing (`ag.metrics` and `gen_ai.usage` both empty). The gateway meters trial
usage regardless, but the instrumentation gap blinds our observability for
everything else and should be filed and fixed independently.

## Out of scope, deliberately

- **Earned credits (gamification).** One competitor pays out credits for social
  follows and for finishing its tutorial, and it visibly works for them. It lands
  here as new grant rows with new reasons, once the MVP proves the funnel.
- **Purchasable managed credits.** Reselling metered inference makes credits a
  product with billing and margins; the grant, reservation, and gateway substrate
  built here is what it would extend.
- **Funding the classic prompt playground.** Different credential path, near-zero
  cost per message, not where activation happens. Revisit only if data says
  otherwise.
- **Legacy-path hygiene.** Audit the cloud service environment for stray provider
  keys and remove the orphaned metering call in the vault middleware, tracked
  separately so this feature does not wait on it.

## Appendix: research this proposal rests on

- **UX map of the current gate** (frontend): the composer disables while the
  project vault is empty; the banner and the connect-then-send machinery live in
  the agent playground's conversation components.
- **Prior art** (backend): PR #2957 built platform keys plus credit metering on
  the legacy path; the SDK-side gate call was severed in a later refactor; the
  entitlements meter machinery survives and is reused here.
- **Entitlements deep dive**: the meter engine supports lifetime counters, atomic
  strict enforcement, and refund deltas; the billing UI already renders any
  counter the usage API reports.
- **Pricing research** (July 2026): per-token list prices for the candidate
  models, provider billing semantics, and competitor free-tier structures. The
  AI-first competitors grant on the order of hundreds to a few thousand
  credit-units per month (roughly $1-5 of model cost), several with earn-more
  actions or user-set spend caps; the workflow-engine incumbents fund nothing.
  Named competitor details stay out of the repo by policy; ask for the local
  research notes.
- **Trace measurement** (EU cloud, 2026-07-23): the 23.6K harness context and
  session token totals, reproducible against `POST /api/tracing/spans/query`
  filtering agent-run spans and reading `ag.metrics.tokens.*`; also the source of
  the OpenRouter usage-recording gap.
