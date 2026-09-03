# Work package: durable history and replay

> **AGENT-GENERATED, low weight.**

## What users see today

Clients reload records after watch notices. Records use progressive updates, timestamps do not form
a stable cursor, and tracing quota can make the records worker drop session history.

## User-visible result

A client can open or reload a session, receive a consistent paged snapshot, and follow every later
committed change. Tracing quota and retention cannot delete session history.

## Scope

- Session retention separated from tracing quota and retention.
- Complete producer checkpoints and stable record IDs.
- Immutable new record inserts.
- One records-domain sequence for every post-migration durable write.
- Historical null-sequence compatibility.
- Grouped snapshot and paged transcript.
- Replay followed by live events.
- Visible incomplete-history state.

## Blocking decision

Mahmoud must choose the sequence home. The recommended baseline is a small cursor table owned by the
records domain on the analytics engine. Moving records to core is the alternative.

## Flag and rollback

`AGENTA_SESSIONS_HISTORY_WRITES` is an env-backed server switch read through `env.py`. Off keeps old
record writes mounted. A legacy path that cannot allocate a sequence remains off after migration.

## Implementation sequence

1. Exempt session records from tracing quota and retention, and add session-scoped retention.
2. Confirm every intentional progressive tool update and move it to temporary frames.
3. Add stable terminal and record IDs.
4. Add the analytics cursor row and nullable record sequence after Mahmoud settles its home.
5. Route every new and compatibility write through sequence allocation.
6. Build the grouped snapshot from one consistent database view and page the transcript.
7. Build subscribe-before-query replay and live following.
8. Test old sessions without backfill.

## Completion gate

- Retention separation passes before immutable history writes turn on.
- Over-quota tracing behavior cannot drop session history.
- Identical retries do not duplicate or reorder history.
- One malformed record does not discard valid records in its batch.
- Every post-migration durable write receives a sequence.
- Snapshot sequence N followed by events after N loses no committed event.
- Existing sessions load without backfill or behavior regression.
- A persistence gap is visible as `history_complete=false`.
- The history flag rolls back without making new rows unreadable.
