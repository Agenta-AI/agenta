# Options

Each option below says how it works, what it changes, what it costs, and how it behaves when
Redis restarts or fails over, when a message is delivered twice, and when several API replicas
run at once. The recommendation is at the end.

The managed deployments run several API replicas and a managed Redis with one replica. Redis
copies writes to its replica in the background, so a failover can lose the last writes made before
it. Self-hosted Docker Compose runs one stream worker container, and the Helm chart defaults to
one `workerStreams` replica, so self-hosted users mostly see the correct order today.

## Option 1: assign `sequence` at ingest with a Redis counter

### How it works

`publish_record` runs one Lua script on the durable Redis for each record. The script increments a
per-session counter (`INCR records:seq:{project_id}:{session_id}`) and adds the record to the stream
with the new number in the message. Both happen in one script, so a record never gets a number
without reaching the stream. The worker writes the number it receives into `records.sequence`
instead of taking one from `session_sequence_cursors`.

The counter must start from the right value. When the key does not exist (a new session, an
expired key, or a Redis that lost data), the API first reads `max(sequence)` for the session from
Postgres and passes it to the script, which sets the key only if it is still missing. The key gets
a time to live, for example seven days, renewed on each increment.

Because numbers are now given out before the commit, a record with number 55 can commit before the
record with number 54. The "everything after N" rule therefore no longer holds by itself. The
cursor table must change meaning. `latest_sequence` becomes the highest number below which every
number is either committed or known to be missing for good. The worker advances it only across
an unbroken run of committed numbers.

### What creates gaps, and how they are closed

The counter can skip numbers for several reasons, and each skip blocks the cursor until something
closes it:

- The runner retries a timed-out request, and the API publishes the same record twice with two
  numbers. The second insert is an upsert on the same `record_id`, so its number is never used.
- The worker drops a message on purpose, because it cannot be decoded or because the organization
  is over its quota.
- A Redis failover loses the last increments, and the reseed from Postgres skips forward to stay
  safe.

To close a gap, the worker must record the missing number, for example in a small table of
skipped numbers per session, or it must advance past a gap after a timeout. A timeout brings back
the original risk: a reader that moved past the gap can miss the late record for good.

### Failure modes

- **Redis failover.** The new primary can hold an older counter value. The next increment then
  hands out a number that a stored record already has. The unique index
  `ux_records_session_id_sequence` rejects the row, and the worker treats the rejection as a bad row
  and sets it aside, which loses the record. To avoid that, the API must detect the failover and
  reseed every active counter from Postgres plus a safety margin, and the margin creates more gaps.
- **Redis restart with data loss.** The same as a failover, for every session at once.
- **Duplicates.** Handled by the upsert, at the cost of a gap per duplicate.
- **Several API replicas.** Safe, because `INCR` is atomic in Redis.

### Costs and side effects

- The ingest request gains one Redis script call, and a Postgres read for each new session.
- The cursor stops being a plain counter. Every reader that relies on "everything after N",
  including the live catch-up replay and the paged transcript, must be checked against the new
  gap rule, and the gap bookkeeping is new code in the hottest write path.
- Correctness now depends on Redis keeping a counter, which the managed Redis does not guarantee
  across a failover. Today Redis loss only delays records. With this option it can lose them.
- Several consumers can keep running, so throughput can still scale.

## Option 2: one consumer owns each session

### How it works

The API publishes each record to one of N shard streams, `streams:records:{k}`, where `k` is a
hash of the session id modulo N. Each shard is read by exactly one consumer at a time. The worker
replicas share the shards through leases: a replica owns shard `k` while it renews the key
`records:shard:{k}:owner` with `SET NX PX` every few seconds, and it reads only the shards it owns.

Within a shard, the consumer must not let a newer record commit before an older one of the same
session. So when a batch fails for a temporary reason, the consumer retries its own pending
messages (`XREADGROUP` with ID `0`) before it reads new ones. The shard stops until the database is
back, which is the correct behaviour for an ordered log.

### Migration

The cut-over must not mix old and new streams for one session. First, deploy workers that read
both the old stream (with one consumer) and the shard streams. Second, switch the API to publish
to the shards. Third, remove the old stream reader once the old stream is empty. Changing N later
moves sessions between shards, so it needs the same drain.

### Failure modes

- **Redis failover.** A lost lease key lets a second replica take a shard while the first still
  holds a batch. Both can write one batch each for the same session, which can reverse the order
  for that moment. Each consumer must check its lease before each batch to keep the window short.
- **Duplicates.** Unchanged from today. A repeated `record_id` keeps its first number.
- **Several API replicas.** Safe, for the same reason as today: the runner waits for each answer.

### Costs and side effects

- Lease handling, shard routing, and the migration are new and hard to test.
- A stalled shard (for example, one slow transaction) stops every session in that shard.
- The commit order property stays as it is, so no reader needs to change.
- Throughput scales with N, so this is the option to choose if one consumer is ever too slow.

## Option 3: order by turn and `record_index` on read, keep `sequence` as a cursor only

### How it works

The server leaves the write path alone. Every read that returns a transcript sorts by the runner's
order instead of by `sequence`: first by the turn's position in the session, then by
`record_index`, then by `sequence` to break ties. The turn's position is the lowest `sequence` of
the turn, computed in the query with `min(sequence) OVER (PARTITION BY turn_id)` or stored in a
new column when the first record of a turn is written. `sequence` keeps its role as the cursor, so
"everything after N" works as it does today.

### Costs and side effects

- Only full reads are fixed. A reader that already holds records up to N and asks for the records
  after N can receive a record that belongs before some it already has. Every incremental reader,
  including the live events stream and the frontend durable event reducer, must insert by the new
  key instead of appending.
- A page bounded by `through_sequence` can hold a tool result and not its call, when the call got
  the higher number. The reader must accept that partial state.
- `liveCommittedRevisions` must sort by the new key before it walks the records.
- The window function makes each page query sort the whole session. Sessions are small today, but
  the cost grows with session length unless the turn position is stored.
- No data migration and no backfill are needed, because all recent rows have the needed columns.
- The order of the live events is still the commit order, so the frontend must keep the change that
  renders a result before its call.

## Option 4: run a single active records consumer

### How it works

Only one consumer reads the records stream at a time. The other stream loops (spans, events, and
the live relay) keep their replicas. There are two parts:

1. First, a deployment change. The records loop runs in its own worker deployment with
   `AGENTA_WORKER_STREAMS` set to the records stream, one replica, and the `Recreate` update
   strategy, so a rollout stops the old pod before it starts the new one. The existing
   `workerStreams` deployment drops the records stream from its list. The public Helm chart needs a
   way to run this second deployment.
2. Second, a guard in code. Before each batch, the records worker renews a lease in Redis
   (`SET records:consumer:lease <name> NX PX 15000`, or a renewal when it already owns it). A
   replica that does not hold the lease does not read. The guard keeps the order when someone
   scales the deployment up by mistake, and during the short overlap of a rolling update.

The worker also stops reordering its own retries. When a batch fails for a temporary reason, the
worker today keeps reading new messages and the reclaim pass retries the failed ones 30 seconds
later, after newer records were written. With this option the worker retries its own pending
messages first (`XREADGROUP` with ID `0`) and reads new messages only when it has none left.
Rows that Postgres rejects are already set aside one by one, so one bad row cannot block the stream.

### Failure modes

- **Redis failover.** The lease key can be lost. A second replica can then take the lease while the
  first is in the middle of a batch, and for one batch the order can break. With `Recreate` and one
  replica there is no second replica to take it, so in practice the window does not exist.
- **Redis restart.** The stream and its pending list survive a restart only if Redis persisted
  them. That is true today and does not change.
- **Duplicates.** Unchanged. A repeated `record_id` keeps its first number.
- **Several API replicas.** Safe, because the runner waits for each answer.

### Costs and side effects

- Throughput is capped at one consumer. One consumer writes a batch of up to 50 records every 250 ms
  or faster, which is far above the current peak load in either region. The cap becomes a concern
  only if traffic grows by orders of magnitude, and Option 2 is the path at that point.
- While the records pod restarts, durable records wait in the stream. A rollout with `Recreate`
  delays them by the pod start time, usually under a minute. A lost node delays them until the pod
  is rescheduled, which can take a few minutes. The live view does not wait, because live frames
  use a different stream.
- One slow transaction delays every session, not only its own, because there is one queue.
- A temporary database error stops all record writes until the database answers again, instead of
  letting newer records through. Those records were going to wait for the database anyway.
- The commit order property stays as it is, so no reader needs to change.

## Comparison

| | Order fixed for | Reader changes | Redis loss can lose records | Effort |
| --- | --- | --- | --- | --- |
| 1. Ingest counter | All readers | Cursor rule changes everywhere | Yes, without extra work | High |
| 2. Session owner | All readers | None | No | High |
| 3. Order on read | Full reads only | All incremental readers | No | Medium |
| 4. One consumer | All readers | None | No | Low |

## Recommendation

Choose Option 4.

The data in [context.md](context.md) shows that the rate of out of order records rose from about one
a day to a quarter of all tool pairs when production started running two records consumers.
Option 4 removes that cause and the smaller cause from retries, and it keeps the property every
reader already relies on: `sequence` is both the send order and the commit order. It needs no
schema change, no wire change, and no change in any reader, so it can ship in the next release with
a small code change and a deployment change. The cost is a throughput cap that the current load is
far below, and a short pause in durable writes when the one pod restarts.

Option 1 fixes the order at the source but makes Redis a source of truth for numbers, and the
managed Redis can lose recent writes on failover. Option 3 moves the problem to every incremental
reader. Option 2 is the right design if one consumer ever stops being enough, and Option 4 does not
block it, because both keep the same rule.
