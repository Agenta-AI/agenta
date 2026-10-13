# Keep session records in the order the runner sent them

The runner sends the records of a session one at a time and in order, but the server can store
them with a `sequence` number in a different order. When that happens, a reader that sorts by
`sequence` sees a tool result before its tool call, or the end of a turn before the turn's last
message. This folder proposes how the server should keep the send order.

## Reading order

| File | Question it answers |
| --- | --- |
| [context.md](context.md) | What the user sees, why it happens, and how often it happens in production. |
| [research.md](research.md) | Which code assigns `sequence`, and which features depend on it. |
| [options.md](options.md) | The four ways to fix it, what each one costs, and the recommendation. |
| [plan.md](plan.md) | How to ship the recommended option, including the backfill and the tests. |
| [status.md](status.md) | Where the work stands and what is still open. |

## Terms used in every file

- **Runner.** The service that runs the agent harness and sends each event of a turn to the API
  as a record (`services/runner/src/sessions/persist.ts`).
- **Record.** One row in the `records` table: a message, a tool call, a tool result, a usage
  report, the `done` record that ends a turn, and so on.
- **Turn.** One user message and everything the agent does in reply. Records carry a `turn_id`.
- **`record_index`.** A number the runner puts on each record. It counts up from 0 inside a
  turn, in the order the runner produced the records. The runner sets it, so it is always in
  send order.
- **`sequence`.** A number the server puts on each record. It counts up from 1 inside a session.
  The records worker assigns it when it writes the record to Postgres.
- **Records stream.** The Redis stream `streams:records`. The API adds each incoming record to it,
  and the records worker reads from it.
- **Records worker** (also called the records consumer). The `RecordsWorker` loop in the
  stream worker process. It reads the records stream and writes rows to Postgres.
- **Watermark** (also called the cursor). The highest `sequence` a reader has seen. Readers use
  it to ask for "everything after N".
