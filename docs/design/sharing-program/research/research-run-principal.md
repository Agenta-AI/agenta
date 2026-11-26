# Research appendix: run-principal (M2)

Code read at `42ffe80bfe` in worktree `pr-7663-specs-design-c53b35`. Paths are relative to `api/` unless they start with `services/` or `sdks/`. Line numbers are a snapshot.

## Identity at the request boundary

| Credential | Code | `request.state.user_id` |
| --- | --- | --- |
| Bearer | `oss/src/middlewares/auth.py:611-1000`; mints a Secret at `:952` | signed-in user |
| ApiKey | `auth.py:1021-1104`; `created_by_id` at `:1066` | key creator |
| Secret | `auth.py:1107-1176` copies JWT claims | `user_id` claim |

`sign_secret_token` (`auth.py:1247-1324`) writes `user_id`, project, workspace, organization, `gateway_run_id`, `gateway_tools`, grants, audience. No principal kind.

## Token mints (all non-test `sign_secret_token` callers)

- `oss/src/middlewares/auth.py:952` (Bearer)
- `oss/src/apis/fastapi/access/router.py:206` (exchange and refresh; runner calls `GET /access/permissions/check?action=run_service`, `services/runner/src/sessions/auth.ts:25`)
- `oss/src/core/workflows/service.py:3220` (`_prepare_invoke`)
- `oss/src/core/workflows/service.py:3487` (`inspect_workflow`, signs from its `user_id` argument; no non-test caller found in `api/` at this commit; delete it if still unused, else it takes `authority`)
- `oss/src/apis/fastapi/gateways/credentials_router.py:115` (gateway; no permission check by design; TTL `AGENTA_GATEWAYS_CREDENTIALS_TTL_SECONDS`, default 43200 s, `oss/src/utils/env.py:1240-1262`)
- `oss/src/apis/fastapi/gateways/mcps/router.py:303` (builtin MCP; needs `gateway_run_id` and `USE_MCP_ENDPOINTS`)

## Run paths and their identity today

| Path | Code | Identity |
| --- | --- | --- |
| Web send (queued) | `core/sessions/commands/service.py:1627` -> `entrypoints/routers.py:1588` | `command.created_by_id` |
| Template first message | `core/sessions/starts/service.py:323` | `user_id` argument |
| Channels | `tasks/asyncio/channels/inbox.py:224, 329, 647, 862, 1133` | linked user, else `resolution.agent.created_by_id` |
| Agenta-key channel connect | `entrypoints/channel_adapters.py:38` | `check_action_access(api_key.created_by_id, RUN_CHANNELS)` |
| Schedules and subscriptions | `tasks/asyncio/triggers/dispatcher.py:224-260` (`_run`, shared) | `entity.created_by_id`; `claim_trigger_delivery` inserts the session before invoke |
| Child agent as a tool | `apis/fastapi/tools/router.py:1748`; `core/tools/platform_handlers.py:144` (`test_run`) | parent `request.state.user_id`; fresh `_prepare_invoke` token; checks only `RUN_TOOLS` |
| Approval resume | `tasks/asyncio/sessions/interactions_dispatcher.py:478-491`, `entrypoints/routers.py:1578-1594` | the answerer |
| Evaluations | `core/evaluations/service.py:285, 319` (live runs: `run.created_by_id`), `:2717`; taskiq tasks in `tasks/taskiq/evaluations/worker.py:230-345` carry `user_id`; `core/evaluations/runtime/adapters.py:134` calls `invoke_workflow` | evaluation run creator |
| Heartbeat-first session creation | `apis/fastapi/sessions/router.py:705-725` -> `core/sessions/streams/service.py:509, 523` (`_heartbeat_locked`) | `RUN_SESSIONS` check only |

## Storage

- `session_turns` (`dbs/postgres/sessions/turns/dbas.py`): no sender; runner appends fire-and-forget.
- `session_inputs`, `session_commands`, `session_interactions`: `created_by_id` only.
- `trigger_schedules`, `trigger_subscriptions` (`dbs/postgres/triggers/dbes.py:17, 57`): target agent inside `data.references`; pause flag `flags.is_active`. Deliveries reference both (`dbes.py:85`).
- `channel_threads` (`dbs/postgres/channels/dbas.py:110-116`): `space_id`, `agent_id`, `external_key`, `session_id`; `channel_spaces.connection_id`; `channel_agents` (binding) has `connection_id` and `agent_id`. This is the join for "own thread session".
- API keys have no scopes (`oss/src/models/db_models.py:338-376`).

## Table A: routes a run calls with its run credential

Callers: runner (`services/runner/src/`), SDK (`sdks/python/agenta/sdk/`). Routes under `oss/src/apis/fastapi/`.

Needed to run its own agent (installation list allows these):

| Route | Permission | Resource for M2 |
| --- | --- | --- |
| `GET /access/permissions/check` | `RUN_SERVICE` | - |
| `POST /sessions/turns/`, `/turns/complete` | `RUN_SESSIONS` | session |
| `POST /sessions/turns/query`, `GET /sessions/streams/` | `VIEW_SESSIONS` | session |
| `POST /sessions/streams/heartbeat` | `RUN_SESSIONS` | session |
| `POST /sessions/records/ingest`, `/records/incomplete` | `RUN_SESSIONS` | session |
| `POST /sessions/records/query` | `VIEW_SESSIONS` | session |
| `POST /sessions/interactions/`, `/transition`, `/cancel-stale` | `RUN_SESSIONS` | session |
| `POST /sessions/interactions/query` | `VIEW_SESSIONS` | session |
| `GET /sessions/attachments/{id}/content`, `POST /sessions/attachments/reference` | `VIEW_SESSIONS` / `RUN_SESSIONS` | session |
| `POST /sessions/mounts/sign` | `RUN_SESSIONS` + `USE_MOUNTS` | session |
| `POST /mounts/agents/sign` | `USE_MOUNTS` | agent |
| `POST /workflows/revisions/retrieve`, `/revisions/resolve`, `GET /workflows/{id}` | `VIEW_WORKFLOWS` | agent |
| `POST /otlp/v1/traces` | `EDIT_SPANS` | - |
| `GET /secrets/`, `GET /secrets/{slug}` | `VIEW_SECRET` (+ grant for write-only values) | - |
| `POST /gateways/llms/resolve` and relays | `USE_LLM_ENDPOINTS` | - |
| `POST /gateways/mcps/...` relays | `USE_MCP_ENDPOINTS` | - |
| `POST /tools/resolve`, `POST /tools/call` | `VIEW_TOOLS`, `RUN_TOOLS` | - |

Runner-token routes (not authorized by the run credential): control command outcome, subscription-login attempt outcome, EE wallet sandbox metering. Subscription-login push routes need the grant plus `RUN_SESSIONS` and `USE_MOUNTS` (user-owned subscriptions are M7).

Platform tools that the installation list refuses (their own permission check fails): `commit_revision` (`EDIT_WORKFLOWS`), `rename_agent`, `apply_skill_update`, `query_spans` (`VIEW_SPANS`), `annotate_trace` (`EDIT_ANNOTATIONS`), `rename_session` (`EDIT_SESSIONS`), trigger list and create tools (`VIEW_TRIGGERS`, `EDIT_TRIGGERS`), channel tools (`RUN_CHANNELS`), `query_workflows` and skills search (`VIEW_WORKFLOWS` without the bound agent as resource). Workflow-as-tool and `test_run` are refused as child runs.

## Run ids

`gateway_run_id` (gateway nonce), `meta.run_id` = execution id = `turn_id` (`workflows/service.py:3436-3441`), and the trigger delivery result `run_id`. `RunContext.run_id` uses the second.
