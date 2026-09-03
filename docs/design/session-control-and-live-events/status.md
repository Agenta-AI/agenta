# Status

> **AGENT-GENERATED, LOW WEIGHT, DRAFT.** This status was prepared autonomously on 2026-09-02 for
> human review on the next working day.

## Current state

- The RFC has a complete provisional architecture.
- Confirmed founder decisions are separated from AI-selected defaults.
- The first version keeps current Redis execution ownership.
- Durable Stop uses direct API-to-runner delivery behind a replaceable port.
- Runner-initiated long polling is designed but parked in Linear AGE-4253.
- Stop requires warm sandbox and harness resume.
- Shared live frames use one canonical backend path in the target design.
- The read contract uses one JSON snapshot plus one long-lived event connection. A new session
  starts at sequence zero. Only committed durable events advance the database-assigned per-session
  sequence; temporary frames do not.
- Normal completion promotes queued input in first-in, first-out order. Manual Stop pauses the
  queue. Steer saves its input before stopping current work and promotes that input before older
  queued input; older input remains visible and pending.
- Approval keeps its current continuation model: the requesting execution ends, the interaction
  remains durable, and an answer starts a new execution. A new durable `execution.waiting` fact
  makes this existing condition explicit to readers.
- The accepted answer, continuation execution, and continuation command commit together. Delivery
  can retry afterward. A failed continuation keeps the answer and leaves the session usable.
- Stop and interaction responses use first-commit-wins serialization. Execution guards remain
  exact and never silently target a continuation execution.
- Spike D makes immutable records more viable, but progressive tool writes and stable terminal IDs
  must change first.
- Records-versus-event-log remains an explicit reviewer gate.
- Final endpoint names remain open.
- The public interface exposes explicit session operations while the durable command store remains
  private. Existing routes remain during migration; final route spelling is deferred.
- Temporary frames have bounded age and size. A slow reader is disconnected and reloads the
  durable snapshot; it never slows the runner. Measurements set the numeric limits.
- Postgres assigns per-session sequence under a `session_streams` row lock in the record-insert
  transaction. Legacy records stay unsequenced. Replay subscribes before reading and treats Redis
  notifications only as wake-up signals.
- HTTP reports admission results through commit. New durable work and identical retries return
  stable accepted IDs. Later execution outcomes arrive through the event stream. Idle unguarded
  Stop is a successful no-op; stale guarded Stop conflicts.
- Warm Stop is confirmed by live evidence for Pi and Claude Code on Daytona and Pi, Claude Code,
  and Codex locally. Model-output, active-tool, and pending-approval cases resumed in the same
  sandbox and native harness session.
- Stop settlement clears `running`, keeps `alive` during safe parking, and updates the Postgres
  session-row mirror. Normal idle expiry later clears `alive`.
- Version one rejects output after terminal settlement. It does not add a quarantine table.
- The release validation contract is recorded in [qa-matrix.md](qa-matrix.md).

## Work in review

1. Warm cancellation and harness compatibility, PR #6496. Core warm cancellation is proven.
   Codex child cleanup still needs Daytona verification and comparison against a current Codex ACP
   version.
2. Durable command and transport design, PR #6497.
3. Current Stop path map, PR #6498.
4. Stable record-ID semantics, PR #6499. Evidence only. Its focused tests pass, but the new runner
   test file currently fails TypeScript typechecking and the producer migration is not built.
5. Concurrent-send admission, PR #6500.
6. Dead execution watchdog, PR #6501.
7. Record acknowledgement after Postgres commit, PR #6502.
8. Durable Stop with direct delivery, PR #6503.
9. Stop guard, approval cancellation, and client behavior, PR #6504.
10. Overnight evidence and integration, PRs #6505 and #6506.

## Work ready to start

1. Verify Codex child cleanup on Daytona and test a current Codex ACP version.
2. Implement rejection of records after terminal settlement on the watchdog branch.
3. Verify the final runner shutdown grace period.
4. Design live-frame ingress and shared reading.

## Human review priorities

1. Decide repaired records versus a separate session-event table after reviewing Spike D.
2. Review the public resource boundaries without focusing on final route spelling.
3. Set measured live-frame retention and slow-reader limits.
4. Decide the final endpoint names.

## Branch

`agent/session-execution-rfc`
