# Research — moving `commit_revision` into the Agenta tool layer

Goal of the parent task: take the agent-facing logic for `commit_revision` (read the
current config, validate the model's edit, build the change set) out of a direct call to
the core workflows commit endpoint, and put it in a dedicated tool in the Agenta "/tool"
layer that sits alongside the Composio tools. The core stays a clean primitive: JP's
`delta` commit (commit `4ae6289d68`).

This file is the code-truth research. The design and the draft-PR spec are in `design.md`.

Cross-references (do not re-derive): variant self-targeting is thread
`scratch/pr-4936-followup/03-ctx-variant-binding.md`; the decision history is thread
`scratch/pr-4936-followup/01-commit-revision.md`.

---

## 1. The two "tool" layers (so the seam is unambiguous)

There are two distinct things both called "tools." A new first-party Agenta tool touches
both.

**(A) The SDK platform-op catalog — DECLARATION + RESOLUTION.**
`sdks/python/agenta/sdk/agents/platform/op_catalog.py` is a code-defined table of
`PlatformOp` entries. Each entry is a thin wrapper over an EXISTING Agenta endpoint: it
owns the model-facing description, the endpoint (`method` + relative `path`), the input
JSON Schema, the self-targeting `context_bindings` (`$ctx.*` tokens), and the per-op
default permission/approval. `commit_revision` is one entry (`op_catalog.py:491-502`).

`AgentaPlatformToolResolver.resolve` (`platform/platform_tools.py:44-101`) turns each
entry into a `CallbackToolSpec` carrying a direct `call` descriptor
(`call=op.to_call()`, `platform_tools.py:83-93`) — NOT a `call_ref`. The spec's
`input_schema` is `op.resolved_input_schema()`, which strips every `context_bindings`
field from the model-visible schema (`op_catalog.py:128-145`), so the model never sees or
sets the bound variant id.

**(B) The API tools router — EXECUTION.**
`api/oss/src/apis/fastapi/tools/router.py` `ToolsRouter`. Its `POST /tools/call` handler
(`call_tool`, `router.py:1026-1147`) dispatches by call_ref prefix:

- `workflow.*` → `_call_workflow_tool` (`router.py:1223-1346`) — runs a stored workflow
  revision server-side.
- `tools.agenta.*` → `_call_agenta_tool` (`router.py:1149-1211`) — the reserved
  **Agenta tools**; v1 op is `find_capabilities`. **This is the "Agenta tool we added
  alongside the Composio tools, through a tool router"** the owner referred to. The
  namespace constant is `AGENTA_TOOL_CALL_REF_PREFIX = "tools.agenta."`
  (`core/tools/discovery.py:44`; `ToolProviderKind.AGENTA = "agenta"`,
  `core/tools/dtos.py:31`).
- `tools.{provider}.{integration}.{action}.{connection}` → the Composio adapter.

The router is wired with BOTH services already:
`ToolsRouter(tools_service=..., workflows_service=...)` at
`api/entrypoints/routers.py:948-951`; `workflows_service` is an optional ctor arg
(`router.py:140-147`). So a new Agenta tool here can read/commit revisions without new
wiring.

Catalog endpoints and connections live under `/api/tools/*` (catalog, connections,
resolve, discover, call) — `router.py:151-280`. A new first-party tool endpoint belongs
in this same router/domain.

---

## 2. How `commit_revision` works NOW (the direct-call path)

1. **Declared** in the SDK catalog (`op_catalog.py:491-502`):
   - `method="POST"`, `path="/api/workflows/revisions/commit"` (JP's core endpoint).
   - `input_schema=_COMMIT_REVISION_INPUT_SCHEMA` (`op_catalog.py:261-310`): the model
     sends `workflow_revision.delta.set` (deep-merged) and `delta.remove` (dotted paths),
     plus an optional `message`.
   - `context_bindings={"workflow_revision.workflow_variant_id": "$ctx.workflow.variant.id"}`.
   - `default_permission="ask"` (mutating -> approval). At the time this was written the op
     also carried a `default_needs_approval=True` flag; that flag is deleted, and `permission`
     alone now decides (see [projects/approval-boundary/](../approval-boundary/)).

2. **Offered** to every agent via the playground overlay:
   `build_agent_template_overlay` emits `{"type":"platform","op":op}` for every op in
   `PLATFORM_OPS` (`api/oss/src/apis/fastapi/applications/overlay.py:80-84`). So the tool
   is surfaced purely by being in the catalog — changing its `path` does not change how
   it is offered.

3. **Resolved** (SDK) into a `CallbackToolSpec` with a direct `call` (method/path/
   `context`/`args_into`) and the variant field stripped from the model schema.

4. **Executed** (runner) — because the spec has `call` (not `call_ref`), the runner calls
   the endpoint DIRECTLY, NOT through `/tools/call` (`services/agent/src/tools/direct.ts`):
   - `assembleBody` (`direct.ts:205-239`): model args → static `body` → `context` binding
     LAST. The variant id is resolved from the run's `runContext` via
     `resolveCtxToken("$ctx.workflow.variant.id")` (`direct.ts:129-147`) and deep-set into
     the body. **A missing binding value throws** (`direct.ts:230-233`) — fail-closed.
   - `directCallUrl` (`direct.ts:259-325`): SSRF guard. Method allowlist, single absolute
     path, host-locked to the run's own Agenta origin, confined to the API mount.
   - `callDirect` (`direct.ts:337-389`): the HTTP POST. **On any non-2xx it throws
     `"direct tool call failed: HTTP {status}"`** and logs the body server-side — so the
     model sees ONLY the status code, never the response body, on an error. On 2xx it
     returns the response body text verbatim to the model.

5. **Core** (`POST /api/workflows/revisions/commit`) does the merge (see §3).

**The gap.** Nothing between the model and the database validates the edit. The model's
`delta.set` is deep-merged blindly into the live config; an edit that makes the agent
config structurally invalid is committed anyway. There is no agent-facing validation
layer today — that is exactly what the new tool adds.

---

## 3. JP's `delta` commit contract (the primitive to keep) — from `origin/big-agents`

**DTOs** (`api/oss/src/core/workflows/dtos.py`):

```python
class WorkflowRevisionDelta(BaseModel):          # dtos.py:301-311
    set: Optional[Dict[str, Any]] = None         # partial tree, deep-merged onto base
    remove: Optional[List[str]] = None           # dotted paths to delete

class WorkflowRevisionCommit(...):               # dtos.py:314-327
    data: Optional[WorkflowRevisionData] = None  # full replace
    delta: Optional[WorkflowRevisionDelta] = None
    # + workflow_variant_id / variant_id (aliased), message, slug, flags
```

**Service** (`api/oss/src/core/workflows/service.py`):

- `commit_workflow_revision` (`service.py:1779-1907`): if `delta` is set, calls
  `_resolve_revision_delta` first, then runs the normal commit (snippet normalization,
  schema inference, DAO commit, event publish).
- `_resolve_revision_delta` (`service.py:1909-1942`): fetches the variant's **LATEST
  committed revision** (`fetch_workflow_revision` by variant ref), deep-merges `delta.set`
  onto its `data` (`_deep_merge`, `service.py:2320-2329`), deletes each `delta.remove`
  dotted path (`_remove_path`, `service.py:2331-2339`), returns a commit carrying the
  merged `data` and `delta=None`.

**Router** (`api/oss/src/apis/fastapi/workflows/router.py`):

- Route `POST /revisions/commit` → `commit_workflow_revision`
  (`router.py:422`, handler `router.py:1500-1572`). Permission: `EDIT_WORKFLOWS`.
- 400 validations (`router.py:1515-1556`):
  - variant id required (`variant_id is None` → 400).
  - `data` XOR `delta` — both set → 400.
  - neither set AND the variant already has a data revision → 400 (empty commit allowed
    only as the v0 seed).
  - `workflow_variant_id` query param vs body mismatch → no-op empty response.
- Emits a `committed-revision` data event after commit (`router.py:1567`, via
  `_emit_committed_revision_data_event` → `request.state.emit`, `router.py:1955-1985`).
  Best-effort: `emit` is only present in the streaming agent-run context, so a plain
  direct-call POST is a no-op here. (Playground reflection of a self-commit is thread 04
  territory; out of scope, but the new endpoint should keep parity by calling the same
  best-effort emit.)

**Targeting** (thread 03, do not re-derive): the model never sends the variant id; it is
bound server-side from `$ctx.workflow.variant.id`, which the runner fills from
`runContext` (built from the run's tracing references). A SAVED run sends
`application`/`application_variant`/`application_revision` refs; a DRAFT run sends NO refs
on purpose, so the binding is empty and `assembleBody` throws → `commit_revision` is
**inoperative on a draft by design** (fails closed). The latest committed revision is the
delta base; that is exactly what a draft would mismatch, which is why drafts are excluded.

---

## 4. How schema validation is done for tools today

**For tool calls: it is not.** Tool args are not validated against `input_schema`
anywhere in the platform path. The runner forwards args opaquely; the API `/tools/call`
and the direct-call endpoints accept whatever Pydantic coercion the target request model
applies. Client tools do enforce "required fields" at the harness (per thread 02 / the
PR-4936 decision log), but that is harness-side arg presence, not config validation.

**There is a ready precedent for data-against-schema validation.**
`api/oss/src/core/invocations/utils.py:33-57` `validate_data_against_schema(data, schema)`
uses `jsonschema` (dependency already present: `api/pyproject.toml:27`,
`"jsonschema>=4,<5"`), selects the right Draft validator from the schema's `$schema`
(`utils.py:12-30`), and raises a structured 422 with per-field `loc`/`msg`. The
annotations domain uses the same pattern (`core/annotations/utils.py`).

**The schema to validate against already exists.** `AgentTemplateSchema`
(`sdks/python/agenta/sdk/utils/types.py:1182-1259`, `model_config = extra="forbid"`) is
the strict JSON Schema for the agent template that sits at `parameters.agent`
(`instructions` / `llm` / `tools` / `mcps` / `skills` / `harness` / `runner` / `sandbox`).
It is registered in `CATALOG_TYPES["agent-template"]`
(`types.py:1614-1616`) as a dereferenced JSON Schema — directly usable by
`validate_data_against_schema`. The op's own description already steers edits to
`delta.set.parameters.agent` (`op_catalog.py:254-260`).

So a tool-level validation step has an obvious home and obvious materials: read the
current revision, apply the delta in-memory, validate the resulting `parameters.agent`
against `CATALOG_TYPES["agent-template"]`, reject before committing.

---

## 5. Why the new tool must stay a DIRECT-CALL platform op (not a `/tools/call` op)

Self-targeting (`$ctx.workflow.variant.id`) is the load-bearing constraint and it ONLY
works on the direct-call path:

- The `$ctx` binding is resolved by the runner in `assembleBody` from `runContext`
  (`direct.ts:226-237`) and placed in the request body before the HTTP call.
- The `/tools/call` path does NOT carry `runContext`. The runner forwards only the
  call_ref + the model's args in the OpenAI envelope; the server-side handler
  (`_call_agenta_tool` / `_call_workflow_tool`) has `request.state.project_id` / `user_id`
  but NO access to the run's variant id.

Therefore a `tools.agenta.commit_revision` op routed through `/tools/call` could not
self-target without inventing a brand-new run-context propagation into `/tools/call`. The
existing, working mechanism is the direct-call `call.context` binding. The new tool keeps
it by remaining a `type:"platform"` direct-call op whose `path` simply points at a NEW
endpoint instead of the raw core commit. No runner change, no new binding plumbing.

"In the Agenta tool layer alongside Composio" is still honored: the new endpoint lives in
the tools domain (`/api/tools/agenta/...`, `core/tools/agenta/`), next to discovery
(`find_capabilities`) and the Composio adapter. It is an Agenta tool by location and
ownership; it just keeps the direct-call transport for the self-target binding.

---

## 6. Inventory — what exists vs. what is new

| Concern | Exists today | Where |
|---|---|---|
| Platform-op catalog entry for `commit_revision` | yes | `op_catalog.py:491-502` |
| Direct-call resolution + transport | yes (unchanged) | `platform_tools.py`, `direct.ts` |
| `$ctx.workflow.variant.id` binding + fail-closed on draft | yes (unchanged) | `direct.ts:226-237`, thread 03 |
| Core `delta` commit primitive | yes (keep) | `service.py:1779-1942` |
| Deep-merge / remove-path helpers | yes (core-private) | `service.py:2320-2339`; runner mirror `direct.ts:78-115` |
| `validate_data_against_schema` (jsonschema) | yes (reusable) | `core/invocations/utils.py:33-57` |
| `agent-template` strict schema | yes (reusable) | `types.py:1182-1259`, `CATALOG_TYPES` |
| ToolsRouter has WorkflowsService | yes (wired) | `router.py:140-147`, `routers.py:948-951` |
| Agent-facing validation BEFORE commit | **NO — the gap** | — |
| Dedicated Agenta self-commit endpoint | **NO — to add** | `core/tools/agenta/` + `tools/router.py` |

---

## 7. Open questions surfaced by research (resolved in design.md)

1. Where exactly does the new endpoint/service live, and what does it call? (design §2-3)
2. `delta` vs `data` (thread 01 D2) — design recommends `delta`. (design §4)
3. How does a useful validation message reach the model, given `callDirect` hides non-2xx
   bodies? (design §5 — return a 200 business-error result the model can read)
4. Should the tool re-merge for validation AND let core re-merge, or merge once? (design
   §3 — validate the would-be result, still pass `delta` to core so core stays the single
   merge authority against the same latest-revision base)
5. Draft fail-closed + generic binding error (thread 03 D1/D2) — preserved for free by
   staying on the direct-call path. (design §6)
