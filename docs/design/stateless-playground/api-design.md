# API Design: Stateless Playground

## Overview

This document describes the data flow and API contracts for the stateless playground.

---

## Bindings Interface

The Playground UI consumes a bindings interface. Two adapters implement this interface:

```typescript
interface PlaygroundBindings {
  // Mode flag
  isStateless: boolean

  // Data atoms
  schemaAtom: Atom<OpenAPISpec | null>
  uriInfoAtom: Atom<UriInfo>
  draftPromptAtom: Atom<EnhancedPrompt>
  loadableId: string

  // Actions
  updatePrompt: (patch: Partial<EnhancedPrompt>) => void
  execute: (rowId: string) => Promise<void>
}

interface UriInfo {
  runtimePrefix: string   // e.g. "https://cloud.agenta.ai/services/completion"
  routePath: string       // e.g. "completion"
}
```

**App Adapter** (existing behavior):
- `schemaAtom` = `playgroundAppSchemaAtom`
- `uriInfoAtom` = `playgroundAppUriInfoAtom`
- `draftPromptAtom` = `legacyAppRevisionMolecule.atoms.data(revisionId)`
- `execute` = triggers web worker with `application_id`

**Stateless Adapter** (new):
- `schemaAtom` = `completionServiceSchemaAtom`
- `uriInfoAtom` = fixed value for service route
- `draftPromptAtom` = in-memory atom (no server data)
- `execute` = triggers web worker without `application_id`

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         STATELESS PLAYGROUND                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                     │
│   │ Prompt      │    │ Test Cases  │    │ Model       │                     │
│   │ Editor      │    │ (Loadable)  │    │ Config      │                     │
│   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                     │
│          │                  │                  │                            │
│          └────────────┬─────┴──────────────────┘                            │
│                       │                                                      │
│                       ▼                                                      │
│            ┌─────────────────────┐                                          │
│            │   Build Request     │                                          │
│            │   (transformToRequestBody)                                      │
│            └──────────┬──────────┘                                          │
│                       │                                                      │
│                       ▼                                                      │
│            ┌─────────────────────┐                                          │
│            │   Web Worker        │                                          │
│            │   (playground.worker.ts)                                        │
│            └──────────┬──────────┘                                          │
│                       │                                                      │
└───────────────────────┼──────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMPLETION SERVICE                                    │
│                    /services/completion/test                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                     │
│   │ Auth        │    │ Vault       │    │ LiteLLM     │                     │
│   │ Middleware  │───▶│ Middleware  │───▶│ Call        │                     │
│   └─────────────┘    └─────────────┘    └──────┬──────┘                     │
│                                                 │                            │
│                                                 ▼                            │
│                                        ┌─────────────┐                      │
│                                        │ LLM Provider│                      │
│                                        │ (OpenAI, etc)                       │
│                                        └─────────────┘                      │
│                                                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Request Format

### Completion Mode

**Endpoint**: `POST /services/completion/test?project_id={project_id}`

```typescript
interface CompletionTestRequest {
  ag_config: {
    prompt: {
      messages: Message[]
      template_format: 'fstring' | 'jinja2' | 'curly'
      llm_config: {
        model: string
        temperature?: number
        max_tokens?: number
        top_p?: number
        frequency_penalty?: number
        presence_penalty?: number
        response_format?: { type: 'text' | 'json_object' | 'json_schema' }
        tools?: Tool[]
        tool_choice?: 'none' | 'auto' | { type: 'function', function: { name: string } }
      }
    }
  }
  inputs: Record<string, string>
}

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

interface ContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}
```

**Example**:
```json
{
  "ag_config": {
    "prompt": {
      "messages": [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Translate '{text}' to {language}."}
      ],
      "template_format": "fstring",
      "llm_config": {
        "model": "gpt-4o-mini",
        "temperature": 0.7,
        "max_tokens": 1000
      }
    }
  },
  "inputs": {
    "text": "Hello world",
    "language": "Spanish"
  }
}
```

### Chat Mode

**Endpoint**: `POST /services/chat/test?project_id={project_id}`

```typescript
interface ChatTestRequest {
  ag_config: {
    prompt: {
      messages: Message[]  // System message template
      template_format: 'fstring' | 'jinja2' | 'curly'
      llm_config: ModelConfig
    }
  }
  inputs: Record<string, string>
  messages: Message[]  // Chat history
}
```

---

## Response Format

```typescript
interface TestResponse {
  version: '3.0'
  data: string | object  // LLM output
  tree: {
    nodes: SpanNode[]
  }
  trace_id: string
  span_id: string
}

interface SpanNode {
  trace_id: string
  span_id: string
  metrics: {
    acc: {
      duration: { total: number }  // milliseconds
      costs: { total: number }     // USD
      tokens: { 
        total: number
        prompt?: number
        completion?: number 
      }
    }
  }
}
```

---

## Frontend State Schema

### Prompt Configuration

```typescript
interface StatelessPromptConfig {
  // Unique identifier for this session
  sessionId: string
  
  // Mode determines which service endpoint to use
  mode: 'completion' | 'chat'
  
  // Prompt template
  messages: EnhancedMessage[]
  
  // Model configuration
  llmConfig: ModelConfig
  
  // Template format
  templateFormat: 'fstring' | 'jinja2' | 'curly'
  
  // Derived variables from prompt template
  variables: string[]
}

interface EnhancedMessage {
  id: string
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

interface ModelConfig {
  model: string
  temperature?: number
  maxTokens?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  responseFormat?: ResponseFormat
  tools?: Tool[]
  toolChoice?: ToolChoice
}
```

### Test Case State (via Loadable Bridge)

```typescript
// Use loadable bridge in local mode
const LOADABLE_ID = 'stateless-playground-testcases'

// Columns derived from prompt variables
interface LoadableColumn {
  id: string        // Variable name
  name: string      // Display name
  type: 'text'      // All text for stateless
}

// Rows represent test cases
interface LoadableRow {
  id: string
  data: Record<string, string>  // Variable → value
}
```

### Execution State

```typescript
interface ExecutionState {
  // Per-row execution status
  status: Record<string, 'idle' | 'running' | 'success' | 'error'>
  
  // Per-row results
  results: Record<string, ExecutionResult>
}

interface ExecutionResult {
  output: string | object
  traceId: string
  spanId: string
  metrics: {
    latency: number      // ms
    tokens: number
    cost: number         // USD
  }
  error?: string
}
```

---

## Service URL Configuration

The completion service URL depends on deployment:

```typescript
function getCompletionServiceUrl(): string {
  // For local development
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:8000/services/completion'
  }
  
  // For cloud deployment
  const baseUrl = getAgentaApiUrl()
  return `${baseUrl}/services/completion`
}

function getChatServiceUrl(): string {
  // Similar pattern for chat
  return getCompletionServiceUrl().replace('/completion', '/chat')
}
```

---

## Variable Extraction

Extract template variables from prompt messages:

```typescript
function extractVariables(
  messages: Message[], 
  templateFormat: 'fstring' | 'jinja2' | 'curly'
): string[] {
  const regex = {
    fstring: /\{(\w+)\}/g,
    jinja2: /\{\{\s*(\w+)\s*\}\}/g,
    curly: /\{\{(\w+)\}\}/g
  }[templateFormat]
  
  const variables = new Set<string>()
  
  for (const message of messages) {
    const content = typeof message.content === 'string' 
      ? message.content 
      : message.content.map(p => p.text || '').join('')
    
    let match
    while ((match = regex.exec(content)) !== null) {
      variables.add(match[1])
    }
  }
  
  return Array.from(variables)
}
```

---

## Authentication

Requests to the completion service need:

```typescript
interface RequestHeaders {
  'Content-Type': 'application/json'
  'Authorization': `Bearer ${jwt}`
}

interface QueryParams {
  project_id: string
  // Note: application_id is optional for inline mode
}
```

The JWT is obtained from the existing auth context.

---

## Error Responses

```typescript
interface ErrorResponse {
  detail: string | {
    message: string
    code: string
    meta?: Record<string, unknown>
  }
}

// Common error scenarios:
// 401 - Invalid/expired JWT
// 403 - No access to project
// 422 - Invalid request payload
// 500 - LLM provider error
// 503 - Service unavailable
```

---

## Observability Considerations

Stateless playground runs do not have an associated app. Tracing will show:

- `trace_id`: unique per execution
- `span_id`: root span for the completion call
- `project_id`: included (traces are visible in project observability)
- `application_id`: omitted

Decision: omit `application_id` entirely. Traces are visible in project observability without app association. This avoids UUID validation failures in backend middleware.
