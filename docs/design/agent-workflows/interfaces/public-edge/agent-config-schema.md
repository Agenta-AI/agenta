# Agent Config Schema

The agent config schema is the editable shape a caller sends and the playground renders. It
ships out through [`/inspect`](workflow-inspect.md) as the `agent_config` catalog type, comes
back in on [`/messages`](agent-messages.md) and [`/invoke`](workflow-invoke.md) under
`data.parameters.agent`, and the handler parses it with `AgentConfig.from_params(...)`. That
round trip is why it sits at the public edge: a field added here has to be understood by the
form, the request builder, and the parser at once.

There are two models behind one schema. `AgentConfigSchema` (in `utils/types.py`) is strict
and exists to *describe* the config, so the playground gets typed editors. The runtime
`AgentConfig` (in `dtos.py`) is permissive (`List[Any]`) and exists to *coerce* whatever the
form emits. Keep that split in mind: the schema is the contract; the parser is forgiving on
purpose.

The fields and the full schema follow.

## Fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `agents_md` | string (textarea) | hello-world prompt | The agent's system prompt, its AGENTS.md. |
| `model` | string (`grouped_choice`) | `"gpt-5.5"` | Model the agent runs on. A plain id (`"gpt-5.5"`) or a structured `{provider, connection}` ref. See [Model connection resolution](../in-service/model-connection-resolution.md). |
| `tools` | `ToolConfig[]` | `[]` | Runnable tools: `builtin`, `gateway`, `code`, or `client`. See [Tool models and resolution](../in-service/tool-models-and-resolution.md). |
| `mcp_servers` | `MCPServerConfig[]` | `[]` | Declared MCP servers; secret env resolved from the vault at run time. See [MCP models and resolution](../in-service/mcp-models-and-resolution.md). |
| `harness` | `"pi_core" \| "claude" \| "pi_agenta"` | `"pi_core"` | The coding agent to drive. `pi_core` and `pi_agenta` both drive the `pi` ACP agent; `pi_agenta` adds Agenta's forced skills, prompt, and policy. |
| `sandbox` | `"local" \| "daytona"` | `"local"` | Where it runs. |
| `permission_policy` | `"auto" \| "deny"` | `"auto"` | How a gating harness (Claude Code) handles tool-use prompts in a headless run. |
| `sandbox_permission` | `SandboxPermission \| null` | `null` (form pre-fills one) | The declared network and filesystem boundary. See [Sandbox permission](../in-service/sandbox-permission.md). |
| `skills` | `(SkillConfig \| EmbedRef)[]` | one embedded default skill | Inline SKILL.md packages, or `@ag.embed` references the backend inlines before the runner sees them. |

Note that `harness`, `sandbox`, and `permission_policy` are the run selection. The handler
reads them from the same `parameters` object via `RunSelection.from_params(...)`, not just
from `AgentConfig`.

## The default config

`/inspect` ships this as the value the form starts from. It is the canonical example of
every field in its default state:

```jsonc
{
  "agents_md": "You are a friendly hello-world agent running on the Agenta agent service.\n\n- Greet the user warmly.\n- Answer the user's message in one or two short sentences.",
  "model": "gpt-5.5",
  "tools": [],
  "mcp_servers": [],
  "harness": "pi_core",
  "sandbox": "local",
  "permission_policy": "auto",
  "sandbox_permission": {
    "network": { "mode": "on", "allowlist": [] },
    "enforcement": "strict"
  },
  "skills": [
    {
      "@ag.embed": {
        "@ag.references": { "workflow": { "slug": "_agenta.agenta-getting-started" } },
        "@ag.selector": { "path": "parameters.skill" }
      }
    }
  ]
}
```

The default skill is referenced by the reserved `_agenta.` slug, served from code by the
platform catalog, never the database. The embed must reference the artifact (`workflow.slug`),
which resolves to the latest revision; a bare revision slug with no version returns 500.

This default has one source: `build_agent_v0_default(...)` in
`sdks/python/agenta/sdk/utils/types.py`. The SDK builtin interface
(`agenta:builtin:agent:v0`) calls it bare; the service calls it with the two service-only
choices as named args (`skill_slug` for the platform default skill, `include_sandbox_permission`
for the declared Layer-2 boundary). A new default field changes the builder, not three copies.

## Appendix: the full schema, all cases

The nested shapes the playground renders and the parser accepts.

### `model`

Either form is valid:

```jsonc
"gpt-5.5"                                              // plain id
// or
{ "provider": "openai", "model": "gpt-5.5",
  "connection": { "mode": "agenta", "slug": "my-openai" } }   // structured ref
```

### `tools[]` (one of four variants, discriminated by `type`)

```jsonc
// builtin: a harness built-in by name
{ "type": "builtin", "name": "read", "needs_approval": false, "permission": null, "render": null }

// gateway: a server-side action (e.g. Composio); runs in Agenta, key stays server-side
{ "type": "gateway", "provider": "composio", "integration": "github",
  "action": "create_issue", "connection": "my-gh", "name": null,
  "needs_approval": false, "permission": null, "render": null }

// code: sandboxed code with named secrets injected at resolve time
{ "type": "code", "name": "fx", "runtime": "python", "script": "...",
  "input_schema": {}, "secrets": ["API_KEY"],
  "needs_approval": false, "permission": null, "render": null }

// client: fulfilled by the browser; filtered out of the runner's MCP tools/list
{ "type": "client", "name": "pick_file", "description": "...", "input_schema": {},
  "needs_approval": false, "permission": null, "render": null }
```

`permission` is `"allow" | "ask" | "deny"`. When unset, it is derived: explicit value wins,
then `needs_approval` to `"ask"`, then `read_only` (`true` to `"allow"`, `false` to `"ask"`),
else the global policy applies. See [Tool models and
resolution](../in-service/tool-models-and-resolution.md).

### `mcp_servers[]`

```jsonc
{
  "name": "files",
  "transport": "stdio",            // "stdio" (needs command) | "http" (needs url; deferred)
  "command": "npx", "args": ["-y", "server-filesystem"],
  "env": {},                       // non-secret env
  "url": null,                     // http transport only
  "secrets": { "TOKEN_ENV": "vault-secret-name" },  // {env var: vault secret name}
  "tools": [],                     // allowlist; empty = all
  "permission": null               // "allow" | "ask" | "deny"
}
```

### `sandbox_permission`

```jsonc
{
  "network": {
    "mode": "on",                  // "on" (allow all) | "off" (block) | "allowlist"
    "allowlist": []                // CIDR ranges; used when mode is "allowlist"
  },
  "filesystem": null,              // "on" | "readonly" | "off"; declared, not enforced yet
  "enforcement": "strict"          // "strict" (fail if unenforceable) | "best_effort"
}
```

This is Layer 2 of the security model. Enforcement is uneven: network egress is a hard
boundary on Daytona, is unenforceable on the local sandbox (a strict restricted policy is
rejected before the run), and the filesystem boundary is declared but enforced nowhere. The
full matrix is in [Sandbox permission](../in-service/sandbox-permission.md#the-enforcement-matrix).
An unset value never reaches the wire.

### `skills[]` (inline package or embed reference)

```jsonc
// inline SKILL.md package
{
  "name": "my-skill",              // ^[a-z0-9]+(-[a-z0-9]+)*$, <= 64 chars
  "description": "trigger the model matches",   // <= 1024 chars
  "body": "Markdown after the frontmatter",     // <= 50000 chars
  "files": [                       // bundled files laid beside SKILL.md
    { "path": "scripts/foo.py", "content": "...", "executable": false }
  ],
  "disable_model_invocation": false,   // hide from prompt; invoke only via /skill:name
  "allow_executable_files": false      // default deny; sandbox policy must also allow
}

// embed reference: the backend inlines it into the shape above before the runner sees it
{ "@ag.embed": { "@ag.references": { "workflow": { "slug": "_agenta.some-skill" } },
                 "@ag.selector": { "path": "parameters.skill" } } }
```

A bundled file `path` must be relative: no leading `/`, no backslashes, no `..` segment, and
not `SKILL.md` itself.

## Owned by

- `services/oss/src/agent/schemas.py`: the `/inspect` schema; its default config calls the
  shared builder with the service-only choices.
- `sdks/python/agenta/sdk/utils/types.py`: `AgentConfigSchema`, the nested catalog types, and
  `build_agent_v0_default` (the single source of the default config).
- `sdks/python/agenta/sdk/engines/running/interfaces.py`: the SDK builtin interface
  `agenta:builtin:agent:v0`, whose default calls the same builder bare.
- `sdks/python/agenta/sdk/agents/dtos.py`: the permissive runtime `AgentConfig` parser and
  `SandboxPermission`.

## Watch for when changing

- **Two models, one contract.** Update the strict `AgentConfigSchema` and the permissive
  runtime `AgentConfig` together, or the form and the parser drift.
- **The catalog type.** `agent_config` binds this schema to `AgentConfigControl`. Renaming it
  without updating the catalog breaks the form silently.
- **The default config.** It is shipped on `/inspect` and is what an untouched form runs. It
  has one source, `build_agent_v0_default`; change a default field there, not in each consumer.
- **Nested shapes.** `tools`, `mcp_servers`, `skills`, and `sandbox_permission` each have
  their own page and their own wire fields. A change here usually means a change there and a
  golden fixture.
- **Embed references.** Skills can arrive as `@ag.embed`. The schema must keep accepting that
  form, or a valid default fails validation.
