Problem

SMEs use Agenta to prototype AI use cases before engineering takes over. Today they can only work with single prompts. If the agent needs to call external tools (GitHub, Gmail, Slack), engineers must build the integration themselves.

We want SMEs to connect real tools and build multi-step agents directly in Agenta. The challenge: tools require OAuth flows and credential management, which is beyond what most SMEs can handle alone.

This RFC defines the API that makes this possible.

See PRD: Agents & Tools in Agenta for full context.

Scope

This RFC defines the Tools API surface and the responsibility boundaries required to support tool-based agents in Agenta:

Tool Management: Discovering integrations and capabilities (tools, resources, prompts). Managing connection lifecycles.

Tool Execution: Executing tools behind the Tools API gateway and selecting which connection to use when multiple exist.

Nomenclature

Provider

The external tool backend that catalogs and executes capabilities. Examples: composio, mcp, custom (customer-hosted), agenta_builtin.

Gateway

The Agenta-managed routing and execution layer for third-party tools. This is exposed as the `tools.gateway` namespace in tool slugs to distinguish external tools from built-in tools.

Integration (aka kit)

A user-facing collection of tools you connect to (gmail, github, slack). The gateway backing it is an internal detail.

Capability

Something callable or fetchable that an integration exposes. There are three kinds: tool, resource, prompt.

Tool / Resource / Prompt

Concrete capability kinds. MCP defines all three natively. Composio mainly provides tools.

Connection (aka connector)

A project-scoped record that binds {project_id, provider, integration} to an auth and execution context. A project can have multiple connections to the same integration (e.g., two Gmail accounts).

Bound tool

A tool scoped to a specific connection. This is the unit we expose to the LLM when multiple connections exist.

Identifiers

Tool slug (unbound): tools.gateway.{provider}.{integration}.{name}

Example: tools.gateway.composio.gmail.SEND_EMAIL

Bound tool slug: tools.gateway.{provider}.{integration}.{name}.{connection_slug}

Example: tools.gateway.composio.gmail.SEND_EMAIL.support_inbox

Connection slug: project-unique string used for disambiguation in tool names (support_inbox). The slug is stable and user-visible.

Connection id: Agenta UUID. Stable internal primary key.

Provider ref: provider-specific identifiers needed for execution. Internal only, never returned to clients.

Requirements

Must Have

Multiple providers. The API must support Composio now and other providers (MCP, built-in) later. Provider-specific details must not leak into the API surface.

Gateway execution. Tool execution happens behind the Tools API. Clients never receive provider refs or provider credentials.

Project-scoped and user-scoped connections. Connections belong to a project by default, but might in the future belong to a user.

Multiple connections per integration. A project can connect two Gmail accounts or two GitHub orgs. The user in the future might select which connection to use.

Future Considerations

Human approval. Some tool calls may require user approval before execution. This is out of scope for v1. The approval mechanism (how the agent pauses, waits, and resumes) is a separate design.

Connection status management. Connections can expire or become invalid. The API exposes status; the UI should prompt re-authentication when needed.

General Flow

There are two main flows: connecting an integration (setup) and using tools (runtime).

Connecting an Integration

User opens project settings and navigates to integrations.

User sees available integrations (Gmail).

User clicks "Connect" on an integration.

For OAuth: a popup opens, user authenticates, popup closes. The frontend polls until the connection is active.

For API key: user enters the key, backend validates it, connection is active immediately.

The connection is now stored. The integration's capabilities are available in the playground.

Using Tools in the Playground

User configures an agent in the playground.

User opens the tools panel and browses available capabilities.

User selects specific tools. If multiple connections exist, the UI exposes bound tools (e.g., tools.gateway.composio.gmail.SEND_EMAIL.support_inbox).

The selected tools become part of the agent configuration.

Agent Execution

User runs the agent service with an input prompt that includes the tool schemas.

The service calls the LLM with the prompt and tool schemas.

If the LLM returns a tool call, the service forwards the tool calls to the Tools API run endpoint. The API executes the tool behind the gateway and returns tool messages.

The service appends tool messages and continues the loop until the LLM returns a final response.

Design Decisions

How does the system know which connection to use?

Problem: A tool call like tools.gateway.composio.gmail.SEND_EMAIL identifies the integration but not which connection to use when multiple exist.

Decision:

Connections have a project-unique connection_slug (support_inbox).

Tool slugs come in two forms:

Unbound: tools.gateway.{provider}.{integration}.{name}

Bound: tools.gateway.{provider}.{integration}.{name}.{connection_slug}

When exactly one active connection exists for an integration, the gateway may resolve unbound tool slugs to that connection.

When multiple connections exist, the catalog returns bound tool slugs (one per connection) and the UI exposes them as separate tools. The agent config stores the bound tool slugs so LLM tool calls are unambiguous.

Where does tool execution happen?

Decision: Tool execution happens behind the Tools API gateway. The agent service is provider-agnostic and only forwards tool calls to the run endpoint. Provider refs and credentials never leave the backend.

Where does approval configuration live?

Question: Where should requires_approval / auto_approve be configured? Options: per tool definition, per integration, per connection, or per agent config.

Options

Per tool definition. The tool itself declares whether it needs approval. This is static and cannot be customized.

Per integration or connection. The project decides at connection time whether tools from this integration need approval. Applies to all tools in that integration.

Per agent config. The agent configuration specifies which tools need approval. This is flexible and can vary per agent.

Per run. The caller decides at runtime whether to require approval. Maximum flexibility but complex to implement.

Decision

Approval configuration belongs in the agent config, not in the tool definition or API. The tool definition describes what a tool does. Whether to require approval before calling it is a policy decision that varies by use case.

This has an implication: agents need their own config schema, separate from simple prompts. A simple prompt config does not include tool selection or approval settings. An agent config does.

Note: This question is about where the configuration lives. The mechanism for approval (how the agent pauses, waits for approval, and resumes) is a separate question.

Tools API Design

This section defines the Tools API for discovery, connection management, and execution behind the gateway.

Scope and Auth

These endpoints operate in a project context. The backend derives project_id from the authenticated request (for example, from request.state.project_id). Clients do not pass project_id in the URL.

Proposed base path: /api/tools.

Concepts in the API

A gateway catalogs integrations and capabilities. It also supports connection initiation, status checks, and execution. The gateway is an internal detail and is not exposed in API responses.

A connection is a project-scoped record. It binds a provider and integration to an execution context. For Composio, that context includes the Composio connected account id.

Responses

List endpoints return count and an array field. Single-resource endpoints return the resource object.  [Important Note: Let's review this to make sure it is consistent with existing API responses]

Errors should use existing API conventions:

400 for invalid input

401 or 403 for auth and permission issues

404 for unknown resource

409 for conflicts (example: connection already exists when v1 enforces one)

429 for rate limiting (handled by existing API middleware)

500 when the provider backend is unavailable

Rate Limiting: Rate limiting is handled by existing API middleware. No special handling is needed for the Tools API. Provider-side rate limits (e.g., Composio quotas) are returned as 502 or 503 errors with details in the response body.

Catalog

GET /catalog

Returns a flat list of catalog entries (tools/resources/prompts) across providers and integrations. Clients can filter and group as needed.

Inputs (query params):

provider (optional)

integration (optional)

kind (optional, one of tool, resource, prompt. Default tool in v1)

search (optional)

Output (example):

{
  "count": 2,
  "catalog": [
    {
      "slug": "tools.gateway.composio.gmail.SEND_EMAIL",
      "kind": "tool",
      "provider": "composio",
      "integration": "gmail",
      "name": "SEND_EMAIL",
      "display_name": "Send email",
      "description": "Send an email via Gmail"
    },
    {
      "slug": "tools.gateway.composio.gmail.LIST_MESSAGES",
      "kind": "tool",
      "provider": "composio",
      "integration": "gmail",
      "name": "LIST_MESSAGES",
      "display_name": "List messages",
      "description": "List messages in inbox"
    }
  ]
}

GET /catalog?slug={slug} or GET /catalog?slugs={slug1},{slug2}

Returns catalog entries with full schemas. This is what the playground needs to construct the model tool schema. It is also what the gateway uses to validate tool calls.

Single lookup: GET /catalog?slug=tools.gateway.composio.gmail.SEND_EMAIL

Batch lookup: GET /catalog?slugs=tools.gateway.composio.gmail.SEND_EMAIL,tools.gateway.composio.github.CREATE_ISSUE

Output (example):

{
  "count": 1,
  "catalog": [
    {
      "slug": "tools.gateway.composio.gmail.SEND_EMAIL",
      "kind": "tool",
      "provider": "composio",
      "integration": "gmail",
      "name": "SEND_EMAIL",
      "display_name": "Send email",
      "description": "Send an email via Gmail",
      "input_schema": {
        "type": "object",
        "properties": {
          "to": {"type": "string"},
          "subject": {"type": "string"},
          "body": {"type": "string"}
        },
        "required": ["to", "subject", "body"]
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "message_id": {"type": "string"}
        }
      }
    }
  ]
}

Notes:

The response always returns a list, even when filtering by a single slug.

The gateway parses the slug to extract provider, integration, and tool name for execution. If a connection_slug is present, it disambiguates which connection to use.

To bind a tool to a specific connection, append the connection_slug: tools.gateway.{provider}.{integration}.{name}.{connection_slug}.

When multiple connections exist for the same provider/integration, the catalog may return bound tool slugs (one per connection).

Connections (Connectors)

GET /connections

Lists connections for the current project. Connections are safe metadata only; provider refs are never returned.

Inputs (query params):

provider (optional)

integration (optional)

connection_id (optional, for direct lookup)

connection_slug (optional)

status (optional)

Output (example):

{
  "count": 1,
  "connections": [
    {
      "id": "some-secret-id",
      "provider": "composio",
      "integration": "gmail",
      "connection_slug": "support_inbox",
      "status": "ACTIVE",
      "name": "Support inbox",
      "description": "Primary support mailbox",
      "created_at": "2026-02-03T12:00:00Z",
      "updated_at": "2026-02-03T12:05:00Z"
    }
  ]
}

Notes:

Provider refs are internal only. The gateway uses them for execution.

When multiple connections exist, the agent config uses bound tool slugs that include connection_slug.

POST /connections

Creates a connection. The request body determines the auth mode.

If connection_slug is omitted, the backend generates one (for example by normalizing the name).

provider is required for gateway routing and disambiguation.

OAuth request body (example):

{
  "provider": "composio",
  "integration": "gmail",
  "mode": "oauth",
  "callback_url": "https://app.agenta.ai/tools/oauth/callback",
  "connection_slug": "support_inbox",
  "name": "Support inbox",
  "description": "Primary support mailbox"
}

Security note: The callback_url must be validated against an allowlist of permitted domains. For cloud, this is *.agenta.ai. For self-hosted deployments, this should be configurable. Reject requests with callback URLs pointing to untrusted domains to prevent OAuth redirect attacks.

OAuth response body (example):

{
  "connection": {
    "id": "some-secret-id",
    "provider": "composio",
    "integration": "gmail",
    "connection_slug": "support_inbox",
    "status": "PENDING",
    "name": "Support inbox",
    "description": "Primary support mailbox"
  },
  "redirect_url": "https://connect.composio.dev/link/ln_abc123"
}

API key request body (example):

{
  "provider": "composio",
  "integration": "stripe",
  "mode": "api_key",
  "connection_slug": "prod_key",
  "name": "Prod key",
  "credentials": {
    "api_key": "sk_live_..."
  }
}

API key response body (example):

{
  "connection": {
    "id": "some-secret-id",
    "provider": "composio",
    "integration": "stripe",
    "connection_slug": "prod_key",
    "status": "ACTIVE",
    "name": "Prod key",
    "description": null
  }
}

Why use a POST payload and not query params:

The body is the right place for auth mode, callback URL, and credentials.

It is easier to validate and extend later.

GET /connections/{connection_id}

Returns the connection and its status. This supports polling.

Output (example):

{
  "connection": {
    "id": "some-secret-id",
    "provider": "composio",
    "integration": "gmail",
    "connection_slug": "support_inbox",
    "status": "ACTIVE",
    "name": "Support inbox",
    "description": "Primary support mailbox",
    "last_error": null
  }
}

DELETE /connections/{connection_id}

Deletes the connection. Agenta should revoke or delete the provider side account when possible, then remove the local record.

POST /connections/{connection_id}/refresh

Attempts to refresh an expired or failing connection. This is useful when OAuth tokens expire and need re-authorization.

Request body (optional):

{
  "force": false
}

Response (example):

{
  "connection": {
    "id": "some-secret-id",
    "provider": "composio",
    "integration": "gmail",
    "connection_slug": "support_inbox",
    "status": "ACTIVE",
    "name": "Support inbox",
    "description": "Primary support mailbox"
  },
  "redirect_url": null
}

Notes:

If the provider can refresh tokens silently (e.g., Composio auto-refresh), redirect_url is null and status becomes ACTIVE.

If re-authentication is required, redirect_url is returned and status becomes INITIATED. The frontend handles the OAuth flow as during initial connection.

If force is true, always initiate re-authentication even if current tokens are valid.

Tool Execution

POST /run

Executes tool calls behind the gateway and returns OpenAI-style tool messages.

Request body (example):

{
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "tools.gateway.composio.gmail.SEND_EMAIL.support_inbox",
        "arguments": "{\"to\": \"alice@example.com\", \"subject\": \"Hello\", \"body\": \"Just saying hi!\"}"
      }
    }
  ]
}

Response body (example):

{
  "tool_messages": [
    {
      "role": "tool",
      "tool_call_id": "call_abc123",
      "content": "{\"message_id\": \"msg_789xyz\", \"status\": \"sent\"}"
    }
  ],
  "errors": []
}

Tool Execution (Gateway)

This section describes how the Tools API executes tool calls at runtime. The agent service owns the agent loop, but it is provider-agnostic and delegates tool execution to the gateway via POST /run.

Tool calls use OpenAI-style function calls:

function.name

function.arguments (a JSON string)

Connection Resolution

Parse function.name as a tool slug and extract provider, integration, optional connection_slug, and tool name.

If connection_slug is present, resolve that specific connection.

If connection_slug is absent:

If exactly one ACTIVE connection exists for the integration, use it.

If none exist, return CONNECTION_NOT_FOUND.

If multiple exist, return CONNECTION_AMBIGUOUS and prompt the user to select a specific connection (bound tool).

Executing a Tool Call

Execution steps for each tool call:

Parse function.arguments as JSON. If parsing fails, return INVALID_ARGUMENTS.

Validate arguments against the tool schema.

Execute using the gateway adapter for the backing provider.

Convert the result into an OpenAI tool message:

role is tool

tool call id equals the original tool_call.id

content is the tool result encoded as JSON text

The gateway returns tool messages in the same order as the tool calls.

Error Handling

The gateway returns structured errors that enable the agent loop to make informed decisions.

Error Categories

Error Code

Description

Retryable

Action

CONNECTION_NOT_FOUND

No connection exists for the required integration

No

Fail the run; prompt user to connect integration

CONNECTION_AMBIGUOUS

Multiple connections exist and no connection_slug was provided

No

Fail the run; prompt user to select a specific connection

CONNECTION_INACTIVE

Connection exists but is not active (expired, failed, disabled)

Maybe

Check if refresh is possible; otherwise fail

CONNECTION_EXPIRED

OAuth tokens expired

Yes

Call refresh endpoint, then retry

INVALID_ARGUMENTS

Tool arguments do not match schema

No

Return error to LLM for self-correction

PROVIDER_ERROR

Upstream execution failed

Maybe

Depends on error; may retry with backoff

PROVIDER_RATE_LIMITED

Upstream rate limit exceeded

Yes

Retry with exponential backoff

PROVIDER_UNAVAILABLE

Upstream service is down

Yes

Retry with backoff; fail after max retries

TOOL_NOT_FOUND

Tool slug does not exist or is not available

No

Fail; check agent configuration

Error Response Format

@dataclass
class ToolError:
    code: str                    # One of the error codes above
    message: str                 # Human-readable description
    tool_call_id: str           # The tool call that failed
    retryable: bool             # Whether retry might succeed
    details: Optional[dict]     # Upstream error details

Error Handling Strategy (v1)

For INVALID_ARGUMENTS: Return the error as a tool message to the LLM. The LLM may attempt to self-correct.

For CONNECTION_EXPIRED: Attempt one refresh, then retry the tool call.

For retryable provider errors: Retry up to 3 times with exponential backoff.

For non-retryable errors: Fail the run immediately with a clear error message.

The agent loop should not attempt infinite retries. After max retries, fail fast and surface the error to the user.

Appendix: Composio Implementation Notes

This appendix documents how Agenta concepts map to Composio's API. These details are provider-specific and should not affect the API design.

Catalog Normalization

The catalog endpoint normalizes the tool schema returned by Composio's tool detail endpoint into our standard format.

Connection Creation (OAuth Flow)

When creating a connection via OAuth with Composio:

Agenta receives the request and validates permissions.

Agenta computes the Composio user_id for this scope (example: derived from project id).

Agenta calls Composio to initiate a connected account for the target integration.

Composio returns a redirect_url and a connected account id.

Agenta stores a Connection with status=PENDING and provider_ref containing the user_id and connected_account_id. provider_ref stays internal and is never returned to clients.

Agenta returns the Connection and the redirect_url.

The frontend opens the redirect_url in a popup and the user completes OAuth.

The frontend polls GET /connections/{id} until status is ACTIVE.

Connection Status Polling

When polling connection status:

If the stored status is PENDING, Agenta checks the Composio connected account status and updates the connection if needed.

If the Composio account expired or failed, Agenta sets status=EXPIRED or FAILED and returns last_error.

Tool Execution

For Composio:

The gateway uses provider_ref to execute tool calls. This JSON object contains user_id (derived from the project) and connected_account_id (the Composio account reference).

The tool slug is parsed to extract the tool name segment, which maps to Composio's action name.

Appendix: End-to-End Example

This example walks through a complete flow: connecting Gmail, discovering tools, and executing a tool call from an agent.

Step 1: Create Connection (OAuth Flow)

User clicks "Connect Gmail" in the UI. Frontend calls:

POST /api/tools/connections
Content-Type: application/json
Authorization: ApiKey <api_key>
{
  "integration": "gmail",
  "mode": "oauth",
  "callback_url": "https://app.agenta.ai/tools/oauth/callback",
  "connection_slug": "support_inbox",
  "name": "Support inbox"
}

Response:

{
  "connection": {
    "id": "some-secret-id",
    "integration": "gmail",
    "connection_slug": "support_inbox",
    "status": "PENDING",
    "name": "Support inbox",
    "description": null
  },
  "redirect_url": "https://connect.composio.dev/link/ln_abc123"
}

Frontend opens redirect_url in a popup. User completes Google OAuth. Frontend polls until status is ACTIVE.

Step 2: Capability Lookup

User configures agent tools in the playground. Frontend fetches available tools:

GET /api/tools/catalog?provider=composio&integration=gmail&kind=tool
Authorization: Bearer <api_key>

Response:

{
  "count": 2,
  "catalog": [
    {
      "slug": "tools.gateway.composio.gmail.SEND_EMAIL",
      "kind": "tool",
      "provider": "composio",
      "integration": "gmail",
      "name": "SEND_EMAIL",
      "display_name": "Send email",
      "description": "Send an email via Gmail"
    },
    {
      "slug": "tools.gateway.composio.gmail.LIST_MESSAGES",
      "kind": "tool",
      "provider": "composio",
      "integration": "gmail",
      "name": "LIST_MESSAGES",
      "display_name": "List messages",
      "description": "List messages in inbox"
    }
  ]
}

User selects the Support inbox connection and SEND_EMAIL. Frontend fetches full schema:

GET /api/tools/catalog?slug=tools.gateway.composio.gmail.SEND_EMAIL
Authorization: Bearer <api_key>

Response:

{
  "count": 1,
  "catalog": [
    {
      "slug": "tools.gateway.composio.gmail.SEND_EMAIL",
      "kind": "tool",
      "provider": "composio",
      "integration": "gmail",
      "name": "SEND_EMAIL",
      "display_name": "Send email",
      "description": "Send an email via Gmail",
      "input_schema": {
        "type": "object",
        "properties": {
          "to": {"type": "string"},
          "subject": {"type": "string"},
          "body": {"type": "string"}
        },
        "required": ["to", "subject", "body"]
      },
      "output_schema": {
        "type": "object",
        "properties": {
          "message_id": {"type": "string"}
        }
      }
    }
  ]
}

The input_schema is used to construct the OpenAI tool definition.

Step 3: Agent Execution with Tool Call

User runs the agent. The service sends prompt + tool schemas to the LLM:

# Agent sends to LLM
messages = [
    {"role": "user", "content": "Send an email to alice@example.com saying hello"}
]
tools = [
    {
        "type": "function",
        "function": {
            "name": "tools.gateway.composio.gmail.SEND_EMAIL.support_inbox",
            "description": "Send an email via Gmail",
            "parameters": {
                "type": "object",
                "properties": {
                    "to": {"type": "string"},
                    "subject": {"type": "string"},
                    "body": {"type": "string"}
                },
                "required": ["to", "subject", "body"]
            }
        }
    }
]

LLM returns a tool call:

{
  "role": "assistant",
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "tools.gateway.composio.gmail.SEND_EMAIL.support_inbox",
        "arguments": "{\"to\": \"alice@example.com\", \"subject\": \"Hello\", \"body\": \"Just saying hi!\"}"
      }
    }
  ]
}

Step 4: Tool Execution

The agent service forwards tool calls to the gateway:

POST /api/tools/run

The gateway executes the tool and returns a tool message:

{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "content": "{\"message_id\": \"msg_789xyz\", \"status\": \"sent\"}"
}

Step 5: Response Back to LLM

The agent appends the tool message and calls the LLM again:

messages = [
    {"role": "user", "content": "Send an email to alice@example.com saying hello"},
    {"role": "assistant", "tool_calls": [...]},
    {"role": "tool", "tool_call_id": "call_abc123", "content": "{\"message_id\": \"msg_789xyz\", \"status\": \"sent\"}"}
]

LLM returns final response:

{
  "role": "assistant",
  "content": "I've sent the email to alice@example.com with the subject 'Hello'. The message was delivered successfully."
}

The agent loop completes and returns this response to the user.
