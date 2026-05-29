# Agenta MCP Server

A production-oriented MCP server exposing a curated **v1 authoring surface** over the Agenta API. It wraps only the confirmed `/simple/*` endpoints and intentionally omits execution, evaluation starts, deployment, archive/unarchive, org/billing/key admin, traces, queues, and public OAuth.

## Package layout decision

This package lives at `clients/mcp-python/` so it remains standalone, installable, and importable by non-MCP agent loops while matching the repository's client conventions.

## Configuration

Configuration is environment-only. The server does not auto-load `.env` files; either export variables in your shell, pass them through your MCP client config, or run `set -a && source .env && set +a` before starting the server.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `AGENTA_API_KEY` | yes | — | Project-scoped API key used for every Agenta API call. |
| `AGENTA_API_URL` | no | `https://cloud.agenta.ai/api` | Use `http://localhost/api` for self-hosted host access or `http://api:8000` for Docker Compose sibling deployment. |
| `AGENTA_AUTH_SCHEME` | no | `ApiKey` | Sends `Authorization: ApiKey <key>`. Set `bare` only for non-standard deployments. |
| `AGENTA_MCP_TRANSPORT` | no | `stdio` | Set `streamable-http` for hosted/internal deployment. |
| `MCP_HOST` | no | `0.0.0.0` | HTTP bind host. |
| `MCP_PORT` | no | `8001` | HTTP bind port, avoiding the Agenta API's `8000`. |

## Connect to the Agenta platform

The MCP server connects to the Agenta **API**, not directly to the web UI. To point it at the right Agenta platform instance:

1. In Agenta, create or copy a project-scoped API key for the project you want the MCP server to author in.
2. Choose the API URL for that platform instance:
   - Agenta Cloud: `https://cloud.agenta.ai/api`
   - EU Cloud / spec server: `https://eu.cloud.agenta.ai/api`
   - Self-hosted from your laptop: `http://localhost/api`
   - Self-hosted Docker Compose sibling service: `http://api:8000`
3. Export the connection settings:

```bash
export AGENTA_API_KEY="agenta-api-key"
export AGENTA_API_URL="https://cloud.agenta.ai/api"
export AGENTA_AUTH_SCHEME="ApiKey"
```

If you use `.env.example` as a starting point:

```bash
cp .env.example .env
$EDITOR .env
set -a && source .env && set +a
```

Confirm the platform connection with the read-only smoke test:

```bash
cd clients/mcp-python
PYTHONPATH=src python3 scripts/smoke.py
```

A successful smoke test prints envelopes for `applications` and evaluator `templates`. If it fails with `401`/`403`, verify that the API key belongs to the intended Agenta project and that `AGENTA_AUTH_SCHEME=ApiKey`.

## Build and run locally

### 1. Create an isolated Python environment

```bash
cd clients/mcp-python
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install --upgrade pip
```

### 2. Install the MCP server package

For development from source:

```bash
python3 -m pip install -e .
```

For a local wheel/sdist-style build using pip:

```bash
python3 -m pip wheel . -w dist
python3 -m pip install dist/agenta_mcp-*.whl
```

### 3. Run for a desktop MCP client over stdio

Stdio is the default and is the right mode for Claude Desktop, Gemini CLI-style clients, and local agent loops that spawn MCP servers as subprocesses:

```bash
AGENTA_API_KEY="agenta-api-key" \
AGENTA_API_URL="https://cloud.agenta.ai/api" \
agenta-mcp
```

### 4. Run for an HTTP-capable MCP client

Use Streamable HTTP when another service connects to the MCP server over the network:

```bash
AGENTA_API_KEY="agenta-api-key" \
AGENTA_API_URL="http://api:8000" \
AGENTA_MCP_TRANSPORT="streamable-http" \
MCP_HOST="0.0.0.0" \
MCP_PORT="8001" \
agenta-mcp
```

The HTTP server listens on `http://<host>:8001/mcp` after startup. When deployed behind the provided Traefik Compose snippet, clients reach it through `/mcp/` and the proxy strips that prefix before forwarding to the server.

## Build and run with Docker

```bash
cd clients/mcp-python
docker build -t agenta-mcp .
```

Run against Agenta Cloud:

```bash
docker run --rm -p 8001:8001 \
  -e AGENTA_API_KEY="agenta-api-key" \
  -e AGENTA_API_URL="https://cloud.agenta.ai/api" \
  -e AGENTA_AUTH_SCHEME="ApiKey" \
  -e AGENTA_MCP_TRANSPORT="streamable-http" \
  agenta-mcp
```

Run as a sibling of the self-hosted Docker Compose API container. Use `agenta-oss-gh-network` for OSS and `agenta-ee-gh-network` for EE:

```bash
docker run --rm --network agenta-oss-gh-network -p 8001:8001 \
  -e AGENTA_API_KEY="agenta-api-key" \
  -e AGENTA_API_URL="http://api:8000" \
  -e AGENTA_AUTH_SCHEME="ApiKey" \
  -e AGENTA_MCP_TRANSPORT="streamable-http" \
  agenta-mcp
```

For a persistent Compose deployment:

- OSS: paste `deploy/compose.snippet.yml` into `hosting/docker-compose/oss/docker-compose.gh.yml`.
- EE: paste `deploy/compose.ee.snippet.yml` into `hosting/docker-compose/ee/docker-compose.gh.yml`.

Set `AGENTA_MCP_API_KEY` in the same environment file used by that stack.

## Connect an MCP client and use Agenta

### Claude Desktop

```json
{
  "mcpServers": {
    "agenta": {
      "command": "agenta-mcp",
      "env": {
        "AGENTA_API_KEY": "agenta-api-key",
        "AGENTA_API_URL": "https://cloud.agenta.ai/api",
        "AGENTA_AUTH_SCHEME": "ApiKey"
      }
    }
  }
}
```

### Gemini / other stdio MCP clients

Use the same command and environment block:

```json
{
  "command": "agenta-mcp",
  "env": {
    "AGENTA_API_KEY": "agenta-api-key",
    "AGENTA_API_URL": "https://cloud.agenta.ai/api"
  }
}
```

### ChatGPT / HTTP-capable internal agent loop

Deploy with `AGENTA_MCP_TRANSPORT=streamable-http` behind your internal gateway at `/mcp/`, then register the internal MCP URL in the client. Keep this endpoint private unless you implement v2 per-user auth.

### In-house agent loop without MCP

The core client has no MCP imports, so internal automation can call Agenta directly:

```python
import asyncio
from agenta_mcp import AgentaClient

async def main():
    client = AgentaClient()
    print(await client.query("application", windowing={"limit": 5}))

asyncio.run(main())
```

### Confirm resources appear in Agenta

After connecting your MCP client, ask it to use tools such as:

- `list_applications` to verify the API key can read the selected project.
- `create_testset` with a small inline row list, then open the Agenta platform UI and check the Testsets area.
- `list_application_templates`, then `create_application` with
  `app_type="chat"`, `app_type="completion"`, or `app_type="custom"`. If
  omitted, `app_type` falls back to `completion`.
- `list_evaluator_templates`, then `create_evaluator` with
  `evaluator_type="auto"` plus `auto_evaluator_type` such as `exact_match`,
  `contains_json`, or `llm_as_a_judge`; or `evaluator_type="human"` for the
  default feedback/quality-rating human evaluator.

All writes happen through the Agenta API using the single `AGENTA_API_KEY` configured on this server, so the created or edited resources show up in the Agenta project associated with that key.

## Tools

| Area | Tool | Purpose |
| --- | --- | --- |
| Applications | `list_applications` | Query applications with cursor windowing. |
| Applications | `get_application` | Fetch one application by UUID. |
| Applications | `get_application_schema` | Return `data.schemas` and current `data.parameters`. |
| Applications | `list_application_templates` | Inspect app catalog templates such as `completion` and `chat`. |
| Applications | `list_application_presets` | Inspect presets for one app template. |
| Applications | `create_application` | Create a chat, completion, or custom app; falls back to completion when `app_type` is omitted. |
| Applications | `update_application_prompt` | Preserve current app data and update one `data.parameters` key. |
| Evaluators | `list_evaluator_templates` | Inspect auto and human evaluator catalog templates. |
| Evaluators | `list_evaluator_presets` | Inspect presets for one evaluator template, such as `feedback`. |
| Evaluators | `list_evaluators` | Query evaluator artifacts. |
| Evaluators | `get_evaluator` | Fetch one evaluator by UUID. |
| Evaluators | `create_evaluator` | Create an auto evaluator by subtype or a human feedback evaluator by preset. |
| Testsets | `list_testsets` | Query testsets. |
| Testsets | `get_testset` | Fetch one testset by UUID. |
| Testsets | `create_testset` | Create a testset from inline rows. |
| Testsets | `upload_testset_file` | Upload CSV/JSON to create or update a testset. |
| Evaluations | `list_evaluations` | Query evaluation configs/runs. |
| Evaluations | `get_evaluation` | Fetch one evaluation config/run by UUID. |
| Evaluations | `create_evaluation` | Create config only; wires revision IDs into `*_steps`; does **not** start a run. |
| Environments | `list_environments` | Read-only environment listing. |

## Verify

Static registration (no network, dummy key):

```bash
cd clients/mcp-python
AGENTA_API_KEY=dummy PYTHONPATH=src python3 - <<'PY'
import asyncio
from agenta_mcp import server

tools = asyncio.run(server.mcp.list_tools())
assert len(tools) == 20, len(tools)
assert all(t.description and t.inputSchema for t in tools)
print(len(tools))
PY
```

Live read smoke test:

```bash
cd clients/mcp-python
AGENTA_API_KEY=... AGENTA_API_URL=https://cloud.agenta.ai/api PYTHONPATH=src python3 scripts/smoke.py
```

Container:

```bash
cd clients/mcp-python
docker build -t agenta-mcp .
docker run --rm -p 8001:8001 \
  -e AGENTA_API_KEY=... \
  -e AGENTA_API_URL=http://host.docker.internal/api \
  -e AGENTA_MCP_TRANSPORT=streamable-http \
  agenta-mcp
```

## Deployment posture and auth boundary

The recommended v1 deployment is **internal-first**: run this MCP server as a sibling service behind the same private Traefik boundary as Agenta, expose it at `/mcp/`, and let it talk to the Agenta API over Docker Compose service DNS (`http://api:8000`).

A hosted MCP server with one `AGENTA_API_KEY` in its environment means **every MCP caller acts as that API key owner**. This is acceptable only behind internal access controls for trusted users/agents. It is **not** acceptable as a public multi-tenant endpoint.

Public multi-tenant access is a v2 task requiring two explicit trust boundaries:

1. Client/user → MCP server authentication and authorization.
2. MCP server → Agenta per-user/per-tenant credentials (for example OAuth/token exchange), instead of one shared environment API key.
