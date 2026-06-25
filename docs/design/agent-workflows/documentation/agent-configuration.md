# Agent Configuration

This page documents how an agent workflow is configured today, end to end. It traces one
config object from the playground form, through the catalog type and SDK interface, down to
what the runtime actually reads. It marks what is enforced, what is loose, what is wired, and
what is decorative.

All file:line citations were verified against the code on 2026-06-23.

## The one-sentence version

The playground renders a single composite `agent_config` control. The field list for that
control is not hardcoded in the frontend. It is fetched from the backend catalog type
`agent_config`, which the SDK defines once as `AgentConfigSchema`. The runtime then re-parses
the same payload into a permissive `AgentConfig` plus a `RunSelection`, resolves tools and
secrets server-side, and hands a final wire request to the Node runner.

## Three objects share the name "AgentConfig"

Keep these separate. They look alike but do different jobs.

| Object | File | Role |
| --- | --- | --- |
| `AgentConfigSchema` | `sdks/python/agenta/sdk/utils/types.py:1065` | Strict schema. Emits the JSON Schema that becomes the catalog type and drives the playground form. It describes the config. |
| `AgentConfig` (neutral runtime) | `sdks/python/agenta/sdk/agents/dtos.py:308` | Runtime parser. Coerces the loose payload the playground sends. It consumes the config. |
| `AgentConfig` (file-default dataclass) | `services/oss/src/agent/config.py:30` | Loose file-default loader. Holds the service's built-in defaults with `tools: List[Any]`. |

## The full path

```
Playground form
  → AgentConfigControl (FE)               reads schema.properties from the catalog type
  → GET /workflows/catalog/types/agent_config   resolves x-ag-type-ref to the full schema
  → AgentConfigSchema (SDK)               the strict schema, registered in CATALOG_TYPES
  → AgentConfig.from_params + RunSelection (SDK runtime)   re-parse the saved payload
  → SessionConfig                         tools + secrets resolved server-side
  → AgentRunRequest (TS wire contract)    the final shape the Node runner receives
```

## Layer 1: the frontend playground form

The form is fully schema-driven. There is no hand-built agent form. A single marker on the
workflow's parameters schema mounts one composite control.

The marker is `x-ag-type-ref: "agent_config"`. The schema renderer detects it at
`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/SchemaPropertyRenderer.tsx:130`
and dispatches to `AgentConfigControl` at the same file's `case "agent_config"` (around line
430).

`AgentConfigControl`
(`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentConfigControl.tsx`) does
not invent widgets. It reads `schema.properties` (line 78) and renders each sub-field with an
existing control:

- `agents_md` renders as a multiline text input labeled "Instructions". It falls back to a
  legacy `instructions` value when `agents_md` is missing.
- `model` renders as a grouped choice control.
- `tools` renders as a flat array. Each entry uses `ToolItemControl`, the same tool object
  shape the prompt control uses.
- `mcp_servers` renders as a flat array. Each entry uses `McpServerItemControl`, which is a
  JSON editor for one server entry.
- `harness`, `sandbox`, and `permission_policy` each render as an enum select.

So the object the form produces is:

```
{ agents_md, model, tools[], mcp_servers[], harness, sandbox, permission_policy }
```

The field set comes from the backend at runtime. The frontend fetches the catalog type with
`GET /workflows/catalog/types/{agType}`
(`web/packages/agenta-entities/src/workflow/api/api.ts`, around line 1291) and merges its
`properties` into the stored schema
(`web/packages/agenta-entities/src/workflow/state/molecule.ts`, around line 520). If the
backend schema changes, the form changes with no frontend edit.

There is no `persona` control. The form never renders one. See the persona note below.

## Layer 2: the catalog type and service schema

`AgentConfigSchema` is the single source of the field list
(`sdks/python/agenta/sdk/utils/types.py:1065`). It is a strict model with no `extra="allow"`.
Its fields and defaults:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `agents_md` | `str` | a hello-world prompt | `x-ag-type: textarea` |
| `model` | `str` | `"gpt-5.5"` | `x-parameter: grouped_choice`, plain string |
| `tools` | `List[ToolConfig]` | empty list | typed discriminated union |
| `mcp_servers` | `List[MCPServerConfig]` | empty list | typed |
| `harness` | `Literal["pi_core","claude","pi_agenta"]` | `"pi_core"` | enum |
| `sandbox` | `Literal["local","daytona"]` | `"local"` | enum |
| `permission_policy` | `Literal["auto","deny"]` | `"auto"` | enum |

The schema is registered in `CATALOG_TYPES` under the key `"agent_config"`
(`sdks/python/agenta/sdk/utils/types.py:1132`). The API catalog imports `CATALOG_TYPES` from
the SDK and re-serves it (`api/oss/src/resources/workflows/catalog.py:10`). The API does not
define any agent fields itself. A grep for `AgentConfigSchema` across `api/` returns nothing.

The agent workflow service advertises this type by reference, not by value. Its `/inspect`
schema carries a thin pointer plus a pre-fill default
(`services/oss/src/agent/schemas.py:55`):

```python
AGENT_CONFIG_SCHEMA = {
    "type": "object",
    "x-ag-type-ref": "agent_config",
    "default": _DEFAULT_AGENT_CONFIG,
}
```

The SDK builtin interface `agent_v0_interface` carries the same reference on its `agent`
parameter (`sdks/python/agenta/sdk/engines/running/interfaces.py:527`).

The schema's own docstring states the design split. The runtime config stays permissive
because its job is to coerce sloppy input. This schema is strict because its job is to
describe the shape (`sdks/python/agenta/sdk/utils/types.py:1065`).

## Layer 3: the SDK runtime config

The neutral runtime `AgentConfig` lives at
`sdks/python/agenta/sdk/agents/dtos.py:308`. Its fields:

```python
class AgentConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True)   # NOT extra="allow"
    instructions: Optional[str] = None                 # becomes AGENTS.md
    model: Optional[str] = None
    tools: List[ToolConfig] = Field(default_factory=list)
    mcp_servers: List[MCPServerConfig] = Field(default_factory=list)
    harness_options: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
```

One correction to a common belief. This model is not `extra="allow"`. Its looseness comes
from before-validators that coerce messy input, not from accepting arbitrary keys:

- `_coerce_tools` accepts strings, dicts, and legacy shapes.
- `_coerce_mcp_servers` parses loose server shapes.
- `from_params()` accepts three payload shapes: the `agent` element, a prompt-template
  prompt, or a flat `{model, agents_md, tools}` object.

The genuinely loose object is the file-default dataclass at
`services/oss/src/agent/config.py:30`, which holds `tools: List[Any]`. That is the service's
built-in default, not user input.

Two fields the schema lists are not on this neutral config. `harness`, `sandbox`, and
`permission_policy` live on a separate `RunSelection` object
(`sdks/python/agenta/sdk/agents/dtos.py:364`). The SDK splits "what the agent is" from "where
and how it runs." The composite schema flattens both into one control for the playground.

Tool entries are strict even though the list is lenient. Each tool subclass is `extra="forbid"`
(`sdks/python/agenta/sdk/agents/tools/models.py`). `MCPServerConfig` is also `extra="forbid"`
with a transport validator (`sdks/python/agenta/sdk/agents/mcp/models.py`).

There is no `ModelRef` type. `model` is a plain string everywhere. There is no provider field.
The rich model picker is built only for the UI by `_model_catalog_type()`
(`sdks/python/agenta/sdk/utils/types.py:1045`).

## Layer 4: what the runtime actually reads

The Python `/invoke` handler is at `services/oss/src/agent/app.py`. It parses the request
into two objects (around line 72):

```python
agent_config = AgentConfig.from_params(params, defaults=_default_agent_config())
selection    = RunSelection.from_params(params)
```

It then resolves tools, MCP servers, and secrets server-side (`app.py`, lines 78 to 83),
bundles everything into a `SessionConfig` (`dtos.py:554`), picks a backend from the selection
(`select_backend`, `app.py:49`), and runs one turn through a harness.

`sandbox` is deliberately absent from `SessionConfig`. It is a backend concern. The handler
passes it to `SandboxAgentBackend(sandbox=...)` instead (`app.py:56`).

The final wire shape the Node runner receives is `AgentRunRequest` in
`services/agent/src/protocol.ts` (around line 185). That is the true wired surface:
`harness`, `sandbox`, `agentsMd`, `systemPrompt`/`appendSystemPrompt`, `model`, `tools`
(builtin names), `skills`, `customTools`, `mcpServers`, `toolCallback`, `permissionPolicy`.

## Field-by-field: enforced vs loose, wired vs decorative

Legend: (a) catalog/schema, (b) SDK neutral config, (c) runtime.

| Field | (a) schema | (b) SDK config | (c) runtime | Status |
| --- | --- | --- | --- | --- |
| model / provider | yes, `model: str` | yes, `Optional[str]` | wired to the runner | Loose string. No `ModelRef`, no provider enum. There is no separate provider field. |
| tools | yes, strict list | yes, lenient coercion | wired, resolved to builtin names + tool specs | Entries strict, list lenient. |
| mcp_servers | yes, strict list | yes | wired, resolved to runner mcp servers | Strict per entry. Gated by `AGENTA_AGENT_ENABLE_MCP` at the service. |
| skills | no | no | wired but forced only | Not author-settable. Only the Agenta harness injects forced skills. See below. |
| persona | no | no | wired but forced only | Not a config field. The Agenta harness hardcodes an append-system preamble. See below. |
| agents_md | yes, `agents_md: str` | yes, as `instructions` | wired to `agentsMd` | The schema names it `agents_md`. The neutral config names it `instructions`. |
| harness | yes, enum | no, on `RunSelection` | wired, picks the harness class | Enum-enforced. The runtime validates via `make_harness`. |
| sandbox | yes, enum | no, on `RunSelection` | wired to the backend, absent from `SessionConfig` | Backend concern, not agent identity. |
| permission_policy | yes, enum | no, on `RunSelection` | wired to `SessionConfig` | Only the Claude harness reads it. Pi ignores it, so it is decorative for `pi_core` and `pi_agenta`. |

## Notable gaps and quirks

`skills` and `persona` are not author config. They are runtime injections of the Agenta
harness only. `skills` is a `List[str]` on `AgentaAgentConfig`, force-populated from a fixed
list. `persona` is a forced append-system string. Neither appears in any schema, neither
appears on the neutral config, and the playground renders no control for either. Pi and
Claude harnesses get no forced skills or persona.

Per-harness divergence is real. `permission_policy` is wired only for Claude. Builtin tool
names are dropped for Claude with a warning, because builtins are Pi-only. Skills and persona
are Agenta-only. Pi's `system` and `append_system` overrides come through the
`harness_options` escape hatch on the neutral config, which is itself absent from the schema.

The schema is the only place where harness, sandbox, and permission policy sit next to the
agent definition. The SDK keeps them apart. The composite schema re-flattens them so the
playground can show one control.

## A concrete example config

This is what the playground saves and the runtime reads:

```json
{
  "agents_md": "You are a helpful research assistant. Cite your sources.",
  "model": "gpt-5.5",
  "tools": [
    { "type": "builtin", "name": "web_search" }
  ],
  "mcp_servers": [
    {
      "name": "github",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  ],
  "harness": "pi_core",
  "sandbox": "local",
  "permission_policy": "auto"
}
```

With this config, the runtime reads `agents_md`, `model`, `tools`, and `mcp_servers` through
the neutral `AgentConfig`, reads `harness`, `sandbox`, and `permission_policy` through
`RunSelection`, resolves the tools and MCP servers server-side, and runs one turn on the Pi
harness in a local sandbox. The `permission_policy` value is ignored because the harness is
Pi, not Claude.

## See also

- `agent-template.md` for the intended long-term template shape and what is still missing.
- `tools.md` for the tool taxonomy and resolution path.
- `running-the-agent.md` for how the service and the runner sidecar are actually started.
