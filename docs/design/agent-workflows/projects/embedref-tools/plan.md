# Plan

The proposed change to let `tools` accept an `@ag.embed` reference and turn an embedded
workflow into a callable tool. POC / pre-production: no back-compat.

The plan has two layers, because "embedref like skills" can mean two genuinely different
things. The recommended design is **Option B** (reference-as-tool); **Option A**
(embed-as-content) is the cheaper first step and is fully compatible as a stepping stone.
Both are detailed; the open questions in [status.md](status.md) decide which we build first.

## Option A — Embed-as-content (cheapest, reuses everything)

An embed in `tools` inlines a **concrete, already-supported tool config** that an author
committed inside a workflow's parameters. The workflow is just a reusable container for a
tool declaration.

How it works:

1. Schema: add the embed-ref arm to `tools` (the only required code change shared by both
   options). In `sdks/python/agenta/sdk/utils/types.py`, add `_ToolEmbedRefSchema` (copy of
   `_SkillEmbedRefSchema`) and make `AgentConfigSchema.tools` a
   `List[Union[ToolConfig, _ToolEmbedRefSchema]]`.
2. Authoring: a tool workflow stores a tool config under `data.parameters.tool`, e.g.
   `{"tool": {"type": "gateway", "provider": "composio", ...}}`.
3. Embed: the agent config references it:
   ```jsonc
   { "@ag.embed": { "@ag.references": { "workflow": { "slug": "my-github-issue-tool" } },
                    "@ag.selector": { "path": "parameters.tool" } } }
   ```
4. Resolution: the **generic resolver inlines it** into a concrete `gateway`/`code`/`client`
   config at `tools[i]`. `resolve_tools` then resolves it on the existing path. **No new tool
   variant, no new executor, no wire change, no runner change.**

What it buys: reuse and versioning of a tool declaration across agents. What it does not buy:
a tool whose *body is itself a workflow* — it can only inline tool types we already run.

This is the smallest possible "embedref like skills" and is almost free (one schema arm).

## Option B — Reference-as-tool (the real "tools as workflows")

The embedded workflow is **not** a tool config; it is a workflow that *becomes* a tool. When
the model calls the tool, Agenta **invokes that workflow revision** with the model's arguments
and returns its output as the tool result. This is what "creating tools as workflows" most
naturally means: any workflow (a prompt, a chain, an evaluator-style step) is exposed to the
agent as a single callable tool.

### B1 — New tool variant `workflow`

In `sdks/python/agenta/sdk/agents/tools/models.py`, add to the discriminated union:

```python
class WorkflowToolConfig(ToolConfigBase):
    type: Literal["workflow"] = "workflow"
    name: str = Field(min_length=1)            # the tool name the model calls
    description: Optional[str] = None          # what the tool does (for the model)
    input_schema: Dict[str, Any] = Field(default_factory=_empty_object_schema)
    # the referenced workflow (filled by the embed inline, or authored directly):
    workflow_slug: str = Field(min_length=1)
    workflow_version: Optional[str] = None     # None = latest revision
```

and add `"workflow"` to the accepted `type` set in `compat.py`.

### B2 — What the embed inlines into

The selector path extracts a small ref payload from the workflow revision's parameters and the
generic resolver substitutes it into a `WorkflowToolConfig` shape at `tools[i]`. Two
sub-options for the selector target (an open question):

- **(b2-i)** The workflow stores a ready tool surface under `parameters.tool`
  (`{name, description, input_schema, workflow_slug}`), mirroring how skills store
  `parameters.skill`. The selector path is `parameters.tool`. Cleanest parallel to skills.
- **(b2-ii)** The embed inlines the *whole revision identity* and the resolver/config derives
  the tool surface (name/description from the workflow metadata, input schema from the
  workflow's declared inputs). Less authoring, more inference.

Recommendation: **(b2-i)** for symmetry with skills and to keep the tool's model-facing
surface explicit and reviewable.

### B3 — Resolution to a `callback` spec

A `WorkflowToolConfig` resolves to the existing `CallbackToolSpec` (resolved `kind:
"callback"`), so the runner needs no new `kind`. Mirror the gateway path:

- Add a branch in `ToolResolver.resolve` (or, cleaner, a new injected resolver
  `WorkflowToolResolver` alongside `GatewayToolResolver`) that turns workflow tool configs
  into `CallbackToolSpec`s and one `ToolCallback`.
- The `call_ref` encodes the workflow identity. Propose a distinct grammar from the
  Composio 5-segment one, e.g. `workflow.{slug}` or `workflow.{slug}.{version}` (open
  question — see status.md). The runner treats `call_ref` as opaque, so only the server-side
  parser must agree.
- The `ToolCallback` endpoint points at the execute target (B4).

`ResolvedToolSet` holds a **single** `tool_callback`. If both gateway and workflow tools are
present in one config, either (a) they share one endpoint that routes by `call_ref` prefix
(`tools.*` vs `workflow.*`), or (b) `ResolvedToolSet`/the wire grows per-spec callbacks. The
single-shared-endpoint route (a) is the smaller change and keeps the wire stable.

### B4 — Server-side execute endpoint

A `/tools/call`-style target (extend `api/oss/src/apis/fastapi/tools/router.py` + core) that:

1. Parses the `workflow.*` `call_ref` into a workflow slug/version.
2. Maps the model's tool-call arguments to the workflow invoke inputs.
3. Invokes the referenced workflow revision (the same invoke path the platform already uses;
   reserved `_agenta.*` slugs short-circuit to the catalog).
4. Maps the workflow output back to the tool result envelope `{call:{data:{content}}}` the
   runner expects (`callback.ts` reads `parsed.call.data.content`).

Connections and secrets the workflow needs are resolved **server-side** during that invoke,
exactly like a gateway tool — nothing reaches the sandbox. This is the central safety
property and the reason `callback` is the right executor.

### B5 — Wire and runner

No new `/run` field. A workflow tool rides the wire as a `callback` `ResolvedToolSpec` with a
`workflow.*` `callRef` and the shared `toolCallback`. The runner dispatch, the Daytona relay,
the Pi native delivery, and the Claude `agenta-tools` bridge all already handle `callback`.
Golden fixtures gain a workflow-tool example; `protocol.ts` and `wire.py` are unchanged in
shape (only fixture content changes).

### B6 — Platform tool workflows (optional, later)

To ship an `_agenta.*` platform tool workflow, generalize `_validate_catalog` in
`api/oss/src/core/workflows/platform_catalog.py` (today it hard-validates every payload as
`SkillConfig`). Store the tool payload under `parameters.tool`. User-authored DB tool
workflows do not need this; they are not in the catalog.

## Resolution path, end to end (Option B)

```
author commits agent config with an @ag.embed in tools[i]
        |
SDK ResolverMiddleware: _has_embed_markers(parameters) is true (walks lists)
        |   POST {api}/workflows/revisions/resolve
API generic resolver: find_object_embeds -> fetch_workflow_revision(slug)
        |   selector path "parameters.tool" -> WorkflowToolConfig payload
        |   set_path substitutes it into parameters.tools[i]
        v
_agent: AgentConfig.from_params(...) parses the inlined WorkflowToolConfig
        |
resolve_tools(agent_config.tools):
        |   WorkflowToolResolver -> CallbackToolSpec(call_ref="workflow.<slug>") + ToolCallback
        v
/run wire: customTools[i] = {kind:"callback", callRef:"workflow.<slug>", ...}, toolCallback
        |
runner dispatch (callback): model calls the tool -> POST /tools/call (or Daytona relay)
        v
API execute: parse workflow.* call_ref -> invoke workflow revision with args -> result
        |
result -> {call:{data:{content}}} -> back to the model
```

## Test plan

- **SDK unit:** `WorkflowToolConfig` parses (strict + loose coercion); `_ToolEmbedRefSchema`
  validates an embed-ref `tools` entry; `WorkflowToolResolver` produces the expected
  `CallbackToolSpec` + `ToolCallback`.
- **Schema:** `AgentConfigSchema` JSON Schema emits the embed-ref `oneOf` arm in `tools`
  (mirror the skills schema test); `CATALOG_TYPES["agent_config"]` still dereferences.
- **Embed resolution (API):** an `@ag.embed` in `tools[i]` inlines into a `WorkflowToolConfig`
  (Option B) or a concrete tool config (Option A); cycle/depth guards still hold.
- **Wire / golden:** a golden `/run` fixture with a workflow tool; `protocol.ts` Zod accepts
  it as a `callback` spec.
- **Execute endpoint:** a `/tools/call` with a `workflow.*` `call_ref` invokes the revision
  and returns the result; a user workflow's secrets/connections stay server-side.
- **Live matrix (agent-workflows-qa):** force the tool with an unguessable token across
  pi_core / claude on local + Daytona + SDK; a pass proves the workflow ran server-side and
  the result reached the model. Pin a green cell with agent-replay-test.

## Rollout

POC, off no flag needed for the schema arm (it is additive and the resolver already handles
it). The execute endpoint is new surface; gate platform tool workflows (B6) behind the
existing reserved-namespace trust, not a feature flag. Keep docs in sync in the same
implementation PR (tools.md, agent-config-schema.md, the interface inventory).

## Build order (when implemented)

1. Option A schema arm (the shared, almost-free win) — `tools` accepts `@ag.embed`,
   inlining concrete tool configs. Ships value immediately, validates the embedding half.
2. Option B variant + resolver + execute endpoint — tools-as-workflows proper.
3. Option B6 platform tool workflows (catalog validation generalization) if/when wanted.
