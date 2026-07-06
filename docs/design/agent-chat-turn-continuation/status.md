# Status

Last update: 2026-07-06 (design session, no code changed)

## Where things stand

- Research DONE. Every claim from the original findings doc verified against source,
  with two precision corrections (see `research.md` section 8).
- Design DONE. Recommendation: option A, server echoes the continuation id. See
  `fix-options.md`.
- Implementation of the messageId fix IN PROGRESS (PR #5088).
- Follow-up DESIGNED, decision pending: trace-context propagation so one turn = one
  trace (fixes the multi-trace footer/Inspect trade-off v1 accepts). See
  `trace-continuation.md`; Mahmoud decides whether it becomes an issue or a PR.

## Key decisions

1. Fix lives in SDK routing (`routing.py`), not the adapter, frontend, or runner.
   The adapter already accepts `message_id` (`stream.py:254-260`); routing just never
   passes it.
2. Continuation detection = "inbound last message has role assistant", mirroring the
   AI SDK's own server helper (`ai/dist/index.js:4199-4208`). Not approval-specific,
   so client-tool resumes are covered too.
3. v1 accepts last-request `traceId`/`usage` on the merged turn (metadata merge,
   `ai/dist/index.js:4563-4573`). Aggregated per-turn metrics are a parked follow-up.
4. Batch channel gets the same rule as a second slice
   (`_make_vercel_json_response`).
5. The wrong usage numbers on resumes (`0/0/~62k`) are a runner bug
   (`otel.ts:1185-1197`), filed separately, not fixed here.

## Blockers

None.

## Next steps

1. Mahmoud reviews this workspace (start with `research.md`, then `fix-options.md`).
2. On approval, implement slice 1 per `plan.md` (implement-feature flow), then the
   tests, then the manual playground scenario.
3. File the runner usage issue and the root-cause-2 (phantom tool failure) issue.

## Deferred

- Batch intra-response id-collision corner: an echoed continuation id can collide
  with a positional `msg-{i}` id assigned to another message inside the same raw
  batch JSON. Accepted for v1: the frontend replay only ever extracts one message,
  so this is not client-visible.
- Runner usage bug (resumes report `0/0/~62k`, `otel.ts:1185-1197`) still needs its
  own issue filed; not fixed by this PR.
- Manual playground click-through of the approval-resume scenario (`plan.md`
  "Manual playground scenario") is still pending.
