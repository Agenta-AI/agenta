# feat(api,web): Add Gateway Tools — Composio integration for LLM tool execution

## Summary

Introduces a **Gateway Tools** system that lets users connect external tool providers (initially Composio) to Agenta projects and execute tool actions directly from the LLM playground. Tool calls are expressed in the OpenAI function-calling format so they flow naturally into the existing chat/completion pipeline.

---

## What Changed

### Backend — New Domain (`api/oss/src/`)

| Layer | Path | Description |
|-------|------|-------------|
| **API** | `apis/fastapi/tools/` | FastAPI router, Pydantic request/response models, query-param utils |
| **Core** | `core/tools/` | DTOs, typed exceptions, DAO/adapter interfaces, service orchestrator |
| **Adapter** | `core/tools/providers/composio/` | httpx-based Composio V3 API client (catalog + execution) |
| **Registry** | `core/tools/registry.py` | Dispatch-by-provider-key adapter registry |
| **DB** | `dbs/postgres/tools/` | `ToolConnectionDBE`, `ToolsDAO`, DTO↔DBE mappings |
| **Migration** | `databases/postgres/migrations/…/e5f6a1b2c3d4` | Creates `tool_connections` table (OSS + EE) |
| **Crons** | `crons/tools.sh` + `tools.txt` | Background status-sync cron |

**Wiring:** `api/entrypoints/routers.py` — `ToolsDAO`, `ComposioAdapter`, `GatewayAdapterRegistry`, and `ToolsRouter` are instantiated and mounted under `/preview/tools`.

### API Endpoints (prefix `/preview/tools`)

```
GET  /catalog/providers/
GET  /catalog/providers/{provider_key}
GET  /catalog/providers/{provider_key}/integrations/
GET  /catalog/providers/{provider_key}/integrations/{integration_key}
GET  /catalog/providers/{provider_key}/integrations/{integration_key}/actions/
GET  /catalog/providers/{provider_key}/integrations/{integration_key}/actions/{action_key}

POST /connections/query
POST /connections/
GET  /connections/callback          ← OAuth redirect target (returns HTML card)
GET  /connections/{connection_id}
DELETE /connections/{connection_id}
POST /connections/{connection_id}/refresh
POST /connections/{connection_id}/revoke

POST /call                          ← Execute a tool (OpenAI function-call envelope)
```

### Database

New table `tool_connections`:

```
project_id (PK, FK → projects.id CASCADE)
id         (PK, UUID)
slug       (VARCHAR, UNIQUE per project/provider/integration)
kind       (ENUM: composio | agenta)
provider_key + integration_key (VARCHAR)
tags / flags / data / status / meta  (JSONB / JSON)
created_at / updated_at / deleted_at + …_by_id columns
```

### Frontend — New UI (`web/oss/src/`)

| Area | Path | Description |
|------|------|-------------|
| **Settings page** | `components/pages/settings/Tools/` | Manage connections: provider grid, integration detail, connect modal, connection list |
| **Feature module** | `features/gateway-tools/` | Drawers (catalog, connect, connection manager, execute), hooks, Jotai atoms, schema utilities |
| **Playground** | `components/Playground/…` | `GatewayToolsPanel` (variant config), `GatewayToolExecuteButton` (generation turn), tool result rendering in `TurnMessageAdapter` and `ActionsOutputRenderer` |
| **Sidebar** | `components/Sidebar/SettingsSidebar.tsx` | Tools nav item added |

### EE Extensions

- `ee/src/models/shared_models.py` — `VIEW_TOOLS`, `EDIT_TOOLS`, `RUN_TOOLS` permissions added
- EE migration mirror at `api/ee/databases/postgres/migrations/…/e5f6a1b2c3d4`
- Docker compose files updated for `COMPOSIO_API_KEY` env var

---

## Architecture Decisions

1. **Adapter pattern** — `GatewayAdapterInterface` + `GatewayAdapterRegistry` make it easy to add new providers without touching service or router code.
2. **`/preview/*` mount** — ships behind the preview prefix; stable endpoints can be promoted later without breaking existing clients.
3. **OpenAI-compatible tool call envelope** — `ToolCall` / `ToolResult` mirror the OpenAI `tool_calls` array format so results are dropped verbatim into the LLM message history.
4. **No Composio SDK dependency** — uses raw `httpx` against the Composio V3 REST API to avoid pinning a third-party SDK that is still evolving rapidly.
5. **OAuth callback returns HTML** — the `/connections/callback` endpoint returns a self-contained HTML status card so the OAuth redirect lands in a friendly browser page rather than raw JSON.
6. **Redis caching on catalog reads** — 5-minute TTL on provider/integration/action catalog responses to avoid hammering the Composio API on every page load.
7. **Agenta provider scaffolding** — `providers/agenta/` skeleton (all empty files) reserves the namespace for future Agenta-native tool execution without requiring a separate PR.

---

## Configuration

| Env Var | Default | Required |
|---------|---------|----------|
| `COMPOSIO_API_KEY` | — | Yes — presence enables Composio automatically |
| `COMPOSIO_API_URL` | `https://backend.composio.dev/api/v3` | No |

---

## Testing

Manual HTTP test collections are included:

```
api/oss/tests/manual/tools/catalog.http    — catalog browsing
api/oss/tests/manual/tools/tools.http      — connections + execution
api/oss/tests/manual/composio/             — Composio-specific flows
```

See `api/oss/tests/manual/tools/README.md` for step-by-step instructions.

---

## Checklist

- [x] Ruff format + lint pass (`ruff format`, `ruff check --fix`)
- [x] ESLint pass (`pnpm lint-fix` in `web/`)
- [x] OSS + EE migrations in sync
- [x] Domain exceptions defined in core, caught at router boundary
- [x] Service methods return typed DTOs (no raw dicts)
- [x] EE permission guards on all endpoints
- [x] Manual test collections provided
- [ ] Automated tests (follow-up — scope is wide enough for a dedicated test PR)
