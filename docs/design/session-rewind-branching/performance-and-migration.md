# Performance, queries, and migration

## Frontend network requests today

The numbers below count browser-to-API requests, not cache reads.

### Opening the playground

- Session list: one `/sessions/query` request per agent scope.
- Refresh behavior: stale after 30 seconds, refresh every 60 seconds, and refresh on window focus.
- Transcript: zero requests for a fresh empty session.
- Transcript: one records request for a cache miss or stale cached session.
- Records consumers share one TanStack Query key, so hydration and Inspector do not intentionally
  issue parallel duplicate requests within the stale window.

### Rewind in pull request 5860

- Creating the child: local storage only.
- Typical rewind with a retained user message: one session-header request from auto-title after the
  child mounts.
- Rewind before the first user message: zero requests until the edited prompt is sent.
- First send: one normal invocation request. Its body is larger because it carries the retained
  transcript.
- Opening the original again: one records request if its shared cache is stale or absent.

## Frontend requests after the immediate PR hardening

The requested hardening does not add a network request:

| Action | PR 5860 now | Hardened PR |
|---|---:|---:|
| Click rewind with a copied title | Usually 1 header request | 1 header request |
| Click rewind without a title | 0 until auto-title | 0 until auto-title |
| First child send | 1 invocation | 1 invocation |
| Open stale child | 1 records query | 1 records query |
| Session list refresh | 1 sessions query | 1 sessions query |

Persisting the complete bootstrap adds one small local storage entry per pending fork. The editable
draft dominates its size and is bounded by the existing composer input. Copying the source title
uses the existing header endpoint and suppresses a duplicate auto-title write.

The retained prefix is already duplicated in the browser's local message cache. Storage growth is
linear in the number and length of retained messages for each fork. This remains a known limitation.

## Frontend requests with durable lineage

Durable lineage adds one request at fork creation and preserves existing read counts:

| Action | Frontend requests |
|---|---:|
| Click durable fork | 1 fork request |
| First child send | 1 invocation |
| Open stale child | 1 effective transcript query |
| Session list refresh | 1 sessions query including batched lineage |
| Open branch-family UI | 0 extra if list data is enough; otherwise 1 lineage query on demand |

The effective transcript request replaces the physical records request for conversation hydration.
It must not run in addition to it. Inspector views that explicitly request physical records may
share a separate cached query because they answer a different question.

The first invocation body becomes smaller because the browser sends only the new user message. The
runner resolves inherited context server-side.

## Backend query cost with durable lineage

Current transcript reconstruction needs one records database query for one session.

A naive lineage implementation would execute one lineage query and one records query per ancestor.
Do not implement that pattern.

The target implementation uses:

1. One core database query to resolve the lineage chain and inherited-turn counts. A recursive CTE
   or bounded iterative query can do this.
2. One tracing database query that fetches records for every session segment in the resolved chain,
   bounded by the physical cutoff stored on each lineage edge.

Expected backend database round trips per transcript cache miss:

```text
Current root session:     1 records query
Durable root session:     1 lineage lookup + 1 records query
Durable branch, depth N:  1 lineage-chain query + 1 batched records query
```

Branch depth must not produce N frontend requests or N records queries. Add indexes on child, root,
and parent session IDs. Set a lineage depth limit to bound malformed or adversarial chains.

The records query must apply cutoffs in SQL. It must not fetch a complete 100,000-turn parent and
trim it to two turns in application code. `cutoff_record_id` identifies the boundary row. The query
uses the null-safe total order `(timestamp IS NULL, COALESCE(timestamp, created_at), created_at,
COALESCE(record_index, -1), record_id)`. A matching tracing-database composite expression index,
prefixed by project and session, makes each segment a bounded range scan. One batched query can
express the resolved session segments as bounded predicates.

### Session-list backend cost

The current session-list service performs three batched database operations after any reference-ID
resolution: one stream query, one latest-turn query, and one tracing-store last-message query. A
separate lineage enrichment query would raise that to four.

Prefer a left join from the stream query to `session_lineage`, since both tables live in the core
database and each child has at most one lineage row. This keeps the list at three database
operations while widening the stream result. If DAO layering makes the join impractical, use one
batched lineage query for the page and explicitly accept the fourth operation. Never query lineage
once per row.

## Response size and latency

An effective transcript returns the same conversation context that the browser or runner needs to
reconstruct. Its response size is approximately the size of the visible inherited prefix plus child
records. Lineage avoids duplicate storage but does not avoid transmitting inherited context on a
cold read.

Existing IndexedDB persistence and TanStack Query deduplication can cache the effective transcript
under a key such as:

```text
["session", "transcript", projectId, sessionId]
```

Append-only child growth keeps cache invalidation simple. Parent sessions are immutable before the
stored cutoff for completed turns, so an inherited prefix does not need repeated parent polling.

## Database migration

### Immediate PR hardening

- No backend migration.
- Add a new local storage atom key for complete fork bootstrap state.
- Optional TypeScript fields do not require transforming existing browser session entries.
- Deleting a child must clean the new local storage entry.

### Durable lineage

Use an additive migration that creates `session_lineage`, `session_attachment_access`, and their
indexes.

- Do not rewrite records.
- Add the tracing-database composite expression index for bounded record-prefix reads.
- Add `record_id` as the final ordering key in ordinary records queries so all readers use the same
  total order. This only resolves previously undefined ties.
- Do not backfill existing sessions.
- Treat an absent lineage row as a root session.
- Keep new lineage fields optional in API responses during rollout.
- Deploy backend read compatibility before switching frontend hydration.
- Rollback is safe while no client requires lineage-only transcripts; child records remain intact,
  but inherited prefixes become unavailable without the lineage reader.

## Data retention and deletion

Parent deletion affects descendants. The durable project must choose a policy before implementation:

- Prevent hard deletion while descendants exist.
- Soft-delete the parent but retain its records while descendants reference them.
- Materialize descendants before permanent parent purge.

The recommended first policy is to retain soft-deleted ancestors until every descendant expires or
is deleted. Archive remains a visibility operation and does not affect lineage reads.

## Performance verification

Measure and pin:

- Frontend request count for rewind, first send, branch open, and original open.
- Backend database round trips for lineage depth 0, 1, 5, and the configured maximum.
- Transcript latency and payload size at 10, 100, and 1,000 records.
- Transcript rows scanned when a branch inherits 2 turns from a 100,000-turn parent.
- Correct cutoff behavior for equal timestamps, null timestamps, null record indexes, and tied
  ingest timestamps.
- Session-list latency and database operation count for a page with 50 sessions and mixed lineage.
- Storage growth for 10 branches from a 100-turn parent under copy and lineage models.
- Cache behavior when an effective transcript and Inspector physical records are both open.
