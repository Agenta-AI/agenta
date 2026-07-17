# create-agenta-agent: reference

Full field tables, the tools catalog, the secrets schema, and the harness capability map.
Loaded on demand by the `create-agenta-agent` skill. Every fact here was verified against a
live stack on 2026-06-26.

## The agent config schema

Generated from `AgentConfigSchema` (`sdks/python/agenta/sdk/utils/types.py`), parsed at
runtime by `AgentConfig` (`sdks/python/agenta/sdk/agents/dtos.py`). Goes at
`data.parameters.agent`.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `agents_md` | string | no | default AGENTS.md | Standing instructions. Runtime fallback key: `instructions`. |
| `model` | string or object | no | `"gpt-5.5"` | See "Model" below. |
| `tools` | list | no | `[]` | Discriminated on `type`. See "Tools". |
| `mcp_servers` | list | no | `[]` | See "MCP servers". |
| `skills` | list | no | `[]` | Inline `SkillConfig` or `@ag.embed` ref. See "Skills". |
| `harness` | string | no | `"pi_core"` | `pi_core`, `pi_agenta`, `claude`. |
| `sandbox` | string | no | `"local"` | `local`, `daytona`. |
| `permission_policy` | enum | no | `"auto"` | `auto`, `deny`. How a permission-gating harness answers tool prompts headlessly. |
| `sandbox_permission` | object | no | none | Layer-2 boundary: network egress, filesystem, enforcement. Omit for no boundary. |
| `harness_kwargs` | object | no | `{}` | Per-harness escape hatch keyed by harness name. E.g. `{"pi_core":{"append_system":"..."}}`. Both Pi harnesses read the `pi_core` slice. |

### Model

A plain string or a structured object.

- String: `"gpt-4o-mini"` (provider inferred) or `"openai/gpt-4o-mini"` (explicit).
- Object (`ModelRef`):

```json
{ "provider": "anthropic", "model": "claude-opus-4-8",
  "params": { "reasoning_effort": "high" },
  "connection": { "mode": "agenta", "slug": "anthropic-prod" } }
```

`connection.mode` is `agenta` (Agenta injects a vault key) or `self_managed` (Agenta injects
nothing; the harness uses its own login). For `agenta`, `slug` names a specific secret; omit
it to take the project default for the provider. A `self_managed` connection must not carry a
`slug`.

### Tools

Discriminated union on `type`. Shared base: `needs_approval` (bool, default false),
`permission` (`allow`/`ask`/`deny`), `render` (object).

```json
// builtin: a harness-native tool (read, write, bash, ...)
{ "type": "builtin", "name": "read" }

// gateway: a Composio action through the Agenta gateway
{ "type": "gateway", "provider": "composio", "integration": "github",
  "action": "GITHUB_CREATE_ISSUE", "connection": "my-github-conn", "needs_approval": true }

// code: an inline function the runner executes
{ "type": "code", "name": "add", "runtime": "python",
  "script": "def run(a, b):\n    return a + b",
  "input_schema": { "type": "object", "properties": { "a": {"type":"number"}, "b": {"type":"number"} } },
  "secrets": [] }

// client: a tool the calling client fulfills (HITL / app-side)
{ "type": "client", "name": "ask_user", "input_schema": { "type": "object", "properties": {} } }

// reference: another Agenta workflow used as a tool
{ "type": "reference", "slug": "my-other-workflow", "version": 3 }
```

A bare string or `{ "name": "read" }` coerces to a `builtin`.

### MCP servers

```json
{ "name": "filesystem", "transport": "stdio",
  "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
  "env": {}, "secrets": {}, "tools": [], "permission": "ask" }
// or transport "http" with "url": "https://..."
```

MCP is flag-gated; on this dev stack `AGENTA_AGENT_ENABLE_MCP=false`. Confirm it is enabled
before relying on it.

### Skills

Inline `SkillConfig`:

```json
{ "name": "release-notes",
  "description": "Use when asked to draft release notes from a changelog.",
  "body": "# Release notes\nSummarize the changelog into user-facing bullets.",
  "files": [], "disable_model_invocation": false, "allow_executable_files": false }
```

`name` matches `^[a-z0-9]+(-[a-z0-9]+)*$`, <= 64 chars. `description` <= 1024. `body` <=
50000. Or reference a workflow-backed skill with an `@ag.embed` block.

## Harness capabilities (live `/inspect` output)

`POST /services/agent/v0/inspect` with `{}` returns `meta.harness_capabilities`:

| Harness | Providers | Connection modes | Deployments | Model selection |
|---|---|---|---|---|
| `pi_core` | openai, anthropic, gemini, mistral, groq, minimax, together_ai, openrouter | agenta, self_managed | direct | `provider/id` |
| `pi_agenta` | (same eight) | agenta, self_managed | direct | `provider/id` |
| `claude` | anthropic | agenta, self_managed | direct, custom, bedrock, vertex_ai, vertex | aliases: `default`, `sonnet`, `opus`, `haiku` |

The capability check runs server-side before and after the vault resolve. An invalid
combination (e.g. `claude` with an `openai` model) fails loud with a clear error.

## Tools catalog (Composio)

On the live stack: 1 provider (`composio`), 1047 integrations. GitHub alone exposes 846
actions. Always search.

- `GET /api/tools/catalog/providers/` -> `{count, providers[]}`.
- `GET /api/tools/catalog/providers/composio` -> one provider.
- `GET /api/tools/catalog/providers/composio/integrations/?limit=20&cursor=<next>` -> page of
  integrations. `?search=<term>` filters (and suppresses the cursor).
- `GET /api/tools/catalog/providers/composio/integrations/<integration>` -> one integration.
- `GET /api/tools/catalog/providers/composio/integrations/<integration>/actions/?search=<term>&limit=20`
  -> `{count, total, cursor, actions[]}`. Each action has `key`, `name`, `description`,
  `categories`, `read_only`.
- `GET /api/tools/catalog/providers/composio/integrations/<integration>/actions/<action_key>`
  -> one action (with its input schema).

### Connections

- `POST /api/tools/connections/` body `{connection: {slug, name, description?, provider_key:"composio", integration_key:"github"}}`.
  Returns `connection.data.redirect_url`; open it to finish OAuth.
- `GET /api/tools/connections/<id>` -> poll status after OAuth.
- `POST /api/tools/connections/query` -> list (filterable by `provider_key`, `integration_key`).
- `POST /api/tools/connections/<id>/refresh`, `/revoke`; `DELETE /api/tools/connections/<id>`.

### Resolve and call

- `POST /api/tools/resolve` body `{tools: [...]}` -> `{count, builtins, custom}`. Expands a
  tool spec into the runner's view; useful to validate a config before committing.
- `POST /api/tools/call` body
  `{data: {id, type:"function", function: {name:"tools.composio.github.LIST_PULL_REQUESTS.<connection-slug>", arguments:{...}}}}`.
  The slug pattern is `tools.{provider}.{integration}.{ACTION}.{connection-slug}`.

## Secrets / vault

- `GET /api/vault/v1/secrets/` -> list.
- `POST /api/vault/v1/secrets/` -> create.
- `GET|PUT|DELETE /api/vault/v1/secrets/<id>` -> read / update / delete.

`secret.kind` is one of `provider_key`, `custom_provider`, `sso_provider`,
`webhook_provider`.

Standard provider key:

```json
{ "header": { "name": "OpenAI", "description": "..." },
  "secret": { "kind": "provider_key",
              "data": { "kind": "openai", "provider": { "key": "sk-..." } } } }
```

`data.kind` (standard providers): `openai, cohere, anyscale, deepinfra, alephalpha, groq,
minimax, mistral, anthropic, perplexityai, together_ai, openrouter, gemini`.

Custom provider (Azure, Bedrock, Vertex, self-hosted):

```json
{ "header": { "name": "MyAzure" },
  "secret": { "kind": "custom_provider",
              "data": { "kind": "azure",
                        "provider": { "url": "https://...", "version": "2024-02-01", "key": "..." },
                        "models": [ { "slug": "gpt-4o" } ] } } }
```

`custom_provider` kinds: `custom, azure, bedrock, sagemaker, vertex_ai, openai, cohere,
anyscale, deepinfra, alephalpha, groq, minimax, mistral, anthropic, perplexityai,
together_ai, openrouter, gemini`.

## Auth and routing

- Auth header: `Authorization: ApiKey <key>` (or a SuperTokens cookie in the browser).
- `project_id`: query param `?project_id=<uuid>` or OTel baggage.
- Management API: `/api/...` (the `api` container).
- Agent runner: `/services/agent/v0/{invoke,inspect,messages}` (the `services` container).
- Both behind the same traefik host (dev: `:8280`).

The provider key is resolved server-side from the project vault using the caller's auth. The
run never gets more access than the caller. A named connection (`mode:agenta` + slug) selects
a specific secret; the project default is used when no slug is given.
