# Context

## What the user sees

A user opens a session in which the agent ran a tool, and the tool step shows as still running
even though the turn has finished. In the case found in production on 2026-10-13, the turn
had a `tool_call` record with `record_index` 13 and its `tool_result` with `record_index` 14. The
server stored the `tool_result` with `sequence` 54 and the `tool_call` with `sequence` 55. The
transcript read that orders by `sequence` returned the result first. The frontend could not match
the result to a call it had not seen yet, so it kept the call open.

A separate frontend change makes the chat tolerate a result that arrives before its call. That
change hides the symptom in one place. The server still stores records out of order, and other
readers (listed in [research.md](research.md)) still depend on `sequence` being the send order.

## Why it happens

The runner sends records in order. It keeps one promise chain per session, and it does not send a
record until the API has answered the previous one. The API adds each record to the records
stream and returns. So the records of one session enter the stream in send order.

The order breaks after the stream. Production runs more than one records consumer in the same
Redis consumer group. Redis gives each new message to whichever consumer asks next, so two
neighbouring records of one session can go to two different consumers. Each consumer collects a
batch for up to 250 ms and then writes it in one transaction. Inside that transaction it takes
the session's row in `session_sequence_cursors` with a lock and adds one to `latest_sequence`.
Whichever transaction takes the lock first gets the lower number. Nothing makes the consumer that
holds the earlier record go first.

Here is the production case, step by step:

1. First, the runner sends the `tool_call` (index 13). The API adds it to the stream.
2. Second, the runner sends the `tool_result` (index 14). The API adds it to the stream.
3. Third, consumer A reads the `tool_call` and starts to fill a batch. Consumer B reads the
   `tool_result` and starts its own batch.
4. Fourth, consumer B commits first. It takes the cursor lock and gets `sequence` 54.
5. Fifth, consumer A commits and gets `sequence` 55.

The `created_at` column is also reversed, because each consumer sets it at write time.

A single consumer can also break the order, but much more rarely. When a batch fails with a
temporary database error, its messages stay pending in Redis for 30 seconds before the reclaim pass
retries them. In those 30 seconds the consumer keeps reading and writing newer messages, so the
retried records get higher numbers than records sent after them.

## How often it happens

We counted, read only, every tool call and its tool result (matched by tool call id within a turn)
in both production regions for the seven days from 2026-10-06 to 2026-10-13. The runner order
(`record_index`) was never wrong. The server order (`sequence`) put the result before the call in:

| Region | Tool result stored before its tool call |
| --- | --- |
| EU | 11 percent of pairs, in 176 turns of 64 sessions |
| US | 16 percent of pairs, in 79 turns of 74 sessions |

The rate changed sharply on 2026-10-08. Before that date the EU region saw about one inverted pair
a day, and the US region saw almost none. From 2026-10-09 on, 27 percent of EU pairs and 18
percent of US pairs were inverted. Counting every record type and not only tool pairs, on each of
those days more than 80 percent of the active EU sessions, and between half and all of the active
US sessions, had at least one record stored out of order. The managed deployments that went live on 2026-10-07
run two records consumers, which matches the cause above.

Tool pairs are not the only records affected. Over the same seven days the `done` record that ends
a turn was stored before the record the runner sent just before it in 22 percent of EU turns and 40
percent of US turns. A reader that sorts by `sequence` and stops at `done` can miss the final
message of the turn.

The tools most affected are the ones agents call most: `bash`, `read`, `write`, and `edit`.
`commit_revision` is affected too, and [research.md](research.md) explains why that tool matters
more than the others.

## Goals

- Every record of a turn gets a `sequence` in the same order as its `record_index`.
- Readers that ask for "everything after N" still never miss a record.
- The fix works with more than one API replica and survives a Redis restart or failover.

## Non-goals

- The frontend change that renders a result whose call has not arrived. It ships separately.
- Ordering across two turns that run at the same time in one session. The data shows 9 such
  overlaps in 30 days in EU and 1 in US. They have a different cause and are out of scope.
