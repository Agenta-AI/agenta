# Design: platform-funded trial runs

This document specifies the architecture. context.md explains the situation and
defines terms; research.md carries the evidence each choice rests on; rfc.md
lists the decisions requested. Numbers cited here (costs, token counts, file
references) are sourced in research.md.

## The shape of the problem

Three facts, together, dictate the architecture:

1. **The run executes in a runtime the user controls.** Playground agents run in
   a Daytona sandbox driven by the user's instructions and tools. A provider key
   placed there must be assumed stolen: today's delivery injects resolved keys
   into the sandbox environment, and "print your environment" is a valid agent
   instruction. A stolen platform key bypasses every counter, cap, and kill
   switch we could build elsewhere. So the platform key can never enter the
   sandbox, which forces a proxy of some kind between the sandbox and the
   provider.
2. **Spending must be authorized per run, atomically.** The trial balance is
   small (about thirty runs). Two browser tabs racing for the last run, a
   network retry of the same send, or a crash between "charged" and "counted"
   must not double-spend or spend uncounted. The entitlements meter gives
   atomic counting; the design must give it a spend lifecycle around it.
3. **Only some surfaces may spend.** Interactive playground runs and direct
   invoke calls should draw on the trial; evaluations, batch, and background
   invocations must never. But all of these converge onto the same workflow
   invocation path in the backend, and everything the client sends is
   forgeable. The funding decision needs provenance minted server-side, before
   the paths converge.

Everything else is reuse: the meter engine counts, the billing UI displays, the
existing banner and auto-send machinery carry the UX, and the in-flight Daytona
secret-delivery work hardens the transport.

## Component 1: the grant record (who is eligible, for how much)

At signup, the newly provisioned personal organization gets one append-only
grant row: organization, amount, granted-at, and a stable campaign identifier,
with a uniqueness constraint on (organization, campaign) so a retried signup
hook cannot grant twice.

Why a grant record and not the two obvious alternatives:

- **Not a plan-catalog quota.** Quota limits are plan-wide code constants. A
  lifetime quota on the free plan would hand the full allowance to every
  existing organization on that plan the day it ships; there is no per-org
  override mechanism to carve out "new signups only". The grant row is that
  mechanism, minimal.
- **Not a mutable balance column.** A writable "remaining" beside the meter
  creates two sources of truth that drift. The balance is computed: grant total
  minus meter value. Only the meter moves.

What the grant row buys beyond eligibility: per-cohort amounts (ship cohorts at
20 and 50 and let funnel data pick the number), a rollout gate (no grant, no
feature, so shipping to a percentage of signups is just granting to a
percentage), and the future seams: earned credits and sales promos become more
grant rows with different campaign identifiers, touching nothing else.

Eligibility is deliberately narrow: the personal organization provisioned by
the **signup** path only. The backend distinguishes signup provisioning from
explicit organization creation (they are different code paths), and funding
every new org would invite farming orgs for fresh grants. Accepted consequence:
an invited teammate can join an org whose balance is spent; such orgs
overwhelmingly have keys already.

## Component 2: the reservation (authorizing and charging one run)

A durable record with an explicit lifecycle:

```
reserved ── started ── charged
   │
   ├── refunded   (run died before its first model call)
   └── expired    (never started; reconciliation sweep)
```

Created server-side when a funded run is accepted, keyed uniquely by a
server-minted invocation identity (component 3), bound to the authenticated
organization, project, and model. One reservation authorizes exactly one run.

**The economic invariant.** The meter's strict conditional increment and the
reservation's authorizing transition commit in one database transaction, and
the gateway mints a token only for a committed reservation. A refund pairs the
terminal transition with the decrement the same way. Consequences of the
invariant: a retried request lands on the same reservation row (idempotent by
the unique key) instead of charging twice; a crash between increment and
transition is impossible because they are one commit; a crashed refund handler
retries into the same transition instead of refunding twice. Without this, all
three failure modes are live: increment-then-crash charges without
authorizing, charge-then-fail-to-count spends unmetered, and a double refund
mints free runs.

One named refactor makes it possible: `MetersDAO.adjust` currently opens and
commits its own session, so it must learn to join a caller-owned transaction
(or the conditional upsert moves into the reservation repository). The strict
SQL predicate itself is kept exactly as is.

The consumption counter is a new lifetime meter (working name
`trial_runs_consumed`, `period=None`). The existing monthly `credits_consumed`
is not reused: a monthly counter would silently refill the trial every month.
The reservation service passes the grant-derived total as the meter limit, so
the plan catalog is untouched.

**Failure policy is fail-closed.** The entitlements house pattern fails open on
infrastructure errors, which is right for feature gates (a Redis blip should
not lock users out of features) and wrong here (a Redis blip should not spend
our money unmetered). The reservation service is a deliberate, documented
deviation.

**Charge policy.** The committed reservation is the charge. It is refunded if
the run dies before its first model call (validation failure, runner startup
crash, provider down), and kept for anything after: partial runs consumed real
tokens.

## Component 3: funding provenance (which surfaces may reserve)

The API orchestration layer, at the point where it still knows how a run was
invoked, mints a short-lived signed invocation-purpose claim bound to
organization, project, and a fresh idempotency identity. Only interactive
playground and direct invoke acceptance mint it; the evaluation, batch, and
background paths never do. The reservation service accepts only this claim, and
the claim's identity is the reservation's unique key.

Why this indirection instead of a simpler flag: the invocation paths converge
before credential resolution, wire metadata like a `run_kind` field is
caller-controlled, and the runner's own turn identifier is created after
connection resolution, too late to serve as the idempotency key. The claim is
the one artifact that is both unforgeable (signed, server-minted) and early
enough (minted at acceptance).

## Component 4: the inference gateway (the trust boundary)

Funded runs receive no provider key. The resolver returns a connection whose
endpoint is the gateway's URL and whose credential is an opaque, short-lived
token minted from the committed reservation and bound to it: organization,
model, request count, token budget, expiry.

The gateway holds the only copy of the trial provider key and, per request:

- validates the token and rejects expired ones;
- canonicalizes the request: allowed parameters only, forced provider
  data-retention settings, exactly the allowlisted model;
- takes an **atomic hold** against the reservation's remaining budget before
  forwarding, and settles the hold to actual usage after the response. Check
  followed by decrement is not enough: two concurrent calls both pass the
  check; the hold is the decrement, taken conditionally. A call that times out
  ambiguously keeps its hold until reconciliation (OpenAI stores responses, so
  late settlement can read the true usage), which prevents a duplicate retry
  from being funded twice;
- enforces replay protection per provider call (a call identity plus a
  canonical request hash), not per token, because one token legitimately makes
  several calls within its budgets;
- streams the response through byte-faithfully (no frame re-encoding, no
  buffering) while tapping the final usage event, and emits the usage record to
  our metering. This also closes an observability hole: harness-side
  instrumentation provably drops usage for at least one provider today, and the
  gateway meters at the only chokepoint that cannot be bypassed.

**API surface.** One provider, one model, one API surface for the MVP, and the
surface is the provider's agent-native API (for OpenAI, the Responses API),
because the funded runs are tool-using and that is the protocol the vendor
builds agent features on. The pre-launch quality test exercises real tool calls
end to end rather than trusting either API's documentation. The runner needs
one contract addition, not new key trust: the platform-resolved connection
carries an explicit API-dialect field, because the runner's custom-provider
path currently assumes and emits only the chat-completions dialect and would
otherwise speak the wrong protocol through the gateway.

**Build, not adopt.** No surveyed OSS gateway implements reservation-bound
hold-and-settle (research.md §8); adopting one means operating someone else's
platform while still writing the only hard part inside their plugin system. The
build is one FastAPI route plus the ledger, roughly 600-900 lines, one to two
engineer-weeks, on Redis and Postgres we already run. The ledger is also the
piece a future paid managed-credits product extends, and it stays the budget
authority if a multi-provider translation layer ever slots in behind it.

**What a leaked token is worth.** Extracted from the sandbox, it buys minutes
of one cheap model inside an already-metered budget. That is the whole point of
the boundary: theft of the credential is no longer catastrophic, so the rest of
the guardrails only have to keep honest users honest.

## Composition with Daytona secret delivery

The in-flight Daytona work (#5223 design, #5277 implementation, #5278
reconciliation proposal) delivers credentials as placeholders that only
Daytona's egress proxy resolves, toward one allowlisted host. It hides the
value completely (possession) and bounds nothing about how it is used toward
that host (usage). Research.md §7 has the mechanism and its limits.

The two compose without redesign: the trial connection's endpoint is the
gateway host, and the reservation token rides the #5277 delivery path as an
ordinary `opaque_http` credential once that path re-lands on the refactored
provider interface. Then even the token is unreadable inside the sandbox, and
the gateway remains the usage bound. Shipping on Daytona Secrets alone, with a
raw provider key and the provider's host allowlisted, is explicitly rejected:
it would hide a key that can still be spent without limit. Expired trial
reservations are cleaned by the reservation service's own sweep; they do not
ride #5278's Daytona-scoped reconciliation.

## Frontend

The single boolean gate becomes a small state machine: loading, user key
available, funded run available, allowance exhausted, funding unavailable
(kill switch or outage), selected model not funded. Rules that keep it honest:

- The reservation outcome is the authority on whether a run proceeds and what
  remains. The polled usage query (2-minute stale time) is display data for the
  countdown, never authorization.
- A failed or loading balance query renders as unknown, never as zero. Nothing
  is worse than showing a new user "0 free messages" because a query flaked.
- On exhaustion, the send is refused before any model call; the banner slot
  shows the connect-your-key message; the typed draft is retained and auto-sent
  once a key lands. The existing auto-send covers only the seeded first prompt
  today (a refused arbitrary draft becomes a transcript error), so draft
  retention is new state with its own tests.
- The countdown appears after the first response, not before the first send.
  Nothing about the free experience should add friction before the aha moment.
- The model picker stays visible; non-trial models show the normal
  connect-a-key affordance. The picker is presentation; the gateway enforces.
- The template drawer's "Agenta-managed / Ready" label becomes true for the
  trial model instead of being the false promise it is today.

## Surface matrix

| Surface | Behavior |
|---|---|
| Agent playground (cloud) | Funded: provenance claim → reservation → gateway token |
| Direct agent API calls (invoke path) | Same as playground; reservations and throttles apply |
| Evaluations, batch, background | Never funded; no claim is ever minted for them |
| Classic prompt playground | Unchanged; different credential path, near-zero cost, not the activation surface |
| OSS / self-hosted | No grants, no gateway; resolver behavior unchanged |

EE/OSS seams: grants, reservations, provenance, and the gateway are cloud-only
behind the established `is_ee()` pattern. The SDK and agent-service touchpoints
(the dialect field, the resolver's managed-connection branch) are shared code
that no-ops when the backend issues no grants.

## Guardrails, stacked

From inner to outer, each assuming the previous failed:

1. Gateway budgets: per-call caps, per-run call and token budgets, model
   allowlist, at the request boundary (an oversized first call is refused, not
   observed after the fact; the runner's existing limits are time-only).
2. Reservation: no committed reservation, no token, no run.
3. Daily throttle per organization on trial runs. Note the existing throttle
   middleware is a per-minute token bucket; a calendar-day cap is either a
   small daily meter or an accepted approximation.
4. Isolated provider project: hard project-level spend limit (enforcement lag
   acknowledged), auto-recharge off, alerts, one-click revocation.
5. Kill switch: a backend flag marking managed funding unavailable, read by the
   frontend state machine. Deleting the env key is not the mechanism: the
   frontend would still show balance and then fail mid-run.
6. Grant size itself: worst case per fake account is cents. Mass fake signups
   stay an email-verification problem, deliberately.

## Deployment and migration order

1. Postgres enum migration for the new meter key; grant and reservation tables
   (small, new). Migration before code.
2. `MetersDAO` caller-owned-transaction refactor.
3. Reservation service + provenance claim minting + gateway service (compose
   stack, holds the only copy of the trial key).
4. SDK/agent-service: dialect field, managed-connection branch in the resolver.
5. Frontend state machine, countdown, exhausted state, draft retention.
6. Usage API surfacing (the billing page renders the new counter without
   changes once reported).
7. Trial provider account setup: isolated project, hard cap, no auto-recharge,
   prepaid load sized to the experiment ($500 to start).

Prerequisites tracked separately: the OpenRouter usage-instrumentation gap
(file an issue; the gateway meters trial runs regardless, but observability
stays blind for everything else), and the audit of stray `*_API_KEY` values on
the cloud completion service (legacy-path runs would be free and unmetered
today if any are set).

## Rollout, measurement, kill criteria

Gate on backend funding flag plus grants; grant to a percentage of new signups
first, watch spend per signup against the measured envelope, widen.

Measure: activation rate (first successful playground message per signup),
key-connection rate within 7 days, platform spend per signup, and trial-to-key
conversion at the exhaustion moment. Kill when spend per signup exceeds 3x the
envelope, or when key-connection collapses while activation merely shifts
messages onto our key (the trial must move the wall, not become the product).

## Risks and open questions

- **Trial model quality.** The cheap models are positioned for classification
  workloads; if the first session feels dumb, activation gains evaporate. The
  pre-launch quality test (real tool-using sessions, both candidate models,
  through the gateway path) is the gate on D2, and it is the one place this
  design says "measure before deciding".
- **Prompt caching through the gateway.** The cost envelope's best case assumes
  caching works through our pass-through (stable prefix, provider-side cache
  keys). If it does not, costs run 5x higher, still inside budget, but worth
  verifying in the same pre-launch test.
- **#5277 timing.** The composition's hardening half depends on the Daytona
  delivery re-landing after the runner refactor. The gateway does not wait for
  it; the token-in-env interim is acceptable because the token is scoped and
  expiring.
- **Session lifetime vs token expiry.** Warm sandboxes outlive single runs;
  token expiry and per-reservation budgets must line up with session semantics
  (a token per run, not per sandbox).
- **The exhaustion moment is the product.** Everything funnels to one screen:
  "you used your free messages, connect a key". If that screen converts, the
  program pays for itself; if it reads as a paywall trap, we bought nothing.
  Copy and behavior (draft preserved, one-click to the drawer, auto-send on
  connect) deserve design attention disproportionate to their code size.
