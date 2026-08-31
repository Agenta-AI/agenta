# How the code works today

Everything below was read in the tree at `main` as of 2026-08-09. Line numbers are a reading aid,
not a contract.

## Where agent tools come from

An agent's tools are declared in its config and discriminated on `type`
(`sdks/python/agenta/sdk/agents/tools/models.py:230`): `builtin`, `gateway`, `code`, `client`,
`reference`, `platform`.

A **platform tool** wraps an existing Agenta endpoint. The author writes only
`{"type": "platform", "op": "<op>"}`. Everything else lives in a code-defined catalog.

- **Catalog**: `sdks/python/agenta/sdk/agents/platform/op_catalog.py`. `PLATFORM_OPS` (line 1475)
  maps an op key to a `PlatformOp` (line 152), validated at import. A `PlatformOp` carries the
  model-facing `description`, either `method` + `path` (endpoint mode) or `handler` (server-side
  handler mode), an `input_schema`, `context_bindings`, `args_into`, `read_only`, `timeout_ms`,
  and `accepts_description`.
- **Resolver**: `platform/platform_tools.py:60` turns each config entry into a `CallbackToolSpec`
  carrying a `ToolCall` descriptor plus the base URL and the per-request credential. It makes no
  HTTP call.
- **Dispatch**: the runner. `services/runner/src/tools/relay.ts:466` builds the body with
  `assembleBody`, resolves the URL with `directCallUrl`, and posts it from the host. The sandbox
  never holds a credential.
- **Self-targeting**: `context_bindings` maps a dotted body path to a `"$ctx.<dotted.path>"` token.
  The runner resolves it against the run's `runContext` at dispatch
  (`services/runner/src/tools/direct.ts:139`), after the model's arguments and after the static
  body, so a bound field always wins. `PlatformOp.resolved_input_schema()` (`op_catalog.py:262`)
  strips every bound field from the schema the model reads. A token that does not resolve throws
  rather than silently dropping the field.

Two registration points sit outside the catalog and are easy to miss:

- `api/oss/src/core/workflows/build_kit.py:36` `DEFAULT_BUILD_KIT_OPS`: the ops injected into every
  playground agent. Everything not listed there is an author opt-in.
- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/toolPermission.ts:103`
  `PLATFORM_OPS`: a hardcoded set of op names the approval card must never offer to auto-allow. An
  op missing from this set becomes auto-allowable from the card.

Reference example end to end: `annotate_trace` (`op_catalog.py:1531`) is `POST /api/annotations/`
with `args_into="annotation"` and
`context_bindings={"annotation.links.invocation.trace_id": "$ctx.trace.trace_id", ...}`. The model
can only ever annotate its own trace.

## The session write path already exists

The session entity is the `session_streams` row (`api/oss/src/core/sessions/streams/dtos.py:30`).
Its `Header` (`sdks/python/agenta/sdk/models/shared.py:150`) is exactly `{name, description}`, both
optional strings on unconstrained `String` columns. `name` is the session title, and
`/sessions/query`'s `search` filter matches against it.

`PUT` and `POST /sessions/streams/header` (`api/oss/src/apis/fastapi/sessions/router.py:513`,
permission `EDIT_SESSIONS`) take `session_id` as a query parameter and a body that is `Header` and
nothing else. It calls `SessionStreamsService.set_header`
(`core/sessions/streams/service.py:641`), which updates the row or creates it if the session has
not run yet. The DAO write (`dbs/postgres/sessions/streams/dao.py:263` via `mappings.py:80`) applies
only fields that are not `None`, so an omitted `description` is preserved and an empty-string `name`
clears the title. **No API or SDK work is needed for the session write.** Acceptance coverage exists
at `api/oss/tests/pytest/acceptance/sessions/test_stream_header_basics.py` and
`test_stream_header_roundtrip.py`.

## How a run knows which session it is in

The session id arrives as the top-level `sessionId` on the `/run` request. It is deliberately
**not** in `runContext`: both the SDK docstring (`sdks/python/agenta/sdk/agents/dtos.py:520`) and
the runner's (`services/runner/src/protocol.ts:202`) state that the runner owns the live id across
turns and that duplicating it in run context would let it go stale.

Inside the runner the live id is `env.sessionId`, set from `resolveRunSessionId(request, "")`
(`protocol.ts:865`). It is in scope exactly where tool dispatch is wired: `startToolRelay` is called
at `services/runner/src/engines/sandbox_agent/run-turn.ts:897` with `request.runContext` as its
fifth argument, and `const sessionId = env.sessionId` sits on line 108 of the same file.

There is precedent for a runner-visible-only run-context field: `RunContext.project.id`
(`protocol.ts:222`) is stamped by the service from its own request state.

## How a run knows which agent it is

`RunContext.workflow` already carries the three workflow entities as `{id, slug, version}`
references: `artifact`, `variant`, `revision`, plus `is_draft`
(`services/runner/src/protocol.ts:227`, `sdks/python/agenta/sdk/agents/dtos.py:469`). The SDK fills
them best-effort from the resolved tracing references in
`sdks/python/agenta/sdk/agents/tracing.py:136`, normalizing `application*` and `evaluator*`
reference families into the same workflow shape because those entities are workflow-backed.

So **`$ctx.workflow.artifact.id` is the agent's own id** and it already reaches the runner. No new
run-context field is needed for `rename_agent`. Existing ops bind `$ctx.workflow.variant.id`
(`commit_revision`, `create_schedule`, `test_run`); the artifact reference has no consumer yet but
is populated by the same code path.

## The endpoint that renames an agent

> **Historical design note.** #6283 later required durable one-time semantics that a normal PUT
> could not provide. `rename_agent` now uses a registered platform handler and an atomic,
> marker-guarded workflow DAO operation. The alternatives below record why endpoint mode was chosen
> before that requirement existed.

`PUT /api/workflows/{workflow_id}` (`api/oss/src/apis/fastapi/workflows/router.py:755`, registered
at line 233, permission `EDIT_WORKFLOWS`). Body is
`WorkflowEditRequest{workflow: WorkflowEdit}`, where `WorkflowEdit` extends `ArtifactEdit`
(`api/oss/src/core/git/dtos.py:32`): `id`, `name`, `description`, `tags`, `meta`, `folder_id`,
plus `flags`. The handler compares the body's `workflow.id` against the path parameter and returns
an **empty response with `count: 0`** when they disagree, rather than an error.

### Hazard 1: the direct-call dispatcher does not allow PUT

`ToolCall.method` is `Literal["GET", "POST", "DELETE"]`
(`sdks/python/agenta/sdk/agents/tools/models.py:329`), `PlatformOp.method` mirrors it
(`op_catalog.py:167`), and the runner enforces the same allowlist in three places:
`DIRECT_CALL_METHODS` (`services/runner/src/tools/direct.ts:33`), the `callDirect` signature
(`direct.ts:595`), and `DirectCall.method` (`services/runner/src/protocol.ts:150`). `callDirect`
also serializes a body only when the method is `POST` (`direct.ts:620`).

The workflow edit route is registered with `methods=["PUT"]` only. **Adding `POST` to that route
would break `POST /api/workflows/query`**: `/{workflow_id}` is registered at line 233 and `/query`
at line 263, and FastAPI matches in registration order, so a POST to `/workflows/query` would bind
`workflow_id="query"` and fail UUID validation with a 422.

Three ways out, and the recommendation:

| Option | Cost | Verdict |
| --- | --- | --- |
| Allow `PUT` in the direct-call allowlist | Four small edits (two SDK literals, the runner type plus the body-serialization condition) and one doc line | **Recommended.** The dispatcher stays constrained (an explicit four-method allowlist), and every future artifact-edit op works, since the platform uses PUT for all of them. |
| Register a second POST route for the same handler, after `/query` | A duplicate URL for one operation in the public OpenAPI spec, which flows into Fern codegen and the API docs | Rejected. It hides a method restriction behind public API surface. |
| Handler mode (`tools.agenta.rename_agent`) | A registration in `api/oss/src/core/tools/platform_handlers.py`, service wiring at the API boundary, and an elevation policy | Rejected for this feature. Handler mode exists to enforce confinement the endpoint cannot (see `commit_revision`); a closed two-field schema needs none. |

### Hazard 2: an edit that omits `flags` sets them to NULL

`WorkflowsService.edit_workflow` (`api/oss/src/core/workflows/service.py:938`) rebuilds an
`ArtifactEdit` and always passes `flags=` as an explicit keyword:

```python
artifact_edit = ArtifactEdit(
    **workflow_edit.model_dump(mode="json", exclude_none=True, exclude={"flags"}),
    flags=self._dump_stored_flags(artifact_flags) or None,
)
```

The DAO (`api/oss/src/dbs/postgres/git/dao.py:233`) writes a column only when its name is in
`model_fields_set`, with the comment "prevents partial edits from wiping unrelated fields (flags,
name, etc.)". Passing `flags=` as a keyword defeats that for `flags` alone: an edit that carries no
flags resolves to `None` and **NULLs the column**. Wiping `is_application` removes the row from the
agents list, whose query filters on flags.

The frontend already works around this. `useRenameApp`
(`web/oss/src/components/EntityIdentity/useRenameApp.ts`) sends `flags: {is_application: true}` on
every rename, and `updateWorkflow` (`web/packages/agenta-entities/src/workflow/api/api.ts:1038`)
forwards it. A tool that hard-coded the same flag would mislabel any non-application workflow it
was mounted on, so the fix belongs in the service: pass `flags` only when the edit set it.

## The client-side auto-title, and why the chat hides a server rename

- **Auto-title**: `autoTitleSessionAtomFamily`
  (`web/oss/src/components/AgentChatSlice/state/sessions.ts:609`) takes the first user message,
  truncates it to 60 code points, writes it to local state, and persists it with `setSessionHeader`.
  It returns early when the session already has any local title, so it fires **at most once per
  session**. `AgentConversation.tsx:176` drives it from `firstUserText(messages)`. Decision 3 in
  [context.md](context.md) is therefore already satisfied by the current code and needs no change.
- **Manual rename**: `renameSessionAtomFamily` (`sessions.ts:583`) writes local state and persists
  through the same `setSessionHeader`. So every locally set title is also on the server.
- **The blocker**: `reconcileServerSessionsAtomFamily` (`sessions.ts:431`) folds the server list
  over the local cache with `title: s.title?.trim() ? s.title : remote.title`. A local title always
  wins, so an agent rename would be stored in the database and never shown in the chat.
- **The sessions list needs no change.** `sessionRowTitle`
  (`web/packages/agenta-sessions/src/row/sessionRowTitle.ts`) reads the server row directly, and
  `useSessionList` (`.../state/useSessionList.ts:93`) is an infinite query with
  `staleTime: 30_000`. A server rename appears there on the next refetch.

## What the agents list reads, and what to invalidate

- The agents list is `web/oss/src/components/pages/agents/store.ts`. Query key
  `["agents-workflows", projectId, searchTerm]`, `staleTime: 30_000`,
  `refetchOnWindowFocus: false`. It queries workflow artifacts and classifies them. The file
  already exports `invalidateAgentsWorkflowQueries()`.
- The playground header's agent name comes from `workflowMolecule.selectors.artifactName`
  (`web/packages/agenta-entities/src/workflow/state/molecule.ts:460`), which reads the artifact
  query keyed `["workflows", "artifact", workflowId, projectId]`
  (`.../workflow/state/store.ts:1101`).

So an agent rename needs two invalidations on the client: the agents list key and the artifact key
for that id.

## The live-update relay that exists, and what is missing

**Publish.** `SessionsWatchPublisher` (`api/oss/src/dbs/redis/sessions/watch.py`) has three methods,
`records_changed`, `lifecycle`, `interaction`. Each builds a payload from
`api/oss/src/dbs/redis/sessions/contract.py:119` and PUBLISHes it on the durable Redis plane to
`watch_channel(project_id, session_id)`, which is `watch:{project_id}:session:{session_id}`
(`contract.py:115`). Every publish is best-effort and bounded to one second: a failure is logged and
swallowed, because the write it announces is already committed.

**Layering.** Core services never import Redis. They take a `SessionsWatchPublisherInterface`
Protocol (`api/oss/src/core/sessions/watch/interfaces.py`) and call it through a small private
helper (`_publish_lifecycle` at `core/sessions/streams/service.py:151`). The concrete publisher is
constructed in the entrypoints (`api/entrypoints/routers.py:648`, `worker_streams.py:84`,
`worker_queues.py:189`).

**Transport.** `GET /sessions/streams/watch?session_id=`
(`api/oss/src/apis/fastapi/sessions/router.py:539`, `VIEW_SESSIONS`) returns a `StreamingResponse`
over `watch_event_stream` (`.../sessions/watch.py:60`). That generator subscribes one Redis pubsub
connection to one channel and yields SSE frames: a `retry:` preamble, a `ready` frame once the
subscription is live, one frame per publish, and `: heartbeat` comments while idle.
`format_watch_frame` drops any payload whose `type` is not in the closed `_KNOWN_EVENTS` allowlist,
so a malformed publish loses its own frame and never the connection.

**The frames carry no entity data.** A frame is an event type plus the ids needed to route it, and
the client revalidates through its normal authorized endpoints. That is the property that makes the
relay cheap to extend: it never authorizes a payload, because there is no payload.

**Consume.** Two copies of one hook: `useSessionRecordsWatch`
(`web/oss/src/components/AgentChatSlice/hooks/useSessionRecordsWatch.ts`, wired at
`useSessionHydration.ts:272`) and `useSessionWatch` (`web/mobile/src/features/chat/useSessionWatch.ts`).
Both own a native `EventSource` with `withCredentials`, open and close on `visibilitychange`, use a
jittered 1s-to-30s backoff after a fatal `CLOSED` that first attempts a token refresh, revalidate on
`ready` to cover events missed while disconnected, and enforce a minimum interval between
revalidations.

**What is missing for this feature.** The channel and the endpoint are keyed on a session id, so a
project-level page has nothing to subscribe to. The sessions list and the agents list are exactly
such pages. The server half of `watch_event_stream` is already generic: it takes a channel name and
a pubsub factory and knows nothing about sessions.

**What trigger creation does is not this pattern and does not generalize.** `useTriggerSchedule`
(`web/packages/agenta-entities/src/gatewayTrigger/hooks/useTriggerSchedule.ts:24`) invalidates its
own query key after its own mutation resolves. The list updates instantly for the tab that made the
change and for nobody else. When an agent creates a schedule server-side through `create_schedule`,
no trigger query is invalidated anywhere.

## The one-shot benchmark

`benchmarks/agent-config-editing/` measures whether a small model completes a configuration action
one-shot, with a 95% target. It is wire-level: every trial drives `/services/agent/v0/invoke`, the
endpoint the playground drives, and every verdict is read from a stored row, never from the reply.

- `run_benchmark.py` runs cells (harness times model times sandbox) against a deployment described
  by three environment variables.
- Scenarios are JSON under `scenarios/`, each with `turns`, `checks`, a `seed` patch, and a
  `budget` that defines what "one-shot" means for that scenario.
- Checks are registered in `bench_lib.py` behind a `@check("<name>")` decorator and read
  `ctx.stored`, which is **`parameters.agent` of the newest revision** (`bench_lib.stored_agent`).
- `LIVE_TOOLS` (`bench_lib.py:392`) mounts exactly `read_config` and `commit_revision` and nothing
  else, so a trial can never pass through some other route.
- Every trial already mints its own session id (`bench_lib.py:1402`) and invokes with it.
- Per-trial random tokens (`{{TOKEN}}`) keep a check from passing on the model's priors.

Two gaps for these tools: the verdict source is the revision's `parameters.agent`, and neither the
`session_streams` row nor the workflow artifact row is reachable from `ctx`; and `LIVE_TOOLS` mounts
neither new op. Both are additive changes, covered in [qa.md](qa.md).
