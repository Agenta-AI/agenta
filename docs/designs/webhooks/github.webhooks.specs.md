# Webhook Extensions Spec

## Overview

Extend the webhook delivery system to support flexible authorization, GitHub Actions compatibility, custom payload shaping, and idempotency headers. These changes compose to allow Agenta webhooks to trigger GitHub `repository_dispatch` and `workflow_dispatch` endpoints natively.

---

## 1. Credential / Secret Authorization

### Current Behavior
- Agenta auto-generates a 32-char secret on subscription creation
- Secret computes `X-Agenta-Signature: t={ts},v1={hmac_sha256}` header
- No `Authorization` header is sent

### New Behavior

The user explicitly sets `auth_mode` at subscription creation:

| `auth_mode` | Secret provided? | Behavior |
|-------------|-----------------|----------|
| `"signature"` (default) | No | Agenta generates secret → HMAC signature in `X-Agenta-Signature` |
| `"signature"` | Yes | User's secret used for HMAC signing → `X-Agenta-Signature` (no Agenta-generated secret) |
| `"authorization"` | Yes (required) | Secret sent as-is in `Authorization` header → no HMAC |
| `"authorization"` | No | **Error** — raises `WebhookAuthorizationSecretRequiredError` |

**Rules:**
- `auth_mode` is explicitly set by the user, not inferred
- **`"signature"`**: secret is used for HMAC computation (`X-Agenta-Signature`). If no secret provided, Agenta generates one.
- **`"authorization"`**: secret is sent as-is in `Authorization` header. User must provide the secret (including scheme prefix, e.g. `"Bearer ghp_xxxx"`). No HMAC is computed.
- The secret is stored in the vault the same way regardless of mode (as `SecretKind.WEBHOOK_PROVIDER`)

**`WebhookSubscriptionData`:**
```python
class WebhookSubscriptionData(BaseModel):
    url: HttpUrl
    headers: Optional[Dict[str, str]] = None
    event_types: Optional[List[WebhookEventType]] = None
    auth_mode: Optional[Literal["signature", "authorization"]] = None
    payload_fields: Optional[Dict[str, Any]] = None
```

- `auth_mode` defaults to `None` → resolved as `"signature"` at delivery time
- The dispatcher reads `auth_mode` from `sub.data.auth_mode` and passes it to the delivery task
- The delivery task resolves `auth_mode` (`None` → `"signature"`) and decides: `"signature"` → compute `X-Agenta-Signature`, `"authorization"` → set `Authorization: {key}`

### Files Affected
- `api/oss/src/core/webhooks/types.py` — add `auth_mode` field to `WebhookSubscriptionData`
- `api/oss/src/core/webhooks/exceptions.py` — add `WebhookAuthorizationSecretRequiredError`
- `api/oss/src/core/webhooks/service.py` — accept user-provided secret; use it instead of generating one; raise `WebhookAuthorizationSecretRequiredError` when `auth_mode="authorization"` and no secret
- `api/oss/src/tasks/taskiq/webhooks/tasks.py` — conditionally produce `Authorization` OR `X-Agenta-Signature` based on `auth_mode`
- `api/oss/src/tasks/asyncio/webhooks/dispatcher.py` — pass `auth_mode` from subscription data to delivery task

---

## 2. Event ID + Idempotency Key Headers

### Current Behavior
- `X-Agenta-Delivery-Id: {delivery_uuid}` — unique per delivery (event + subscription pair), stable across retries

### New Behavior
- **Keep** `X-Agenta-Delivery-Id: {delivery_id}` — unique per delivery (event + subscription pair), stable across retries (unchanged)
- **Add** `X-Agenta-Event-Id: {event_id}` — stable across retries of the same event
- **Add** `Idempotency-Key: {delivery_id}` — standard idempotency header, same value as delivery ID

### Files Affected
- `api/oss/src/tasks/taskiq/webhooks/tasks.py`:
  - Add `X-Agenta-Event-Id` and `Idempotency-Key` to `system_headers`
  - Update `NON_OVERRIDABLE_HEADERS`: add `x-agenta-event-id` and `idempotency-key`

---

## 3. Payload is the Full Event (not just attributes)

### Current Behavior
- The webhook body is `event.attributes` only — a subset of the Event object
- `event_type`, `event_id`, `timestamp`, etc. are only sent as HTTP headers

### New Behavior
- The webhook payload is built from a **context** containing the event, subscription, and scope (see Section 5 for full context structure)
- The default payload includes all three context sections: `event`, `subscription`, `scope`
- The event is the full `Event` object (filtered through `EVENT_CONTEXT_FIELDS`) — `event_type`, `event_id`, `timestamp`, `request_id`, `attributes`, etc. are all available
- No separate injection of `event_type` needed — it's part of the event in the context

### Files Affected
- `api/oss/src/tasks/asyncio/webhooks/dispatcher.py` — build context dict from event + subscription + scope, pass to delivery task
- `api/oss/src/tasks/taskiq/webhooks/tasks.py` — resolve `payload_fields` against context to build payload; remove any `event_type` injection logic

---

## 4. Rename `WebhookDeliveryData.body` → `WebhookDeliveryData.payload`

### Current Behavior
- `WebhookDeliveryData.body` stores the HTTP body that was sent

### New Behavior
- Rename to `WebhookDeliveryData.payload` — the resolved HTTP payload after `payload_fields` resolution
- The delivery task receives `event`, `subscription`, and `project_id` separately, builds the context (see Section 5), resolves `payload_fields`, and stores the result in `WebhookDeliveryData.payload`

### Files Affected
- `api/oss/src/core/webhooks/types.py` — rename field on `WebhookDeliveryData`
- `api/oss/src/tasks/taskiq/webhooks/tasks.py` — rename local variables, store resolved payload
- `api/oss/src/tasks/asyncio/webhooks/dispatcher.py` — pass event, subscription, project_id to delivery task
- `api/oss/src/tasks/taskiq/webhooks/worker.py` — update task signature if needed

---

## 5. Payload Fields — Unified Body Shaping

### Current Behavior
- The HTTP body IS `event.attributes` directly — a flat dict with no control over structure
- No way to nest the event, extract fields, or add static keys

### Resolution Context

At delivery time, a **context** dict is built from three sources. Each source is positively filtered via a global allowlist — only listed fields are included.

```python
# --- CONTEXT ALLOWLISTS (global) ------------------------------------------- #

EVENT_CONTEXT_FIELDS = {
    "event_id",
    "event_type",
    "timestamp",
    "created_at",
    "attributes",
}

SUBSCRIPTION_CONTEXT_FIELDS = {
    "id",
    "name",
    "flags",
    "tags",
    "meta",
    "created_at",
    "updated_at",
}
```

```python
context = {
    "event": {k: v for k, v in serialized_event.items() if k in EVENT_CONTEXT_FIELDS},
    "subscription": {k: v for k, v in serialized_sub.items() if k in SUBSCRIPTION_CONTEXT_FIELDS},
    "scope": {"project_id": str(project_id)},
}
```

| Context key | Source | Included fields |
|-------------|--------|-----------------|
| `event` | Serialized `Event` | `event_id`, `event_type`, `timestamp`, `created_at`, `attributes` |
| `subscription` | Serialized `WebhookSubscription` | `id`, `name`, `flags`, `tags`, `meta`, `created_at`, `updated_at` |
| `scope` | Delivery context | `project_id` |

**Excluded from event**: `request_id`, `request_type`, `status_code`, `status_message`, lifecycle fields except `created_at`
**Excluded from subscription**: `data` (url, headers, auth_mode, payload_fields), `secret_id`, `secret`, `description`, `deleted_at`, `*_by_id`

### New Behavior
- New field on `WebhookSubscriptionData`: `payload_fields: Optional[Dict[str, Any]] = None`
- A single dict that defines the entire HTTP body structure
- The structure is resolved **recursively** against the context — dicts, lists, and primitives are all walked:
  - **dict** → recurse into values (keys are always plain strings)
  - **list** → recurse into items
  - **primitive** (string, number, bool, null) → passed to `resolve_json_selector`
- `resolve_json_selector` (from `sdk/agenta/sdk/workflows/handlers.py`) handles primitives only:
  - **JSON Path** (prefix `$`): resolved against the context — `"$"` = entire context, `"$.event.event_type"` = `context["event"]["event_type"]`
  - **JSON Pointer** (prefix `/`): resolved against the context — `"/event/event_type"` = `context["event"]["event_type"]`
  - **Missing path or resolution error** → returns `None`
  - **Anything else** (plain strings, numbers, bools, null): used as a static value as-is
- `resolve_payload_fields` is a thin recursive wrapper with depth limiting that walks the structure down to primitives, then delegates to `resolve_json_selector`
- When `payload_fields` is `None` (default), delivery falls back to `"$"` — the full context

### Resolution Logic

```python
MAX_RESOLVE_DEPTH = 10

def resolve_payload_fields(fields, context, *, _depth=0):
    if _depth > MAX_RESOLVE_DEPTH:
        return None
    if isinstance(fields, dict):
        return {k: resolve_payload_fields(v, context, _depth=_depth + 1) for k, v in fields.items()}
    if isinstance(fields, list):
        return [resolve_payload_fields(item, context, _depth=_depth + 1) for item in fields]
    return resolve_json_selector(fields, context)
```

- `resolve_json_selector` is flat — no recursion, primitives only
- `resolve_payload_fields` is the recursive wrapper — handles dicts, lists, delegates primitives
- On missing path or any resolution error, `resolve_json_selector` returns `None` (never raises)
- Recursion beyond `MAX_RESOLVE_DEPTH` (10) returns `None`

### Value Resolution Examples

| Value | Type | Result |
|-------|------|--------|
| `"$"` | JSON Path (root) | Entire context |
| `"$.event"` | JSON Path | Full event object |
| `"$.event.event_type"` | JSON Path | `context["event"]["event_type"]` |
| `"$.event.attributes.user_id"` | JSON Path | `context["event"]["attributes"]["user_id"]` |
| `"$.subscription.name"` | JSON Path | `context["subscription"]["name"]` |
| `"$.subscription.tags"` | JSON Path | `context["subscription"]["tags"]` |
| `"$.scope.project_id"` | JSON Path | `context["scope"]["project_id"]` |
| `"/event/event_type"` | JSON Pointer | `context["event"]["event_type"]` |
| `"main"` | Static string | `"main"` |
| `42` | Static number | `42` |
| `"$.event.attributes.nonexistent"` | Missing path | `None` |
| `{"type": "$.event.event_type", "meta": {"id": "$.event.event_id"}}` | Nested dict | `{"type": "environments...", "meta": {"id": "019..."}}` |
| `["$.event.event_type", "production"]` | List | `["environments...", "production"]` |

### Example — default (no `payload_fields`)
Fallback: `"$"` (entire context)

```json
{
  "event": {
    "event_id": "01961234-5678-7abc-...",
    "event_type": "environments.revisions.committed",
    "timestamp": "2026-03-04T12:00:00Z",
    "created_at": "2026-03-04T12:00:00Z",
    "attributes": {
      "user_id": "...",
      "references": {...}
    }
  },
  "subscription": {
    "id": "01961234-...",
    "name": "GitHub Deploy Dispatch",
    "flags": {"is_valid": true},
    "tags": ["deploy", "production"],
    "meta": null,
    "created_at": "2026-03-01T10:00:00Z",
    "updated_at": "2026-03-02T15:00:00Z"
  },
  "scope": {
    "project_id": "01961234-..."
  }
}
```

### Example — repository_dispatch shape
`payload_fields={"event_type": "$.event.event_type", "client_payload": "$.event"}`

```json
{
  "event_type": "environments.revisions.committed",
  "client_payload": {
    "event_id": "01961234-5678-7abc-...",
    "event_type": "environments.revisions.committed",
    "timestamp": "2026-03-04T12:00:00Z",
    "attributes": {
      "user_id": "...",
      "references": {...}
    }
  }
}
```

### Example — workflow_dispatch shape
`payload_fields={"ref": "main", "inputs": "$.event"}`

```json
{
  "ref": "main",
  "inputs": {
    "event_id": "01961234-5678-7abc-...",
    "event_type": "environments.revisions.committed",
    "timestamp": "2026-03-04T12:00:00Z",
    "attributes": {
      "user_id": "...",
      "references": {...}
    }
  }
}
```

### Example — using subscription metadata
`payload_fields={"event_type": "$.event.event_type", "client_payload": {"event": "$.event", "tags": "$.subscription.tags", "source": "$.subscription.name"}}`

```json
{
  "event_type": "environments.revisions.committed",
  "client_payload": {
    "event": {
      "event_id": "01961234-5678-7abc-...",
      "event_type": "environments.revisions.committed",
      "timestamp": "2026-03-04T12:00:00Z",
      "attributes": {...}
    },
    "tags": ["deploy", "production"],
    "source": "GitHub Deploy Dispatch"
  }
}
```

### Files Affected
- `sdk/agenta/sdk/workflows/handlers.py` — add `resolve_json_selector` function (primitives only)
- `api/oss/src/core/webhooks/types.py` — add `payload_fields` field, add `EVENT_CONTEXT_FIELDS` and `SUBSCRIPTION_CONTEXT_FIELDS` allowlists
- `api/oss/src/tasks/taskiq/webhooks/tasks.py` — add `resolve_payload_fields` wrapper; build context and resolve payload
- `api/oss/src/tasks/asyncio/webhooks/dispatcher.py` — build context dict, pass subscription + scope to delivery task

---

## 6. GitHub Actions Compatibility

The above extensions compose to support both GitHub dispatch modes natively.

### repository_dispatch

Subscription creation:
```json
{
  "subscription": {
    "name": "GitHub Deploy Dispatch",
    "secret": "Bearer ghp_xxxxxxxxxxxx",
    "data": {
      "auth_mode": "authorization",
      "url": "https://api.github.com/repos/OWNER/REPO/dispatches",
      "headers": {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      "event_types": ["environments.revisions.committed"],
      "payload_fields": {
        "event_type": "$.event.event_type",
        "client_payload": "$.event"
      }
    }
  }
}
```

Produces:
```http
POST https://api.github.com/repos/OWNER/REPO/dispatches
Authorization: Bearer ghp_xxxxxxxxxxxx
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json
User-Agent: Agenta-Webhook/1.0
X-Agenta-Event-Type: environments.revisions.committed
X-Agenta-Delivery-Id: {delivery_id}
X-Agenta-Event-Id: {event_id}
Idempotency-Key: {delivery_id}

{
  "event_type": "environments.revisions.committed",
  "client_payload": {
    "event_id": "01961234-5678-7abc-...",
    "event_type": "environments.revisions.committed",
    "timestamp": "2026-03-04T12:00:00Z",
    "attributes": {
      "user_id": "...",
      "references": {...}
    }
  }
}
```

### workflow_dispatch

Subscription creation:
```json
{
  "subscription": {
    "name": "GitHub Workflow Dispatch",
    "secret": "Bearer ghp_xxxxxxxxxxxx",
    "data": {
      "auth_mode": "authorization",
      "url": "https://api.github.com/repos/OWNER/REPO/actions/workflows/deploy.yml/dispatches",
      "headers": {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      "event_types": ["environments.revisions.committed"],
      "payload_fields": {
        "ref": "main",
        "inputs": "$.event"
      }
    }
  }
}
```

Produces:
```http
POST https://api.github.com/repos/OWNER/REPO/actions/workflows/deploy.yml/dispatches
Authorization: Bearer ghp_xxxxxxxxxxxx
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json
User-Agent: Agenta-Webhook/1.0
X-Agenta-Event-Type: environments.revisions.committed
X-Agenta-Delivery-Id: {delivery_id}
X-Agenta-Event-Id: {event_id}
Idempotency-Key: {delivery_id}

{
  "ref": "main",
  "inputs": {
    "event_id": "01961234-5678-7abc-...",
    "event_type": "environments.revisions.committed",
    "timestamp": "2026-03-04T12:00:00Z",
    "attributes": {
      "user_id": "...",
      "references": {...}
    }
  }
}
```

---

## Summary Tables

### New Fields on `WebhookSubscriptionData`

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `auth_mode` | `Optional[Literal["signature", "authorization"]]` | `None` | Auth header strategy (falls back to `"signature"` when resolved) |
| `payload_fields` | `Optional[Dict[str, Any]]` | `None` | Body structure — resolved recursively via `resolve_payload_fields` against context (falls back to `"$"` — the full context) |

### Header Changes

| Before | After |
|--------|-------|
| `X-Agenta-Delivery-Id: {delivery_id}` | `X-Agenta-Delivery-Id: {delivery_id}` (unchanged) |
| _(not present)_ | `X-Agenta-Event-Id: {event_id}` |
| _(not present)_ | `Idempotency-Key: {delivery_id}` |
| _(when auth_mode="authorization")_ | `Authorization: {secret}` (replaces HMAC signature) |

### Code-Level Rename

| Before | After |
|--------|-------|
| `body` (parameter/field) | `payload` |
| `WebhookDeliveryData.body` | `WebhookDeliveryData.payload` |

---

## Body Assembly Order

At delivery time, the final HTTP payload is assembled in this order:

```
1. Build context:
   a. Serialize event: event.model_dump(mode="json", exclude_none=True)
   b. Serialize subscription: subscription.model_dump(mode="json", exclude_none=True)
   c. Filter both through allowlists (EVENT_CONTEXT_FIELDS, SUBSCRIPTION_CONTEXT_FIELDS)
   d. context = {"event": filtered_event, "subscription": filtered_sub, "scope": {"project_id": str(project_id)}}
2. Resolve payload_fields: use subscription's payload_fields if set, else "$" (full context)
3. payload = resolve_payload_fields(payload_fields, context)
4. JSON-serialize with sort_keys=True
```
