# Decisions

> **AGENT-GENERATED, LOW WEIGHT, DRAFT.** Confirmed items record the contract-baseline direction
> after the 2026-09-03 reviews. Mahmoud still owns the choices in `open-questions.md`.

## Current constraints

The browser that invokes work owns the original live response today. Redis holds liveness, the
records ingest stream feeds an analytics database, and `session_streams` lives in the core
database. The records worker also drops records when tracing quota rejects them.

These constraints rule out a cross-database sequence transaction and make retention separation a
hard gate for durable session history.

## Public operations stay separate from private commands

Version one keeps Send on the existing invoke operation and adds `on_busy` plus
`Idempotency-Key`. It keeps `POST /sessions/{session_id}/cancel` as the public Stop route. The
generic `POST /sessions/{session_id}/commands` route does not ship in version one.

The durable command table remains private. Queue and Steer receive a public route only when their
package defines the pending-input transaction and clients can display that state.

The API returns acceptance only after its transaction commits. The data access object compares a
canonical request fingerprint when an idempotency key repeats. An identical retry returns the
first stable IDs. A different request returns `409 idempotency_key_reused`.

## Stop is durable, direct, and guarded

Direct authenticated API-to-runner delivery carries normal Stop. Heartbeats prove health and
ownership but do not carry normal Stop delivery. Runner-initiated long polling remains parked in
[Linear AGE-4253](https://linear.app/agenta/issue/AGE-4253/parked-add-runner-initiated-long-polling-for-session-commands).

The command transport exposes one port: `deliver(command) -> receipt`. The command service owns
settlement, retry scheduling, and recovery. Stop must not reuse `streams/runner_client.py` because
that client swallows delivery failures by design.

`expected_execution_id` is the guard name in public and private contracts. It remains optional,
and first-party clients send it when known. An unguarded Stop targets current work at API
acceptance. A guarded mismatch leaves the current execution untouched.

## Accepted Stop always reaches an outcome

A recovery sweep redelivers a `pending` command while its session still beats. It uses the same
command ID and bounded attempts. If the runner is gone, the sweep settles the command and execution
as `lost`.

The execution row selects one terminal winner with a compare-and-set. Terminal fields change only
while they are null. The runner and watchdog use the same operation, and only the winner writes the
effective terminal event.

Where the data shares a database, one transaction settles the command, clears the stopping marker,
updates the session mirror, and cancels interactions. Redis liveness changes after commit through
an idempotent write. The sweep repairs a missed Redis write.

The runner normally writes the ending, clears `running`, and parks the sandbox. If the runner
cannot settle, the watchdog writes the ending, clears `running`, releases `alive`, and updates the
mirror. Each watchdog pass has a time bound and logs timeouts.

## Stop preserves safe warm state

Stop is distinct from Delete. Stop preserves the session, workspace, and native harness session
only after the runner proves that the harness and tool children ended. Unsafe cleanup destroys or
isolates the sandbox and never advertises warm resume.

The desktop shows `stopping` while it waits for API acceptance. It shows `stopped` only after the
terminal event. A failed request restores `running` and reconnects or refreshes its observation.

Five seconds is the Stop alert threshold. Current evidence is below 300 milliseconds. A release
above one second needs a written reason. Abandoned work settles within 150 seconds, and clients show
`recovering` during that window.

## Durable history uses repaired records after two gates

Records remain the proposed source for durable history. Before immutable writes start, the history
package must separate session retention from tracing quota and confirm that every progressive tool
update became a temporary frame. Retention separation is the first task and a completion gate.

The migration adds nullable sequence fields and does not rewrite old rows. Every durable write
after the migration boundary receives a sequence, including writes through compatibility
endpoints. A path that cannot allocate a sequence stays off behind
`AGENTA_SESSIONS_HISTORY_WRITES`.

Sequence allocation belongs to the records domain and must commit with the record. Mahmoud still
must choose between a small cursor table on the analytics engine and moving records to core. The
analytics cursor is the recommended baseline.

## Terminal state guards every later record

The record write boundary checks the execution row for every terminal cause. A database failure
leaves ingest work pending instead of admitting it without a check. Late output never appears in
canonical session history.

Whether the implementation rejects or quarantines late output remains open. The current code keeps
quarantine behind the history flag until Mahmoud decides.

## Temporary frames reuse the records ingest stream

The runner sends temporary frames and durable events through the existing records ingest stream.
An explicit `kind` distinguishes `frame` from `event`. A frame carries a per-execution
`frame_index`; a durable event carries a per-session `sequence`.

Redis applies `MAXLEN` to each stream. The measured long case used about 3,200 frames and 200 KB per
turn. The contract keeps the measured 15-minute and 100,000-frame bounds until new measurements
justify a change.

## Version one freezes six durable events

The first event vocabulary contains `execution.started`, `execution.stopped`,
`execution.failed`, `execution.lost`, `message.completed`, and `tool.completed`. Each has a typed
payload in [`contracts/events.md`](contracts/events.md). The envelope is versioned, and the reducer
ignores unknown event types.

Approval, input, waiting, and other lifecycle events ship with their packages.

## One snapshot and reducer serve every client

The snapshot groups data as `{session, execution, pending, read}`. The `read` object contains
`latest_sequence` and `history_complete`, while transcript records use bounded pagination.

Session API and durable state live in `web/packages/agenta-entities/src/session`. Transport and
preview reduction live in `web/packages/agenta-chat`. SSE evolves from
`web/packages/agenta-sessions/src/watch`. New request and response calls use the Fern client. SSE
is the stated exception.

Event connections revalidate project access on a bounded interval or reconnect within 15 minutes.
Frame ingress verifies the execution ID and owner claim, not only the shared runner token. Logs
contain identifiers only and never message content or tokens.

## Queue, Steer, and approvals ship separately

Version one rejects busy Send until every enabled client displays pending input. Manual Stop pauses
promotion. Steer saves input before Stop and promotes it before older queued input after settlement.

Durable approvals ship before Queue and Steer. One transaction accepts an interaction response and
creates its continuation execution and command. Stop and response transactions lock the execution
then the interaction and use exact state predicates, so only one wins.

## Ordered release and rollback

The delivery order is pure fixes, Stop and recovery, history producer and retention, secondary
shared reading, sender migration, durable approvals, Queue, then Steer. The first three behavior
changes use env-backed switches read through `env.py`: `AGENTA_SESSIONS_DURABLE_STOP`,
`AGENTA_SESSIONS_HISTORY_WRITES`, and `AGENTA_SESSIONS_SHARED_READER`.

Turning a switch off returns clients and writers to the mounted old path. Project allowlists and
capability advertisement remain an open rollout choice.

## Operational contract

The release measures commands admitted, delivered, applied, obsolete, and lost. It also measures
Stop delivery latency, harness cancel latency, watchdog settlements, late-record handling, and
sweep pass duration. Session and execution identifiers belong in structured logs, not metric
labels.

## Deferred scope

Version one defers Postgres execution ownership, ownership generations, multi-runner guarantees,
and permanent token storage.

## Remaining decisions

[`open-questions.md`](open-questions.md) contains only the seven choices that remain for Mahmoud.
