# Plan: one lifecycle contract for interaction cards (v2, post-review)

Prerequisite reading: [research.md](research.md). Terms: [README.md](README.md).
This is the reshaped plan after an adversarial review found v1 unsound (the review's
findings and their adoption are recorded in status.md). It is deliberately smaller.

## The contract, in one sentence

Answering an interaction flips its row FIRST, before anything else can touch it; replay
reads outcomes by a fixed precedence; a tab that renders a pending card neither adopts
over it nor strands it.

## The four changes

### C1. The answer is the authoritative first transition (the whole settlement fix)

When the user acts on a client-tool card, desktop first flips the row `pending ->
responded` through the existing interactions API (the same first step mobile approvals
already take), THEN dispatches the message-borne resume exactly as today. The runner
resolves the row (`responded -> resolved`, with the outcome payload) when it consumes
the answer. No sweep changes at all: the sweep only cancels `pending` rows, so a
responded row survives it by existing semantics. If the respond call fails, the flow
degrades to today's behavior (message-borne only), never blocks the user.

Why this shape: it wins the sweep-vs-resolve race by ordering, not by exemption lists;
it reuses the transition machinery approvals already exercise; and the API change is
small (accept the respond transition and, on resolve, an outcome payload for
`client_tool` rows; lift the approval-only guard exactly that far).

Explicit limitation, stated not hidden: mobile cannot fulfill client tools today (its
dispatcher builds resume history for approvals only). This plan does not change that;
it documents it and keeps the contract desktop-first.

### C2. One replay precedence rule (no new record kind)

The closing conversational fact for a client tool already exists: the `tool_result`
record. Replay (both copies) reads outcomes in fixed precedence:
1. a real `tool_result` (wins always, preserves the actual answer),
2. else a post-contract row resolution,
3. else, for a legacy cancelled row with no result: a neutral, inert "interaction
   ended" state — never inferred success or decline,
4. else (still pending): the live, actionable card.
The v1 idea of emitting `interaction_response` records for client tools is dropped: it
duplicated an existing fact and created ordering disagreements.

### C3. Desktop stops being deaf and stops clobbering

Subscribe the desktop records-watch hook to the EXISTING generic interaction event (no
payload enrichment; it already fires on every transition): on receipt, refetch the
interaction rows and rederive. Plus one adoption rule: never adopt the server transcript
while this tab renders a pending card, unless the incoming state settles that same card.
Payload enrichment and in-place part patching are explicitly deferred until a measured
refetch cost justifies them.

### C4. Cards act where they render

A pending client-tool card is actionable inline wherever it renders (the dock, if kept,
becomes a convenience pointer, not the owner of the actions; its duplicate settle site
is removed). The small pending-predicates (`isHitlPending`, the dock's scan) read the
whole transcript like the session-status scan already does. The registry's
unknown-render-kind dispatch falls through to the tool name (a one-line repair of a
hazard introduced 2026-08-10; lands immediately, independent of this project).

## Filed separately, deliberately out of this project

- Mobile client-tool fulfillment (documented limitation above).
- Model-visibility improvements (uniform outcome framing, connection-validity checks,
  naming newly available tools) — adjacent defects with their own tickets.
- Draft-key pruning, the package-loader rejection parity, the null-turn-id sweep gap.
- Connection reuse (issue #5911).

## Validation

- The settlement matrix from research section 5 as tests: after C1, completion and
  decline produce `responded/resolved` with outcomes on desktop; abandonment still
  sweep-cancels; the race case (sweep firing between answer and resume) is pinned by a
  test that answers, delays the resume, runs the sweep, and asserts the row survived.
- Replay goldens per precedence tier, identical across both copies, including legacy
  rows with and without `tool_result`.
- The live acceptance scenario: form, connect, schedule in one conversation with
  reloads between steps; every card appears once, acts where it is, and nothing
  resurrects.
