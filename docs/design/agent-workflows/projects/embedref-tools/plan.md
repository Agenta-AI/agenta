# Plan

Let the agent config `tools` field point at a **workflow** via one of two syntaxes — embed or
reference — so any workflow can be used as a tool. POC / pre-production: no back-compat.

## The model: two syntaxes, the syntax decides the behavior

The old plan had two competing options (embed-as-content vs reference-as-tool) and a special
`workflow` tool variant. That was over-built. An earlier revision then said "the resolver inlines
everything and the runnable/not decision is made server-side in a resolve step." Per the author's
review ([3473648119](https://github.com/Agenta-AI/agenta/pull/4837#discussion_r3473648119)) that
is also not the right shape: don't infer the behavior server-side by inspecting the target. Use
**two syntaxes** and let the author's choice decide.

**A tool is just a workflow.** You point `tools[i]` at a workflow with one of two markers:

- **`@ag.reference`** (new) — keep the reference. You reference a workflow *because you want to
  call it* (a completion, an agent, a channel, a chain — anything the platform can run). The
  generic resolver **leaves the reference in the config** (it does not inline it). `resolve_tools`
  later turns the kept reference into a `CallbackToolSpec`: the model's call routes server-side
  and Agenta **runs the workflow revision**, exactly like a gateway tool. The sidecar relays the
  call back; the service invokes; the result returns to the model. Secrets and connections the
  workflow needs stay server-side.
- **`@ag.embed`** (existing) — inline the value. You embed when the referenced thing is a
  non-runnable client tool: there is nothing to call server-side. The generic resolver
  **resolves the reference into its value** — a concrete `client` tool config (name, description,
  input schema). `resolve_tools` sees that concrete config and produces a `client` spec; at run
  time the model's call is fulfilled client-side next turn, the existing `client` path.

So **the syntax decides the behavior**: `@ag.reference` → server-side callback execute;
`@ag.embed` → inline-to-value + the existing client handling. The author makes this choice at
config-authoring time. It maps to runnable-vs-not (reference a runnable workflow you want to call;
embed a non-runnable client tool that is a value), but the design does **not** inspect the target
to decide — the marker is authoritative.

### The decision boundary: generic resolver vs `resolve_tools`

The clean separation the author asked for:

- The **generic resolver** (SDK `ResolverMiddleware` + the API embed resolver) knows only two
  operations and **nothing about tools**: inline the value (`@ag.embed`) or leave the reference
  (`@ag.reference`). It is the same recursive walker that already handles skills; it gains one
  "leave it" branch for the reference syntax.
- **`resolve_tools`** (where tool configs are already partitioned by type) owns all
  tool-specific logic: a kept `@ag.reference` becomes a `CallbackToolSpec` + the shared
  `ToolCallback`; an `@ag.embed`-resolved concrete `client` config becomes a `client` spec.

This keeps embedding/referencing reusable for any field (skills, tools, future fields) while the
"these are tools" knowledge stays in one place.

### Any workflow qualifies — there is no "tool workflow" type

An invocable tool *is* a workflow. There is no need for a workflow specially marked as a tool.
Any workflow type — agent, completion, channel, chain — can be referenced as a tool. We do
**not** add a `WorkflowToolConfig` variant.

Later (note only, out of scope here): add an `is_tool` flag on a workflow purely so the
frontend can list it in the tool picker. It is a display hint; it changes no runtime behavior.

### One unifying rule for the sidecar

Point at everything as a tool. **In the sidecar, if the entry is a kept reference, run it (the
callback executes the referenced workflow); if it is an embedded value, it is a concrete `client`
tool config and the model is fulfilled the client way.** That single rule covers both cases
without branching the wire by tool kind:

- `@ag.reference` → the callback executes the workflow and returns the result;
- `@ag.embed` → the inlined `client` config rides as a `client` spec and is fulfilled in the
  browser.

## What each syntax produces

The resolver is **already generic** and already walks `tools[]` (see [research.md](research.md))
— this is the one genuinely-useful research finding and it still holds. Embed resolution runs in
the SDK `ResolverMiddleware`, which today inlines every `@ag.embed`. The one resolver addition is
a "leave it" branch so an `@ag.reference` passes through untouched. `resolve_tools` then maps each
form:

- **`@ag.reference`** → a kept reference. The config carries a workflow reference (slug, optional
  version) plus the model-facing surface (name, description, input schema). `resolve_tools` turns
  it into a `CallbackToolSpec` whose `call_ref` encodes the workflow identity, plus the shared
  `ToolCallback` pointing at a server-side execute target. The runner needs **no new `kind`** —
  `callback` already dispatches everywhere (direct, Daytona relay, Pi native, the Claude
  `agenta-tools` bridge).
- **`@ag.embed`** → an inlined value. The resolver resolves the reference into a concrete
  `client` tool config (name, description, input schema) *before* `resolve_tools` runs, so
  `resolve_tools` sees a plain `ClientToolConfig` and produces a `client` spec. At run time it is
  the existing `client` path: the runner returns a `client` spec, the browser fulfills it next
  turn. No callback, no server-side execute.

Where the tool-specific decision is made: in **`resolve_tools`**, which already partitions tool
configs by type. The kept `@ag.reference` is the only new arm it has to recognize; the embed case
arrives as an already-concrete `client` config.

## Resolution path, end to end

```text
author commits agent config; tools[i] is @ag.embed OR @ag.reference
        |
SDK ResolverMiddleware: _has_embed_markers(parameters) true (walks lists)
        |   POST {api}/workflows/revisions/resolve
API generic resolver:
        |-- @ag.embed     -> inline the referenced value into tools[i]
        |                     (a concrete `client` tool config)
        '-- @ag.reference -> LEAVE the reference in tools[i] (do not inline)
        v
_agent: AgentConfig.from_params(...) parses tools[i]
        |   (a kept @ag.reference is a reference arm; an embedded value is a ClientToolConfig)
        |
resolve_tools(agent_config.tools): tool-specific mapping
        |-- kept @ag.reference -> CallbackToolSpec(call_ref="workflow.<slug>")
        |                          + the shared ToolCallback to the execute target
        '-- embedded client cfg -> ClientToolSpec
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
| Strict schema arms | `sdks/python/agenta/sdk/utils/types.py` | add an embed arm (mirror `_SkillEmbedRefSchema`) **and** a reference arm to `AgentConfigSchema.tools` so both a `@ag.embed` and a `@ag.reference` tool validate in the playground |
| Generic resolver "leave it" branch | SDK `ResolverMiddleware` + `api/oss/src/core/embeds/utils.py` | teach the generic resolver to **leave** an `@ag.reference` in place (inline only `@ag.embed`). Still tool-agnostic — no tool knowledge added |
| `resolve_tools` reference arm | `sdks/python/agenta/sdk/agents/tools/resolver.py` + a platform resolver in `.../platform/` | partition out a kept `@ag.reference`; resolve it to a `CallbackToolSpec` + the shared `ToolCallback`, mirroring the gateway path. The embed case arrives as a plain `ClientToolConfig` and needs no new arm |
| Server-side execute | `api/oss/src/apis/fastapi/tools/router.py` (+ core) | a `/tools/call`-style target that parses the `workflow.*` `call_ref`, invokes the referenced workflow revision with the model's arguments, and returns the result envelope |
| Wire | `services/agent/src/protocol.ts`, `sdks/python/agenta/sdk/agents/utils/wire.py`, golden fixtures | **no new field** — a reference rides as a `callback` spec, an embed as a `client` spec; only `call_ref` content is new |

`call_ref` grammar for a referenced workflow: an opaque slug, e.g. `workflow.{slug}` or
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
- **No Option A / Option B split.** There is one path; the only branch is the author's syntax
  (`@ag.embed` vs `@ag.reference`).
- **`is_tool` flag** is a later, FE-only display hint — not built here.

## Test plan

- **SDK unit:** both `tools` arms validate (mirror the skills schema test) — a `@ag.embed` tool
  and a `@ag.reference` tool; a kept `@ag.reference` resolves to the expected `CallbackToolSpec`
  + `ToolCallback`; an `@ag.embed`-resolved concrete `client` config produces a `client` spec.
- **Schema:** `AgentConfigSchema` JSON Schema emits both the embed and reference `oneOf` arms in
  `tools`; `CATALOG_TYPES["agent_config"]` still dereferences.
- **Generic resolver:** an `@ag.embed` in `tools[i]` is inlined to its value; an `@ag.reference`
  in `tools[i]` is **left in place** (not inlined); cycle/depth guards hold for both.
- **`resolve_tools`:** a kept reference becomes a callback-bound `CallbackToolSpec`; an embedded
  `client` config becomes a `client` spec.
- **Wire / golden:** a golden `/run` fixture with a referenced workflow tool (a `callback` spec)
  and one with an embedded client tool (a `client` spec); `protocol.ts` Zod accepts both.
- **Execute endpoint:** a `/tools/call` with a `workflow.*` `call_ref` invokes the revision and
  returns the result; the workflow's secrets/connections stay server-side.
- **Live matrix (agent-workflows-qa):** force a referenced workflow tool with an unguessable
  token across pi_core / claude on local + Daytona + SDK; a pass proves it ran server-side and
  the result reached the model. Pin a green cell with agent-replay-test.

## Rollout

POC, no flag needed for the schema arms (additive; the resolver already handles the embed arm
and gains a small "leave it" branch for the reference arm). The execute endpoint is new server
surface. Keep docs in sync in the same implementation PR (`documentation/tools.md`,
`interfaces/public-edge/agent-config-schema.md`, the interface inventory).

## Build order (when implemented)

1. Schema arms — `tools` accepts a `@ag.embed` tool and a `@ag.reference` tool; both validate in
   the playground.
2. Generic resolver — add the "leave it" branch so `@ag.reference` passes through uninlined while
   `@ag.embed` keeps inlining to its value.
3. `resolve_tools` — a kept `@ag.reference` → `CallbackToolSpec` + the execute endpoint; the
   embedded `client` config already lands as a `client` spec.
4. (Later, FE) `is_tool` flag so referenced workflows surface in the tool picker.
