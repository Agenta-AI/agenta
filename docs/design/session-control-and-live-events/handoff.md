# Session control and live events handoff

> **AGENT-GENERATED, low weight.**

## Purpose

This document hands the design to independent reviewers. Read `README.md` first. Reviewers should
challenge their assigned contract and leave findings on draft PR #6495. Implementation starts only
after the contract baseline is reconciled.

## Work completed

The design began with two coupled user problems: Stop could leave sessions broken, and only the
initiating browser could receive raw live output. The work separated these into four runtime paths:
commands, live output, durable history, and ownership health.

The discussion settled public acceptance, optional execution guards, direct Stop delivery, warm
parking, post-Stop liveness, late-output rejection, temporary frames, durable ordering, reconnect,
Queue, Steer, and approval continuation. The overnight branches then tested the Stop and recovery
path across multiple harnesses and providers.

## Current design

- The API durably accepts session operations before reporting success.
- The API delivers Stop directly to the runner through a replaceable adapter.
- Redis ownership remains in version one.
- Heartbeats prove health and ownership.
- Stop records one outcome and preserves a safe warm sandbox.
- The runner sends temporary frames through the API into bounded Redis storage.
- Every client follows one API SSE connection.
- Complete records and lifecycle facts live in Postgres.
- A numeric per-session sequence supports snapshot and replay.
- A failed execution may lose its unconfirmed tail but cannot make the session unusable.

## Evidence incorporated

The evidence index links PRs #6496 through #6506. Confirmed runs include local and Daytona Stop,
Pi, Claude Code, Codex, output, tools, approvals, restart, runner loss, sandbox loss, Postgres loss,
and stale output. The integration branch passed thirteen scenarios against its implemented design.

The RFC rejected one implementation choice from that branch. Version one rejects records after
terminal settlement instead of storing them with `quarantined_at`. The watchdog package must change
and rerun that test.

## Review assignments

### Requirements and issue coverage

Confirm that every requirement describes a user or system outcome. Map each issue to the QA row
that would close it. Flag requirements with no evidence or owner.

### Public API and commands

Review `contracts/public-api.md` and `contracts/commands.md`. Check acceptance, idempotency,
optional execution guards, command settlement, direct-delivery failure, and interaction races.

### Events and clients

Review `contracts/events.md` and `work-packages/live-relay.md`. Check frame identity,
preview replacement, reconnect, slow readers, multiple API replicas, and migration from invoke and
watch behavior.

### Persistence and recovery

Review `contracts/persistence.md`, PR #6499, and the watchdog evidence. Check immutable record
feasibility, sequence allocation, legacy sessions, retention, incomplete history, and late-record
rejection.

### Harness and sandbox behavior

Review `work-packages/stop-and-recovery.md` and PR #6496. Check warm continuation, active children,
Codex ACP upgrade options, Daytona behavior, and shutdown grace.

### QA and execution dependencies

Review `qa.md`, `plan.md`, and `work-packages/README.md`. Find missing failure combinations,
incorrect dependencies, overlapping file ownership, and milestones that lack end-to-end proof.

## Blocking questions

`open-questions.md` contains the remaining blockers. The most important are repaired records,
exact durable event payloads, live-frame limits, Codex cancellation, and runner shutdown grace.

## Starting implementation

After review:

1. Reconcile findings into requirements, decisions, contracts, and QA.
2. Record the accepted contract-baseline commit in `status.md`.
3. Assign one owner and branch to each work package.
4. Start Stop and recovery beside live-relay measurement and frame-envelope work.
5. Integrate only at the checkpoints defined in `plan.md`.
6. Close issues only after their reproducing QA rows pass on the integrated commit.

## Branch state

- Repository: `Agenta-AI/agenta`
- Design branch: `agent/session-execution-rfc`
- Draft pull request: #6495
- Latest implementation evidence: PR #6506 and the individual package PRs it combines
- Long-poll backlog: Linear AGE-4253
