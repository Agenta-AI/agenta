# Session control and live events

> AGENT-GENERATED, low weight. Draft for discussion. Mahmoud makes final decisions.

This folder holds the design work for session execution control, shared live output,
durable event replay, and durable commands.

## Reading order

1. [Context](context.md) explains the user problems and the current system boundary.
2. [Requirements](requirements.md) lists the open issues and draft system requirements.
3. [Decisions](decisions.md) separates confirmed decisions from proposals and open questions.
4. [Plan](plan.md) defines the design tracks and the order of discussion.
5. [Research](research.md) records verified repository findings and external dependency checks.
6. [Record properties](records-invariants.md) evaluates the existing record model before storage
   options are compared.
7. [RFC](rfc.md) is the living architecture proposal. It remains incomplete until each track is discussed.
8. [Status](status.md) records current progress and the next discussion.
9. [Tonight handoff](tonight-handoff.md) contains independent spike and implementation briefs.

## Added on the night of 2026-09-02 (agent-generated, for morning review)

Read `overnight-2026-09-02.md` first. It is the log of what was done, where every branch is,
and how to revert each piece.

10. [Review](review-2026-09-02.md) merges two reviews of the RFC and lists the decisions Mahmoud
    must make. The full reviews are `review-architecture-2026-09-02.md` and
    `review-product-2026-09-02.md`.
11. [Implementation plan](implementation-plan.md) is the build plan for version one, the merge
    order, and the gate cells.
12. Spike results: [A, sandbox cancel](spike-a-sandbox-cancel.md),
    [B, durable commands and long polling](spike-b-durable-commands-design.md) with its
    [route contracts](api-design.md), [C, the current Stop map](spike-c-current-stop-map.md),
    [D, stable record ids](spike-d-stable-record-ids.md).
13. Code slices, each on its own branch: [admission](slice-admission.md),
    [watchdog](slice-watchdog.md), [Stop guard](slice-stop-guard.md),
    [records durability](slice-records-ack.md), [durable cancel](slice-durable-cancel.md).

## Terms under review

- **Session:** One durable conversation and its workspace.
- **Execution:** One runner attempt that can start, pause, complete, fail, or be cancelled.
- **Conversation turn:** One user message and the resulting agent response. One conversation turn
  can contain several executions when an approval pauses and resumes work.
- **Runner:** The service that starts a sandbox and drives the coding harness.
- **Harness:** The coding-agent program inside the sandbox, such as Pi or Claude Code.
- **Live frame:** A temporary output update, such as a text delta or tool progress update.
- **Durable event:** An append-only saved fact used for replay and recovery.
- **Command:** A saved request to send, cancel, approve, queue, or steer.
- **Lease:** Temporary proof that one runner owns a session or execution.

The names are provisional. The contract discussion must settle how these terms map to the
existing `turn_id` and `turn_index` fields.
