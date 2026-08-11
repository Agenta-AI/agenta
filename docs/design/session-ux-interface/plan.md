# Session UX interface implementation plan

Status: implemented, with residual verification listed in `status.md`.

Phases 1 through 9 are complete. The representative performance benchmark in Phase 10 was not run,
and no index was added. Phase 11 completed automated API, Postgres, generated-client, and frontend
checks. Browser QA and subscription live acceptance remain incomplete for the reasons recorded in
`status.md`.

## Outcome

The revision gives callers a stable typed contract, lets users inspect the exact automation
delivery behind a session, and runs expensive enrichments only where the UI displays them.

The implementation keeps existing JSONB and lifecycle columns. It requires no data backfill and no
mandatory database schema migration.

## Change summary

| Area | Change | Reason |
| --- | --- | --- |
| Attribution storage | Merge origin, trigger ID/kind, and delivery ID into JSONB tags | Preserve existing and future user tags without adding columns |
| Trigger name | Resolve current name through an optional API expansion | Confirmed product behavior; avoids stale snapshots and meta |
| Delivery history | Soft-delete configurations and retain deliveries | Sessions must open the exact historical delivery |
| Session query | Add resource-nested filters and typed response fields | Match repository conventions and hide storage keys |
| Origin default | Return all origins when no filter is supplied | Keep API neutral; frontend owns presentation policy |
| Pagination | Return `next` and `newest` | Stop clients rebuilding an internal cursor |
| Message preview | Make it an optional expansion | Avoid records queries on callers that do not display previews |
| Row actions | Keep session open as primary; add configuration and delivery actions | Preserve current behavior while exposing history |
| Meta | Do not use it | No current requirement needs a rich non-queryable snapshot |

## Data and performance impact

### Data migration

There is no data migration or backfill.

The feature is pre-production. Tests create new attributed sessions through the revised write path.
The implementation does not attempt to repair rows created by earlier branches.

If the v0.112 branch creates test sessions before the revised writer lands, those rows may lack an
exact delivery ID. The typed response returns `delivery: null`, and the frontend hides `View
delivery` for those rows. Treat that data as disposable pre-production data; do not add a repair
path.

Do not release the session UX to production between the #5827 merge and the revised attribution
writer. The production release unit must include the writer before users can create durable
automation sessions.

### Database schema

No mandatory database schema migration is planned.

The existing schema already provides:

- JSONB `session_streams.tags`.
- JSON `trigger_deliveries.data`.
- Lifecycle fields on trigger subscriptions and schedules.
- Exact delivery IDs and retrieval.

The implementation changes application behavior and query predicates, not columns or constraints.

Indexes are a measured follow-up. Do not add a migration for an index until a representative query
plan demonstrates the need.

### Frontend network requests

The session-list request count does not increase compared with PR #5767.

- Current automation names are hydrated by the sessions API when requested.
- The frontend does not issue one trigger request per row.
- The delivery endpoint is called once after the user selects `View delivery`.
- Opening an automation uses the existing trigger entity/drawer fetch and cache.

### Backend queries

PR #5767 always queries streams, latest turns, and latest messages.

The revised implementation runs only requested enrichments:

| Surface | Message expansion | Current automation expansion |
| --- | ---: | ---: |
| Home human sessions | Yes | No |
| Home automation sessions | Yes | Yes |
| Project Sessions default mode | Yes | No |
| Project Sessions automation mode | Yes | Yes |
| Agent-scoped Sessions default mode | Yes | No |
| Agent-scoped Sessions automation mode | Yes | Yes |
| Sidebar | No | No |
| Agent overview | No | No |
| Mobile | No | No |
| Internal/reconciliation callers | No | No |

Current automation hydration uses a conditional read-model join from session streams to schedules
and subscriptions. It adds no database roundtrip and no frontend request. The join runs only when
the caller requests the trigger expansion.

Home cards may mount waiting, pinned, and recent queries. The Sessions page may mount pinned and
recent queries. Performance verification must measure the complete group pattern, not one isolated
request.

Worst-case request totals (waiting and pinned groups both present, no total count):

| Surface | HTTP requests | SQL roundtrips | PR #5767 SQL roundtrips |
| --- | ---: | ---: | ---: |
| Home human + automation cards | 7 | 19 | 19 |
| Project Sessions | 3 | 7 | 7 |
| Agent-scoped Sessions | 3 | 9 | 9 |
| Sidebar pinned + recent | 2 | 4 | 6 |

Home and Sessions totals include one shared actionable-interactions request. The conditional trigger
join does not add a roundtrip.

## Target interface

### Request

```json
{
  "session": {
    "search": "refund",
    "liveness": {
      "is_alive": true
    },
    "origins": ["trigger"]
  },
  "session_ids": ["session-a"],
  "turn_references": [
    {"id": "019d952f-0000-0000-0000-000000000000"}
  ],
  "exclude": {
    "session_ids": ["session-pinned"],
    "origins": ["trigger"]
  },
  "include_ended": true,
  "include_archived": false,
  "include_total": false,
  "expand": ["last_message", "trigger"],
  "windowing": {
    "limit": 30,
    "next": "...",
    "newest": "2026-08-10T12:03:14Z"
  }
}
```

### Request semantics

- Missing origin filters return every origin.
- `session.origins=["trigger"]` selects attributed automation sessions.
- `exclude.origins=["trigger"]` excludes attributed automation sessions and preserves unknown
  rows.
- Missing attribution means unknown. It does not mean manual.
- Positive predicates intersect.
- Exclusions apply before ordering and pagination.
- An explicit empty inclusion ID list matches nothing.
- Each inclusion or exclusion ID set accepts at most 500 validated session IDs.
- `include_total` changes response work, not row membership.
- `expand` selects optional response work.

### Response

```json
{
  "count": 1,
  "sessions": [
    {
      "id": "019d952f-0000-0000-0000-000000000010",
      "session_id": "session-a",
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
      "references": [{"id": "019d952f-0000-0000-0000-000000000020"}],
      "last_message": {
        "text": "Digest delivered.",
        "source": "agent",
        "timestamp": "2026-08-10T12:03:14Z"
      }
    }
  ],
  "windowing": {
    "next": "019d952f-0000-0000-0000-000000000010",
    "newest": "2026-08-10T12:03:14Z",
    "limit": 30
  }
}
```

`trigger.name` appears only when the caller requests the trigger expansion and the current
configuration can be resolved. The typed trigger and delivery IDs remain available without the
name.

## Phase 1: Update planning sources

### Work

1. Replace the open product questions in `../session-ux-interface-review.md` with the confirmed
   decisions in `context.md`.
2. Correct the previous statement that delivery IDs are unnecessary on session rows.
3. Record that deleted automation history is preserved.
4. Record that current names replace snapshots.
5. Record that this implementation uses no meta.

### Reason

The implementation plan and research document must describe one contract. Leaving old questions
open would send implementers toward incompatible choices.

## Phase 2: Make attribution merge-safe and delivery-aware

### Work

1. Define typed core values for:
   - Session origin.
   - Trigger kind (`schedule` or `subscription`).
   - Trigger configuration ID.
   - Delivery ID.
2. Introduce a narrow transactional delivery/session-claim interface for trigger dispatch.
3. Keep reserved tag keys inside the sessions persistence adapter.
4. Replace whole-object tag writes with an atomic JSONB merge of owned keys.
5. Store:

   ```json
   {
     "ag.origin": "trigger",
     "ag.trigger.id": "...",
     "ag.trigger.kind": "schedule",
     "ag.trigger.delivery_id": "..."
   }
   ```

6. Stop writing `ag.trigger.name`.
7. Do not write session meta.

### Dispatch sequence

1. Resolve the schedule/subscription and delivery event identity.
2. Generate delivery and session IDs.
3. In one Postgres transaction, atomically claim the delivery with `data.session_id` and create or
   merge the attributed session stream.
4. Commit both rows together. If the event conflict loses or attribution fails, roll back both.
5. Stop when another worker already claimed the event. The unused generated IDs have no persisted
   effect.
6. Validate references and map inputs.
7. Invoke the workflow with the same session ID.
8. Complete the delivery by merging result/error data without removing `session_id`.

The delivery and session tables use the same transactional Postgres engine. One unit-of-work
adapter preserves the invariant without a schema change or committed intermediate state. Including
`session_id` in the initial claim also avoids an additional database update compared with PR #5767.

### Failure behavior

- A failed atomic claim creates no session and invokes nothing.
- A failed attribution rolls back the delivery claim, creates no session, and invokes nothing.
- A validation failure keeps the attributed session, completes the claimed delivery as failed,
  and invokes nothing.
- An invocation failure keeps the attributed session and failed delivery for inspection.
- Duplicate provider delivery remains idempotent.

### Primary files

- `api/oss/src/core/sessions/dtos.py`
- `api/oss/src/core/sessions/streams/interfaces.py`
- `api/oss/src/core/sessions/streams/service.py`
- `api/oss/src/dbs/postgres/sessions/streams/dao.py`
- `api/oss/src/tasks/asyncio/triggers/dispatcher.py`
- `api/oss/src/core/triggers/dtos.py`
- `api/oss/src/core/triggers/interfaces.py`
- `api/oss/src/dbs/postgres/triggers/dao.py`
- `api/entrypoints/routers.py`
- `api/entrypoints/worker_queues.py`

### Tests

- The delivery claim, session attribution, and workflow request use the same session ID.
- The attribution stores the exact delivery ID.
- Different event IDs create different sessions.
- Duplicate event claims create no second session.
- Schedule and subscription kinds are correct.
- Existing custom tags survive attribution.
- A concurrent heartbeat does not erase attribution or liveness.
- No name or meta is written.
- Completion preserves the claimed `session_id`.
- Attribution failure rolls back both delivery and session writes and permits a safe retry.
- A validation failure still leaves one attributed session linked to its failed delivery.

### Integration coverage

Add real-Postgres integration tests for the two behaviors fake DAOs cannot prove:

- Concurrent heartbeat and attribution SQL preserve flags and tags without a lost update.
- Normal automation deletion retains configuration and delivery rows through the real foreign-key
  graph.

## Phase 3: Preserve deleted automation history

### Work

1. Change schedule deletion from physical deletion to lifecycle soft deletion.
2. Change subscription deletion from physical deletion to lifecycle soft deletion after provider
   cleanup.
3. Add `deleted_at IS NULL` to normal schedule and subscription list queries.
4. Exclude deleted configurations from dispatch and provider-trigger lookup paths.
5. Reject edits and activation changes on deleted configurations.
6. Allow authenticated exact-by-ID retrieval of a deleted configuration for historical display.
7. Preserve physical purge as an explicit administrative/test operation, not normal deletion.
8. Keep delivery rows unchanged and retrievable.
9. Change the temporary `test_subscription(... finally: delete_subscription(...))` cleanup path to
   use a service-level test cleanup operation. That operation deletes the provider-side trigger
   first, then physically purges the local test configuration and deliveries.
10. Re-resolve schedules from live persistence when queued work executes. Do not trust a serialized
    schedule after it may have been deleted or disabled. Accept the existing queued payload shape
    during the v0.112 rollout.

### Schema impact

None. Trigger subscriptions and schedules already inherit `LifecycleDBA` and already have
`deleted_at` indexes.

### Reason

Current DAO deletion calls `session.delete()`. Delivery foreign keys use `ON DELETE CASCADE`, so
physical deletion removes the delivery that a session needs to inspect. Soft deletion preserves
the existing foreign-key graph.

### Primary files

- `api/oss/src/core/triggers/service.py`
- `api/oss/src/core/triggers/interfaces.py`
- `api/oss/src/dbs/postgres/triggers/dao.py`
- `api/oss/src/apis/fastapi/triggers/models.py`
- `api/oss/src/apis/fastapi/triggers/router.py`
- `api/oss/src/tasks/taskiq/triggers/worker.py`

### Tests

- Normal deletion sets lifecycle fields and retains the row.
- Provider-side subscription cleanup still runs.
- Normal list and dispatch queries exclude deleted configurations.
- Exact historical retrieval can read a deleted configuration.
- Delivery retrieval still works after configuration deletion.
- Deleted schedules cannot fire.
- Deleted subscriptions cannot process provider events.
- Temporary subscription tests physically purge their test configuration and deliveries.
- Temporary subscription cleanup removes the provider trigger before local purge.
- A real-Postgres integration test proves normal deletion does not activate delivery cascades.

## Phase 4: Revise the sessions query contract

### Work

1. Add API request models for:
   - Nested `session` predicates.
   - `exclude` predicates.
   - `expand` options.
   - Typed plural origins.
2. Keep existing flat fields as compatibility inputs for already released session clients.
3. Normalize both shapes in `apis/fastapi/sessions/utils.py`.
4. Reject contradictory duplicate values with a 422 response.
5. Separate row predicates from lifecycle, response options, and pagination.
6. Bound and validate session-ID lists.
7. Resolve turn references once and reuse the ID set for page and total.
8. Decode private attribution tags into typed response fields.
9. Keep reserved attribution keys in the legacy raw `tags` response during the API/client
   transition so the existing #5769 frontend continues to work.
10. Prepare one API-boundary sanitizer that removes reserved keys while preserving non-reserved
   user-visible tags. Enable it only in the final cleanup phase after all frontend reads are typed.
11. Audit plain stream fetch/query responses as well as root session-list responses so the final
   cleanup covers every public session endpoint.
12. Keep an empty request neutral about origin.
13. Return response windowing with `next` and `newest`.
14. Keep `include_total` outside the core predicate DTO.

### Compatibility policy

The endpoint predates PR #5767. Do not break existing references, search, lifecycle, or windowing
callers.

During the v0.112 stack rollout:

- Backend accepts old and new shapes.
- New frontend sends the new shape.
- Response additions remain optional and additive.
- Generated clients replace the temporary type widening.

### Primary files

- `api/oss/src/apis/fastapi/sessions/models.py`
- `api/oss/src/apis/fastapi/sessions/router.py`
- `api/oss/src/apis/fastapi/sessions/utils.py` (new)
- `api/oss/src/core/sessions/dtos.py`
- `api/oss/src/core/sessions/service.py`
- `api/oss/src/core/sessions/streams/dtos.py`
- `api/oss/src/core/sessions/streams/interfaces.py`
- `api/oss/src/core/sessions/streams/service.py`
- `api/oss/src/dbs/postgres/sessions/streams/dao.py`
- `api/oss/src/apis/fastapi/shared/utils.py`

### Tests

- Empty request returns trigger and unknown-origin sessions.
- Trigger inclusion and exclusion work before pagination.
- Excluding trigger retains null/unstamped tags.
- Existing flat payloads remain valid.
- Nested and equivalent flat payloads produce the same predicate.
- Contradictory fields fail validation.
- Empty inclusion IDs match nothing.
- Inclusion and reference filters intersect.
- Exclusion values win on overlap.
- ID list bounds are enforced.
- Page and total share one reference resolution.
- Returned cursor matches coalesced session activity ordering.
- Typed attribution is present while legacy raw tags remain during compatibility.

## Phase 5: Add optional response expansions

### Last-message expansion

1. Run the records query only for `expand=["last_message"]`.
2. Remove `session_id` from the nested public preview.
3. Fetch latest turns and messages concurrently after stream IDs are known.
4. Catch records lookup failures and return the base list without previews.
5. Preserve PR #5767 semantics: select the newest message and omit the preview when that message
   has no text.

### Current-trigger expansion

1. Add `expand=["trigger"]`.
2. Extend the existing `SessionStreamsDAOInterface.query()` with a typed
   `include_trigger_details` read option and return a typed stream-list projection.
3. Keep query ownership in `dbs/postgres/sessions/streams/dao.py`. Implement conditional left joins
   to schedules and subscriptions by project, kind, and ID in the same stream statement.
4. Include soft-deleted configurations in this historical join so their last persisted name
   remains available.
5. Skip both trigger-table joins when the expansion is absent.
6. Include the current or last persisted name in the typed trigger response.
7. Include typed trigger ID/kind and delivery ID even when name lookup fails.
8. Return a null name only when the referenced configuration is genuinely missing.
9. Compare the UUID columns as text to the reserved tag values. A malformed legacy trigger ID
   produces no PostgreSQL cast error and yields `trigger: null`; it is not actionable. Parse
   delivery ID independently, yielding `delivery: null` when malformed.
10. Treat a database failure in the joined stream statement like any stream-query failure. Only
    records hydration is best effort because it uses a separate analytics database.

### Reason

This design avoids additional frontend list-time requests and database roundtrips. It adds indexed
join work only when the caller asks for the current automation name.

### Primary files

- `api/oss/src/core/sessions/service.py`
- `api/oss/src/core/sessions/records/dtos.py`
- `api/oss/src/core/sessions/records/interfaces.py`
- `api/oss/src/core/sessions/records/service.py`
- `api/oss/src/dbs/postgres/sessions/records/dao.py`
- `api/oss/src/core/sessions/streams/interfaces.py`
- `api/oss/src/dbs/postgres/sessions/streams/dao.py`
- `api/entrypoints/routers.py`

### Tests

- No expansion performs no records lookup or trigger-table join.
- Message expansion makes one batch records call.
- Trigger expansion remains one stream SQL roundtrip with conditional indexed joins.
- Trigger rename is visible without changing the session.
- Soft-deleted configurations retain their last persisted name.
- A malformed trigger ID tag returns `trigger: null` without failing the query.
- A database failure in the joined trigger stream query fails the request like any stream query and
  does not issue fallback SQL.
- Message expansion failure does not fail the list.

## Phase 6: Regenerate clients and update entity contracts

### Work

1. Regenerate TypeScript and Python clients from the revised OpenAPI.
2. Rebuild the generated TypeScript package.
3. Remove the temporary Fern type assertion in `querySessions`.
4. Add `querySessionsPage()` returning sessions, total, and windowing.
5. Keep a temporary list-only wrapper for callers that do not need envelope fields.
6. Extend the frontend Zod boundary with typed origin, trigger, delivery, preview, and windowing.
7. Include expansions in query keys.
8. Prefer response cursor data instead of reconstructing it from rows.
9. Keep a temporary row-cursor fallback while old and new API versions can coexist.

### Primary files

- `web/packages/agenta-api-client/src/generated/`
- `clients/python/agenta_client/`
- `web/packages/agenta-sdk/src/resources.ts`
- `web/packages/agenta-entities/src/session/api/api.ts`
- `web/packages/agenta-entities/src/session/core/schema.ts`
- `web/packages/agenta-entities/src/session/state/listOptions.ts`

### Tests

- The Fern client receives the nested request shape.
- The response boundary accepts typed attribution.
- Expansion values participate in query keys.
- Returned windowing takes precedence over fallback reconstruction.
- Old responses without typed fields degrade safely during rollout.

## Phase 7: Update headless session policy

### Work

1. Remove direct reads of `ag.origin`, `ag.trigger.name`, and `ag.trigger.kind`.
2. Build the row view model from typed attribution.
3. Expose automation data:

   ```ts
   interface SessionAutomationVm {
       id: string
       kind: "schedule" | "subscription"
       name: string | null
        deliveryId: string | null
   }
   ```

4. Preserve row-title precedence:
   - Explicit session name.
   - Current automation name.
   - Message preview.
   - Untitled session.
5. Use fallback labels when the current name is unavailable:
   - `Missing schedule`
   - `Missing event subscription`
6. Render automation kind independently from the name.
7. Keep every trigger firing as a separate session.
8. Add a caller-owned expansion parameter to `useSessionCardList` and `useSessionList`. Do not
   infer preview policy inside a shared hook.
9. Pass expansions explicitly from Home and Sessions composition call sites. Agent overview,
   sidebar, mobile, and internal callers pass none.

### Expansion policy

- Home human sessions request `last_message`.
- Home automation sessions request `last_message` and `trigger`.
- Sessions default mode requests `last_message`.
- Sessions automation mode requests `last_message` and `trigger`.
- All other consumers request neither.

### Primary files

- `web/packages/agenta-sessions/src/row/sessionTrigger.ts`
- `web/packages/agenta-sessions/src/row/sessionRowTitle.ts`
- `web/packages/agenta-sessions/src/row/viewModel.ts`
- `web/packages/agenta-sessions/src/state/useSessionList.ts`
- `web/packages/agenta-sessions/src/state/useSessionCardList.ts`
- `web/packages/agenta-sessions/src/state/useSessionsList.ts`
- `web/oss/src/components/pages/agent-home/components/HomeSessionsSection.tsx`
- `web/oss/src/components/pages/agent-home/components/HomeAutomationsSection.tsx`
- `web/oss/src/components/pages/overview/agent/AgentOverview.tsx`
- `web/oss/src/components/pages/sessions/SessionsPage.tsx`
- `web/oss/src/components/Sidebar/dynamic/sessionsSource.ts`

### Tests

- Row models use typed fields and no reserved keys.
- Current name appears after a rename.
- Soft-deleted configurations keep their last persisted name.
- Kind remains visible when name is absent.
- Delivery ID reaches row actions.
- Every call site requests only its approved expansions.
- Default API behavior and frontend exclusion behavior remain separate.

## Phase 8: Add configuration and delivery actions

### Work

1. Keep row body/title click opening the session.
2. Add neutral secondary menu entries:
   - `Open automation`
   - `View delivery`
3. Stop event propagation from secondary actions.
4. Open the schedule or subscription drawer using typed kind and ID.
5. Extend the delivery drawer state to focus one exact delivery ID.
6. Add an exact-only drawer mode. In this mode, suppress the existing owner-scoped paginated
   delivery-list query.
7. Fetch exact delivery with `GET /triggers/deliveries/{delivery_id}` as the only delivery request.
8. Show delivery ID, event ID, status, inputs, result/error, timestamps, and linked session.
9. Hide or disable only the unavailable secondary action when IDs or permissions are missing.
10. Keep the session action available without `VIEW_TRIGGERS`.

### Package placement

- Neutral row action contracts remain in `@agenta/sessions-ui`.
- Trigger entity state and fetches remain in `@agenta/entities/gatewayTrigger`.
- Trigger-specific drawers remain in `@agenta/entity-ui`.
- App composition and routing remain in `web/oss`.

### Primary files

- `web/packages/agenta-sessions-ui/src/SessionRow.tsx`
- `web/packages/agenta-entities/src/gatewayTrigger/api/api.ts`
- `web/packages/agenta-entities/src/gatewayTrigger/state/`
- `web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/TriggerDeliveriesDrawer.tsx`
- `web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/TriggerScheduleDrawer.tsx`
- `web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/TriggerSubscriptionDrawer.tsx`
- `web/oss/src/components/pages/sessions/SessionsPage.tsx`
- `web/oss/src/components/pages/sessions/components/SessionListCard.tsx`

### Tests

- Primary click opens the session.
- Secondary actions do not open the session.
- Correct configuration drawer opens for each kind.
- Delivery fetch uses the exact ID and project scope.
- Exact-only delivery mode does not mount the owner delivery-list query.
- Deleted configuration does not block delivery inspection.
- Missing trigger permission affects only trigger actions.

## Phase 9: Apply explicit frontend origin policies

### Policy matrix

| Caller | Origin policy |
| --- | --- |
| Home human sessions | Exclude trigger |
| Home automation sessions | Trigger only |
| Sessions default mode | Exclude trigger |
| Sessions automation mode | Trigger only |
| Sidebar | Exclude trigger |
| Agent overview | Explicitly choose based on its list purpose; no inherited default |
| Mobile | Preserve its current product behavior explicitly |
| Internal/reconciliation | All origins unless its specific job requires otherwise |

### Work

1. Remove any backend default exclusion.
2. Require every list factory to pass or deliberately omit origin policy.
3. Include origin policy in query keys.
4. Add request-shape tests for each consumer class.
5. After every frontend consumer reads typed attribution, enable the API sanitizer that removes
   reserved attribution keys from all public session `tags` maps.
6. Deploy the sanitizer atomically with the typed frontend or in a top stacked lane that includes
   the frontend migration. Never deploy it before the frontend stops reading `ag.*`.
7. Add final-cleanup tests proving typed attribution remains present while every public session
   response omits reserved attribution keys.

### Reason

Origin filtering is presentation policy. A neutral API prevents one frontend's default from
silently affecting another consumer.

## Phase 10: Deferred performance benchmark

This benchmark was not run. The implementation added no index and makes no representative latency
claim.

### Work

1. Seed representative project session and records volume in the normal test/development
   environment:
   - 10,000 session streams in one project.
   - 1,000 trigger-attributed sessions split across schedules and subscriptions.
   - 20 records per session (200,000 records total).
   - 100 pinned IDs and 100 waiting IDs.
   - Page size 30.
2. Capture `EXPLAIN (ANALYZE, BUFFERS)` for:
   - Origin containment with project scope.
   - Latest-message expansion for one normal page.
   - Conditional current-trigger stream joins.
3. Record query latency and rows scanned.
4. Benchmark full Home and Sessions behavior with waiting, pinned, and recent groups active.
5. Add no index when existing project/lifecycle indexes satisfy the budget below.
6. If evidence requires an index, write a separate schema-migration task and document its write and
   storage cost before implementation.

### Initial acceptance budget

Use the original PR as the comparison baseline:

- Non-preview callers must perform less backend work than PR #5767.
- Human-session preview pages must not add trigger lookups.
- Automation preview requests keep the same SQL roundtrip count as PR #5767.
- The conditional joined stream statement stays within 20 percent of the original stream-query
  latency at representative volume.
- Complete automation-page latency with all active groups stays within 20 percent of PR #5767.
- No frontend request may scale with row count.
- Exact delivery retrieval occurs only after user action.

## Phase 11: Verification

### API tests

Run focused session and trigger suites throughout implementation, then the standard API suite:

```text
cd api && py-run-tests
```

Add real-Postgres acceptance coverage under the existing API acceptance suites for:

- Concurrent attribution and heartbeat updates.
- Soft deletion with retained delivery/configuration rows.
- Exact delivery retrieval after deletion.

Before committing API work:

```text
ruff format
ruff check --fix
```

### Frontend checks

```text
cd web && pnpm lint-fix
cd web && pnpm turbo run build --filter=@agenta/entities --filter=@agenta/sessions --filter=@agenta/sessions-ui --filter=@agenta/entity-ui
cd web && pnpm turbo run test:unit --filter=@agenta/entities --filter=@agenta/sessions --filter=@agenta/sessions-ui --filter=@agenta/entity-ui
cd web && pnpm --filter @agenta/oss types:check
cd web/tests && pnpm test:acceptance --grep "session automation actions"
```

Add a Vitest setup to `@agenta/sessions-ui` if the merged v0.112 package does not contain one. Add
component tests for primary click and secondary-action propagation. Add a browser acceptance test
under `web/tests/` for permission behavior and the configuration/delivery drawers.

### Generated Python client

Add `clients/python/tests/test_session_query_models.py` as a real generated-contract test. It must:

- Import the generated nested request and expanded response models.
- Serialize a nested origin/exclusion/expansion request.
- Parse a response containing trigger, delivery, preview, and windowing fields.
- Parse an unknown-origin row with no delivery.

After client generation, run:

```text
uv build --directory clients/python
uv run --directory clients/python pytest
```

Add pytest as a development dependency if the generated client package does not already provide
it. The build and model round-trip tests must pass.

### Live QA checklist

1. Empty API query returns unknown and trigger-origin sessions.
2. Default Sessions UI hides automation sessions.
3. Automation mode shows only automation sessions.
4. Repeated firings create distinct sessions and deliveries.
5. Row kind distinguishes schedules and subscriptions.
6. Renaming an automation changes existing session-row labels.
7. Deleting an automation removes it from normal lists but preserves configuration and delivery
   history.
8. Primary click opens the session.
9. Secondary actions open the current configuration and exact delivery.
10. Home and Sessions display previews.
11. Sidebar and internal callers make no preview query.
12. Records lookup failure does not fail the list.
13. Existing custom tags survive attribution.
14. No session-list flow issues one frontend request per row.

## GitButler implementation structure

The final review set uses four lanes rather than the original seven-lane proposal. The smaller
split keeps each public contract with its implementation while preserving dependency order.

Create these lanes from the configured `origin/release/v0.112.0` target.

Use one linear stack because generated clients and frontend packages depend on the API contract
below them:

```text
v0.112 implementation base
  -> api/session-ux-contract
  -> clients/session-ux-contract
  -> frontend/session-ux
  -> docs/session-ux-handoff
```

### Lane ownership

1. `api/session-ux-contract` owns claim integrity, retained trigger history, the nested query,
   optional expansions, typed responses, and reserved-tag sanitization.
2. `clients/session-ux-contract` owns generated Python and TypeScript clients and the API, SDK, and
   services lockfile metadata required by the editable Python client.
3. `frontend/session-ux` owns SDK accessors, the typed session entity boundary, caller policies,
   row view models, secondary actions, exact delivery mode, historical drawers, and app
   composition.
4. `docs/session-ux-handoff` owns this design record and QA handoff.

Set each PR base to the branch directly below it. Before every GitButler write, follow the
coordination lock protocol in `docs/design/agent-workflows/scratch/agent-coordination.md`.

## Implementation base used

Implementation started with these conditions:

1. GitButler targets `origin/release/v0.112.0`.
2. `but pull` first established the implementation base at `965851e15d`; the final refresh moved
   the target to `4af155162b` with no conflicts.
3. The old `main` target branch is not applied above the release.
4. The #5767/#5769 session and trigger surfaces are present.
5. No GitButler stacks were applied.
6. The user approved implementation from this plan.
7. The standalone EE dev deployment for this checkout is healthy at
   `http://144.76.237.122:8280`.
8. The compose project is `agenta-ee-dev-wp-b2-rendering`, with Postgres published on port 5434.
