# Session persistence contract

> **AGENT-GENERATED, low weight.**

## What happens today

Session records live on the analytics engine, while `session_streams` lives on the core engine.
The two rows cannot participate in one Postgres transaction. The records worker also drops records
for an over-quota organization, so tracing policy can remove conversation history.

New records still use progressive updates and timestamps do not provide one durable session order.
A terminal record does not yet provide the one database predicate that guards every later write.

## Retention gate

Retention separation is the first history task and a completion gate. Before records become
permanent session history, the implementation must exempt session records from tracing quota and
retention and add a session-scoped retention policy.

Until the gate passes, an over-quota drop marks `history_complete=false`. The history flag stays off
for permanent writes. A dedicated `session_events` table remains the fallback if retention or the
progressive-update audit proves records unsafe.

## Durable record properties

- The producer assigns a stable record ID before its first send.
- An identical retry is a no-op success.
- Reusing an ID with different content returns `409 record_conflict`.
- New durable records are immutable.
- Progressive text and tool data remain temporary until one complete checkpoint.
- The runner commits required checkpoints before terminal settlement or records an incomplete tail.
- A database compare-and-set on the execution row selects one terminal outcome.
- Every later record checks that row for every terminal cause.
- A failed terminal check leaves ingest work pending.
- Late output receives the nullable quarantine marker and stays out of canonical reads.

## Record ingestion

The runner sends frames and events through the existing Redis records ingest stream. The relay
consumer reads frames. The records worker ignores frames and stores durable events.

The worker acknowledges an entry only after the analytics Postgres transaction commits. A storage
failure leaves it pending for retry. One invalid record cannot discard unrelated valid records in
the same batch.

## Per-session ordering

The design adds a `session_cursors` table to the analytics database. The records domain alone owns
it. Each row has `session_id`, `latest_sequence`, and `updated_at`.

For each durable write, the records data access object locks the cursor and increments
`latest_sequence`. It inserts the record with that sequence and updates `updated_at` in the same
analytics transaction. The transaction commits the cursor allocation and record insert together.

Different sessions write concurrently. Writers for one session serialize only at this commit
boundary.

## Late output quarantine

The record write boundary checks the execution row for every terminal cause. A record that arrives
after terminal settlement receives the existing nullable quarantine marker. Canonical readers
exclude quarantined rows. The stored row remains available for accounting and support.

## Terminal settlement

The execution row stores terminal fields. Settlement uses a compare-and-set equivalent to:

```sql
UPDATE execution
SET terminal_state = :state, terminal_at = :time
WHERE id = :execution_id AND terminal_state IS NULL
RETURNING id;
```

The runner and watchdog use this operation. Only the winner writes the effective terminal event.
Reader filtering does not decide which outcome won.

Where the affected state shares a database, the command state, stopping marker, session mirror,
and interaction cancellation commit in one transaction. Redis liveness changes after commit
through an idempotent write, and the sweep repairs a missed write.

## Legacy records

Historical records keep null sequence values. The migration does not rewrite or reorder them. A
snapshot includes legacy and current history, while its cursor covers ordered writes made after the
migration.

Every durable write after the migration boundary allocates a sequence, including writes through
old endpoints. If an old mutable row changes, the writer appends a sequenced immutable checkpoint
for new readers. A path that cannot meet this contract remains off behind
`AGENTA_SESSIONS_HISTORY_WRITES`.

## Snapshot and incomplete history

The snapshot groups its response as `{session, execution, pending, read}`. `read` contains
`latest_sequence` and `history_complete`. Transcript records use bounded cursor pagination from one
consistent database watermark.

A runner crash can lose an unconfirmed in-memory tail. The watchdog then records `lost`, sets
`history_complete=false`, releases the session, and permits another message. Previously committed
records remain readable.
