# Work package: durable history and replay

> **AGENT-GENERATED, low weight.**

## User-visible result

A client can open or reload a session, receive a complete snapshot, and follow every later committed
change without downloading the full transcript again.

## Current behavior

Records use upserts, timestamps do not define a stable session cursor, and the watch connection has
no durable replay. Clients reload records after change notifications.

## Scope

- Complete producer checkpoints and stable record IDs.
- Immutable new record inserts.
- Per-session database sequence.
- Legacy-session compatibility.
- Snapshot response.
- Replay followed by live events.
- Incomplete-history state.
- Session-history retention independent from tracing retention.

## Dependencies

The package implements [`../contracts/persistence.md`](../contracts/persistence.md) and the durable
portion of [`../contracts/events.md`](../contracts/events.md). Record-ID investigation must cover
every intentional progressive update before immutable inserts begin.

## Implementation sequence

1. Make progressive tool arguments and results temporary until their complete checkpoint.
2. Add stable terminal and record IDs.
3. Add nullable sequence fields and commit-time allocation.
4. Build the snapshot from one consistent database view.
5. Build subscribe-before-query replay and live following.
6. Test old sessions without backfill.

## Completion gate

- Identical retries do not duplicate or reorder history.
- Snapshot sequence N followed by events after N loses no committed event.
- Existing sessions load without migration or behavior regression.
- A persistence gap is visible as incomplete history.
- Session history is not deleted by tracing quota or retention.
