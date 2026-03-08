# Spec: AI Services Tool Calls (Chapter 1)

## Scope

Chapter 1 ships one tool via a REST API:

- `tools.agenta.api.refine_prompt`

The REST contract is intentionally shaped like MCP `tools/call` (name + arguments; content + structuredContent) so we can add more tools later without changing the interface.

This is **not** MCP JSON-RPC. There is no `initialize`, no session headers, and no JSON-RPC envelope.

## Tool Naming

Tool names are globally namespaced:

- `tools.agenta.api.<tool>` for first-party tools
- Future third-party examples: `tools.composio.gmail.send_email`

## Feature Flag

AI services are enabled when all required env vars are present.

If disabled:

- `GET /ai/services/status` returns `enabled: false`
- `POST /ai/services/tools/call` returns HTTP 503

## HTTP API

Base path: `/ai/services`

### GET /ai/services/status

Used by the frontend to decide whether to show AI actions.

Response (200):

```json
{
  "enabled": true,
  "tools": [
    {
      "name": "tools.agenta.api.refine_prompt",
      "title": "Refine Prompt",
      "description": "Refine a prompt template. Input is a stringified JSON prompt template; output is a refined version with the same structure.",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "prompt_template_json": {"type": "string", "description": "The full prompt template as a stringified JSON object."},
          "guidelines": {"type": "string"},
          "context": {"type": "string"}
        },
        "required": ["prompt_template_json"]
      },
      "outputSchema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "messages": {
            "type": "array",
            "description": "The refined messages array (same count and roles as input).",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "role": {"type": "string", "enum": ["system", "developer", "user", "assistant"]},
                "content": {"type": "string"}
              },
              "required": ["role", "content"]
            }
          },
          "summary": {"type": "string", "description": "A short summary describing what was changed in this refinement."}
        },
        "required": ["messages", "summary"]
      }
    }
  ]
}
```

When disabled:

```json
{
  "enabled": false,
  "tools": []
}
```

### POST /ai/services/tools/call

Request:

```json
{
  "name": "tools.agenta.api.refine_prompt",
  "arguments": {
    "prompt_template_json": "{\"messages\":[{\"role\":\"system\",\"content\":\"You are a helpful assistant.\"},{\"role\":\"user\",\"content\":\"Extract entities from: {{input_text}}\"}],\"template_format\":\"curly\",\"input_keys\":[\"input_text\"]}",
    "guidelines": "Optional guidelines for refinement.",
    "context": "Optional context."
  }
}
```

Success response (200):

```json
{
  "content": [
    {
      "type": "text",
      "text": "Added explicit extraction format and improved role clarity."
    }
  ],
  "structuredContent": {
    "messages": [
      {"role": "system", "content": "Refined system content."},
      {"role": "user", "content": "Refined user content with {{input_text}}."}
    ],
    "summary": "Added explicit extraction format and improved role clarity."
  },
  "isError": false,
  "meta": {
    "trace_id": "optional"
  }
}
```

Notes:
- `content[0].text` contains the summary of what was changed (same as `structuredContent.summary`).
- `structuredContent.messages` is the refined messages array (same count, same roles, same order as input).
- `structuredContent.summary` is a short human-readable description of the refinement changes, displayed in the chat UI.
- The backend validates that `messages` is a well-formed array of `{role, content}` objects before returning success.

Tool execution error response (200):

```json
{
  "content": [
    {
      "type": "text",
      "text": "Actionable error message."
    }
  ],
  "isError": true,
  "meta": {
    "trace_id": "optional"
  }
}
```

Error status codes:

- 400: invalid request shape (unknown tool name, invalid args types)
- 401: unauthenticated (handled by existing auth middleware)
- 429: rate limited
- 503: AI services disabled / not configured

## Env Vars (Backend)

Required (Chapter 1):

```bash
AGENTA_AI_SERVICES_API_KEY=ag-xxx
AGENTA_AI_SERVICES_API_URL=https://eu.cloud.agenta.ai
AGENTA_AI_SERVICES_ENVIRONMENT_SLUG=production
AGENTA_AI_SERVICES_REFINE_PROMPT_KEY=ai-refine
```

Notes:

- Bedrock credentials are configured in the internal Agenta app.
- Backend uses only `AGENTA_AI_SERVICES_API_KEY` to call the deployed prompt.

## Backend Call (Cloud Invocation)

The backend implements a thin client that calls the Agenta API using `ApiKey` auth.

Target endpoint is the Agenta services completion runner:

- `POST {AGENTA_AI_SERVICES_API_URL}/services/completion/run`

Invocation payload:

```json
{
  "inputs": {
    "__ag_prompt_template_json": "<stringified JSON prompt template>",
    "__ag_guidelines": "...",
    "__ag_context": "..."
  },
  "environment": "production",
  "app": "ai-refine"
}
```

Expected response:

```json
{
  "version": "3.0",
  "data": "{\"messages\":[{\"role\":\"system\",\"content\":\"...\"},{\"role\":\"user\",\"content\":\"...\"}],\"summary\":\"Added explicit extraction format.\"}",
  "content_type": "text/plain",
  "trace_id": "...",
  "tree_id": "...",
  "span_id": "..."
}
```

The `data` field is a JSON string (structured output from the model). The backend parses it, validates `messages` is a well-formed array, and maps it into the `ToolCallResponse`.

## Permission + Rate Limits

- Auth context comes from existing middleware (request.state).
- In EE, request throttling for tool execution is configured in entitlements middleware via the `AI_SERVICES` category.
- In OSS, no router-level rate limit is applied for this endpoint.
- Organization-level feature flagging for AI services is planned (owner-controlled org setting).
