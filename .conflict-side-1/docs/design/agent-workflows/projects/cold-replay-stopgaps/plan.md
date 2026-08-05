# Cold-replay stopgaps

## What and why

The agent runtime cold-replays the whole conversation as flattened text on every turn
(`services/runner/src/engines/sandbox_agent/transcript.ts`, `buildTurnText`). Two
production failures on 2026-07-07 came from that path; the full analysis is in
[../approval-boundary/cold-replay-failure-report.md](../approval-boundary/cold-replay-failure-report.md).
Turn c6de1865 took three approval rounds because each fresh model rebuilt the tool
arguments from the lossy text and drifted the approval key. Turn 6d34b1ea ran five rounds
and executed zero commits: the resume prompt re-presented the stale user command as if
just spoken, so each fresh model restarted the whole task, and one large tool output
filled the 24K tail-sliced window and evicted the original goal.

Session-based continuation (keep-alive plus native `session/load`) is the real fix and is
coming next. The text-replay path stays as the fallback after sessions land, so it is
worth fixing cheaply. The rule for this change set: no complexity that sessions will make
unnecessary. Four small, runner-only changes.

## The four changes

1. **Per-result cap plus a bigger window** (`transcript.ts`). Each rendered tool RESULT
   body is capped at 4,000 chars with an explicit elision marker that states the omitted
   char count. Tool CALL args are never capped: the approval replay nudge tells the model
   to re-issue the call "with the same arguments", so args must stay complete. User and
   assistant text are not capped. The default `AGENTA_AGENT_HISTORY_MAX_CHARS` window
   rises from 24,000 to 100,000 (still env-overridable, same tail-slice mechanics).
2. **Resume closing frame** (`transcript.ts`, `buildTurnText`). An approval resume is
   detected conservatively: an unresolved approved call (the existing `lastPending`
   render hint) sits in a message after the last user message that carries text. In that
   case the closing frame becomes an explicit resume instruction (execute exactly the
   approved call, do not restart the task) instead of "The user now says: \<stale
   command>". The stale command stays in the replayed history in its original position;
   it just leaves the closing frame. A normal new user message keeps the old frame.
3. **`normalizeJsonish` hardening** (`responder.ts`). The round-5 failure was a
   stringified JSON object with one stray trailing `}`; `JSON.parse` threw and the raw
   string hashed past the stored approval key. The parser now retries after trimming up
   to three trailing `}` or `]` characters (plus whitespace). Only containers are
   accepted, only trailing closers are trimmed, so genuinely non-JSON strings keep their
   literal value and existing keys do not change.
4. **Replay observability** (E8 from the report). Every cold replay logs one `[HITL]`
   line through the engine's existing log seam: transcript chars before and after the
   tail slice, messages fully evicted, whether the pending-approval nudge survived into
   the rendered text, whether the resume frame fired, and the final turnText length.

## Deferred to sessions

These report items are deliberately not implemented, because session continuation
replaces the mechanism they patch:

- **Runner-side execution of approved calls.** Keep-alive slice 2 answers the parked
  permission RPC directly, so the original byte-exact call runs without any replay.
- **Name-level approval-key fallback matching.** Same: the parked RPC removes the
  re-derivation step that makes keys miss.
- **Session and keep-alive machinery.** That is the session work itself, planned
  separately.
- **The `get_revision` platform op.** A config read path is a build-kit concern, not a
  replay stopgap; tracked in the build-kit backlog.
- **Frontend changes.** The session-id fragilities in the report's Q3 belong to the
  session project that will key state on the id.
