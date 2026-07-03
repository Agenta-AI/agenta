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
| `tools` | `(ToolConfig \| EmbedRef)[]` | `[]` | Runnable tools: `builtin`, `gateway`, `code`, `client`, `reference` (a workflow referenced as a tool — `type: "reference"` — the service runs server-side as a callback tool), or `platform` (an existing Agenta endpoint exposed to the agent — `type: "platform"` — the runner calls it directly). A workflow value can also be inlined via `@ag.embed`. See [Tool models and resolution](../in-service/tool-models-and-resolution.md). |
| `mcp_servers` | `MCPServerConfig[]` | `[]` | Declared MCP servers; secret env resolved from the vault at run time. See [MCP models and resolution](../in-service/mcp-models-and-resolution.md). |
| `harness` | `"pi_core" \| "claude" \| "pi_agenta"` (see slug+name note) | `"pi_core"` | The coding agent to drive. `pi_core` and `pi_agenta` both drive the `pi` ACP agent; `pi_agenta` adds Agenta's forced skills, prompt, and policy. |
| `sandbox` | `"local" \| "daytona"` | `"local"` | Where it runs. |
| `permissions` | `{default: "allow" \| "ask" \| "deny" \| "allow_reads", rules?: [...]}` | `{default: "allow_reads"}` | The agent-wide policy. `allow_reads` runs read-hinted tools and asks for everything else; `allow` runs everything; `ask` asks for everything; `deny` runs nothing unless a tool explicitly allows it. `rules` are optional authored patterns (for example `Bash(rm:*)`) that override the default for matching harness builtins. |
| `sandbox_permission` | `SandboxPermission \| null` | `null` (form pre-fills one) | The declared network and filesystem boundary. See [Sandbox permission](../in-service/sandbox-permission.md). |
| `skills` | `(SkillConfig \| EmbedRef)[]` | one embedded default skill | Inline SKILL.md packages, or `@ag.embed` references the backend inlines before the runner sees them. |

Note that `harness`, `sandbox`, and `permissions` are the run-selection fields. They
live on `AgentConfig` itself, under `data.parameters.agent`, and the handler reads them in the
one `AgentConfig.from_params(...)` parse along with the rest of the config. There is one agent
config, not a config plus a separate selection object.

### Harness as a slug + display name

The `harness` field's JSON Schema carries both a flat `enum` of the bare values (back-compat
for any consumer that reads `schema.enum`) AND a `oneOf` of per-option entries, each a versioned
**slug** identity plus a **display name**, built from one SDK source
(`HARNESS_IDENTITIES` in `sdks/python/agenta/sdk/agents/dtos.py`). The slug follows the repo's
`agenta:<namespace>:<name>:v<N>` grammar (mirroring `agenta:builtin:agent:v0`), namespace
`harness`:

```jsonc
"harness": {
  "type": "string",
  "default": "pi_core",
  "enum": ["pi_core", "pi_agenta", "claude"],
  "oneOf": [
    { "const": "pi_core",   "title": "Pi",           "x-ag-harness-slug": "agenta:harness:pi_core:v0" },
    { "const": "pi_agenta", "title": "Pi (Agenta)",   "x-ag-harness-slug": "agenta:harness:pi_agenta:v0" },
    { "const": "claude",    "title": "Claude Code",   "x-ag-harness-slug": "agenta:harness:claude:v0" }
  ]
}
```

The **stored/wire value stays the bare string** (`const`): the runner reads it as the runtime
selector and the frontend keys connection gating off it, so the `/run` wire is unchanged. The
playground `EnumSelectControl` reads the `oneOf` `title` for the dropdown label and writes the
bare `const` back. The slug is the harness contract's versioned identity in the interface only;
versioning the contract (`/run` `version`, the `/health` skew read) is deferred (see the
[contract-versioning project](../../projects/contract-versioning/README.md)).

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
  "permissions": { "default": "allow_reads" },
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

### `tools[]` (a concrete variant — incl. `type: "reference"` — or an `@ag.embed` workflow)

```jsonc
// builtin: a harness built-in by name
{ "type": "builtin", "name": "read", "permission": null, "render": null }

// gateway: a server-side action (e.g. Composio); runs in Agenta, key stays server-side
{ "type": "gateway", "provider": "composio", "integration": "github",
  "action": "create_issue", "connection": "my-gh", "name": null,
  "permission": null, "render": null }

// code: sandboxed code with named secrets injected at resolve time
{ "type": "code", "name": "fx", "runtime": "python", "script": "...",
  "input_schema": {}, "secrets": ["API_KEY"],
  "permission": null, "render": null }

// client: fulfilled by the browser; filtered out of the runner's MCP tools/list
{ "type": "client", "name": "pick_file", "description": "...", "input_schema": {},
  "permission": null, "render": null }

// reference (variant axis): the service runs the workflow's latest revision (or a pinned
// `version`) server-side when the model calls it. Resolves to a callback tool; key stays
// server-side. The model-facing surface (name/description/input_schema) and the tool axes ride
// as siblings.
{ "type": "reference", "ref_by": "variant", "slug": "summarize", "version": null,
  "name": "summarize", "description": "...", "input_schema": {},
  "permission": null, "render": null }

// reference (environment axis): the service runs whatever revision is deployed in `environment`
// for `slug`. `version` is not allowed (the environment is the pin).
{ "type": "reference", "ref_by": "environment", "environment": "production", "slug": "summarize",
  "name": "summarize", "permission": null, "render": null }

// platform: an existing Agenta endpoint exposed to the agent. `op` names a platform-op catalog
// entry (the catalog owns description/endpoint/schema/bind/gate defaults). `permission` is
// optional (null means inherit the policy; commit_revision's catalog default resolves to `ask`).
{ "type": "platform", "op": "find_capabilities", "permission": null }

// @ag.embed (a different feature, not in the tool-authoring UI): inline the referenced value into
// a concrete `client` tool config before the runner sees it (the backend's embed resolver does
// the inlining; rides the `client` path).
{ "@ag.embed": { "@ag.references": { "workflow": { "slug": "my-client-tool" } },
                 "@ag.selector": { "path": "parameters.tool" } } }
```

A `type: "reference"` tool resolves to a server-side `callback` tool (`call_ref =
workflow.variant.{slug}[.{version}]` or `workflow.environment.{environment}.{slug}`); a
`type: "platform"` tool resolves to a `callback` tool carrying a direct `call` to the exposed
endpoint (no `call_ref`); `@ag.embed` inlines to a `client` tool. Reference and platform tools are
plain config, not markers — the generic resolver only inlines `@ag.embed`, and `resolve_tools` owns
the tool-specific mapping. See [Tool models and
resolution](../in-service/tool-models-and-resolution.md).

`permission` is `"allow" | "ask" | "deny"`, or unset to inherit. When unset, the runner's
shared decision function resolves it: an authored rule match wins if one applies, else the
policy's `default` mode decides (`allow_reads` consults the tool's `read_only` hint: `true`
resolves to `allow`, no hint or `false` resolves to `ask`). There is no `needs_approval`
field and no separate per-tool defaulting step; one function resolves every tool the same
way. See [Tool models and resolution](../in-service/tool-models-and-resolution.md).

### `mcp_servers[]`

```jsonc
{
  "name": "files",
  "transport": "stdio",            // "stdio" (needs command; DISABLED) | "http" (needs url; delivered)
  "command": "npx", "args": ["-y", "server-filesystem"],
  "env": {},                       // non-secret env
  "url": null,                     // http transport only
  "secrets": { "TOKEN_ENV": "vault-secret-name" },  // {env-or-header name: vault secret name}
  "tools": [],                     // allowlist; empty = all
  "permission": null               // "allow" | "ask" | "deny"
}
```

For an **http** server the resolved secret is sent as a request header named by the secret-map
key, so a bearer token is `secrets: {"Authorization": "vault-name"}` (value `"Bearer ..."`).
**stdio** servers are disabled in the sidecar (they launch a runner-host process); a run
carrying one is refused.

```jsonc
// http (remote) MCP server example
{
  "name": "linear",
  "transport": "http",
  "url": "https://mcp.linear.app/sse",
  "secrets": { "Authorization": "linear-mcp-token" },  // -> Authorization request header
  "tools": [],
  "permission": "ask"
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
- **Reference and platform tools, and embeds.** A workflow referenced as a tool is the
  `type: "reference"` arm of the `ToolConfig` union; an existing endpoint exposed to the agent is
  the `type: "platform"` arm (both plain config, no marker). Skills can also arrive as `@ag.embed`,
  and tools as `@ag.embed`. The schema must keep accepting these forms (the `tools` field is a union
  of the concrete `ToolConfig` variants — including `reference` and `platform` — plus an `@ag.embed`
  arm), or a valid config fails validation. `@ag.embed` is a separate feature the generic resolver
  inlines; it is not surfaced in the tool-authoring UI.
