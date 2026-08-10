# Status

2026-08-10 ~18:15 CET.

## Done

- Research COMPLETE: all four inputs folded into research.md (the six diagnosed
  mechanisms with corrections; the frontend render inventory; the server-side lifecycle
  inventory; the live evidence including the kind-by-outcome settlement table).
- plan.md written: six-point lifecycle contract, six workstreams in landing order,
  validation matrix.
- Workspace docs: README (glossary, reading order), context.

## Done (additional)

- Blame archaeology complete and folded in (research section 6): root defect born
  complete in v0.105.0, never a regression; visibility regressions dated to v0.111
  (records-watch relay) and the 0.112 train (row-reading replay). One research claim
  corrected (records DO carry answers; the row cannot). Plan reshaped: contract work vs
  regression repair.

## Done (review round)

- Adversarial review (codex gpt-5.6-sol) returned UNSOUND on plan v1 with nine findings,
  the decisive ones: v1's resolve-at-delivery loses the sweep race on cold resumes; the
  new closing record duplicated the existing tool_result; the watch workstream built
  patching machinery where a subscription suffices; two workstreams were unrelated scope.
  Plan v2 adopts all of it: the answer becomes the authoritative first transition through
  the existing interactions API, one replay precedence rule, subscribe-and-refetch, cards
  act where they render. Mobile client-tool fulfillment documented as a limitation.

## Next

- Then implementation, W1 first (resolve on fulfillment), since every later workstream
  keys on real terminal statuses existing.

## Blockers

None.

## Decisions taken

- Root cause treated as the fragmented state model; the plan establishes one contract
  rather than more symptom patches.
- No schema migration: statuses and resolution payloads already exist; W1 changes who
  sets them and when.
- Connection reuse (issue #5911) stays out of scope; W5 only guarantees the model hears
  outcomes.
- Corrections adopted from research: no one-interaction-per-turn rule exists; no
  10-minute interaction TTL exists (that timer is the warm sandbox approval park).
