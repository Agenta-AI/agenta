# Plan

The plan ships Option 4 from [options.md](options.md): one active records consumer, and retries
that do not jump the queue. It then repairs the turns that were already stored out of order.

## Change 1: retry pending records before reading new ones

`RecordsWorker` (through `StreamConsumer` in `api/oss/src/tasks/asyncio/shared/consumer.py`) gets
a flag that makes it read its own pending messages with `XREADGROUP ... ID 0` before it reads new
messages with `>`. When the last batch left messages pending for a temporary reason, the next loop
retries them after a short wait and does not read new messages until they are written or set aside.
The existing 30 second reclaim pass stays, because it still picks up messages left behind by a
consumer that died.

Costs and side effects. A database outage now stops every record write until the database is back,
and the worker retries the same batch every few seconds during the outage. Newer records could not
have been written during the outage anyway, so no record waits longer than it does today.

## Change 2: a lease for the records consumer

Before each batch, the records worker takes or renews a Redis lease with a 15 second expiry. A
worker that does not hold the lease sleeps and tries again. The lease name and expiry are settings
in `api/oss/src/utils/env.py`. On shutdown the worker releases the lease so the next pod can start
at once.

Costs and side effects. A second records replica now does nothing, so scaling the records
deployment up adds no throughput. If the lease key is lost in a Redis failover, two workers can each
write one batch before the first one sees the loss, which can reverse the order for that batch.

## Change 3: a separate deployment for the records loop

The Helm chart gets an optional second stream worker deployment, for example `workerRecords`, with
`AGENTA_WORKER_STREAMS` set to the records stream, one replica, and the `Recreate` strategy. When it
is enabled, the `workerStreams` deployment leaves the records stream out of its list. Docker Compose
needs no change, because it already runs one stream worker container.

Costs and side effects. One more pod per deployment, and a pause of durable writes for the length
of a pod restart during each rollout.

## Change 4: repair the turns already stored out of order

A data migration on the database that holds the `records` table renumbers the rows of each
affected turn. For each turn that has a `done` record, whose rows are out of order, and that does
not overlap another turn, it takes the set of `sequence` numbers the turn already uses and gives
them back to the rows in `record_index` order, with the current `sequence` as the tie breaker.

The set of numbers in each turn stays the same, so `latest_sequence`, every client cursor, and the
paged reads bounded by `through_sequence` stay valid. The migration writes in two steps inside one
transaction per session, first setting the turn's numbers to their negatives and then to the new
values, so the unique index on `(project_id, session_id, sequence)` never sees two rows with one
number. It runs only after Changes 1 to 3 are live, so no new out of order rows appear while it
runs. In production it touches a few hundred turns.

Costs and side effects. A client that cached a transcript of an affected turn keeps the old order
until it reloads. The turns that overlap another turn stay as they are.

## Change 5: watch the rate

After the release, run the read-only query from [research.md](research.md) for both regions: the
share of tool call and tool result pairs whose `sequence` order disagrees with their `record_index`
order. The expected result is zero new pairs after the deploy. The same query goes into the release
checks so a future change that brings back parallel consumers shows up within a day.

## Order of work

1. First, ship Changes 1 and 2 in one API pull request with tests.
2. Second, ship Change 3 in the chart, and enable it in the managed deployments in the same
   release.
3. Third, run the query from Change 5 a day after the deploy.
4. Fourth, ship Change 4 as a data migration in the next release.

## Tests

- An integration test starts two `RecordsWorker` instances on one Redis and one Postgres, publishes
  200 records of one session, and checks that only one worker wrote rows and that `sequence`
  follows `record_index`.
- An integration test makes the first write fail with a temporary error and checks that the
  records sent after it get higher numbers once the database answers.
- A unit test for the lease covers take, renew, lose, and release.
- A migration test builds a session with a reversed tool pair, an overlapping turn, and an
  unfinished turn, runs the migration, and checks that only the finished, non overlapping turn
  changed and that the set of numbers is the same.
