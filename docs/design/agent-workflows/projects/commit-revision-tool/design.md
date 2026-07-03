# Design — `commit_revision` as a first-party Agenta tool

Status: proposal for review. Docs only; no code, no PR yet. The draft PR is the next step
the orchestrator sequences (spec in §8).

Companion: `research.md` (code-truth, file:line). Decision threads:
`scratch/pr-4936-followup/01-commit-revision.md` (D1 home, D2 delta-vs-data),
`scratch/pr-4936-followup/03-ctx-variant-binding.md` (targeting, draft, generic errors).

---

## 1. Problem and shape of the fix

`commit_revision` lets an agent edit and save its own config. Today it is a thin
direct-call platform op that POSTs the model's `delta` straight to the core workflows
commit endpoint (`research.md` §2). Two things are wrong with that:

1. **No agent-facing validation.** The model's `delta.set` is deep-merged blindly into the
   live config. An edit that produces a structurally invalid agent config is committed.
2. **The merge/validation responsibility is drifting toward the core workflows router.**
   PR #4936 first tried a `/commit/patch` endpoint there; that was rejected. JP's `delta`
   replaced it with a clean primitive — but "what a self-editing agent is allowed to
   write" is agent policy, and it does not belong in the workflows core.

**The fix:** keep JP's `delta` commit as the clean primitive, and add a dedicated Agenta
tool that owns the agent-facing behavior — read current revision → validate the would-be
result against the agent-template schema → call the core `delta` commit. The tool lives in
the Agenta tool layer (the tools domain), alongside `find_capabilities` and the Composio
adapter.

Non-goals: changing JP's `delta` primitive; changing the runner; changing the
self-targeting mechanism; making `commit_revision` work on drafts (stays fail-closed,
thread 03 D1).

---

## 2. Where the tool lives (D1) — two options, with a recommendation

The new behavior is multi-step server-side logic (read → validate → commit), so it cannot
stay a thin wrapper over a single existing endpoint. It needs a server-side handler. The
question is which seam.

### Option A (recommended) — a dedicated tools-domain endpoint, still reached as a direct-call platform op

- **New endpoint:** `POST /api/tools/agenta/commit-revision`, registered on `ToolsRouter`
  (which already has `WorkflowsService`, `research.md` §1).
- **New service:** `core/tools/agenta/commit.py` — `AgentSelfCommitService` (or a method
  group on `ToolsService`) that reads the current revision via `WorkflowsService`,
  validates, and calls `WorkflowsService.commit_workflow_revision`.
- **SDK change:** the `commit_revision` catalog entry keeps everything except its `path`,
  which moves from `/api/workflows/revisions/commit` to `/api/tools/agenta/commit-revision`
  (`op_catalog.py:491-502`). It stays `type:"platform"`, keeps `context_bindings`
  (`$ctx.workflow.variant.id`) and its input schema.

Why recommended:
- **Self-targeting keeps working with zero new plumbing.** The `$ctx` binding only works
  on the direct-call path (`research.md` §5). Staying a direct-call op preserves it.
- **Honors "not in the core workflows router."** Validation + self-edit policy live in the
  tools domain; the workflows core keeps only the `delta` primitive.
- **Honors "in the Agenta tool layer alongside Composio."** The endpoint is in the tools
  domain next to discovery and the gateway.
- **No runner change.** `direct.ts` already does method/path/SSRF/binding; only the target
  path string changes.

### Option B — a `tools.agenta.commit_revision` op routed through `POST /tools/call`

Mirror `find_capabilities`'s original server-side dispatch: add a `_call_commit_revision`
branch to `_call_agenta_tool` (`router.py:1149-1211`) and make the catalog entry route
through `/tools/call` with a `tools.agenta.commit_revision` call_ref.

Rejected because: `/tools/call` does not carry `runContext`, so the handler cannot read
`$ctx.workflow.variant.id` (`research.md` §5). It would break self-targeting unless we
invent a new run-context-into-`/tools/call` propagation — net-new plumbing for no benefit.
It also runs against the direction of travel: `find_capabilities` was deliberately migrated
OFF `/tools/call` onto a direct call (`op_catalog.py:186-189`).

**Decision: Option A.**

---

## 3. Behavior of the tool (the four steps)

Endpoint handler → `AgentSelfCommitService.commit_revision(...)`:

1. **Read the current revision.** Fetch the bound variant's latest committed revision via
   `WorkflowsService.fetch_workflow_revision(workflow_variant_ref=Reference(id=variant_id))`.
   This is the SAME base JP's `_resolve_revision_delta` merges onto, so validation sees
   exactly what the commit will produce. If the variant has no committed revision yet,
   treat the base as empty `{}` (matches `_resolve_revision_delta`).

2. **Build the would-be result (for validation only).** Deep-merge `delta.set` onto the
   base `data`, then delete each `delta.remove` dotted path — the same operations as core
   (`_deep_merge` / `_remove_path`, `service.py:2320-2339`). Reuse those helpers (promote
   them to an importable util) rather than copy them, so the tool and core can never drift.

3. **Validate.** Run `validate_data_against_schema` (`core/invocations/utils.py:33-57`) on
   the merged `parameters.agent` against `CATALOG_TYPES["agent-template"]`
   (`AgentTemplateSchema`, `types.py:1182-1259`). On failure, do NOT commit; return a
   business-error result the model can read and retry (see §5). Scope validation to
   `parameters.agent` (the documented edit surface); leave other top-level keys to core's
   existing normalization. (Open question O1 in §9: whether to also reject edits OUTSIDE
   `parameters.*`.)

4. **Commit via the core primitive.** Call
   `WorkflowsService.commit_workflow_revision(workflow_revision_commit=WorkflowRevisionCommit(
   workflow_variant_id=..., message=..., delta=WorkflowRevisionDelta(set=..., remove=...)))`.
   **Pass the `delta`, not the merged `data`** — so core remains the single merge authority
   and re-merges against the same latest revision. The in-memory merge in step 2 is for
   validation only; we do not persist it directly. (This double-merge is cheap and keeps
   one source of truth; see O2 in §9 for the alternative.)

Return a typed result DTO (committed flag + the new revision summary, or the validation
errors). Emit the best-effort `committed-revision` data event for parity with the core
commit path (`router.py:1567`); it is a no-op on a plain direct call but keeps the door
open for playground reflection (thread 04).

**Variant targeting stays server-bound.** The model never sends `workflow_variant_id`; it
is stripped from the model schema and filled by the runner from `$ctx.workflow.variant.id`
(`research.md` §2, thread 03). The new endpoint reads the variant id from the request body
exactly where the binding deep-sets it (`workflow_revision.workflow_variant_id`). The model
cannot retarget.

---

## 4. `delta` vs `data` (D2) — use `delta`

**Decision: `delta` (set + remove).** Justification:

- **Partial edits without clobber.** The model sends only what it changes. With `data`
  (full replace) the model must reproduce the entire config every call or it deletes every
  omitted field — that was Bug B (thread 01).
- **Deletes need `remove`.** Dropping a tool/field is only expressible as
  `delta.remove: ["parameters.agent.tools"]`. A partial `data` cannot selectively delete
  without sending the whole config.
- **One merge base.** `delta` merges onto the variant's latest committed revision — the
  exact base the tool reads in step 1 for validation. `data` would let the model and the
  validator disagree about the base.
- **Already the offered shape.** The catalog input schema already exposes
  `delta.set`/`delta.remove` (`op_catalog.py:261-310`); no model-facing change.

The core still accepts `data` (full replace) for other callers; the agent tool simply
chooses `delta`.

---

## 5. Error handling and fail-loud (thread 03 D2)

Three error classes, deliberately surfaced differently because `callDirect` hides non-2xx
response bodies from the model (`research.md` §2, `direct.ts:380-387`):

| Condition | HTTP | What the model sees | Why |
|---|---|---|---|
| Schema validation failed | **200** with `{committed:false, errors:[...]}` | a concise, sanitized summary of what is wrong | a **business** error: the model should read it and retry with a corrected edit |
| Missing self-target binding (e.g. draft run) | runner throws before the call | generic "tool unavailable in this run context" | fail-closed; never leak the internal `$ctx` field name (thread 03 D2) |
| No `EDIT_WORKFLOWS` / `RUN_TOOLS` permission | 403 | generic status only | authz, not the model's concern |
| Unknown variant / server fault | 4xx/5xx | generic status only | log detail server-side |

Key design point: **validation failure returns HTTP 200 with a structured result**, the
same way the Composio path returns `STATUS_CODE_ERROR` at 200 with the message in
`content` (`router.py:1132-1147`). That is the only way the model receives the validation
feedback (a 4xx would collapse to "HTTP 400" with no body). The validation summary is
sanitized: field-in-template terms (e.g. "llm.model must be a string"), never jsonschema
internals, server paths, or stack traces.

Define a typed domain exception (e.g. `AgentConfigInvalid` carrying structured field
errors) in `core/tools/agenta/types.py`, raised by the service, caught at the router
boundary and shaped into the 200 business-error result (the AGENTS.md exception pattern:
core raises typed, router maps to HTTP/result).

---

## 6. Draft / unsaved-run constraint (thread 03 D1)

Unchanged and free. On a draft run the frontend sends no references, so
`$ctx.workflow.variant.id` is empty and `assembleBody` throws before any HTTP call
(`direct.ts:230-233`). `commit_revision` is **inoperative on a draft by design** — the new
endpoint is never reached. We keep thread 03 D1 recommendation (a): require a saved run to
self-commit. No special-casing in the new endpoint; the binding layer enforces it.

---

## 7. Interface review (design-interfaces lens)

The endpoint request mirrors JP's `WorkflowRevisionCommit`, so the new model-facing surface
is minimal. Field-by-role:

```jsonc
{ "workflow_revision": {
    "workflow_variant_id": "...",          // ROUTING + CONTEXT: identifies the target;
                                            //   server-bound from run context; stripped
                                            //   from the model schema. Model never sets it.
    "message": "fix the system prompt",     // METADATA: human commit message.
    "delta": {                              // INPUT: the data being changed.
      "set":    { "parameters": { "agent": { ... } } },  // partial tree, deep-merged
      "remove": [ "parameters.agent.tools" ]             // dotted paths to delete
    }
} }
```

Checks against the role taxonomy:
- **Routing/context vs input are separated.** The target (`workflow_variant_id`) is not in
  the same bucket as the edit (`delta`); it is server-owned and invisible to the model.
- **Validation is POLICY, not a request field.** "What the agent may write" is enforced
  server-side against the `agent-template` schema; it is NOT exposed as a
  `validate: true`-style sibling of the data. Good — policy is not a peer of input.
- **No leaked mechanism.** The model surface is `delta.set`/`delta.remove`/`message`; it
  does not expose the jsonschema validator, the merge helper, or the core endpoint.
- **Standard shape preserved.** We reuse `WorkflowRevisionDelta` / the `workflow_revision`
  envelope rather than invent a parallel one, so the agent tool and the core commit speak
  the same vocabulary.
- **Naming.** `commit-revision` (endpoint) / `commit_revision` (op) match the existing op
  name; `delta.set`/`delta.remove` match JP's DTO. No new vocabulary introduced.

One refinement to consider (O3, §9): the per-tool request envelope still nests under
`workflow_revision` because it points at JP's request shape. If the endpoint owns its own
request model we could flatten to `{ message, delta }` (variant id is server-bound, never
in the model schema), which reads cleaner. Either works; keeping the envelope minimizes the
SDK schema diff.

---

## 8. Draft-PR spec (the orchestrator executes this next)

Scope: one cohesive slice — add the Agenta self-commit tool endpoint + service + the SDK
catalog repoint + tests. Behavior-preserving for every other tool.

### Files to add

- `api/oss/src/core/tools/agenta/__init__.py`
- `api/oss/src/core/tools/agenta/commit.py` — `AgentSelfCommitService` with
  `async def commit_revision(*, project_id, user_id, variant_id, message, delta) -> AgentCommitResult`.
  Steps §3.1-3.4. Depends on `WorkflowsService` (read + commit) and
  `validate_data_against_schema` + `CATALOG_TYPES["agent-template"]`.
- `api/oss/src/core/tools/agenta/types.py` — `AgentConfigInvalid` exception (structured
  field errors) + `AgentCommitResult` DTO (`committed: bool`, `revision: Optional[...]`,
  `errors: List[...]`).

### Files to change

- `api/oss/src/apis/fastapi/tools/router.py`
  - register `POST /agenta/commit-revision` in `ToolsRouter.__init__` (operation_id
    `commit_agenta_revision`).
  - handler `commit_agenta_revision`: `check_action_access` for `RUN_TOOLS` AND
    `EDIT_WORKFLOWS`; read `workflow_revision.{workflow_variant_id,message,delta}` from the
    body; call the service; map `AgentConfigInvalid` → 200 business-error result; 400 on a
    missing variant id; best-effort `committed-revision` emit on success.
  - construct `AgentSelfCommitService` from the already-injected `workflows_service`.
- `api/oss/src/apis/fastapi/tools/models.py` — `AgentCommitRevisionRequest` /
  `AgentCommitRevisionResponse` (mirror the `workflow_revision` envelope; reuse
  `WorkflowRevisionDelta`).
- `api/oss/src/core/workflows/service.py` — promote `_deep_merge` / `_remove_path` to an
  importable shared util (e.g. `core/workflows/utils.py` or `core/shared/`), so the tool
  reuses the exact merge. No behavior change to core.
- `sdks/python/agenta/sdk/agents/platform/op_catalog.py` — change `commit_revision`'s
  `path` to `/api/tools/agenta/commit-revision` (lines 491-502). Keep description,
  input_schema, `context_bindings`, defaults. Optionally tighten the description to mention
  it validates before saving.

### What the first draft PR contains

The full Option-A slice above (endpoint + service + SDK repoint + tests). It is one slice
because the SDK `path` repoint and the new endpoint must land together (the op points at
the new path). Behavior for every other platform op and Composio tool is untouched.

### Test / verification plan

Unit:
- SDK `test_op_catalog.py` — `commit_revision` resolves to a `call` with the new path and
  the variant field stripped from the model-visible schema.
- API service unit (fake `WorkflowsService`): valid delta → commits with the delta; invalid
  delta → `AgentConfigInvalid`, no commit call; `delta.remove` deletes a path; empty base
  (no current revision) merges onto `{}`.
- API router unit: invalid → 200 `{committed:false, errors:[...]}`; missing variant → 400;
  no permission → 403.

Live (debug-local-deployment, the `request_connection`-style round-trip):
1. Saved variant, agent calls `commit_revision` with a valid `delta.set` (approve) →
   confirm a NEW revision committed (check `/revisions/log`), model gets success.
2. Same, with an invalid edit (e.g. `llm.model` set to a number) → model gets the
   `{committed:false, errors:[...]}` business error; confirm NO new revision.
3. Draft run → confirm fail-closed (model gets the generic "unavailable in this run
   context"); confirm NO new revision.
4. Regression: `find_capabilities` and a Composio tool still resolve and run (no path
   collision, no router regression).

Hit the live tool via the sidecar `/run` by container IP, not the playground UI (the
project's "test backend programmatically" rule); approve the HITL call with the recorded
approval shape.

### Keep-docs-in-sync

This changes a wire/endpoint contract: update the interface inventory entry for
`commit_revision` (new endpoint + the validation step), and any agent-workflows
documentation page that describes platform ops / self-editing.

---

## 9. Risks and open questions

- **O1 — validation scope.** Validate only the merged `parameters.agent` against
  `agent-template`, or also reject edits to top-level keys outside `parameters.*` (uri,
  url, schemas) the agent should not touch? Lean: validate `parameters.agent`; additionally
  reject `delta` paths that escape `parameters.` as a guardrail (cheap, prevents an agent
  from rewriting its own `uri`/`url`). Confirm with owner.
- **O2 — merge once vs twice.** §3 validates an in-memory merge AND passes `delta` to core
  (core re-merges). Alternative: merge once and pass full `data` to core. Recommended to
  pass `delta` so core stays the single merge authority against the same base; the extra
  merge is negligible. Flag if double-merge is undesirable.
- **O3 — request envelope.** Keep the `workflow_revision` envelope (smallest SDK diff) or
  flatten to `{ message, delta }` on a dedicated endpoint request model (cleaner, §7).
  Lean: flatten, since this is a new endpoint that owns its own model and the variant id is
  always server-bound.
- **O4 — playground reflection of a self-commit.** The `committed-revision` emit is a no-op
  on a plain direct call (no `request.state.emit`). How the playground learns a new revision
  was committed is thread 04; out of scope here, but the new endpoint should not make it
  harder (keep the best-effort emit call).
- **O5 — partial-merge validation false negatives.** `agent-template` is `extra="forbid"`
  and strict; if the live config in the DB predates the strict schema, a valid incremental
  edit could fail validation because the EXISTING config is already non-conforming. Need to
  confirm stored configs validate clean against `agent-template`, or validate only the
  changed subtree, or downgrade unknown-field errors to warnings. **Highest-risk item —
  verify against real stored revisions during the live test.**
- **O6 — permission model.** `EDIT_WORKFLOWS` is the right gate (it is what the core commit
  requires). Confirm `RUN_TOOLS` + `EDIT_WORKFLOWS` is the intended pair for an agent
  editing itself, vs. a narrower self-edit permission.
