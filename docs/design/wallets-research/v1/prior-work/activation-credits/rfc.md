# RFC: free trial credits at signup

**Status:** for review. Reviewer: Mahmoud.
**Reading order:** context.md (situation, glossary) → this file (decisions) →
design.md (full architecture) → research.md (evidence) →
implicit-decisions.md (what entered the design beyond the original ask, and
what each item costs to strike).

## The proposal in three sentences

New cloud signups get about thirty free playground messages on an Agenta-funded
cheap model, so their first conversation happens before any key form. At zero,
the existing connect-your-key moment appears with their draft preserved and
auto-sent once a key lands. It costs us roughly $500-1,500 per 10,000 signups
uncached and a fraction of that with caching, against the $3,000 budget.

## The smallest safe version

Because the full design accreted requirements beyond the original ask
(implicit-decisions.md is the register), here is the floor: the version that
cannot responsibly be shrunk further, stripping every negotiable hardening
item.

- A grant row at signup (new orgs only; anything less gifts every existing
  org).
- A new lifetime counter; charge = one conditional increment in the same
  transaction as a minimal reservation row (idempotency key, no refund states,
  holds expire on a timer).
- A server-side funding check on the invoke route only (no signed claim).
- The gateway, minimal: token validation, one model, per-call and per-run
  caps, streaming pass-through, usage record. This piece is not strippable;
  the sandbox is user-controlled and a raw platform key inside it is
  stealable, which no counter elsewhere can fix.
- Frontend: relax the gate while balance remains, countdown pill, exhausted
  banner, draft retention.
- Isolated provider account with a hard spend limit; backend kill-switch flag.

Estimate for this floor: the gateway's one-to-two engineer-weeks plus roughly a
week across backend and frontend. The full design in design.md adds the
hardened reservation lifecycle, signed provenance, replay protection, and
refund semantics; the delta is deferrable and listed item by item in
implicit-decisions.md §6-12.

## Decisions requested

**D1. Unit.** One unit = one message (an accepted agent run), shown as "free
messages". Token units are meaningless to a new user; the 23.6K-token harness
context makes even "hi" cost thousands. The word "credits" is reserved for the
future fungible unit (earned, purchased). **Recommend: yes.**

**D2. Model.** gpt-5.4-nano (prepaid controls, caching, recognizable brand,
~$0.05/session uncached) vs Gemini 2.5 Flash-Lite (half the cost, postpaid
alert-only billing) vs DeepSeek V4 Flash (cheapest, PRC-hosted, a sales
objection). **Recommend: nano, conditional on a pre-launch quality test of
real tool-using sessions on both finalists; the vendor positions nano for
classification workloads, so first-session quality is measured, not assumed.**

**D3. Amount.** One-time ~30 runs (3x the measured session; our credits end at
BYOK, so recurring grants serve competitors' business model, not ours), with
the amount as a per-cohort experiment parameter. **Recommend: yes, cohorts at
20 and 50.**

**D4. Eligibility storage.** Append-only grant record + existing meter;
balance is computed, never stored. Rejected: plan-catalog quota (gifts all
existing orgs; no per-org override exists) and a mutable balance column
(second source of truth). **Recommend: grant record.**

**D5. Scope.** Org-scoped, signup-provisioned orgs only (the signup and
explicit-org-creation code paths are distinct, so this is enforceable; it
closes grant farming). Consequence: invited teammates can meet an exhausted
balance. **Recommend: yes.**

**D6. Credential protection.** Daytona Secrets alone hide the key but leave
its use unbounded toward the provider host; gateway alone bounds use but the
token sits readable in the sandbox; composed, the token rides the #5277
delivery once it re-lands, and theft requires beating Daytona's egress proxy
for a prize of minutes of one cheap model. **Recommend: gateway first (it is
the only usage bound), composition when #5277 re-lands.**

**D7. Build vs adopt the gateway.** No surveyed OSS gateway implements
reservation-bound hold-and-settle; LiteLLM is a heavy platform whose weight
buys unneeded provider breadth; the closest match is dead; the light one is
stateless where we need state. Building is 600-900 lines on infrastructure we
run. **Recommend: build; if managed credits later go multi-provider, put a
translation layer behind our ledger.**

**D8. Scope of hardening for the MVP.** The smallest safe version above, or
the full design.md treatment. This is the "which of the accreted requirements
do we pay for now" decision and it is deliberately yours;
implicit-decisions.md prices each item. **Recommend: smallest safe version
plus fail-closed checks (item 11), deferring items 6-9 and 12 to the managed-
credits iteration.**

## Cost and guardrails, condensed

Measured: ~23.6K tokens of harness context per LLM call dominates; a 10-turn
session is ~242K input tokens; $0.025-0.05 per session on the candidate models
uncached, under a cent cached. 10K signups ≈ $250-500 expected, worst-case
bounded by: per-call and per-run gateway budgets, the ~30-run balance, a daily
per-org throttle, an isolated provider account with a hard spend limit and
auto-recharge off, and a backend kill switch. Mass fake signups cost cents
each and remain an email-verification problem.

## Measurement

Activation rate (first successful playground message per signup),
key-connection within 7 days, spend per signup, conversion at the exhaustion
screen. Kill at 3x the spend envelope or a key-connection collapse. The trial
moves the wall; it must not become the product.

## Out of scope

Earned credits (new grant rows later), purchasable managed credits (extends
this ledger), the classic prompt playground, self-hosted. Prerequisite fixes
tracked separately: the OpenRouter token-usage instrumentation gap, and the
audit for stray provider keys on the cloud service environment.
