# Spike brief: how to fund trial agent runs without building a gateway

**Requested by:** Mahmoud, 2026-08-02.
**Output:** research + feasibility spike in this folder. Not an implementation.

## Situation

We want to give new cloud signups roughly 30 free agent playground messages on an
Agenta-funded cheap model, so their first conversation happens before we ask them to
connect their own provider key. The full proposal is open as docs-only PR #5463 on
branch `docs/activation-credits-proposal` (files under
`docs/design/activation-credits/`: context, research, design, rfc, implicit-decisions).
Read all five before starting.

That proposal recommends building our own inference gateway, roughly 600 to 900 lines,
one to two engineer weeks. Mahmoud's position:

> On the long run we will very likely need this gateway and a way to count credits and
> buy credits. But unless a first version is simple and expandable, I would probably not
> go there for an activation experiment.

So the spike exists to answer: **is there a simple, expandable first version that does
not require building or self-hosting a gateway?**

## Why a chokepoint is needed at all

Agent runs execute inside a Daytona sandbox the user controls. That means:

- The credential can be read out of the sandbox unless something hides it. The parked
  Daytona Secrets work (PR #5277, design #5223, reconciliation #5278) solves this by
  substituting a placeholder at the egress proxy toward an allowlisted host. #5277 is
  currently conflicting, last commit 2026-07-13, and targets the `big-agents` branch.
- Even with the value hidden, **nothing counts or bounds the model calls**. One
  authorization releases a credential into a sandbox that then makes an unknown number
  of calls. The classic prompt playground does not have this problem, because its model
  call happens inside our own completion service, so one gate check equals one call
  (see PR #2957 and `research.md` §2 in the proposal folder).

The counting gap is the real reason the proposal reached for a gateway. The spike should
treat "who counts the calls" as the central question.

## The candidate Mahmoud wants evaluated

Use OpenRouter as the chokepoint instead of building one. Specifically:

- **One OpenRouter key per user** (not one organization per user, which he says we
  cannot have).
- **A hard spending limit on the key, with no reset.**
- **A short expiry, about one day.**
- Deliver the key into the sandbox through the Daytona Secrets path so it is unreadable.
- Keep our own meter for the user-facing "30 free messages" number. OpenRouter's limit
  is the financial safety net, not the product unit.

I verified that OpenRouter's provisioning API accepts a `limit` field (an optional
credit limit) and returns `limit_remaining` and `limit_reset`, and that `limit_reset`
can be set to `daily` or left null for no reset. Everything below that is unverified.

**His stated worry, and the thing the spike most needs to resolve:** we cannot restrict
which model the key is allowed to call, other than by what the UI offers. A user who
picks an expensive model would burn the whole allowance in two messages instead of
thirty. Establish whether OpenRouter can constrain a key to a model or model set, and if
it cannot, work out whether the dollar limit alone is an acceptable bound and what the
user experience looks like when someone exhausts it early.

## The alternative he named

Self-hosting the LiteLLM proxy. He is against it because it is new infrastructure for
cloud that we do not want to operate. Cost it honestly anyway so the comparison is real,
and note that the proposal's `research.md` §8 already surveyed LiteLLM and found its
spend tracking is post-hoc and batched, so concurrent calls can overshoot a small budget.

## Questions to answer

1. **Key capabilities.** Through OpenRouter's provisioning API, can a minted key carry:
   a hard credit limit that OpenRouter enforces server side; no reset; an expiry or time
   to live; a restriction to one model or a model allowlist? Cite the API surface for
   each. Where a capability does not exist, say so plainly.
2. **Scale and lifecycle.** Are there limits on how many keys one account may mint, or
   rate limits on the provisioning API? Who mints the key and when (signup, first run,
   per session)? Where is it stored? What happens when it expires mid-run? How do we
   clean up orphaned keys?
3. **The model restriction problem.** If keys cannot be pinned to a model, what bounds
   the damage? Quantify it: what does a user actually spend if they pick the most
   expensive model available and run until the cap? Is the answer acceptable at the
   proposal's budget of $3,000 for about 10,000 signups?
4. **Fit with our runtime.** How does this land on the agent connection resolution path
   (`sdks/python/agenta/sdk/agents/platform/connections.py`, `resolve_connection`) and
   the runner's custom provider path? The proposal notes the runner speaks only the
   chat completions dialect today, which may make OpenRouter simpler than a Responses
   API gateway rather than harder. Verify.
5. **Fit with Daytona Secrets.** Does this depend on #5277 re-landing? If #5277 stays
   parked, is delivering a short-lived capped key in the sandbox environment acceptable
   in the meantime? Say what the exposure is in plain terms.
6. **Cost.** What margin does OpenRouter add on top of direct provider pricing for the
   candidate cheap models? The proposal measured roughly $0.025 to $0.05 per session
   uncached at direct pricing. Does prompt caching survive the OpenRouter hop? The
   harness sends about 23.6K tokens of context per call, so caching dominates the
   envelope.
7. **Observability.** The proposal's `research.md` notes that agent runs routed through
   OpenRouter record no token usage in our traces today. Confirm this, and say what we
   would be blind to.
8. **Expandability, which is the deciding criterion.** Does this path grow into the
   long run system Mahmoud described (our own gateway, a credit ledger, purchasable
   credits), or is it a dead end we throw away? Be specific about which pieces carry
   over: the grant record, the meter, the reservation, the connection resolution seam.
9. **The comparison.** Side by side: OpenRouter capped keys, self-hosted LiteLLM, build
   our own gateway. Effort, who enforces the limit, blast radius when abused, new
   infrastructure, and what survives into the long run system.

## Method

- Use the Codex CLI at high reasoning effort for the analysis passes. The `ask-codex`
  skill wraps this.
- Verify claims against OpenRouter's live documentation and against this repository.
  Do not restate the existing proposal as if it were evidence. Where something cannot be
  verified from documentation, say it is unverified and name the test that would settle
  it.
- A small runnable probe against the OpenRouter provisioning API would settle questions
  1 and 2 far better than documentation will. Do not run it without an API key and
  Mahmoud's go ahead. Instead, write the probe script so it is ready to run, and say so
  in the findings.
- Follow the repository rule for standalone scripts: run them with `uv run` and declare
  dependencies with the `# /// script` block.

## Deliverables in this folder

- `findings.md` — what was verified, what was not, each with its source.
- `recommendation.md` — the option to take, why, and what it costs. Include the
  smallest first version and the path from it to the long run system.
- `open-questions.md` — what only Mahmoud can decide, with options and trade-offs.
- The probe script, unrun, if one is written.

Do not modify anything under `docs/design/activation-credits/`, and do not commit or
push. Leave the work uncommitted for review.
