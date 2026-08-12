# Status

**Phase:** implemented on `feat/agent-self-naming-tools`; live QA (V4) and a benchmark run remain.
**Last updated:** 2026-08-10.

## Progress

| Track | Steps | State |
| --- | --- | --- |
| Session tool | S1 to S3 | Done. Unit-tested (runner, SDK catalog, build-kit overlay). |
| Agent tool | A1 to A4 | Done. A2's regression tests are acceptance tests and need a live stack. |
| Chat title | T1 | Done, with reconcile-precedence tests. |
| Live refresh | W1 to W3 | Done. Watch endpoint/publish unit-tested; browser behavior needs live QA. |
| Verification | V1 to V3 | Done (tests landed with their steps; benchmark scenarios + budget; docs synced). |
| Verification | V4 | Not started — live QA runs outside this branch. |

## Implementation deviations (all small, each justified)

- S2+S3 landed as one commit (shared files), as the plan itself allowed for S3.
- A1+A3 landed as one commit: the PUT-allowlist tests and the `rename_agent` tests share
  `tool-direct.test.ts` and `test_op_catalog.py`, and the plan's own branch-layout note says a
  shared test file lands with the highest step. A2 is committed **before** them so `rename_agent`
  never exists in history ahead of the flags fix.
- A2 gained a `fetch_artifact(include_archived=False)` pre-check in `edit_workflow` — the DAO edit
  alone cannot distinguish archived from missing, and the plan requires 404 for both.
- A2's test file (`acceptance/workflows/test_workflows_basics.py`) also corrects pre-existing test
  data that used variant-level flag keys (`is_custom`, `is_feedback`) where artifact flags belong.
- One stale runner test (`sandbox-agent-orchestration.test.ts`) asserted the relay gets no run
  context when the request carries none; S1's augmentation makes that `{session: {id}}`, and the
  assertion now pins the new shape.
- W3's shared hook lives at `web/oss/src/hooks/useProjectWatch.ts` (app layer, not a package): only
  `web/oss` consumes it today, matching the package-placement heuristic. `useSessionRecordsWatch`
  was mechanically refolded onto it.
- The project watch route is `GET /sessions/watch?project_id=...` (the sessions root router), the
  natural reading of the plan's `GET /watch` under that router.
- V3 also refreshed the stale `DEFAULT_BUILD_KIT_OPS` enumeration in `tools.md` (it predated
  `test_run`/`read_config`) and synced the interface inventory (four-method allowlist, fail-closed
  binding errors naming the tool, the runner-filled `session.id`).

## Open questions

None. The one question this plan carried is resolved below.

### Resolved: the rename tools do not prompt for approval

Both ops write, so `read_only=False`, and under the default `allow_reads` policy every call would
raise an approval card, because the build-kit overlay emits no `permission` for any op today.

**Resolution: both ship with `permission: "allow"` in the build-kit overlay.** The write is
self-scoped (the target is bound from run context and cannot be redirected), non-destructive (the
schema cannot produce an empty or blank name), and reversible by the user in one click from the rail
or the playground header. A prompt on turn one, before the user has read anything the agent
produced, is a worse interruption than any outcome it prevents. `commit_revision` prompting is right
because it changes what the agent is; a rename changes only a label.

This unblocks S3 and the benchmark scenarios, which can now assume an ungated call. The fallback
branch documented in [plan.md](plan.md) step S3 stays there as the record of what the other answer
would have cost, and is not the path to implement.

## Known risks

### A trigger-minted run may lack the write permission

Automation sessions are the ones that most need a good name, and their credential is server-minted
rather than the user's. If that credential lacks `EDIT_SESSIONS` or `EDIT_WORKFLOWS`, both tools
fail closed on triggered runs. Decision 4 in [context.md](context.md) rules out special-casing, so
this is a verification item, not a design question: check it with one triggered run during live QA,
and if the scope is missing, treat it as separate work on the trigger dispatch path.

### The flags fix has callers we have not enumerated

Step A2 changes `edit_workflow` so an edit that omits `flags` no longer NULLs the column. The DAO's
own comment states that this is the intended behavior, and the frontend already compensates by
sending `flags: {is_application: true}` on every rename, so no caller should depend on the null-out.
Confirm by grepping for `edit_workflow` and `updateWorkflow` callers before landing, and keep A4
(removing the frontend workaround) in the same stack so the two stay consistent.

### One SSE connection per open tab

The project watch channel adds one Server-Sent-Events connection and one Redis pubsub connection per
open tab, on top of the per-session one an open chat already costs. That is the same order of
magnitude, and `api/oss/src/apis/fastapi/sessions/router.py:585` already carries the revisit note
("revisit with a shared listener if counts grow"). No action now; do not let the project channel be
the reason the note is finally acted on without measurement.

## Decisions and their history

| Date | Decision | Who |
| --- | --- | --- |
| 2026-08-09 | Both ops go into `DEFAULT_BUILD_KIT_OPS` rather than staying author opt-ins. The earlier research recommended opt-in; this reverses it. | Mahmoud |
| 2026-08-09 | The agent may overwrite a human-typed session name. The client-side title-provenance idea from the earlier research is dropped; the chat reconcile lets a non-empty server name win instead. | Mahmoud |
| 2026-08-09 | The client-side auto-title stays and fires only on the first message. Reading the code showed this already holds, so no change is needed. | Mahmoud |
| 2026-08-09 | Trigger-minted runs get no special case; the presence of the build kit decides. | Mahmoud |
| 2026-08-09 | `rename_agent` added as a second tool with the same shape. | Mahmoud |
| 2026-08-09 | `rename_agent` uses endpoint mode with `PUT`, which means widening the direct-call method allowlist from three methods to four. The two alternatives (a duplicate POST route, or handler mode) were rejected; see [research.md](research.md). | Plan |
| 2026-08-09 | The watch event is named `workflow-changed`, not `agent-changed`, because it names the platform entity that changed rather than one view of it. | Plan |
| 2026-08-10 | Approval behavior settled: both ops carry `permission: "allow"` in the build-kit overlay. | Orchestrator, flagged to Mahmoud and unvetoed |
| 2026-08-10 | Both `name` schemas gain a `\S` pattern. `minLength: 1` alone admits a whitespace-only name, which clears the visible title while the row still holds a value. | Plan review |
| 2026-08-10 | `edit_workflow` raises a 404 for a missing or archived target instead of returning 200 with `count: 0`. The runner treats any 2xx as success, so the old shape reported a silent no-op as a completed rename. | Plan review |
| 2026-08-10 | `changed` takes `project_id` explicitly, keyword-only, matching the three existing publisher methods. A Redis client alone cannot derive the project channel. | Plan review |
| 2026-08-10 | `GET /watch` takes the standard `project_id` query parameter and requires `VIEW_SESSIONS` and `VIEW_WORKFLOWS` together. There is no generic project-view permission, and one stream carries both entity families. | Plan review |
| 2026-08-10 | The `session-changed` handler invalidates the `["session-list", projectId]` prefix and lets the mounted `useReconcileServerSessions` hooks reconcile. `reconcileServerSessionsAtomFamily` needs a scope key and the full server array, neither of which a frame carries. | Plan review |
| 2026-08-10 | The benchmark needs no tool-mounting plumbing (`run_benchmark.py:158` already appends a scenario's `tools`), but it does need `max_rename_calls` counted and enforced in `within_budget`, since a declared-only budget changes nothing. | Plan review |
