# Status

## Implemented (2026-07-07)

All four changes from [plan.md](plan.md), in `services/runner`:

- Per-result render cap (`TOOL_RESULT_RENDER_MAX_CHARS = 4000`) with an elision marker;
  call args, user text, and assistant text stay uncapped
  (`src/engines/sandbox_agent/transcript.ts`).
- Default history window raised to 100,000 chars (`DEFAULT_HISTORY_MAX_CHARS`),
  `AGENTA_AGENT_HISTORY_MAX_CHARS` still overrides it (`transcript.ts`).
- Approval-resume closing frame: `isApprovalResume` detects a `lastPending` approved call
  newer than the last user text and swaps the "The user now says" frame for an explicit
  execute-the-approved-call instruction. On resume the full message list is replayed
  (the stale command stays in history position; a trailing user turn carrying only the
  approval envelope is no longer dropped from the replay) (`transcript.ts`).
- `normalizeJsonish` tolerates up to three stray trailing `}`/`]` closers via
  `parseJsonContainer` (`src/responder.ts`).
- One `[HITL] cold replay:` log line per replay with before/after transcript length,
  evicted message count, pending-nudge presence, resume-frame flag, and turnText length;
  wired through the existing `log` seam in `run-plan.ts`.

## Test coverage

- `tests/unit/transcript.test.ts`: result cap with marker and omitted count, small
  results uncapped, call args never capped, 30K transcript survives the 100K default,
  tail-slice eviction counting via the log line, pending-nudge logging, resume frame on
  an assistant-carried envelope, resume frame on a trailing user-carried envelope, normal
  frame for a new user message with a pending approval, normal frame when the approved
  call already executed.
- `tests/unit/responder.test.ts`: trailing `}` (the round-5 shape), mixed trailing
  closers with whitespace, trailing `]` on arrays, non-JSON strings with trailing braces
  stay literals, stringified scalars stay literals, non-trailing junk is not repaired.
- Full suite: 620 tests, 49 files, green. `pnpm run typecheck` green.

## Follow-ups

- The deferred list in [plan.md](plan.md) lands with the session work (keep-alive
  slices, native `session/load`).
- Report experiments E1-E4 remain manual; the E8 log line makes E1/E4 a grep on the dev
  box instead of code changes.
- The 4,000-char per-result cap and the 100,000-char window are constants picked for
  headroom, not measured; tune if the dev-box logs show evictions in normal use.
