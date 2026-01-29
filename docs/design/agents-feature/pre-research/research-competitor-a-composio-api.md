# Competitor A's Composio Integration - API Analysis

This document captures the API patterns Competitor A (visual workflow builder) uses to integrate Composio tools into their UI, based on reverse-engineering their network requests.

## Key Concepts

Competitor A wraps Composio with their own API layer:

| Competitor A Concept | Composio Equivalent | Description |
|----------------------|---------------------|-------------|
| `integration` | Toolkit | e.g., GMAIL, SLACK, GITHUB |
| `integration_auth_config` | Auth Config | How to authenticate (OAuth2 vs API_KEY) |
| `integration_credentials` | Connected Account | User's actual connection |
| `tool` | Tool/Action | Individual tool like `GMAIL_SEND_EMAIL` |

---

## API Endpoints

### 1. List Tools for an Integration

```
GET /api/integration-providers/COMPOSIO/tools?integration_name={INTEGRATION_NAME}
```

**Example:**
```
GET /api/integration-providers/COMPOSIO/tools?integration_name=ACCULYNX
```

**Response:**
```json
{
  "count": 8,
  "next": null,
  "previous": null,
  "results": [
    {
      "provider": "COMPOSIO",
      "integration": {
        "id": "680505c1-8089-4d48-96f8-c39f57618d61",
        "provider": "COMPOSIO",
        "name": "ACCULYNX"
      },
      "name": "ACCULYNX_ADD_JOB_APPOINTMENT",
      "label": "Add job appointment",
      "description": "This endpoint allows users to schedule the initial appointment...",
      "toolkit_version": "00000000_00"
    },
    // ... more tools
  ]
}
```

---

### 2. Get Tool Details (Full Schema)

```
GET /api/integration-providers/COMPOSIO/integrations/{INTEGRATION}/tools/{TOOL_NAME}
```

**Example:**
```
GET /api/integration-providers/COMPOSIO/integrations/AGENCYZOOM/tools/AGENCYZOOM_BATCH_DELETE_TASK
```

**Response:**
```json
{
  "provider": "COMPOSIO",
  "integration": {
    "id": "c721ffb5-ae48-497c-9ca7-4b348fea7b4b",
    "provider": "COMPOSIO",
    "name": "AGENCYZOOM"
  },
  "name": "AGENCYZOOM_BATCH_DELETE_TASK",
  "label": "Batch delete tasks",
  "description": "Deletes multiple agencyzoom tasks in a batch...",
  "input_parameters": {
    "description": "Request schema for `BatchDeleteTask`",
    "properties": {
      "taskIds": {
        "description": "List of unique numerical identifiers for the tasks to be deleted.",
        "examples": ["12345", "67890", "13579"],
        "items": {
          "properties": {},
          "type": "integer"
        },
        "title": "Task Ids",
        "type": "array"
      }
    },
    "title": "BatchDeleteTaskRequest",
    "type": "object"
  },
  "output_parameters": {
    "properties": {
      "data": {
        "additionalProperties": false,
        "description": "Contains details regarding the outcome...",
        "properties": {
          "id": {"type": "integer", "nullable": true},
          "message": {"type": "string", "nullable": true},
          "result": {"type": "boolean", "nullable": true}
        },
        "title": "Data",
        "type": "object"
      },
      "error": {"type": "string", "nullable": true},
      "successful": {"type": "boolean"}
    },
    "required": ["data", "successful"],
    "title": "BatchDeleteTaskResponseWrapper",
    "type": "object"
  },
  "toolkit_version": "00000000_00"
}
```

---

### 3. Get Auth Config for an Integration

```
GET /api/integration-auth-configs?expand=integration_credentials&integration_name={NAME}&integration_provider=COMPOSIO
```

**Example:**
```
GET /api/integration-auth-configs?expand=integration_credentials&integration_name=AGENCYZOOM&integration_provider=COMPOSIO
```

**Response (API Key type - not connected):**
```json
{
  "id": "e7216f59-ac20-4530-a7d1-b6b4c8f1c45e",
  "integration": {
    "id": "c721ffb5-ae48-497c-9ca7-4b348fea7b4b",
    "provider": "COMPOSIO",
    "name": "AGENCYZOOM"
  },
  "auth_type": "API_KEY",
  "integration_credentials": [],
  "system_credential_eligible": false,
  "default_access_type": "USER",
  "additional_parameters": null
}
```

**Response (OAuth2 type - connected):**
```json
{
  "id": "c476bb78-9177-4aa0-b9d7-f40cd09d2180",
  "integration": {
    "id": "708faee9-c6bd-4022-978f-b6230ac1c863",
    "provider": "COMPOSIO",
    "name": "AIRTABLE"
  },
  "auth_type": "OAUTH2",
  "integration_credentials": [
    {"id": "ed68f41f-2f83-4445-b4ee-51b46243a366"}
  ],
  "system_credential_eligible": false,
  "default_access_type": "USER",
  "additional_parameters": null
}
```

---

### 4. List All Auth Configs

```
GET /api/integration-auth-configs?expand=integration_credentials
```

**Response:**
```json
{
  "count": 97,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": "d54b852d-f20b-45ef-9883-90c866d79b35",
      "integration": {
        "id": "f2dde61a-7737-44ac-82ab-ac2ec3aa8c46",
        "provider": "COMPOSIO",
        "name": "GMAIL"
      },
      "auth_type": "OAUTH2",
      "integration_credentials": [],
      "system_credential_eligible": false,
      "default_access_type": "USER"
    },
    {
      "id": "f2d1ef34-47e3-41a5-a586-4efb8f7a97f6",
      "integration": {
        "id": "dbbf3f1c-97b5-44c5-beca-d1b9e6ba2d26",
        "provider": "COMPOSIO",
        "name": "STRIPE"
      },
      "auth_type": "API_KEY",
      "integration_credentials": [],
      "system_credential_eligible": false,
      "default_access_type": "USER"
    }
    // ... 95 more integrations
  ]
}
```

---

### 5. Initiate OAuth Flow

```
POST /api/integration-credentials/initiate-auth
```

**Request:**
```json
{
  "integration_auth_config_id": "c476bb78-9177-4aa0-b9d7-f40cd09d2180",
  "additional_parameters": {}
}
```

**Response:**
```json
{
  "redirect_url": "https://backend.composio.dev/api/v3/s/a4pRSDDM",
  "integration_credential_id": "b1b2eac0-4797-4152-85e4-0ce312057ad5"
}
```

**Key points:**
- Returns a Composio redirect URL (short link format)
- Returns a credential ID that can be polled for completion
- After OAuth completes, poll `/api/integration-auth-configs` to see `integration_credentials` populated

---

## OAuth Flow Sequence

```
1. User clicks "Connect" on a tool in the modal
         ↓
2. Frontend checks auth_type from integration_auth_config
         ↓
3. If OAuth2:
   - POST /api/integration-credentials/initiate-auth
   - Get redirect_url
   - Open popup/redirect to Composio
         ↓
4. User completes OAuth on Composio's hosted page
         ↓
5. Composio redirects back
         ↓
6. Frontend polls GET /api/integration-auth-configs?expand=integration_credentials
   - Wait until integration_credentials is non-empty
         ↓
7. Connection complete, UI updates
```

---

## Data Model Observations

### Auth Types

| auth_type | Flow |
|-----------|------|
| `OAUTH2` | Full OAuth flow via Composio redirect |
| `API_KEY` | User enters API key in a form |

### Connection Status

- **Not connected**: `integration_credentials: []`
- **Connected**: `integration_credentials: [{"id": "..."}]`

### Special Flags

- `system_credential_eligible: true` - Platform can provide a default API key (e.g., SERPAPI, FIRECRAWL)
- `default_access_type: "USER"` - Each user needs their own credentials

---

## UI Flow for Tool Browser

Based on the API calls observed:

### Step 1: Show Tool Browser Modal
```
GET /api/integration-auth-configs?expand=integration_credentials
```
Returns all 97 integrations with connection status.

### Step 2: User Selects an Integration (e.g., ACCULYNX)
```
GET /api/integration-providers/COMPOSIO/tools?integration_name=ACCULYNX
```
Returns list of 8 tools with name, label, description.

### Step 3: User Selects a Tool
```
GET /api/integration-providers/COMPOSIO/integrations/ACCULYNX/tools/ACCULYNX_ADD_JOB_APPOINTMENT
```
Returns full tool schema with input_parameters and output_parameters.

### Step 4: User Clicks "Connect" (if not connected)
```
POST /api/integration-credentials/initiate-auth
{"integration_auth_config_id": "c3083472-1fe6-460e-86d2-a3c8621a2e77"}
```
Opens popup to Composio OAuth.

### Step 5: After OAuth, Poll for Completion
```
GET /api/integration-auth-configs?expand=integration_credentials
```
Check if `integration_credentials` is now populated.

---

## Implications for Agenta

### Proposed Agenta API Structure

```
# Integrations (cached from Composio)
GET /api/tools/integrations                    # List all integrations with auth status
GET /api/tools/integrations/{name}/tools       # List tools for an integration
GET /api/tools/integrations/{name}/tools/{tool}  # Get tool details with schema

# Credentials/Connections
GET /api/tools/credentials                     # List user's connected integrations
POST /api/tools/credentials/connect            # Initiate OAuth
DELETE /api/tools/credentials/{id}             # Disconnect
GET /api/tools/credentials/{id}/status         # Check OAuth completion
```

### Key Design Decisions

1. **Cache integration list** - Don't call Composio for every request
2. **Wrap Composio OAuth** - Use their redirect URLs but track in our DB
3. **Store credential references** - Keep Composio credential IDs, not actual tokens
4. **Poll for completion** - Simple approach, no webhooks needed

---

## Raw API Examples

### cURL: List Tools
```bash
curl 'https://app.example.com/api/integration-providers/COMPOSIO/tools?integration_name=GMAIL' \
  -H 'Accept: application/json'
```

### cURL: Initiate OAuth
```bash
curl 'https://app.example.com/api/integration-credentials/initiate-auth' \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{"integration_auth_config_id":"d54b852d-f20b-45ef-9883-90c866d79b35","additional_parameters":{}}'
```

---

*Captured from Competitor A UI: January 2026*
