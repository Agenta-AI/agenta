# Session control and live events

> **AGENT-GENERATED, LOW WEIGHT, DRAFT.** This folder contains a provisional RFC. Mahmoud has not
> approved the architecture. Confirmed discussion decisions and AI-selected defaults are labeled.

## Reading order

1. [RFC](rfc.md) contains the proposed end-to-end architecture and migration.
2. [Decisions](decisions.md) separates confirmed direction from provisional AI choices.
3. [Requirements](requirements.md) maps open issues to required system behavior.
4. [Implementation plan](plan.md) divides the work into independent programs.
5. [Status](status.md) lists work that can start and the next human review priorities.
6. [Research](research.md) records verified repository and competitor findings.
7. [Record properties](records-invariants.md) analyzes current record durability and ordering.
8. [Tonight handoff](tonight-handoff.md) contains focused spike briefs.
9. [Context](context.md) describes the original problem and system boundary.

## Terms

- **Session:** One durable conversation and its workspace.
- **Conversation turn:** One user message and the resulting agent response.
- **Execution:** One runner attempt to advance a session.
- **Runner:** The service that starts a sandbox and drives the coding harness.
- **Harness:** The coding-agent program inside the sandbox, such as Pi or Claude Code.
- **Command:** A durable request that can change execution.
- **Input:** Durable user content waiting for or assigned to execution.
- **Live frame:** Temporary output such as a text delta or tool progress update.
- **Durable event:** An immutable saved fact used for replay and recovery.
- **Cursor:** An opaque point in committed durable session history.
- **Lease:** Temporary evidence that a runner remains alive and owns current work.

## Overnight and daytime evidence (agent-generated, low weight)

- `overnight-2026-09-02.md` is the log of the unattended night: every branch, stack, decision
  made on Mahmoud's behalf, and the revert path for each.
- `review-2026-09-02.md` merges the two RFC reviews; the full reviews are
  `review-architecture-2026-09-02.md` and `review-product-2026-09-02.md`.
- `implementation-plan.md` is the build plan, merge order, and gate cells for version one.
- Spike reports: `spike-a-sandbox-cancel.md`, `spike-b-durable-commands-design.md` with
  `api-design.md`, `spike-c-current-stop-map.md`, `spike-d-stable-record-ids.md`.
- Slice reports: `slice-admission.md`, `slice-watchdog.md`, `slice-stop-guard.md`,
  `slice-records-ack.md`, `slice-durable-cancel.md`, and `integration-2026-09-03.md`.
- `evidence-2026-09-03/` holds the daytime round: Daytona and Claude Code scenarios, runner
  restart, child-process cleanup, the watchdog stale tail, and the post-Stop liveness trace.
