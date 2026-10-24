# M3 entry points: the agent and session checks

Status: built in M3 Task 12 (plan step 1). Code read on the M3 lane after Task 11, checked again after the last API commit (Task 22). Paths are relative to `api/oss/src/` unless they start with `api/` or `web/`. Line numbers are the function definitions at the time of writing and move with later edits.

This file lists every route, handler and worker that reads, lists, exports, streams, writes or runs an agent or a session, and what M3 checks there. Every row has a check or a one-line reason why it needs none (openspec task 1.2).

## How a route checks

- The capability check stays as it was (`check_action_access`, today's `FORBIDDEN_EXCEPTION` on a deny).
- Then the route calls `allow_resource` (or `allow_agent`, `allow_mount`) from `apis/fastapi/sharing/utils.py`. These call `check_resource(request, *, action, resource) -> ResourceCheck`: one `AccessService.check_request` with the resource, and `project_id=UUID(request.state.project_id)` always (a Bearer request has no authority in the decision). The outcome is `ALLOWED`, `HIDDEN`, `FORBIDDEN` or `NO_CAPABILITY`.
- `HIDDEN`: the route answers exactly what it answers for an unknown id. Read routes do this by reading a session id that names no session (`_unknown_session_id()`) or by dropping the fetched item, so the body and the work are those of an unknown id. Routes whose unknown answer is fixed (a 404 body, an empty page, `{"ok": true}`, `{"resumed": false}`) return that answer.
- `FORBIDDEN`: 403 `access_denied` with `details.reason = "resource_denied"` (M2's `access_denied_error`). Only sessions can give it: an agent is either visible or hidden (rules A1, A2 do not depend on the action).
- `NO_CAPABILITY`: today's `FORBIDDEN_EXCEPTION`.
- A missing row is `ALLOWED`: the route's own not-found path answers.
- Routes that name a variant, revision, record, turn, interaction or mount by id fetch it first (they fetch it today), then check the agent or session it belongs to.
- Agent routes pass their own permission as the action (`VIEW_WORKFLOWS`, `EDIT_APPLICATIONS`, `VIEW_EVALUATORS`, `VIEW_MOUNTS` and so on), so no capability check changes.

Cost: warm checks read Redis only (`sharing_session_access`, `sharing_agent_access`, the membership of an owner). Steps 1 to 3 of the second decision of a request come from the request memo. Routes that fetched by id keep their fetch; four write paths add one read to find the agent of a variant or revision (variant and revision edit, archive, unarchive; commit and initial revision; fork). Mount routes that name a mount by id read the mount's session and agent through the `mount_scope` cache (they never change after creation): warm 0 Postgres statements, cold 1.

## Runner write check

The runner write routes (records ingest and incomplete, interaction create, transition and cancel-stale, turn append and complete) call `allow_session_write(request, *, session_id, turn_id)` in `apis/fastapi/sharing/utils.py`. When the body names a turn and the heartbeat of that turn admitted this request's principal on this session, the write is allowed with no decision: `get_turn_admission` (Task 13), one Redis `EVAL` that returns and renews the record only while the turn is the session's current turn (its `running` key), must return the principal of the request's envelope (`request_run_envelope`). The record key names the project, the session and the turn, so a record of another session or turn does not match, and a turn that ended (its record is deleted at the end beat, on displacement, handover and stop) does not match either. Every other write runs `allow_resource(RUN_SESSIONS)` on the session: a write without a turn in the body (transition, turn complete), no admission record, a record of another principal, a Bearer or API key request whose principal the heartbeat did not admit, or a Redis error (which reads as no record).

This is the same continuity as the steady heartbeat: a run that the heartbeat admitted keeps writing until its turn ends, and a sharing change applies at the next turn.

Cost, measured in `api/oss/tests/pytest/integration/sharing/test_runner_write_counts_postgres.py` (warm caches, OSS and EE): the runner path adds one Redis round trip (the admission `EVAL`), no access decision and no Postgres statement. The full check adds no Postgres statement and two cache round trips (`sharing_session_access` and the owner's `resolve_membership`; the principal and the caller's membership come from the request memo of the capability check). Using the full check on every write would cost two round trips per frame batch instead of one, so the runner path keeps the admission read. A write that misses the record pays both (three round trips).

## Embedded references

Every embed (`@ag.embed`, string and snippet embeds, nested embeds, environment key references) is fetched by the universal resolver in `core/embeds/utils.py::create_universal_resolver`, so the check lives there once. After a workflow, application or evaluator revision is fetched, and before its content is used, `EmbedsService` calls `embedded_agent_visible(project_id, artifact_id)`: rule A1 or A2 through `AccessService.resource_policy.evaluate` for the principal of the current request (`get_request_access()`), with `VIEW_WORKFLOWS` (the rules do not depend on the action, so a run credential at invoke gets the same answer as `RUN_WORKFLOWS`). The route already checked the capability. A hidden agent raises the same `EmbedNotFoundError`, with the same message, as a reference that names nothing, so every error policy (exception, placeholder, keep) answers as for an unknown reference. Without a request principal the embed is hidden (fail closed); no path resolves embeds outside a request today.

Cost: a configuration without embeds runs no check. Each embedded agent costs one cached read (`sharing_agent_access`): no Postgres statement when warm, one when cold. The artifact id comes from the revision the resolver fetched anyway, so there is no added reference read. Environment revisions hold references, not agent content, and are not checked; the agents they lead to are checked when they are embedded.

## Exception: routes that create what an unknown id names

A send, a header call, an input admission, a composer upload, a cwd upload, a session mount sign, a mount create, a record ingest, a records incomplete report, an interaction create and a turn append on an unknown session id create the session, the file, the mount or the row. A hidden session cannot get that answer, so these routes answer the one canonical body `NOT_FOUND_ERROR` (`{"code": "not_found", "message": "Not found.", "retryable": false}`, 404), the same body as the heartbeat and the sharing routes. This tells the caller that the id is taken, not what it holds.

## Sessions (`apis/fastapi/sessions/router.py`)

| Route or handler | Line | Action | Resource source | Check added |
| --- | --- | --- | --- | --- |
| `POST /sessions/streams/` `set_session_stream` (send, steer, cancel, attach) | 585 | `RUN_SESSIONS` | body `session_id` | hidden: canonical 404 (an unknown id creates) |
| `POST /sessions/tools/current` `get_current_session` | 654 | `VIEW_SESSIONS` | body `session_id` | hidden: the route's `session_not_found` 404 |
| `GET /sessions/streams/` `fetch_session_stream` | 685 | `VIEW_SESSIONS` | query `session_id` | hidden: reads an unknown id (`stream: null`) |
| `DELETE /sessions/streams/` `delete_session_stream` (kill) | 729 | `EDIT_SESSIONS` (rule S4; capability stays `RUN_SESSIONS`) | query `session_id` | hidden: `{"ok": true}` |
| `POST /sessions/streams/detach` | 767 | `RUN_SESSIONS` | body `session_id` | hidden: `{"ok": true}` |
| `POST /sessions/streams/heartbeat` | 800 | `RUN_SESSIONS` | body | Task 13 (`RunAdmission.admit_turn`, verified continuity). Without a run credential (Bearer, ApiKey) an unknown session answers 403 `session_requires_run_credential`; a refused beat on a session the caller cannot read answers the same (one `VIEW_SESSIONS` decision on the refusal path only), whatever refused it. A caller who can read the session gets the refusal itself (403 `access_denied`, or the agent's canonical 404) |
| `POST /sessions/streams/query` | 829 | `VIEW_SESSIONS` | list | Task 11: read scope in SQL |
| `PUT /sessions/streams/header` `set_session_stream_header` | 863 | `EDIT_SESSIONS` on an existing row | query `session_id` | hidden: canonical 404 (an unknown id creates) |
| `GET /sessions/streams/watch` | 927 | `VIEW_SESSIONS` | query `session_id` | hidden: the stream of an unknown id (open, nothing published) |
| `GET /sessions/{session_id}/events` `session_events`, and its live recheck `authorized()` | 998 | `VIEW_SESSIONS` | path | entry and every recheck use `check_resource_for` on the captured request access; hidden: the stream and replay of an unknown id |
| `GET /sessions/watch` `watch_project` | 1171 | `VIEW_SESSIONS` per session event, `VIEW_WORKFLOWS` per workflow event | the event's `id` (`entity` `session` or `workflow`) or `session_id` | an event passes only when `check_resource_for` on the captured request access answers `ALLOWED`; a refused, malformed or failed check drops the frame (the stream stays open); events that name no item pass. Each decision is kept inside one connection for at most 60 s (`min(live_auth_recheck_seconds, 60)`), never across connections. Warm: Redis only, no Postgres |
| `POST /sessions/records/query` | 1161 | `VIEW_SESSIONS` | body `session_id` | hidden: reads an unknown id |
| `GET /sessions/records/{record_id}` | 1245 | `VIEW_SESSIONS` | fetched record's `session_id` | hidden: `record: null` |
| `POST /sessions/records/ingest` (a record) | 1304 | `RUN_SESSIONS` (rule S2), runner write check | body `session_id`, `turn_id` | hidden: canonical 404 (an unknown id stores the record); a viewer: 403 `resource_denied` |
| `POST /sessions/records/ingest` (live frames) | 1304 | `RUN_SESSIONS` (rule S2), runner write check | first frame's `session_id`, `execution_id` (after the running-owner match) | hidden: today's `FORBIDDEN_EXCEPTION`, as for a session with no running turn; a viewer: 403 `resource_denied` |
| `POST /sessions/records/incomplete` | 1251 | `RUN_SESSIONS` (rule S2), runner write check | body `session_id`, `turn_id` | hidden: canonical 404 (an unknown id writes the cursor row) |
| `POST /sessions/interactions/` | 1491 | `RUN_SESSIONS` (rule S2), runner write check | body `session_id`, `turn_id` | hidden: canonical 404 (an unknown id creates the interaction) |
| `POST /sessions/interactions/transition` | 1531 | `RUN_SESSIONS` (rule S2), full check (no turn in the body) | body `session_id` | hidden: the route's `Interaction not found or already terminal` 404 |
| `POST /sessions/interactions/cancel-stale` | 1614 | `RUN_SESSIONS` (rule S2), runner write check | body `session_id`, `turn_id` | hidden: `{"cancelled": 0}` |
| `POST /sessions/interactions/query` | 1578 | `VIEW_SESSIONS` | body `query.session_id`, or the whole project | with a session: hidden reads an unknown id; across sessions: the interactions of hidden sessions are dropped (one cached check per session; a page can be shorter than its limit) |
| `GET /sessions/interactions/{id}` | 1617 | `VIEW_SESSIONS` | fetched interaction's `session_id` | hidden: the route's `Interaction not found` 404 |
| `POST /sessions/interactions/{id}/respond` | 1654 | `RUN_SESSIONS` (rule S2) | the anchor interaction's `session_id` (one added read) | hidden: `InteractionNotFound`, as for an unknown anchor; a viewer: 403 `resource_denied` |
| `POST /sessions/attachments` (composer upload) | 1877 | `RUN_SESSIONS` (capability stays `EDIT_SESSIONS`) | query `session_id` | hidden: canonical 404 (an unknown id stores the file) |
| `GET /sessions/attachments/{id}/content` | 1947 | `VIEW_SESSIONS` | query `session_id` | hidden: `Attachment not found.` 404 |
| `POST /sessions/attachments/reference` | 1981 | `RUN_SESSIONS` | body `session_id` | hidden: `Attachment not found.` 404 (empty list: empty answer) |
| `GET /sessions/mounts/`, `POST /sessions/mounts/query` | 2124, 2149 | `VIEW_MOUNTS` (rule S1) | `session_id` | hidden: reads an unknown id (empty list) |
| `POST /sessions/mounts/sign` | 2191 | `RUN_SESSIONS` and `USE_MOUNTS` | query `session_id` | hidden: canonical 404 (an unknown id creates the mount); a viewer: 403 |
| `POST /sessions/mounts/files/upload` (cwd) | 2233 | `RUN_SESSIONS` | query `session_id` | hidden: canonical 404 (an unknown id creates the mount) |
| `POST /sessions/mounts/{mount_id}/files/upload`, `GET .../download` | 2275, 2299 | `RUN_SESSIONS`, `VIEW_MOUNTS` | the mount's scope (`mount_scope` cache) | hidden: `Mount not found.` 404 |
| `POST /sessions/turns/` | 2429 | `RUN_SESSIONS` (rule S2), runner write check | body `session_id`, `turn_id` | hidden: canonical 404 (an unknown id stores the turn) |
| `POST /sessions/turns/complete` | 2475 | `RUN_SESSIONS` (rule S2), full check (no turn in the body) | body `session_id` | hidden: the route's `SessionTurnNotFound` 404, as for an unknown session |
| `POST /sessions/turns/query` | 2436 | `VIEW_SESSIONS` | body `query.session_id`, or the whole project | with a session: hidden reads an unknown id; across sessions: turns of hidden sessions are dropped |
| `GET /sessions/turns/{turn_id}` | 2473 | `VIEW_SESSIONS` | fetched turn's `session_id` | hidden: `count: 0` |
| `GET /sessions/{session_id}` `get_session_snapshot` | 2598 | `VIEW_SESSIONS` | path | hidden: the snapshot of an unknown id (200, empty) |
| `POST /sessions/query` | 2682 | `VIEW_SESSIONS` | list | Task 11: read scope in SQL |
| `PATCH`, `DELETE /sessions/{id}/inputs/{input_id}` | 2739, 2802 | `RUN_SESSIONS` | path | hidden: the route's `pending_input_not_found` 404 |
| `DELETE /sessions/` `delete_session` | 2850 | `EDIT_SESSIONS` | query `session_id` | hidden: `{"ok": true}`; the delete reads the grantees first and clears their caches after (below) |
| `POST /sessions/archive`, `/unarchive` | 2881, 2914 | `EDIT_SESSIONS` | query `session_id` | hidden: `{"count": 0}` |
| `POST /sessions/{id}/inputs/{input_id}/send-now` | 3148 | `RUN_SESSIONS` | path | hidden: `session_busy` 409, as for an unknown session |
| `POST /sessions/control/inputs/admit` | 3197 | `RUN_SESSIONS` | body `session_id` | hidden: canonical 404 (an unknown id starts the session) |
| `POST /sessions/{id}/cancel` | 3266 | `RUN_SESSIONS` | path | hidden: the answer of a Stop on an unknown session (200, an obsolete command, idle; a named execution: 409), with no write |
| `POST /sessions/{id}/continuations/resume` | 3330 | `RUN_SESSIONS` | path | hidden: `{"resumed": false}` |
| `POST /sessions/control/commands/{id}/outcome` | 3362 | runner token | command | no check: runner-token route, no project principal |

Session delete (`core/sessions/streams/service.py::hard_delete`): reads the row (`get_by_session_id_including_archived`) and its grants (`SharingService.list_session_grants`, uncached) before the delete, deletes (the grants go by cascade), then calls `invalidate_sharing_caches(project_id, session_ids=[session_id], grant_user_ids=<the grantees>)`.

## Agents: workflows (`apis/fastapi/workflows/router.py`)

| Route | Line | Action | Resource source | Check added |
| --- | --- | --- | --- | --- |
| catalog routes (`/workflows/catalog/*`) | 583-772 | none | static catalog | no check: no agent |
| `POST /workflows/` | 799 | `EDIT_WORKFLOWS` | new | Task 10: the new agent's policy |
| `GET /workflows/{id}` | 848 | `VIEW_WORKFLOWS` | fetched artifact | hidden: `count: 0` |
| `PUT /workflows/{id}` | 888 | `EDIT_WORKFLOWS` | path | hidden: `Workflow not found.` 404 |
| `POST /workflows/{id}/archive`, `/unarchive` | 957, 1001 | `EDIT_WORKFLOWS` | path | hidden: `count: 0` |
| `POST /workflows/query`, `/variants/query`, `/revisions/query`, `/simple/workflows/query` | 1045, 1344, 1696, 2679 | `VIEW_WORKFLOWS` | list | Task 10: `AgentReadScope` in SQL |
| `POST /workflows/variants/` | 1118 | `EDIT_WORKFLOWS` | body `workflow_id` | hidden: the foreign-key conflict 409 an unknown workflow gives |
| `GET /workflows/variants/{id}` | 1165 | `VIEW_WORKFLOWS` | fetched variant's `workflow_id` | hidden: `count: 0` |
| `PUT /workflows/variants/{id}`, `/archive`, `/unarchive` | 1207, 1256, 1300 | `EDIT_WORKFLOWS` | the variant (one added read) | hidden: `count: 0` |
| `POST /workflows/variants/fork` | 1419 | `EDIT_WORKFLOWS` | the source revision (one added read) | hidden: `Fork source variant could not be resolved.` 400 |
| `POST /workflows/revisions/` (initial) | 1475 | `EDIT_WORKFLOWS` | the variant (one added read) | hidden: `VariantNotFound` 404 |
| `GET /workflows/revisions/{id}` | 1539 | `VIEW_WORKFLOWS` | fetched revision | hidden: `count: 0` |
| `PUT /workflows/revisions/{id}`, `/archive`, `/unarchive` | 1580, 1621, 1658 | `EDIT_WORKFLOWS` | the revision (one added read) | hidden: `count: 0` |
| `POST /workflows/revisions/commit` (also the agent's scoped commit) | 1770 | `EDIT_WORKFLOWS` | the variant (one added read), never the body's `workflow_id` | hidden and unknown: `VariantNotFound` 404 (an unknown variant answered 500 `commit_failed` before; changed so both answer the same documented 404) |
| `POST /workflows/revisions/log` | 1993 | `VIEW_WORKFLOWS` | fetched revisions | revisions of hidden agents are dropped |
| `POST /workflows/revisions/deploy` | 2032 | `EDIT_WORKFLOWS` | fetched revision | hidden: `Workflow revision not found.` 404 |
| `POST /workflows/revisions/retrieve` | 2192 | `VIEW_WORKFLOWS` | retrieved revision | hidden: the unknown answer (`count: 0`; environment lookup: its 404) |
| `POST /workflows/revisions/resolve` | 2328 | `VIEW_WORKFLOWS` | resolved revision | hidden: the empty answer; embedded references: see "Embedded references" |
| `POST /simple/workflows/` | 2508 | `EDIT_WORKFLOWS` | new | Task 10 |
| `GET /simple/workflows/{id}` | 2549 | `VIEW_WORKFLOWS` | path | hidden: `count: 0` |
| `PUT /simple/workflows/{id}`, `/archive`, `/unarchive` | 2579, 2614, 2646 | `EDIT_WORKFLOWS` | path | hidden: `count: 0` |
| Invoke (`api_invoke` boundary, services layer) | | `RUN_WORKFLOWS` | resolved target | no API route: those turns are admitted by the heartbeat (Task 13) |

## Agents through the applications, evaluators and legacy routes

An agent is a workflow, so these routes reach agents by id too. Each gets the same checks as the workflow route of the same shape, with the route's own permission as the action.

| Router | Routes | Check added |
| --- | --- | --- |
| `apis/fastapi/applications/router.py` | fetch, edit, archive, unarchive (653-773); variant create, fetch, edit, archive, unarchive, fork (853-1130); revision deploy, retrieve, create, fetch, edit, archive, unarchive, commit, log, resolve (1204-1901); simple fetch, edit, archive, unarchive (2084-2232) | as the workflows table; lists keep deviation 7 (`AgentReadScope(owner_user_id=None)`) |
| `apis/fastapi/evaluators/router.py` | fetch, edit, archive, unarchive (671-806); variant create, fetch, edit, archive, unarchive, fork (884-1147); revision deploy, retrieve, create, fetch, edit, archive, unarchive, commit, log, resolve (1214-1887); simple fetch, edit, archive, unarchive (2078-2216) | as the workflows table; the edit checks run before the rename guard, whose 400 names the current name |
| `apis/fastapi/legacy_variants/router.py` `POST /variants/configs/fetch` | 326 | hidden: `Config not found.` 404 |
| catalog, template and preset routes of both routers | | no check: static catalog |

## Templates, clones and skills

| Route or handler | Action | Check added |
| --- | --- | --- |
| `apis/fastapi/agent_templates/router.py` `query`, `/{key}`, `/sources/scan` | `VIEW_WORKFLOWS` | no check: catalog and public sources, no agent or session |
| `POST /agent-templates/validate` with an `upload` or `session_file` source | `VIEW_SESSIONS`, `VIEW_MOUNTS` | the source's session; hidden: `template_source_not_found` 404, as for an unknown session |
| `POST /agent-templates/load` (source and `attachment_ids` of `staging_session_id`) | `VIEW_SESSIONS` | the source's session as above; staged attachments of a hidden session: `attachment_source_invalid`, as for an unknown session. The start of the new session: Task 14 (`template_start`), admitted before anything is claimed; the first session row is created with the requested `visibility` before the invoke |
| Clones (`fork` routes of workflows, applications, evaluators) | `EDIT_*` | the source agent, see above |
| `apis/fastapi/skills/router.py` (all routes) | `VIEW_WORKFLOWS`, `EDIT_WORKFLOWS` | no check: a skill is not an agent (no `agent_access` row; by-id routes refuse a non-skill workflow); the agent scans of `core/skills/service.py` pass `AgentReadScope(owner_user_id=None)` (deviation 7) |

## Mounts (`apis/fastapi/mounts/router.py`)

| Route | Line | Action | Check added |
| --- | --- | --- | --- |
| `POST /mounts/` | 406 | `EDIT_MOUNTS` | a mount bound to a session or agent: rule S2 or A1/A2; hidden: canonical 404 (an unknown id creates) |
| `POST /mounts/query` | 434 | `VIEW_MOUNTS` | mounts of hidden sessions and agents are dropped (one cached check each) |
| `POST /mounts/agents/sign` | 475 | `USE_MOUNTS` | the agent; hidden: `MountArtifactNotFound`, as for an unknown agent |
| `POST /mounts/agents/query` | 503 | `VIEW_MOUNTS` | the agent; hidden: empty list |
| `GET /mounts/{id}` | 524 | `VIEW_MOUNTS` | the fetched mount; hidden: `Mount not found.` 404 |
| `PUT /mounts/{id}`, `/archive`, `/unarchive` | 551, 580, 606 | `EDIT_MOUNTS` | the mount scope; hidden: `Mount not found.` 404 |
| `POST /mounts/{id}/sign` | 632 | `USE_MOUNTS` (session mount: rule S2) | the fetched mount; hidden: `Mount not found.` 404 |
| `POST /mounts/{id}/apps/scope` | 665 | `VIEW_MOUNTS` or `EDIT_MOUNTS` | the mount scope |
| file routes: list and read, write, folder, upload, download, export, delete | 727-926 | `VIEW_MOUNTS`, `EDIT_MOUNTS` | the mount scope (`mount_scope` cache); hidden: `Mount not found.` 404; export checks each mount |
| `apis/fastapi/vault/router.py` subscription login push and failure | | `RUN_SESSIONS`, `USE_MOUNTS` | no check: no session or agent in the request (a secret) |

## Reference tools

| Handler | Check |
| --- | --- |
| `core/tools/platform_handlers.py` `read_config`, `commit_revision`, `test_run` | no route check: the target variant is bound from the run context (the run's own agent), and the run was admitted (Tasks 13, 14; `test_run` is a child run, `child_run` boundary) |
| `apis/fastapi/tools/router.py` workflow tool calls (`_call_workflow_tool`) | Task 14 (`child_run`) |
| Embedded references (`@ag.references`) resolved by the resolve and retrieve routes (also when the SDK resolves at invoke with the run credential) | `core/embeds/service.py::embedded_agent_visible` in the universal resolver; see "Embedded references" |
| `apis/fastapi/environments/router.py` | no check: an environment holds references (ids, slugs, versions), not agent content; only an agent's owner can deploy a private agent (deploy checks `EDIT_*`) |
| `apis/fastapi/tracing/router.py` `/tracing/sessions/query` | not scoped in M3 (session-trace-privacy work) |

## Workers and channels

| Boundary | Check |
| --- | --- |
| Queued dispatch, approval resume (`entrypoints/routers.py` `continue_input`, `continue_interaction`; `tasks/asyncio/sessions/interactions_dispatcher.py`) | Task 14 (`queued_dispatch`, `approval_resume`) |
| Worker dispatch closures (`entrypoints/worker_queues.py`) | Task 14 |
| Channel turns (`tasks/asyncio/channels/inbox.py`) | Task 14 (`channel_turn`); channel sessions are always ownerless and project-visible (`OWNERLESS_PROJECT_POLICY`) |
| Channel activation of a private agent (`core/channels/service.py`) | Task 17 (`lock_agent_policy`, `SharedItemNotFound`) |
| Trigger dispatch (`tasks/asyncio/triggers/dispatcher.py`) | Task 14 (`trigger_dispatch`) |
| Session start from a template (`core/sessions/starts/service.py`) | Task 14 (`template_start`) |
| Heartbeat | Task 13 |

## Open items

All closed.

1. Closed: the runner write routes check rule S2 (see "Runner write check").
2. Closed: embedded references check rules A1 and A2 in the embeds resolver (see "Embedded references").
3. Closed: `GET /sessions/watch` filters each event through the watcher's resource check (see the sessions table).
