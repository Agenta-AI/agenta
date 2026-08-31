# Contracts

Three contracts change or get added: the `rename_session` catalog op, the `rename_agent` catalog
op, and the project watch event. Nothing else on the wire moves.

## Field roles

Every field below is classified by what it **is**, not by the feature it serves. The classification
decides who owns it and whether the model may ever see it.

| Field | Role | Owner | Model sees it |
| --- | --- | --- | --- |
| `name` | Data. Human-readable content the model authors. | Model | Yes |
| `description` | Data. Human-readable content the model authors. | Model | Yes |
| `session_id` | Routing identity. Which row the write lands on. | Platform, bound from run context | No |
| `workflow_id`, `workflow.id` | Routing identity. Same value in the path and the body. | Platform, bound from run context | No |
| `flags` | Metadata classification of the artifact. | Platform | No, and it must not be written by a rename |
| `Authorization` | Credential. The run's propagated caller credential. | Runner, per request | No |
| `read_only`, `permission` | Policy. Decides whether the call prompts for approval. | Catalog and the agent's config | No |

Two consequences worth stating, because both are easy to get wrong:

- **`name` and `description` are the platform's existing `Header` shape.** Do not invent `title` or
  `summary`. The session list's `search` filter matches `name`, so a `title` field would be a second
  name that nothing searches.
- **`flags` is platform metadata, and a rename is not a classification change.** A rename request
  that carries flags is a request that can misclassify the row. The tool must send none, which
  requires the service fix described in [research.md](research.md).

## `rename_session`

Endpoint mode. The write endpoint already exists.

```python
PlatformOp(
    op="rename_session",
    description=_RENAME_SESSION_DESCRIPTION,
    method="POST",
    path="/api/sessions/streams/header?session_id={session_id}",
    input_schema=_RENAME_SESSION_INPUT_SCHEMA,
    context_bindings={"session_id": "$ctx.session.id"},
    read_only=False,
)
```

Model-visible input schema, after `resolved_input_schema()` strips the bound field:

```jsonc
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "name":        {"type": "string", "minLength": 1, "maxLength": 120, "pattern": "\\S"},
    "description": {"type": "string", "maxLength": 300}
  },
  "required": ["name"]
}
```

`minLength: 1` alone is not enough. A name of `"   "` passes it, and the header write stores it, so
the visible title clears while the row still holds a value. JSON Schema patterns are unanchored, so
`"\\S"` requires at least one non-whitespace character anywhere in the string. Both ops use the same
`name` schema.

**The query parameter rides in the path as a substitution token** because `ToolCall` has no `query`
field. This reuses machinery that already exists: `substitutePathParams` (`direct.ts:184`) runs on
the whole path string and URL-encodes the value, `pathParamNames` then deletes `session_id` from the
body (`relay.ts:471`) so only `{name, description}` is sent, and `directCallUrl`'s host lock and
mount check both operate on `resolved.pathname`, so the query string weakens neither. Adding a
`query` map to `ToolCall` would touch the wire contract, the SDK model, the runner, and the golden
wire test for one op. Revisit if a second op needs it.

`accepts_description` stays absent (false). That flag adds an ephemeral per-call `description`
argument the runner strips before sending, and this op has a real `description` field.

### Behavior

- **Scoping.** `session_id` is bound and stripped, so the agent can only rename the session it runs
  in.
- **Permission.** `EDIT_SESSIONS`, checked against the run's own credential. `read_only=False` means
  the call prompts for approval under the default `allow_reads` policy unless the agent's config
  sets `permission: "allow"` on the tool. As implemented, the default build-kit overlay ships BOTH
  rename ops with `permission: "allow"`, so no approval card appears; server-side RBAC still gates
  every call.
- **Empty or blank name.** `minLength: 1` plus the `\S` pattern rejects both an empty string and a
  whitespace-only one, so the tool cannot clear a title.
- **Description omitted.** The DAO applies only non-`None` fields, so an existing description
  survives.
- **Concurrent rename.** Last write wins. There is no version column on `session_streams` and the
  update is a single-row transaction.
- **No session.** A headless invoke or an evaluation run carries no `sessionId`, so
  `$ctx.session.id` does not resolve and `assembleBody` throws. That is the correct fail-closed
  behavior. The thrown message must name the tool so the model can read it.

### Carrying the session id into run context

Add `session?: { id?: string }` to `RunContext` in `services/runner/src/protocol.ts`, documented as
runner-filled and never service-filled, mirroring how `project.id` is documented as service-filled.
In `run-turn.ts`, pass an augmented blob to `startToolRelay`:

```ts
env.sessionId ? { ...request.runContext, session: { id: env.sessionId } } : request.runContext
```

computed once beside the existing `sessionId` binding at line 108.

This keeps the documented invariant intact. The service still does not put a conversation id in
`runContext`, and the value the tool binds is the live id the runner owns for this turn. The SDK's
`RunContext` model needs no new field, since nothing on the SDK side reads or emits it; add one line
to its docstring naming `$ctx.session.id` as a runner-provided token so the next reader does not
conclude the namespace is closed.

## `rename_agent`

> **Superseded by the #6283 follow-up.** The original endpoint-mode design below explains the
> first implementation, but it could not enforce one rename across sessions. The current op uses
> the registered `tools.agenta.rename_agent` handler. The SDK binds the running workflow id as
> hidden context, reads the persisted workflow before each run, includes its current name in the
> tool description, and omits the tool after success. The handler calls
> `WorkflowsService.rename_workflow_once`, whose DAO takes `SELECT ... FOR UPDATE`, writes the name
> and `_agenta_agent_self_named=true` in one transaction, and rejects concurrent or later calls.
> Normal workflow metadata edits preserve this server-owned marker. No migration is needed because
> workflow `meta` is JSONB.
>
> Endpoint mode against the artifact edit route was the original design. It required `PUT` on the
> direct-call allowlist and the `flags` fix, both in [plan.md](plan.md).

```python
PlatformOp(
    op="rename_agent",
    description=_RENAME_AGENT_DESCRIPTION,
    method="PUT",
    path="/api/workflows/{workflow_id}",
    input_schema=_RENAME_AGENT_INPUT_SCHEMA,
    args_into="workflow",
    context_bindings={
        "workflow_id": "$ctx.workflow.artifact.id",
        "workflow.id": "$ctx.workflow.artifact.id",
    },
    read_only=False,
)
```

The model-visible schema is identical to `rename_session`'s: `name` required, 1 to 120 characters
with the `\S` pattern; `description` optional, up to 300.

**Two bindings resolve the same token** because the route needs the id twice: once in the path and
once in the body, where the handler compares them. `pathParamNames` deletes only the top-level
`workflow_id` key from the body after substitution, so the nested `workflow.id` survives into the
payload. Both come from one run-context value, so they can never disagree, and the handler's
id-mismatch branch is unreachable through this tool.

### The route must stop reporting a missing target as success

`edit_workflow` returns HTTP 200 with `count: 0` in two cases: when the body's `workflow.id` does
not match the path, and when the service finds no artifact (a deleted or archived workflow). The
runner treats any 2xx as a successful tool call (`direct.ts:643` raises only on a non-ok status), so
a rename against a workflow that no longer exists returns success to the model, which then reports
to the user that it renamed itself. Nothing was written.

Correct the route rather than papering over it at the tool: when `WorkflowsService.edit_workflow`
returns `None`, raise `HTTPException(status_code=status.HTTP_404_NOT_FOUND, ...)`, the pattern
`api/oss/src/apis/fastapi/applications/router.py:1146` already uses. Do the same for the id-mismatch
branch, which is a client error and not an empty result. The tool then fails closed with a message
the model can act on.

This is a correctness fix to an existing public endpoint, not new surface. Any caller currently
reading `count` to detect the failure keeps working, because a 404 is what it was already checking
for in effect.

The assembled body is:

```jsonc
{"workflow": {"name": "...", "description": "...", "id": "<bound>"}}
```

which is exactly `WorkflowEditRequest`. No `flags`, no `tags`, no `meta`.

### Behavior

- **Scoping.** `workflow_id` is bound and stripped, so the agent can only rename itself.
- **Permission.** `EDIT_WORKFLOWS`, checked against the run's own credential.
- **No workflow identity.** A run with no resolved workflow reference (an inline config with no
  stored artifact) cannot resolve the token, and the call fails closed with a message naming the
  tool.
- **Evaluators and other workflow-backed entities.** The run-context builder normalizes
  `application*` and `evaluator*` reference families into `workflow.artifact`, so the op would work
  on those too. It ships only in the build kit, which mounts on agents, so that path is not
  exercised. The op description says "the agent you are running as", which stays true either way.

## The tool descriptions the model reads

These carry the whole instruction. Keep them in the catalog next to the op, as `_RENAME_*_DESCRIPTION`
constants.

### `rename_session`

> Name and describe the session you are running in, so a person scanning a long list of sessions can
> tell what this one is. Call it once you understand what the session is about, which is usually
> after the first exchange. Call it again later whenever the session has moved on and the name or
> the recap no longer fits.
>
> `name` is the general subject: what this session is about, as a short label a person can scan in a
> list. A few words. Not the latest step, and not a sentence.
>
> `description` is the current state: a short recap of what has happened and what is open, one to
> one and a half sentences, short enough to read inside a table cell.
>
> This renames the session you are in and no other one. It works only inside a session.

### `rename_agent`

> Name and describe yourself, so a person browsing the list of agents can tell what you are for.
> Call it once you understand your own purpose, which is usually right after your first task. Call
> it again if your purpose changes.
>
> `name` is what you are for, as a short label a person can scan in a list. A few words.
>
> `description` is what you do and where you currently stand, one to one and a half sentences, short
> enough to read inside a table cell.
>
> This renames the agent you are running as and no other one. It changes only your name and your
> description, never your configuration.

## The project watch event

A second channel scope beside the existing per-session one, chosen by traffic volume. Keep
`watch:{project}:session:{session}` for high-frequency in-session traffic; a browser not in that
session must not pay for it. Add `watch:{project}:project` for low-frequency entity-changed
notifications a list page needs.

- **Contract** (`api/oss/src/dbs/redis/sessions/contract.py`, beside the existing helpers):
  `project_watch_channel(project_id)` and `make_watch_entity_changed_payload(entity, id)` returning
  `{"type": f"{entity}-changed", "entity": entity, "id": id}`.
- **Event names**: `session-changed` and `workflow-changed`. The entity goes in the SSE event
  **name**, not only in the data, because `EventSource` dispatches per name: a subscriber pays
  nothing for events it did not register for, and the browser ignores an unrecognized name for free.
  Keep the closed `_KNOWN_EVENTS` allowlist.
- **Why `workflow-changed` and not `agent-changed`.** The frame names the platform entity that
  changed. The agents list is one view of workflow artifacts, and an evaluator is another; a frame
  named after the view would be wrong for every other view of the same row.
- **Publisher**: a keyword-only `changed(*, project_id, entity, id)` method on
  `SessionsWatchPublisher` and on the Protocol in
  `api/oss/src/core/sessions/watch/interfaces.py`, with the same best-effort, one-second-bounded,
  never-raises contract as the three existing methods.
- **Endpoint**: `GET /watch?project_id=...`, reusing `watch_event_stream` unchanged against
  `project_watch_channel(request.state.project_id)`. The `project_id` query parameter is the
  standard one every Agenta endpoint carries and the existing session watch client already sends it
  (`useSessionRecordsWatch.ts:20`). What this route does not take is an **entity-specific**
  parameter: there is no `session_id` and no `workflow_id`, because the channel is the whole
  project.
- **Permission**: there is no generic project-view permission, and this one stream carries frames
  for two entity families. Require **every** view permission whose entity appears on the channel, as
  a conjunction: today `VIEW_SESSIONS` and `VIEW_WORKFLOWS`. Check them with the same
  `check_action_access` calls the two existing routes use, and return `FORBIDDEN_EXCEPTION` when
  either fails. Write the permission list next to `_KNOWN_EVENTS` with a comment stating that adding
  an event to the allowlist means adding its view permission here.
- **Why a conjunction and not per-frame filtering**: the frames carry no entity data, so the only
  thing a subscriber learns is that something in a category changed, and the refetch each frame
  provokes is authorized normally by its own endpoint. Filtering frames per permission would add a
  second authorization model for zero protected information. The cost of the conjunction is that a
  role holding only one of the two permissions cannot open the stream at all and falls back to the
  30 second refetch, which is acceptable and must be stated in the route docstring.
- **Client**: one hook in a package, `useProjectWatch({on: {"session-changed": handler, ...}})`,
  holding the connection lifecycle the two existing hooks already implement. Extract it from
  `useSessionRecordsWatch` rather than writing a third copy. Mount it once per project scope so
  every page under it shares one connection; the in-session hook keeps its own connection for the
  high-frequency channel.

**How a later feature reuses this.** Publish
`changed(project_id=..., entity="<entity>", id=...)` from the service method that
committed the write, next to the write. Add the event name to `_KNOWN_EVENTS` **and** its view
permission to the endpoint's conjunction. On the client, add one entry to the `on` map whose handler
invalidates that page's existing query key. Two rules stay fixed: the frame carries no entity data,
and the handler only invalidates, never applies a change read out of the frame.

**Known cost.** One SSE connection and one Redis pubsub connection per open tab. That is the order
the session relay already costs per open chat, and `router.py:585` already flags the revisit ("one
pubsub connection per SSE connection (v1); revisit with a shared listener if counts grow"). The
project channel does not change the order of magnitude and the same note applies.

## Chat title precedence after this change

Decision 2 in [context.md](context.md) removes the title-provenance idea. The rule becomes: **a
non-empty server name wins.** In `reconcileServerSessionsAtomFamily`
(`web/oss/src/components/AgentChatSlice/state/sessions.ts:431`), `title: s.title?.trim() ? s.title :
remote.title` becomes `title: remote.title?.trim() ? remote.title : s.title`.

This is safe because every locally set title is also written to the server: both the auto-title and
the manual rename call `setSessionHeader`. The one visible cost is a brief flicker when a list
refetch that started **before** a local rename's write landed resolves **after** it, showing the old
name for one render. It corrects itself on the next reconcile. Accept it rather than reintroducing
provenance tracking; if it proves annoying in practice, the fix is to invalidate the session list
right after a local rename resolves, not a new field.
