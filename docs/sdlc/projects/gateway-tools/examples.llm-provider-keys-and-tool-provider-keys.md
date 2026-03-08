# Examples: LLM Provider Keys and Tool Provider Keys

This document captures:
- A concrete view of how Agenta models LLM provider keys today (via `secrets`).
- A suggested parallel model for tool provider keys (tool connections) using the same approach.

**Existing: LLM Provider Keys (Today)**
- Secret storage is centralized in `secrets` with `kind` + typed `data`.
- `secrets.data` is encrypted at rest (PGP field).
- Source code reference:
- `agenta/api/oss/src/core/secrets/enums.py`
- `agenta/api/oss/src/core/secrets/dtos.py`
- `agenta/api/oss/src/dbs/postgres/secrets/dbas.py`

**Secret Kinds**
- `provider_key`: standard LLM provider API keys (OpenAI, Anthropic, etc.).
- `custom_provider`: custom LLM provider configuration (URL, key, models list).
- `sso_provider`: SSO provider configuration (client id/secret, issuer, scopes).

**LLM Secret Payload Shapes**

**1) Standard LLM Provider Key (`kind=provider_key`)**
- Model: `StandardProviderDTO` in `agenta/api/oss/src/core/secrets/dtos.py`.

```json
{
  "header": {
    "name": "OpenAI key",
    "description": "Primary OpenAI API key"
  },
  "secret": {
    "kind": "provider_key",
    "data": {
      "kind": "openai",
      "provider": {
        "key": "sk-..."
      }
    }
  }
}
```

**2) Custom LLM Provider (`kind=custom_provider`)**
- Model: `CustomProviderDTO` in `agenta/api/oss/src/core/secrets/dtos.py`.

```json
{
  "header": {
    "name": "acme-llm",
    "description": "Custom provider for Acme"
  },
  "secret": {
    "kind": "custom_provider",
    "data": {
      "kind": "custom",
      "provider": {
        "url": "https://llm.acme.example/v1",
        "version": "2026-01-01",
        "key": "sk-acme-...",
        "extras": {
          "timeout_seconds": 30
        }
      },
      "models": [
        {
          "slug": "gpt-ish-1",
          "extras": {
            "max_tokens": 4096
          }
        }
      ]
    }
  }
}
```

**3) SSO Provider (`kind=sso_provider`)**
- Model: `SSOProviderDTO` in `agenta/api/oss/src/core/secrets/dtos.py`.

```json
{
  "header": {
    "name": "Okta",
    "description": "Okta SSO"
  },
  "secret": {
    "kind": "sso_provider",
    "data": {
      "provider": {
        "client_id": "abc",
        "client_secret": "xyz",
        "issuer_url": "https://example.okta.com/oauth2/default",
        "scopes": ["openid", "profile", "email"],
        "extra": {
          "audience": "api://default"
        }
      }
    }
  }
}
```

**Important Observations (Useful For Tools)**
- The shape of `data` is kind-specific and validated.
- The secret header is user-visible and used as an identifier in some flows (e.g., custom provider slugging).
- Provider-specific details (keys, URLs, extras) live inside `secrets.data`, not scattered across other entities.

---

**Suggested: Tool Provider Keys (Tool Connections)**

**High-Level Principle**
- Tool connections should be modeled as `secrets` too.
- The persisted record is a "tool provider key" secret, not a ToolConnection entity.
- This keeps tool auth state encrypted and reduces the number of moving parts in the core domain.

**New Secret Kind**
- Add: `tool_provider_key` to `SecretKind`.

**Gateway Kind Enum**
- Proposed: `ToolGatewayKind = composio | mcp | custom | agenta`.
- Note: use `agenta` (not `agenta_builtin`).
 - Convention: for `kind=tool_provider_key`, store the gateway kind in `secret.data.kind` (mirrors LLM secrets).

**Provider Slug**
- Provider is the user-facing tool family: `gmail`, `slack`, `github`, `jira`, `zendesk`.
- Provider slug can be dynamic if the catalog is dynamic.

**Connection Slug**
- Each secret has a stable `slug` used to bind tools when multiple connections exist.
- The binding is surfaced by the tool name suffix: `tools.gateway.{provider}.{tool}.{connection_slug}`.

**Where The Gateway API Key Lives**
- User-supplied gateway API key is stored inside the secret payload.
- If absent and supported, Agenta uses an internal key for the gateway kind.

---

## Proposed Tool Provider Key Secret Shapes

These examples are intentionally explicit about the gateway kind, even if the tool slug itself does not include it.

**1) Composio OAuth Connection (`tool_provider_key`, `kind=composio`)**

```json
{
  "header": {
    "name": "Support inbox",
    "description": "Primary support mailbox"
  },
  "secret": {
    "kind": "tool_provider_key",
    "data": {
      "kind": "composio",
      "provider": {
        "slug": "gmail"
      },
      "connection": {
        "slug": "support_inbox",
        "status": "pending"
      },
      "gateway": {
        "api_key": null
      },
      "auth": {
        "mode": "oauth",
        "composio": {
          "connected_account_id": "ca_...",
          "user_id": "project_..."
        }
      }
    }
  }
}
```

Notes:
- `gateway.api_key=null` means "use internal Composio key if available".
- `auth.composio.*` is the opaque provider execution context (kept encrypted).

**2) Composio OAuth With User Gateway Key**

```json
{
  "header": {
    "name": "Support inbox",
    "description": "Uses customer Composio key"
  },
  "secret": {
    "kind": "tool_provider_key",
    "data": {
      "kind": "composio",
      "provider": { "slug": "gmail" },
      "connection": { "slug": "support_inbox", "status": "active" },
      "gateway": {
        "api_key": "cmp_live_..."
      },
      "auth": {
        "mode": "oauth",
        "composio": {
          "connected_account_id": "ca_...",
          "user_id": "project_..."
        }
      }
    }
  }
}
```

**3) MCP Connection (`tool_provider_key`, `kind=mcp`)**

```json
{
  "header": {
    "name": "Customer MCP Gmail",
    "description": "Customer-hosted MCP server that exposes Gmail tools"
  },
  "secret": {
    "kind": "tool_provider_key",
    "data": {
      "kind": "mcp",
      "provider": {
        "slug": "gmail"
      },
      "connection": {
        "slug": "customer_mcp_gmail",
        "status": "active"
      },
      "gateway": {
        "api_key": null
      },
      "auth": {
        "mode": "mcp",
        "mcp": {
          "server_url": "https://mcp.customer.example",
          "server_id": "customer-gmail-mcp",
          "headers": {
            "Authorization": "Bearer ..."
          }
        }
      }
    }
  }
}
```

Notes:
- `provider.slug=gmail` remains the user-facing provider even if the implementation is MCP.
- The MCP server details live in the encrypted secret payload.

**4) Agenta Gateway Connection (`tool_provider_key`, `kind=agenta`)**

```json
{
  "header": {
    "name": "Agenta Gmail",
    "description": "Agenta-hosted connector"
  },
  "secret": {
    "kind": "tool_provider_key",
    "data": {
      "kind": "agenta",
      "provider": { "slug": "gmail" },
      "connection": { "slug": "agenta_gmail", "status": "active" },
      "gateway": { "api_key": null },
      "auth": {
        "mode": "internal",
        "agenta": {
          "connector_id": "conn_..."
        }
      }
    }
  }
}
```

---

## Suggested `/tools/connect` and `/tools/callback` Flow (Body Payload)

**POST `/tools/connect`**
- Creates or updates a `tool_provider_key` secret in `pending` state.
- Returns a redirect URL when OAuth is required.

```json
{
  "kind": "composio",
  "provider_slug": "gmail",
  "connection_slug": "support_inbox",
  "name": "Support inbox",
  "description": "Primary support mailbox",
  "gateway_api_key": null,
  "mode": "oauth",
  "callback_url": "https://app.agenta.ai/tools/callback"
}
```

**Response (OAuth)**
```json
{
  "secret_id": "some-secret-id",
  "status": "pending",
  "redirect_url": "https://connect.example/link/ln_..."
}
```

**POST `/tools/callback`**
- Finalizes OAuth and updates the secret to `active` (or `failed`).
- Payload depends on provider; for OAuth providers it often includes `state` and `code`.

```json
{
  "secret_id": "some-secret-id",
  "state": "opaque-state",
  "code": "oauth-code"
}
```

---

## Tool Invocation With Bound/Unbound Slugs

**Unbound (allowed only if exactly one active connection exists)**
- `tools.gateway.gmail.SEND_EMAIL`

**Bound (required if multiple connections exist)**
- `tools.gateway.gmail.SEND_EMAIL.support_inbox`
- `tools.gateway.gmail.SEND_EMAIL.marketing_inbox`

**Invoke Request Example**
```json
{
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "tools.gateway.gmail.SEND_EMAIL.support_inbox",
        "arguments": "{\"to\":\"a@example.com\",\"subject\":\"Hi\",\"body\":\"...\"}"
      }
    }
  ]
}
```

---

## Validation / Enforcement Suggestions

**Uniqueness**
- Enforce uniqueness of connection slug per project and provider slug for `tool_provider_key`.

**Ambiguity**
- If multiple active secrets exist for `provider_slug=gmail` and invocation is unbound, return an explicit ambiguity error containing available `connection_slug` values.

**Gateway key fallback**
- If `gateway.api_key` is null:
- If Agenta has an internal key configured for the gateway kind, use it.
- Otherwise return an error instructing user to supply `gateway_api_key`.
