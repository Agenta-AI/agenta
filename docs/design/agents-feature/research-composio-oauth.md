# Composio OAuth Flow Research

This document provides a deep dive into how Composio handles OAuth connections for tool integrations, including the data model, API endpoints, OAuth flow sequences, and integration patterns.

## Table of Contents

1. [Composio Data Model](#composio-data-model)
2. [API Reference](#api-reference)
3. [OAuth Flow Sequence](#oauth-flow-sequence)
4. [Frontend Integration Patterns](#frontend-integration-patterns)
5. [Code Examples](#code-examples)
6. [Webhook/Polling for OAuth Completion](#webhookpolling-for-oauth-completion)

---

## Composio Data Model

### Core Concepts

Composio's authentication system is built around four key concepts:

#### 1. User (formerly "Entity")

A **User** is an identifier from your application that represents an end-user. When someone connects their Gmail or GitHub, that connection is stored under their user ID.

**Key characteristics:**
- User ID is YOUR app's identifier (e.g., database UUID, primary key)
- All tool executions and authorizations are scoped to a user ID
- Connections are fully isolated between user IDs
- A user can have multiple connections to the same toolkit (e.g., work + personal Gmail)

**Best practices for User IDs:**
- **Recommended:** Database UUID or primary key (`user.id`)
- **Acceptable:** Unique username (`user.username`)
- **Avoid:** Email addresses (they can change)
- **Never:** `default` in production (exposes other users' data)

#### 2. Auth Config

An **Auth Config** is a blueprint that defines how authentication works for a toolkit across all your users. It defines:

- **Authentication method** - OAuth2, Bearer token, API key, or Basic Auth
- **Scopes** - What actions your tools can perform
- **Credentials** - Your OAuth app credentials OR Composio's managed auth

**Key points:**
- Auth configs are reusable across all users
- Composio auto-creates auth configs using managed credentials by default
- Create custom auth configs for white-labeling or specific scopes
- Auth config IDs look like: `ac_1234abcd`

#### 3. Connected Account

A **Connected Account** is created when a user authenticates with a toolkit. It stores:

- User's credentials (OAuth tokens or API keys)
- Link to the user ID
- Status (ACTIVE, INACTIVE, PENDING, INITIATED, EXPIRED, FAILED)

**Key points:**
- Each user can have multiple connected accounts per toolkit
- Connected account IDs look like: `ca_xyz123`
- Composio automatically refreshes OAuth tokens before expiration
- Sessions use the most recently connected account by default

#### 4. Session

A **Session** is an ephemeral configuration that specifies:

- Which user's authorization and data the agent will access
- What toolkits are enabled or disabled
- What auth configs and connected accounts to use

**Key points:**
- Sessions are created per-request/per-conversation
- Sessions provide access to tools and MCP server URLs
- Sessions can check connection status for all toolkits

### Data Model Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                         Your App                                 │
│  ┌─────────────┐                                                │
│  │   User ID   │  (e.g., "user_123" from your database)         │
│  └──────┬──────┘                                                │
└─────────┼───────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Composio                                  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Auth Config                               ││
│  │  (ac_github_123)                                            ││
│  │  - OAuth2 scheme                                            ││
│  │  - Scopes: repo, user                                       ││
│  │  - Client credentials (yours or Composio managed)           ││
│  └─────────────────────────────────────────────────────────────┘│
│                             │                                    │
│                             ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                 Connected Accounts                           ││
│  │                                                              ││
│  │  user_123 + github:                                         ││
│  │    ├── ca_work_github (work account)                        ││
│  │    └── ca_personal_github (personal account)                ││
│  │                                                              ││
│  │  user_123 + gmail:                                          ││
│  │    └── ca_gmail_123                                         ││
│  └─────────────────────────────────────────────────────────────┘│
│                             │                                    │
│                             ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      Session                                 ││
│  │  - user_id: "user_123"                                      ││
│  │  - toolkits: ["github", "gmail"]                            ││
│  │  - connected_accounts: { github: "ca_work_github" }         ││
│  │  - auth_configs: { slack: "ac_custom_slack" }               ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Connection Status Values

| Status        | Description                                                           |
| ------------- | --------------------------------------------------------------------- |
| **ACTIVE**    | Connection established and working. Tools can execute.                |
| **INACTIVE**  | Temporarily disabled. Re-enable to use again.                         |
| **PENDING**   | Being processed. Wait for it to become active.                        |
| **INITIATED** | Request started but user hasn't completed auth yet.                   |
| **EXPIRED**   | Credentials expired (after failed refresh attempts). Re-authenticate. |
| **FAILED**    | Connection attempt failed. Check error and retry.                     |

---

## API Reference

### Base URL

```
https://backend.composio.dev/api/v3
```

### Authentication

All requests require an API key in the `x-api-key` header:

```bash
curl -H "x-api-key: YOUR_COMPOSIO_API_KEY" \
     https://backend.composio.dev/api/v3/...
```

### Key Endpoints

#### Toolkits (formerly Apps)

| Endpoint                        | Description                              |
| ------------------------------- | ---------------------------------------- |
| `GET /api/v3/toolkits`          | List all available toolkits              |
| `GET /api/v3/toolkits/{slug}`   | Get toolkit details and auth requirements|
| `GET /api/v3/toolkits/categories` | List toolkit categories                |

**Example: Get toolkit details**
```bash
GET /api/v3/toolkits/gmail

# Response
{
  "slug": "gmail",
  "name": "Gmail",
  "description": "...",
  "auth_schemes": ["OAUTH2"],
  "categories": ["communication", "email"]
}
```

#### Auth Configs

| Endpoint                           | Description                    |
| ---------------------------------- | ------------------------------ |
| `GET /api/v3/auth_configs`         | List your auth configs         |
| `POST /api/v3/auth_configs`        | Create new auth config         |
| `GET /api/v3/auth_configs/{id}`    | Get auth config details        |
| `PATCH /api/v3/auth_configs/{id}`  | Update auth config             |
| `DELETE /api/v3/auth_configs/{id}` | Delete auth config             |

**Example: Get auth config input requirements**
```python
# Python SDK
auth_config = composio.auth_configs.get(auth_config_id)
print(f"Auth scheme: {auth_config.auth_scheme}")
print(f"Required fields: {auth_config.expected_input_fields}")
```

#### Connected Accounts

| Endpoint                                       | Description                          |
| ---------------------------------------------- | ------------------------------------ |
| `GET /api/v3/connected_accounts`               | List connected accounts (with filters) |
| `POST /api/v3/connected_accounts`              | Initiate new connection              |
| `GET /api/v3/connected_accounts/{id}`          | Get connected account details        |
| `DELETE /api/v3/connected_accounts/{id}`       | Delete connected account             |
| `PATCH /api/v3/connected_accounts/{id}/status` | Enable/disable account               |
| `POST /api/v3/connected_accounts/{id}/refresh` | Refresh credentials                  |

**Example: List user's connections**
```bash
GET /api/v3/connected_accounts?user_ids=user_123&statuses=ACTIVE

# Response
{
  "items": [
    {
      "id": "ca_abc123",
      "user_id": "user_123",
      "toolkit": { "slug": "gmail", "name": "Gmail" },
      "status": "ACTIVE",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

**Example: Initiate OAuth connection**
```bash
POST /api/v3/connected_accounts
Content-Type: application/json

{
  "user_id": "user_123",
  "auth_config_id": "ac_gmail_123",
  "config": { "auth_scheme": "OAUTH2" },
  "callback_url": "https://yourapp.com/callback"
}

# Response
{
  "id": "ca_pending_xyz",
  "status": "INITIATED",
  "redirect_url": "https://connect.composio.dev/link/ln_abc123"
}
```

#### Tools (formerly Actions)

| Endpoint                               | Description                    |
| -------------------------------------- | ------------------------------ |
| `GET /api/v3/tools`                    | List tools                     |
| `GET /api/v3/tools/{slug}`             | Get tool schema                |
| `POST /api/v3/tools/execute/{slug}`    | Execute a tool                 |

#### OAuth Callback

```
https://backend.composio.dev/api/v3/toolkits/auth/callback
```

This is the redirect URI to configure in your OAuth app when white-labeling.

---

## OAuth Flow Sequence

### Flow 1: In-Chat Authentication (Default)

This is the default flow where the agent handles authentication prompts automatically.

```
┌──────────────────────────────────────────────────────────────────┐
│                     IN-CHAT AUTH FLOW                            │
└──────────────────────────────────────────────────────────────────┘

User: "Summarize my emails from today"
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. Agent calls COMPOSIO_SEARCH_TOOLS                            │
│    → Returns GMAIL_LIST_MESSAGES                                │
│    → Returns connection_status: "not_connected"                 │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Agent calls COMPOSIO_MANAGE_CONNECTIONS                      │
│    → Detects Gmail not connected                                │
│    → Returns Connect Link URL                                   │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
Agent: "I need you to connect your Gmail first. 
        Please click here: https://connect.composio.dev/link/ln_abc123"
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. User clicks link                                             │
│    → Redirected to Connect Link page                            │
│    → Clicks "Connect with Google"                               │
│    → Google OAuth consent screen                                │
│    → User grants permissions                                    │
│    → Redirect to callback URL                                   │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
User: "Done"
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Agent retries tool execution                                 │
│    → COMPOSIO_MULTI_EXECUTE_TOOL(GMAIL_LIST_MESSAGES)           │
│    → Success! Returns email data                                │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
Agent: "Here's a summary of your emails from today..."
```

### Flow 2: Manual/Programmatic Authentication

For apps that handle auth in their UI (not in chat).

```
┌──────────────────────────────────────────────────────────────────┐
│                   MANUAL AUTH FLOW                               │
└──────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 1. Frontend: User clicks "Connect Gmail" button                 │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Backend: Create session and authorize                        │
│                                                                 │
│    session = composio.create(user_id="user_123")                │
│    connection_request = session.authorize("gmail")              │
│                                                                 │
│    Returns:                                                     │
│    {                                                            │
│      "redirect_url": "https://connect.composio.dev/link/ln_x", │
│      "id": "ca_pending_123"                                     │
│    }                                                            │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Frontend: Redirect user to Connect Link                      │
│    window.location.href = redirect_url                          │
│    OR                                                           │
│    window.open(redirect_url, '_blank')                          │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Connect Link Page (Composio hosted)                          │
│    → Shows toolkit branding                                     │
│    → User clicks "Connect"                                      │
│    → Redirects to OAuth provider (Google, GitHub, etc.)         │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. OAuth Provider (e.g., Google)                                │
│    → Shows consent screen                                       │
│    → User grants permissions                                    │
│    → Redirects to Composio callback                             │
│      (https://backend.composio.dev/api/v3/toolkits/auth/callback)│
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. Composio processes callback                                  │
│    → Exchanges code for tokens                                  │
│    → Stores tokens in Connected Account                         │
│    → Updates status: INITIATED → ACTIVE                         │
│    → Redirects to YOUR callback_url                             │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. Your callback page                                           │
│    → Frontend detects auth complete                             │
│    → Closes popup / updates UI                                  │
│    → Backend: waitForConnection() returns                       │
└─────────────────────────────────────────────────────────────────┘
```

### Flow 3: Direct SDK Connection (API Key auth)

For non-OAuth toolkits that use API keys:

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Get API key from user (your UI collects this)                │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Create connection with API key                               │
│                                                                 │
│    connection = composio.connected_accounts.initiate(           │
│      user_id="user_123",                                        │
│      auth_config_id="ac_stripe_config",                         │
│      config={                                                   │
│        "auth_scheme": "API_KEY",                                │
│        "val": {"api_key": "sk_live_xxx"}                        │
│      }                                                          │
│    )                                                            │
│                                                                 │
│    Status immediately becomes ACTIVE (no redirect needed)       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Frontend Integration Patterns

### Pattern 1: Settings Page with Connection Management

Build a dedicated "Integrations" or "Connections" page:

```typescript
// Frontend: Connections Settings Page

import { useEffect, useState } from 'react';

interface Toolkit {
  slug: string;
  name: string;
  connection: {
    isActive: boolean;
    connectedAccount?: { id: string };
  };
}

function ConnectionsPage({ userId }: { userId: string }) {
  const [toolkits, setToolkits] = useState<Toolkit[]>([]);
  const [loading, setLoading] = useState(true);

  // 1. Check which toolkits are connected
  useEffect(() => {
    async function fetchConnectionStatus() {
      const response = await fetch('/api/composio/toolkits', {
        headers: { 'x-user-id': userId }
      });
      const data = await response.json();
      setToolkits(data.items);
      setLoading(false);
    }
    fetchConnectionStatus();
  }, [userId]);

  // 2. Handle connect button click
  const handleConnect = async (toolkitSlug: string) => {
    const response = await fetch('/api/composio/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, toolkit: toolkitSlug })
    });
    const { redirectUrl } = await response.json();
    
    // Option A: Redirect in same window
    window.location.href = redirectUrl;
    
    // Option B: Open popup
    const popup = window.open(redirectUrl, 'composio-connect', 'width=600,height=700');
    // Poll for completion (see waitForConnection pattern below)
  };

  // 3. Handle disconnect
  const handleDisconnect = async (connectedAccountId: string) => {
    await fetch(`/api/composio/disconnect/${connectedAccountId}`, {
      method: 'DELETE'
    });
    // Refresh toolkit list
  };

  return (
    <div>
      <h1>Connected Apps</h1>
      {toolkits.map(toolkit => (
        <div key={toolkit.slug}>
          <span>{toolkit.name}</span>
          {toolkit.connection.isActive ? (
            <button onClick={() => handleDisconnect(toolkit.connection.connectedAccount!.id)}>
              Disconnect
            </button>
          ) : (
            <button onClick={() => handleConnect(toolkit.slug)}>
              Connect
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
```

### Pattern 2: Pre-flight Connection Check Before Agent Use

```typescript
// Before starting an agent conversation, ensure required connections exist

async function ensureConnectionsBeforeChat(
  userId: string, 
  requiredToolkits: string[]
): Promise<{ ready: boolean; missing: string[] }> {
  
  // Call your backend to check connection status
  const response = await fetch('/api/composio/check-connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, toolkits: requiredToolkits })
  });
  
  const { connected, pending } = await response.json();
  
  if (pending.length > 0) {
    return { ready: false, missing: pending };
  }
  
  return { ready: true, missing: [] };
}

// Usage in your chat component
function ChatComponent({ userId }: { userId: string }) {
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'ready' | 'needs-auth'>('checking');
  const [missingToolkits, setMissingToolkits] = useState<string[]>([]);

  useEffect(() => {
    async function check() {
      const { ready, missing } = await ensureConnectionsBeforeChat(
        userId, 
        ['gmail', 'github']  // Required for this agent
      );
      
      if (ready) {
        setConnectionStatus('ready');
      } else {
        setConnectionStatus('needs-auth');
        setMissingToolkits(missing);
      }
    }
    check();
  }, [userId]);

  if (connectionStatus === 'needs-auth') {
    return (
      <div>
        <p>Please connect these apps before using the assistant:</p>
        {missingToolkits.map(toolkit => (
          <ConnectButton key={toolkit} toolkit={toolkit} userId={userId} />
        ))}
      </div>
    );
  }

  return <ChatInterface userId={userId} />;
}
```

### Pattern 3: Popup-based OAuth with Completion Detection

```typescript
// Open OAuth in popup and detect when it completes

function useOAuthPopup() {
  const [isConnecting, setIsConnecting] = useState(false);
  
  const connect = async (userId: string, toolkit: string): Promise<boolean> => {
    setIsConnecting(true);
    
    // 1. Get redirect URL from backend
    const response = await fetch('/api/composio/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, toolkit })
    });
    const { redirectUrl, connectionId } = await response.json();
    
    // 2. Open popup
    const popup = window.open(
      redirectUrl, 
      'composio-oauth', 
      'width=600,height=700,left=100,top=100'
    );
    
    // 3. Poll for completion
    return new Promise((resolve) => {
      const pollInterval = setInterval(async () => {
        // Check if popup closed
        if (popup?.closed) {
          clearInterval(pollInterval);
          
          // Verify connection was successful
          const statusResponse = await fetch(
            `/api/composio/connection-status/${connectionId}`
          );
          const { status } = await statusResponse.json();
          
          setIsConnecting(false);
          resolve(status === 'ACTIVE');
        }
      }, 1000);
      
      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        popup?.close();
        setIsConnecting(false);
        resolve(false);
      }, 5 * 60 * 1000);
    });
  };
  
  return { connect, isConnecting };
}
```

---

## Code Examples

### Python: Complete Connection Management

```python
from composio import Composio

composio = Composio(api_key="your-api-key")

# ============================================
# 1. Check if user has Gmail connected
# ============================================
def check_connection(user_id: str, toolkit: str) -> bool:
    """Check if a user has an active connection for a toolkit."""
    session = composio.create(
        user_id=user_id,
        manage_connections=False  # Disable in-chat auth
    )
    
    toolkits = session.toolkits()
    
    for tk in toolkits.items:
        if tk.slug == toolkit:
            return tk.connection.is_active
    
    return False

# ============================================
# 2. Get all connections for a user
# ============================================
def list_user_connections(user_id: str):
    """List all connected accounts for a user."""
    accounts = composio.connected_accounts.list(
        user_ids=[user_id],
        statuses=["ACTIVE"]
    )
    
    for account in accounts.items:
        print(f"{account.toolkit.slug}: {account.id} ({account.status})")
    
    return accounts.items

# ============================================
# 3. Initiate OAuth if not connected
# ============================================
def connect_if_needed(user_id: str, toolkit: str, callback_url: str) -> dict:
    """
    Check connection and initiate OAuth if needed.
    Returns: { "status": "connected" | "needs_auth", "redirect_url"?: str }
    """
    if check_connection(user_id, toolkit):
        return {"status": "connected"}
    
    # Create session and authorize
    session = composio.create(user_id=user_id, manage_connections=False)
    connection_request = session.authorize(toolkit)
    
    return {
        "status": "needs_auth",
        "redirect_url": connection_request.redirect_url,
        "connection_id": connection_request.id
    }

# ============================================
# 4. Wait for OAuth completion (polling)
# ============================================
def wait_for_oauth_completion(connection_id: str, timeout_seconds: int = 300):
    """
    Poll until OAuth completes or times out.
    Call this after user is redirected back from OAuth.
    """
    try:
        connected_account = composio.connected_accounts.wait_for_connection(
            connection_id, 
            timeout_seconds
        )
        return {
            "success": True,
            "account_id": connected_account.id,
            "status": connected_account.status
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

# ============================================
# 5. Disconnect/revoke connection
# ============================================
def disconnect(connected_account_id: str):
    """Delete a connected account and revoke credentials."""
    composio.connected_accounts.delete(connected_account_id)

# ============================================
# 6. Full pre-flight check for multiple toolkits
# ============================================
def preflight_check(user_id: str, required_toolkits: list[str]) -> dict:
    """
    Check all required connections before starting agent.
    Returns which toolkits are connected vs need auth.
    """
    session = composio.create(
        user_id=user_id,
        manage_connections=False
    )
    
    toolkits = session.toolkits()
    connected = set()
    
    for tk in toolkits.items:
        if tk.connection.is_active:
            connected.add(tk.slug)
    
    pending = [t for t in required_toolkits if t not in connected]
    
    return {
        "connected": list(connected & set(required_toolkits)),
        "pending": pending,
        "all_ready": len(pending) == 0
    }

# ============================================
# Usage Example
# ============================================
if __name__ == "__main__":
    user_id = "user_123"
    
    # Pre-flight check
    status = preflight_check(user_id, ["gmail", "github"])
    print(f"Connected: {status['connected']}")
    print(f"Need auth: {status['pending']}")
    
    if not status['all_ready']:
        for toolkit in status['pending']:
            result = connect_if_needed(
                user_id, 
                toolkit, 
                "https://myapp.com/auth/callback"
            )
            print(f"Redirect user to: {result['redirect_url']}")
```

### TypeScript: Complete Connection Management

```typescript
import { Composio } from '@composio/core';

const composio = new Composio({ apiKey: 'your-api-key' });

// ============================================
// 1. Check if user has a toolkit connected
// ============================================
async function checkConnection(userId: string, toolkit: string): Promise<boolean> {
  const session = await composio.create(userId, {
    manageConnections: false
  });
  
  const toolkits = await session.toolkits();
  
  const found = toolkits.items.find(tk => tk.slug === toolkit);
  return found?.connection?.connectedAccount !== undefined;
}

// ============================================
// 2. Get all connections for a user
// ============================================
async function listUserConnections(userId: string) {
  const accounts = await composio.connectedAccounts.list({
    userIds: [userId],
    statuses: ['ACTIVE']
  });
  
  return accounts.items.map(account => ({
    id: account.id,
    toolkit: account.toolkit.slug,
    status: account.status
  }));
}

// ============================================
// 3. Initiate OAuth if not connected
// ============================================
async function connectIfNeeded(
  userId: string, 
  toolkit: string
): Promise<{ status: 'connected' | 'needs_auth'; redirectUrl?: string; connectionId?: string }> {
  
  const isConnected = await checkConnection(userId, toolkit);
  
  if (isConnected) {
    return { status: 'connected' };
  }
  
  const session = await composio.create(userId, { manageConnections: false });
  const connectionRequest = await session.authorize(toolkit);
  
  return {
    status: 'needs_auth',
    redirectUrl: connectionRequest.redirectUrl,
    connectionId: connectionRequest.id
  };
}

// ============================================
// 4. Wait for OAuth completion
// ============================================
async function waitForOAuthCompletion(
  connectionId: string, 
  timeoutMs: number = 300000
): Promise<{ success: boolean; accountId?: string; error?: string }> {
  try {
    const connectedAccount = await composio.connectedAccounts.waitForConnection(
      connectionId, 
      timeoutMs
    );
    
    return {
      success: true,
      accountId: connectedAccount.id
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// ============================================
// 5. Disconnect/revoke connection
// ============================================
async function disconnect(connectedAccountId: string): Promise<void> {
  await composio.connectedAccounts.delete(connectedAccountId);
}

// ============================================
// 6. Full pre-flight check
// ============================================
async function preflightCheck(
  userId: string, 
  requiredToolkits: string[]
): Promise<{
  connected: string[];
  pending: string[];
  allReady: boolean;
}> {
  const session = await composio.create(userId, { manageConnections: false });
  const toolkits = await session.toolkits();
  
  const connectedSet = new Set(
    toolkits.items
      .filter(tk => tk.connection?.connectedAccount)
      .map(tk => tk.slug)
  );
  
  const connected = requiredToolkits.filter(t => connectedSet.has(t));
  const pending = requiredToolkits.filter(t => !connectedSet.has(t));
  
  return {
    connected,
    pending,
    allReady: pending.length === 0
  };
}

// ============================================
// 7. Get tools only for connected services
// ============================================
async function getConnectedTools(userId: string): Promise<any[]> {
  const session = await composio.create(userId, { manageConnections: false });
  
  // This returns tools only for toolkits the user has connected
  const tools = await session.tools();
  
  return tools;
}
```

### Backend API Routes (Next.js Example)

```typescript
// pages/api/composio/toolkits.ts
import { Composio } from '@composio/core';
import type { NextApiRequest, NextApiResponse } from 'next';

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY! });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = req.headers['x-user-id'] as string;
  
  if (!userId) {
    return res.status(401).json({ error: 'User ID required' });
  }
  
  const session = await composio.create(userId, { manageConnections: false });
  const toolkits = await session.toolkits();
  
  res.json({
    items: toolkits.items.map(tk => ({
      slug: tk.slug,
      name: tk.name,
      isConnected: !!tk.connection?.connectedAccount,
      connectedAccountId: tk.connection?.connectedAccount?.id
    }))
  });
}

// pages/api/composio/connect.ts
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { userId, toolkit } = req.body;
  
  const session = await composio.create(userId, { manageConnections: false });
  const connectionRequest = await session.authorize(toolkit);
  
  res.json({
    redirectUrl: connectionRequest.redirectUrl,
    connectionId: connectionRequest.id
  });
}

// pages/api/composio/connection-status/[id].ts
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  
  try {
    const account = await composio.connectedAccounts.get(id as string);
    res.json({ status: account.status });
  } catch {
    res.json({ status: 'NOT_FOUND' });
  }
}

// pages/api/composio/disconnect/[id].ts
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { id } = req.query;
  await composio.connectedAccounts.delete(id as string);
  
  res.json({ success: true });
}
```

---

## Webhook/Polling for OAuth Completion

### Method 1: SDK Polling (Recommended for Backend)

The SDK provides `waitForConnection()` which polls internally:

```python
# Python
connection_request = session.authorize("gmail")
print(f"Redirect user to: {connection_request.redirect_url}")

# This blocks and polls until complete (default 60 second timeout)
connected_account = connection_request.wait_for_connection(timeout=120)
print(f"Connected! Account ID: {connected_account.id}")
```

```typescript
// TypeScript
const connectionRequest = await session.authorize("gmail");
console.log(`Redirect user to: ${connectionRequest.redirectUrl}`);

// This polls until complete (default 60 second timeout)
const connectedAccount = await connectionRequest.waitForConnection(120000);
console.log(`Connected! Account ID: ${connectedAccount.id}`);
```

### Method 2: Callback URL + Frontend Detection

Configure a callback URL and detect completion on your page:

```typescript
// 1. Initiate with callback URL
const connectionRequest = await composio.connectedAccounts.initiate(
  userId,
  authConfigId,
  { callbackUrl: 'https://myapp.com/auth/callback?toolkit=gmail' }
);

// 2. Your callback page (pages/auth/callback.tsx)
function AuthCallbackPage() {
  const router = useRouter();
  const { toolkit } = router.query;
  
  useEffect(() => {
    // Connection is now complete - the callback is only hit after OAuth succeeds
    // Close popup or redirect
    if (window.opener) {
      window.opener.postMessage({ type: 'oauth-complete', toolkit }, '*');
      window.close();
    } else {
      router.push('/settings/connections');
    }
  }, []);
  
  return <div>Connecting...</div>;
}

// 3. Parent window listens for completion
window.addEventListener('message', (event) => {
  if (event.data.type === 'oauth-complete') {
    console.log(`${event.data.toolkit} connected!`);
    refreshConnectionList();
  }
});
```

### Method 3: Manual Polling API

If you need more control, poll the connection status directly:

```typescript
async function pollConnectionStatus(
  connectionId: string,
  maxAttempts: number = 60,
  intervalMs: number = 2000
): Promise<'ACTIVE' | 'FAILED' | 'TIMEOUT'> {
  
  for (let i = 0; i < maxAttempts; i++) {
    const account = await composio.connectedAccounts.get(connectionId);
    
    if (account.status === 'ACTIVE') {
      return 'ACTIVE';
    }
    
    if (['FAILED', 'EXPIRED'].includes(account.status)) {
      return 'FAILED';
    }
    
    // Still INITIATED or PENDING, keep polling
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  
  return 'TIMEOUT';
}
```

### Method 4: Webhooks (For Production Event-Driven Architectures)

Composio supports webhooks for trigger events. While primarily used for toolkit triggers (like "new email received"), you could potentially use webhooks for connection status changes in the future.

Current webhook setup is for toolkit triggers:

```python
# Configure webhook URL in Composio dashboard
# Settings → Events & Triggers → Webhook URL

# Your webhook handler
@app.post("/webhook")
async def webhook_handler(request: Request):
    payload = await request.json()
    trigger_type = payload.get("type")
    
    # Handle different event types
    if trigger_type == "connection_status_changed":  # Hypothetical
        user_id = payload.get("user_id")
        toolkit = payload.get("toolkit")
        status = payload.get("status")
        # Update your database, notify user, etc.
    
    return {"status": "success"}
```

---

## Summary: Agenta Integration Recommendations

For Agenta's agent feature, the recommended approach is:

1. **Use the Session API** for all connection management
2. **Store user IDs** that map to your Agenta users (e.g., `agenta_user_{user_id}`)
3. **Pre-flight connection checks** before agent conversations
4. **Manual auth flow** with popup-based OAuth for settings page
5. **SDK polling** (`waitForConnection`) for backend OAuth completion detection
6. **Callback URL** pointing to your app for frontend OAuth completion detection

### Key SDK Methods for Agenta

| Method | Purpose |
|--------|---------|
| `composio.create(user_id)` | Create session for user |
| `session.toolkits()` | Check connection status for all toolkits |
| `session.authorize(toolkit)` | Initiate OAuth, get redirect URL |
| `connectionRequest.waitForConnection()` | Wait for OAuth to complete |
| `composio.connectedAccounts.list()` | List all user's connections |
| `composio.connectedAccounts.delete()` | Revoke/disconnect |
| `session.tools()` | Get tools for connected services |
