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

- `GET /preview/ai/services/status` returns `enabled: false`
- `POST /preview/ai/services/tools/call` returns HTTP 503

## HTTP API

Base path: `/preview/ai/services`

### GET /preview/ai/services/status

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
          "refined_prompt": {"type": "string", "description": "The refined prompt template as a stringified JSON object."},
          "messages": {"type": "array", "description": "The refined messages array for verification."}
        },
        "required": ["refined_prompt", "messages"]
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

### POST /preview/ai/services/tools/call

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
      "text": "{\"messages\":[...],\"template_format\":\"curly\",\"input_keys\":[\"input_text\"]}"
    }
  ],
  "structuredContent": {
    "refined_prompt": "{\"messages\":[...],\"template_format\":\"curly\",\"input_keys\":[\"input_text\"]}",
    "messages": [
      {"role": "system", "content": "Refined system content."},
      {"role": "user", "content": "Refined user content with {{input_text}}."}
    ]
  },
  "isError": false,
  "meta": {
    "trace_id": "optional"
  }
}
```

Notes:
- `content[0].text` contains the stringified refined JSON prompt template (same as `structuredContent.refined_prompt`).
- `structuredContent.refined_prompt` is a stringified JSON object containing the full refined prompt template (messages, template_format, input_keys, etc.).
- `structuredContent.messages` is a verification copy of the messages array (same count, same roles, same order as input).
- The backend validates that `refined_prompt` is valid JSON and contains a well-formed `messages` array before returning success.

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
- 403: forbidden (EE permission checks)
- 429: rate limited
- 503: AI services disabled / not configured

## Env Vars (Backend)

Required (Chapter 1):

```bash
AGENTA_AI_SERVICES_API_KEY=ag-xxx
AGENTA_AI_SERVICES_API_URL=https://eu.cloud.agenta.ai
AGENTA_AI_SERVICES_ENVIRONMENT=production

AGENTA_AI_SERVICES_REFINE_PROMPT_APP=ai-refine
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
    "prompt_template_json": "<stringified JSON prompt template>",
    "guidelines": "...",
    "context": "..."
  },
  "environment": "production",
  "app": "ai-refine"
}
```

Expected response:

```json
{
  "version": "3.0",
  "data": "{\"refined_prompt\":\"<stringified JSON template>\",\"messages\":[...]}",
  "content_type": "text/plain",
  "trace_id": "...",
  "tree_id": "...",
  "span_id": "..."
}
```

The `data` field is a JSON string (structured output from the model). The backend parses it, validates `refined_prompt` is a valid JSON prompt template, and maps it into the `ToolCallResponse`.

## Permission + Rate Limits

- Auth context comes from existing middleware (request.state).
- In EE, the refine tool should require the closest existing permission for prompt editing (recommendation: `EDIT_WORKFLOWS`).
- Add a simple rate limit at the router boundary (return HTTP 429).
