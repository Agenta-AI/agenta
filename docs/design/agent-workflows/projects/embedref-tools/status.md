# Status

This is the source of truth for the project's progress, decisions, and open questions.

## Current state

- **Phase:** IMPLEMENTED (the lgtm'd two-syntax design #4837). Spun from PR #4821 review comment
  [3469653315](https://github.com/Agenta-AI/agenta/pull/4821#discussion_r3469653315).
- **Docs:** README, context, research, plan, status written, then **revised per the author's
  review on PR #4837** to the simplified runnable-vs-not model (Option A/B split, the
  `workflow` tool variant, and platform-tools-as-workflows all removed).
- **Built (this slice):**
  - SDK marker + config: `AG_REFERENCE_MARKER` and `ReferenceToolConfig`
    (`type: "reference"`, `slug`/`version`/`name`/`description`/`input_schema`, `.call_ref`
    `workflow.{slug}[.{version}]`) in `tools/models.py`; `compat.py` coerces the kept
    `@ag.reference` marker into it.
  - `resolve_tools` mapping: a new `WorkflowToolResolver` port + `AgentaWorkflowToolResolver`
    platform adapter (`platform/workflow.py`) build a `CallbackToolSpec` + the shared
    `ToolCallback`; `ToolResolver` partitions reference configs and reconciles the single
    callback with gateway. The generic resolver stays tool-agnostic.
  - Generic resolver "leave it" guard: `AG_REFERENCE_KEY` in `api/oss/src/core/embeds/utils.py`
    — all three finders treat a kept `@ag.reference` node as opaque (the SDK `_has_embed_markers`
    already ignores it, so an embed-free reference simply passes through).
  - Strict schema arms: `_ToolEmbedRefSchema` + `_ToolReferenceSchema` on
    `AgentConfigSchema.tools` (a union) in `utils/types.py`.
  - Server-side execute: `/tools/call` routes a `workflow.*` call_ref to `_call_workflow_tool`
    (`api/oss/src/apis/fastapi/tools/router.py`), which invokes the workflow revision via
    `WorkflowsService.invoke_workflow` (wired into `ToolsRouter` in `entrypoints/routers.py`).
  - Wire: UNCHANGED. A reference rides as a `callback` spec, an embed as a `client` spec; only the
    `call_ref` content (`workflow.*`) is new. Golden fixtures untouched.
  - Tests: SDK (parsing/models/resolver/platform/catalog) + API (embeds leave-it + router
    execute branch). Live end-to-end DEFERRED to the dedicated embedref live QA (after the gate).
- **Next:** CTO (JP) review of the PR; live end-to-end QA.

## Design

**A tool is just a referenced workflow.** `tools[i]` points at a workflow (by reference, not by
inlining its config). Any workflow type qualifies — agent, completion, channel, chain. There is
**no `workflow` tool variant** and **no "tool workflow" type**. The only branch is **runnable
vs non-runnable**, decided server-side in the resolve step where the referenced workflow is
known:

- **Runnable** (executable: completion / agent / channel / chain). You reference it *because
  you want to call it*. It resolves to the existing **`callback`** executor — a
  `CallbackToolSpec` whose `call_ref` encodes the workflow identity, plus the shared
  `ToolCallback` to a server-side execute endpoint. The model's call routes back, the service
  invokes the workflow revision, the result returns. Connections/secrets stay server-side,
  exactly like a gateway tool. **No new runner `kind`.**
- **Non-runnable** (a client tool). Referencing-to-call does not apply. The resolve step
  **resolves the reference into its value** — a concrete `client` tool config — and at run time
  it is the existing `client` path (fulfilled in the browser next turn).

Unifying rule: reference everything as a tool; **in the sidecar, if it is runnable, run it; if
it is not, return its schema.**

**Why `callback` for the runnable case:** a runnable workflow tool is server-executed and may
use connections/secrets — exactly the gateway tool's safety shape. Resolving to a
`CallbackToolSpec` keeps every credential server-side and reuses the runner's existing callback
delivery (direct, Daytona relay, Pi native, Claude `agenta-tools` bridge).

**Explicitly dropped from the first design** (per the author's PR #4837 review):

- the Option A / Option B framing (one path, branch on runnable);
- the `WorkflowToolConfig` variant / the `"workflow"` `type` allowlist entry (a tool is just a
  workflow);
- **platform tools as workflows** — they go in the **existing tools endpoints** (like gateway),
  not the workflow catalog, so the `_validate_catalog` generalization is gone.

## Settled by research

- The `@ag.embed` resolver is **generic and already walks `tools[]`** — no resolver change is
  needed for referencing. (`ResolverMiddleware` + `api/oss/src/core/embeds/utils.py`.) This is
  the load-bearing finding and it survives the simplification.
- Reference resolution runs **before** `AgentConfig.from_params` and `resolve_tools`, so by the
  time tools resolve, the reference is already concrete.
- The skills schema arm (`_SkillEmbedRefSchema`) is the exact template to mirror.

## Open questions for the user

1. **Where the runnable/not decision lives, precisely** — confirm it is the service resolve
   step (where the referenced workflow is fetched), so the SDK/runner stay schema-driven.
2. **Tool-call to workflow-invoke contract** — how do the model's tool arguments map to the
   workflow's invoke inputs, and how does the workflow output map back to the tool result?
   Free-form passthrough, or a declared input/output schema?
3. **`call_ref` grammar for runnable workflow tools** — `workflow.{slug}` /
   `workflow.{slug}.{version}`? Today's gateway grammar
   (`tools.{provider}.{integration}.{action}.{connection}`) is Composio-specific and parsed in
   two places; a workflow tool needs its own opaque slug.
4. **Single shared callback endpoint vs per-spec callbacks** — `ResolvedToolSet` holds one
   `tool_callback`. With both gateway and workflow tools present, route one endpoint by
   `call_ref` prefix (smaller change, recommended) or grow the wire to per-spec callbacks?
5. **`is_tool` FE flag** — confirm it is deferred (later, display-only so referenced workflows
   surface in the tool picker) and not part of this slice.
6. **Approval / render axes** — a referenced tool can carry `needs_approval` and `render` like
   any tool; confirm no special handling is wanted (default: they compose as usual).

## Risks / watch-fors

- **One callback channel.** The single `tool_callback` is a real constraint if mixing tool
  types; the prefix-routing answer (Q4) avoids a wire change.
- **Reference the artifact** (`workflow.slug`), not a bare revision slug with no version
  (returns 500) — same gotcha skills have.
- **Two models, one contract.** The strict `AgentConfigSchema` and the permissive runtime
  `AgentConfig` must move together (and a golden fixture), per agent-config-schema.md's
  "watch for when changing."
- **Keep docs in sync** in the implementation PR: `documentation/tools.md`,
  `interfaces/public-edge/agent-config-schema.md`, and the interface inventory.
