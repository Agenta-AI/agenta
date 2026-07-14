# Parallel approval gates: phantom "failed" tool in the playground

Planning workspace for issue 2 of the 2026-07-06 approval-flow investigation: when the
model calls two approval-gated tools in one turn, the runner's one-pause-per-turn latch
drops the second gate, the client is left with an orphaned tool part, and the frontend
fabricates a `This app can't handle the ... request.` failure for a tool that never
ran. The user then pays two sequential approval round-trips.

**TL;DR of the recommendation** (details in [options.md](options.md)): fix it in the
runner, in two layers. Option A (small, ship now): at pause time, settle every
announced-but-unresolved sibling tool call with a deterministic "not executed, paused
for another approval" result before tearing the session down. Option B (follow-up,
medium): additionally synthesize approval requests for gated siblings whose args are
trustworthy, so the user approves everything in one dock pass and the cold replay
executes all of it in one resume. B contains A as its fallback; nothing is thrown
away. No frontend tool-name lists anywhere (hard constraint).

## Files

| File | What it holds |
|---|---|
| [context.md](context.md) | The bug, the framing decisions from Mahmoud, goals, non-goals. |
| [research.md](research.md) | Verified mechanics with file:line for every claim: the ACP wire trace, the CLI's serial gate scheduling, teardown cancellation, the FE orphan path, the resume machinery, corrections to the earlier findings doc. |
| [flows.md](flows.md) | Mermaid sequence diagrams and example frames: today's broken flow, Option A, Option B, each at the wire / stream / user level. |
| [options.md](options.md) | Both remedies with honest complexity assessments, why A is a stepping stone to B, the recommendation, and one independent flag about the FE force-settle pattern. |
| [plan.md](plan.md) | Phased implementation: files to change, tests (runner unit, FE unit, replay regression), live-stack verification, docs sync, open questions. |
| [status.md](status.md) | Current state and next steps. Source of truth for progress. |

## Prior art

- `docs/design/agent-workflows/scratch/approval-turn-duplication-findings.md`: the
  original investigation (both issues). Issue 1 (duplicate turn blocks from message-id
  churn) is out of scope here.
- F-040 pause contract: `services/runner/src/engines/sandbox_agent/pause.ts:1-27`.
