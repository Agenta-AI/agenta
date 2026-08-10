# QA: the standing checks that make this class undiscoverable no more

This bug class reached production and was found by a human exploring, much later. This
file first states plainly why every existing layer missed it, then defines the standing
checks that go in with the fix. The rule these checks follow: the class lived in the
seams BETWEEN tested units (park, resume, reload, adopt), while every unit test was
green, so the new checks are seam tests, each one tied to a mechanism from
[research.md](research.md).

## Why nothing caught it

1. No test anywhere asserted an interaction row's terminal state after a user answered.
   Handlers and widgets each had unit tests; the row's truth had none.
2. No test drove the compound journey (form, then connect, then schedule, in ONE
   conversation) or crossed a reload. Each acceptance test exercises one interaction, in
   one turn, in a fresh page.
3. The park-answer-resume cycle barely runs in CI at all: agent-chat acceptance tests
   mock the run stream, and real gated runs live only in the release-gate matrix, which
   asserts model behavior, not row truth.
4. The four state sources (live messages, records, rows, localStorage) had no invariant
   linking them, so they could disagree forever without any test noticing.
5. Nothing in production measured the class: an answered interaction recorded as
   abandoned looks, in every existing metric, like a user who walked away.

## Standing checks, by layer

### 1. The settlement matrix as a permanent API acceptance test

For each interaction kind and outcome (approval approve/deny/abandon; form
submit/decline/abandon; connect complete/decline/abandon): drive the real endpoints
against a deployed stack and assert the row's terminal status AND resolution payload
match the contract table. This is the test that says "success is never recorded as
abandonment" forever. Home: `api/oss/tests/pytest/acceptance/sessions/` beside the
existing interaction tests; the matrix from research section 5 is the spec.

### 2. Replay goldens across both copies and both cache states

Golden record fixtures per kind and outcome, including legacy pre-contract rows with
and without a closing `tool_result`. Assert: the rebuilt conversation renders the card
in the correct terminal state; both replay copies produce identical output; the result
is the same whether the row join is warm or cold (the non-determinism found in research
section 2 becomes a failing test). Home: the transcriptToMessages test families.

### 3. The geometry invariant: one fixture through every predicate

One shared message fixture containing a pending interaction in a NON-last message must
simultaneously: publish "awaiting" session status, hold the message queue, and render
an actionable card. Today three predicates read different slices and disagree; this
test makes any future divergence a red build. Home: a package-level unit test where the
predicates live, imported by the app-side suites.

### 4. Adoption safety property

Adopting any server transcript while the tab holds (a) a pending card or (b) a settled
answer not yet dispatched must never drop the answer or resurrect a terminal card.
Table-driven unit test over the hydration guard with adversarial orderings (relay tick
during settle, adoption during park, reload mid-answer). This pins mechanisms 1b and
the parked-window adoption gap permanently.

### 5. The scripted compound journey as the deploy smoke

One scripted live scenario on every deployed stack, cheap model, run by the release
gate and after every deploy: create an agent; first message triggers a form; answer it;
RELOAD; assert the form renders as answered and the row is resolved; trigger a connect;
decline it; assert the decline reached the row and the run resumed; trigger a schedule
approval; approve; RELOAD; assert every card renders exactly once in its correct
terminal state and the strip never appeared in the driving tab. This is the primary
user journey that production users actually hit, scripted; it would have caught every
symptom in context.md on day one. Home: the release-gate skill's scenario set.

### 6. Production detection (catch it in prod in hours, not weeks)

Two cheap signals:
- A scheduled query alerting on the rate of `client_tool` rows ending `cancelled`
  without resolution. Post-contract, answered rows end `resolved`; a sustained rise in
  unresolved cancellations is either the class returning or a real UX cliff, and both
  deserve a look.
- A frontend console/telemetry event when a card renders interactive for an interaction
  the rows call terminal (the invariant the resurrections violated). Even as a plain
  logged warning, support and QA sessions surface it immediately.

## What deliberately stays out

Model-behavior assertions (does the agent ASK at the right time) stay in the benchmark,
not here; these checks pin the machinery, not the model. Mobile client-tool answering
gets its checks when that ticket builds the capability.
