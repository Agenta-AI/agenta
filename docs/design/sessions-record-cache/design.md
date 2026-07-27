# Session records as a conversation store: what has to be true, and what is not

## Why this document exists

PR #5486 lets the client stop sending the conversation on every turn. The runner rebuilds it
instead, from a durable log called session records. That makes the record log load-bearing for
correctness: if it is incomplete, the agent forgets, and it forgets silently, because a turn with
missing history still produces a confident answer.

Live QA of #5486 found six defects. Five are fixed and stacked as PRs. The sixth was that the log is
not readable in time for the next turn, and the proposed fix was a Redis buffer in front of the
read.

That buffer was designed, reviewed, and the review found the design's central guarantee to be false
and, more importantly, found that the record pipeline loses records permanently today for reasons a
buffer cannot address. This document records what is actually true, what has to be fixed first, and
the one decision that cannot be made without Mahmoud.

## What was measured

Records travel from the runner, to the API, into the `streams:records` Redis stream, and then to
Postgres when a worker picks them up. The read path,
`api/oss/src/dbs/postgres/sessions/records/dao.py:99-126`, selects every record for a session with
no limit, on every turn.

On a live stack, turn 1's last reply was written to Postgres at `28.663` while turn 2 began reading
at `28.450`. Turn 2 rebuilt a conversation missing turn 1's answer and answered anyway.

The lag is not the worker's 5000 ms blocking read, as first assumed. A blocked `XREADGROUP` wakes as
soon as an entry arrives. The real delay is the deliberate 250 ms accumulation window at
`api/oss/src/tasks/asyncio/shared/consumer.py:114`, which matches the ~213 ms measured.

## The three things that must be true, and are not

A conversation store has to guarantee three properties. The record pipeline provides none of them
today.

### 1. An accepted record is durable

It is not. Two independent paths lose records permanently.

**The API reports success for records it failed to make durable.** `publish_record` returns `False`
when the Redis publish fails (`api/oss/src/core/sessions/records/streaming.py:107`,
`:155-157`). The ingest route ignores that return value and responds `{"ok": True}`
(`api/oss/src/apis/fastapi/sessions/router.py:524`). The runner therefore believes the record is
safe. This defeats the entire `AGENTA_RECORDS_DURABLE` retry mechanism that #5486 added, because the
runner only retries on a failed response, and it never gets one.

**The worker acknowledges records it never wrote.** In
`api/oss/src/tasks/asyncio/sessions/records_worker.py`, message ids are appended to `processed_ids`
during deserialization at `:87` and `:95`, before any database write. The database write at `:148`
catches its exception, logs, and continues. Every id is then returned at `:160`, and the shared
consumer acknowledges and **deletes** them from the stream
(`api/oss/src/tasks/asyncio/shared/consumer.py:145-157`). A database failure therefore destroys
those records with no retry, no dead letter, and a log line as the only evidence. The EE quota path
at `:145` skips a whole project's batch the same way.

**A crashed worker strands records forever.** The consumer reads only new entries with `">"`
(`consumer.py:100`) and there is no pending-entry reclaim. Records claimed by a worker that then
dies are never redelivered.

### 2. A record has a stable identity

It does not. `record_id` is optional at ingest
(`api/oss/src/core/sessions/records/dtos.py:13`), and the runner supplies one only for tool-family
records (`services/runner/src/sessions/persist.ts:265`, `:375`). Ordinary message records, which are
the conversation itself, send none. The id is minted inside the worker's database mapping,
`api/oss/src/dbs/postgres/sessions/records/mappings.py:20`: `record_id=event.record_id or uuid.uuid4()`.

Two consequences. Any redelivery of a message record mints a fresh id and inserts a **second row**
for the same logical record, so the upsert on `(project_id, record_id)` does not deduplicate the
records that matter. And no component outside Postgres can deduplicate a record against its eventual
row, which is precisely what a merge-on-read buffer would have to do.

### 3. The log's completeness is knowable

It is not, and this is the finding that invalidates the buffer as a correctness fix.

EE retention deletes the oldest rows by `created_at`
(`api/ee/src/dbs/postgres/sessions/records/dao.py:82`). So a query can legitimately return a
conversation whose beginning has been deleted. The runner treats any non-empty result as the whole
conversation (`services/runner/src/engines/sandbox_agent/reconstruct-history.ts:55`). The agent then
answers as though the earlier part of the conversation never happened.

No buffer fixes this, because the truncation is in the authoritative store.

## Why the buffer does not deliver what it promised

The proposed design returned the union of Postgres and a Redis buffer, deduplicated by `record_id`,
and claimed there was no state in which it silently returned a conversation missing its beginning.
That claim is false, by four counterexamples:

1. **Retention**, as above. Postgres holds turns 81 to 100, the buffer holds turn 101, the merged
   result begins at turn 81, and nothing says so.
2. **Fail-open, which is mandatory here.** The buffer write times out, ingest still reports success,
   the next turn reads before the worker commits, and the record is in neither source. That is the
   original bug, unchanged.
3. **Read ordering.** If Postgres is read first, then the worker commits, then the buffer entry
   expires, then the buffer is read, a record present throughout is missed by both reads. The buffer
   must be read *before* Postgres, which the original design did not specify.
4. **A crashed worker with no reclaim**, which leaves Postgres beginning in the middle.

Dedupe by `record_id` also cannot work today, per finding 2 above: message records have no id until
the worker mints a random one, so every message would appear twice in the merged list. That is the
same defect class as #5489, rebuilt at a new layer.

The honest claim a buffer can make is narrow: *after a successful buffer write, it shortens the
window in which a recently accepted record is absent from a query.* That is worth having. It is not
a correctness guarantee, and it must not be described as one.

## The decision that is not mine

Two requirements currently contradict each other.

**Requirement A: a turn must never fail because of infrastructure.** Redis unavailable falls back to
Postgres and logs an error. This was decided explicitly.

**Requirement B: the agent must never silently answer with a conversation that is missing parts.**
This is the entire point of #5486 and of the five fixes already stacked.

When the client no longer keeps the conversation, these cannot both hold. If the store cannot prove
the history is complete and the turn is never allowed to fail, then the turn must sometimes proceed
on an incomplete history, and that is a silent wrong answer.

Something has to give, and the choice is a product decision, not an engineering one:

**Option 1: the query reports completeness, and the runner refuses an incomplete history.** The
response carries a signal such as `complete_from_start`, derived from retention state and a
per-session watermark. When it is false, the turn fails with a clear reason instead of answering.
This makes the guarantee real. The cost is that some turns fail that today would have answered, and
it needs a retention-aware watermark that does not exist yet.

**Option 2: accept best-effort history and say so.** The buffer ships as a freshness optimization,
the query stays best-effort, and the product accepts that a long or retention-truncated conversation
can lose its beginning without telling anyone. This is cheaper and nothing new can fail. It also
means #5486's premise, that the client can safely stop sending history, holds only for
conversations young enough not to have been truncated.

**Recommendation: Option 1**, because Option 2 reintroduces exactly the silent-amnesia failure the
five stacked PRs were written to remove, and because a failure a user can see is recoverable while a
confident wrong answer is not. The retention interaction means we will have to build the watermark
regardless, the moment a real conversation outlives the retention window.

## The order this has to happen in

Nothing about a buffer is worth building before the store underneath it is trustworthy.

1. **Stop losing records.** Return a failure from the ingest route when the durable publish failed.
   Acknowledge only what was actually committed. Add a pending-entry reclaim. These are standalone
   bugs, they cause permanent data loss today, and they are correct to fix under either option
   above.
2. **Give every record a stable identity at the boundary.** Derive it from
   `(session_id, turn_id, record_index)` so that an HTTP retry and a stream redelivery both land on
   the same row. This also makes the existing upsert do what it already claims to do.
3. **Decide the completeness question**, per the section above.
4. **Then the buffer**, with corrected claims: read the buffer before Postgres, dedupe on the now
   stable id, define the winner when the same id carries different content, stamp a canonical
   accepted-at because `SessionRecordEvent` has no `created_at`
   (`dtos.py:10`; it is added only when mapping a row back, `mappings.py:31`), and size it from
   measured ingest rate and payload distribution rather than from a guessed 300 seconds.

## Corrections to the earlier design, for whoever builds step 4

- **Do not put this in `dbs/redis/sessions/contract.py` or `SessionsRedisConfig`.** Both are the
  coordination contract mirrored by the TypeScript runner and pinned by a golden fixture
  (`contract.py:1`, `env.py:1305`). An API-only buffer does not belong there. Use
  `dbs/redis/sessions/records_buffer.py` and the existing `env.agenta.sessions.records` namespace
  (`env.py:494`). Call it a buffer, not a cache, in the module, the key, and the flag.
- **Keep it out of the `streams:*` namespace**, which means queues consumed by workers. A name like
  `records-buffer:<project_id>:session:<session_id>` does not invite that confusion.
- **Lua is not required.** Both commands are unconditional, so `MULTI`/`EXEC` is sufficient; the
  existing scripts are all conditional check-then-write, which this is not. If Lua is used anyway,
  it needs a real-Redis integration test, because `fakeredis` here cannot execute Lua and a Python
  reimplementation tests nothing about the script itself.
- **Do not default it on.** `LockEngine` shares the volatile instance
  (`api/oss/src/dbs/redis/shared/engine.py:48`), so buffer pressure can evict the authoritative
  `alive`, `running`, and `owner` locks. Railway points volatile and durable at one instance
  (`hosting/railway/oss/api/Dockerfile:11-12`). Default-on needs measured payload sizes, eviction
  isolation, and metrics first.
- **A count cap ignores bytes.** `MAX_ATTRIBUTES_BYTES` caps one attribute blob, not a whole entry
  (`streaming.py:22`). Bound by bytes, and compress.
- **Windowing the Postgres read later is not free.** A bounded Postgres window plus a bounded Redis
  tail can leave a gap between them unless a cursor connects the two.

## Implicit decisions

Decisions taken without explicit instruction. Each says how to reverse it.

1. **Stopped before implementing the buffer.** The review invalidated its central guarantee and
   surfaced prerequisite data-loss bugs. Building it tonight would have shipped a false guarantee.
   Reverse by choosing Option 2 above, which makes the buffer's narrow claim acceptable on its own.
2. **Treated the three durability bugs as the real headline.** They cause permanent record loss
   today, independent of #5486 and of any cache.
3. **Recommended Option 1 over Option 2.** Stated with reasons above; it is a product call and
   Mahmoud's to make.
4. **Derived record identity from `(session_id, turn_id, record_index)`** rather than minting a
   UUID at ingest, because the derived form also makes HTTP retries idempotent, which a minted one
   does not.
5. **Did not touch the shared consumer.** Its acknowledgement semantics are used by records, events,
   spans, and every TaskIQ queue. Changing them unsupervised, overnight, on infrastructure five
   pipelines depend on, is not a safe unattended change.
