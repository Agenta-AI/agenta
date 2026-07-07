# Session keep-alive: context

## Why this work exists

The agent has no memory across turns. Every turn, normal or approval-resume, destroys the harness session and cold-starts a fresh one. The new session receives the whole conversation as one flattened text block, so the model never sees its own structured history. On an approval, a fresh model has to re-issue the approved tool call from that lossy text, and it drifts or restarts the task. Two real production turns failed this way. The full analysis is in [../approval-boundary/cold-replay-failure-report.md](../approval-boundary/cold-replay-failure-report.md).

Keep-alive is the "simple solution" from that report (Part 3, option 2). It keeps the session alive for a short TTL after a turn ends, so the next message continues the same live session with full native memory, and an approval holds its permission request open instead of destroying the session.

## Goals

- Keep the harness session alive for a TTL after a turn ends, keyed on the conversation `session_id`.
- Continue the live session on the next message when the config and history still match.
- Hold the pending permission request open across an approval so the original tool call runs with its exact original arguments.
- Fall back to today's cold replay whenever the window expires or anything does not match. Never fail a turn.
- Ship flag-gated and local-only first. Flag off means byte-identical behavior.

## Non-goals

- No wire, SDK, or frontend change. The `session_id` key already rides the wire.
- No storage change. Persisting harness session files across restarts is session resume (option 3), a separate feature.
- No multi-replica routing. A pool miss degrades to cold replay; affinity routing is future work.
- Not a replacement for session resume. The two compose: keep-alive is memory within the TTL window; session resume is memory across restarts and long gaps.

## Background

- The runner is a long-lived single-replica Node daemon on port 8765. Per-process in-memory state already exists (`inFlightSandboxes`, the replica id, the `owner:session` affinity keys). A `Map<sessionId, LiveSession>` pool is viable today.
- The `sandbox-agent` package (0.4.2) already supports repeated `prompt()` calls on one session, re-attachable `onEvent` and `onPermissionRequest` listeners (both return unsubscribe functions), and `respondPermission(id, reply)` callable at any later time.
- The full code-grounded research, including the exact line references and the design, is in [architecture-notes.md](architecture-notes.md). This plan builds on it by reference and does not repeat it.

## Relation to the other features

- **Cold-replay failure report** (option 1, text-replay fixes): a separate track that lands regardless. It reduces the damage of cold replay but cannot restore structure or thinking.
- **Harness session resume** ([../harness-session-resume/plan.md](../harness-session-resume/plan.md), option 3): the target architecture for memory across restarts. Build it after keep-alive. It reuses keep-alive's fingerprint and skip-flatten seams.
