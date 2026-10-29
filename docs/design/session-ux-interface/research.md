# Research findings

The complete investigation is in
[`../session-ux-interface-review.md`](../session-ux-interface-review.md). This file records the
implementation facts and outcomes for this revision.

## Baseline

PR #5767 adds:

- Trigger origin and trigger identity in session tags.
- A generated session ID in trigger dispatch.
- `session_id` in delivery data.
- Flat origin, liveness, and ID-set query fields.
- An optional total count.
- An unconditional latest-message lookup for session-list rows.

PR #5769 adds:

- Frontend support for those flat query fields.
- Direct parsing of reserved `ag.*` keys.
- Session list grouping, pinning, waiting-ID pushdown, and row view models.
- Client-side reconstruction of pagination cursors.

## Existing schema capabilities

No attribution schema migration is required.

- `session_streams.tags` is already JSONB.
- Trigger subscriptions and schedules already include lifecycle columns such as `deleted_at`.
- Trigger deliveries already include JSON data that can carry `session_id`.
- Trigger deliveries already have an exact project-scoped retrieval endpoint.

Before this revision, schedule and subscription DAO deletion physically deleted rows. Delivery
foreign keys use `ON DELETE CASCADE`, so those physical deletes removed delivery history. Normal
application deletion now uses lifecycle soft deletion and preserves the existing rows without a new
column.

Authenticated exact-by-ID schedule and subscription reads include soft-deleted configurations as
read-only history. Normal lists, edits, activation changes, dispatch, and provider-trigger lookup
remain live-only.

Hard deletion of a gateway connection can still cascade through its subscriptions and deliveries.
This path is outside direct automation deletion and remains a deferred risk.

## Existing retrieval interfaces

The backend already supports:

- `GET /triggers/deliveries/{delivery_id}` for one exact delivery.
- Fetching one schedule by ID.
- Fetching one subscription by ID.
- Querying schedules and subscriptions.

The frontend already has trigger entities and delivery/configuration drawer components. The new row
actions should extend those surfaces instead of introducing another details implementation.

## No data migration

This work was pre-production. The implementation does not backfill old session attribution,
delivery IDs, or trigger names.

Verification covers data created through the revised write path.

Rows created on the pre-production v0.112 branch before the revised writer may have no exact
delivery attribution. They degrade to `delivery: null`, and the UI hides the delivery action. This
test data is disposable. The production release must include the revised writer; no repair path or
backfill is planned.

## Database schema impact

The planned functional work requires no database schema migration:

- Attribution stays in JSONB tags.
- Session ID stays in delivery JSON data.
- Soft deletion uses existing lifecycle columns.
- Typed API fields are response projections.

Indexes are the only possible schema change. They are not part of the initial implementation. Add
an index only after a representative `EXPLAIN (ANALYZE, BUFFERS)` demonstrates that the query needs
it.

Candidate indexes, if measurements require them:

- A GIN index on `session_streams.tags` for origin containment.
- A partial records index for latest-message lookups.

## Request comparison with PR #5767

| Concern | PR #5767 | Implemented revision |
| --- | --- | --- |
| Session query HTTP calls | One per list group/page | Same |
| Message preview | Every session query | Explicit expansion on Home/Sessions only |
| Automation name | Snapshot in session tags | Optional conditional read-model join for current names |
| Trigger list requests from frontend | None | None |
| Exact delivery request | Not available from row | One request after user selects `View delivery` |
| Pagination | Frontend rebuilds cursor | API returns cursor |
| Origin default | API returns all | Same, documented explicitly |
| Storage write | Replaces all tags | Merges reserved keys |

## Backend query cost

The original PR performs these lookups for every non-empty session page:

1. Session streams.
2. Latest turns.
3. Latest messages.

The implemented behavior is caller-specific:

| Caller | Streams | Latest turns | Latest message | Current automation |
| --- | ---: | ---: | ---: | ---: |
| Sidebar/internal | 1 | 1 | 0 | 0 |
| Home human sessions | 1 | 1 | 1 | 0 |
| Home automation sessions | 1 joined query | 1 | 1 | Included in stream query |
| Sessions default mode | 1 | 1 | 1 | 0 |
| Sessions automation mode | 1 joined query | 1 | 1 | Included in stream query |

When the caller requests trigger details, the session read-model query conditionally joins schedule
and subscription rows by project, typed kind, and ID. The primary-key joins add work to the stream
statement but do not add database roundtrips. The join includes soft-deleted configurations so
historical rows retain their last persisted name.

The frontend can mount more than one list query per surface. A card may query waiting, pinned, and
recent groups. The Sessions page may query pinned and recent groups. The revised design keeps the
same group-level HTTP query count as PR #5767.

Per group, a preview request remains three SQL roundtrips (joined streams, latest turns, latest
messages). A non-preview request drops to two. Agent-reference resolution may add one existing turn
query per group.

### Complete surface counts

These worst cases assume waiting and pinned groups are both non-empty, previews are enabled where
approved, and `include_total` is false.

| Surface | Session HTTP requests | Other HTTP requests | SQL roundtrips | PR #5767 SQL roundtrips |
| --- | ---: | ---: | ---: | ---: |
| Home with human and automation cards | 6 (3 per card) | 1 actionable-interactions request | 19 | 19 |
| Project Sessions page | 2 (pinned, recent) | 1 actionable-interactions request | 7 | 7 |
| Agent-scoped Sessions page | 2 (pinned, recent) | 1 actionable-interactions request | 9 | 9 |
| Sidebar with pinned and recent | 2 | 0 | 4 | 6 |

SQL totals include one actionable-interactions query where shown. Agent-scoped totals include one
turn-reference resolution per session query. Conditional trigger-name joins remain inside the
stream roundtrip. Empty waiting/pinned groups reduce these counts.

## Frontend request cost

The implementation adds no list-time frontend requests compared with PR #5767:

- Current automation names are hydrated by a conditional sessions read-model join, not by frontend
  requests.
- Exact delivery fetch happens only after the user selects `View delivery`.
- Opening a configuration uses the existing trigger entity/drawer cache and fetch path.

The typed frontend policy does not issue one schedule/subscription request per row.

## Regression risks

### Query compatibility

The sessions query predates PR #5767. Existing clients use flat references, lifecycle, search, and
windowing fields. The backend should accept existing fields while introducing the nested request.
Normalize both shapes at the API boundary.

### Deleted trigger visibility

Soft-deleted schedules and subscriptions must disappear from normal lists and dispatch loops.
Exact historical reads must continue to work. Missing `deleted_at IS NULL` predicates can either
resurrect deleted automations or keep dispatching them.

### Provider cleanup

Deleting a subscription must still remove or disable its provider-side trigger. Soft deletion
changes local persistence only.

### Attribution races

The dispatcher and first runner heartbeat can create the same session stream concurrently. The
merge path must preserve liveness flags and attribution tags regardless of write order.

### Optional expansions

An unavailable records lookup must not fail the base session list because records use a separate
analytics database. Trigger-name hydration is a conditional join in the transactional stream query;
it follows normal stream-query failure behavior. Missing or malformed attribution yields a null
typed relationship and no action. Valid trigger and delivery IDs remain available when only name
resolution is missing.

### Frontend origin policy

The API default returns every origin. Each frontend caller must set its policy explicitly so a new
caller does not accidentally inherit Home or Sessions behavior.

## Performance verification status

Structural gates passed for explicit expansions, conditional trigger joins, bounded session-ID
filters, concurrent enrichments, and no per-row trigger or delivery requests.

The planned benchmark with 10,000 sessions and 200,000 records was not run. No query-plan or
latency claim is recorded, and no index was added.
