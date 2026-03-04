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
    event_fields: Optional[Dict[str, Any]] = None
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
- `X-Agenta-Delivery-Id: {delivery_uuid}` — unique per delivery attempt

### New Behavior
- **Replace** `X-Agenta-Delivery-Id` with `X-Agenta-Event-Id: {event_id}` (breaking change)
- **Add** `Idempotency-Key: {event_id}` — standard idempotency header, same value as event ID
- The `delivery_id` is still generated and stored in the delivery record, just no longer sent as a header

### Files Affected
- `api/oss/src/tasks/taskiq/webhooks/tasks.py`:
  - Swap header name in `system_headers`
  - Add `Idempotency-Key`
  - Update `NON_OVERRIDABLE_HEADERS`: remove `x-agenta-delivery-id`, add `x-agenta-event-id` and `idempotency-key`

---

## 3. Payload is the Full Event (not just attributes)

### Current Behavior
- The webhook body is `event.attributes` only — a subset of the Event object
- `event_type`, `event_id`, `timestamp`, etc. are only sent as HTTP headers

### New Behavior
- The webhook payload is the full `Event` object serialized via `event.model_dump(mode="json", exclude_none=True)`
- This means `event_type`, `event_id`, `timestamp`, `request_id`, `attributes`, etc. are all in the body
- No separate injection of `event_type` needed — it's already part of the serialized Event

### Example payload (default `event_fields=None` → falls back to `{"event": "$"}`)
```json
{
  "event": {
    "event_id": "01961234-5678-7abc-...",
    "request_id": "01961234-5678-7abc-...",
    "request_type": "router",
    "event_type": "environments.revisions.committed",
    "timestamp": "2026-03-04T12:00:00Z",
    "attributes": {
      "user_id": "...",
      "references": {...}
    }
  }
}
```

### Files Affected
- `api/oss/src/tasks/asyncio/webhooks/dispatcher.py` — change `body=event.attributes or {}` to `body=event.model_dump(mode="json", exclude_none=True)`
- `api/oss/src/tasks/taskiq/webhooks/tasks.py` — remove any `event_type` injection logic (it's already in the payload)

---

## 4. Rename `body` → `event` in Code

### Current Behavior
- The variable/parameter is called `body` throughout dispatch and delivery code

### New Behavior
- Rename `body` → `event` in:
  - `deliver_webhook()` parameter
  - `dispatcher.py` kiq call
  - `WebhookDeliveryData.body` → `WebhookDeliveryData.event`
  - `tasks.py` local variables
- This is a code-level rename, not a wire-format change

### Files Affected
- `api/oss/src/core/webhooks/types.py` — rename field on `WebhookDeliveryData`
- `api/oss/src/tasks/taskiq/webhooks/tasks.py` — rename parameter and variables
- `api/oss/src/tasks/asyncio/webhooks/dispatcher.py` — rename in kiq call
- `api/oss/src/tasks/taskiq/webhooks/worker.py` — rename in task registration if needed

---

## 5. Event Fields — Unified Body Shaping

### Current Behavior
- The HTTP body IS `event.attributes` directly — a flat dict with no control over structure
- No way to nest the event, extract fields, or add static keys

### New Behavior
- New field on `WebhookSubscriptionData`: `event_fields: Optional[Dict[str, Any]] = None`
- A single dict that defines the entire HTTP body structure
- Each key becomes a top-level key in the HTTP body; each value is resolved via `resolve_json_selector` from `sdk/agenta/sdk/workflows/handlers.py`:
  - **JSON Path** (prefix `$`): resolved against the serialized event — `"$"` = entire event, `"$.event_type"` = `event["event_type"]`
  - **JSON Pointer** (prefix `/`): resolved against the serialized event — `"/event_type"` = `event["event_type"]`
  - **Anything else** (plain strings, numbers, dicts, bools, null): used as a static value as-is
- When `None` (default), delivery falls back to `{"event": "$"}` — the full event nested under `"event"`

### Value Resolution Examples

| Value | Type | Result |
|-------|------|--------|
| `"$"` | JSON Path (root) | Entire serialized event |
| `"$.event_type"` | JSON Path | `event["event_type"]` |
| `"$.attributes.user_id"` | JSON Path | `event["attributes"]["user_id"]` |
| `"/event_type"` | JSON Pointer | `event["event_type"]` |
| `"main"` | Static string | `"main"` |
| `42` | Static number | `42` |
| `{"nested": "obj"}` | Static dict | `{"nested": "obj"}` |

### Example — default (no `event_fields`)
Fallback: `{"event": "$"}`

```json
{
  "event": {
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

### Example — repository_dispatch shape
`event_fields={"event_type": "$.event_type", "client_payload": "$"}`

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
`event_fields={"ref": "main", "inputs": "$"}`

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

### Files Affected
- `sdk/agenta/sdk/workflows/handlers.py` — add `resolve_json_selector` function
- `api/oss/src/core/webhooks/types.py` — replace `event_field`, `extract_fields`, `custom_fields` with single `event_fields` field
- `api/oss/src/tasks/taskiq/webhooks/tasks.py` — build body by iterating `event_fields` and resolving each value via `resolve_json_selector`

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
      "event_fields": {
        "event_type": "$.event_type",
        "client_payload": "$"
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
X-Agenta-Event-Id: {event_id}
Idempotency-Key: {event_id}

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
      "event_fields": {
        "ref": "main",
        "inputs": "$"
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
X-Agenta-Event-Id: {event_id}
Idempotency-Key: {event_id}

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
| `event_fields` | `Optional[Dict[str, Any]]` | `None` | Body structure — values resolved via `resolve_json_selector` (falls back to `{"event": "$"}`) |

### Header Changes

| Before | After |
|--------|-------|
| `X-Agenta-Delivery-Id: {delivery_id}` | `X-Agenta-Event-Id: {event_id}` |
| _(not present)_ | `Idempotency-Key: {event_id}` |
| _(when user provides secret)_ | `Authorization: {secret}` (replaces HMAC signature) |

### Code-Level Rename

| Before | After |
|--------|-------|
| `body` (parameter/field) | `event` |
| `WebhookDeliveryData.body` | `WebhookDeliveryData.event` |

---

## Body Assembly Order

At delivery time, the final HTTP body is assembled in this order:

```
1. Serialize event: event.model_dump(mode="json", exclude_none=True)
2. Resolve event_fields: use subscription's event_fields if set, else {"event": "$"}
3. Start with empty dict
4. For each {key: value} in event_fields:
   body[key] = resolve_json_selector(value, serialized_event)
5. JSON-serialize with sort_keys=True
```
