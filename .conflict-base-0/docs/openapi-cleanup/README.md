# OpenAPI Cleanup

Working notes and tooling for keeping the FastAPI surface, the OpenAPI spec, the Fern-generated clients, and the Docusaurus API reference in sync.

## Files

- [`endpoints.md`](endpoints.md) — generated table mapping every static FastAPI route to its operation_id, generated client method, and handler.
- [`summary.md`](summary.md) — high-level summary of the cleanup that just shipped (canonical surface, deprecations, follow-ups).
- [`tracing-cleanup.md`](tracing-cleanup.md) — design + scope of the tracing-API cleanup.
- [`generate.py`](generate.py) — regenerates `endpoints.md` by walking `application/api/` routers and cross-referencing the Fern clients.
- [`research.md`](research.md) — design / cleanup notes.

## Commands

Run from the repo root.

### 1. Regenerate the Fern clients (Python + TypeScript)

```bash
bash ./clients/scripts/generate.sh
# or
bash ./clients/scripts/generate.sh --language python
bash ./clients/scripts/generate.sh --language typescript
bash ./clients/scripts/generate.sh --live   # use cloud OpenAPI instead of localhost
```

Strips operations tagged `Deprecated`, `Admin`, or `OpenTelemetry` before generation. Outputs:
- Python → [`clients/python/agenta_client/`](../../clients/python/agenta_client/)
- TypeScript → [`web/packages/agenta-api-client/src/generated/`](../../web/packages/agenta-api-client/src/generated/)

### 2. Regenerate the API reference docs

```bash
bash ./docs/scripts/update-api-docs.sh
# or
bash ./docs/scripts/update-api-docs.sh --local
bash ./docs/scripts/update-api-docs.sh --file /path/to/openapi.json
```

Pulls the OpenAPI spec, drops it at [`docs/docs/reference/openapi.json`](../docs/reference/openapi.json), and runs the Docusaurus `gen-api-docs` plugin.

### 3. Regenerate this directory's routes-and-endpoints table

```bash
python3 ./docs/openapi-cleanup/generate.py
```

Reads:
- routers under `application/api/oss/src/apis/fastapi/*/router.py`, `application/api/oss/src/routers/*.py`, and `application/api/ee/src/apis/fastapi/*/router.py`
- the generated Fern clients in [`clients/python/agenta_client/`](../../clients/python/agenta_client/) and [`web/packages/agenta-api-client/src/generated/`](../../web/packages/agenta-api-client/src/generated/)

Writes [`endpoints.md`](endpoints.md). Routes are split into a *mapped* table (operation_id resolves to a generated client method) and an *unmapped* table (admin-stripped or hidden from the public OpenAPI spec).

## Typical workflow

```bash
# Update the API → regenerate clients → regenerate reference docs → refresh the table
bash ./clients/scripts/generate.sh --local
bash ./docs/scripts/update-api-docs.sh --local
python3 ./docs/openapi-cleanup/generate.py
```

Run the table generator last — it inspects the freshly generated clients to fill in the TS/Python columns.
