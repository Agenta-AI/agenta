# Agent-creation skills

Skills that let a person, or an agent harness, create and run agents on Agenta from the
outside: discover tools, learn the agent config schema, create and update a workflow, pick
a harness, set secrets, and invoke. Plus self-hosting skills for running Agenta with and
without the Claude subscription sidecar.

This workspace holds the design, the draft skill files, and the custom-tools design note.
The skills under `skills/` are drafts for review. When approved they move to
`.agents/skills/<name>/` (symlinked into `.claude/skills/`), matching the repo convention.

## Status

Draft, opened for morning review. Every API call below was run against the live dev stack
on 2026-06-26 (`http://localhost:8280`, project `hotel-agent`). The full create -> commit
-> invoke loop returned a correct answer. Test workflows were archived after the run.

## What "creating an agent" means in Agenta

An agent is a **workflow**. A workflow is the Git-style triple Agenta uses for every
versioned resource:

- **Workflow (artifact)** — the named thing. "My Agent."
- **Variant** — a branch of it. "main", "experiment-claude."
- **Revision** — an immutable commit on a variant. Each revision carries the agent config.

The agent config itself lives at `data.parameters.agent` inside a revision. Its catalog type
is `agent_config` (the `x-ag-type-ref` the playground renders), but the **payload location is
`parameters.agent`**, not `ag_config`. The builtin agent workflow is addressed by the URI
`agenta:builtin:agent:v0`, stored in the revision's `data.uri` field.

So creating an agent is four calls:

1. `POST /api/workflows/` — create the artifact.
2. `POST /api/workflows/variants/` — create a variant under it.
3. `POST /api/workflows/revisions/commit` — commit a revision with the agent config.
4. `POST /services/agent/v0/invoke` (or `/messages` to stream) — run it.

Updating an agent is one more `commit` on the same variant; it appends a new revision
(version increments). History is visible via `POST /api/workflows/revisions/log`.

## Verified API calls

All calls authenticate with `Authorization: ApiKey <key>` and carry `?project_id=<uuid>`
(or OTel baggage). The agent runner is reached under `/services/`; the management API under
`/api/`.

### 1. Create the workflow artifact

```
POST /api/workflows/
{
  "workflow": {
    "slug": "my-agent-<unique>",
    "name": "My Agent",
    "description": "Agent via API",
    "flags": { "is_custom": false }
  }
}
-> 200 { "workflow": { "id": "<workflow_id>", "slug": "...", ... } }
```

### 2. Create a variant

Note the wrapper key is `workflow_variant` and the parent is `workflow_id` (the manual
`.http` test files predate this rename and use `variant`/`artifact_id` — those 422 now).

```
POST /api/workflows/variants/
{
  "workflow_variant": {
    "name": "main",
    "slug": "main-<unique>",
    "description": "main variant",
    "workflow_id": "<workflow_id>"
  }
}
-> 200 { "workflow_variant": { "id": "<variant_id>", ... } }
```

### 3. Commit a revision with the agent config

The agent config goes in `data.parameters.agent`. The builtin URI goes in `data.uri` (use
`uri`, not `url` — `url` is validated as an HTTP(S) URL and rejects the `agenta:` scheme).

```
POST /api/workflows/revisions/commit
{
  "workflow_revision": {
    "message": "initial agent config",
    "slug": "rev-<unique>",
    "workflow_variant_id": "<variant_id>",
    "data": {
      "uri": "agenta:builtin:agent:v0",
      "parameters": {
        "agent": {
          "agents_md": "You are a helpful research assistant. Answer concisely.",
          "model": "openai/gpt-4o-mini",
          "tools": [],
          "harness": "pi_core",
          "sandbox": "local",
          "permission_policy": "auto"
        }
      }
    }
  }
}
-> 200 { "workflow_revision": { "id": "...", "version": "0", ... } }
```

### 4. Invoke

```
POST /services/agent/v0/invoke
Accept: application/json
{
  "data": {
    "inputs": { "messages": [ { "role": "user", "content": "What is the capital of France?" } ] },
    "parameters": { "agent": { ...same agent config... } }
  }
}
-> 200 { "data": { "outputs": { "role": "assistant", "content": "The capital of France is Paris." } } }
```

Stream the same body to `/services/agent/v0/messages` with `Accept: text/event-stream` and a
Vercel `UIMessage`-shaped `data.messages` to get the playground's SSE stream.

`/invoke` runs the config in the request directly. To run a *stored* revision, the playground
resolves the revision first and passes its `parameters.agent`. The config in the request is
the same object either way.

## The agent config schema

The schema is generated from `AgentConfigSchema` in
`sdks/python/agenta/sdk/utils/types.py` and parsed at runtime by `AgentConfig` in
`sdks/python/agenta/sdk/agents/dtos.py`. Fields (playground-facing names):

| Field | Type | Default | Notes |
|---|---|---|---|
| `agents_md` | string | default AGENTS.md | The agent's standing instructions. (Runtime fallback key: `instructions`.) |
| `model` | string or object | `"gpt-5.5"` | `"openai/gpt-4o-mini"` or `{provider, model, params, connection:{mode, slug}}`. |
| `tools` | list | `[]` | Discriminated on `type`: `builtin`, `gateway`, `code`, `client`, `reference`. |
| `mcp_servers` | list | `[]` | `{name, transport: stdio\|http, command/url, args, env, secrets, permission}`. |
| `skills` | list | `[]` | Inline `SkillConfig` `{name, description, body, files}` or an `@ag.embed` reference. |
| `harness` | string | `"pi_core"` | `pi_core`, `pi_agenta`, or `claude`. |
| `sandbox` | string | `"local"` | `local` or `daytona`. |
| `permission_policy` | enum | `"auto"` | `auto` or `deny`; how a permission-gating harness answers tool prompts headlessly. |
| `sandbox_permission` | object | none | Layer-2 sandbox boundary (network egress, filesystem, enforcement). |
| `harness_kwargs` | object | `{}` | Per-harness escape hatch keyed by harness name, e.g. `{"pi_core": {"append_system": "..."}}`. |

### Harness selection and capabilities (from `/inspect`)

`POST /services/agent/v0/inspect` returns `meta.harness_capabilities`, the source of truth
for what each harness can do. Verified on the live stack:

- `pi_core` (plain Pi) and `pi_agenta` (Pi + Agenta forced skills/persona/tools): providers
  `openai, anthropic, gemini, mistral, groq, minimax, together_ai, openrouter`; connection
  modes `agenta, self_managed`.
- `claude` (Claude Code): provider `anthropic` only; deployments `direct, custom, bedrock,
  vertex_ai, vertex`; models are aliases `default, sonnet, opus, haiku`.

Pick a harness by setting `agent.harness` to one of those exact strings. A server-side
capability check gates harness x provider x connection-mode x deployment before and after
the vault resolve, so an invalid combination fails loud.

## Tools: discovery, connections, resolution, calls

Composio is the gateway provider. On the live stack: **1047 integrations**; GitHub alone
exposes **846 actions**. Search is essential, hence the search-tools custom tool in the
design note.

- `GET /api/tools/catalog/providers/` — list providers (`composio`).
- `GET /api/tools/catalog/providers/composio/integrations/?search=github&limit=20` — find an
  integration (cursor-paginated; search suppresses the cursor).
- `GET /api/tools/catalog/providers/composio/integrations/github/actions/?search=CREATE_ISSUE&limit=3`
  — find an action (returns `count`, `total`, `cursor`, `actions[]`).
- `POST /api/tools/connections/` — create a connection (initiates OAuth; open
  `connection.data.redirect_url`). Body: `{connection: {slug, name, provider_key:"composio",
  integration_key:"github"}}`.
- `POST /api/tools/connections/query` — list connections.
- `POST /api/tools/resolve` — expand a tool spec into the runner's view
  (`{builtins, custom}`). Verified.
- `POST /api/tools/call` — execute one tool. Body: `{data: {id, type:"function",
  function: {name: "tools.composio.github.LIST_PULL_REQUESTS.<connection-slug>",
  arguments: {...}}}}`.

A gateway tool on the agent config references the connection by slug:

```json
{
  "type": "gateway", "provider": "composio",
  "integration": "github", "action": "GITHUB_CREATE_ISSUE",
  "connection": "my-github-conn", "needs_approval": true
}
```

## Secrets / vault

Provider keys live in the project vault. The agent resolves the right one server-side from
the caller's auth at invoke time; the client never sends the key.

- `GET /api/vault/v1/secrets/` — list (verified; returns `provider_key` entries).
- `POST /api/vault/v1/secrets/` — create. Verified create + delete round-trip:

```
POST /api/vault/v1/secrets/
{
  "header": { "name": "OpenAI", "description": "..." },
  "secret": {
    "kind": "provider_key",
    "data": { "kind": "openai", "provider": { "key": "sk-..." } }
  }
}
-> 200 { "id": "<secret_id>", ... }
```

- `PUT /api/vault/v1/secrets/{id}` — update. `DELETE /api/vault/v1/secrets/{id}` — delete.

`secret.kind` is one of `provider_key`, `custom_provider`, `sso_provider`,
`webhook_provider`. For a standard provider key, `data.kind` is the provider:
`openai, anthropic, gemini, mistral, groq, cohere, together_ai, openrouter, perplexityai,
deepinfra, anyscale, alephalpha, minimax`. `custom_provider` (`azure, bedrock, vertex_ai,
sagemaker, custom, ...`) takes a `provider: {url, version, key}` and a `models` list.

To pin a specific named secret on the agent config, set
`model.connection = {"mode": "agenta", "slug": "<secret-name>"}`. With no slug, Agenta picks
the project default for the model's provider. `mode: "self_managed"` injects nothing (the
harness uses its own login, e.g. the Claude subscription sidecar).

## Source map (load-bearing files)

- Agent config schema generator + CATALOG_TYPES: `sdks/python/agenta/sdk/utils/types.py`
- Runtime config parser + `HarnessType` + `SessionConfig`: `sdks/python/agenta/sdk/agents/dtos.py`
- `/invoke` `/inspect` `/messages` handler: `services/oss/src/agent/app.py`
- `/inspect` schema wrapper + default config: `services/oss/src/agent/schemas.py`
- Model / connection DTOs: `sdks/python/agenta/sdk/agents/connections/models.py`
- Tools / MCP / skills DTOs: `sdks/python/agenta/sdk/agents/{tools,mcp,skills}/models.py`
- Workflows router + request models: `api/oss/src/apis/fastapi/workflows/{router.py,models.py}`
- Revision data validation (`uri` vs `url`): `sdks/python/agenta/sdk/models/workflows.py`
- Tools router: `api/oss/src/apis/fastapi/tools/router.py`
- Vault router + secret DTOs: `api/oss/src/apis/fastapi/vault/router.py`, `api/oss/src/core/secrets/{dtos,enums}.py`
- Manual API test recipes: `api/oss/tests/manual/{tools,workflows}/*.http`
- Subscription sidecar recipe: `docs/design/agent-workflows/projects/subscription-sidecar/README.md`

## Contents of this workspace

- `README.md` — this design doc and verified API reference.
- `skills/create-agenta-agent/SKILL.md` — the draft skill for creating an agent end to end.
- `skills/self-host-agenta/SKILL.md` — the draft skill for self-hosting Agenta with and
  without the Claude subscription sidecar.
- `custom-tools-design.md` — the design note for the platform/gateway tools that let a
  harness create agents (search-tools, create-workflow, invoke-workflow, update-own-workflow,
  add-annotations, and more).
- `build-notes.md` — decisions and judgment calls from this build.
