# Client Packages

This directory will hold generated client packages split by language.

Planned layout:

```text
clients/
  python/
  typescript/
```

Primary entrypoint:

- `clients/scripts/generate.sh`

Use `--language python`, `--language typescript`, or `--language all`.

The top-level script contains the language-specific generation logic.

Defaults:

- `--language all`
- `--openapi-url http://localhost/api/openapi.json`

Examples:

```bash
bash ./clients/scripts/generate.sh
```

```bash
bash ./clients/scripts/generate.sh --openapi-url http://localhost/api/openapi.json
```

```bash
bash ./clients/scripts/generate.sh --language python
```

```bash
bash ./clients/scripts/generate.sh --language typescript
```

## MCP server client

The standalone Agenta MCP server lives in [`clients/mcp-python`](mcp-python/). Use it when you want an MCP client or in-house agent loop to author Agenta resources through the confirmed `/simple/*` API surface.

Quick local run against Agenta Cloud:

```bash
cd clients/mcp-python
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -e .
AGENTA_API_KEY="agenta-api-key" \
AGENTA_API_URL="https://cloud.agenta.ai/api" \
agenta-mcp
```

For self-hosted Docker/HTTP deployments, run it with `AGENTA_MCP_TRANSPORT=streamable-http` and point `AGENTA_API_URL` at the internal API service, for example `http://api:8000`. See [`clients/mcp-python/README.md`](mcp-python/README.md) for build, Docker, MCP client configuration, and platform connection instructions.
