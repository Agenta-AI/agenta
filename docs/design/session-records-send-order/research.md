# Research

## The write path today

The write path has four steps.

1. First, the runner sends one record per HTTP request to `POST /sessions/records/ingest`.
   `persist.ts` keeps one promise chain per session, so a record is sent only after the previous
   record of the same session got an answer. A request that times out is retried with the same
   `record_id`, so the API can receive one record twice.
2. Second, the API handler (`api/oss/src/apis/fastapi/sessions/router.py`) calls `publish_record`
   in `api/oss/src/core/sessions/records/streaming.py`. It trims and cleans the attributes and
   runs `XADD streams:records`. The message carries the runner's `record_index` and `timestamp`.
   It carries no server order number. The API answers the runner only after the `XADD`, so with
   any number of API replicas the stream holds one session's records in send order.
3. Third, `RecordsWorker` (`api/oss/src/tasks/asyncio/sessions/records_worker.py`) reads up to 50
   messages, or whatever arrives in 250 ms, with `XREADGROUP` in the consumer group
   `worker-records`. It groups them by project and calls `RecordsService.append_many`.
4. Fourth, `RecordsDAO.append_many` (`api/oss/src/dbs/postgres/sessions/records/dao.py`) sorts the
   batch by session, keeping the batch order inside a session, and calls `_append_sequenced` for
   each record in one transaction. `_append_sequenced` inserts the row, then upserts the
   session's row in `session_sequence_cursors` with `latest_sequence + 1`, which locks that row
   until the transaction commits, and then writes the new number into `records.sequence`. A record
   that already exists (same `record_id`) keeps its first `sequence`.

Inside one batch the order is correct, because the worker keeps the stream order for each session.
The order breaks between batches, as [context.md](context.md) explains.

One more producer writes records. The watchdog in
`api/oss/src/tasks/asyncio/sessions/orphan_sweep.py` publishes a terminal record for a turn whose
runner stopped reporting. It uses the same `publish_record`, so it shares the stream and the
ordering.

## A property the current design has and must keep

Because each worker transaction holds the cursor row lock until it commits, the `sequence` numbers
of a session are given out in commit order. When a reader sees `latest_sequence = N`, every record
with a number up to N is already committed. No record with a lower number can appear later. All
"everything after N" reads rely on that property. Any fix must keep it, or it must replace it with
another rule that has the same effect.

## What depends on `sequence`

### Windowed transcript reads

`get_records_page` (`dao.py`) serves the paged transcript. The client first reads the session's
`latest_sequence` and then asks for pages "up to `through_sequence`", sorted by `sequence`. A page
boundary is stable because no new record can enter below the bound. When the order is wrong, the
page shows a result before its call.

### Unwindowed transcript reads

`get_records` sorts by runner `timestamp`, then `created_at`, then `record_index`. It does not use
`sequence`, so it shows the correct order today in nearly all cases. The two read paths can show
one session in two different orders. Runner timestamps are not perfect either: over 30 days they
disagreed with `record_index` 20 times in EU.

### Live catch-up over server-sent events

The live events endpoint (`api/oss/src/apis/fastapi/sessions/live_events.py`) replays durable
events after the client's cursor with `get_records_after`, and then follows the live relay. When
a durable event arrives on the relay, the server does not trust its order. It re-runs the replay
from the cursor against Postgres. The commit order property above is what makes that replay
complete.

On the client, `reduceSessionDurableEvent` (`web/packages/agenta-chat/src/model/durableEvents.ts`)
drops any event whose `sequence` is not above the last one it applied. The client uses a jump in
`sequence` to decide when to reload. Both rules assume that `sequence` grows in the order the
client should apply the events.

The records worker also publishes durable events with a `watermark`, which is the highest
`sequence` in its batch for that session. With two consumers, the two batches publish
independently, so a client can get the event with 55 before the event with 54. The server side
re-reads Postgres, so it does not lose the record, but the client receives the two events in
`sequence` order, which is the wrong order for the user.

### Live baseline and committed revision detection

`useSessionLivePreview` (`web/packages/agenta-chat/src/hooks/useSessionLivePreview.ts`) stores the
`latest_sequence` it saw when the page opened as `liveBaselineSequence`. It then reads the bounded
transcript and calls `liveCommittedRevisions`
(`web/packages/agenta-chat/src/assets/committedRevisions.ts`) to find `commit_revision` tool
results with a `sequence` above the baseline. The page uses those results to tell the playground
that the agent committed a new revision.

`liveCommittedRevisions` walks the records in the order it receives them. It learns each tool's
name from the `tool_call` record and checks the name when it reaches the `tool_result`. If the
result comes first, the name is unknown, and the function skips the result. The playground then
never learns about the new revision. This is a silent failure, and it is the main reason the
`commit_revision` cases in the production data matter more than the others.

### Read state and history completeness

`get_read_state` returns `latest_sequence` and decides whether history is complete by looking for
rows without a `sequence` after the first sequenced row. It does not depend on the order of the
numbers, only on their presence.

## Production data

All counts come from read-only queries against the production records tables. The queries and
their results are kept outside the repository. Every row written since 2026-09-13 in both regions
has a `sequence`, a `turn_id`, a `record_index`, and a `timestamp`, so a backfill does not need to
handle missing values for recent rows. In twelve EU turns two rows share one `record_index`, so a
backfill must break that tie with the current `sequence`.
