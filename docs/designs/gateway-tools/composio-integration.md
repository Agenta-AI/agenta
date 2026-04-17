# Gateway Tools — Composio Integration

How Agenta integrates with the Composio API (v3) as the first gateway provider.

---

## Composio API Overview

- **Base URL**: `https://backend.composio.dev/api/v3`
- **Auth**: Header `x-api-key: <COMPOSIO_API_KEY>`
- **Pagination**: Cursor-based (`cursor` + `limit` params, `next_cursor` in response)
- **Rate Limits**: 20k requests / 10 min (starter/hobby), 100k (growth)
- **IDs**: Connected accounts and auth configs use nanoid format (e.g., `ca_abc123`, `ac_xyz789`)

---

## Concept Mapping

| Composio | Agenta | Notes |
|----------|--------|-------|
| **User ID** | `project_{project_id}` | Scopes all connected accounts to an Agenta project |
| **Toolkit** | Provider (e.g., `gmail`) | Collection of related tools |
| **Tool** | Capability/Action | Individual executable action (e.g., `GMAIL_SEND_EMAIL`) |
| **Auth Config** | (internal) | Blueprint for how auth works for a toolkit. Created once, reused for all connections. |
| **Connected Account** | Connection | Authenticated binding between a user and a toolkit |
| **Tool slug** | Action name | Composio format: `TOOLKIT_ACTION` (e.g., `GITHUB_CREATE_ISSUE`) |

### User ID Strategy

Composio scopes connected accounts by `user_id`. We derive it from the Agenta project ID:

```
user_id = f"project_{project_id}"
```

This means all connections within an Agenta project share the same Composio user scope. A single Composio user can have multiple connected accounts for the same toolkit (e.g., two Gmail accounts).

### Tool Slug Mapping

Composio uses `TOOLKIT_ACTION` format internally. Agenta uses `tools.gateway.{provider}.{tool}` externally.

```
Agenta slug:    tools.gateway.gmail.SEND_EMAIL
Composio slug:  GMAIL_SEND_EMAIL
```

The adapter translates between these formats:
- **Agenta → Composio**: `provider.upper() + "_" + tool_name` → `GMAIL_SEND_EMAIL`
- **Composio → Agenta**: Split on first `_`, lowercase the toolkit → `tools.gateway.gmail.SEND_EMAIL`

Edge case: some Composio tool slugs have underscores in both the toolkit and action parts (e.g., `GOOGLE_CALENDAR_CREATE_EVENT`). We need to look up the toolkit slug to split correctly, or use the `toolkit.slug` field from the tool response.

---

## Auth Config Management

Before users can connect to a toolkit, an **auth config** must exist. This is a one-time setup per toolkit.

### What is an Auth Config?

A blueprint defining:
- Authentication method (OAuth2, API Key, Bearer Token, etc.)
- Permission scopes
- Whether Composio manages the OAuth credentials or we provide our own
- Reusable across all users

### Strategy

For v1, use **Composio-managed auth** (simplest path). Agenta does not need to register its own OAuth apps.

```
POST /api/v3/auth_configs

{
  "toolkit": { "slug": "gmail" },
  "auth_config": {
    "type": "use_composio_managed_auth",
    "name": "Agenta Gmail OAuth",
    "credentials": { "scopes": "https://mail.google.com/" }
  }
}
```

**Response:**
```json
{
  "id": "ac_abc123",
  "name": "Agenta Gmail OAuth",
  "type": "use_composio_managed_auth",
  "auth_scheme": "OAUTH2",
  "status": "active",
  "is_composio_managed": true,
  "toolkit": { "slug": "gmail", "logo": "..." },
  ...
}
```

### Auth Config Lifecycle

- Created once per toolkit (per Composio project)
- Stored in Composio, referenced by `auth_config_id`
- We store the `auth_config_id` in an env var, config file, or database
- **Decision needed**: Where to persist the mapping `{toolkit_slug → auth_config_id}`? Options:
  1. Create on demand and cache in memory (simplest, but lost on restart)
  2. Store in a config table or env vars (persistent)
  3. List existing auth configs and match by toolkit slug (API call per request)

**Recommended**: Option 3 for v1 — list auth configs filtered by toolkit, cache the mapping in-memory with TTL.

---

## Composio Endpoints Used

We use 7 Composio API endpoints. No SDK dependency — all calls via `httpx`.

### 1. List Toolkits (Catalog — Integrations)

```
GET /api/v3/toolkits
```

| Param | Value | Purpose |
|-------|-------|---------|
| `limit` | 100 | Page size |
| `cursor` | (pagination) | Next page |

**Response fields we use:**
```
items[].slug           → provider slug (gmail, github, ...)
items[].name           → display name
items[].status         → active/inactive
items[].no_auth        → whether auth is needed
items[].auth_schemes   → supported auth methods
items[].meta.description → description
items[].meta.logo      → icon URL
items[].meta.tools_count → number of available tools
```

**Caching**: TTL 5 min. Toolkit list rarely changes.

### 2. List Tools (Catalog — Actions)

```
GET /api/v3/tools?toolkit_slug={slug}
```

| Param | Value | Purpose |
|-------|-------|---------|
| `toolkit_slug` | `gmail` | Filter by toolkit |
| `important` | `true` | Only featured tools (optional, reduces noise) |
| `limit` | 100 | Page size |
| `cursor` | (pagination) | Next page |

**Response fields we use:**
```
items[].slug              → GMAIL_SEND_EMAIL (Composio tool slug)
items[].name              → "Send Email" (display name)
items[].description       → human-readable description
items[].input_parameters  → JSON Schema for inputs
items[].output_parameters → JSON Schema for outputs
items[].toolkit.slug      → "gmail" (needed for slug mapping)
items[].tags              → tags for categorization
items[].scopes            → OAuth scopes required
```

**Caching**: TTL 5 min per toolkit.

### 3. Get Tool Detail (Full Schema)

```
GET /api/v3/tools/{tool_slug}
```

Returns the same shape as list items but always includes full `input_parameters` and `output_parameters`.

**Caching**: TTL 5 min per tool slug.

### 4. List Auth Configs (Resolve Auth Config ID)

```
GET /api/v3/auth_configs?toolkit_slugs={slug}
```

Used internally to find or create the auth config for a toolkit before initiating a connection.

**Caching**: TTL 10 min.

### 5. Initiate Connection (Create Connected Account Link)

```
POST /api/v3/connected_accounts/link
```

**Request:**
```json
{
  "user_id": "project_019abc12-3456-7890",
  "auth_config_id": "ac_abc123",
  "callback_url": "https://app.agenta.ai/tools/callback"
}
```

**Response:**
```json
{
  "id": "ca_def456",
  "status": "INITIATED",
  "redirect_url": "https://connect.composio.dev/link/ln_abc123..."
}
```

The `/link` endpoint creates a Composio-hosted authentication page. This is cleaner than the raw `POST /connected_accounts` endpoint because:
- Composio handles the OAuth redirect chain
- Works for OAuth, API key, and other auth methods uniformly
- The hosted page is brandable

### 6. Get Connected Account (Poll Status)

```
GET /api/v3/connected_accounts/{nanoid}
```

**Response fields we use:**
```
id                → connected account nanoid
status            → INITIALIZING | INITIATED | ACTIVE | FAILED | EXPIRED | INACTIVE
auth_config.id    → auth config reference
auth_config.auth_scheme → OAUTH2, API_KEY, etc.
```

**Status mapping to Agenta ConnectionStatus:**

| Composio Status | Agenta Status |
|-----------------|---------------|
| `INITIALIZING` | `pending` |
| `INITIATED` | `pending` |
| `ACTIVE` | `active` |
| `FAILED` | `failed` |
| `EXPIRED` | `expired` |
| `INACTIVE` | `expired` |

### 7. Execute Tool

```
POST /api/v3/tools/execute/{tool_slug}
```

**Request:**
```json
{
  "arguments": {
    "to": "alice@example.com",
    "subject": "Hello",
    "body": "Hi!"
  },
  "connected_account_id": "ca_def456"
}
```

**Response:**
```json
{
  "successful": true,
  "data": {
    "message_id": "msg_xyz",
    "status": "sent"
  },
  "error": null,
  "log_id": "log_abc"
}
```

| Field | Handling |
|-------|----------|
| `successful=true` | Build `ToolMessage` with `content=json.dumps(data)` |
| `successful=false` | Build `ToolError` with `code=PROVIDER_ERROR`, `message=error` |

### 8. Delete Connected Account

```
DELETE /api/v3/connected_accounts/{nanoid}
```

Permanently removes the account and revokes credentials. Irreversible.

### 9. Refresh Connected Account (Optional)

```
POST /api/v3/connected_accounts/{nanoid}/refresh
```

Manually triggers credential refresh. Composio handles OAuth token refresh automatically for ACTIVE accounts, so this is mainly for recovering EXPIRED accounts.

---

## Connection Flow (End-to-End)

```
┌──────────┐     ┌──────────────┐     ┌───────────────┐     ┌──────────┐
│ Frontend  │     │ Agenta API   │     │ Composio API  │     │ Provider │
│          │     │ /tools│     │   v3          │     │ (Gmail)  │
└─────┬────┘     └──────┬───────┘     └──────┬────────┘     └────┬─────┘
      │                  │                     │                   │
      │ POST /connections│                     │                   │
      │ {provider: gmail,│                     │                   │
      │  mode: oauth}    │                     │                   │
      │─────────────────>│                     │                   │
      │                  │                     │                   │
      │                  │ GET /auth_configs    │                   │
      │                  │ ?toolkit_slugs=gmail │                   │
      │                  │────────────────────>│                   │
      │                  │                     │                   │
      │                  │  {id: "ac_abc123"}  │                   │
      │                  │<────────────────────│                   │
      │                  │                     │                   │
      │                  │ POST /connected_accounts/link            │
      │                  │ {user_id, auth_config_id, callback_url} │
      │                  │────────────────────>│                   │
      │                  │                     │                   │
      │                  │ {id: "ca_def456",   │                   │
      │                  │  redirect_url: ...} │                   │
      │                  │<────────────────────│                   │
      │                  │                     │                   │
      │                  │ INSERT connection    │                   │
      │                  │ (tools,   │                   │
      │                  │  status=pending,     │                   │
      │                  │  ca_id=ca_def456)    │                   │
      │                  │                     │                   │
      │ {connection,     │                     │                   │
      │  redirect_url}   │                     │                   │
      │<─────────────────│                     │                   │
      │                  │                     │                   │
      │ OPEN POPUP ──────────────────────────────────────────────>│
      │ (redirect_url)   │                     │                   │
      │                  │                     │    OAuth consent  │
      │                  │                     │<──────────────────│
      │                  │                     │                   │
      │                  │                     │  OAuth callback   │
      │                  │                     │──────────────────>│
      │ POPUP CLOSES     │                     │                   │
      │                  │                     │                   │
      │ GET /connections/│                     │                   │
      │ {connection_id}  │                     │                   │
      │ (polling)        │                     │                   │
      │─────────────────>│                     │                   │
      │                  │ GET /connected_accounts/ca_def456       │
      │                  │────────────────────>│                   │
      │                  │                     │                   │
      │                  │ {status: "ACTIVE"}  │                   │
      │                  │<────────────────────│                   │
      │                  │                     │                   │
      │                  │ UPDATE connection    │                   │
      │                  │ (status=active)      │                   │
      │                  │                     │                   │
      │ {connection:     │                     │                   │
      │  status=active}  │                     │                   │
      │<─────────────────│                     │                   │
```

---

## Tool Execution Flow

```
┌──────────────┐     ┌──────────────┐     ┌───────────────┐
│ Agent Service│     │ Agenta API   │     │ Composio API  │
│              │     │ /tools│     │   v3          │
└──────┬───────┘     └──────┬───────┘     └──────┬────────┘
       │                     │                     │
       │ POST /run           │                     │
       │ {tool_calls: [...]} │                     │
       │────────────────────>│                     │
       │                     │                     │
       │                     │ 1. parse_tool_slug  │
       │                     │    "tools.gateway.gmail.SEND_EMAIL.support_inbox"
       │                     │    → provider=gmail, tool=SEND_EMAIL, slug=support_inbox
       │                     │                     │
       │                     │ 2. resolve connection│
       │                     │    (DAO lookup by    │
       │                     │     provider+slug)   │
       │                     │                     │
       │                     │ 3. extract from row: │
       │                     │    gateway_kind=composio
       │                     │    auth_data.ca_id   │
       │                     │    gateway_api_key   │
       │                     │                     │
       │                     │ 4. map tool slug    │
       │                     │    SEND_EMAIL → GMAIL_SEND_EMAIL
       │                     │                     │
       │                     │ POST /tools/execute/GMAIL_SEND_EMAIL
       │                     │ {arguments: {...},   │
       │                     │  connected_account_id: "ca_def456"}
       │                     │────────────────────>│
       │                     │                     │
       │                     │ {successful: true,   │
       │                     │  data: {...}}        │
       │                     │<────────────────────│
       │                     │                     │
       │                     │ 5. build ToolMessage │
       │                     │                     │
       │ {tool_messages: [..],                     │
       │  errors: []}        │                     │
       │<────────────────────│                     │
```

---

## What We Store in auth_data

When a connection is created, the Composio adapter returns provider-specific refs. These are stored in the `auth_data` JSONB column of the `tools` row:

```json
{
  "mode": "oauth",
  "connected_account_id": "ca_def456",
  "user_id": "project_019abc12-3456-7890",
  "auth_config_id": "ac_abc123"
}
```

| Stored Field | Source | Used For |
|-------------|--------|----------|
| `connected_account_id` | `POST /connected_accounts/link` response | Tool execution, status polling, refresh, delete |
| `user_id` | Derived from project ID | Composio user scoping |
| `auth_config_id` | `GET /auth_configs` lookup | Reference (not needed for execution) |

Other tool columns (e.g., `provider`, `slug`, `gateway_kind`, `status`, `gateway_api_key`) are stored as dedicated columns on the `tools` table — not inside `auth_data`.

We do **not** store OAuth tokens. Composio manages token storage and refresh.

---

## ComposioAdapter Implementation Outline

```python
class ComposioAdapter(GatewayAdapterInterface):
    def __init__(
        self,
        *,
        api_url: str = "https://backend.composio.dev/api/v3",
        default_api_key: str | None = None,
    ):
        self.api_url = api_url
        self.default_api_key = default_api_key
        self._toolkit_cache = TTLCache(maxsize=200, ttl=300)
        self._tool_cache = TTLCache(maxsize=1000, ttl=300)
        self._auth_config_cache = TTLCache(maxsize=100, ttl=600)

    def _headers(self, gateway_api_key: str | None = None) -> dict:
        key = gateway_api_key or self.default_api_key
        if not key:
            raise ProviderError("No Composio API key available")
        return {"x-api-key": key, "Content-Type": "application/json"}

    def _to_composio_slug(self, provider: str, tool_name: str) -> str:
        """gmail + SEND_EMAIL → GMAIL_SEND_EMAIL"""
        return f"{provider.upper()}_{tool_name}"

    def _from_composio_slug(self, composio_slug: str, toolkit_slug: str) -> tuple[str, str]:
        """GMAIL_SEND_EMAIL + gmail → (gmail, SEND_EMAIL)"""
        prefix = toolkit_slug.upper() + "_"
        if composio_slug.startswith(prefix):
            tool_name = composio_slug[len(prefix):]
        else:
            tool_name = composio_slug
        return toolkit_slug, tool_name
```

### Method → Composio Endpoint Mapping

| Adapter Method | Composio Endpoint | Notes |
|----------------|-------------------|-------|
| `list_catalog(query)` | `GET /toolkits` + `GET /tools?toolkit_slug=...` | List toolkits first, then tools per toolkit. Cached. |
| `get_catalog_entry(slug)` | `GET /tools/{composio_slug}` | Parse Agenta slug, convert to Composio slug. |
| `initiate_connection(...)` | `GET /auth_configs` + `POST /connected_accounts/link` | Resolve auth config first, then create link. |
| `check_connection_status(...)` | `GET /connected_accounts/{ca_id}` | Map Composio status to Agenta ConnectionStatus. |
| `execute_tool(...)` | `POST /tools/execute/{composio_slug}` | Pass `connected_account_id` + arguments. |
| `refresh_connection(...)` | `POST /connected_accounts/{ca_id}/refresh` | Triggers credential refresh. |
| `delete_connection(...)` | `DELETE /connected_accounts/{ca_id}` | Permanent deletion. |

---

## Error Mapping

| Composio Error | HTTP | Agenta Error Code |
|----------------|------|-------------------|
| 401 (invalid API key) | — | `PROVIDER_ERROR` (config issue) |
| 404 (tool not found) | — | `TOOL_NOT_FOUND` |
| 404 (connected account not found) | — | `CONNECTION_NOT_FOUND` |
| 422 (invalid arguments) | — | `INVALID_ARGUMENTS` |
| 429 (rate limited) | — | `PROVIDER_RATE_LIMITED` |
| 5xx (server error) | — | `PROVIDER_UNAVAILABLE` |
| Execute response `successful=false` | — | `PROVIDER_ERROR` with `details.error` |

Rate limit headers (`X-RateLimit-Remaining`, `Retry-After`) should be logged and used for backoff.

---

## Caching Strategy

| Data | Cache Key | TTL | Reason |
|------|-----------|-----|--------|
| Toolkit list | `toolkits` | 5 min | Rarely changes |
| Tools per toolkit | `tools:{toolkit_slug}` | 5 min | Rarely changes |
| Tool detail | `tool:{composio_slug}` | 5 min | Schema rarely changes |
| Auth configs | `auth_config:{toolkit_slug}` | 10 min | Created once, stable |

All caches use `cachetools.TTLCache` (in-memory, per-process). No shared cache needed for v1.

---

## Environment Configuration

```bash
# Required for Composio integration
COMPOSIO_API_KEY=cmp_live_...

# Optional: override Composio API base URL (for testing/staging)
COMPOSIO_API_URL=https://backend.composio.dev/api/v3
```

---

## Open Questions

1. **Auth Config creation**: Should Agenta auto-create auth configs on first connection attempt per toolkit, or require pre-configuration? Recommendation: auto-create with Composio-managed auth for v1.

2. **Tool slug disambiguation**: Composio slugs like `GOOGLE_CALENDAR_CREATE_EVENT` have underscores in both toolkit and action. We use `toolkit.slug` from the API response to split correctly. Need to verify this is always available.

3. **Composio-managed vs custom OAuth**: For v1 we use Composio-managed OAuth (no custom OAuth app setup needed). For v2, users may want white-label OAuth with their own credentials — the `gateway_api_key` + auth config customization supports this.

4. **Webhook vs polling for connection status**: Composio supports webhooks for connection status changes. For v1 we poll (simpler). Webhooks could improve UX in v2.
