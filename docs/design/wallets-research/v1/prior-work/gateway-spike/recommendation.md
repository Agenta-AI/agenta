# Recommendation: rent the enforcement, build the allowance system

Read this first. `findings.md`, `repo-findings.md`, and `openrouter-api-facts.md` carry the
evidence. `open-questions.md` carries the seven decisions that are yours.

---

## The call

**Fund the activation trial with one capped OpenRouter key per organization. Give it a hard
dollar cap, no reset, an expiry that matches the advertised trial window, and a model
allowlist. Do not build a gateway for this experiment. Do build the activation grant, the
allowance counter, and the frontend state machine, because those are reusable and none of them
is thrown away later.**

The shape of it: our backend mints one OpenRouter key when an organization starts its first
funded run. Our own counter tracks the 30 free messages and is what the user sees. OpenRouter's
dollar cap is the financial backstop that holds even if our counter is bypassed. The trial
connection reaches the run through a route that mostly exists already, plus one small runner
contract change described below.

This answers Mahmoud's condition directly. The first version is simple, because it adds no new
service and no new infrastructure. It is expandable in the specific sense that matters: the
eligibility record, the allowance accounting, the exhaustion experience, and the funded-run
decision point are all needed by the long-run system too.

**One honest limit on the word "expandable".** This builds an activation allowance system, not
the purchasable-credit ledger. A message counter is not a money balance. Purchased credits need
payment provenance, debits, holds, settlement, refunds, and expiry, and none of that follows
from counting messages. What version one buys is that the long-run ledger slots in behind
seams that already exist, instead of being invented alongside a new product surface.

---

## The three facts that decide it

**1. The route mostly exists, and it pins the model. One small gap has to be closed.** A vault
`custom_provider` record with `kind="custom"` and `url="https://openrouter.ai/api/v1"` resolves
to `provider=openai, deployment=custom`, and the runner then writes a per-run `models.json`
with our base URL and forces the model string to the single model we named
(`services/runner/src/engines/sandbox_agent/environment.ts:1032`). No new dialect field, no new
base URL mechanism. It is exercised by QA cell P2 and pinned by a replay test. Full detail in
`repo-findings.md`.

**The gap, found in review and worth stating loudly.** That route is reachable only when the
agent's own configuration names a custom connection by slug. The trial case is the opposite: a
brand new user's default agent, with an empty vault. For a default connection the SDK omits the
`connection` object from the wire entirely
(`sdks/python/agenta/sdk/agents/dtos.py:826-835`, "the project default is `agenta` with no slug
and carries no info beyond the model, so it is omitted"), and
`ResolvedConnection.to_wire()` emits provider, model, deployment, credential mode, and endpoint
but no slug. The runner's builder then declines, because it requires
`request.connection.mode === "agenta"` with a slug
(`services/runner/src/engines/sandbox_agent/pi-model-config.ts:89-97`, pinned by
`services/runner/tests/unit/sandbox-agent-pi-model-config.test.ts:119` which asserts no plan
when `connection` is undefined). With no plan, the run falls back to the default provider and
would call api.openai.com with our OpenRouter key, which fails.

So version one does need one contract change: a reserved connection identity that a
platform-funded `ResolvedConnection` can carry onto the wire, so the existing builder fires. It
is small, it is one file on each side plus a test, and it is exactly the kind of thing that
must be proved with an end-to-end run before anything else is built. It does not change the
recommendation. It does change the claim that nothing in the runner has to move.

**A second limit from the same code.** This route works for the Pi harness only. The builder
returns no plan for a Claude request
(`services/runner/tests/unit/sandbox-agent-pi-model-config.test.ts:73`). So a funded trial can
be offered on Pi agents and not on Claude agents. Confirm the onboarding default agent is Pi
before promising a number to anyone.

Even with those two corrections, the original proposal's biggest runner worry still
disappears. It assumed a new API-dialect field, because its gateway would speak the OpenAI
Responses API and the runner speaks only chat completions. OpenRouter speaks chat completions.

Pi's own `models.json` schema goes further than we currently use. Its `compat` block accepts
`openRouterRouting`, which Pi sends verbatim as the `provider` field of the OpenRouter
request, and `cost` per model in dollars per million tokens, and Anthropic-style cache control
for OpenAI-compatible endpoints. Pi's documentation uses OpenRouter as its worked example. Our
runner emits none of it today, and adding it is a contained change in one file. So the levers
for cache stickiness and for real per-run cost are already designed; we just have not wired
them. See `findings.md`.

**2. The dollar cap is a real, server-side bound, and it is cheap enough to be the ceiling.**
OpenRouter enforces `limit` on its side, `limit_reset: null` makes it a lifetime cap, and
`expires_at` expires the key without us running anything. A 30-message trial on a nano-class
model costs about four cents with caching and about twelve cents with no caching at all and
three LLM calls per message. So a $0.30 cap covers the full trial with headroom, and it is
also the absolute worst case per signup. Ten thousand signups is a $3,000 ceiling and a
realistic bill closer to $400.

**3. Most of what we build for this is reusable.** The activation grant, the allowance
counter, the balance the user sees, the exhaustion experience, and the funded-run decision at
request acceptance are all needed whether the money is enforced by OpenRouter or by a gateway
we write. The part that is specific to OpenRouter is a credential issuer and a cleanup sweep,
a few hundred lines behind one interface. What version one does **not** build, and what the
long-run system still needs, is the ledger: debits with idempotency, holds, settlement,
refunds, and payment provenance.

---

## The smallest first version

Seven pieces. Most of this work is the same in every option, including the gateway option.
What OpenRouter removes is the gateway itself.

**1. The activation grant.** One append-only row per organization at signup: organization,
amount, granted-at, campaign identifier, unique on (organization, campaign). This is
eligibility. It is also the rollout gate, because no grant means no trial, so shipping to ten
percent of signups is just granting to ten percent. Roughly two days.

Two tenancy rules that must be written down, not assumed. The grant goes to the personal
organization created by the **signup** path only, which the backend can tell apart from
explicit organization creation (`api/oss/src/services/commoners.py:252` and the separate path
at `api/ee/src/core/organizations/service.py:931`), so nobody farms fresh grants by making
organizations. And the balance is shared by every project and every member of that
organization, while a user's own key is looked up per project. Say both out loud in the spec.

**2. The allowance counter.** A new non-periodic counter (`period=None`) on the existing EE
entitlements engine (`api/ee/src/core/meters/`). The engine's `adjust` is a single conditional
upsert, so the limit check happens in SQL. Do not reuse `credits_consumed`, which is monthly
and would silently refill the trial every month. Balance is computed as grant minus counter,
never stored. Roughly one day.

Two known sharp edges. The generic entitlements wrapper **fails open** on infrastructure
errors (`api/ee/src/core/access/entitlements/service.py:302-314`), which is right for feature
gates and wrong for spending money, so the trial path must be a deliberate fail-closed
deviation. And the wrapper reads quotas from the subscription plan, not from a grant row, so
the trial's limit has to be passed in rather than looked up.

**3. Funded-run authorization at request acceptance.** This is the piece I originally wanted to
defer, and it should not be. Every surface converges on the workflow service's `/invoke`: the
playground posts there directly, and evaluations, triggers, detached jobs, session resumes, and
nested workflow runs all reach the same endpoint through
`api/oss/src/core/workflows/service.py`. Client-supplied `meta.run_kind` is read after
connection resolution and is forgeable, so it cannot be the signal.

The minimal honest version is not the full signed claim from the original proposal. It is: at
authenticated `/invoke` acceptance, establish the organization, decide funded or not, consume
one allowance fail-closed against a unique invocation id so a retry is idempotent, and pass a
trusted funded flag down into resolution. Roughly three days, and it is the piece the gateway
version needs anyway. Skipping it means an evaluation or a trigger can silently drain a user's
trial and a retry can double-charge it.

**4. The trial credential lease.** A record separate from the grant, one active lease per
(organization, campaign), enforced by a unique constraint so two simultaneous first runs cannot
mint two keys. It holds the OpenRouter key hash, the key value encrypted with the platform's
own data-encryption key, the expiry, the guardrail id, and a state.

The plaintext key comes back exactly once and cannot be read again, so it must be stored, not
just hashed. The `api/oss/src/core/secrets/` domain already has the encryption context to do it
outside the user's vault.

Issue order matters: mint, then attach the guardrail, then mark the lease usable. A guardrail
attach that fails after minting must revoke the key rather than release an unrestricted one.

Plus a daily sweep that lists keys and deletes expired ones, and a bulk revoke that walks
active leases and deletes their keys. Roughly three days.

**Set `expires_at` to the end of the advertised trial window, not 24 hours.** A 24-hour key
against a 30-message allowance creates a conflict nobody has defined: what happens when the key
dies with 20 messages left. Either the trial silently ends early, or we mint a replacement and
hand out a second full dollar cap. Making the window the product promise ("30 messages within
seven days") removes the question. One key, one cap, one window.

**5. Materialize the funded connection in the resolver.** `resolve_connection` is a swappable
field on the agent service's composition (`services/oss/src/agent/app.py:101`), and resolution
runs **in our service**, not in the sandbox. Its job here is narrow and it should stay narrow:
given an already-authorized funded run, return a `ResolvedConnection` pointing at OpenRouter
with the leased key and the reserved connection identity from fact 1. Authorization and
counting do not belong here, because `RuntimeAuthContext` carries only harness and backend
(`sdks/python/agenta/sdk/agents/connections/models.py:213`) and the resolver runs after tool and
MCP resolution. A user's own project key still wins. Roughly one day, plus the runner contract
change and its end-to-end test.

**Do not write the trial key into the user's project vault.** Three reasons, in order of how
badly each one bites.

1. It makes `vaultEmpty` false, which permanently suppresses the connect-a-key banner
   (`web/oss/src/components/AgentChatSlice/hooks/useAgentModelKeyStatus.ts:67,96`). The user
   would hit an exhausted trial with no guidance at all.
2. It is readable by the user over the normal secrets API. `VaultService.list_secrets`
   decrypts and returns values with no masking (`api/oss/src/core/secrets/services.py:74`).
3. Vault secrets are scoped to a project, but the grant is scoped to an organization. A user
   who creates a second project would find the trial missing there, or we would have to mint a
   second key for the same grant. Resolving at the org level avoids the whole question.

**6. The frontend state machine.** The single boolean gate becomes: loading, user key
available, trial available with a countdown, trial exhausted, trial unavailable. Two rules
that are easy to get wrong: a failed balance query renders as unknown and never as zero, and
the countdown appears after the first response rather than before the first send. On
exhaustion, refuse the send before any model call, show the connect-a-key message, and retain
the typed draft. Roughly three to four days.

**7. Rollout controls.** A percentage rollout falls out of the grant, because no grant means no
trial. Three more controls are not optional, and they were missing from my first draft:

- **A cohort spend ceiling.** Per-key caps bound one signup. Nothing bounds ten thousand fake
  signups in a night. A daily issuance throttle and a total spend alarm on the OpenRouter
  account are the bound.
- **A real kill switch.** Stopping new grants does not touch a key someone already read out of
  a sandbox. A kill switch that means anything walks the active leases and deletes those keys
  at OpenRouter. Without that, do not call the rollout reversible.
- **Lifecycle telemetry.** Mint, guardrail attach, and revoke latency and failure counts;
  duplicate or orphaned keys; provider 401, 402, 403, and 429 rates; and OpenRouter spend
  against accepted messages. Without this we cannot tell a working trial from a leaking one.

Roughly two days.

Call it two and a half weeks for one engineer including tests and QA. The gateway option is
this same work **plus** the gateway.

---

## What it costs to run

- About $0.04 per completed trial on a nano-class model with caching, and about $0.12 with no
  caching at all. Add 5.5% for OpenRouter's credit top-up fee. There is no markup on
  inference itself.
- A hard ceiling of the cap times the number of grants. At $0.30 and 10,000 signups that is
  $3,000, which is the budget the original proposal set.
- One OpenRouter account to fund and watch. A negative balance returns 402 for every key, so
  a balance alert is not optional.

---

## Gaps we accept in version one

Naming them here so nobody discovers them in review and thinks they were missed.

**Nothing counts an agent run today.** The meter counters are `evaluations_run`,
`traces_ingested`, `traces_retrieved`, `credits_consumed`, `events_ingested`, and
`records_ingested` (`api/ee/src/core/access/entitlements/types.py:52-61`). None of them counts
a message. Version one adds that increment, at `/invoke` acceptance, before the run starts.
That is the piece that makes "30 free messages" a real number.

**Concurrency is mostly handled, and not entirely.** The meter's conditional upsert is atomic
in SQL, so two legitimate calls cannot both take the last slot. Three things still need care.
The entitlements wrapper fails open on infrastructure errors, so the trial path has to fail
closed instead. Without an invocation id, a retried submission consumes two messages. And the
meter DAO commits its own transaction, so allowance consumption cannot yet be committed
atomically with a lease state change; either the DAO learns to join a caller-owned session or
the two are ordered so the failure mode is a wasted message rather than a free one.

**One message can burn the whole cap.** Nothing limits input or output tokens on a single run,
and an agent turn can carry a very large context. A per-run token ceiling is the missing bound.
On a nano-class model the cap absorbs it; on anything more expensive it does not.

**Per-run cost is not in our traces.** Tokens are, cost is not. The backend already computes
cost from tokens for the classic playground and would do the same for agent runs, except the
agent tracers never stamp the span type or the model name the calculator looks for. Until that
is fixed, OpenRouter's own per-key ledger is the authoritative spend number. `findings.md` has
the detail; the fix is small and worth doing regardless of this project.

**The trial key is spendable outside Agenta for its lifetime.** Bounded by the cap, the model
allowlist, and the trial window. This is the risk-acceptance call in question 2 of
`open-questions.md`, and it is the one that goes away when Daytona Secrets (#5277) re-lands.

**The trial is Pi only.** The runner's custom-provider path declines Claude runs. If a user
switches their agent to Claude, the trial does not fund it and they see the normal key wall.

---

## What carries into the long-run system, and what we throw away

Mahmoud's long-run system is our own gateway, a credit ledger, and purchasable credits.

**Carries over:**

| Piece | Why it is the same later |
|---|---|
| The activation grant | Eligibility and amount are provider-agnostic. Promotional and earned allowances become more grant rows with different campaigns |
| The allowance counter and computed balance | The unit the user sees does not change when the enforcement moves |
| Funded-run authorization at `/invoke` acceptance, with an invocation id | This is where the gateway's reservation is taken later. Building it now means the gateway extends a decision point rather than inventing one |
| The frontend state machine, countdown, exhaustion, draft retention | Identical whichever backend funds the run |
| Materialization in `resolve_connection` | "This run is funded, so return a platform connection." Only the endpoint and the credential change |
| The reserved connection identity and the runner contract change | Needed by our own gateway too, for the same reason |
| The dedicated, hard-capped provider account with auto-recharge off | Same operational posture |

**Thrown away:**

| Piece | Size |
|---|---|
| The OpenRouter credential issuer | A few hundred lines behind one interface |
| The orphan sweep and bulk revoke | Small, and only exists because the keys are theirs |
| The guardrail wiring | A single setup call |

**Not built in version one, and still needed later:** the gateway route itself, the ledger
with debits, holds, settlement, refunds and a reconciler, byte-faithful SSE pass-through, usage
metering at the chokepoint, and payments. That is the real remaining work, and version one does
not reduce it.

### The honest part

"We can swap the endpoint from openrouter.ai to our own gateway later" is true about the
transport and misleading about the effort.

**The transport swap is nearly free, once the reserved connection identity exists.** The runner
reads the base URL from a per-run wire field (`services/runner/src/protocol.ts:486`). Pointing
runs at our own host is a change to two values in a resolved connection. It is not free today,
because the wire carries no connection slug for a default agent, which is the contract change
described in fact 1. Version one pays that once and the gateway version inherits it.

**It is misleading if it is read as "the gateway is nearly done".** The gateway is not the
endpoint. The gateway is the ledger: an atomic hold taken before forwarding, settled against
real usage afterwards, with a hold kept on an ambiguous timeout so a retry cannot be funded
twice. Nothing in version one builds any of that.

**And a message counter is not a money balance.** Purchased credits need payment provenance,
credit lots or balance transactions, debits, holds, settlement, refunds, expiry, and pricing
units. None of that follows from counting messages, and pretending otherwise would produce
historical allowance data with no debit records that a real ledger would have to reconcile
against later.

So the accurate summary is: **version one rents provider enforcement and builds the activation
allowance system, which is the eligibility record, the counting, the authorization point, and
the user experience. It does not build the credit ledger. What it buys the ledger is that every
seam the ledger needs already exists and is already exercised.**

Two shapes to avoid, because they would make the ledger harder rather than easier: putting
OpenRouter key fields directly on the grant row, which couples eligibility to one provider, and
letting `resolve_connection` own authorization and counting, which the gateway would then have
to pull back out.

One further piece of honesty. If the long-run gateway speaks the OpenAI Responses API, as the
original proposal wanted, the runner does need the API-dialect field after all. Version one
does not create that need and does not remove it. It just does not pay for it yet.

---

## The comparison

| | OpenRouter capped keys | Self-hosted LiteLLM | Build our own gateway |
|---|---|---|---|
| Effort beyond the shared product work | About 5 days, including the runner contract change | About 2 weeks, plus ongoing operations | 1 to 2 weeks |
| Who enforces the spend limit | OpenRouter, server side, per key | LiteLLM, post-hoc and batched | Us, atomically per call |
| Can it pin the model | Yes, through a guardrail, if guardrails work on our account. Unverified | Yes, per virtual key | Yes |
| Blast radius when a credential is stolen | The remaining cap, on one model, for the trial window | The virtual key's budget, with a documented overshoot window on concurrent calls | The remaining hold, minutes of one model |
| New infrastructure to operate | None | A service, its Postgres, documented memory growth, community sizing around 4 vCPU and 8 GB | None new. FastAPI, httpx, and Redis are already in the API's dependency set |
| Credential that lands in the sandbox | A real third-party key | A LiteLLM virtual key | An opaque reservation token |
| Spend visibility | Exact, per key, from OpenRouter's API. Not in our traces | LiteLLM's spend logs | Ours, exact, in our metering |
| What survives into the long-run system | Grant, counter, authorization point, resolution seam, runner change. Issuer discarded | The same, plus a service we would want to delete | Everything |

**On LiteLLM specifically, costed honestly.** It genuinely does what we need: per-key
budgets, per-key model allowlists, and key expiry, without writing a proxy. Its real costs are
three. It is a service to deploy, monitor, upgrade, and page on, with its own database, in a
cloud environment we deliberately keep small. Its spend tracking is post-hoc and batched, so
concurrent calls can overshoot a small budget, which matters more at a $0.30 cap than at a
$50 one. And it still puts a spendable virtual key inside the user's sandbox, so it does not
improve the trust boundary over OpenRouter at all.

What LiteLLM buys that OpenRouter does not: we keep the provider relationship, we avoid the
5.5% top-up fee, and there is no third-party terms question. Those are real, and none of them
pays for a new service at activation-experiment volume. **For this job, LiteLLM is dominated
by OpenRouter.** It would start to make sense at a volume where the 5.5% fee is a line item
worth an engineer's time, which is far above where we are.

**On building the gateway now.** It is the right end state and the wrong starting point. It
front-loads the hardest correctness work in the whole design, the atomic hold and its
reconciler, before we know whether a funded first conversation moves activation at all. If
the experiment says no, we will have built a gateway for nothing. If it says yes, we will
build it with real usage data and a real reason.

---

## What must be true before we start

1. **Prove the runner path end to end**, starting from a default agent with an empty vault, not
   from a hand-made custom connection. This is the correction in fact 1 and it is the one that
   could still sink the plan. It is a day of work and it should be day one.
2. **Run the probe.** `probe_openrouter_keys.py` in this folder. It has never been run, it
   spends a few cents, and it needs a management key and your approval. The answer that
   matters most is whether guardrails work on our account type, because that decides whether
   the model is bounded or only the money is.
3. **Test the exhaustion experience live.** Mint a key with a $0.01 cap, run a real agent turn
   through the `custom_provider` path on the dev stack, and watch what the playground shows
   when the cap is hit mid-stream. We have a known class of bug where an errored turn renders
   as an empty message. A trial that ends in silence is worse than no trial.
4. **Confirm tokens reach our traces on this path.** The code says they do. The proposal's
   production measurement said they did not. One live run and one trace query settles it.
   `findings.md` has the detail.
5. **Do a half-day quality check on the candidate model** in our own harness, with real tool
   calls. If a nano-class model cannot hold a simple agent conversation, the experiment
   measures the wrong thing.
6. **Send OpenRouter one email** describing the pattern, and ask in the same message about the
   key-count cap and the provisioning rate limit. Neither is documented.

---

## What I would not do

- **Do not store the trial key in the user's project vault.** It is readable there, and it
  silently disables the connect-a-key banner forever. See `findings.md`.
- **Do not use a `custom_provider` record whose `kind` is `openrouter`.** The resolver
  normalizes that back to `deployment = "direct"`, and then no runner code consumes the stored
  base URL. The URL becomes silently inert. Use `kind = "custom"`. This trap is pinned by a
  test today (`repo-findings.md`, path C).
- **Do not treat the model pinning in `models.json` as a security boundary.** It is
  configuration in a runtime the user controls. The guardrail is the boundary, if it works.
  The cap is the boundary if it does not.
- **Do not defer funded-run authorization to save three days.** The gateway's full signed
  reservation claim can wait. A trusted purpose and a unique invocation id at `/invoke`
  acceptance cannot, because triggers, detached jobs, session resumes, and nested workflow runs
  all reach the same endpoint, and a retry with no idempotency key charges twice.
- **Do not call the rollout reversible unless the kill switch revokes keys.** Turning off new
  grants does nothing to a key already read out of a sandbox.
- **Do not put OpenRouter fields on the grant row.** Keep the credential lease separate, behind
  an interface, or the eligibility record is welded to one vendor.
