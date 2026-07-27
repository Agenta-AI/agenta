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
the same payload into one permissive `AgentConfig` (the run-selection fields `harness`,
`sandbox`, and `runner.permissions.default` live on it), resolves tools and secrets
server-side, and hands a final wire request to the Node runner.

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
  → AgentConfig.from_params (SDK runtime)   re-parse the saved payload (one config)
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
- `model` renders in its own "Model" section: a harness-filtered provider + model picker. The
  options come from the agent's `/inspect` `meta.harness_capabilities[harness].models` (Pi: the
  vault providers' catalog ids; Claude: its aliases), not the full shared catalog. Selecting a
  model sets BOTH the model id and its provider, so there is no separate provider field. When
  `/inspect` publishes no per-harness models (older agents / a standalone control), it falls back
  to the schema's full grouped-choice catalog. A separate **Provider credentials** section, not
  nested under the model picker, holds the connection mode: a segmented toggle with *Use API key*
  (a vault connection, either "Project default" or a named connection picked from
  `GET /secrets/`) and *Use subscription* (the harness signs itself in, using a Claude Code or
  Codex subscription or any credentials it reads from its own environment such as environment
  variables; Agenta injects nothing and this mode requires a self-hosted deployment). The form
  always writes `model` as a structured `ModelRef` (`{provider, model, connection?}`), never a
  free-text string; the connection rides in `model_ref.connection`. A raw-JSON escape hatch
  remains for power users.
- `tools` renders as a flat array. Each entry uses `ToolItemControl`, the same tool object
  shape the prompt control uses.
- `mcp_servers` renders as a flat array. Each entry uses `McpServerItemControl`, which is a
  JSON editor for one server entry.
- `harness`, `sandbox`, and the permission policy each render as an enum select. The
  permission policy select has four modes: `allow`, `ask`, `deny`, `allow_reads` (the
  default). It renders for Pi too; Pi now honors it the same way Claude does.

So the object the form produces is:

```
{ agents_md, model, tools[], mcp_servers[], harness, sandbox, runner: { permissions: { default } } }
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
| `runner.permissions.default` | `Literal["allow","ask","deny","allow_reads"]` | `"allow_reads"` | enum, four modes |

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
    harness_kwargs: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    # the run-selection fields
    harness: str = "pi_core"
    sandbox: str = "local"
    permission_default: PermissionMode = "allow_reads"
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

The run-selection fields are on this neutral config too. `harness`, `sandbox`, and
`permission_default` are plain fields on `AgentConfig` (in
`sdks/python/agenta/sdk/agents/dtos.py`). They used to live on a separate `RunSelection`
object; that object is retired, because there is one agent definition, not an agent plus a
sidecar selection. The composite schema and the neutral config now agree: both keep these
fields next to the rest of the agent. The authored form of the same value is
`runner.permissions.default`; the SDK flattens it onto `permission_default` when it parses
the template. The old three-name split (`runner.interactions.headless` authored,
`permission_policy` stored, `permissionPolicy` on the wire) is gone. The value now has four
modes (`allow`, `ask`, `deny`, `allow_reads`) instead of two (`auto`, `deny`), and the wire
field is `permissions: {default, rules?}`. Authors can also add `runner.permissions.rules`, a
list of `{pattern, permission}` entries for harness-builtin tools (for example
`Bash(rm:*)` set to `ask`). The runner checks rules before falling back to `default`.

Tool entries are strict even though the list is lenient. Each tool subclass is `extra="forbid"`
(`sdks/python/agenta/sdk/agents/tools/models.py`). `MCPServerConfig` is also `extra="forbid"`. It accepts only the nested HTTP
connection, credential, and policy roles defined in `sdks/python/agenta/sdk/agents/mcp/models.py`.

There is no `ModelRef` type. `model` is a plain string everywhere. There is no provider field.
The rich model picker is built only for the UI by `_model_catalog_type()`
(`sdks/python/agenta/sdk/utils/types.py:1045`).

## Layer 4: what the runtime actually reads

The Python `/invoke` handler is at `services/oss/src/agent/app.py`. It parses the request
into one object:

```python
agent_config = AgentConfig.from_params(params, defaults=_default_agent_config())
```

That single parse covers everything, including the run-selection fields. The handler then
resolves tools, MCP servers, and secrets server-side, bundles everything into a
`SessionConfig`, picks a backend from `agent_config.sandbox` (`select_backend`,
`services/oss/src/agent/app.py`), and runs one turn through a harness chosen from
`agent_config.harness`.

`sandbox` is deliberately absent from `SessionConfig`. It is a backend concern. The handler
reads `agent_config.sandbox` and passes it to `SandboxAgentBackend(sandbox=...)` instead.

The final wire shape the Node runner receives is `AgentRunRequest` in
`services/runner/src/protocol.ts`. That is the true wired surface:
`harness`, `sandbox`, `agentsMd`, `systemPrompt`/`appendSystemPrompt`, `model`, `tools`
(builtin names), `skills`, `customTools`, `mcpServers`, `toolCallback`, and
`permissions: {default, rules?}`.

## Field-by-field: enforced vs loose, wired vs decorative

Legend: (a) catalog/schema, (b) SDK neutral config, (c) runtime.

| Field | (a) schema | (b) SDK config | (c) runtime | Status |
| --- | --- | --- | --- | --- |
| model / provider | yes, `model: str` | yes, `Optional[str]` | wired to the runner | Loose string. No `ModelRef`, no provider enum. There is no separate provider field. |
| tools | yes, strict list | yes, lenient coercion | wired, resolved to builtin names + tool specs | Entries strict, list lenient. |
| mcp_servers | yes, strict list | yes | wired, resolved to runner MCP servers | Strict per entry. Claude supports external HTTP servers; Pi refuses them until its bridge exists. |
| skills | yes, embed/inline list | yes | wired | Author-settable (`SkillConfig` inline or `@ag.embed` references). The playground build-kit overlay embeds one skill, the `build-an-agent` playbook; the `pi_agenta` harness additionally force-unions `getting-started`. See below. |
| persona | no | no | wired but forced only | Not a config field. The Agenta harness hardcodes an append-system preamble. See below. |
| agents_md | yes, `agents_md: str` | yes, as `instructions` | wired to `agentsMd` | The schema names it `agents_md`. The neutral config names it `instructions`. |
| harness | yes, enum | yes, on `AgentConfig` | wired, picks the harness class | Enum-enforced. The runtime validates via `make_harness`. |
| sandbox | yes, enum | yes, on `AgentConfig` | wired to the backend, absent from `SessionConfig` | Backend concern, not agent identity. |
| runner.permissions.default | yes, enum (4 modes) | yes, as `permission_default` on `AgentConfig` | wired to `SessionConfig` and the run request's `permissions.default` | Enforced for both harnesses: Claude at its settings file and the ACP responder, Pi at the tool relay. No longer decorative on Pi. |

## Notable gaps and quirks

`persona` is not author config; it is a runtime injection of the Agenta harness only (a forced
append-system string). `skills` used to work the same way, but is author config now: inline
`SkillConfig` packages or `@ag.embed` references the backend inlines before the runner sees
them. Two platform skills still arrive without the author writing anything: the playground
build-kit overlay embeds the `build-an-agent` playbook, and the `pi_agenta` harness
force-unions the `getting-started` skill (`AGENTA_FORCED_SKILLS` in
`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`). Each is delivered exactly once.
Pi (`pi_core`) and Claude harnesses get no forced skills or persona.

Per-harness divergence is real in other ways, but not in permission enforcement anymore: the
permission policy is now enforced on both Claude and Pi. Builtin tool names are dropped for
Claude with a warning, because builtins are Pi-only. Forced skills and persona are
Agenta-only. Pi's
`system` and `append_system` overrides come through the `harness_kwargs` escape hatch on the
neutral config, which is itself absent from the schema.

Harness, sandbox, and the permission policy sit next to the agent definition in both the
schema and the neutral `AgentConfig`. The two agree on one control.

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
      "name": "memory",
      "connection": {
        "type": "http",
        "url": "https://memory.example.com/mcp",
        "headers": {},
        "credentials": { "type": "none" }
      },
      "policy": { "tools": { "mode": "all" }, "permission": "ask" }
    }
  ],
  "harness": "claude",
  "sandbox": "local",
  "runner": { "permissions": { "default": "allow_reads" } }
}
```

With this config, the runtime reads `agents_md`, `model`, `tools`, `mcp_servers`, and the
run-selection fields `harness`, `sandbox`, and `runner.permissions.default` through the one
neutral `AgentConfig`, resolves the tools and MCP servers server-side, and runs one turn on
the Claude harness in a local sandbox. Under `allow_reads`, `web_search` runs as a read with no
prompt; a write tool pauses for approval.

## See also

- `agent-template.md` for the intended long-term template shape and what is still missing.
- `tools.md` for the tool taxonomy and resolution path.
- `running-the-agent.md` for how the service and the runner sidecar are actually started.
