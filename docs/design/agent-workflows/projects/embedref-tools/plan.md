# Plan

Let the agent config `tools` field accept a **reference to a workflow**, so any workflow can
be used as a tool. POC / pre-production: no back-compat.

## The model (one path, split by runnable vs not)

The old plan had two competing options (embed-as-content vs reference-as-tool) and a special
`workflow` tool variant. That was over-built. The simplified model the author landed on:

**A tool is just a referenced workflow.** You point `tools[i]` at a workflow (by reference,
not by inlining its config). What happens when the model calls it depends only on whether that
workflow is **runnable** (executable) or **not**.

- **Runnable** (a completion, an agent, a channel, a chain — anything the platform can
  invoke): you *reference* it because you want to *call* it. The model's call routes
  server-side and Agenta **runs the workflow revision**, exactly like a gateway tool. The
  sidecar relays the call back; the service invokes; the result returns to the model. Secrets
  and connections the workflow needs stay server-side.
- **Non-runnable** (a client tool — fulfilled in the browser, nothing to execute
  server-side): referencing-to-call does not apply. It is handled the way client tools are
  handled today. Its value is **resolved/embedded into the config** server-side (the resolve
  step in the service), and at run time the model's call is fulfilled client-side next turn,
  the existing `client` path.

So **what you reference decides the behavior**: runnable → server-side callback execute;
non-runnable → resolve-to-value + the existing client handling.

### Any workflow qualifies — there is no "tool workflow" type

An invocable tool *is* a workflow. There is no need for a workflow specially marked as a tool.
Any workflow type — agent, completion, channel, chain — can be referenced as a tool. We do
**not** add a `WorkflowToolConfig` variant.

Later (note only, out of scope here): add an `is_tool` flag on a workflow purely so the
frontend can list it in the tool picker. It is a display hint; it changes no runtime behavior.

### One unifying rule for the sidecar

Reference everything as a tool. **In the sidecar, if the referenced thing is runnable, run it;
if it is not runnable, return its schema** (instead of executing). That single rule covers
both cases without branching the wire by tool kind:

- runnable → the callback executes the workflow and returns the result;
- non-runnable → the callback (or the resolve step) returns the schema/value, and the model is
  fulfilled the client way.

## What the embed inlines into

The `@ag.embed` resolver is **already generic** and already walks `tools[]` (see
[research.md](research.md)) — this is the one genuinely-useful research finding and it still
holds. Embed resolution runs in the SDK `ResolverMiddleware` *before*
`AgentConfig.from_params` parses the config and *before* `resolve_tools` runs. So a reference
placed in `tools[i]` is resolved with **zero resolver changes**.

The split decides what the resolve step produces:

- **Runnable** → keep the reference. The config carries a workflow reference (slug, optional
  version) plus the model-facing surface (name, description, input schema). It resolves to the
  existing `callback` executor: a `CallbackToolSpec` whose `call_ref` encodes the workflow
  identity, plus the shared `ToolCallback` pointing at a server-side execute target. The runner
  needs **no new `kind`** — `callback` already dispatches everywhere (direct, Daytona relay, Pi
  native, the Claude `agenta-tools` bridge).
- **Non-runnable** → resolve to a value. The resolve step in the service turns the reference
  into a concrete `client` tool config (name, description, input schema). At run time it is the
  existing `client` path: the runner returns a `client` spec, the browser fulfills it next
  turn. No callback, no server-side execute.

Where the runnable/not decision is made: in the **service / the embed (resolve) step**, when
the reference is resolved. That is where we know what the referenced workflow is.

## Resolution path, end to end

```
author commits agent config with a workflow reference in tools[i]
        |
SDK ResolverMiddleware: _has_embed_markers(parameters) true (walks lists)
        |   POST {api}/workflows/revisions/resolve
API generic resolver + service resolve step: fetch the referenced workflow revision
        |
        |-- runnable?  -> keep the reference -> CallbackToolSpec(call_ref="workflow.<slug>")
        |                  + the shared ToolCallback to the execute target
        |
        '-- not runnable -> resolve to a concrete `client` tool config (name/desc/input_schema)
        v
_agent: AgentConfig.from_params(...) parses the now-resolved tools
        |
resolve_tools(agent_config.tools): callback spec for runnable; client spec for non-runnable
        v
/run wire: customTools[i] = {kind:"callback", callRef:"workflow.<slug>", ...} OR {kind:"client", ...}
        |
runner dispatch:
        |   callback -> model calls -> POST /tools/call -> API invokes the workflow revision
        |   client   -> returned to the browser, fulfilled next turn
        v
result -> back to the model
```

## The seams

| Seam | File | Change |
| --- | --- | --- |
| Strict schema arm | `sdks/python/agenta/sdk/utils/types.py` | add the embed-ref arm to `AgentConfigSchema.tools` (mirror `_SkillEmbedRefSchema`) so a referenced tool validates in the playground |
| Resolve step (runnable vs not) | service resolve step (where `@ag.embed`/references resolve) | decide runnable vs not for the referenced workflow; produce a callback-bound reference (runnable) or a concrete `client` config (non-runnable) |
| Runnable resolution branch | `sdks/python/agenta/sdk/agents/tools/resolver.py` + a platform resolver in `.../platform/` | a referenced runnable workflow resolves to a `CallbackToolSpec` + the shared `ToolCallback`, mirroring the gateway path |
| Server-side execute | `api/oss/src/apis/fastapi/tools/router.py` (+ core) | a `/tools/call`-style target that parses the `workflow.*` `call_ref`, invokes the referenced workflow revision with the model's arguments, and returns the result envelope |
| Embed resolver | `api/oss/src/core/embeds/utils.py` | **no change** — already walks `tools[]` |
| Wire | `services/agent/src/protocol.ts`, `sdks/python/agenta/sdk/agents/utils/wire.py`, golden fixtures | **no new field** — runnable rides as a `callback` spec, non-runnable as a `client` spec; only `call_ref` content is new |

`call_ref` grammar for a runnable workflow: an opaque slug, e.g. `workflow.{slug}` or
`workflow.{slug}.{version}`. Distinct from the Composio 5-segment grammar
(`tools.{provider}.{integration}.{action}.{connection}`). The runner treats `call_ref` as
opaque; only the server-side parser must agree. `ResolvedToolSet` keeps its single shared
`tool_callback`; if both gateway and workflow tools are present, one endpoint routes by
`call_ref` prefix (`tools.*` vs `workflow.*`) — the smaller change, keeps the wire stable.

## Out of scope (explicitly dropped from the old plan)

- **No `workflow` tool variant.** A referenced workflow is just a workflow; no
  `WorkflowToolConfig` in the discriminated union, no `"workflow"` `type` allowlist entry.
- **No platform tools as workflows.** Platform tools belong in the **existing tools
  endpoints** (the same place gateway tools are added), not in the workflow catalog. Drop the
  `_agenta.*` tool-workflow / `_validate_catalog` generalization direction entirely. (PR #4837
  review [3470356903](https://github.com/Agenta-AI/agenta/pull/4837#discussion_r3470356903).)
- **No Option A / Option B split.** There is one path; the only branch is runnable vs not.
- **`is_tool` flag** is a later, FE-only display hint — not built here.

## Test plan

- **SDK unit:** the embed-ref `tools` arm validates (mirror the skills schema test); a
  resolved runnable reference produces the expected `CallbackToolSpec` + `ToolCallback`; a
  resolved non-runnable reference produces a `client` spec.
- **Schema:** `AgentConfigSchema` JSON Schema emits the embed-ref `oneOf` arm in `tools`;
  `CATALOG_TYPES["agent_config"]` still dereferences.
- **Embed resolution (API/service):** a reference in `tools[i]` resolves to a callback-bound
  reference (runnable) or a concrete `client` config (non-runnable); cycle/depth guards hold.
- **Wire / golden:** a golden `/run` fixture with a runnable workflow tool (a `callback` spec)
  and one with a non-runnable (a `client` spec); `protocol.ts` Zod accepts both.
- **Execute endpoint:** a `/tools/call` with a `workflow.*` `call_ref` invokes the revision and
  returns the result; the workflow's secrets/connections stay server-side.
- **Live matrix (agent-workflows-qa):** force a runnable workflow tool with an unguessable
  token across pi_core / claude on local + Daytona + SDK; a pass proves it ran server-side and
  the result reached the model. Pin a green cell with agent-replay-test.

## Rollout

POC, no flag needed for the schema arm (additive; the resolver already handles it). The
execute endpoint is new server surface. Keep docs in sync in the same implementation PR
(`documentation/tools.md`, `interfaces/public-edge/agent-config-schema.md`, the interface
inventory).

## Build order (when implemented)

1. Schema arm — `tools` accepts a workflow reference (the embed-ref arm), validates in the
   playground.
2. Resolve step — decide runnable vs not; runnable → `CallbackToolSpec` + execute endpoint;
   non-runnable → concrete `client` config.
3. (Later, FE) `is_tool` flag so referenced workflows surface in the tool picker.
