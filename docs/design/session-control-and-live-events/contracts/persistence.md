# Session persistence contract

> **AGENT-GENERATED, low weight.**

## Durable record properties

- The producer assigns a stable record ID before its first send.
- An identical retry is a no-op success.
- Reusing an ID with different content returns `409 record_conflict`.
- New durable records are immutable.
- Progressive tool arguments and results remain temporary until the runner emits a complete
  checkpoint.
- Terminal settlement waits for required checkpoints for a bounded period.
- A committed terminal outcome closes durable history for that execution.
- Later output returns non-retryable `409 execution_terminal` and is not stored.

## Record ingestion

The API adds accepted record work to the durable Redis ingest stream. The records worker
acknowledges an entry only after the Postgres transaction commits. A storage failure leaves the
entry pending for retry.

One invalid record must not silently discard unrelated valid records from the same batch.

## Per-session ordering

Add nullable `session_streams.latest_sequence` and `session_records.session_sequence` fields. For
each new durable write, the records service locks the session stream row, increments the latest
sequence, inserts the record with that sequence, and commits both changes together.

Different sessions can write concurrently. Writers for one session serialize at this short commit
boundary.

## Legacy records

Existing records retain null sequence values. The migration does not rewrite or reorder them. A
snapshot includes all legacy and new history. Its cursor describes only the ordered new portion.
Existing clients ignore the new fields.

## Incomplete history

The runner may buffer unconfirmed checkpoints in memory. A runner crash can lose that tail. The
watchdog then records `lost`, marks history incomplete, releases the session, and permits another
message. Previously committed records remain available.

The API also marks history incomplete when quota, retention, truncation, or unrecoverable delivery
loss prevents full reconstruction.

## Retention

Permanent session history cannot depend on tracing retention or quota. Implementation must separate
those policies before repaired records become the permanent session event log. A separate
`session_events` table remains the fallback if that separation proves unsafe.
