# M3 entry points: the agent and session checks

Status: built in M3 Task 12 (plan step 1). Code read on the M3 lane after Task 11. Paths are relative to `api/oss/src/` unless they start with `api/` or `web/`. Line numbers are the function definitions at the time of writing and move with later edits.

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

## Exception: routes that create what an unknown id names

A send, a header call, an input admission, a composer upload, a cwd upload, a session mount sign and a mount create on an unknown session id create the session, the file or the mount. A hidden session cannot get that answer, so these routes answer the one canonical body `NOT_FOUND_ERROR` (`{"code": "not_found", "message": "Not found.", "retryable": false}`, 404), the same body as the heartbeat and the sharing routes. This tells the caller that the id is taken, not what it holds.

## Sessions (`apis/fastapi/sessions/router.py`)

| Route or handler | Line | Action | Resource source | Check added |
| --- | --- | --- | --- | --- |
| `POST /sessions/streams/` `set_session_stream` (send, steer, cancel, attach) | 585 | `RUN_SESSIONS` | body `session_id` | hidden: canonical 404 (an unknown id creates) |
| `POST /sessions/tools/current` `get_current_session` | 654 | `VIEW_SESSIONS` | body `session_id` | hidden: the route's `session_not_found` 404 |
| `GET /sessions/streams/` `fetch_session_stream` | 685 | `VIEW_SESSIONS` | query `session_id` | hidden: reads an unknown id (`stream: null`) |
| `DELETE /sessions/streams/` `delete_session_stream` (kill) | 729 | `EDIT_SESSIONS` (rule S4; capability stays `RUN_SESSIONS`) | query `session_id` | hidden: `{"ok": true}` |
| `POST /sessions/streams/detach` | 767 | `RUN_SESSIONS` | body `session_id` | hidden: `{"ok": true}` |
| `POST /sessions/streams/heartbeat` | 800 | `RUN_SESSIONS` | body | Task 13 (`RunAdmission.admit_turn`, verified continuity) |
| `POST /sessions/streams/query` | 829 | `VIEW_SESSIONS` | list | Task 11: read scope in SQL |
| `PUT /sessions/streams/header` `set_session_stream_header` | 863 | `EDIT_SESSIONS` on an existing row | query `session_id` | hidden: canonical 404 (an unknown id creates) |
| `GET /sessions/streams/watch` | 927 | `VIEW_SESSIONS` | query `session_id` | hidden: the stream of an unknown id (open, nothing published) |
| `GET /sessions/{session_id}/events` `session_events`, and its live recheck `authorized()` | 998 | `VIEW_SESSIONS` | path | entry and every recheck use `check_resource_for` on the captured request access; hidden: the stream and replay of an unknown id |
| `GET /sessions/watch` `watch_project` | 1069 | none | project feed | no check: change notices carry only an entity id; content is read through checked routes (open item 3) |
| `POST /sessions/records/query` | 1161 | `VIEW_SESSIONS` | body `session_id` | hidden: reads an unknown id |
| `GET /sessions/records/{record_id}` | 1245 | `VIEW_SESSIONS` | fetched record's `session_id` | hidden: `record: null` |
| `POST /sessions/records/ingest`, `POST /sessions/records/incomplete` | 1270, 1223 | `RUN_SESSIONS` | runner | no check: the runner write path of a run admitted at the heartbeat (Task 13); a check per live frame would add a Redis read on the busiest write path (open item 1) |
| `POST /sessions/interactions/`, `/transition`, `/cancel-stale` | 1446, 1480, 1554 | `RUN_SESSIONS` | runner | no check: runner write path of an admitted run (open item 1) |
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
| `POST /sessions/turns/`, `/complete` | 2364, 2402 | `RUN_SESSIONS` | runner | no check: runner write path of an admitted run (open item 1) |
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
| `POST /workflows/revisions/resolve` | 2328 | `VIEW_WORKFLOWS` | resolved revision | hidden: the empty answer (embedded references: open item 2) |
| `POST /simple/workflows/` | 2508 | `EDIT_WORKFLOWS` | new | Task 10 |
| `GET /simple/workflows/{id}` | 2549 | `VIEW_WORKFLOWS` | path | hidden: `count: 0` |
| `PUT /simple/workflows/{id}`, `/archive`, `/unarchive` | 2579, 2614, 2646 | `EDIT_WORKFLOWS` | path | hidden: `count: 0` |
| Invoke (`api_invoke` boundary, services layer) | | `RUN_WORKFLOWS` | resolved target | Task 14 (`RunAdmission.admit_request`) |

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
| `POST /agent-templates/load` (source and `attachment_ids` of `staging_session_id`) | `VIEW_SESSIONS` | the source's session as above; staged attachments of a hidden session: `attachment_source_invalid`, as for an unknown session. The start of the new session: Task 14 (`template_start`) |
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
| Embedded references (`@ag.references`) resolved by the resolve routes and at invoke | open item 2 |
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

1. Runner write routes (record ingest and incomplete, interaction create, transition and cancel-stale, turn append and complete) check the capability only. They are called with the run credential of a run that the heartbeat admitted. An API key or a person with `RUN_SESSIONS` can still call them with any session id of the project. A check per call adds one Redis read on the live-frame path.
2. Embedded references: a configuration that embeds a reference to a private agent's revision resolves it (resolve routes, invoke). The check belongs in the embeds resolver, not at the route.
3. `GET /sessions/watch` sends the id of every changed session in the project to every member who may view sessions, private ones included. It sends no content.
