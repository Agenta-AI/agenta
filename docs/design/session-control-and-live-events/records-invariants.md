# Record properties and current violations

> AGENT-GENERATED, low weight. Draft for discussion. Mahmoud makes final decisions.

This note evaluates whether the existing `records` model can become the replayable session event
history. It does not select a storage option.

## What records do today

Records are a durable conversation representation. The runner sends raw `AgentEvent` values to
the live response, but coalesces text and thought deltas before record ingest. Tool-family events
can use deterministic IDs. The API publishes records into a dedicated Redis Stream. A worker
writes them into the tracing Postgres database. The frontend fetches the full record collection
and reconstructs `UIMessage[]`.

Records are therefore closer to a durable transcript projection than a raw transport log.

## Properties required for the current transcript

The current transcript and harness reconstruction need these properties:

1. **Durability.** An acknowledged durable fact survives client, API, runner, and worker restarts
   within the configured retention period.
2. **Complete produced order.** Reads preserve the causal order of user messages, assistant
   messages, tools, interactions, and terminal markers.
3. **Idempotent retry.** Retrying one logical fact does not create a duplicate or change its place
   in history.
4. **Stable correlation.** Messages, tools, interactions, turns, and executions keep stable IDs so
   later facts can refer to earlier ones.
5. **Detectable incompleteness.** If retention, truncation, quota, or delivery failure prevents
   complete reconstruction, the system reports that condition instead of silently replaying a
   partial conversation.
6. **Client independence.** Persistence does not depend on a browser connection.

## Additional properties required for cursor replay

A `snapshot + events after cursor` interface adds these requirements:

1. **Immutable history.** Once a durable event is visible at a cursor, its payload and position do
   not change.
2. **Monotonic commit order.** Every committed event gets an order that only moves forward. A
   cursor can request all later events without scanning or comparing timestamps.
3. **Atomic visibility.** An event becomes replayable only after its durable write commits.
4. **Replay-to-live handoff.** A reader cannot miss an event between reading history and joining
   the live tail.
5. **Stable event identity.** A producer retry maps to the same logical event and does not create a
   second cursor entry.

The sequence does not need to be dense or start at one for each session. It only needs to be
strictly increasing and stable. A table-global database sequence can serve session-filtered reads;
gaps from other sessions are harmless.

## Current violations

### Some rows are mutable

The primary key is `(project_id, record_id)`. `append` and `append_many` use
`ON CONFLICT DO UPDATE`. A conflict overwrites:

- `record_type`
- `record_source`
- `timestamp`
- `attributes`
- `turn_id`
- `span_id`

The runner supplies deterministic UUIDv5 IDs for `tool_call`, `tool_result`,
`interaction_request`, and `interaction_response` families. The stable ID lets repeated snapshots
or retries target one row. The DAO deliberately keeps the last payload.

This supports a latest-state model. It violates immutable event history.

### Record IDs do not encode order

The design document proposed UUIDv7 IDs, but the implementation does not use them:

- Tool-family records use deterministic UUIDv5 IDs.
- Other records receive backend-generated UUIDv4 IDs.

UUIDv4 and UUIDv5 values are not time ordered. A client cannot use `record_id` as an `after`
cursor.

### Current read order is reconstructed from three fields

The DAO orders records by:

1. Producer `timestamp`.
2. Database `created_at`.
3. Per-turn `record_index`.

`record_index` restarts at zero for each execution. `created_at` can be shared by records in one
worker batch. Producer timestamps have clock and resolution limits. The composite order is useful
for transcript rendering, but it is not a stable cursor.

An upsert also overwrites `timestamp`. A retry or later snapshot can therefore move an existing
row to a different place in the read order.

### Retry identity is inconsistent

Tool-family records have deterministic IDs and upsert on retry. Most message, thought, usage,
error, and terminal records omit `record_id`; the API mints a new UUIDv4 for every ingest.

If Redis accepted the first request but the HTTP response was lost, a runner retry without a
stable ID can create a duplicate durable row. The system therefore uses idempotent retry for some
record types but not all record types.

### Worker failures can acknowledge unwritten records

The records worker adds every successfully decoded Redis message ID to `processed_ids` before it
attempts the Postgres batch write. If `append_many` fails, the worker logs the failure and
continues. It still returns those IDs to the shared consumer loop, which acknowledges and deletes
them from Redis.

This is not an inherent Redis Streams limitation. It is an acknowledgement bookkeeping defect.

### Runner delivery is bounded and can drop

The runner retries record ingest a bounded number of times. After the limit, it records an
in-memory failure count and drops the record. The turn-end drain can mark reconstruction unsafe in
that runner process, but the missing fact never reaches the durable history.

Bounded retry prevents an unavailable API from hanging execution forever. Permanent silent loss
is not required by that constraint. Accepted inputs and terminal outcomes need a recoverable
delivery source outside one runner process.

### Retention, quotas, and truncation intentionally limit completeness

Records live in the tracing database and have their own retention policy. Attributes larger than
64 KB are truncated before Redis ingest. Enterprise quota rejection can also skip a batch.

These are real product and operational constraints. Any design that uses records for session
reconstruction or event replay must define what happens after retention, truncation, or quota
loss. Calling the collection complete without marking these conditions would be incorrect.

## Structural reasons behind the current design

### Coalescing is structurally useful

Persisting every token permanently would increase write volume and storage significantly. The
durable transcript needs completed messages, not every typing-animation fragment. Coalescing raw
text into a completed message is compatible with an append-only durable log.

### Retries and deduplication are structurally required

Network and worker delivery is at least once. Stable event IDs and duplicate handling are
required. Mutating an existing row is not required. A final immutable fact can use
`ON CONFLICT DO NOTHING` after every durable event receives a stable producer ID.

### Progressive tool snapshots do not require mutable durable history

A live tool call can publish several argument snapshots. Those snapshots can remain temporary.
The durable model can append distinct facts such as `tool.started` and `tool.completed`, or append
one final `tool_call` fact. Reusing one ID and replacing its payload is a chosen projection model,
not a storage necessity.

### A dense per-session counter is not required

The earlier design rejected a dense per-session sequence because concurrent writers would need a
counter row, lock, or serializable retry. Cursor replay does not need dense per-session numbers. A
global Postgres sequence provides strict commit order without per-session counter contention.

### The asynchronous Redis worker is structurally useful

Redis decouples runner latency from Postgres latency and absorbs bursts. It does not require the
worker to acknowledge failed database writes. Only successfully committed message IDs should be
acknowledged.

### Retention remains a real constraint

If session history must outlive tracing retention, the existing records location cannot meet that
requirement without changing retention or storage. If session history follows record retention,
the tracing database remains viable. This is a product decision, not an ordering limitation.

## Changes that could make records satisfy the properties

The existing records model could become an append-only replay source if it changes as follows:

1. Give every durable logical event a producer-generated stable `event_id` before its first send.
2. Make durable inserts immutable. Duplicate `event_id` writes become no-ops or verified identical
   duplicates.
3. Add a database-assigned monotonic sequence. It can be global while reads remain filtered by
   session.
4. Keep temporary deltas and progressive snapshots outside permanent records. Append only durable
   starts, completions, interaction changes, and execution lifecycle facts.
5. Preserve stable message, tool, interaction, and execution IDs inside event payloads.
6. Acknowledge Redis messages only after their Postgres transaction commits.
7. Store or recover unacknowledged runner output across runner loss for required durable facts.
8. Mark a session history incomplete when truncation, quota, retention, or unrecoverable delivery
   loss creates a gap.
9. Register the live wake-up before reading history so replay-to-live handoff cannot miss a commit.

These changes are substantial, but there is no proven ordering or retry constraint that forces a
separate event table. The separate-table option must instead justify itself through schema scope,
retention, migration risk, or the desire to keep transcript projections distinct from lifecycle
events.

## Questions to answer before comparing storage options

1. Must durable session history outlive tracing-record retention?
2. Should records contain all session lifecycle facts, or only conversation facts?
3. Is the existing records API an internal projection, a public event contract, or both?
4. Can we migrate current upsert rows to immutable events without breaking harness reconstruction?
5. Does one global sequence meet operational scale requirements?
6. Which durable facts must survive a runner crash before they reach Redis?
