# Status

This is the source of truth for the project's progress, decisions, and open questions.

## Current state

- **Phase:** IMPLEMENTED (the lgtm'd two-syntax design #4837). Spun from PR #4821 review comment
  [3469653315](https://github.com/Agenta-AI/agenta/pull/4821#discussion_r3469653315).
- **Docs:** README, context, research, plan, status written, then revised twice on PR #4837.
  Iteration 2 simplified to one path branching on runnable-vs-not (dropped Option A/B, the
  `workflow` tool variant, platform-tools-as-workflows). **Iteration 3** (per the author's
  comment [3473648119](https://github.com/Agenta-AI/agenta/pull/4837#discussion_r3473648119))
  replaces the "infer runnable/not server-side in a resolve step" mechanism with **two syntaxes**:
  `@ag.embed` (inline the value) and a new `@ag.reference` (keep the reference). The author's
  syntax choice decides the behavior; the generic resolver stays tool-agnostic; the tool-specific
  logic lives in `resolve_tools`.
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

**A tool is just a workflow, pointed at via one of two syntaxes.** `tools[i]` carries either an
`@ag.embed` (inline the value) or an `@ag.reference` (keep the reference). Any workflow type
qualifies — agent, completion, channel, chain. There is **no `workflow` tool variant** and **no
"tool workflow" type**. **The author's syntax decides the behavior** (the decision is *not*
inferred server-side by inspecting the target):

- **`@ag.reference`** (new — for a runnable workflow you want to *call*). The generic resolver
  **leaves the reference in the config**. `resolve_tools` turns it into the existing **`callback`**
  executor — a `CallbackToolSpec` whose `call_ref` encodes the workflow identity, plus the shared
  `ToolCallback` to a server-side execute endpoint. The model's call routes back, the service
  invokes the workflow revision, the result returns. Connections/secrets stay server-side, exactly
  like a gateway tool. **No new runner `kind`.**
- **`@ag.embed`** (existing — for a non-runnable client tool that is a *value*). The generic
  resolver **resolves the reference into its value** — a concrete `client` tool config. By the
  time `resolve_tools` runs it is a plain `ClientToolConfig` and rides the existing `client` path
  (fulfilled in the browser next turn).

**The decision boundary:** the generic resolver (`ResolverMiddleware` + the API embed resolver)
knows only inline-the-value (`@ag.embed`) vs leave-the-reference (`@ag.reference`) and **nothing
about tools**; **`resolve_tools`** owns all tool-specific mapping (kept reference → callback spec;
embedded value → client spec).

Unifying rule for the sidecar: point at everything as a tool; a kept reference is run (the
callback executes the workflow), an embedded value is a concrete `client` tool config fulfilled in
the browser.

**Why `callback` for the reference case:** a referenced workflow tool is server-executed and may
use connections/secrets — exactly the gateway tool's safety shape. Resolving to a
`CallbackToolSpec` keeps every credential server-side and reuses the runner's existing callback
delivery (direct, Daytona relay, Pi native, Claude `agenta-tools` bridge).

**Explicitly dropped across iterations** (per the author's PR #4837 reviews):

- iteration 2: the Option A / Option B framing; the `WorkflowToolConfig` variant / the
  `"workflow"` `type` allowlist entry (a tool is just a workflow); **platform tools as workflows**
  (they go in the existing tools endpoints, like gateway, not the workflow catalog, so the
  `_validate_catalog` generalization is gone);
- iteration 3: inferring runnable/not server-side in a resolve step — replaced by the
  author-chosen syntax (`@ag.embed` vs `@ag.reference`).

## Settled by research

- The resolver is **generic and already walks `tools[]`** — embedding needs no resolver change,
  and the new `@ag.reference` syntax adds only a small "leave it" branch (no tool knowledge).
  (`ResolverMiddleware` + `api/oss/src/core/embeds/utils.py`.) This is the load-bearing finding
  and it survives the reframe.
- There is **no reference-only marker today** — `@ag.references` / `@ag.selector` are sub-keys
  inside an `@ag.embed`. The two-syntax model adds a new top-level `@ag.reference` marker.
- An `@ag.embed` resolves **before** `AgentConfig.from_params` and `resolve_tools` (so by tool
  resolution it is concrete); an `@ag.reference` is **deliberately kept** so `resolve_tools` sees
  it and builds the callback spec.
- The skills schema arm (`_SkillEmbedRefSchema`) is the template for the tools embed arm; the
  reference arm (`_ToolReferenceSchema`) is new and tools-only.

## Settled by the author (was open, now closed)

- **Where the tool-specific decision lives** — in **`resolve_tools`**, not a server-side resolve
  step that inspects the target. The generic resolver only does inline-vs-leave; the
  reference-vs-embed choice is the author's, encoded in the syntax. (Closes the old "where the
  runnable/not decision lives" question; resolves CodeRabbit's "intro reads settled but status
  treats it as open" flag.)

## Open questions for the user

1. **Tool-call to workflow-invoke contract** — how do the model's tool arguments map to the
   workflow's invoke inputs, and how does the workflow output map back to the tool result?
   Free-form passthrough, or a declared input/output schema?
2. **`call_ref` grammar for referenced workflow tools** — `workflow.{slug}` /
   `workflow.{slug}.{version}`? Today's gateway grammar
   (`tools.{provider}.{integration}.{action}.{connection}`) is Composio-specific and parsed in
   two places; a workflow tool needs its own opaque slug.
3. **The `@ag.reference` marker name/shape** — confirm the singular `@ag.reference` top-level
   marker reusing the inner `@ag.references` / `@ag.selector` block (same target-naming as
   `@ag.embed`, differing only in leave-vs-inline).
4. **Single shared callback endpoint vs per-spec callbacks** — `ResolvedToolSet` holds one
   `tool_callback`. With both gateway and workflow tools present, route one endpoint by
   `call_ref` prefix (smaller change, recommended) or grow the wire to per-spec callbacks?
5. **`is_tool` FE flag** — confirm it is deferred (later, display-only so referenced workflows
   surface in the tool picker) and not part of this slice.
6. **Approval / render axes** — a referenced or embedded tool can carry `needs_approval` and
   `render` like any tool; confirm no special handling is wanted (default: they compose as usual).

## Risks / watch-fors

- **One callback channel.** The single `tool_callback` is a real constraint if mixing tool
  types; the prefix-routing answer (Q4) avoids a wire change.
- **Reference the artifact** (`workflow.slug`), not a bare revision slug with no version
  (returns 500) — same gotcha skills have.
- **Two models, one contract.** The strict `AgentConfigSchema` and the permissive runtime
  `AgentConfig` must move together (and a golden fixture), per agent-config-schema.md's
  "watch for when changing."
- **New marker, two resolvers.** The `@ag.reference` marker must be recognized in **both** the
  SDK `ResolverMiddleware` and the API embed resolver, and both must agree to *leave it* (not
  inline). A miss in either inlines a reference and breaks the callback path.
- **Keep docs in sync** in the implementation PR: `documentation/tools.md`,
  `interfaces/public-edge/agent-config-schema.md`, and the interface inventory.
