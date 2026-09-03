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
- Spike D makes immutable records more viable, but progressive tool writes and stable terminal IDs
  must change first.
- Records-versus-event-log remains an explicit reviewer gate.
- Final endpoint names remain open.

## Work in review

1. Warm cancellation and harness compatibility, PR #6496. Hold because Codex can leave a tool
   child process running and Daytona and Claude Code remain untested.
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

1. Prove Daytona and Claude Code warm Stop.
2. Prove restart behavior and durable continuity.
3. Prevent or quarantine output after watchdog terminal settlement.
4. Verify the post-Stop `running` and `alive` contract.
5. Design live-frame ingress and shared reading.

## Human review priorities

1. Confirm that the first Stop release is small enough.
2. Decide repaired records versus a separate session-event table after reviewing Spike D.
3. Confirm manual Stop behavior for queued input.
4. Review the public resource boundaries without focusing on final route spelling.
5. Assign owners for the independent spikes.

## Branch

`agent/session-execution-rfc`
