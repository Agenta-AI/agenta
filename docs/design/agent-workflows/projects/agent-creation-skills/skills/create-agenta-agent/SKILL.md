---
name: create-agenta-agent
description: Create, configure, update, and run an agent on Agenta through the HTTP API. Use when the user wants to build an Agenta agent, create an agent workflow, set its instructions or model or tools, pick a harness (Pi or Claude), connect Composio tools, set a provider key, or invoke an agent over the API. Covers discovering tools, the agent config schema, the create/commit/invoke calls, and updating an existing agent.
allowed-tools: Read, Bash, Write, Grep, Glob
user-invocable: true
---

# Create an Agenta agent

Build an agent on Agenta from the outside, over the HTTP API. An agent is a versioned
**workflow**; its config lives in a **revision**. Creating one is four calls, updating it is
one more. This skill gives the exact payloads, verified against a live stack.

Read `reference.md` in this folder for the full field tables, the tools catalog, the secrets
schema, and the harness capability map. This file is the procedure.

## Mental model

An agent is the Git-style triple Agenta uses for every versioned thing:

- **Workflow (artifact)** — the named agent.
- **Variant** — a branch of it (`main`, `experiment-claude`).
- **Revision** — an immutable commit on a variant. The agent config rides here.

The agent config sits at `data.parameters.agent` in a revision. Its catalog type is
`agent_config`, but the payload key is **`agent`**, never `ag_config`. The builtin agent
workflow is addressed by the URI `agenta:builtin:agent:v0` in the revision's `data.uri`.

## Setup

You need three things:

1. The host, e.g. `http://localhost:8280` (dev) or your cloud host.
2. An API key. Header: `Authorization: ApiKey <key>`.
3. A `project_id`. List projects with `GET /api/projects/`. Pass it as `?project_id=<uuid>`
   on every call.

The management API is under `/api/`. The agent runner is under `/services/`.

## Step 0 (optional): discover what's available

- Harnesses, providers, and models: `POST /services/agent/v0/inspect` with `{}`. Read
  `meta.harness_capabilities`. `claude` only supports the `anthropic` provider with aliases
  `default/sonnet/opus/haiku`; `pi_core` and `pi_agenta` support eight providers.
- Tools: search the Composio catalog. There are ~1000 integrations and hundreds of actions
  each, so always search, never list blind.
  - `GET /api/tools/catalog/providers/composio/integrations/?search=github&limit=20`
  - `GET /api/tools/catalog/providers/composio/integrations/github/actions/?search=create_issue&limit=10`
- Existing secrets: `GET /api/vault/v1/secrets/`.

## Step 1: create the workflow artifact

```bash
curl -sS -X POST "$HOST/api/workflows/?project_id=$PROJECT" \
  -H "Authorization: ApiKey $KEY" -H 'Content-Type: application/json' \
  -d '{ "workflow": { "slug": "my-agent-001", "name": "My Agent",
        "description": "Agent via API", "flags": { "is_custom": false } } }'
# -> 200, save .workflow.id
```

## Step 2: create a variant

The wrapper key is `workflow_variant` and the parent is `workflow_id`. (Old `.http` test
files use `variant`/`artifact_id`; those now 422.)

```bash
curl -sS -X POST "$HOST/api/workflows/variants/?project_id=$PROJECT" \
  -H "Authorization: ApiKey $KEY" -H 'Content-Type: application/json' \
  -d '{ "workflow_variant": { "name": "main", "slug": "main-001",
        "description": "main variant", "workflow_id": "<workflow_id>" } }'
# -> 200, save .workflow_variant.id
```

## Step 3: commit a revision with the agent config

The config goes in `data.parameters.agent`. The builtin URI goes in `data.uri` (use `uri`,
not `url`; `url` is validated as HTTP(S) and rejects the `agenta:` scheme).

```bash
curl -sS -X POST "$HOST/api/workflows/revisions/commit?project_id=$PROJECT" \
  -H "Authorization: ApiKey $KEY" -H 'Content-Type: application/json' \
  -d '{
    "workflow_revision": {
      "message": "initial agent config", "slug": "rev-001",
      "workflow_variant_id": "<variant_id>",
      "data": {
        "uri": "agenta:builtin:agent:v0",
        "parameters": { "agent": {
          "agents_md": "You are a helpful research assistant. Answer concisely.",
          "model": "openai/gpt-4o-mini",
          "tools": [], "harness": "pi_core", "sandbox": "local",
          "permission_policy": "auto"
        } }
      }
    } }'
# -> 200, .workflow_revision.version == "0"
```

### Minimal vs full config

The minimum is `agents_md` and `model`. Everything else has a default. The fields:

- `agents_md` (string) — the agent's instructions.
- `model` (string or object) — `"openai/gpt-4o-mini"`, or
  `{"provider":"anthropic","model":"claude-opus-4-8","connection":{"mode":"agenta","slug":"anthropic-prod"}}`.
- `harness` — `pi_core` (plain Pi), `pi_agenta` (Pi + Agenta skills), `claude` (Claude Code).
- `sandbox` — `local` or `daytona`.
- `tools`, `mcp_servers`, `skills` — see `reference.md` for the shapes.
- `permission_policy` — `auto` or `deny`.

To add a Composio tool, first create a connection (Step 5b), then put a gateway tool in
`tools`:

```json
{ "type": "gateway", "provider": "composio", "integration": "github",
  "action": "GITHUB_CREATE_ISSUE", "connection": "my-github-conn", "needs_approval": true }
```

## Step 4: invoke

```bash
curl -sS -X POST "$HOST/services/agent/v0/invoke?project_id=$PROJECT" \
  -H "Authorization: ApiKey $KEY" -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d '{ "data": {
        "inputs": { "messages": [ { "role": "user", "content": "What is the capital of France?" } ] },
        "parameters": { "agent": { "agents_md": "Answer in one short sentence.",
                                    "model": "openai/gpt-4o-mini", "harness": "pi_core" } } } }'
# -> { "data": { "outputs": { "role": "assistant", "content": "The capital of France is Paris." } } }
```

`/invoke` runs the config in the request directly. To stream as the playground does, POST the
same body (with `data.messages` in Vercel `UIMessage` shape) to `/services/agent/v0/messages`
with `Accept: text/event-stream`.

To run a *stored* revision instead of an inline config, fetch it first
(`POST /api/workflows/revisions/retrieve`) and pass its `parameters.agent` as the config.

## Step 5: the supporting tasks

### 5a. Set a provider key (secret)

The client never sends the key at invoke time. Store it once in the vault; the agent resolves
it server-side from your auth.

```bash
curl -sS -X POST "$HOST/api/vault/v1/secrets/?project_id=$PROJECT" \
  -H "Authorization: ApiKey $KEY" -H 'Content-Type: application/json' \
  -d '{ "header": { "name": "OpenAI" },
        "secret": { "kind": "provider_key",
                    "data": { "kind": "openai", "provider": { "key": "sk-..." } } } }'
```

`data.kind` is the provider (`openai`, `anthropic`, `gemini`, ...). For Azure/Bedrock/Vertex
use `secret.kind: "custom_provider"` (see `reference.md`).

### 5b. Connect a Composio tool

```bash
curl -sS -X POST "$HOST/api/tools/connections/?project_id=$PROJECT" \
  -H "Authorization: ApiKey $KEY" -H 'Content-Type: application/json' \
  -d '{ "connection": { "slug": "my-github-conn", "name": "My GitHub",
        "provider_key": "composio", "integration_key": "github" } }'
# Open .connection.data.redirect_url in a browser to finish OAuth, then poll
# GET /api/tools/connections/<id> until it is connected.
```

Then reference the connection slug in a gateway tool on the agent config (Step 3).

### 5c. Pick the harness

Set `agent.harness`. Confirm the harness supports your model and provider with
`/inspect` first. `claude` needs an `anthropic` provider key (or a self-managed login such
as the subscription sidecar; see the `self-host-agenta` skill). Pi harnesses work with any
of their eight providers.

## Updating an agent

Commit another revision on the same variant. It appends a new version; nothing is
overwritten.

```bash
curl -sS -X POST "$HOST/api/workflows/revisions/commit?project_id=$PROJECT" \
  -H "Authorization: ApiKey $KEY" -H 'Content-Type: application/json' \
  -d '{ "workflow_revision": { "message": "tighten persona", "slug": "rev-002",
        "workflow_variant_id": "<variant_id>",
        "data": { "uri": "agenta:builtin:agent:v0",
                  "parameters": { "agent": { "agents_md": "You are terse. One word answers.",
                                             "model": "openai/gpt-4o-mini", "harness": "pi_core" } } } } }'
```

See history: `POST /api/workflows/revisions/log` with
`{ "workflow_revisions": { "workflow_variant_id": "<variant_id>", "depth": 10 } }`.

## Gotchas

- **`parameters.agent`, not `ag_config`.** The catalog *type name* is `agent_config`; the
  payload *key* is `agent`.
- **`data.uri`, not `data.url`.** `url` is validated as an HTTP(S) URL. The builtin scheme
  `agenta:builtin:agent:v0` only fits `uri`.
- **Variant wrapper renamed.** Use `workflow_variant` + `workflow_id`, not `variant` +
  `artifact_id`.
- **Harness x provider gating is server-side.** A bad combo (e.g. `harness: claude` with an
  `openai` model) fails loud. Check `/inspect` first.
- **Keys are resolved server-side.** Do not send provider keys in the invoke body; store them
  in the vault. Use `model.connection.slug` to pin a specific named secret.
- **Use cheap models when testing** (`gpt-4o-mini`, `claude haiku`).

## Verify with the bundled script

`create_agent.py` in this folder runs the whole loop (create -> variant -> commit -> invoke)
and prints each response. Run it with `uv run create_agent.py --host ... --key ... --project ...`.
It uses inline `# /// script` deps, so no install step.
