# Research

How `skills` embedding works today, the tool taxonomy, and the exact seams to mirror for
`tools` — under the **two-syntax** model (embed vs reference). Everything below is grounded in
the current code; file paths are absolute-from-repo.

## Part 1 — How `@ag.embed` embedding works (the skills case), and what `@ag.reference` adds

### There is no `EmbedRef` model — an embed is a structural marker

An embed is a plain dict whose marker key is `@ag.embed`, recognized by a recursive walker.
There is no dedicated Pydantic class for it on the runtime path.

- SDK marker: `sdks/python/agenta/sdk/middlewares/running/resolver.py` —
  `_AG_EMBED_MARKER = "@ag.embed"`.
- API markers: `api/oss/src/core/embeds/utils.py` —
  `AG_EMBED_KEY = "@ag.embed"`, `AG_REFERENCES_KEY = "@ag.references"`,
  `AG_SELECTOR_KEY = "@ag.selector"`.

**Confirmed: there is no reference-only marker today.** `@ag.references` and `@ag.selector` are
strictly **sub-keys inside an `@ag.embed` block** — they are not standalone top-level markers,
and the embed resolver always *inlines* the resolved value. The two-syntax model needs a **new
top-level marker** (e.g. `@ag.reference`, singular) that the same recursive walker recognizes but
treats as "leave in place" instead of "inline." It reuses the same inner `@ag.references` /
`@ag.selector` shape to name the target; only the inline-vs-leave behavior differs.

The canonical object-embed shape (the form `skills` uses):

```jsonc
{
  "@ag.embed": {
    "@ag.references": { "workflow": { "slug": "_agenta.agenta-getting-started" } },
    "@ag.selector":   { "path": "parameters.skill" }
  }
}
```

`@ag.references` is `Dict[str, Reference]` keyed by entity type (`workflow`,
`workflow_revision`, ...). The inner `Reference` / `Selector` DTOs are in
`sdks/python/agenta/sdk/models/shared.py` (`Reference(id, slug, version)`,
`Selector(key, path)`). A bare `workflow` key is an **artifact-level** lookup (latest
revision); the comment in the default-config builder is load-bearing: referencing the
artifact (`workflow.slug`) resolves to the latest revision, while a bare *revision* slug with
no version returns 500.

### The resolver is generic and runs BEFORE the agent handler

Two layers:

1. **SDK middleware** — `sdks/python/agenta/sdk/middlewares/running/resolver.py`.
   `ResolverMiddleware.__call__` checks `_has_embed_markers(parameters)` (recursive: descends
   dicts, **lists**, and strings) and, if any embed is present and the `resolve` flag is on,
   POSTs `parameters` to `{api}/workflows/revisions/resolve` and replaces them with the
   resolved result. Its own comment says: *"The embed resolver walks arrays, so an
   `@ag.embed` inside `parameters.skills[i]` resolves on either path."* The same is true of
   `parameters.tools[i]`. Under the two-syntax model the marker check also recognizes
   `@ag.reference`, but the resolve pass **leaves that node untouched** (inline-vs-leave is the
   only difference); the walk and the list-descent are unchanged.

2. **API generic resolver** — `api/oss/src/core/embeds/utils.py`, `resolve_embeds(...)`.
   It deep-copies the config and loops up to `max_depth`, each pass calling
   `find_object_embeds(...)` (a recursive walker that records an `ObjectEmbed{location,
   references, selector}` for every dict carrying `@ag.embed`, and **recurses into list items
   and dict values otherwise**). For each embed it: resolves the references via a callback,
   applies the `@ag.selector` `path` to the resolved revision's `data`
   (`_extract_with_sdk_resolver`, using the SDK `resolve_any`), and `set_path(...)`
   substitutes the extracted value back at the embed's location. Cycle / depth / count
   guards exist (`CircularEmbedError`, `MaxDepthExceededError`, `MaxEmbedsExceededError`).

The resolver callback routes a `workflow` reference to
`workflows_service.fetch_workflow_revision(...)` (`api/oss/src/core/embeds/service.py` wires
`EmbedsService` to the same catalog-aware `WorkflowsService`).

**Ordering in the agent run path** (`services/oss/src/agent/app.py`, `_agent`):

1. Resolution — done by the SDK middleware against `parameters`, before `_agent` is even
   called. `@ag.embed` nodes are inlined to their value; `@ag.reference` nodes are **left in
   place**.
2. `agent_config = AgentConfig.from_params(params, ...)` — parses the config. An inlined
   `@ag.embed` is now a concrete tool config; a kept `@ag.reference` parses as the reference arm.
3. `resolved_tools = await resolve_tools(agent_config.tools)` — sees concrete tool configs **and**
   any kept `@ag.reference` arms.

**Implication:** an `@ag.embed` in `tools[i]` is inlined at step 1 with only a tiny resolver
addition (the "leave it" branch for the sibling `@ag.reference` marker — embed inlining itself is
unchanged). A kept `@ag.reference` survives to step 3, where `resolve_tools` does the
tool-specific mapping. The work is two schema arms (step 2) plus the `resolve_tools` reference arm
(step 3); the generic resolver gains only the "leave it" branch.

### The `_agenta.*` platform catalog short-circuit (background only)

`api/oss/src/core/workflows/platform_catalog.py` defines `PlatformWorkflowCatalog`, a
code-defined, read-only set of platform workflows keyed by a reserved `_agenta.*` slug.
`WorkflowsService.fetch_workflow_revision` calls `_resolve_platform_revision` *first*; a
reserved slug never falls through to Postgres. This is how the default skill embed resolves
(`_agenta.agenta-getting-started`).

**Not relevant to this design's scope.** Per the PR #4837 review, platform *tools* do **not**
go in this catalog — they belong in the existing tools endpoints (like gateway). So this design
does **not** touch `_validate_catalog` (which today validates catalog payloads as `SkillConfig`)
and does not ship `_agenta.*` tool workflows. User-authored workflows referenced as tools live
in the DB and never hit this validation.

### Where the union lives (skills, the template to copy)

- Runtime `AgentConfig.skills`: `sdks/python/agenta/sdk/agents/dtos.py` —
  `skills: List[SkillConfig]` (NOT a union; embeds are already resolved by the time it
  parses). A `@field_validator("skills", mode="before")` coerces.
- Strict `AgentConfigSchema.skills`: `sdks/python/agenta/sdk/utils/types.py` —
  `List[Union["SkillConfigSchema", "_SkillEmbedRefSchema"]]`. The embed arm is
  `_SkillEmbedRefSchema` with `embed: Dict[str, Any] = Field(alias="@ag.embed")` and
  `extra="forbid"`. This is the exact arm to mirror for the tools **embed** arm. Tools add one
  more arm — a `_ToolReferenceSchema` with `reference: Dict[str, Any] = Field(alias="@ag.reference")`
  — for the kept-reference syntax. Skills do not need it (a skill is always a value).
- Default config: `build_agent_v0_default(...)` in
  `sdks/python/agenta/sdk/utils/types.py` ships the skill `@ag.embed` block.

## Part 2 — The tool taxonomy (what each syntax must become)

### Two lives, three axes

`documentation/tools.md` is the canonical reference. A tool has a **declared config**
(`AgentConfig.tools`, portable, no secrets) and a **resolved spec** (the `/run` wire, secrets
injected, endpoints filled). Three orthogonal axes: **executor** (`type` at config time,
`kind` at runtime), **`needs_approval`**, **`render`**.

Declared `type` -> resolved `kind`:

| Declared `type` | Resolved form | Resolved `kind` | Who executes / where |
| --- | --- | --- | --- |
| `builtin` | a bare name | (none) | the harness, natively |
| `gateway` | `CallbackToolSpec` + `call_ref` | `callback` | the Agenta service, via `POST /tools/call` |
| `code` | `CodeToolSpec` + `env` | `code` | the runner, local subprocess |
| `client` | `ClientToolSpec` | `client` | the browser, next turn |

Models: `sdks/python/agenta/sdk/agents/tools/models.py`
(`ToolConfigBase`, the four `*ToolConfig`, the `ToolConfig = Annotated[Union[...],
Field(discriminator="type")]`, and the resolved `CallbackToolSpec` / `CodeToolSpec` /
`ClientToolSpec` discriminated by `kind`; `ResolvedToolSet{builtin_names, tool_specs,
tool_callback}`). The TS twin is `ResolvedToolSpec` in `services/agent/src/protocol.ts`.

### How resolution + dispatch work

- SDK `ToolResolver.resolve` (`sdks/python/agenta/sdk/agents/tools/resolver.py`) partitions
  configs by `isinstance`, resolves code secrets via a `ToolSecretProvider`, resolves gateway
  configs via a `GatewayToolResolver` (which returns the `CallbackToolSpec` list **and** the
  single shared `ToolCallback`), and returns a `ResolvedToolSet`.
- Platform composition `resolve_tools` (`sdks/python/agenta/sdk/agents/platform/resolve.py`)
  wires the Agenta adapters (`AgentaNamedSecretProvider`, `AgentaGatewayToolResolver`).
- The gateway adapter (`sdks/python/agenta/sdk/agents/platform/gateway.py`) POSTs to
  `POST /tools/resolve`, gets a `call_ref` slug
  `tools.{provider}.{integration}.{action}.{connection}`, wraps each in a `CallbackToolSpec`,
  and assembles one `ToolCallback(endpoint="{api}/tools/call", authorization=...)`.
- Runner dispatch `runResolvedTool` (`services/agent/src/tools/dispatch.ts`) branches on
  `kind`: `code` runs locally; `client` throws (browser-fulfilled); **`callback` (default)
  POSTs back to `/tools/call`** (directly, or via the Daytona file relay). Absent `kind`
  defaults to `callback`.

### Why `callback` for `@ag.reference` and `client` for `@ag.embed`

The branch is the **author's syntax** (see [plan.md](plan.md)), and the taxonomy already has a
home for each:

- An **`@ag.reference`** workflow tool is **server-executed**: calling it means invoking another
  Agenta workflow revision, which lives behind the API and may itself use connections and
  secrets. That is exactly the gateway tool's safety shape — the harness decides *which* tool and
  *with what arguments*, the service runs it, and no credential reaches the sandbox. So
  `resolve_tools` maps it to a `CallbackToolSpec`. The runner needs **no new `kind`** — `callback`
  already dispatches to `callAgentaTool`, works under the Daytona file relay, and is delivered to
  both Pi (native) and Claude (the `agenta-tools` MCP bridge). The only difference from a gateway
  tool is the `call_ref` grammar and the execute target: instead of a Composio action, the
  service invokes a workflow revision. **Crucially, the reference is *not* inlined before
  `resolve_tools` runs** — that is the whole point of the second syntax: the generic resolver
  leaves it, so `resolve_tools` sees the kept reference (slug + version + the model-facing
  surface) and builds the callback spec from it. The callback path never needs the *resolved
  workflow artifact* at config time; it carries only the identity (`call_ref`) and resolves the
  revision lazily, server-side, when the model actually calls the tool.
- An **`@ag.embed`** (client) workflow tool fits the existing **`client`** executor: the generic
  resolver inlines the reference into a concrete `client` tool config *before* `resolve_tools`
  runs, so `resolve_tools` sees a plain `ClientToolConfig` and the runner returns a `client` spec
  for the browser to fulfill next turn (`models.py:206` — `kind: "client"`). No callback, no
  server-side execute.

This is what the earlier "keep the reference but it's already inlined" tension was about: with a
single `@ag.embed` syntax, a tool could not both stay a reference for callback resolution *and* be
inlined before `resolve_tools`. The two-syntax model removes the contradiction — embed inlines,
reference is kept — so each path sees exactly the form it needs.

## Part 3 — The seams to touch (summary)

| Seam | File | Change |
| --- | --- | --- |
| Strict schema arms | `sdks/python/agenta/sdk/utils/types.py` | add `_ToolEmbedRefSchema` (alias `@ag.embed`) **and** `_ToolReferenceSchema` (alias `@ag.reference`); make `AgentConfigSchema.tools` a `Union[ToolConfig-twin, _ToolEmbedRefSchema, _ToolReferenceSchema]` (the embed arm mirrors skills; the reference arm is new) |
| Generic resolver "leave it" branch | SDK `ResolverMiddleware` + `api/oss/src/core/embeds/utils.py` | recognize the new `@ag.reference` marker and **leave it in place** (inline only `@ag.embed`). Tool-agnostic — no tool knowledge added |
| `resolve_tools` reference arm | `sdks/python/agenta/sdk/agents/tools/resolver.py` + a platform resolver in `.../platform/` | partition out a kept `@ag.reference`; resolve it to a `CallbackToolSpec` + a `ToolCallback` to the new execute endpoint (mirror gateway). The embed case arrives as a plain `ClientToolConfig` — no new arm |
| Server-side execute | `api/oss/src/apis/fastapi/tools/router.py` (+ core) | a `/tools/call`-style target that invokes the referenced workflow revision and returns the result |
| Wire | `services/agent/src/protocol.ts`, `sdks/python/agenta/sdk/agents/utils/wire.py`, golden fixtures | **no new field** — a reference rides as a `callback` spec, an embed as a `client` spec; only the `call_ref` content is new |
| Docs | `documentation/tools.md`, `interfaces/public-edge/agent-config-schema.md`, the interface inventory | document both syntaxes + the syntax-decides-behavior model |

No `WorkflowToolConfig` variant, no `compat.py` `"workflow"` allowlist entry, no
platform-catalog change — all dropped per the PR #4837 review.

## Open research questions (carried into the plan)

1. **The `@ag.reference` marker shape** — confirm it reuses the inner `@ag.references` /
   `@ag.selector` block (same target-naming as `@ag.embed`) and differs only in the "leave it"
   behavior; confirm the singular `@ag.reference` name.
2. **What does invoking the workflow mean** — call `/workflows/.../invoke` with the model's
   arguments as inputs, and map the workflow output back as the tool result? What is the
   input/output contract between a tool call and a workflow invoke?
3. **The `call_ref` grammar** for a runnable workflow tool (today's 5-segment gateway grammar
   is Composio-specific and parsed in both `compat.py` and the API router).
