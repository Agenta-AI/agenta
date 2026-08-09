# Verification

Three layers, each answering a different question. Unit and API tests answer "does the contract hold
in isolation". The benchmark answers "do small models actually call these tools correctly, one
shot". Live QA answers "does a person see the rename".

## Unit and API tests

Land each with the step it covers, listed in [plan.md](plan.md).

### Runner (`services/runner/tests/unit/tool-direct.test.ts`)

- `$ctx.session.id` resolves from the augmented run-context blob.
- A run with no session id makes the binding throw, and the message names the tool.
- `directCallUrl` produces `<origin>/api/sessions/streams/header?session_id=<id>` and the query
  string does not defeat the host lock or the mount check.
- A `PUT` dispatch carries a JSON body; a method outside the four-item allowlist is still rejected.
- `rename_agent`'s assembled body is `{"workflow": {"name", "description", "id"}}`, with the
  top-level `workflow_id` stripped after path substitution, and the URL is `<origin>/api/workflows/<id>`.

### SDK catalog (`sdks/python/oss/tests/pytest/unit/agents/platform/test_op_catalog.py`)

- Both ops resolve to a `CallbackToolSpec` with a direct `call`.
- `session_id`, `workflow_id`, and `workflow.id` are all absent from `resolved_input_schema()`.
- The emitted `ToolCall` carries the path token, the bindings, and `args_into` where declared.
- A whitespace-only `name` fails schema validation on both ops.
- A catalog op may declare `PUT`.
- Both ops are in `DEFAULT_BUILD_KIT_OPS` and therefore in the build-kit overlay.

### API (`api/oss/tests/pytest/`)

- **Session header write**: covered already by
  `acceptance/sessions/test_stream_header_basics.py` and `test_stream_header_roundtrip.py`. Add one
  case only if the query-parameter-in-path form exposes something those miss.
- **Workflow edit preserves flags**: a PUT carrying only `{id, name}` leaves `flags` unchanged; a
  PUT carrying flags still replaces them. This is the regression test for the bug A2 fixes and it
  must exist before `rename_agent` ships.
- **Workflow edit fails loudly on a missing target**: a PUT naming a workflow id that does not exist
  or has been archived returns a non-2xx, not 200 with `count: 0`. Drive the concurrent-deletion
  case directly: archive or delete the workflow, then issue the edit.
- **Watch endpoint** (`unit/sessions/test_watch_endpoint.py`): the project route emits the same
  frame sequence the session route does (a `retry:` preamble, one `ready`, one frame per publish),
  a payload whose type is outside the allowlist loses its own frame without dropping the connection,
  and a caller holding only one of `VIEW_SESSIONS` / `VIEW_WORKFLOWS` gets a forbidden response
  instead of a stream.
- **Watch publish** (`unit/sessions/test_watch_publish.py`): `set_header` publishes exactly one
  `session-changed` frame on the project channel; `edit_workflow` publishes exactly one
  `workflow-changed` frame; both pass `project_id` explicitly; a publisher that raises does not fail
  either write.

### Frontend

- The build-kit overlay test: both ops carry `permission: "allow"` and no other op does. If open
  question 1 in [status.md](status.md) is answered the other way, this becomes a
  `web/packages/agenta-entity-ui/tests/unit/toolPermission.test.ts` case instead, asserting neither
  op is auto-allowable from the approval card.
- `web/oss/src/components/AgentChatSlice/state/sessions.pageTitle.test.ts`: a non-empty server name
  replaces a local one; an empty server name leaves the local one alone; a session absent locally
  adopts the server name.
- The project watch hook, driven by a fake `EventSource`: the event-to-handler mapping and the
  revalidation on `ready`.

## One-shot benchmark

`benchmarks/agent-config-editing/` measures whether a small model completes a configuration action
one-shot, against a 95% target. Both tools belong in it, because both are exactly the shape it
measures: a user types in prose, the model must reach for the right tool with the right arguments on
the first try, and the verdict is read from a stored row.

Two facts about the harness shape this work (details in [research.md](research.md)): every verdict
is currently read from `parameters.agent` of the newest revision, and `LIVE_TOOLS` mounts only
`read_config` and `commit_revision`.

### New check kinds (`bench_lib.py`)

Register two checks behind the existing `@check("<name>")` decorator, each reading a row the current
`Ctx` does not carry:

- `session_header`: fetches `GET /sessions/streams/?session_id=<the trial's session id>` and
  asserts on `name` or `description`. The trial already mints its own session id
  (`bench_lib.py:1402`); carry it onto `Ctx` so the check can read it back.
- `workflow_header`: fetches the trial's workflow artifact and asserts on `name`, `description`,
  and that `flags` survived.

Both take the same `pattern` form `stored_matches` uses rather than a literal, because the wording
is the model's to choose and a literal check would score a correct rename a miss. Assert the shape,
not the bytes. Where a token must appear verbatim, use a `{{TOKEN}}` substring check.

### New scenario file (`scenarios/09-self-naming.json`)

Class `self_naming`. Suggested scenarios, each a single turn written the way a person types:

| Id | Prompt shape | What it checks |
| --- | --- | --- |
| `name-01-session-after-task` | A real task with a clear subject, no mention of naming | The model calls `rename_session` unprompted, the stored `name` describes the subject, the `description` is non-empty and under 300 characters |
| `name-02-session-update` | Two turns: a task, then a clear change of subject | A second `rename_session` call, with the stored name reflecting the new subject |
| `name-03-agent-first-task` | A first task for a freshly seeded agent with a placeholder name | The model calls `rename_agent`, the stored artifact `name` is no longer the placeholder, and `flags` are intact |
| `name-04-no-spurious-rename` | A trivial one-line request in an already well-named session | Neither tool is called, enforced by `max_rename_calls: 0`; the stored name still matches the seeded one |

`name-04` matters as much as the other three. A tool that fires on every turn produces churn in the
list, and only a scenario that scores a call as a failure can catch it.

Both `flags` assertions on `name-03` are the benchmark's guard against the bug A2 fixes regressing.

### Harness plumbing

- **Mounting the tools needs no new plumbing.** `run_benchmark.py:158` already computes
  `run_agent["tools"] = B.LIVE_TOOLS + (scenario.get("tools") or [])`, so a scenario adds its own
  ops by declaring a `tools` list. Each of the four scenarios declares the one op it measures.
- Carry the trial's `session_id` and `workflow_id` onto `Ctx` so the two new checks can read the
  rows back.
- **Add and enforce a rename-call budget.** The budget block today is `max_rounds`,
  `max_tool_errors`, and `max_commit_calls`, and `within_budget` (`run_benchmark.py:230`) counts
  only tool errors and `commit_revision` calls. A rename budget that is only declared in the JSON
  changes nothing. Add `max_rename_calls`, count calls to `rename_session` and `rename_agent` the
  same way `commit_calls` is counted, and add the comparison to the `within_budget` conjunction.
  Set it to 1 for `name-01` through `name-03` and **0** for `name-04`, which is the only way that
  scenario can fail on a spurious rename.

### Reporting

No change. Both `one_shot` and `excl. harness` still apply, and the outcome labels
(`bench_lib.classify_outcome`) already distinguish "used the surface and got the details wrong" from
"described the mechanism and made zero calls", which is the distinction that tells us whether to
change a description or fix a bug.

## Live QA

Deploy an OSS dev stack: `load-env hosting/docker-compose/oss/.env.oss.dev` then
`bash ./hosting/docker-compose/run.sh --oss --dev --build`.

**The scenario.** Create a fresh agent, from a template or blank. Do not rename it by hand. Open a
new session in the playground chat and give it a real task with a clear subject. Then open a second,
separate session with the same agent and give it a different task.

**What to confirm, in order:**

1. The model calls `rename_session` with a `name` that reads as a subject and a `description` that
   reads as a recap of one to one and a half sentences. Read the arguments in the approval card or
   the tool-call display, not just the reply.
2. The model calls `rename_agent` after its first task, with a name that says what the agent is for.
3. `GET /sessions/streams/?session_id=...` returns the new `name` and `description`.
4. The agents list shows the new agent name **and the agent is still in the list**, which is the
   flags check. If it vanished, A2 did not land or did not work.
5. The `GET /watch` stream in the network tab carries one `session-changed` frame and one
   `workflow-changed` frame, each at the moment of its call.
6. The sessions list, the chat rail, and the agents list all show the new names without a reload.
   Watch them in a **second tab that never touched the session**, which is the case client-side
   mutation invalidation cannot serve.
7. The second session gets its own distinct name, and renaming it does not disturb the first.
8. Rename a session by hand in the rail, then send another message. The agent may overwrite it; that
   is decision 2 and it is expected. What must not happen is the name reverting on its own between
   refetches.

**Then check the stored rows in Postgres**, so the assertion is on stored state and not on model
prose:

```sql
select name, description from session_streams where session_id = '...';
select name, description, flags from workflow_artifacts where id = '...';
```

Confirm the exact table and column names against the DBA modules before running the second query.
