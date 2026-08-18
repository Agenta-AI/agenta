# Sessions UX interface review

Status: implementation complete; residual verification recorded

Date: 2026-08-10

Primary baseline reviewed: [PR #5767](https://github.com/Agenta-AI/agenta/pull/5767)

Related release set: PRs #5766 through #5776 and #5793.

## Review outcome

The product need is valid. The new sessions surfaces need the server to decide which sessions
belong in each list before pagination, and they need enough data to render useful rows.

The implemented revision resolves the interface findings from the PR baseline. It adds atomic
claim and session attribution, typed queries and expansions, retained trigger history, generated
clients, typed frontend policies and actions, exact delivery mode, and reserved-tag sanitization.

The implementation follows these decisions:

1. Keep tags as the short-term storage for session origin and trigger identity.
2. Do not expose reserved tag keys as the frontend's public contract. Expose typed session fields
   and compile them to tag predicates internally.
3. Store stable filterable attribution values in tags. Resolve the current trigger name at read
   time; do not snapshot it in tags or meta.
4. Use the repository's resource-nested query pattern and return the pagination cursor.
5. Make latest-message hydration an explicit list expansion and treat it as best effort.
6. Expose the exact delivery ID on automation session rows. Do not add event, run, or trace data
   without a concrete user story.
7. Do not introduce a new provenance table or index without a demonstrated need.

Automated API, Postgres, generated-client, and frontend verification passed. Schedule live
acceptance passed. Browser QA, subscription live acceptance, and the representative performance
benchmark remain incomplete. Section 15 records the exact evidence and residual risk.

## 1. Product story

The original sessions UX problem is described in the
[`agenta-sessions-ux` plan](https://github.com/Agenta-AI/agenta/blob/oss/home-overview/docs/design/agenta-sessions-ux/plan.md)
on the frontend stack:

> Sessions are the user's daily work, but there is no project-wide place to find, filter,
> organize, and reopen them.

The sessions and Home redesign turns that into five core user stories.

### Story 1: Find human-started sessions

As a user, I want the default sessions list to show the work I started, without frequent
automation runs burying it.

The frontend needs:

- A way to identify trigger-started sessions.
- A server-side way to exclude them before ordering and pagination.

### Story 2: Inspect automation runs

As a user, I want to switch to automation runs and understand which automation started each one.

The frontend needs:

- A way to request trigger-started sessions only.
- The stable ID of the schedule or subscription that started the session.
- Optionally, the automation kind for an icon or label.
- Optionally, a display name for the row.

The stable ID is required if a row links to the automation. The kind and name are presentation
requirements and should be justified by the actual row design.

### Story 3: Find sessions needing attention

As a user, I want to filter to sessions that are live or waiting for me.

The frontend needs:

- Liveness filtering from session flags.
- The complete set of session IDs with actionable interactions.
- A server-side ID-set filter so the waiting set is intersected with agent, origin, lifecycle,
  ordering, and pagination constraints.

Waiting is not a liveness value. It comes from the interactions domain. The frontend currently
resolves the small waiting ID set and pushes those IDs into the sessions query.

### Story 4: Pin sessions without duplicates

As a user, I want pinned sessions at the top and recent sessions below them.

The frontend needs:

- A query that includes an explicit session-ID set for the pinned group.
- A query that excludes those IDs from the recent group.

Pins are currently local to the browser. The server does not need to own pin persistence for this
iteration, but it must apply the ID predicates before pagination.

### Story 5: Decide whether to reopen a session

As a user, I want each row to say what happened, rather than opening every session to inspect its
transcript.

The frontend needs a short preview. PR #5767 defines that preview as the newest message when that
message contains nonblank text, including its source and timestamp. It does not fall back to an
older textual message when the newest message has no text.

## 2. Stories implemented by the PR set

The release set is broader than the sessions API. It combines one backend lane, one frontend
package stack, and two independent changes.

| Story | Backend/API | Frontend policy | UI surface |
| --- | --- | --- | --- |
| Separate human and automation sessions | #5767 | #5769 | #5770, #5772, #5775 |
| Identify the automation | #5767 | #5769 | #5770, #5772, #5775 |
| Preview the latest message | #5767 | #5769 | #5770, #5772, #5775 |
| Filter live sessions | #5767 | #5769 | #5770, #5775 |
| Filter waiting sessions | Existing interactions API plus #5767 ID filter | #5769 | #5770, #5775 |
| Pin and deduplicate sessions | #5767 ID filters | #5769 | #5770, #5772, #5775 |
| Browse project and agent sessions | Existing agent references plus #5767 intersections | #5769 | #5775 |
| Rework Home and agent overview | Supporting session API | #5769, #5771 | #5772 |
| Browse agents as cards | None | #5771 | #5773 |
| Inspect templates | None | #5772 data | #5774 |
| Start sessions with seeded files | None | #5772 seed | #5776 consumption |
| Reveal filtered uploads | None | None | #5793, independent |

## 3. Historical PR stack

### Independent lanes

| PR | Branch and base | Purpose |
| --- | --- | --- |
| [#5766](https://github.com/Agenta-AI/agenta/pull/5766) | `entities/trigger-helpers` -> `main` | Shared frontend trigger-to-agent and cron helpers |
| [#5767](https://github.com/Agenta-AI/agenta/pull/5767) | `api/session-trigger-stamp` -> `feat/mobile-parity-and-consolidation` | Sessions query, origin stamp, delivery link, preview |
| [#5793](https://github.com/Agenta-AI/agenta/pull/5793) | `fe-fix/drive-upload-reveal` -> `main` | Independent Drive upload fix |

### Linear frontend stack

```text
feat/mobile-parity-and-consolidation
  -> #5768 pkg/ui-surfaces
  -> #5769 pkg/sessions
  -> #5770 pkg/sessions-ui
  -> #5771 pkg/entity-ui-agent
  -> #5772 oss/home-overview
  -> #5773 oss/agents-page
  -> #5774 oss/templates
  -> #5775 oss/sessions-page
  -> #5776 oss/seed-attachments
```

#5766 is outside this Git stack but is still a release prerequisite: #5771 imports its
`triggerBoundAgentId` helper, so #5766 must reach the frontend stack's base before #5771 builds.

| PR | Purpose |
| --- | --- |
| #5768 | Shared panel layout primitives |
| #5769 | Headless sessions query, filters, pins, grouping, and row view models |
| #5770 | Portable sessions rows and filter controls |
| #5771 | Portable agent cards and next-trigger sections |
| #5772 | Home and agent-overview redesign |
| #5773 | Agents page |
| #5774 | Template gallery and detail page |
| #5775 | Project and agent sessions pages |
| #5776 | Seeded attachment handoff to the first message |

The implementation used `origin/release/v0.112.0` at `965851e15d`, which contained the required
session and trigger surfaces. No GitButler stacks were applied at the start.

## 4. Interface-first view

Before discussing storage or services, the interface review starts with what the frontend must
ask and what it must receive.

### 4.1 Information required by each frontend decision

| Frontend decision | Required information | Implemented source |
| --- | --- | --- |
| Show normal sessions | Exclude trigger origin | `exclude.origins: ["trigger"]` |
| Show automation runs | Include trigger origin | `session.origins: ["trigger"]` |
| Name an automation row | Current trigger name | Typed `trigger.name` expansion |
| Link to an automation | Trigger ID and kind | Typed `trigger.id` and `trigger.kind` |
| Show schedule/subscription icon | Trigger kind | Typed `trigger.kind` |
| Filter by agent | A matching turn workflow reference | `turn_references` query predicate |
| Filter live sessions | Liveness flags | `session.liveness.is_alive` |
| Filter waiting sessions | Actionable interaction session IDs | `session_ids` |
| Fetch pinned group | Local pinned IDs | `session_ids` |
| Avoid duplicates | Local pinned IDs | `exclude.session_ids` |
| Show row preview | Newest message when it has text | Typed `last_message` expansion |
| Open exact delivery | Delivery ID | Typed `delivery.id` and exact delivery mode |
| Order and paginate | Terminal cursor object | Response `windowing` |

Agent filtering and row enrichment use related but different turn semantics. The filter matches a
session when any turn contains the requested reference. The returned row displays the highest
`turn_index` turn's references. A multi-agent session can therefore match an older turn while its
row exposes a newer turn's agent.

### 4.2 Information not required by the current sessions list

The list does not currently need:

- Provider event ID.
- Detached workflow run ID.
- Turn ID.
- Trace ID.
- Trigger configuration such as cron or provider-specific options.
- Full transcript records.

The exact trigger delivery ID is required for the confirmed `View delivery` action. The remaining
values may be useful for an automation-run details page or an observability link, but are not
required to separate sessions, name the automation, or render the preview.

## 5. Trigger terms

The previous review used several terms without enough specificity. This section defines each one
through one example.

Assume an automation named `Support triage` starts an agent whenever a Gmail message arrives.

### 5.1 Trigger configuration

The trigger configuration is the reusable automation definition.

For an event subscription it includes information such as:

- The provider event type, such as `GMAIL_NEW_MESSAGE`.
- The connected account.
- Provider-specific filters.
- Input mappings.
- The workflow or agent to invoke.

For a schedule it includes:

- The cron expression.
- Optional start and end times.
- Input mappings.
- The workflow or agent to invoke.

The sessions list does not need this configuration. If the user opens the automation, the
frontend can retrieve it using the trigger ID.

### 5.2 Schedule and subscription

A schedule fires because a clock reaches a configured time.

A subscription fires because an external event arrives, such as a Gmail message or GitHub pull
request.

PR #5767 writes this distinction as:

```json
{"ag.trigger.kind": "schedule"}
```

or:

```json
{"ag.trigger.kind": "subscription"}
```

The kind is useful only if the UI presents these differently or needs to choose the correct
destination when opening the automation.

### 5.3 Initiating event

The initiating event is one concrete occurrence that causes the automation to run.

Examples:

- One Gmail message arriving.
- One GitHub pull request being opened.
- The 02:00 schedule tick on August 10.

It is not the reusable trigger configuration. The same schedule can produce hundreds of initiating
events over time.

The sessions list does not need this event ID for its current design. An audit or retry screen may
need it.

### 5.4 Trigger delivery

A trigger delivery is Agenta's audit row for one attempt to process one initiating event.

It records which subscription or schedule fired, the event identity, dispatch status, inputs, and
the result or error. It has a `delivery_id`. The successful claimant creates the row. A duplicate
claimant skips invocation; the delivery row does not record each duplicate claim attempt.

The distinction is:

```text
Schedule "Nightly digest"       reusable configuration
Delivery on August 10 at 02:00  one exact firing
Delivery on August 11 at 02:00  another exact firing
```

PR #5767 adds `session_id` to the delivery data. This gives the system:

```text
delivery -> session
```

The confirmed row menu includes `View delivery`, so automation session rows require this exact
delivery ID. The action opens the delivery payload, mapping result, dispatch status, or
pre-execution error.

### 5.5 Workflow run

A workflow run is one execution of the selected workflow. The detached invocation path has a
`run_id`, but this path does not currently have one canonical persisted workflow-run entity that
connects all execution identifiers. Detached deliveries store `result.run_id`; synchronous
deliveries instead store trace, span, and output information.

The sessions list does not need the run ID. A session can contain multiple turns and executions,
so a run ID is not the session's user-facing identity.

### 5.6 Session and turn

A session is the durable conversation or work container shown in the sessions list.

A turn is one execution within that session. For example:

```text
Session: Investigate refund request
  Turn 1: inspect order
  Turn 2: ask user for approval
  Turn 3: issue refund
```

Trigger dispatch creates a fresh session in the current implementation. That is a product choice:
each automation firing is represented as a new session. The list therefore treats automation runs
as sessions even though one session can technically contain several turns.

### 5.7 Trace and records

A trace is observability data for one execution. It contains timing and nested model/tool spans.

Records are the transcript and execution events associated with a session and turn. They include
messages, thoughts, tool calls, tool results, usage, errors, and completion events.

The list needs only a preview derived from records. It does not need the trace ID unless the row
offers an `Open trace` action.

### 5.8 Identity chain for this UX

The minimum current chain is:

```text
subscription or schedule ID
  -> stamped onto session
  -> session groups turns and records
```

The fuller operational chain is:

```text
subscription or schedule
  -> initiating event
  -> delivery
  -> workflow invocation
  -> session
  -> turn
  -> trace and records
```

The full chain is useful for debugging. It does not need to appear in every sessions-list row.

## 6. Frontend interface changes

### 6.1 Before #5769

The list-filter and pagination subset of the frontend `querySessions` wrapper supported:

```ts
interface QuerySessionsParams {
    projectId: string
    references?: Reference[]
    includeEnded?: boolean
    includeArchived?: boolean
    search?: string
    limit?: number
    next?: string
    newest?: string
}
```

The complete wrapper also carried transport/context options such as `appId`, `abortSignal`, and
`lowPriority`; those are unchanged by the sessions-list work.

The session row already included stream fields and latest-turn references. It did not parse tags
or a message preview.

### 6.2 Reviewed #5769 baseline

PR #5769 extends that list-filter and pagination subset with:

```ts
interface QuerySessionsParams {
    projectId: string
    references?: Reference[]
    includeEnded?: boolean
    includeArchived?: boolean
    search?: string
    flags?: {
        is_alive?: boolean
        is_running?: boolean
        is_attached?: boolean
    }
    sessionIds?: string[]
    excludeSessionIds?: string[]
    origin?: string
    excludeOrigin?: string
    limit?: number
    next?: string
    newest?: string
}
```

The parsed session row gains:

```ts
interface SessionStream {
    // Existing stream fields...
    tags?: Record<string, unknown> | null
    references?: Reference[] | null
    last_message?: {
        text: string
        source?: string | null
        timestamp?: string | null
    } | null
}
```

The frontend then reads backend storage keys directly:

```ts
const SESSION_ORIGIN_TAG = "ag.origin"
const SESSION_TRIGGER_NAME_TAG = "ag.trigger.name"
const SESSION_TRIGGER_KIND_TAG = "ag.trigger.kind"
```

This direct dependency was the main interface concern. The implemented frontend now depends on
typed domain fields and does not parse reserved storage keys.

### 6.3 Baseline frontend-stack calls

These are representative calls from PR #5769's stack, not the current `main` checkout. The wrapper
also sends `include_ended: true` by default.

Default sessions mode:

```json
{
  "include_ended": true,
  "include_archived": false,
  "exclude_origin": "trigger",
  "windowing": {"limit": 30}
}
```

Automation mode:

```json
{
  "origin": "trigger",
  "include_ended": true,
  "include_archived": false,
  "windowing": {"limit": 30}
}
```

Agent-scoped live sessions:

```json
{
  "references": [{"id": "019d952f-0000-0000-0000-000000000000"}],
  "flags": {"is_alive": true},
  "exclude_origin": "trigger",
  "windowing": {"limit": 30}
}
```

Waiting sessions:

```json
{
  "session_ids": ["session-a", "session-b"],
  "include_ended": true,
  "exclude_origin": "trigger",
  "windowing": {"limit": 30}
}
```

Pinned group:

```json
{
  "session_ids": ["session-pinned-a", "session-pinned-b"],
  "include_ended": true,
  "windowing": {"limit": 30}
}
```

The actual pinned query also carries the active search, agent, status/waiting, and archive filters.
It deliberately suppresses the default trigger exclusion so a pinned automation session remains
visible in its pinned group.

Recent group without duplicate pins:

```json
{
  "exclude_session_ids": ["session-pinned-a", "session-pinned-b"],
  "exclude_origin": "trigger",
  "include_ended": true,
  "windowing": {"limit": 30}
}
```

## 7. Public API review

### 7.1 API before #5767

`POST /sessions/query` accepted a flat request:

```json
{
  "references": [{"id": "..."}],
  "windowing": {"limit": 30},
  "include_ended": true,
  "include_archived": false,
  "search": "refund"
}
```

It returned:

```json
{
  "count": 1,
  "sessions": [
    {
      "id": "...",
      "session_id": "...",
      "name": "Refund request",
      "flags": {"is_alive": false},
      "references": [{"id": "..."}],
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}
```

### 7.2 Reviewed #5767 baseline

The request gains:

```json
{
  "flags": {"is_alive": true},
  "session_ids": ["..."],
  "exclude_session_ids": ["..."],
  "include_total": true,
  "origin": "trigger",
  "exclude_origin": "trigger"
}
```

The response structurally gains `total` and `last_message`. `SessionStream` already exposed optional
`tags` and `meta`; #5767 starts populating reserved `ag.*` tag keys.

#5769 does not expose `includeTotal` from its frontend wrapper and does not parse `total` from the
response, so this capability is implemented by #5767 but unused by the sessions UI in this stack.

```json
{
  "count": 1,
  "total": 37,
  "sessions": [
    {
      "session_id": "...",
      "tags": {
        "ag.origin": "trigger",
        "ag.trigger.id": "...",
        "ag.trigger.name": "Nightly digest",
        "ag.trigger.kind": "schedule"
      },
      "last_message": {
        "session_id": "...",
        "text": "Digest delivered.",
        "source": "agent",
        "timestamp": "..."
      }
    }
  ]
}
```

### 7.3 What is good

- Filters execute before pagination.
- Positive filters are intersected.
- `session_ids=[]` means no matches instead of no restriction.
- Exclusions execute before pagination.
- Legacy rows without origin tags survive `exclude_origin="trigger"`.
- Query and count use the same SQL predicate.
- `count` remains the number of rows in the page.
- `total` is optional and ignores pagination.
- Latest messages are fetched in one batch instead of one call per row.

### 7.4 Findings resolved by the implementation

The following subsections describe defects in the reviewed PR baseline. The completed revision
resolves each defect through the typed contract shown in Section 8.

#### The request was a flat collection of different roles

The request mixes:

- Resource predicates: search, flags, origin.
- Cross-resource constraints: references.
- Explicit set constraints: session IDs.
- Lifecycle policy: include ended/archived.
- Response options: include total.
- Pagination: windowing.

The repository's stronger query APIs group resource predicates under the resource name. Examples:

- `WorkflowQueryRequest.workflow` in
  `api/oss/src/apis/fastapi/workflows/models.py:69`.
- `TestsetQueryRequest.testset` in
  `api/oss/src/apis/fastapi/testsets/models.py:70`.
- `EvaluationRunQueryRequest.run` in
  `api/oss/src/apis/fastapi/evaluations/models.py:144`.

#### `include_total` was mixed into filtering

It changes response cost and shape. It should remain at the API/options layer, not inside the core
session predicate DTO.

#### Origin was untyped and singular

`origin: string` accepts typos and supports only one inclusion value. `origin` and
`exclude_origin` can also contradict each other.

#### The response did not return its next cursor

The request accepts `windowing`, but `SessionsResponse` does not return the next cursor. Session
pagination needs both the last row's internal `id` (`next`) and activity timestamp (`newest`). The
frontend reconstructs both from the row. Workflows and testsets return cursor data explicitly,
although their shared cursor helper would need extension for the session query's coalesced activity
timestamp.

#### The response exposed storage rather than domain fields

The frontend must know that `ag.trigger.name` means trigger name. If storage later changes from
tags to columns, every frontend consumer must change.

#### ID lists were unbounded

The API should bound and validate inclusion and exclusion lists. A query containing thousands of
arbitrary strings should not produce an unbounded `IN` predicate.

#### Total repeated reference resolution

When `include_total=true`, the router calls `query_sessions()` and `count_sessions()` separately.
Both resolve turn references to session IDs. This adds a duplicate query and allows the page and
total to observe different intermediate sets.

## 8. Implemented public API

This shape follows the repository's resource-query pattern while preserving the useful behavior
from #5767.

### 8.1 Request

```json
{
  "session": {
    "search": "refund",
    "liveness": {"is_alive": true},
    "tags": {"team": "support"}
  },
  "session_ids": ["session-a", "session-b"],
  "turn_references": [
    {"id": "019d952f-0000-0000-0000-000000000000"}
  ],
  "exclude": {
    "session_ids": ["session-pinned"],
    "origins": ["trigger"]
  },
  "include_ended": true,
  "include_archived": false,
  "include_total": true,
  "expand": ["last_message"],
  "windowing": {
    "limit": 30,
    "next": "...",
    "newest": "2026-08-10T12:03:14Z"
  }
}
```

The compatibility boundary is:

- Session predicates under `session`.
- Turn references named as turn references.
- Exclusions grouped rather than one new `exclude_*` field per predicate.
- Response options outside the predicate.
- Cursor pagination kept under `windowing`.

The liveness object preserves the current boolean predicate semantics, including future false
predicates. If origin selection later includes `unknown`, the backend must define it as a
null/missing-tag predicate; it cannot compile `unknown` to ordinary JSONB containment.

### 8.2 Response

```json
{
  "count": 1,
  "total": 37,
  "sessions": [
    {
      "id": "...",
      "session_id": "...",
      "name": null,
      "origin": "trigger",
      "trigger": {
        "id": "019d952f-0000-0000-0000-000000000000",
        "kind": "schedule",
        "name": "Nightly digest"
      },
      "delivery": {
        "id": "019d952f-0000-0000-0000-000000000001"
      },
      "references": [{"id": "..."}],
      "last_message": {
        "text": "Digest delivered.",
        "source": "agent",
        "timestamp": "..."
      }
    }
  ],
  "windowing": {
    "next": "...",
    "newest": "2026-08-10T12:03:14Z",
    "limit": 30
  }
}
```

The API stores origin, trigger, and delivery IDs in tags internally. The response adapter translates
storage into explicit fields and removes reserved attribution keys from the public tags map. This
implementation does not use session meta.

For an unstamped row, the implementation models `origin` as null. With the API's current
`response_model_exclude_none` policy the field may be omitted on the wire. It does not report
`manual`, because absence cannot distinguish a manual session from legacy data or a failed trigger
stamp.

### 8.3 Should the API expose only generic tag filters?

A generic tag filter would work mechanically:

```json
{
  "session": {
    "tags": {"ag.origin": "trigger"}
  }
}
```

It is not the preferred public interface for system-owned origin because:

- It exposes a reserved storage key.
- It provides no enum validation.
- It makes the frontend responsible for null/unknown compatibility semantics.
- It makes a later storage migration a public breaking change.

The implemented boundary is:

```text
Public API: session.origins = ["trigger"]
Internal query: tags @> {"ag.origin": "trigger"}
```

Generic user tags can still be supported separately through `session.tags`.

## 9. Reviewed baseline model and internal interfaces

This section records the #5767 baseline that produced the findings. The completed implementation
separates query predicates from response options, uses typed attribution projections, and keeps
reserved storage keys behind the API adapter.

### 9.1 API models

`SessionQueryRequest` gains:

- `flags`
- `session_ids`
- `exclude_session_ids`
- `include_total`
- `origin`
- `exclude_origin`

`SessionsResponse` gains optional `total`.

### 9.2 Core session models

`SessionListItem` gains `last_message`.

`SessionQuery` gains the new request fields, including `include_total` even though it is not a row
predicate.

The sessions core also gains trigger-specific constants and `SessionTriggerRef`.

Feedback:

- `SessionListItem.last_message` is a reasonable response projection.
- `include_total` should not live in the core predicate model.
- Trigger attribution should be exposed through a typed session field, but sessions core should
  not need constants for every trigger storage key.
- `origin` and `kind` should be enums at the public boundary.

### 9.3 Stream query models

`SessionStreamQuery` gains generic `tags` and `exclude_tags` predicates.

Feedback:

- JSONB containment is a reasonable persistence adapter.
- A public `exclude_tags` API is not established elsewhere and needs clear null semantics.
- The session-origin API should compile into these internal predicates rather than expose them.

### 9.4 Stream DAO interface

The stream DAO query gains `exclude_session_ids`, and the interface gains a separate `count()`.

Feedback:

- Applying exclusions before windowing is correct.
- Sharing one predicate builder between list and count is correct.
- ID sets should be bounded at the public boundary.
- A single service query result should resolve references once and then perform list/count.

### 9.5 Records interface

The records DAO and service gain:

```python
latest_message_per_session(
    project_id: UUID,
    session_ids: List[str],
) -> Dict[str, SessionMessagePreview]
```

Feedback:

- The batch interface is correct for a list expansion.
- It belongs to the records domain.
- The sessions service should call it only when the expansion is requested.
- A records failure should not fail the base sessions list.

### 9.6 Trigger dispatcher interface

The dispatcher gains an optional concrete `SessionStreamsService` dependency. It now:

1. Mints `session_id`.
2. Writes trigger attribution to the session stream.
3. Passes `session_id` to the workflow request.
4. Stores `session_id` in delivery data.

Feedback:

- Minting the session ID before invocation is reasonable.
- The dispatcher is the correct place to know which schedule/subscription fired.
- The dependency should be a narrow session-attribution interface, not the concrete stream
  service.
- Correlation should be persisted to the claimed delivery before invocation so a crash does not
  lose it.
- The best-effort attribution write means origin is a UI convenience, not a guaranteed invariant.

## 10. Tags, meta, and provenance

### 10.1 Repository meaning

Agenta's shared metadata model has three categories:

| Field | PostgreSQL storage | Meaning |
| --- | --- | --- |
| `flags` | JSONB | System state used by behavior and filters |
| `tags` | JSONB | Small labels used for categorization and containment filtering |
| `meta` | JSON | Rich descriptive context, usually not queried |

JSONB supports containment operators and GIN indexes. JSON preserves a JSON document but is not
the repository's normal indexed-filter path.

JSONB does not create an index automatically.

This tags-as-labels distinction is a shared-model convention, not currently enforced by session
DTOs. `SessionStream.tags` is typed as `Dict[str, Any]`, so session tags can technically contain
arbitrary JSON until that contract is tightened.

### 10.2 GIN, not chain

The index is a GIN index, pronounced like `gin`. GIN means Generalized Inverted Index.

For JSONB it lets PostgreSQL efficiently answer containment queries such as:

```sql
flags @> '{"is_alive": true}'
```

or:

```sql
tags @> '{"ag.origin": "trigger"}'
```

`session_streams.flags` has a GIN index. `session_streams.tags` does not. The implemented origin
query is valid, but representative query-plan verification was not run. No tags index was added.

### 10.3 What belongs in tags

For the current UX, these values are plausible tags because the list filters by them:

```json
{
  "ag.origin": "trigger",
  "ag.trigger.id": "...",
  "ag.trigger.kind": "schedule",
  "ag.trigger.delivery_id": "..."
}
```

`ag.trigger.id` is higher-cardinality than a typical label. It would be useful if the API needed
all sessions from one automation, but #5767 does not expose a trigger-ID or generic-tag predicate.
That reverse query would require an additional public filter.

### 10.4 Why this implementation does not use meta

The confirmed product behavior is to show the current automation name. The implementation resolves
the schedule/subscription by stable ID and does not store a name snapshot in tags or meta.

No other current field needs a rich non-queryable document. Delivery details remain on the delivery
resource, while future usage and cost values require typed numeric summaries. Adding session meta
would create a second storage convention without serving the current interface.

### 10.5 Why not require typed provenance now?

A dedicated provenance object or table is not required for the two current questions:

1. Was this session started by a trigger?
2. Which schedule or subscription started it?

Tags answer both because the implementation provides:

- Atomic merge semantics.
- Reserved `ag.*` ownership.
- Typed API translation.
- A clear meaning for missing origin.

A GIN index is a performance optimization, not a semantic requirement. The representative query
plan was not measured, so no index was added. Add one only when measured origin filtering cost
justifies it.

Typed storage becomes valuable when one or more of these become true:

- Origin affects authorization, billing, retention, or lifecycle.
- Attribution needs database-level referential integrity or repair guarantees beyond the atomic
  claim transaction.
- More origin types appear and have different required fields.
- Referential integrity to a source entity is required.
- Reverse queries by exact delivery become common.
- Users can edit arbitrary session tags.
- Migrations or repair jobs need a versioned attribution schema.

Until then, a new provenance table would add complexity without improving the current user story.
The public interface should still be typed because public contracts and storage have different
lifetimes.

### 10.6 Atomic reserved-tag merge

The implemented attribution write atomically merges reserved keys into the existing tags
dictionary. It preserves unrelated user tags and concurrent liveness updates.

The write follows this behavior conceptually:

```sql
tags = coalesce(tags, '{}'::jsonb) || :origin_patch
```

Real-Postgres tests cover claim, history, and concurrent attribution behavior.

### 10.7 Reserved namespace

`ag.*` remains the private storage namespace. The API sanitizer removes reserved keys from every
public session `tags` map while preserving typed attribution fields and user-visible tags. Future
generic tag writes must continue to reject reserved keys.

### 10.8 Manual versus unknown

PR #5767 defines `manual` and `trigger`, but production code stamps only `trigger`.

Therefore:

| Stored state | Safe interpretation |
| --- | --- |
| `ag.origin = "trigger"` | Trigger dispatcher successfully stamped this session |
| `ag.origin = "manual"` | Supported by the model, but not written by this PR's production path |
| Missing `ag.origin` | Unknown: manual, legacy, another source, or failed trigger stamp |

The implemented frontend uses:

```json
{"exclude": {"origins": ["trigger"]}}
```

instead of:

```json
{"session": {"origins": ["manual"]}}
```

The first means `show everything not known to be triggered`. The second would hide almost every
unstamped historical and manual session.

The public API should not claim that missing means manual. It should either expose `unknown` as a
read classification or document that origin may be absent.

## 11. Last-message enrichment

### 11.1 Interface before the PR

A session list row described the stream and latest turn:

```json
{
  "session_id": "...",
  "name": "Refund request",
  "flags": {"is_alive": false},
  "references": [{"id": "agent-id"}],
  "updated_at": "..."
}
```

To display transcript content, the frontend queried session records after opening a session.

### 11.2 Interface in the reviewed PR baseline

Every row from `/sessions/query` may include:

```json
{
  "last_message": {
    "session_id": "...",
    "text": "Refund approved.",
    "source": "agent",
    "timestamp": "..."
  }
}
```

This does not add a `last_message` column to `session_streams`, and it does not write message text
into the stream row. `SessionListItem` inherits the stream fields and adds a read-time response
field. The service fetches the preview from records each time the expansion is built.

The frontend uses this field in title precedence:

```text
explicit session name
  else trigger name
  else last message
  else "Untitled session"
```

When a named row exists, the message becomes its subtitle.

### 11.3 Implemented backend behavior

When the caller requests the message expansion, the sessions service performs:

```text
1. Query session streams in the transactional database.
2. Query latest turns in the transactional database.
3. Query latest message records in the analytics/tracing database.
4. Merge the three results by session_id.
```

The records query is batched with PostgreSQL `DISTINCT ON (session_id)`. This avoids one records
request for every row.

### 11.4 Different lifecycles

Session streams and records are not written or retained in the same way.

| Session stream | Records |
| --- | --- |
| Transactional/core database | Analytics/tracing database |
| One durable row per session | Many append-only events per session |
| Updated by heartbeat and lifecycle actions | Written asynchronously from runner events |
| Used for liveness and list membership | Used for transcript and observability |
| Session lifecycle ownership | Independent tracing retention |

Consequences:

- A stream can exist before its first message record arrives.
- A session can be current while its preview is temporarily old.
- A record write can fail while the stream remains valid.
- The analytics database can be unavailable while the transactional session list is healthy.
- Deleting or archiving a session does not imply identical record retention.

`last_message` is therefore a best-effort preview, not authoritative session state.

### 11.5 Baseline problem with unconditional enrichment

In the reviewed baseline, the records query ran for every `/sessions/query` call whenever
`RecordsService` was wired. This included callers that did not render previews.

That baseline also allowed a records exception to fail the complete sessions list even though its
base stream data was available.

### 11.6 Implemented expansion

The implementation uses an explicit expansion:

```json
{
  "expand": ["last_message"]
}
```

Home and Sessions request it explicitly. Other clients avoid the cross-database query.

When requested, the implementation does the following:

- Fetches the latest turn and latest message concurrently after stream IDs are known.
- Bounds the page size.
- Catches records failures and returns the base rows without previews.
- Uses `newest message if textual` semantics.

The implementation preserves the baseline semantic: it selects the newest message and then omits
the preview if that message has no text. It does not fall back to the preceding textual message.

The response does not need `last_message.session_id` because the preview is already nested under a
specific session row.

### 11.7 Long-term options

There are two valid long-term designs.

#### Query-time expansion

Keep records authoritative and batch-load the preview when requested.

Use this while list volume and latency remain acceptable. It avoids duplicated preview state.

#### Materialized session summary

Maintain an eventually consistent read projection with fields such as:

```text
latest_message_text
latest_message_source
latest_message_at
latest_turn_reference
origin
```

Use this only if the sessions list becomes hot enough that repeated cross-database expansions are
measurably expensive. The projection is a cache for list rendering, not the transcript source of
truth.

## 12. Trigger execution and session association

### 12.1 Behavior before the PR

A triggered workflow eventually received or created a session ID, but the dispatcher did not know
which session the detached run produced. A delivery stored a detached `run_id`, not the session ID.

Consequences:

- A session row could not say that a trigger started it.
- The default sessions list could not exclude automation sessions.
- A delivery could not directly link to the resulting session.

### 12.2 Behavior in the reviewed PR baseline

After claiming a delivery, the dispatcher:

```text
1. Generates session_id.
2. Adds session_id to delivery data in memory.
3. Stamps the session stream with trigger tags.
4. Sends the same session_id in the workflow request.
5. Completes the delivery with session_id and invocation result.
```

This ensures the runner, stream, turns, and records use the same session ID.

### 12.3 Why generating the session ID early makes sense

The dispatcher is the only point that knows both sides at once:

- Which subscription or schedule fired.
- Which new workflow invocation is about to start.

If the runner generated the ID later, the dispatcher would need to recover it from a detached
response that currently does not return the session ID. Preallocation gives the dispatcher a
stable correlation value before execution starts.

### 12.4 Implemented atomic claim

The current UX requires only:

```text
session -> trigger configuration ID/kind
delivery -> session ID
```

The completed implementation provides both relationships in one Postgres claim transaction. It
claims the delivery with `data.session_id` and creates or merges the attributed session before
workflow invocation. A failed claim or attribution rolls back both writes and invokes nothing.
Completion merges result or error data without removing the claimed session ID.

### 12.5 Is delivery ID required on the session?

Yes. The confirmed product behavior includes this reverse action:

> Open the exact automation delivery that created this session.

The public response exposes delivery ID as an explicit typed relationship. The storage adapter
keeps it in a reserved tag, and the frontend does not parse that key.

### 12.6 Do we need run and trace IDs?

Not for the current list.

Add a trace link only when the row or details view offers observability navigation. Add a run ID
only when a persisted run resource exists and users can do something with it.

The earlier recommendation mentioned them to describe the complete execution chain, not to propose
putting all of them in the current session model.

## 13. Implementation disposition

### Completed

1. Aligned `POST /sessions/query` with the resource-nested query pattern.
2. Separated response options from row predicates.
3. Returned pagination windowing instead of reconstructing it in the frontend.
4. Exposed typed `origin`, `trigger`, and `delivery` response fields.
5. Kept reserved tag keys private to the backend adapter.
6. Bounded and validated ID sets.
7. Corrected the false claim that session tags already have a GIN index.
8. Merged reserved tags instead of replacing the whole dictionary.
9. Defined missing origin as unknown, not manual.
10. Made latest-message enrichment explicit and best effort.
11. Persisted delivery-to-session correlation before invocation.
12. Exposed the exact delivery ID as a typed relationship on attributed automation sessions.
13. Preserved configurations and deliveries after normal automation deletion.

### Deferred follow-up

- Protect `ag.*` from future user tag writes.
- Add a materialized session summary only after measuring list-query cost.
- Introduce typed provenance storage only when provenance becomes a protected domain invariant.
- Run the representative 10,000-session and 200,000-record benchmark before deciding whether to add
  an index.
- Address gateway connection hard deletion if product history must survive that broader operation.

### Not required for this release story

- A new workflow-run table.
- Provider event IDs on session rows.
- Run IDs on session rows.
- Trace IDs on session rows.
- Full trigger configuration on session rows.
- A new provenance table.

## 14. Confirmed product decisions

1. Automation rows display the current schedule/subscription name, not an execution-time snapshot.
2. Clicking an automation row opens the session.
3. Secondary row actions open the automation configuration and exact delivery.
4. Schedule versus subscription is visible in the row.
5. Every claimed trigger firing creates a new session.
6. Message previews appear on Home and project/agent Sessions pages only.
7. Sidebar, agent overview, mobile, reconciliation, and internal callers do not request previews.
8. The base API returns all origins. Each frontend surface chooses whether to exclude trigger
   sessions.
9. Normal automation deletion preserves configuration and delivery history.
10. This implementation does not use session meta.
11. Authenticated exact-by-ID schedule and subscription reads include soft-deleted configurations
    as read-only. Normal lists and mutations remain live-only.

Normal automation deletion does not cover gateway connection hard deletion. Hard-deleting a
gateway connection can still cascade through subscription and delivery history. This remains a
deferred risk.

## 15. Implementation verification

### Environment

- GitButler target at start: `origin/release/v0.112.0` at `965851e15d`.
- Applied stacks at start: none.
- Deployment: `http://144.76.237.122:8280`.
- Compose project: `agenta-ee-dev-wp-b2-rendering`.
- Postgres published port: 5434.

The implementation is packaged as the stacked review set described in
`session-ux-interface/implementation.md`.

### Automated evidence

- 559 non-integration session and trigger API tests passed.
- Eight core Postgres claim and history tests passed in the deployed container.
- Phase 5 trigger join, cursor, and origin Postgres tests passed in the deployed container.
- Three generated Python client tests passed.
- Frontend builds, type checks, lint, and relevant package suites passed.
- Final reviews found no P0 or P1 findings.

### Live evidence

- Schedule acceptance passed and produced linked delivery and session IDs.
- An authenticated canonical query returned the typed current trigger name and kind, typed
  delivery, terminal windowing, and only user tags.
- Exact delivery mode returned the linked session and result.

### Residual verification

- Browser QA did not run because host Chromium sandboxing is disabled. The run did not bypass the
  sandbox with `--no-sandbox`.
- Subscription live acceptance did not run because `COMPOSIO_TEST_CONNECTED_ACCOUNT` was missing.
- The representative 10,000-session and 200,000-record benchmark did not run. No index was added,
  and this review makes no representative performance claim.

## Appendix A: Future tag filtering and grouping

This appendix records a known future story. It is not in scope for PR #5767, but the current
interface should not make it difficult to add later.

### A.1 User story

As a user, I want to organize sessions with tags and use those tags to filter or group the complete
session set.

Tags may come from different owners:

- Users may add labels such as `customer=acme`, `topic=billing`, or `priority=high`.
- Agenta may add labels with stable product semantics.
- An agent may eventually organize its own sessions through an Agenta-controlled tool.

One important product-defined classification is the session's work status:

```text
todo
in_progress
done
blocked
parked
```

This is the status of the work represented by the session. It is not whether an agent is currently
running or waiting for a person.

### A.2 Status vocabulary

The current session stack already uses the word `status` for several unrelated concepts.

| Concept | Examples | Owner | Meaning |
| --- | --- | --- | --- |
| Work status | todo, in progress, done, blocked, parked | User-managed, Agenta-defined vocabulary | How the user organizes the work |
| Runtime liveness | alive, running, attached | Agenta runtime | Whether execution infrastructure is active |
| Interaction state | waiting for approval, waiting for input | Agenta runtime and user interaction | Whether the agent needs a human response |
| Lifecycle | ended, archived | User and session service | Whether the session remains active or visible |
| Generic tags | customer=acme, topic=billing | User, agent, or Agenta | Open-ended classification |

A session can be all of the following at once:

```text
work_status = blocked
is_alive = false
waiting_for_input = false
archived = false
```

Calling all of these fields `status` would make filters and row labels ambiguous. This appendix
uses `work_status` for `todo`, `in_progress`, `done`, `blocked`, and `parked`.

### A.3 Does this change the interface decision?

It changes the decision from `only domain-specific filters` to a hybrid interface.

The API should support both:

1. Generic tags when tags themselves are the product feature.
2. Typed fields for stable domain concepts whose semantics matter outside generic labeling.

This means the public interface can expose:

```json
{
  "session": {
    "tags": {"customer": "acme", "topic": "billing"},
    "work_statuses": ["blocked", "parked"],
    "origins": ["trigger"]
  }
}
```

All three may compile to JSONB tag predicates internally. They are still different public
concepts:

- `tags` means caller-selected labels with generic containment semantics.
- `work_statuses` means a validated product vocabulary.
- `origins` means who or what initiated the session, including null/unknown compatibility rules.

The existence of generic tag filtering does not require callers to write:

```json
{
  "session": {
    "tags": {
      "ag.origin": "trigger",
      "ag.work_status": "blocked"
    }
  }
}
```

That shape would expose storage keys and make callers reproduce domain rules. It would also allow
typos and invalid values to bypass validation.

### A.4 Public tags versus storage tags

Once users can intentionally create and filter tags, tags are no longer only a backend
implementation detail. They become part of the public session resource.

The boundary should distinguish two things:

| Concept | Public? | Example |
| --- | --- | --- |
| Public generic tag | Yes | `customer=acme` |
| Documented Agenta tag intended for generic use | Yes | A future stable classification explicitly documented as a tag |
| Private storage tag behind a typed field | No | `ag.origin=trigger` behind `origin` |
| Internal implementation marker | No | Migration or repair bookkeeping |

The physical database may store all four in one JSONB column. The response adapter does not have to
return every physical key through the public `tags` map.

This preserves storage flexibility:

```text
Public session.origin       -> stored temporarily as tags["ag.origin"]
Public session.work_status  -> may be stored as tags["ag.work_status"]
Public session.tags         -> stored as user-visible tag entries
```

### A.5 Namespace and ownership

A namespace needs both semantic ownership and write policy.

One workable policy is:

| Namespace | Meaning | Generic user write |
| --- | --- | --- |
| `ag.*` | Agenta-defined semantics | Rejected |
| Unprefixed or a future custom namespace | User-defined labels | Allowed with validation |

`ag.*` does not have to mean that only background services can ever change the value. It means
Agenta owns the field's definition and validation.

For example, `work_status` is selected by a user but follows an Agenta-defined vocabulary. A
dedicated work-status operation may write `ag.work_status` internally. The generic tag-edit API
still rejects direct writes to `ag.*`.

This prevents a generic tag update from changing origin or bypassing work-status validation.

The exact custom-tag namespace should be decided after checking existing SDK and API conventions.
The important rule is that custom and reserved keys cannot overwrite each other.

### A.6 Work status as a typed field

Work status deserves a typed public field if Agenta standardizes:

- Its allowed values.
- Its filter behavior.
- Its display labels and ordering.
- Its grouping behavior.
- Which users or agents may change it.

A possible response is:

```json
{
  "session_id": "session-a",
  "work_status": "blocked",
  "tags": {
    "customer": "acme",
    "topic": "billing"
  }
}
```

A possible update operation is:

```http
POST /sessions/session-a/work-status
Content-Type: application/json

{"work_status": "blocked"}
```

The endpoint shape is illustrative. The important distinction is that it validates the work-status
vocabulary instead of treating the value as an arbitrary tag.

If the product does not standardize this vocabulary, `status=blocked` can remain a generic
user-created tag. In that case Agenta should not attach special behavior or UI assumptions to it.

### A.7 Generic tag updates

The generic tag interface should patch keys rather than replace the complete dictionary.

An illustrative request is:

```json
{
  "set": {
    "customer": "acme",
    "topic": "billing",
    "priority": "high"
  },
  "unset": ["old-label"]
}
```

Required semantics:

- `set` changes only the named custom keys.
- `unset` removes only the named custom keys.
- Reserved keys cannot be changed through this interface.
- Concurrent system attribution writes are preserved.
- Keys and values follow bounded label types rather than arbitrary unbounded JSON.

This future story makes #5767's whole-tag replacement more clearly unsafe. Origin stamping must not
erase user tags, and user edits must not erase origin stamping.

### A.8 Generic tag filters

The smallest useful generic filter follows the repository's existing containment convention:

```json
{
  "session": {
    "tags": {
      "customer": "acme",
      "priority": "high"
    }
  }
}
```

Its documented meaning should be:

```text
customer = acme AND priority = high
```

This is a good first version because it maps directly to JSONB containment and matches established
Agenta resource queries.

More expressive requirements should not be guessed in advance. If the product later needs `OR`,
key existence, value sets, or negative matches, extend the contract deliberately. For example:

```json
{
  "session": {
    "tag_filter": {
      "all": [
        {"key": "customer", "operator": "eq", "value": "acme"},
        {"key": "priority", "operator": "in", "value": ["high", "urgent"]}
      ]
    }
  }
}
```

There is no reason to introduce this expression language before a real story needs it.

### A.9 Grouping and pagination

Tag filtering fits naturally into `/sessions/query`. Grouping is a separate concern because the
list is cursor-paginated.

The frontend cannot fetch one page, group those rows, and claim to have grouped the complete set.
Later pages may contain more values or may change every group's count and ordering.

There are two practical designs.

#### Known finite groups

For work status, the frontend knows the complete vocabulary. It can issue one filtered query per
visible group:

```json
{"session": {"work_statuses": ["todo"]}, "windowing": {"limit": 30}}
```

```json
{"session": {"work_statuses": ["blocked"]}, "windowing": {"limit": 30}}
```

Each group owns its own cursor. This works well for a board with a small fixed set of columns.

If column counts are required, the API also needs a count or facets operation that applies the
same base filters.

#### Arbitrary tag groups

For `group by customer`, the frontend may not know all values in advance. It first needs facets:

```json
{
  "field": {"tag": "customer"},
  "base_filter": {
    "include_archived": false
  }
}
```

Conceptual response:

```json
{
  "facets": [
    {"value": "acme", "count": 42},
    {"value": "globex", "count": 17},
    {"value": null, "count": 8}
  ]
}
```

The frontend can then query each selected group through `/sessions/query`, with an independent
cursor per group.

A single endpoint that returns every group and every group's rows would need nested pagination
cursors and is unnecessary for the first iteration.

### A.10 Indexing impact

Origin alone may not justify a new tags index at current cardinality. A product feature offering
arbitrary tag filtering and grouping changes the expected query load.

Before shipping generic tag filtering:

- Define bounded tag key and value types.
- Measure representative project cardinality.
- Inspect containment and facet query plans.
- Add the appropriate GIN index for containment queries when needed.
- Consider targeted expression indexes for a very hot standardized field such as work status.

An index supports a query shape; it should follow the documented filter and grouping contract.

### A.11 Effect on the provenance decision

This future story does not require a dedicated provenance table.

It strengthens four short-term requirements:

1. Origin writes must merge instead of replacing tags.
2. Reserved namespaces need enforced ownership.
3. Session tag values need bounded public types.
4. The response must distinguish public tags from private storage markers.

It also clarifies why the API should not choose between `all typed fields` and `all raw tags`.

The durable interface is hybrid:

```text
Generic labels       -> public tags interface
Stable domain fields -> typed origin and work_status interfaces
Physical storage     -> may use one JSONB tags column initially
```

This gives users open-ended organization without making every caller understand Agenta's internal
tag keys.

### A.12 Decisions for future tag implementation

1. Is work status an Agenta-defined vocabulary or an arbitrary custom tag?
2. Can agents change work status and user tags, or only human users?
3. Are Agenta-created public tags visible in the same map as user-created tags?
4. Which tag keys are reserved, and how does the API report a rejected reserved-key write?
5. Does the first grouping UI use fixed work-status columns or arbitrary tag keys?
6. Are facet counts required, and must they be exact?
7. What are the maximum number of tags, key length, value length, and allowed value types?

### A.13 Usage, cost, and models

Future session rows may also show:

- Total input and output tokens.
- Total cost.
- The model or models used in the session.

These values do not have the same semantic role as tags.

| Information | Role | Source of truth | Suitable session representation |
| --- | --- | --- | --- |
| Token counts | Numeric usage aggregate | Per-turn usage records or traces | Typed summary field |
| Cost | Numeric monetary aggregate | Per-turn usage/cost records | Typed summary field |
| Model used | Execution/configuration identity | Turn, trace, or effective run configuration | Typed model list or summary |
| `customer=acme` | Classification label | Session tags | Generic tag |

#### Tokens and cost are not tags

Tags are designed for label equality and containment:

```json
{"customer": "acme", "priority": "high"}
```

Token and cost queries need numeric semantics:

```text
total_tokens > 100000
total_cost between 1.00 and 10.00
sum cost by project
order sessions by cost
```

Encoding numeric values as tags would lose numeric ordering and aggregation semantics. It would
also produce high-cardinality GIN entries that change after every turn.

Meta can hold a usage snapshot, but meta is not a good authoritative query surface. A snapshot can
be useful for debugging or compatibility, but consumers should not parse an arbitrary meta path to
calculate billing or sort sessions.

The public response should use typed fields, for example:

```json
{
  "session_id": "session-a",
  "usage": {
    "input_tokens": 12400,
    "output_tokens": 3100,
    "total_tokens": 15500,
    "cost": {
      "amount": "0.0842",
      "currency": "USD"
    }
  }
}
```

Money should not use a binary floating-point value. The contract should use a decimal string or
minor units, include currency, and state whether the value is estimated or charged.

#### A session may use several models

A session can contain several turns. Different turns may use different workflow revisions or model
configurations. One turn may also call more than one model.

A singular field such as:

```json
{"model": "gpt-5"}
```

is ambiguous unless the product defines it as one of:

- Model used by the latest turn.
- Primary model configured for the latest workflow revision.
- Model responsible for most token usage.
- Only model used across the entire session.

A safer summary is explicit:

```json
{
  "models": [
    {
      "provider": "openai",
      "model": "gpt-5",
      "input_tokens": 12000,
      "output_tokens": 3000
    },
    {
      "provider": "openai",
      "model": "text-embedding-3-small",
      "input_tokens": 400,
      "output_tokens": 0
    }
  ],
  "latest_model": {
    "provider": "openai",
    "model": "gpt-5"
  }
}
```

The interface should include only the summary the UI actually uses. A model breakdown can remain
an expansion or details endpoint until the product needs it.

#### Read-time expansion versus materialized summary

Usage, cost, and model information can follow the same two designs as last-message previews.

Query-time expansion:

```json
{
  "expand": ["usage", "models"]
}
```

The API aggregates records or traces for only the sessions in the current page. This avoids
duplicating state but adds cross-domain query cost.

Materialized summary:

```text
session_usage_summary
  input_tokens
  output_tokens
  total_tokens
  cost_amount
  cost_currency
  latest_model
  models_used
  updated_at
```

This makes list sorting, filtering, and grouping cheaper, but it is an eventually consistent read
model. Usage records remain the source of truth.

Choose based on the user story:

- Display usage on a small page: query-time expansion may be enough.
- Sort or filter every session by cost/tokens: materialize indexed numeric fields.
- Aggregate billing: use the authoritative usage/billing domain, not session tags or previews.
- Group by model: define model identity and multi-model grouping semantics first, then use a typed
  model filter or a deliberately maintained projection.

#### Can model identity also be a tag?

A model label can be denormalized into a tag for a narrow equality filter, but only after defining
which model the tag represents. For example, `ag.latest_model` and `ag.models_used` have different
meanings and cardinality.

If the public API offers `models`, callers should filter through a typed model field. The backend
may compile that filter to an indexed projection or tags internally. Callers should not need to
know the projection key.

#### Effect on the interface decision

This story strengthens the hybrid design:

```text
Tags                  -> categorical labels
Meta                  -> rich non-queryable context and snapshots
Typed session summary -> usage, cost, model summaries, work status, origin
Records and traces    -> per-execution source of truth
```

It does not justify putting every summary directly on the stored session stream. It justifies a
clear public session-summary interface whose fields may be read-time expansions or materialized
projections depending on measured query needs.
