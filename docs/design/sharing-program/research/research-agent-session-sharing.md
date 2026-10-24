# Research appendix: agent-session-sharing (M3)

Code checked on `main` at `42ffe80bfe`. Paths are relative to the repository root. Line numbers are approximate and only help a reader find the code.

## Session row insertion paths (four)

All four write `session_streams`. Today none writes access fields.

| Path | Symbol | User today | Conflict arm |
| --- | --- | --- | --- |
| Turn start | `SessionStreamsService._start_turn` (`api/oss/src/core/sessions/streams/service.py` ~1131, create ~1171), called from the start path ~340 and ~355 | request user | `SessionStreamsDAO.update` with `SessionStreamEdit(flags, turn_id)`, or unarchive of a tombstone |
| Rename before first turn | `update_header` create arm (`service.py` ~978) | request user | re-enters the guarded header update |
| Trigger claim | `SessionStreamsDAO.claim_trigger_delivery` (`api/oss/src/dbs/postgres/sessions/streams/dao.py` ~163, stream insert ~245), called by `TriggersDispatcher._run` (`api/oss/src/tasks/asyncio/triggers/dispatcher.py` ~257) | `entity.created_by_id` | `ON CONFLICT (project_id, session_id) DO UPDATE SET tags = tags || excluded.tags`; must stay tags-only |
| First heartbeat | `_heartbeat_locked` (`service.py` ~794) | `None` | `fill_missing` (name, references) and `update` with `SessionStreamEdit` |

- `SessionStreamsDAO.create` (`dao.py` ~139) is the insert for paths 1, 2 and 4. It commits in its own session.
- The heartbeat route (`api/oss/src/apis/fastapi/sessions/router.py` ~702) checks `RUN_SESSIONS` for `request.state.user_id`, which the run credential gives. M2 adds the principal and authority to the request.
- `SessionHeartbeatRequest` (`api/oss/src/core/sessions/streams/dtos.py` ~270) has no visibility or identity field. Its docstring names the three execution paths that reach the runner: browser, headless invoke, scheduled trigger.
- A headless invoke with no `session_id` opens a fresh session that the API never inserts (`api/oss/src/core/workflows/service.py` ~3297). The heartbeat is then the first insert.

## Agent creation

- `is_agent` is a revision flag (`WorkflowRevisionFlags`, `api/oss/src/core/workflows/dtos.py` ~144), derived from the URI key. The artifact has no agent flag.
- `GitDAO.create_artifact` (`api/oss/src/dbs/postgres/git/dao.py` ~101, commit ~137) commits inside its own `engine.session()`. Variants and revisions are separate commits.
- Creation entry points: `WorkflowsService.create_workflow` (`service.py` ~1268, artifact only), `SimpleWorkflowsService.create` (~4077) and `create_idempotent` (~3846), both multi-commit; template instantiation in `api/oss/src/core/agent_templates/loader.py`.
- `GitDAO` is instantiated for workflows in `api/entrypoints/routers.py` ~750, `api/entrypoints/worker_queues.py` ~231 and ~307, and `api/oss/src/core/evaluators/defaults.py` ~90. The `WorkflowsDAO` subclass must replace the instances on paths that create agents.

## Other verified facts used by the design

- `session_streams` key `(project_id, id)`, unique `(project_id, session_id)` (`api/oss/src/dbs/postgres/sessions/streams/dbes.py` ~84-96).
- Permission shortcuts: EE no-RBAC allow-all and organization-owner and project-owner pass (`api/oss/src/core/access/permissions/service.py` ~308-329).
- Channel agents name their workflow in `data.references` and have `flags.is_active` (`api/oss/src/core/channels/dtos.py` ~310, ~408). Threads store the channel agent id, not the workflow (`api/oss/src/dbs/postgres/channels/dbas.py` ~112).
- Slack actor fallback to the agent creator: `api/oss/src/tasks/asyncio/channels/inbox.py` ~224, ~329, ~647, ~862, ~1133. M2 removes it.
- Trace routes check `VIEW_SPANS` only (`api/oss/src/apis/fastapi/tracing/router.py` ~508, ~571). M9 changes this.
- Reused sandboxes keep a credential epoch (`services/runner/src/engines/sandbox_agent/environment.ts` ~300). The QA row "shared session turns" covers it; the propagation itself is M2.
