# API Design

## Overview

RESTful API for managing webhook subscriptions, plus internal service for event dispatch.

---

## Webhook Management Endpoints

### Base Path: `/api/projects/{project_id}/webhooks`

### 1. List Webhooks

```http
GET /api/projects/{project_id}/webhooks
```

**Response:**
```json
{
  "webhooks": [
    {
      "id": "01234567-89ab-cdef-0123-456789abcdef",
      "name": "GitHub Sync",
      "url": "https://api.github.com/repos/org/repo/dispatches",
      "event_types": ["config.deployed"],
      "application_id": null,
      "environment_name": "production",
      "is_active": true,
      "description": "Sync production configs to GitHub",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### 2. Create Webhook

```http
POST /api/projects/{project_id}/webhooks
```

**Request:**
```json
{
  "name": "GitHub Sync",
  "url": "https://api.github.com/repos/org/repo/dispatches",
  "event_types": ["config.deployed"],
  "application_id": null,
  "environment_name": "production",
  "description": "Sync production configs to GitHub",
  "headers": {
    "Authorization": "Bearer ghp_xxxxxxxxxxxx"
  }
}
```

**Response:**
```json
{
  "id": "01234567-89ab-cdef-0123-456789abcdef",
  "name": "GitHub Sync",
  "url": "https://api.github.com/repos/org/repo/dispatches",
  "secret": "whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "event_types": ["config.deployed"],
  "application_id": null,
  "environment_name": "production",
  "is_active": true,
  "description": "Sync production configs to GitHub",
  "headers": {
    "Authorization": "Bearer ghp_xxxxxxxxxxxx"
  },
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:00Z"
}
```

**Note:** `secret` is only returned on creation. Store it securely.

### 3. Get Webhook

```http
GET /api/projects/{project_id}/webhooks/{webhook_id}
```

**Response:**
```json
{
  "id": "01234567-89ab-cdef-0123-456789abcdef",
  "name": "GitHub Sync",
  "url": "https://api.github.com/repos/org/repo/dispatches",
  "event_types": ["config.deployed"],
  "application_id": null,
  "environment_name": "production",
  "is_active": true,
  "description": "Sync production configs to GitHub",
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:00Z"
}
```

**Note:** `secret` is NOT returned on get (security).

### 4. Update Webhook

```http
PATCH /api/projects/{project_id}/webhooks/{webhook_id}
```

**Request:**
```json
{
  "name": "GitHub Sync - Updated",
  "is_active": false
}
```

**Response:** Updated webhook object

### 5. Delete Webhook

```http
DELETE /api/projects/{project_id}/webhooks/{webhook_id}
```

**Response:** `204 No Content`

### 6. Regenerate Secret

```http
POST /api/projects/{project_id}/webhooks/{webhook_id}/regenerate-secret
```

**Response:**
```json
{
  "secret": "whsec_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
}
```

### 7. Test Webhook

Send a test event to verify the endpoint works.

```http
POST /api/projects/{project_id}/webhooks/{webhook_id}/test
```

**Response:**
```json
{
  "success": true,
  "response_status": 200,
  "response_time_ms": 145,
  "message": "Test event delivered successfully"
}
```

Or on failure:
```json
{
  "success": false,
  "response_status": 500,
  "response_time_ms": 2000,
  "error": "Connection timeout"
}
```

---

## Delivery History Endpoints

### 8. List Deliveries

```http
GET /api/projects/{project_id}/webhooks/{webhook_id}/deliveries?status=failed&limit=50
```

**Query Parameters:**
- `status`: Filter by status (`pending`, `delivered`, `failed`)
- `limit`: Max items (default 50, max 100)
- `cursor`: Pagination cursor

**Response:**
```json
{
  "deliveries": [
    {
      "id": "fedcba98-7654-3210-fedc-ba9876543210",
      "event_id": "11111111-2222-3333-4444-555555555555",
      "event_type": "config.deployed",
      "status": "delivered",
      "attempts": 1,
      "created_at": "2024-01-15T10:30:00Z",
      "delivered_at": "2024-01-15T10:30:01Z",
      "last_response_status": 200
    }
  ],
  "next_cursor": "abc123"
}
```

### 9. Get Delivery Details

```http
GET /api/projects/{project_id}/webhooks/{webhook_id}/deliveries/{delivery_id}
```

**Response:**
```json
{
  "id": "fedcba98-7654-3210-fedc-ba9876543210",
  "event_id": "11111111-2222-3333-4444-555555555555",
  "event_type": "config.deployed",
  "status": "failed",
  "attempts": 3,
  "max_attempts": 6,
  "payload": {
    "id": "...",
    "type": "config.deployed",
    "data": { ... }
  },
  "created_at": "2024-01-15T10:30:00Z",
  "scheduled_at": "2024-01-15T11:30:00Z",
  "last_attempt_at": "2024-01-15T10:45:00Z",
  "last_response_status": 500,
  "last_response_body": "Internal Server Error",
  "last_error": "HTTP 500"
}
```

### 10. Retry Delivery

```http
POST /api/projects/{project_id}/webhooks/{webhook_id}/deliveries/{delivery_id}/retry
```

**Response:**
```json
{
  "id": "fedcba98-7654-3210-fedc-ba9876543210",
  "status": "pending",
  "scheduled_at": "2024-01-15T12:00:00Z"
}
```

---

## Webhook Payload Format

### Standard Envelope

All webhook payloads follow this structure:

```json
{
  "id": "11111111-2222-3333-4444-555555555555",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "type": "config.deployed",
  "api_version": "2024-01",
  "project_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "data": {
    // Event-specific payload
  }
}
```

### Event: `config.deployed`

Fired when a config is deployed to an environment.

```json
{
  "id": "11111111-2222-3333-4444-555555555555",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "type": "config.deployed",
  "api_version": "2024-01",
  "project_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "data": {
    "application": {
      "id": "app-uuid",
      "name": "my-chatbot"
    },
    "variant": {
      "id": "variant-uuid",
      "slug": "gpt4-optimized",
      "version": 5
    },
    "environment": {
      "id": "env-uuid",
      "name": "production"
    },
    "config": {
      "params": {
        "model": "gpt-4",
        "temperature": 0.7,
        "system_prompt": "You are a helpful assistant..."
      }
    },
    "deployed_by": {
      "id": "user-uuid",
      "email": "pm@company.com"
    },
    "commit_message": "Tuned temperature for better responses"
  }
}
```

### Event: `config.committed` (Future)

Fired when a new config version is saved (but not necessarily deployed).

```json
{
  "id": "22222222-3333-4444-5555-666666666666",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "type": "config.committed",
  "api_version": "2024-01",
  "project_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "data": {
    "application": {
      "id": "app-uuid",
      "name": "my-chatbot"
    },
    "variant": {
      "id": "variant-uuid",
      "slug": "gpt4-optimized",
      "version": 5,
      "previous_version": 4
    },
    "config": {
      "params": { ... }
    },
    "committed_by": {
      "id": "user-uuid",
      "email": "pm@company.com"
    },
    "commit_message": "Tuned temperature"
  }
}
```

---

## HTTP Headers

### Request Headers (Outgoing Webhooks)

```http
POST /your-webhook-endpoint HTTP/1.1
Content-Type: application/json
User-Agent: Agenta-Webhooks/1.0
X-Agenta-Delivery: fedcba98-7654-3210-fedc-ba9876543210
X-Agenta-Event: config.deployed
X-Agenta-Signature: t=1705318200,v1=5d2c3b1a...
```

| Header | Description |
|--------|-------------|
| `Content-Type` | Always `application/json` |
| `User-Agent` | `Agenta-Webhooks/1.0` |
| `X-Agenta-Delivery` | Unique delivery ID (for idempotency) |
| `X-Agenta-Event` | Event type |
| `X-Agenta-Signature` | HMAC signature for verification |

### Signature Format

```
X-Agenta-Signature: t=<unix_timestamp>,v1=<hmac_hex>
```

**Verification:**
```python
import hmac
import hashlib

def verify_signature(payload: bytes, header: str, secret: str) -> bool:
    parts = dict(p.split("=") for p in header.split(","))
    timestamp = parts["t"]
    signature = parts["v1"]
    
    message = f"{timestamp}.{payload.decode()}"
    expected = hmac.new(
        secret.encode(),
        message.encode(),
        hashlib.sha256
    ).hexdigest()
    
    return hmac.compare_digest(signature, expected)
```

---

## Pydantic Models

```python
# api/oss/src/models/api/webhook_models.py

from pydantic import BaseModel, HttpUrl, Field
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime
from enum import Enum


class WebhookEventType(str, Enum):
    CONFIG_DEPLOYED = "config.deployed"
    CONFIG_COMMITTED = "config.committed"
    ALL = "*"


class WebhookCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    url: HttpUrl
    event_types: List[str] = Field(default=["*"])
    application_id: Optional[UUID] = None
    environment_name: Optional[str] = None
    description: Optional[str] = None
    headers: Optional[Dict[str, str]] = None


class WebhookUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    url: Optional[HttpUrl] = None
    event_types: Optional[List[str]] = None
    application_id: Optional[UUID] = None
    environment_name: Optional[str] = None
    description: Optional[str] = None
    headers: Optional[Dict[str, str]] = None
    is_active: Optional[bool] = None


class WebhookResponse(BaseModel):
    id: UUID
    name: str
    url: str
    event_types: List[str]
    application_id: Optional[UUID]
    environment_name: Optional[str]
    is_active: bool
    description: Optional[str]
    created_at: datetime
    updated_at: datetime


class WebhookWithSecretResponse(WebhookResponse):
    secret: str


class WebhookDeliveryStatus(str, Enum):
    PENDING = "pending"
    DELIVERED = "delivered"
    FAILED = "failed"


class WebhookDeliveryResponse(BaseModel):
    id: UUID
    event_id: UUID
    event_type: str
    status: WebhookDeliveryStatus
    attempts: int
    created_at: datetime
    delivered_at: Optional[datetime]
    last_response_status: Optional[int]


class WebhookDeliveryDetailResponse(WebhookDeliveryResponse):
    max_attempts: int
    payload: Dict[str, Any]
    scheduled_at: datetime
    last_attempt_at: Optional[datetime]
    last_response_body: Optional[str]
    last_error: Optional[str]


class WebhookTestResponse(BaseModel):
    success: bool
    response_status: Optional[int]
    response_time_ms: Optional[int]
    message: Optional[str]
    error: Optional[str]
```

---

## Router Implementation Sketch

```python
# api/oss/src/routers/webhooks_router.py

from fastapi import APIRouter, Request, HTTPException
from typing import List

router = APIRouter(prefix="/projects/{project_id}/webhooks", tags=["webhooks"])


@router.get("/", response_model=List[WebhookResponse])
async def list_webhooks(project_id: str, request: Request):
    # Permission check
    # Query webhooks for project
    pass


@router.post("/", response_model=WebhookWithSecretResponse)
async def create_webhook(
    project_id: str, 
    payload: WebhookCreateRequest, 
    request: Request
):
    # Permission check
    # Validate URL (HTTPS required in prod)
    # Generate secret
    # Create webhook
    pass


@router.get("/{webhook_id}", response_model=WebhookResponse)
async def get_webhook(project_id: str, webhook_id: str, request: Request):
    pass


@router.patch("/{webhook_id}", response_model=WebhookResponse)
async def update_webhook(
    project_id: str, 
    webhook_id: str, 
    payload: WebhookUpdateRequest, 
    request: Request
):
    pass


@router.delete("/{webhook_id}")
async def delete_webhook(project_id: str, webhook_id: str, request: Request):
    pass


@router.post("/{webhook_id}/regenerate-secret")
async def regenerate_secret(project_id: str, webhook_id: str, request: Request):
    pass


@router.post("/{webhook_id}/test", response_model=WebhookTestResponse)
async def test_webhook(project_id: str, webhook_id: str, request: Request):
    pass


@router.get("/{webhook_id}/deliveries", response_model=List[WebhookDeliveryResponse])
async def list_deliveries(
    project_id: str, 
    webhook_id: str, 
    status: Optional[str] = None,
    limit: int = 50,
    cursor: Optional[str] = None,
    request: Request = None
):
    pass


@router.post("/{webhook_id}/deliveries/{delivery_id}/retry")
async def retry_delivery(
    project_id: str, 
    webhook_id: str, 
    delivery_id: str, 
    request: Request
):
    pass
```
