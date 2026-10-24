# M3 `agent-session-sharing`: technical design

Read with `interfaces.md` in this folder. Paths are relative to `api/` unless they start with `web/`. Code read on `main` at `42ffe80bfe`, then synced with the M3 code as built (plan Task 22). Preconditions: M1 (`MembershipsService`, the resolver, `core/access/interfaces.py`) and M2 (`decide`, principals, `RequestAccess`, run envelopes, trigger principal columns) are merged.

Owner decisions applied (2026-10-22): one release with no rollout flag (decision 7); only a human owns (decision 8); private items lock when the owner leaves (decision 9); `/w` creates project-visible items (decision 10); no installation-specific code (decisions 3 and 6). The interface decisions of the implementation plan are applied here and in `interfaces.md` (listed at the top of that file).

---

## 1. File-by-file plan

### 1.1 API: data layer

| File | Status | Change |
| --- | --- | --- |
| `oss/databases/postgres/migrations/core_oss/versions/oss000000048_add_agent_session_sharing.py` | NEW | R-A schema (interfaces.md 1.4), `down_revision = "oss000000047"`. |
| `oss/databases/postgres/migrations/core_oss/versions/oss000000049_backfill_agent_session_sharing.py` | NEW | R-B one-time backfill (section 5), `down_revision = "oss000000048"`. |
| `oss/src/dbs/postgres/sharing/__init__.py`, `dbes.py`, `mappings.py`, `dao.py` | NEW | `AgentAccessDBE`, `SessionGrantDBE`, `SharingDAO` (with `assign_legacy_session_access`), `lock_agent_policy` for the channels DAO. |
| `oss/src/dbs/postgres/sessions/streams/dbes.py` | MODIFIED | `visibility`, `owner_user_id`, check, index. |
| `oss/src/dbs/postgres/sessions/streams/mappings.py` | MODIFIED | `map_stream_dto_to_dbe_create` writes `stream.access`; `map_stream_dbe_to_dto` reads both columns (`NULL` visibility -> `PROJECT`). |
| `oss/src/dbs/postgres/sessions/streams/dao.py` | MODIFIED | `claim_trigger_delivery(access=...)`; `_apply_filters(read_scope=...)`; `query` and `count` require `read_scope`. |
| `oss/src/dbs/postgres/git/dao.py` | MODIFIED | Extract `_insert_artifact(session=...)` from `create_artifact` (~101-156). No behavior change. |
| `oss/src/dbs/postgres/workflows/dao.py` | NEW | `WorkflowsDAO(GitDAO, WorkflowsDAOInterface)`: atomic agent create, `ensure_first_agent_access`, scoped query overrides. |
| `oss/src/dbs/postgres/channels/dao.py` | MODIFIED | `create_agent` and `edit_agent` take `guard_artifact_id` and call `lock_agent_policy` first (interfaces.md 3.8). |
| `oss/src/dbs/redis/sessions/locks.py` | MODIFIED | `record_turn_admission`, `get_turn_admission` (one `EVAL` of `CURRENT_TURN_ADMISSION_LUA`) and `forget_turn_admissions` next to `bind_turn`. |
| `oss/src/dbs/postgres/memberships/dao.py` (M1) | MODIFIED | `query_project_member_profiles`: OSS lists the organization members with the organization role; EE lists the `project_members` rows that have an organization row, with the project role (nullable). Prefix search on email or username (`LIKE` with escapes), order `email, id`. |

### 1.2 API: core layer

| File | Status | Change |
| --- | --- | --- |
| `oss/src/core/sharing/__init__.py`, `dtos.py`, `types.py`, `interfaces.py`, `service.py` | NEW | Types, cache entries, `OWNERLESS_PROJECT_POLICY`, write results, exceptions (including `AdmissionDenied`), `SharingDAOInterface`, `SharingService` with the cached policy reads, `invalidate_sharing_caches` and the registry (interfaces.md 2, 3.1, 3.2). `SharingService` takes `principals_dao` (M2 `PrincipalsDAOInterface`) for the installation principal invalidation; its writes take `organization_id` and `access: RequestAccess`. |
| `oss/src/core/sharing/admission.py` | NEW | `RunAdmission` with `admit`, `admit_turn`, `admit_request` (interfaces.md 3.4). |
| `oss/src/core/sharing/audit.py` | NEW | `publish_sharing_event` (section 6). |
| `oss/src/core/sharing/disclosure.py` | NEW | Pure `build_share_disclosure(*, parameters)`: the revision's `parameters["agent"]["tools"]` and the bare `parameters["tools"]` (both SDK shapes), both gateway tool entry types -> `ShareDisclosure`. The sharing router calls it; `SharingService` does not. |
| `oss/src/core/access/interfaces.py` (M1) | MODIFIED | `ResourcePolicyInterface`. |
| `oss/src/core/access/service.py` (M1, M2) | MODIFIED | required `resource_policy`; `decide` step 4. |
| `oss/src/core/access/dtos.py` (M2) | MODIFIED | `DecisionReason.RESOURCE_DENIED`, added with the sharing contracts (M2 does not add it). |
| `oss/src/core/access/permissions/types.py` | MODIFIED | `Permission.MANAGE_AGENT_OWNERSHIP` in `ADMIN_PERMISSIONS`. |
| `oss/src/core/events/types.py` | MODIFIED | Two `EventType` values. |
| `oss/src/core/memberships/dtos.py`, `interfaces.py`, `service.py` (M1) | MODIFIED | `ProjectMemberProfile`, `query_project_members`. |
| `oss/src/core/sessions/streams/dtos.py`, `interfaces.py`, `service.py` | MODIFIED | `SessionStream` fields; `SessionStreamCreate.access`; `access` on `command`, `_start_turn`, `set_header`, `heartbeat`, `_heartbeat_locked`; `run_admission` and `admission_envelope` on `heartbeat`; the `prior_stream` read moves before `bind_turn` and drives admission (section 2); session delete calls `invalidate_sharing_caches`; `read_scope` on `query_streams`, `count_streams`. |
| `oss/src/core/sessions/service.py` | MODIFIED | `query_sessions_page(read_scope=)` and `query_sessions(read_scope=)`. |
| `oss/src/core/workflows/dtos.py`, `interfaces.py`, `service.py` | MODIFIED | `access`, `visibility`, `AGENT_REFERENCE_KEYS`, `WorkflowsDAOInterface`, `resolve_agent_artifact_id`, `AgentReferenceUnresolved` (`types.py`), required `read_scope` on the four query methods and `SimpleWorkflowsService.query`, `first_agent_owner_user_id` on `commit_workflow_revision` and `commit_workflow_revision_checked`. |
| `oss/src/core/applications/service.py`, `core/evaluators/service.py` | MODIFIED | Required `read_scope` on the query methods; the query routes pass the caller's scope. The commit and simple create and edit paths forward `first_agent_owner_user_id`. |
| `oss/src/core/skills/service.py`, `core/skills/import_service.py` | MODIFIED | Pass `AgentReadScope(owner_user_id=None)`, which hides every private agent. |
| `oss/src/core/agent_templates/loader.py` | MODIFIED | Forwards `access`, `first_agent_owner_user_id` and the first session's policy (`session_access`). |
| `oss/src/core/embeds/service.py`, `core/embeds/utils.py` | MODIFIED | `embedded_agent_visible`: the universal resolver checks rules A1 and A2 on each embedded workflow, application or evaluator revision (entry-points.md, "Embedded references"). |
| `oss/src/core/channels/dtos.py`, `interfaces.py`, `service.py`, `commands.py` | MODIFIED | `channel_agent_references`; `guard_artifact_id` on `ChannelsDAOInterface.create_agent` and `edit_agent`; refuse activation of a private agent; channel sessions pass `OWNERLESS_PROJECT_POLICY`. |
| `oss/src/tasks/asyncio/triggers/dispatcher.py` | MODIFIED | Resolve the target, admit (agent), compute `initial_policy`, pass `access` to the claim. |
| `oss/src/tasks/asyncio/sessions/interactions_dispatcher.py`, `core/sessions/commands/delivery.py` (queued input), `oss/src/tasks/asyncio/channels/inbox.py`, `core/sessions/starts/service.py`, `apis/fastapi/tools/router.py`, `core/tools/platform_handlers.py` | MODIFIED | Call `RunAdmission.admit_request` where M2 calls `require` (section 2); map `AdmissionDenied` by name before any generic catch. `start_once` takes the first session's `access` and creates the row before the invoke (section 4.9). |

### 1.3 API: router layer and wiring

| File | Status | Change |
| --- | --- | --- |
| `oss/src/apis/fastapi/sharing/__init__.py`, `router.py`, `models.py`, `utils.py` | NEW | `SharingRouter` (`tags=["Sharing"]`); `utils.policy_for_request(request, *, kind, requested)` builds `initial_policy` inputs from `get_request_access()` and `request_run_envelope(request)`; `utils.check_resource` and `ResourceCheck`; `allow_resource`, `allow_agent`, `allow_mount` and `allow_session_write` (the runner write check) for the other routers; `utils.NOT_FOUND_ERROR`; `handle_sharing_exceptions()`. The agent routes first call `WorkflowsService.is_agent_artifact` (unknown id, prompt or evaluator: canonical 404). |
| `oss/src/apis/fastapi/workflows/router.py` | MODIFIED | `create_workflow` (~751), `create_simple_workflow` (~2316), commit, query and fetch routes. |
| `oss/src/apis/fastapi/agent_templates/router.py` | MODIFIED | `load` (~417) computes the agent policy and the first session's policy from the top-level body field `visibility`. |
| `oss/src/apis/fastapi/sessions/router.py` | MODIFIED | `set_session_stream` (~515), `heartbeat_session_stream` (~702), `query_session_streams` (~729), `set_session_stream_header` (~762, plus `visibility` query parameter), watch routes (~811, ~875), records, `respond_interaction` (~1476), attachments `_check` (~1631), mounts `_check` (~1846), turns, `query_sessions` (~2357), archive, unarchive, delete, snapshot. The project watch (`GET /sessions/watch`) filters each event by the watcher's resource check. The full per-route list is `entry-points.md`. |
| `oss/src/apis/fastapi/sessions/utils.py` | MODIFIED | `sanitize_session_stream` keeps `visibility`, `owner_user_id`. |
| `entrypoints/access.py` (M1 `bootstrap_access()`) | MODIFIED | Build `SharingDAO` and `SharingService`; pass `resource_policy` to `AccessService`; call `register_sharing_service`. It is the only composition helper. |
| `entrypoints/routers.py` | MODIFIED | Build `RunAdmission`; replace `workflows_dao = GitDAO(...)` (~750) with `WorkflowsDAO(...)`; mount `SharingRouter`. |
| `entrypoints/worker_queues.py` | MODIFIED | `WorkflowsDAO` at ~231, ~307, ~435, ~506; `RunAdmission`. |
| `entrypoints/worker_streams.py` | MODIFIED | `RunAdmission`; `AccessService` comes from `bootstrap_access()`. |
| `oss/src/core/evaluators/defaults.py` (~90), `oss/src/services/db_manager.py` (~355) | MODIFIED | `WorkflowsDAO`, so the scoped query signature type-checks. They never create agents. Parked data migrations under `*/migrations/core/data_migrations/` stay unchanged. |

### 1.4 Web

Built so far: the Fern client, the `@agenta/entities` sharing data layer and the `/w` edits. The visible UI (the components, `/m` screens, channel UI, `ApprovalCard`, stories) is built last, against the approved UI design (section 14); its rows below name the parts that design uses.

| File | Status | Change |
| --- | --- | --- |
| `web/packages/agenta-sdk/src/resources.ts` | MODIFIED | `getSharingClient()` after Fern regeneration. |
| `web/packages/agenta-entities/package.json` | MODIFIED | `"./sharing"` subpath export. |
| `web/packages/agenta-entities/src/sharing/api.ts`, `core/schema.ts`, `core/keys.ts`, `state/store.ts`, `index.ts` | NEW | Fern calls for the 10 routes; zod schemas (`disclosure`, member `name` and `role` nullable and optional, because the router excludes `None`); project-scoped query keys, query atoms and mutation atoms (interfaces.md 6). |
| `web/packages/agenta-entities/src/session/state/invalidate.ts` | MODIFIED | NEW `invalidateProjectSessionListQueries(projectId)`, called by the sharing mutations. |
| `web/packages/agenta-entities/src/session/core/schema.ts` | MODIFIED | `visibility`, `owner_user_id` on the session row. |
| `web/packages/agenta-entities/src/session/api/api.ts` (`setSessionHeader` ~818) | MODIFIED | Optional `visibility` argument, sent as the query parameter. |
| `web/packages/agenta-entities/src/workflow/api/api.ts` (`createWorkflow` ~828), `workflow/state/commit.ts`, `workflow/state/loadTemplate.ts` | MODIFIED | Optional `visibility`, sent when given (top-level on the template load body). `createPayload.ts` is unchanged. |
| `web/packages/agenta-entity-ui/src/sharing/MemberPicker.tsx`, `ShareDisclosureNotice.tsx`, `AgentPrivacyControl.tsx` | NEW (UI group) | Picker over `query_sharing_members`; disclosure (one sentence, section 14); visibility, transfer, take ownership. |
| `web/packages/agenta-sessions-ui/src/SessionShareDialog.tsx` | NEW (UI group) | Visibility, grants with role change and revoke, invite, "Stop sharing" (the only-me route), "Copy share link", disclosure before a widening change. Opened from a "Share" button in `SessionTabs`. |
| `web/packages/agenta-entity-ui/src/agent/AgentActionsMenu.tsx`, `useAgentActions.tsx` | MODIFIED (UI group) | "Privacy and owner" entry (open item of the UI design: kept only if the agent list stays). |
| `web/packages/agenta-sessions-ui/src/useSessionActions.tsx`, `SessionCardList.tsx`, `SessionTabs` | MODIFIED (UI group) | "Share" and "Copy share link" verbs (Share for the owner only); hide rename, share, archive, delete for non-owners of owned sessions (S4); private marker. |
| `web/packages/agenta-chat/src/components/ApprovalCard.tsx` | MODIFIED (UI group) | Read-only mode for Viewers. |
| `web/mobile/src/features/chat/SessionTopBar.tsx`, `ShareMenu.tsx`, `ShareMenuItem.tsx`, `LiveConversation.tsx` (~285), `ApprovalDock.tsx` | MODIFIED (UI group) | Mount the share dialog; the composer is replaced by a read-only notice when `!sharing.can_send`; read-only approvals. |
| `/m` playground top bar, `web/mobile/src/features/agents/AgentRowCells.tsx` | MODIFIED (UI group) | `AgentPrivacyControl` in the playground top bar, between Templates and Publish (the agent overview page is off, section 14); "Owner" column and private marker in the agent list. A Viewer whose session agent is private sees the history with a "Private agent" header and no composer (the agent fetch returns 404). |
| `web/packages/agenta-settings-ui/src/channels/ChannelConnectFlow.tsx`, `ChannelAgentPicker.tsx`, `ChannelManagePanel.tsx` | MODIFIED (UI group) | Audience notice; private agents not selectable. |
| `web/storybook/stories/entity-ui/Sharing*.stories.tsx` | NEW (UI group) | Stories for the new components and their states (interfaces.md 6). |
| `web/packages/agenta-home-ui/src/useCreateAgent.ts` | MODIFIED | Optional `visibility` (omitted keeps the `/m` behavior: the server default). |
| `/w`, explicit exception to `web/AGENTS.md`: `web/oss/src/components/pages/agent-home/hooks/useCreateAgent.ts` | MODIFIED | The one `/w` create wrapper passes `visibility: "project"`; it covers the five `/w` create callers, the template load included (top-level `visibility`). |
| `/w`, same exception: `web/oss/src/components/AgentChatSlice/state/sessions.ts`, `hooks/useAgentChatSession.ts`, `AgentConversation.tsx` | MODIFIED | `precreateThenInvoke`: before the first invoke of a new chat, on both invoke paths, await `setSessionHeader({sessionId, visibility: "project"})` (section 4.8). |

---

## 2. Execution boundaries

Every point where work starts or resumes calls `RunAdmission` with the trusted envelope: `admit_turn` on the heartbeat, `admit_request` on server paths (it resolves the target once with M2's `resolve_request_target`; `_prepare_invoke` does not resolve again), and `admit` at trigger dispatch after M2 F6 resolved the target. It runs after M2's principal checks and before any write or invoke. A deny raises `AdmissionDenied` and never invokes.

| Boundary | Authority source | Session check | Agent check | Mint | On deny |
| --- | --- | --- | --- | --- | --- |
| Browser turn (`/m`, `/w`): every heartbeat without verified continuity | run credential from the SDK exchange (`/access/permissions/check`, `run_service`); the route passes `admission_envelope = request_run_envelope(request)` | existing row only (`prior_stream`) | this turn's target: the beat's `references` (the runner's `runContext.workflow`), never the session's stored `references` | exchange (M2) | 404 `not_found` or 403 `access_denied`; the runner refuses the turn before it touches the sandbox |
| API send (`set_session_stream`, queued input admit) | `request_run_envelope(request)` | `decide(RUN_SESSIONS, resource=session)` in the route | the send path (M2) | `_prepare_invoke` | 404 or 403 |
| Queued dispatch (M2 F5 delivery) | stored `run_envelope` | yes | the target `admit_request` resolves for this turn | `_prepare_invoke` | M2 `_settle_refused_continuation`: command `obsolete` with outcome `failed`, execution settled `failed` with `access_denied`; the next admitted input is promoted |
| Approval answer and resume (M2 F7) | answerer: request; resume: stored envelope | answerer: S2 in the route; resume: yes | resume: the target `admit_request` resolves for the resumed turn | `_prepare_invoke` | 403 for the answerer; resume settled by `_settle_refused_continuation`, `access_denied` |
| Trigger dispatch (M2 F6) | trigger principal | none (the claim creates the session) | `ResolvedTarget.artifact_id` from M2's `resolve_request_target`, before the check | `_prepare_invoke` | paused, failed delivery, no claim |
| Channel turn (M2 F8) | installation envelope (`InboxDispatcher._installation_envelope`) | none (channel sessions are project-visible) | the target `admit_request` resolves for this turn | `_prepare_invoke` | failure reply, `access_denied` |
| Child run (M2 F10) | child envelope | none (a new session) | the target `admit_request` resolves for the child | `_prepare_invoke` | tool error `access_denied` |
| Template start (`start_once`) | request envelope | none (a new session) | the loaded agent, resolved once on the request | `_prepare_invoke` | 403 at the route, before anything is claimed |

Rules:

- **The checked agent is the execution target of the current turn.** `admit` never reads the session's stored `references`: they are first-write attribution (the heartbeat fills them once, from NULL), not proof of which agent this turn runs. Server paths pass the artifact of the revision that `admit_request` resolves for the turn (M2's `resolve_request_target`, which runs the existing `_ensure_request_revision` and leaves the revision on the request), and the invoke runs that revision without a second resolution. `ResolvedTarget.archived` keeps M2's handling. The browser path passes the artifact that the beat's `references` resolve to; the runner builds them from `runContext.workflow` of the run it executes. When the references disagree, the most specific one wins (revision, then variant, then artifact), because the revision is what runs.
- **Draft or unresolved.** A turn whose references hold no key of `AGENT_REFERENCE_KEYS` (workflow and application families, environment) is a draft run (an inline configuration): `admit` checks only the session. A turn that carries such a reference that resolves to nothing (deleted, archived, unknown slug, another project) is denied: `resolve_agent_artifact_id` raises `AgentReferenceUnresolved` and the heartbeat answers 404 `not_found`. On server paths, when `resolve_request_target` gives no target (an inline `data.revision`, or references that resolve to nothing) but the references name an agent key, `admit_request` resolves that agent on its own (one indexed read) and checks it; an agent reference that resolves to nothing is refused as a hidden agent (`AdmissionDenied`, `readable` false), so such a request is refused at admission instead of failing at invoke. An unresolved reference never falls back to the session check alone. An environment reference resolves through `EnvironmentsService` (each deployed reference most specific first, with project, artifact, deleted and archived checks; archived environments are rejected); it fails closed when it leads to zero or more than one agent. The most specific present key wins, and an unusable one raises (no fallback to a less specific key).
- **Every beat is authorized; the steady beat proves continuity.** `_heartbeat_locked` reads the row (`prior_stream`) once, at the top, before the supersession check, the other-replica check and `bind_turn`; those branches reuse it. Then: row absent → `admit_turn(session_id=None)` (agent only), then the insert, before any liveness lock; a conflicting insert reads the winning row and authorizes it as an existing row before any lock, update or response; row present with verified continuity (the beat is running, `request.turn_id` equals `prior_stream.turn_id`, the turn is the session's current turn, and the Redis admission record of that turn names the caller's principal; one `EVAL` of `CURRENT_TURN_ADMISSION_LUA` returns and renews the record only while the session's `running` key equals the turn; a Redis error is a full check) → no check (one Redis call, no Postgres read, no access decision); any other beat → `admit_turn(session_id)` when running with a `turn_id`, `admit(session_id, agent_artifact_id=None)` otherwise. A successful check of a running beat with a `turn_id` writes the admission record (`record_turn_admission`, same TTL as the turn binding), only after create-or-conflict is resolved and the used row passed. A write error is logged, and the next beat is checked again. The record counts only while its turn is current, and it is deleted (`forget_turn_admissions`) on the end beat, on displacement (cancel, steer, kill), on handover and on stop. A refused end beat (not running, with a `turn_id`) whose record names the same principal deletes that record too, so a replay of an ended turn is fully checked. A beat without a `turn_id`, with `is_running` false, or with another principal never uses the shortcut, so a member cannot read or touch a private session by omitting fields. A refusal raises before any lock, write or response. The route does not call `SessionStreamsService.fetch`. Browser invokes bypass `_prepare_invoke`, so the heartbeat is the first point that knows the session.
- **Cost.** Steady beats of the admitted run: one Redis `EVAL` (reads and renews the admission record of the current turn), zero added Postgres reads, zero access decisions. A checked beat: warm caches, Redis reads only, plus one indexed read (`resolve_agent_artifact_id`, outside `decide`) when the beat names an agent. Reference resolution is not cached, because an archived or deleted target must be denied at once. A lost admission record (Redis flush) costs one checked beat, which writes it again.
- **Canonical not-found.** Every hiding refusal of the heartbeat (private session, private agent, unknown, archived or foreign-project reference) answers the same 404 body `NOT_FOUND_ERROR`. `AdmissionDenied.readable` tells the route to answer 403 `access_denied` instead, without a second check. A heartbeat with no envelope at all answers the canonical 404 before any row read. A beat without a run credential (Bearer, ApiKey) answers 403 `session_requires_run_credential` for an unknown session, so a refused beat on an existing session the caller cannot read answers the same (one `VIEW_SESSIONS` decision, on the refusal path only).
- **Runner writes.** The runner write routes (records ingest and incomplete, interaction create, transition and cancel-stale, turn append and complete) use the same continuity: `allow_session_write` allows a write whose body names a turn whose admission record holds the request's principal (one Redis `EVAL`, no decision); every other write gets the full `RUN_SESSIONS` check (entry-points.md, "Runner write check").
- **Not admitted.** Evaluation runs (evaluators keep project visibility, section 11) and the services-layer `api_invoke` (no API route; the heartbeat admits those turns).
- **Domain failures by name.** `AdmissionDenied`, `AgentReferenceUnresolved`, `AgentCreationFailed` and every `SharingError` are caught by name at the route and at each worker boundary, before any generic catch. Tests assert the persisted state (command, input, delivery, trigger row) or the real HTTP status.
- **Trigger target.** The dispatcher follows M2 F6: `target = resolve_request_target(project_id, request)` on every tick, then `admit(agent_artifact_id=target.artifact_id)`. The stored `artifact_id` column is never read for authorization, also when it is set; it is a pause index only (CONTRACT.md section 5). A resolution failure writes M2's existing `400` failed delivery. A resolved id is never stored as a later permission.
- **Running turns.** A turn that was admitted finishes. The live stream recheck and the next admission apply the change.

---

## 3. Ownership examples

| Who acts | Path | Owner | Visibility |
| --- | --- | --- | --- |
| Alice in `/m`, new chat | first heartbeat, origin `web`, sender Alice | Alice | private |
| Alice in `/w`, new chat | header create with `visibility=project` | Alice | project |
| Alice's agent creates an agent in her turn | `POST /workflows/` with the run credential, sender Alice | Alice | private |
| Alice's schedule fires | trigger claim, origin `schedule`, principal Alice | Alice | private |
| Alice's subscription fires | origin `subscription` | none | project |
| Alice's API key creates an agent with `private` | origin `api`, no sender | none, no row | project |
| A child run creates an agent | origin `child` | none | project |
| Linked Slack user Alice starts a thread | origin `installation` | none | project |
| Old pod during the deploy creates a chat | `visibility NULL` | assigned at first access by the backfill rule | project |

---

## 4. Key flows

### 4.1 Create an agent (`POST /workflows/`, from `/m` or a tool call)

1. `decide(EDIT_WORKFLOWS)`.
2. `policy_for_request(request, kind=AGENT, requested=body.workflow.visibility)`.
3. `WorkflowsService.create_workflow(access=policy)`. A declared agent with an owner goes to `create_agent_artifact`: one transaction with `_insert_artifact`, the `agent_access` insert and one commit. Anything else goes to `create_artifact` with no row.
4. Response `workflow.access = policy`. `/m` then commits two revisions. The row exists, so `ensure_first_agent_access` inserts nothing.

### 4.2 Multi-step creation

`POST /workflows/` without the agent flag writes no row. A later commit of an `is_agent` revision calls `ensure_first_agent_access` when the ownership rule gives an owner. It is one statement. The CTE locks the artifact row first (the same lock as `set_agent_policy`), and the insert happens only when no agent revision is earlier than this one by `(created_at, id)`:

```sql
WITH locked AS (
  SELECT a.id FROM workflow_artifacts a
  WHERE a.project_id = :p AND a.id = :a
  FOR UPDATE
), this_revision AS (
  SELECT COALESCE(r.created_at, '-infinity'::timestamptz) AS created_at, r.id
  FROM workflow_revisions r
  WHERE r.project_id = :p AND r.artifact_id = :a AND r.id = :rev
)
INSERT INTO agent_access (project_id, artifact_id, visibility, owner_user_id, created_at, created_by_id)
SELECT :p, locked.id, 'project', :owner, now(), :owner
FROM locked, this_revision
WHERE NOT EXISTS (SELECT 1 FROM workflow_revisions r
                  WHERE r.project_id = :p AND r.artifact_id = :a
                    AND r.flags @> '{"is_agent": true}'::jsonb
                    AND (COALESCE(r.created_at, '-infinity'::timestamptz), r.id)
                        < (this_revision.created_at, this_revision.id))
ON CONFLICT (project_id, artifact_id) DO NOTHING
RETURNING artifact_id
```

The committer of the earliest agent revision owns the agent, whatever order the calls run in: two first agent revisions can commit before either call runs, and only the call for the earliest one inserts. When the earliest agent revision has no owner (an API key commit never calls this), no row is written. This is the only access write in a commit. It is safe in its own transaction because the artifact was already project-visible.

Callers: the workflow revision create and commit routes, `SimpleWorkflowsService.edit`, the application and evaluator revision create and commit routes and their simple create and edit routes, the template load, and the builder tool commit (`core/tools/platform_handlers.py`, through the `needs_agent_owner` flag on its registration) all pass `first_agent_owner_user_id`.

### 4.3 Read scopes in SQL

- Agents (`col` = artifact `id`, or `artifact_id` on variants and revisions):
  ```sql
  NOT EXISTS (SELECT 1 FROM agent_access aa
              WHERE aa.project_id = :project_id AND aa.artifact_id = col
                AND aa.visibility = 'private'
                AND aa.owner_user_id IS DISTINCT FROM :scope_owner)
  ```
- Sessions:
  ```sql
  ( (:include_project AND (s.visibility = 'project' OR s.visibility IS NULL))
    OR (:scope_owner IS NOT NULL AND s.owner_user_id = :scope_owner)
    OR s.id = ANY(:granted_stream_ids) )
  ```
- `session_read_scope`: `list_user_grants` through the `sharing_user_grants` cache -> keep rows whose owner `is_member` (one resolver call per distinct owner). A non-human principal has no owner and no grants.

### 4.4 Direct read or action on a session

1. `decide(action, ..., resource=ResourceRef(kind=SESSION, id=session_id))`.
2. Step 4: `SharingService` reads the session access entry from Redis (`sharing_session_access`, interfaces.md 3.2); on a miss, `fetch_session_policy` (one indexed read; a legacy row is assigned first) and `list_session_grants`, then it writes the entry. An agent decision reads `sharing_agent_access` the same way, with "no row" cached too. Then `is_member(owner)` when needed (the M2 membership cache), then S1 to S4. A warm session decision reads no Postgres row.
3. `resource_denied`: 404 `not_found` when the caller fails S1, else 403 `access_denied`.

### 4.5 Send in a shared session

Bob, a Participant in Alice's session, sends. The route checks S2. M2 builds Bob's envelope with `sender=Bob`. The runner's first beat of the turn (a checked beat) runs `admit_turn` for Bob: session (S2) and agent (A1/A2). If Bob lost the agent, the turn is refused; he can still read the history. On a reused sandbox the M2 credential epoch gives Bob's turn Bob's authority.

### 4.6 Agent sharing write

0. The route checks that the artifact exists in the project and is an agent (`WorkflowsService.is_agent_artifact`, one `EXISTS` over its revisions' `is_agent` flag, uncached). An unknown id, a prompt and an evaluator answer the canonical 404. Without this, an unknown id would read as a project-visible, ownerless agent.
1. `decide(EDIT_WORKFLOWS or MANAGE_AGENT_OWNERSHIP, resource=agent)`. The service write takes `organization_id`, `project_id` and `access: RequestAccess` (the audit event needs the organization, the credential kind and the acting user).
2. `SharingService` reads `current`, checks the rule (active owner, caller is owner, or no active owner for take-ownership), computes `new`. A non-owner write on a readable agent raises `AccessDenied` (`RESOURCE_DENIED`, 403); an unreadable agent raises `SharedItemNotFound` (404). A write that changes nothing commits nothing and publishes no event.
3. `SharingDAO.set_agent_policy(expected=current, policy=new)` in one transaction: lock `workflow_artifacts (project_id, id) FOR UPDATE` for an artifact with an `is_agent` revision (else `SharedItemNotFound`); compare `agent_access` with `expected` (mismatch: `SharingConflict`, rollback); upsert; for `private`, `UPDATE channel_agents SET flags = COALESCE(flags, '{}'::jsonb) || '{"is_active": false}'` for channel agents whose references name the artifact (interfaces.md 3.8); commit. It returns `AgentPolicyWriteResult(policy, deactivated_channel_agent_ids)`.
4. On `SharingConflict` the service decides once more on `e.current`; a second conflict is 409. Two take-ownership calls: the second sees an active owner (`OwnerStillActive`). Transfer during make-private: make-private sees the new owner and is denied.
5. After the commit: `invalidate_sharing_caches(artifact_ids=[artifact_id])`; `PrincipalsDAOInterface.invalidate_principal` (M2) for the installation principal of each deactivated channel agent, so a warm `fetch_principal` entry cannot keep it active; `publish_sharing_event(before=current, after=new)`.

### 4.7 Session sharing write

1. `decide(EDIT_SESSIONS, resource=session)`: the active owner. The service write takes `organization_id`, `project_id` and `access: RequestAccess`; the router takes `organization_id` from `request.state`, else from `AccessService.project_organization_id`.
2. The service checks `shareable` (not a channel session, has an owner, references an agent) and each grantee (`is_member`, human, not the owner). A session created only by the header call has no saved agent reference until its first heartbeat fills it, so it answers 409 `session_not_shareable` (`no_agent`) until its first turn runs.
3. `SharingDAO.set_session_sharing(expected, change)`: lock the row `FOR UPDATE`, compare, apply visibility, delete removed or all grants, `INSERT ... ON CONFLICT (project_id, stream_id, user_id) DO UPDATE SET role`, commit. It returns `SessionSharingWriteResult(state, before, grants, upserted, removed_user_ids)`. Deltas let two invites both land; "Only me" and a grant add serialize, and the later one wins.
4. After the commit: `invalidate_sharing_caches(session_ids=[session_id], grant_user_ids=<every user in upserted and removed_user_ids>)`, then `publish_sharing_event` with the grant delta from the result, without a second read.

### 4.8 New chat in `/w`

1. `/w` creates the session id as today.
2. It awaits `setSessionHeader({sessionId, visibility: "project"})` (`precreateThenInvoke`, on both invoke paths). The header route runs the create arm (P2) with `initial_policy(requested=PROJECT)`: Alice owns it, project-visible. This adds one network call, on the first send of a new `/w` chat only.
3. It invokes as today. The runner's first beat finds the row, so P4 does not create one, and `admit` passes (S2: Alice is the owner).
4. If step 2 fails, `/w` shows the existing send error and does not invoke.

### 4.9 Template load

`POST /agent-templates/load` takes a top-level `visibility`. The router computes two policies with `policy_for_request`: the agent's (`kind=AGENT`) and the first session's (`kind=SESSION`, the same requested visibility). `start_once` admits the request before anything is claimed, then creates the session row with the session policy before the invoke, so the first heartbeat finds the row and never writes its own default. A row that already exists keeps its policy. Without this, the first session of a `/w` template load got the server default (private for a browser user).

---

## 5. Migration

### 5.1 Steps

1. Deploy R-A (`oss000000048`, `down_revision = "oss000000047"`) and R-B (`oss000000049`) with the M3 code, in one release. The Helm hook runs both before new pods start. R-A commits before R-B starts (`transaction_per_migration=True`). R-A sets `SET LOCAL lock_timeout = '5s'` first and keeps its `ACCESS EXCLUSIVE` phase short; `VALIDATE CONSTRAINT` and the concurrent index run afterwards in `autocommit_block()` steps. R-B runs only in autocommit batches.
2. During the rolling deploy, old pods write sessions with `visibility NULL` and agents without a row, and show new private items to their project (accepted risk, decision 7).
3. Nothing runs after the rollout.

### 5.2 Legacy population and owner rule

The legacy population is exactly: every agent artifact that exists when R-B runs, and every session row with `visibility IS NULL`. Null ownership is never a marker. A new ownerless row always has a non-null `visibility`, so neither R-B nor the per-row assignment ever touches it.

Session owner, one batch (R-B: keyset on `(project_id, id)`, 5,000 rows, autocommit per batch; `assign_legacy_session_access`: the same statement for one `session_id`):

```sql
WITH batch AS (
  SELECT s.project_id, s.id, s.session_id, s.created_by_id
  FROM session_streams s
  WHERE s.visibility IS NULL AND (s.project_id, s.id) > (:last_p, :last_id)
  ORDER BY s.project_id, s.id LIMIT 5000
), first_turn AS (
  SELECT DISTINCT ON (t.project_id, t.session_id) t.project_id, t.session_id,
         t.principal_kind, t.principal_id, t.sender_user_id, t.origin, t.created_by_id
  FROM session_turns t JOIN batch b ON t.project_id = b.project_id AND t.session_id = b.session_id
  ORDER BY t.project_id, t.session_id, t.created_at
), owner AS (
  SELECT b.project_id, b.id,
    CASE
      WHEN EXISTS (SELECT 1 FROM channel_threads c
                   WHERE c.project_id = b.project_id AND c.session_id = b.session_id) THEN NULL
      WHEN f.principal_kind IS NOT NULL THEN                       -- M2 attribution: CONTRACT.md 7
        CASE WHEN f.origin = 'installation' THEN NULL
             WHEN f.sender_user_id IS NOT NULL AND f.origin IN ('web','api') THEN f.sender_user_id
             WHEN f.principal_kind = 'human' AND f.origin IN ('web','schedule') THEN f.principal_id
             ELSE NULL END
      ELSE COALESCE(b.created_by_id, f.created_by_id)              -- pre-M2 rows only
    END AS owner_user_id
  FROM batch b LEFT JOIN first_turn f ON f.project_id = b.project_id AND f.session_id = b.session_id
)
UPDATE session_streams s SET visibility = 'project', owner_user_id = o.owner_user_id
FROM owner o
WHERE s.project_id = o.project_id AND s.id = o.id AND s.visibility IS NULL   -- idempotent
```

- Every legacy session becomes `project`. The loop advances on the last key of `batch`.
- Agents: one `project` row per artifact with an `is_agent` revision and a non-null `created_by_id`, `ON CONFLICT DO NOTHING`. A pre-M2 API-key session or agent goes to the key creator, because pre-M2 data cannot tell a key from a human (accepted in round 1).
- `assign_legacy_session_access` is the live copy of the statement for one row. Migrations do not import application code, so the integration test `test_migration_and_lazy_assignment_agree` runs both on one fixture.

### 5.3 Old-pod writes during the rolling deploy

- Sessions: an old pod writes `visibility NULL`. Lists show it as project-visible. The first direct access on a new pod assigns its policy with the rule above. M2 pods record the turn principal, so an API-key session stays ownerless.
- Agents: an agent created by an old pod has no row, so it is project-visible and ownerless, like an API-key agent. No marker is possible without a column on the shared `workflow_artifacts` table. The window is minutes, visibility is today's, and an admin can take ownership. Accepted.

### 5.4 Rollback

The application rolls back to the pre-M3 release; the schema stays (additive). Old code does not enforce visibility, so every private item becomes visible to its project (decision 7). `downgrade()` drops the index, the constraint, the two columns and the two tables; the hook never runs it.

---

## 6. Audit and observability

| What | Path | Fields | Never |
| --- | --- | --- | --- |
| Sharing change (agent visibility, transfer, take ownership; session visibility, grants, "Only me") | `publish_event` (`core/events/streaming.py`) with `EventType.AGENTS_SHARING_CHANGED` or `SESSIONS_SHARING_CHANGED`, in `core/sharing/audit.py` like `core/gateways/policy/audit.py`. EE queries it at `POST /events/query`. | `attributes`: `resource {kind, id}`, `before {visibility, owner_user_id}`, `after {...}`, `grants_added [{user_id, role}]`, `grants_removed [user_id]`, `principal {kind, id}`, `credential` (`RequestCredential`), `acting_user_id`; `request_id`; organization and project | credential values, tokens, envelopes |
| Resource denial | the module logger (`get_module_logger`) at INFO in `SharingService.evaluate` callers (`decide` step 4) | principal kind and id, acting user, project, action, resource kind and id, reason, `request_id` or `run_id` | the same |
| Admission refusal | the same logger at INFO in `RunAdmission.admit` | the same, plus boundary name and `origin` | the same |
| Approval | M2 `approved_by` on the resumed turn | unchanged | |

The event publish never fails the write: the change commits first, and a failed publish logs a warning (as the gateway audit does). Denials are logs, not events, to keep the event volume low.

---

## 7. Limits and lifetimes

| Item | Lifetime | Effect after access is removed |
| --- | --- | --- |
| Run token (`Secret`) | 15 minutes | Admission and every route recheck at use. |
| Gateway and mount credentials | 12 hours by default | A credential already issued works until it expires. The next request is denied. |
| Live stream recheck | `env.sessions.live_auth_recheck_seconds`, 60 seconds by default | An open stream closes within that time. |
| Membership cache (`resolve_membership`, M2) | `AGENTA_CACHE_TTL`, 300 seconds | Every M1 membership mutation invalidates it; the next decision sees the change. Up to the TTL only when Redis invalidation fails or a concurrent read refills the old entry (known limit, M2 technical design section 8). No cache stores a decision. |
| Sharing caches (`sharing_agent_access`, `sharing_session_access`, `sharing_user_grants`) | `AGENTA_CACHE_TTL`, 300 seconds | Every sharing write and every session delete invalidates them after its commit (interfaces.md 3.2); the next decision sees the change. Up to the TTL when the Redis invalidation fails or when a read that started before the write committed refills the old entry. |
| Traces | until M9 | Readers with `VIEW_SPANS` still read private sessions. |

The UI notice and the docs state the credential and trace limits.

---

## 8. Test plan

Layout: `api/oss/tests/pytest/{unit,integration,acceptance}`. One fixture module, `api/oss/tests/pytest/utils/sharing.py` (NEW), builds in OSS and EE, RBAC on and off: Alice (editor, owner), Bob (editor), Carol (viewer), Dana (admin), the organization owner, an API key of Alice, an installation. It reuses `foo_account` and `cls_account` from `utils/accounts.py`.

### 8.1 Unit (`api/oss/tests/pytest/unit/sharing/`, NEW)

| File | Tests |
| --- | --- |
| `test_initial_policy.py` | `test_turn_sender_owns`, `test_web_human_owns`, `test_schedule_human_owns`, `test_api_key_never_owns`, `test_installation_never_owns`, `test_subscription_never_owns`, `test_child_never_owns`, `test_channel_session_ownerless_with_linked_sender`, `test_omitted_visibility_owner_default`, `test_private_request_dropped_without_owner` |
| `test_resource_policy.py` | one test per rule A1, A2, S1, S2, S3, S4; `test_shortcuts_do_not_open_private` (organization owner, project owner, EE no-RBAC); `test_viewer_cannot_send_or_approve`; `test_ownerless_session_edit_any_principal` |
| `test_admission.py` | `test_existing_session_denied_for_non_member_of_session`, `test_private_agent_denied_at_admission`, `test_draft_run_checks_session_only`, `test_new_session_checks_agent_only` (fake access service) |
| `test_read_scope.py` | `test_scope_owner_from_principal_not_creator`, `test_grants_filtered_by_owner_membership` |
| `test_sharing_caches.py` (fake Redis) | `test_warm_agent_and_session_decisions_read_no_postgres` (the DAO is read once, then only Redis), `test_agent_without_row_is_cached`, `test_missing_session_is_not_cached`, `test_each_sharing_write_invalidates` (visibility, transfer, take ownership, grants, "Only me", `ensure_first_agent_access`, session delete: the next decision sees the change), `test_grant_changes_invalidate_user_grants`, `test_sharing_write_reads_policy_from_dao_not_cache`, `test_cache_entries_round_trip_the_real_serializer` (each entry type through `_serialize` and `_deserialize`) |
| `test_resolve_agent_artifact_id.py` | `test_revision_reference_wins_over_artifact`, `test_no_workflow_reference_returns_none`, `test_unresolved_reference_raises`, `test_other_project_reference_raises` |
| `test_disclosure.py` | `test_connections_from_tools_parameters` |
| `test_sharing_router_errors.py` | `test_error_envelopes` (each exception and `resource_denied` -> code, status, `retryable`, `next_step`) |
| `test_composition_roots.py` | `test_every_root_passes_resource_policy` (builds each entrypoint's `AccessService` through `bootstrap_access()`) |

Also: `unit/migrations/test_sharing_migration_gate.py` (`test_revisions_pass_gate` on R-A and R-B); `unit/sessions/test_insert_paths_require_access.py` (`test_session_stream_create_requires_access`, `test_conflict_arms_never_write_access`).

### 8.2 Integration (real Postgres, `api/oss/tests/pytest/integration/sharing/`, NEW)

| File | Tests |
| --- | --- |
| `test_workflows_dao_atomic.py` | `test_access_insert_failure_leaves_no_artifact` (raises `AgentCreationFailed`), `test_ownerless_agent_has_no_row`, `test_ensure_first_agent_access_only_first` |
| `test_sharing_dao_locks.py` | `test_activation_against_make_private`, `test_concurrent_take_ownership_one_wins`, `test_transfer_against_make_private`, `test_only_me_against_grant_add`, `test_concurrent_invites_both_land`, `test_make_private_deactivates_channel_agents` |
| `test_session_claim_policy.py` | `test_claim_insert_writes_policy`, `test_claim_conflict_arm_tags_only` |
| `test_list_scope_sql.py` | `test_page_and_count_match_scope`, `test_legacy_row_listed_as_project` |
| `test_sharing_backfill.py` | `test_old_and_new_rows_together` (a legacy row and a new API-key row; run R-B twice: only the legacy row changes), `test_m2_turn_attribution_decides_owner`, `test_pre_m2_falls_back_to_creator`, `test_channel_sessions_stay_ownerless`, `test_prompts_and_evaluators_no_row`, `test_migration_and_lazy_assignment_agree` |
| `test_project_members_query.py` | `test_oss_lists_organization_members`, `test_ee_lists_project_rows`, `test_windowing_and_search` |

### 8.3 Acceptance (real stack, `api/oss/tests/pytest/acceptance/sharing/`, NEW)

Each runs in OSS and EE, RBAC on and off. Concurrency stays in integration only.

| File | Tests |
| --- | --- |
| `test_trigger_claim_owner.py` | `test_human_schedule_session_owned`, `test_api_key_schedule_session_ownerless`, `test_heartbeats_do_not_change_owner`, `test_environment_trigger_private_target_paused` |
| `test_heartbeat_admission.py` | `test_browser_human_new_session_owned`, `test_api_key_new_session_ownerless`, `test_first_beat_into_foreign_private_session_refused`, `test_first_beat_with_private_agent_refused`, `test_turn_target_checked_not_stored_references` (the session's stored references name a project agent; the turn runs Alice's private agent; Bob's first beat is refused), `test_unresolved_reference_refused` (404, nothing written), `test_draft_turn_checks_session_only`, `test_later_beats_run_no_admission` (beats 2 to 5 of the admitted run call neither `admit` nor `resolve_agent_artifact_id`, and read the session row once each, as today), `test_beat_without_turn_or_not_running_is_checked`, `test_foreign_credential_with_admitted_turn_id_is_refused`, `test_superseded_and_other_replica_branches_are_checked_first`, `test_hiding_refusals_have_one_body`, `test_concurrent_create_authorizes_the_winning_row`, `test_stopped_beat_of_admitted_principal_is_checked`, `test_admission_record_error_fails_closed` |
| `test_queued_and_resume_admission.py` | `test_queued_input_stops_after_grant_revoked`, `test_resume_stops_when_alice_lost_agent`, `test_bob_approves_alice_turn` (`approved_by` Bob, authority Alice) |
| `test_list_parity.py` | `test_parity_human`, `test_parity_api_key_excludes_creator_private`, `test_parity_installation` |
| `test_ownerless_creation.py` | `test_api_key_private_request_creates_ownerless`, `test_slack_tool_call_creates_ownerless` |
| `test_default_visibility.py` | `test_omitted_visibility_human_chat_private`, `test_omitted_visibility_human_agent_private`, `test_omitted_visibility_api_key_project`, `test_header_create_with_project_visibility` |
| `test_shared_turns_authority.py` | `test_bob_turn_after_alice_runs_as_bob` |
| `test_owner_leaves.py` | `test_private_items_locked`, `test_project_agent_runs_project_session_readonly`, `test_access_returns_on_rejoin` |
| `test_shortcuts_closed.py` | `test_org_owner_and_no_rbac_get_404` |
| `test_session_files_follow_session.py` | `test_removed_member_credential_request_denied` |
| `test_channel_sessions.py` | `test_linked_sender_session_ownerless_readable`, `test_activate_private_agent_rejected`, `test_application_family_reference_is_resolved` |
| `test_sharing_audit.py` | `test_sharing_change_publishes_before_and_after` |

### 8.4 Web

- `web/packages/agenta-entities/tests/unit/sharing-api.test.ts` (NEW): request shapes, schema parsing, query keys include the project id.
- `web/packages/agenta-sessions-ui/tests/unit/useSessionActions.test.ts` (NEW): verbs by `my_role`.
- Storybook: `pnpm --filter @agenta/storybook lint` and one build.
- `/w`: `web/oss/src/components/AgentChatSlice/state/sessions.visibility.test.ts` (the pre-create before the first invoke).

### 8.5 Statement counts (Task 0 before, Task 15 after)

Pinned in `api/oss/tests/pytest/integration/sharing/test_sharing_query_counts_postgres.py` and `test_runner_write_counts_postgres.py`, OSS and EE with the same numbers. Each test warms the caches with one call, then counts the second. The tests need a reachable Redis (they skip otherwise), so the real cache serializer runs. Under EE they bootstrap the real entitlements service, because the RBAC enforcement fails open in tests without it.

| Call | Before M3 | After M3 | Note |
| --- | --- | --- | --- |
| `HB_STEADY` steady heartbeat of the admitted run | 2 | 2 | 0 access decisions; the same count as with a no-op admission. Redis: 1 `EVAL`, no `sharing_*` key read |
| `HB_FIRST` checked beat, draft (also a beat without `turn_id`) | 4 | 4 | |
| `HB_FIRST_REF` checked beat that names an agent | 4 | 5 | +1: `resolve_agent_artifact_id` |
| `HB_CREATE` beat that creates the row | 3 | 3 | 4 with an agent reference; the policy columns ride the insert |
| Refused beat | | 1 `SELECT` | 2 with an agent reference; no write |
| `SEND` | 3 | 3 | |
| `SQ` (`query_sessions`) | 2 | 2 | human with grants and API key |
| `SSQ` (`query_streams`) | 1 | 1 | |
| `WQ` (workflows query) | 1 | 1 | the scope is a `NOT EXISTS` in the same statement |
| `WVQ` (variants query) | 2 | 2 | |
| `WRQ` (revisions query) | 3 | 3 | |
| Warm `check_request` with a session or agent resource | | 0 | |
| Queued dispatch (`admit_request` and the invoke prelude) | 6 | 6 | the same count as with a no-op admission |
| Trigger tick | 8 | 8 | 0 access statements |
| Runner write, admitted path | | 0 | 1 Redis `EVAL`, no decision |
| Sharing writes: make private, make project, session invite | | 5, 4, 5 | service writes; the agent routes add 1 (`is_agent_artifact`); not a hot path |

---

## 9. Live QA

Run on the local stack (`run.sh --oss --dev` and `--ee --dev`) as real users in the UI.

| Surface | Check |
| --- | --- |
| `/m` | Alice creates a private agent and a private chat; Bob does not see them in lists or by URL. |
| `/m` | Alice shares a chat with Bob as Viewer (no composer, read-only approvals) and as Participant (sends, approves); "Only me" removes both. |
| `/m` | Alice leaves; Dana (admin) takes ownership of Alice's project-visible agent; Alice's private chat is locked for everyone. |
| `/m` | Slack setup shows the audience notice; a private agent is not selectable. |
| `/w` | Login and project list; project switch. |
| `/w` | Invite a member and change a role; the new member sees project items. |
| `/w` | Prompts, evaluations and the playground still work. |
| `/w` | A new chat and a new agent are project-visible and owned by the creator; Bob reads Alice's `/w` chat; Bob's send shows a clear error. |
| `/w` | Workspace-shaped API answers (workspace id = organization id) still load the app. |
| Docs | The sharing page and the self-host notes match the behavior. |

---

## 10. Docs and config

- Design docs: update `docs/design/sharing-program/interfaces/m3/` when the implementation differs from it. CONTRACT.md v3 already holds the M3 contract changes (section 13).
- `api/AGENTS.md`, access section, add:
  > Every agent or session access calls `AccessService.decide` with a `ResourceRef`, and lists pass a read scope in SQL. Every point where a run starts or resumes calls `RunAdmission` (`admit`, `admit_turn` or `admit_request`) with the stored or request envelope. `AccessService` requires a resource policy; every composition root passes `SharingService`. Never treat a null owner as "not migrated". Audit events carry identifiers, never credential values. List queries take a required read scope; there is no unrestricted scope.
- `web/AGENTS.md`, after the `web/oss` rule, add:
  > Exception (M3 sharing): `/w` sends `visibility: "project"` on new chats and agents. Do not add other `/w` edits.
- User docs: `docs/docs/guides/14-share-agents-and-chats.mdx` (private agents, shared chats, roles, the limits of section 7); `docs/docs/guides/12-connect-slack.mdx` (Slack audience, private agents); `docs/docs/administration/access-control/03-rbac.mdx` (`manage_agent_ownership`; roles do not open private items).
- Env vars: none added or removed (`api/oss/src/utils/env.py` unchanged; no change in `hosting/docker-compose/*/env.*.example`, `hosting/kubernetes` values or Helm charts, or Railway). Checked on the lane: the diff from the M2 head of `api/oss/src/utils/env.py` and `hosting/` is empty, and no `AGENTA_` name appears in `core/sharing` or `apis/fastapi/sharing`.
- Fern: regenerate the TypeScript client from an EE spec, rebuild `@agentaai/api-client`, add `getSharingClient`.

---

## 11. Risks

- A missed entry point leaks a private item. Mitigation: task 1.2 inventory, the parity tests, and the admission tests. There is no grep or AST test.
- `query_workflows` filters flags after SQL (`_matches_requested_flags`), so its pages already differ from its counts. The scope is in SQL; the older mismatch stays.
- Lock order: agent writes lock `workflow_artifacts`, then `channel_agents`; session writes lock one `session_streams` row. No path takes them in the other order.
- A checked beat reads the policy before the alive lock. A sharing change in between is caught by the live recheck and the next admission.
- Latency. A warm agent or session decision reads Redis only (principal, membership, sharing entry). A cold one adds one or two indexed Postgres reads. Steady heartbeats of the admitted run add no Postgres read and no access decision; a checked beat that names an agent adds one indexed read. Measure p99 of the session routes and the heartbeat on the QA stack against the previous release.
- Accepted limits: traces until M9; issued credentials until they expire; old pods and rollback show private items; a read that races a sharing or membership write can refill the old cache entry for at most `AGENTA_CACHE_TTL`.
- Accepted as built: the routes where an unknown id creates something (send, header, input admit, uploads, mount sign and create, runner writes) answer the canonical 404 for a hidden id. This tells a project member who already holds the id that it is taken, not what it holds. Cross-session lists (interactions, turns and mounts queries without a session filter, mounts query) drop hidden items after the query, so a page can be shorter than its limit.
- Known gaps as built: A running create beat that is not the current turn keeps the `turn_id` it inserted. The mobile archived-agents query key is not invalidated by the sharing mutations (UI group).

### Out of scope / follow-ups

- Skills, prompts and evaluators keep project visibility in M3. A private agent can use project-visible skills that other members can edit; those members still cannot see the agent or its sessions. Follow-up: skill visibility (private skills come with the M6 personal project, or a per-item setting if needed earlier).

## 12. Implementation order

One implementation PR, ordered commits; see the implementation plan. Every signature change lands with all of its callers, fakes and tests in the same commit, so every commit is green.

## 13. Final rules and contract changes

Final rules (round 1 gaps, now decided):

- Owner columns have no FK; an unknown owner is not an active member.
- Legacy sessions: owner from the first turn's M2 attribution, else the stream creator, else the first turn creator (legacy rows only).
- Session sharing writes are deltas under the row lock.
- Channel agents of an artifact are matched by artifact id or slug, or any variant or revision id.
- `/w` pre-creates its chat through the header create arm with `visibility=project`.
- Rename, archive and delete: the active owner for an owned session; any principal with `EDIT_SESSIONS` for an ownerless session (today's behavior).
- The member picker uses `query_sharing_members` over the M1 resolver.
- A child run and a subscription give no owner (rule 4).
- Any non-human principal of the project may send to an ownerless session (status quo).
- The only access write in a commit is `ensure_first_agent_access`.
- `create_agent_artifact` never suppresses errors.
- A Viewer whose session agent is private sees the history with a "Private agent" header.
- Disclosure lists the gateway connections in `parameters["tools"]`; MCP endpoints and provider keys are not listed.

Applied in CONTRACT v3. CONTRACT.md v3 already holds the M3 contract changes that round 2 proposed here: the rule 4 wording of section 7, admission at every point where a run starts or resumes, the legacy-only backfill, the required resource policy of section 6, and the cached policy reads. This file proposes no further contract change.

## 14. UI design additions and deviations

The owner approved the `/m` sharing UI design on 2026-10-23. It changes three points of this design and of the OpenSpec change:

1. Addition: "Copy share link" in the share dialog footer and in the session row menu. The link gives no access by itself. It opens the session only for people who can already read it; anyone else gets the not-found page of an unknown session.
2. Deviation: the share disclosure is one sentence: "They will see everything in this chat, and anyone who can send can make the agent use its connected accounts: {accounts}." or, with no connected accounts, "They will see everything in this chat." It merges the connections and the files and tool results statement, and it leaves out the trace readers statement on purpose (traces are out of scope until M9). The API still returns the three `ShareDisclosure` flags; the UI ignores `trace_readers_can_read`. The user docs state the trace limit.
3. Placement: agent privacy is a fixed-width dropdown ("Private" or "Shared") in the playground top bar. The agent overview page is off for now.

Roles show as "Can view" (`viewer`) and "Can send" (`participant`); the UI never shows the API names. "Only me" shows as "Stop sharing" and calls the only-me route.
