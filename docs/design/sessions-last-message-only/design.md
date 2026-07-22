# Last-message-only sends + server-side history reconstruction

**Branch:** `feat/sessions-last-message-only` (off `feat/sessions-storage-rework` / #5436)
**Motivation:** AGE-3970 (trace-drawer OOM on long turns) + device-independent continuity.
Shrink request/trace payloads by sending only the newest user message per turn and
reconstructing prior conversation server-side from durable session **records**.

## Decisions (locked)
- **Reconstruction lives in the runner (TS)** — at the `buildTurnText`/`priorMessages` seam,
  reusing the runner's records client + session plumbing; a TS↔TS port of the FE
  `transcriptToMessages.ts` folding. (Shared infra with JP/Mahmoud — keep additive/flagged.)
- **Harden records durability FIRST**, before the FE trusts reconstruction — so reconstructed
  history is authoritative, not lossy.

## Current architecture (verified FE / SDK / runner / api)
Two continuity paths already exist in the runner:
- **Warm** (pool hit / same harness authored last turn): harness native `resumeSession()`
  supplies history; `sendLastMessageOnly` is ALREADY true (`runtime-contracts.ts:168`).
- **Cold** (evicted / different harness / cross-device): runner rebuilds the full transcript
  from inbound `request.messages` (`transcript.ts:buildTurnText`/`priorMessages`; selected at
  `run-turn.ts:134`).

The FE always sends full history (`agentRequest.ts:401`) because it can't predict warm/cold.
Records are **write-only** from the run's perspective: the runner persists every event
per-turn (`persist.ts` → `POST /sessions/records/ingest`) but never reads them back for model
context. Records ARE sufficient to reconstruct full ordered history (roles, text, reasoning,
tool_call/tool_result, approvals) — each carries the whole ACP `AgentEvent`.

## Hard constraint: HITL cold-replay
Resume is message-driven, not interaction-driven. The runner binds tool_result→tool_call by
scanning `request.messages` (`responder.ts:413,470`) and scans full history for approval
verdicts (`responder.ts:358`). Durable `session_interactions` rows exist but aren't read to
rebuild history. ⇒ Dropping history on a cold resume breaks approvals/client-tools/elicitation
until the runner reconstructs matched tool_call/tool_result pairs from records. **The BE
reconstructor + durable records are the prerequisite for the FE change.**

## Phases
- **Phase 1 — records durability** (enabler): make `message` + `tool_result` (and `tool_call`,
  `interaction_request`) record persistence reliable end-to-end — reduce the runner's
  fire-and-forget drop (ack/retry-to-DLQ) and fix the 64 KB attribute cap
  (`records/streaming.py`) for tool bodies (raise + spill). Order records by
  `session_turns.turn_index` then `record_index`.
- **Phase 2 — runner reconstructor**: new `services/runner/src/sessions/` module folds
  records→`ChatMessage[]` (inverse of `buildPersistingEmitter`); generalize
  `sendLastMessageOnly` to fire whenever `session_id` yields reconstructable history; feed
  `buildTurnText`/`priorMessages` + otel `run.start`. Behind a flag; FE unchanged.
- **Phase 3 — FE last-message-only**: `buildAgentRequest` sends only the trailing user message
  when the session is server-known with records; falls back to full history otherwise. Trace/
  request payloads shrink → AGE-3970 mitigated.

## Open risks tracked
- Runner is ephemeral: guaranteeing delivery may mean blocking the run on a persist ack
  (latency) or a durable outbox — Phase 1 decides the mechanism.
- Interaction-row verdict as a backstop source (if a settled answer must survive without the
  last message) — evaluate in Phase 2.
