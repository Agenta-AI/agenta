# Research

How `skills` embedding works today, the tool taxonomy, and the exact seams to mirror for
`tools`. Everything below is grounded in the current code; file paths are absolute-from-repo.

## Part 1 — How `@ag.embed` embedding works (the skills case)

### There is no `EmbedRef` model — an embed is a structural marker

An embed is a plain dict whose marker key is `@ag.embed`, recognized by a recursive walker.
There is no dedicated Pydantic class for it on the runtime path.

- SDK marker: `sdks/python/agenta/sdk/middlewares/running/resolver.py` —
  `_AG_EMBED_MARKER = "@ag.embed"`.
- API markers: `api/oss/src/core/embeds/utils.py` —
  `AG_EMBED_KEY = "@ag.embed"`, `AG_REFERENCES_KEY = "@ag.references"`,
  `AG_SELECTOR_KEY = "@ag.selector"`.

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
   `parameters.tools[i]`.

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

1. Embed resolution — already done by the SDK middleware against `parameters`, before
   `_agent` is even called.
2. `agent_config = AgentConfig.from_params(params, ...)` — parses the *now-inlined* config.
3. `resolved_tools = await resolve_tools(agent_config.tools)` — sees only concrete,
   embed-free tool configs.

**Implication:** an `@ag.embed` in `tools[i]` is inlined at step 1 with no resolver change.
By step 3 it is a concrete tool config. The work is making steps 2-3 (and the schema)
understand *what* it inlines into.

### The `_agenta.*` platform catalog short-circuit

`api/oss/src/core/workflows/platform_catalog.py` defines `PlatformWorkflowCatalog`, a
code-defined, read-only set of platform workflows keyed by a reserved `_agenta.*` slug.
`WorkflowsService.fetch_workflow_revision` calls `_resolve_platform_revision` *first*; a
reserved slug never falls through to Postgres. Each catalog version stores its payload under
`data.parameters.<key>` — for skills that key is `skill`
(`parameters={"skill": skill_config...}`), which is why the skill embed's selector path is
`parameters.skill`.

One hard constraint to note: `_validate_catalog` currently validates **every** catalog
payload as a `SkillConfig` (`SkillConfig.model_validate(payload)`). To ship a *platform* tool
workflow, that validation must generalize per payload kind. (User-authored tool workflows
live in the DB and do not hit this validation.)

### Where the union lives (skills, the template to copy)

- Runtime `AgentConfig.skills`: `sdks/python/agenta/sdk/agents/dtos.py` —
  `skills: List[SkillConfig]` (NOT a union; embeds are already resolved by the time it
  parses). A `@field_validator("skills", mode="before")` coerces.
- Strict `AgentConfigSchema.skills`: `sdks/python/agenta/sdk/utils/types.py` —
  `List[Union["SkillConfigSchema", "_SkillEmbedRefSchema"]]`. The embed arm is
  `_SkillEmbedRefSchema` with `embed: Dict[str, Any] = Field(alias="@ag.embed")` and
  `extra="forbid"`. This is the exact arm to mirror for tools.
- Default config: `build_agent_v0_default(...)` in
  `sdks/python/agenta/sdk/utils/types.py` ships the skill `@ag.embed` block.

## Part 2 — The tool taxonomy (what an embedded tool must become)

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

### Why `callback` is the right executor for an embedded-workflow tool

A workflow tool is **server-executed**: calling it means invoking another Agenta workflow
revision, which lives behind the API and may itself use connections and secrets. That is
exactly the gateway tool's safety shape — the harness decides *which* tool and *with what
arguments*, the service runs it, and no credential reaches the sandbox. So an
embedded-workflow tool should resolve to a `CallbackToolSpec`:

- The runner needs **no new `kind`** — `callback` already dispatches to `callAgentaTool`,
  works under the Daytona file relay, and is delivered to both Pi (native) and Claude (the
  `agenta-tools` MCP bridge).
- The only thing that differs from a gateway tool is the `call_ref` grammar and the
  server-side execute target: instead of running a Composio action, the service invokes a
  workflow revision.

## Part 3 — The seams to touch (summary)

| Seam | File | Change |
| --- | --- | --- |
| Strict schema embed arm | `sdks/python/agenta/sdk/utils/types.py` | add `_ToolEmbedRefSchema`, make `AgentConfigSchema.tools` a `Union[ToolConfig-twin, _ToolEmbedRefSchema]` (mirror skills) |
| New tool variant | `sdks/python/agenta/sdk/agents/tools/models.py` | add `WorkflowToolConfig(type="workflow")` to the union, carrying the workflow ref + tool surface (name, description, input schema) |
| Loose coercion allowlist | `sdks/python/agenta/sdk/agents/tools/compat.py` | add `"workflow"` to the accepted `type` set |
| Resolution branch | `sdks/python/agenta/sdk/agents/tools/resolver.py` + a new platform resolver in `.../platform/` | resolve a `WorkflowToolConfig` to a `CallbackToolSpec` + a `ToolCallback` to the new execute endpoint |
| Server-side execute | `api/oss/src/apis/fastapi/tools/router.py` (+ core) | a `/tools/call`-style target that invokes the referenced workflow revision and returns the result |
| Embed resolver | `api/oss/src/core/embeds/utils.py` | **no change** — already walks `tools[]` |
| Platform catalog validation | `api/oss/src/core/workflows/platform_catalog.py` | generalize `_validate_catalog` IF we ship a platform tool workflow (otherwise unchanged for user workflows) |
| Wire | `services/agent/src/protocol.ts`, `sdks/python/agenta/sdk/agents/utils/wire.py`, golden fixtures | **no new field** if it resolves to an existing `callback` spec; only the `call_ref` value differs |
| Docs | `documentation/tools.md`, `interfaces/public-edge/agent-config-schema.md`, the interface inventory | document the new variant + the embed arm |

## Open research questions (carried into the plan)

1. **Embed-as-content vs reference-as-tool.** The selector path could inline either a
   *concrete tool config* (e.g. a `code`/`gateway` config stored in the workflow's
   parameters — pure reuse, no new variant, no new executor) OR a *workflow reference* that
   becomes a new `workflow` tool variant (a tool that, when called, runs the workflow). Both
   are "embedref like skills." They are very different in cost and meaning. See
   [status.md](status.md#key-decision).
2. **What does invoking the workflow mean** — call `/workflows/.../invoke` with the model's
   arguments as inputs, and map the workflow output back as the tool result? What is the
   input/output contract between a tool call and a workflow invoke?
3. **The `call_ref` grammar** for a workflow tool (today's 5-segment gateway grammar is
   Composio-specific and parsed in both `compat.py` and the API router).
4. **Platform tool workflows** — do we want `_agenta.*` platform tools (needs the catalog
   validation generalization), or only user-authored DB workflows at first?
