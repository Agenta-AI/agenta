# Slice: the records worker acknowledges only what Postgres has

> AGENT-GENERATED, low weight. Draft for discussion. Mahmoud makes final decisions.

This slice closes the durability half of GitHub issue
[#5496](https://github.com/Agenta-AI/agenta/issues/5496) and all of
[#5594](https://github.com/Agenta-AI/agenta/issues/5594). It changes the records stream worker
and the shared stream consumer it runs on. It does not touch the runner, the records DAO, or
the records table.

Every claim below marked **verified** was read in code at the cited `path:line`, proven by a
test in this branch, or observed in the live run in "What I verified". Nothing here is
reported from another document without saying so.

## The answer

Three defects deleted records and reported success. All three are fixed.

| Defect | What happened | Where it is fixed |
| --- | --- | --- |
| The worker acknowledged records before the write | Every failed Postgres write deleted its records from Redis | `records_worker.py:277`, `:341`, `:349`, `:383` |
| One rejected record discarded its whole batch | A batch of fifty lost forty-nine good records to one bad one | `records_worker.py:192-232` |
| A record left unacknowledged was never redelivered | `read_batch` only asks for new entries, so "leave it pending" meant "lose it silently" | `consumer.py:181-268` |

A fourth defect is fixed in its own commit because it is one line and unrelated to the worker.
Enterprise record retention referenced `RecordDBE.id`, an attribute the model does not have, so
the retention statement raised before it deleted anything. Records were never aged out. Fixed at
`api/ee/src/dbs/postgres/sessions/records/dao.py:107` and `:121`. Verified: `hasattr(RecordDBE,
"id")` is `False`, the key is `(project_id, record_id)`
(`api/oss/src/dbs/postgres/sessions/records/dbes.py:18`), and the corrected statement compiles
against the Postgres dialect.

## What happened before this change

The worker added every decoded Redis message id to its acknowledged list during
deserialization, before it tried the Postgres write. A failed `append_many` logged an error and
continued. The ids were still returned, and the shared consumer loop acknowledged and deleted
them from the stream. Verified in the previous revision of `records_worker.py` at lines 177,
184, 236-246 and 278, and in `shared/consumer.py:143-155`.

Two consequences followed.

1. Any Postgres failure deleted the records of the turn that was running. The user saw a
   complete conversation on screen, and the durable transcript kept a hole. The runner rebuilt
   later turns from that incomplete transcript.
2. `append_many` writes one statement in one transaction, so one record Postgres rejected took
   its whole batch with it. Up to fifty unrelated records were lost per rejection. This is
   #5594.

A third problem was hidden underneath. The obvious fix, "do not acknowledge a failed batch", does
not work on its own. `read_batch` reads only `>`, which means new entries
(`consumer.py:118`, `:143`). An entry that is never acknowledged is invisible to every later
read of that consumer group. Without a reclaim pass, not acknowledging turns silent loss into a
pending list that grows forever and still never writes. Verified by test:
`test_unacknowledged_entry_comes_back_through_the_reclaim_pass` asserts that a second
`read_batch` returns nothing.

## What the worker does now

An id enters the acknowledged list for exactly three reasons.

1. Its rows committed.
2. It could not be decoded, so a redelivery cannot help. Counted as a loss.
3. Its organization is over its records quota, which is a deliberate product drop. Counted as a
   loss.

Everything else stays pending and comes back.

**The write path.** `_append_committed` (`records_worker.py:192`) calls `append_many` for the
whole project group. If that commits, every id in the group is acknowledged. If it fails and the
group holds more than one record, the worker writes the group one record at a time and
acknowledges only the records that committed. A rejected record stays pending on its own.

**The reclaim pass.** `reclaim_batch` (`consumer.py:181`) runs at the top of the worker loop
(`consumer.py:333`). It asks Redis for the group's pending entries with `XPENDING`, claims them
with `XCLAIM`, and hands them back to `process_batch`. It is opt-in through `reclaim_pending`,
which is off for the tracing and events workers and always on for records
(`records_worker.py:98`). It runs at most once per idle window, so a busy stream does not add a
round trip per loop turn.

**The retry bound.** Redis counts deliveries per entry. After `max_deliveries` deliveries the
worker drops the entry, logs at error with the session id, record id and record type, and
increments `dropped_messages` (`consumer.py:270`). The drop is data loss, and the log line is
what makes it countable.

**The guard on the bound.** The delivery counter alone cannot tell a record Postgres will never
accept apart from a Postgres that is simply down. Both fail every delivery. Dropping on the
count alone therefore deletes every record in flight as soon as an outage outlasts
`max_deliveries` windows, which is the loss this slice exists to prevent. So the worker drops an
over-budget entry only while other records are committing (`consumer.py:167`,
`records_worker.py:181`). While nothing at all is writing, over-budget entries are kept and the
worker logs a warning instead. This is safe because a pending entry in a Redis stream does not
block later entries: `read_batch` keeps delivering new records the whole time.

I found this hole in the live run, not in review. The first live run dropped all five records of
the second turn because the outage lasted ten reclaim windows. See "What I verified".

## The retry policy, and why

| Setting | Default | Environment variable | Meaning |
| --- | --- | --- | --- |
| `reclaim_idle_ms` | 30000 | `AGENTA_RECORDS_RECLAIM_IDLE_MS` | How long a failed record waits before the worker tries it again |
| `max_deliveries` | 5 | `AGENTA_RECORDS_MAX_DELIVERIES` | Deliveries after which a record is dropped, but only while other records are committing |

Both live in `api/oss/src/utils/env.py:528` and `:532`, and are wired in the composition root at
`api/entrypoints/worker_streams.py:101-102`.

Three choices are worth stating.

**One record at a time, not a binary split.** A split costs about `2 log2(n)` calls when one
record is bad and about `2n` calls when Postgres is down. Writing one record at a time costs `n`
calls in both cases, and Postgres being down is the common case. The simpler rule is also the
cheaper one where it matters.

**The reclaim lives in the shared consumer, not in the records worker.** It belongs next to
`read_batch` and `ack_and_delete`, which are the two halves it completes, and the tracing and
events workers have the same defect waiting for them. It is off by default, so this change alters
no other worker's behaviour.

**A failed entitlements check now defers instead of dropping.** An over-quota organization is a
deliberate drop and is still acknowledged. An entitlements service that cannot be reached is a
transient failure, and its records now stay pending (`records_worker.py:334`). This is the same
defect class as the main bug, so I fixed it here rather than filing it.

## What I verified

**Unit tests.** `api/oss/tests/pytest/unit/sessions/test_records_worker_durability.py`, 11 tests.
The redelivery tests run against `fakeredis`, so the pending-list bookkeeping is real consumer
group behaviour rather than a mock of it.

I also updated one assertion in
`api/oss/tests/pytest/unit/sessions/test_watch_publish.py:137-144`. That test pinned the old
acknowledge-before-write rule, and its own comment said it was not an endorsement of it.

Full API unit suite, OSS and Enterprise: 3248 passed, 74 skipped, 0 failed. The skips need a
Postgres or an external key that this environment does not have. None of them cover the records
worker. `ruff format` and `ruff check` are clean at version 0.15.12, which is what continuous
integration pins.

**Live run against a real Redis 8.** I did not deploy a stack. Swap on the box was fully used
(31 GB of 31 GB) and three other agent stacks were already running, so a fourth stack would have
put the others at risk. Instead I ran the real `RecordsWorker.run` loop against a throwaway
`redis:8` container on port 6399, with a write path that fails on demand. The script is at
`/tmp/claude-1000/-home-mahmoud-code-agenta-2/7c724667-82cd-41a6-ba0b-e47bc96b4f67/scratchpad/verify_records_ack.py`.
The container is stopped and removed.

| Step | Result |
| --- | --- |
| Turn one, three records, healthy write path | 3 committed, `XLEN` 0 |
| Turn two, five records published while the write path is down for 20 seconds | 0 committed, `XLEN` 5, `XPENDING` 5, 0 acknowledged |
| Write path restored | All 8 records present, 0 duplicates, `XLEN` 0, `XPENDING` 0, 0 dropped |
| One always-rejected record among three good ones | The 3 good records committed, the rejected one stayed pending |
| Traffic resumes | The rejected record dropped at its budget, logged at error naming `sess-2:<record id>:message`, `XLEN` 0, `XPENDING` 0 |

This covers the substance of the scenario in the brief. It does not cover the real
`RecordsDAO.append_many` against a real Postgres, or the runner and the browser. Those are not
verified.

## What I did not do

- I did not deploy a docker compose stack, for the memory reason above.
- I did not change the runner's bounded retry, the records DAO upsert rule, or the records table.
- I did not add a metric or an alert for `dropped_messages`. It is a counter on the worker object
  and a log line, nothing more.
- The tracing and events workers still acknowledge before their write. The mechanism to fix them
  now exists, and turning it on for them is one constructor argument each. I left it off.

## Open questions for Mahmoud

1. **Is 5 deliveries over 30 second windows the right bound?** Recommendation: keep it. With the
   health guard, the bound only applies while other records are committing, so it now measures
   "this record is bad" rather than "the database is slow". Both values are environment
   variables if a deployment disagrees.
2. **Should a dropped record raise an alert, not just a log line?** Recommendation: add one when
   the observability plane is next touched, not now. The counter and the error log make the loss
   countable, and Agenta runs one records worker, so the volume is small.
3. **Should the tracing and events workers get the same treatment?** Recommendation: yes, but as
   a separate change. They have the same acknowledge-before-write defect, and the machinery is
   already shared and off by default. Traces and events are less costly to lose than a
   conversation, so they do not need to ride with this one.
4. **Enterprise record retention starts deleting records the day this ships.** It has never run
   successfully, so old records have accumulated since the feature landed. Recommendation:
   check the row count and the configured cutoff on the first deployment before the job runs, so
   the first sweep is not a surprise.
5. **The reclaim pass makes a lost record land late rather than never.** A record can now be
   written a minute or more after its turn ended. Recommendation: accept it. The runner rebuilds
   history at the start of the next turn, not at the end of the previous one, so a late write is
   still in time for the reader that matters.
