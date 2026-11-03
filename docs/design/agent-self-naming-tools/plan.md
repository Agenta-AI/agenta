# Implementation plan

Fourteen steps in four tracks plus verification. Each step is one commit. The tracks are
independent of one another; within a track the order holds.

- **Session tool** (S1 to S3): `rename_session` end to end.
- **Agent tool** (A1 to A4): `rename_agent` end to end, including the two blockers it needs first.
- **Chat title** (T1): make a server rename visible in the desktop chat.
- **Live refresh** (W1 to W3): the project watch channel, serving both tools.
- **Verification** (V1 to V4): tests, benchmark, docs, live QA.

The tools work without the live refresh; the refresh is a shared mechanism that stands on its own.
Both tools are worth landing before the refresh, because a rename that only shows after a 30 second
refetch is still a working rename.

## Session tool

### S1. Carry the live session id in run context, and name the tool when a binding fails

Files:

- `services/runner/src/protocol.ts`: add `session?: {id?: string}` to `RunContext`, documented as
  runner-filled and never service-filled.
- `services/runner/src/engines/sandbox_agent/run-turn.ts`: at the `startToolRelay` call (line 897),
  pass `env.sessionId ? {...request.runContext, session: {id: env.sessionId}} : request.runContext`.
  Compute it once beside the existing `sessionId` binding at line 108.
- `services/runner/src/tools/direct.ts` (`assembleBody`) and `services/runner/src/tools/relay.ts`
  (pass `spec.name`): include the tool name in the "missing run-context value for direct-call
  binding" error.
- `sdks/python/agenta/sdk/agents/dtos.py`: one docstring line on `RunContext` naming
  `$ctx.session.id` as a runner-provided token, so the next reader does not conclude the namespace
  is closed.

Tests: extend `services/runner/tests/unit/tool-direct.test.ts` with a case that resolves
`$ctx.session.id`, a case that throws when the id is absent, and an assertion on the message text.

### S2. Add the `rename_session` catalog op and put it in the default build kit

Files:

- `sdks/python/agenta/sdk/agents/platform/op_catalog.py`: the `_RENAME_SESSION_DESCRIPTION`
  constant (verbatim from [api-design.md](api-design.md)), the `_RENAME_SESSION_INPUT_SCHEMA`
  constant, and the `PlatformOp` entry.
- `api/oss/src/core/workflows/build_kit.py`: add `"rename_session"` to `DEFAULT_BUILD_KIT_OPS`.

Tests: `sdks/python/oss/tests/pytest/unit/agents/platform/test_op_catalog.py` for the op resolving,
`session_id` being absent from `resolved_input_schema()`, and the emitted `ToolCall` carrying the
path token and the binding. Add a case in `services/runner/tests/unit/tool-direct.test.ts`
asserting `directCallUrl` produces `<origin>/api/sessions/streams/header?session_id=<id>`. Extend
whatever test pins `DEFAULT_BUILD_KIT_OPS` or the build-kit overlay shape.

### S3. Decide and encode the approval behavior

Both ops are `read_only=False`, so under the default `allow_reads` policy each call prompts the user
for approval unless the tool's config sets `permission: "allow"`. A prompt on the first turn defeats
the feature: the point is that the agent labels the session and itself without being asked.

**Recommended:** the build-kit overlay emits both ops with `permission: "allow"`.

File: `api/oss/src/core/workflows/build_kit.py`. `build_agent_template_overlay` currently emits
`{"type": "platform", "op": op_name}` for every op in `DEFAULT_BUILD_KIT_OPS`. Add a small set of
auto-allowed op names and emit `permission: "allow"` for those two. Do **not** add them to
`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/toolPermission.ts`'s `PLATFORM_OPS`,
which exists to stop a user from permanently auto-allowing an op whose gate must survive; these two
are deliberately ungated.

Test: extend the build-kit overlay test to assert both ops carry `permission: "allow"` and that no
other op does.

**Fallback if the decision goes the other way** (see [status.md](status.md) open question 1): leave
the overlay alone and instead add both op names to `toolPermission.ts`'s `PLATFORM_OPS`, with a case
in `web/packages/agenta-entity-ui/tests/unit/toolPermission.test.ts`. Note that this branch also
changes the benchmark: a gated call is not a one-shot rename, so the benchmark cells would need the
tool explicitly allowed in their seeded config.

Land this once for both ops rather than splitting it.

## Agent tool

### A1. Allow PUT on direct-call dispatch

Files:

- `sdks/python/agenta/sdk/agents/tools/models.py`: `ToolCall.method` becomes
  `Literal["GET", "POST", "PUT", "DELETE"]`, and the docstring line that says GET/POST/DELETE only.
- `sdks/python/agenta/sdk/agents/platform/op_catalog.py`: `PlatformOp.method` gains `"PUT"`
  (line 167).
- `services/runner/src/protocol.ts`: `DirectCall.method` gains `"PUT"` (line 150).
- `services/runner/src/tools/direct.ts`: `DIRECT_CALL_METHODS` (line 33), the error text at line
  478, the `callDirect` signature (line 595), and the body-serialization condition at line 620,
  which must serialize for `PUT` as well as `POST`.

Tests: `services/runner/tests/unit/tool-direct.test.ts` for a PUT dispatch carrying a JSON body, and
for an unlisted method still being rejected. Add an SDK test that a catalog op may declare `PUT`.

The dispatcher stays constrained: four explicit methods, an origin lock, and a mount-path check, all
unchanged.

### A2. Make the workflow edit route correct for a rename

Two fixes to the same request path, one commit.

**Stop nulling flags the edit does not carry.** File: `api/oss/src/core/workflows/service.py`
(`edit_workflow`, line 938). Build the `ArtifactEdit` so `flags` is passed only when `workflow_edit`
actually set it, for example by assembling the keyword arguments in a dict and adding `flags` under
`if "flags" in workflow_edit.model_fields_set`. The DAO already writes a column only when its name
is in `model_fields_set`; this restores the intent its own comment states.

**Stop reporting a missing target as success.** File:
`api/oss/src/apis/fastapi/workflows/router.py` (`edit_workflow`, line 755). Raise
`HTTPException(status_code=status.HTTP_404_NOT_FOUND, ...)` when the service returns `None`, and a
client error on the id-mismatch branch, instead of returning 200 with `count: 0`. The runner treats
any 2xx as a successful tool call, so without this a rename against a deleted or archived agent
tells the model it succeeded. Reasoning in [api-design.md](api-design.md).

Tests: `api/oss/tests/pytest/` coverage for workflows, asserting that a PUT with only `{id, name}`
leaves `flags` unchanged, that a PUT carrying flags still replaces them, and that a PUT naming a
workflow id that does not exist or has been archived returns a non-2xx rather than `count: 0`.

This fixes a latent bug on its own. Every caller that renames a workflow without resending flags
currently NULLs them, and the frontend only avoids it by hard-coding `{is_application: true}` on
every rename.

### A3. Add the `rename_agent` catalog op and put it in the default build kit

Files:

- `sdks/python/agenta/sdk/agents/platform/op_catalog.py`: the `_RENAME_AGENT_DESCRIPTION` constant,
  the `_RENAME_AGENT_INPUT_SCHEMA` constant, and the `PlatformOp` entry with `args_into="workflow"`
  and the two context bindings.
- `api/oss/src/core/workflows/build_kit.py`: add `"rename_agent"` to `DEFAULT_BUILD_KIT_OPS`.

Tests: catalog tests as in S2, plus a runner test asserting the assembled body is
`{"workflow": {"name", "description", "id"}}` with the top-level `workflow_id` stripped after path
substitution, and that the URL is `<origin>/api/workflows/<id>`.

Depends on A1. Do not land before A2, or the first live call wipes an agent's flags.

### A4. Frontend rename surfaces adopt the fixed contract

File: `web/oss/src/components/EntityIdentity/useRenameApp.ts`: drop the hard-coded
`flags: {is_application: true}` now that A2 makes it unnecessary and it is wrong for any
non-application workflow the hook is reused on.

Test: whatever unit coverage exists for the hook, or none if the change is a deletion covered by
A2's API test.

Optional. It removes a workaround rather than adding behavior, so it can be dropped if it grows.

## Chat title

### T1. A non-empty server session name wins in the chat reconcile

File: `web/oss/src/components/AgentChatSlice/state/sessions.ts`
(`reconcileServerSessionsAtomFamily`, line 431): `title: remote.title?.trim() ? remote.title :
s.title`. Update the function docstring, which currently states the opposite rule.

Tests: extend `web/oss/src/components/AgentChatSlice/state/sessions.pageTitle.test.ts` with a
server name replacing a local one, an empty server name leaving the local one alone, and a session
absent locally still adopting the server name.

No change to `autoTitleSessionAtomFamily`. It already fires at most once, on the first user message,
and returns early when a title exists.

## Live refresh

### W1. The project watch channel and its endpoint

Files:

- `api/oss/src/dbs/redis/sessions/contract.py`: `project_watch_channel(project_id)`,
  `make_watch_entity_changed_payload(entity, id)`, and the module comment block at line 90 extended
  to document the second scope.
- `api/oss/src/dbs/redis/sessions/watch.py`: a `changed(*, project_id, entity, id)` method with the
  same best-effort, one-second-bounded, never-raises contract as the three existing methods. The
  signature takes `project_id` explicitly, exactly as `records_changed`, `lifecycle`, and
  `interaction` already do (`watch.py:71`, `:78`, `:91`). The publisher holds a Redis client and
  cannot derive the project channel on its own, so a caller that omits `project_id` would publish
  nowhere.
- `api/oss/src/core/sessions/watch/interfaces.py`: pin the same keyword-only signature on the
  Protocol.
- `api/oss/src/apis/fastapi/sessions/watch.py`: add `session-changed` and `workflow-changed` to
  `_KNOWN_EVENTS`, emit the entity as the SSE event name, and record the required view permissions
  beside the allowlist.
- `api/oss/src/apis/fastapi/sessions/router.py`: a `GET /watch?project_id=...` route reusing
  `watch_event_stream` against `project_watch_channel(request.state.project_id)`, gated on
  `VIEW_SESSIONS` **and** `VIEW_WORKFLOWS`.

Tests: `api/oss/tests/pytest/unit/sessions/test_watch_endpoint.py` already asserts the frame
sequence for the session route; add the project route beside it, plus a case that a caller missing
either view permission gets a forbidden response rather than a stream. Pin the `changed` signature
in the Protocol test so a positional call fails at type-check time.

This ships no user-visible behavior on its own, which is the point. It is the shared piece and it
reviews cleanly without either tool attached.

### W2. Publish on both writes

Files:

- `api/oss/src/core/sessions/streams/service.py`: publish
  `changed(project_id=..., entity="session", id=session_id)` at the end of `set_header` (line 641),
  through the injected publisher, matching `_publish_lifecycle`'s shape. `set_header` already
  receives the project id; pass it explicitly.
- `api/oss/src/core/workflows/service.py`: publish
  `changed(project_id=..., entity="workflow", id=workflow_id)` at the end of `edit_workflow`,
  through the same Protocol. `edit_workflow` already takes `project_id` as a keyword argument. This
  means the workflows service gains an optional publisher dependency; construct it in the entrypoints
  beside the sessions one (`api/entrypoints/routers.py:648`).

Test: `api/oss/tests/pytest/unit/sessions/test_watch_publish.py` for one `session-changed` frame per
`set_header` on the project channel, one `workflow-changed` frame per `edit_workflow`, and a failing
publisher not failing either write.

If threading a publisher into `WorkflowsService` turns out to be a large change, publish from the
API router handler instead and say so in [status.md](status.md). The rule that matters is that the
publish sits next to the committed write and cannot fail it.

### W3. Subscribe once per project and refresh both lists

Files:

- Extract the connection lifecycle from
  `web/oss/src/components/AgentChatSlice/hooks/useSessionRecordsWatch.ts` into a package hook
  `useProjectWatch({on})`, keeping the `visibilitychange` open and close, the jittered backoff with
  a token refresh, the revalidation on `ready`, and the minimum interval between revalidations.
- Mount it once per project scope.
- `session-changed` invalidates the **prefix** `["session-list", projectId]`. The rail's session
  query is keyed per agent, `["session-list", projectId, appId]`
  (`web/oss/src/components/AgentChatSlice/state/projectSessions.ts:30`), and a watch frame carries a
  session id, not an agent id, so the handler cannot name the exact key. A prefix invalidation
  refetches every mounted scope's list, which is what a rename in an unknown scope needs.
- The handler does **not** call `reconcileServerSessionsAtomFamily` itself. That atom takes a scope
  key and the full server array, neither of which a frame carries. The already-mounted
  `useReconcileServerSessions(scope)` hooks (`projectSessions.ts:93`, wired at
  `AgentChatPanel.tsx:81`) reconcile on their own once the refetch lands. The handler's whole job is
  the invalidation.
- `workflow-changed` calls `invalidateAgentsWorkflowQueries()`
  (`web/oss/src/components/pages/agents/store.ts:84`) and invalidates
  `["workflows", "artifact", id]`.
- Run the same two invalidations on the `ready` event, which covers changes missed while the
  connection was down. This mirrors what `useSessionRecordsWatch` already does on `ready`.

Tests: drive the hook with a fake `EventSource` and assert the event-to-handler mapping and the
`ready` revalidation. The rest is verified live.

## Verification

### V1. API tests

See [qa.md](qa.md) for the list. Land them with the step they cover rather than as a batch.

### V2. Benchmark scenarios

See [qa.md](qa.md). One commit adding the two check kinds, one adding the scenario file, one
widening `LIVE_TOOLS` per scenario.

### V3. Documentation

Files:

- `docs/design/agent-workflows/documentation/tools.md`: add both ops to the op table around line
  547, note that both are in the default build kit, and correct the catalog-field prose at line 521
  which currently says endpoint mode is `GET`/`POST` only.
- The watch pattern documents itself in the contract module comment block from W1, which is where
  the existing channel and payload shapes are already described.

Run the `keep-docs-in-sync` skill after the last code step so nothing else drifted.

### V4. Live QA

See [qa.md](qa.md).

## Branch layout

The four tracks touch disjoint files except for `op_catalog.py` (S2 and A3) and
`build_kit.py` (S2 and A3). Put the session tool below the agent tool in one linear stack so the
catalog file has a single owner per lane, and set each pull request's base to the branch below it.
The chat-title and live-refresh tracks touch no file the tool tracks touch and can sit anywhere in
the line.

Put each test file on the lane whose tip first contains every symbol the test touches. The
`tool-direct.test.ts` cases from S1, S2, A1, and A3 all live in one file, so that file lands on the
highest of those lanes.
