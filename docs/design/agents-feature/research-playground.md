# Research: Tools Integration in Agenta Playground

## Executive Summary

This document researches how to add tools/function calling support to the Agenta playground UI. After exploring the codebase, I found that **significant tool support already exists** in the playground. The current implementation includes:

- A `PlaygroundTool` component for displaying/editing individual tools
- An "Add Tool" dropdown with built-in provider tools (OpenAI, Anthropic, Google)
- Support for inline custom tool definitions
- Tool call response rendering via `ToolCallView` component
- Data model support for tools in the `llmConfig.tools` array

The main gap is **external tool provider integration** (like Composio) that would enable OAuth-connected tools that execute automatically.

---

## 1. Current Playground Architecture

### Component Structure

```
web/oss/src/components/Playground/
├── Playground.tsx                    # Main entry point
├── Components/
│   ├── MainLayout/                   # Splitter layout (config + generation panels)
│   ├── PlaygroundHeader/             # Header with variant selector
│   ├── PlaygroundVariantConfig/      # Left panel - prompt configuration
│   ├── PlaygroundVariantConfigPrompt/
│   │   └── assets/
│   │       ├── MessagesRenderer.tsx  # Renders prompt messages
│   │       ├── ToolsRenderer.tsx     # Renders configured tools
│   │       └── ActionsOutputRenderer.tsx # "Add Tool" button/dropdown
│   ├── PlaygroundTool/               # Individual tool editor
│   │   ├── index.tsx                 # JSON editor for tool schema
│   │   └── assets/index.ts           # TOOL_SCHEMA, TOOL_PROVIDERS_META
│   ├── PlaygroundGenerations/        # Right panel - test runs/outputs
│   └── ToolCallView/                 # Displays tool call responses
├── state/
│   └── atoms/
│       └── promptMutations.ts        # addPromptToolMutationAtomFamily
└── hooks/
    └── useWebWorker/
        └── assets/playground.worker.ts # Executes test runs
```

### Key Files

| File | Purpose |
|------|---------|
| `PlaygroundTool/index.tsx` | JSON editor for tool definitions with provider icons |
| `ActionsOutputRenderer.tsx` | "Add Tool" dropdown with built-in tools |
| `tools.specs.json` | Built-in tool definitions for OpenAI/Anthropic/Google |
| `promptMutations.ts` | Jotai atoms for adding/deleting tools |
| `ToolCallView/index.tsx` | Renders tool call responses from LLM |

### Data Flow

```
1. User clicks "Add Tool" button
       ↓
2. ActionsOutputRenderer shows dropdown
       ↓
3. User selects built-in or custom tool
       ↓
4. addPromptToolMutationAtomFamily adds tool to prompts state
       ↓
5. ToolsRenderer displays tool via PlaygroundTool component
       ↓
6. On "Run", playground.worker.ts sends config to backend
       ↓
7. Backend passes tools to LLM
       ↓
8. Response may include tool_calls
       ↓
9. ToolCallView renders tool call details
```

---

## 2. Current Tool Data Model

### Tool Configuration Structure

Tools are stored in the variant's prompt configuration:

```typescript
interface AgentaConfigPrompt {
    messages: Message[]
    llmConfig: {
        model: string
        temperature?: number
        // ... other params
        tools?: Tool[]           // Array of tool definitions
        toolChoice?: "none" | "auto" | null
    }
    inputKeys: string[]
}
```

### Tool Object Shape

The current implementation supports **OpenAI-style tool format**:

```typescript
// Custom function tool
{
    type: "function",
    function: {
        name: "get_weather",
        description: "Get current temperature for a given location.",
        parameters: {
            type: "object",
            properties: {
                location: {
                    type: "string",
                    description: "City and country e.g. Bogota, Colombia"
                }
            },
            required: ["location"],
            additionalProperties: false
        }
    }
}

// Built-in provider tools (different shape per provider)
// OpenAI
{ type: "web_search_preview" }
{ type: "file_search", vector_store_ids: ["vs_..."], max_num_results: 10 }

// Anthropic
{ type: "bash_20250124", name: "bash" }
{ type: "web_search_20250305", name: "web_search" }

// Google
{ code_execution: {} }
{ googleSearch: {} }
```

### Enhanced Tool Object (Internal)

Internally, tools have metadata for UI rendering:

```typescript
{
    __id: string,           // UUID for React key
    __source: "inline" | "builtin",
    __provider: string,     // "openai" | "anthropic" | "google"
    __providerLabel: string,
    __tool: string,         // Tool code e.g., "web_search"
    __toolLabel: string,
    __metadata: string,     // Hash of metadata schema
    value: { ... }          // Actual tool payload
}
```

---

## 3. Built-in Tools Support

### Current Provider Tools

Located in `tools.specs.json`:

```json
{
    "openai": {
        "web_search": [{ "type": "web_search_preview" }],
        "file_search": [{ "type": "file_search", "vector_store_ids": ["vs_..."] }]
    },
    "anthropic": {
        "bash_scripting": [{ "type": "bash_20250124", "name": "bash" }],
        "web_search": [{ "type": "web_search_20250305", "name": "web_search" }]
    },
    "google": {
        "code_execution": [{ "code_execution": {} }],
        "web_search": [{ "googleSearch": {} }]
    }
}
```

### Provider Metadata

```typescript
// From PlaygroundTool/assets/index.ts
const TOOL_PROVIDERS_META = {
    openai: { label: "OpenAI", iconKey: "OpenAI" },
    anthropic: { label: "Anthropic", iconKey: "Anthropic" },
    google: { label: "Google Gemini", iconKey: "Google Gemini" }
}
```

---

## 4. Tool Calls in Responses

### Response Handling

The `ToolCallView` component handles displaying tool calls from LLM responses:

```typescript
// Expected response shape
{
    response: {
        data: {
            tool_calls: [
                {
                    id: "call_abc123",
                    function: {
                        name: "get_weather",
                        arguments: '{"location": "Boston"}'
                    }
                }
            ]
        }
    }
}
```

### Current Limitations

1. **No automatic tool execution** - Tool calls are displayed but not executed
2. **No tool result continuation** - User cannot send tool results back to continue conversation
3. **Single-turn only** - No multi-turn tool use loop support

---

## 5. UI Flow for Adding Tools (Today)

### Current Flow

1. User opens prompt configuration section
2. Clicks "Add Tool" button at bottom
3. Dropdown appears with:
   - Search box
   - "+ Create in-line" button (creates empty custom tool)
   - Provider sections (OpenAI, Anthropic, Google)
   - Individual tool options under each provider
4. Selecting a built-in tool adds it with pre-filled payload
5. Selecting "Create in-line" adds empty function template

### What's Missing for External Tools

For Composio-style integration, we'd need:

1. **Tool Browser Modal** - Richer UI to browse available tools by category
2. **Connection Status** - Show which tools require OAuth connection
3. **OAuth Flow Trigger** - Button to initiate OAuth popup/redirect
4. **Connected Tools Display** - Show tools that are ready to use
5. **Tool Execution Backend** - Backend to execute tools via provider API

---

## 6. Proposed UI Flow for External Tools

### User Journey

```
1. User clicks "Add Tool" in playground
       ↓
2. Opens Tool Browser Modal with tabs:
   - "My Tools" (custom JSON schemas)
   - "Browse" (Composio/external tools)
       ↓
3. Browse shows categories: Email, Calendar, CRM, etc.
       ↓
4. User clicks "Gmail"
       ↓
5. Shows Gmail tools: send_email, read_inbox, etc.
       ↓
6. Tool has "Connect" badge (not authenticated yet)
       ↓
7. User clicks "Connect" -> OAuth popup
       ↓
8. After OAuth, badge changes to checkmark
       ↓
9. User clicks "Add" to add tool to prompt config
       ↓
10. Tool appears in prompt with Gmail icon
```

### Modal Wireframe (Text)

```
+--------------------------------------------------+
|  Add Tools                                    [X] |
+--------------------------------------------------+
| [ My Tools ]  [ Browse Tools ]                    |
+--------------------------------------------------+
|  Search tools...                                  |
+--------------------------------------------------+
|  Categories          |  Gmail                     |
|  ------------------- |  ------------------------- |
|  > Email             |  [Gmail icon] send_email   |
|    Calendar          |    Send an email           |
|    CRM               |    [ ] Connected  [Add]    |
|    Productivity      |  ------------------------- |
|    Developer         |  [Gmail icon] read_inbox   |
|    Social            |    Read emails             |
|    Finance           |    [ ] Connected  [Add]    |
|    ...               |                            |
+--------------------------------------------------+
```

---

## 7. Technical Requirements

### Frontend Changes

| Component | Change Required |
|-----------|-----------------|
| `ActionsOutputRenderer.tsx` | Add "Browse Tools" option in dropdown |
| **New: `ToolBrowserModal/`** | Full modal for browsing external tools |
| **New: `ToolProviderCard/`** | Card component for external tool display |
| `PlaygroundTool/index.tsx` | Handle external tool metadata display |
| **New: `useToolConnections.ts`** | Hook for managing OAuth connections |

### Backend Changes

| Endpoint | Purpose |
|----------|---------|
| `GET /tools/providers` | List available tool providers |
| `GET /tools/providers/{id}/tools` | List tools for a provider |
| `POST /tools/connections/oauth/init` | Start OAuth flow |
| `POST /tools/connections/oauth/callback` | OAuth callback handler |
| `GET /tools/connections` | List user's connected tools |
| `POST /tools/execute` | Execute a tool call |

### State Management

New atoms needed:

```typescript
// External tool provider state
export const toolProvidersAtom = atomWithQuery(...)
export const toolConnectionsAtom = atomWithQuery(...)
export const pendingOAuthAtom = atom<string | null>(null)

// Tool execution state (for multi-turn)
export const pendingToolCallsAtom = atom<ToolCall[]>([])
export const toolResultsAtom = atom<Record<string, any>>({})
```

---

## 8. Integration Options

### Option A: Composio Integration

**Pros:**
- 100+ pre-built integrations
- OAuth handled by their platform
- Tool execution in their infrastructure

**Cons:**
- External dependency
- Vendor lock-in
- Cost per execution

**Integration Points:**
1. Frontend: Embed Composio's tool picker
2. Backend: Proxy tool execution to Composio API

### Option B: Build Our Own

**Pros:**
- Full control
- No vendor dependency
- Custom tool marketplace potential

**Cons:**
- Significant development effort
- OAuth complexity per provider
- Ongoing maintenance

### Option C: Hybrid Approach (Recommended)

1. Keep existing inline/custom tool support
2. Add Composio for quick external tool access
3. Allow custom tool providers via plugin system

---

## 9. Multi-turn Tool Use Loop

### Current State

Today, playground is single-turn:
```
User Input -> LLM -> Response (may include tool_calls) -> END
```

### Required for Full Tool Support

```
User Input -> LLM -> tool_calls
                        ↓
              Execute tools (Composio/backend)
                        ↓
              Tool results
                        ↓
              LLM (with tool results) -> Final response
                        ↓
              Possibly more tool calls...
```

### UI Considerations

- Show intermediate states (tool executing, waiting for result)
- Allow user to see/edit tool inputs before execution
- Display tool results in conversation thread
- Support cancellation of tool execution

---

## 10. Open Questions

### Product Questions

1. **Scope of V1**: Just tool configuration, or full execution too?
2. **Multi-turn support**: Essential or phase 2?
3. **Custom tool marketplace**: Build internal tool sharing?
4. **Pricing model**: Charge for tool executions?

### Technical Questions

1. **OAuth storage**: Where to store tokens securely?
2. **Execution isolation**: Sandboxing for tool execution?
3. **Rate limiting**: Per-user tool execution limits?
4. **Caching**: Cache tool results for identical inputs?

### UX Questions

1. **Tool in chat vs sidebar**: Where to show tool status/results?
2. **Connection management**: Separate settings page or inline?
3. **Error handling**: How to surface tool execution failures?

---

## 11. Immediate Next Steps

### Phase 1: External Tool Browser (UI Only)

1. Create `ToolBrowserModal` component
2. Add "Browse Tools" option to "Add Tool" dropdown
3. Mock tool provider/categories data
4. Design OAuth connection flow (without backend)

### Phase 2: Backend Integration

1. Implement tool provider API endpoints
2. Add OAuth flow for one provider (Gmail?)
3. Store connections securely
4. Basic tool execution endpoint

### Phase 3: Multi-turn Support

1. Tool execution loop in worker
2. Tool result display in UI
3. Conversation continuation
4. Error handling and retries

---

## Appendix A: OpenAI/Anthropic Tools Format Reference

### OpenAI Function Calling

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string", "description": "City name"}
          },
          "required": ["location"]
        }
      }
    }
  ],
  "tool_choice": "auto"
}
```

### OpenAI Tool Call Response

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_abc123",
        "type": "function",
        "function": {
          "name": "get_weather",
          "arguments": "{\"location\": \"Boston\"}"
        }
      }]
    }
  }]
}
```

### Anthropic Tool Use

```json
{
  "tools": [
    {
      "name": "get_weather",
      "description": "Get weather for a location",
      "input_schema": {
        "type": "object",
        "properties": {
          "location": {"type": "string"}
        },
        "required": ["location"]
      }
    }
  ]
}
```

### Anthropic Tool Call Response

```json
{
  "content": [
    {
      "type": "tool_use",
      "id": "toolu_01A09q90qw90lq917835lgs",
      "name": "get_weather",
      "input": {"location": "Boston"}
    }
  ],
  "stop_reason": "tool_use"
}
```

---

## Appendix B: Related Files

### Core Playground Files
- `web/oss/src/components/Playground/Playground.tsx`
- `web/oss/src/components/Playground/Components/MainLayout/index.tsx`
- `web/oss/src/components/Playground/state/types.ts`

### Tool-Related Files
- `web/oss/src/components/Playground/Components/PlaygroundTool/index.tsx`
- `web/oss/src/components/Playground/Components/PlaygroundTool/assets/index.ts`
- `web/oss/src/components/Playground/Components/PlaygroundVariantConfigPrompt/assets/ToolsRenderer.tsx`
- `web/oss/src/components/Playground/Components/PlaygroundVariantConfigPrompt/assets/ActionsOutputRenderer.tsx`
- `web/oss/src/components/Playground/Components/PlaygroundVariantConfigPrompt/assets/tools.specs.json`
- `web/oss/src/components/Playground/state/atoms/promptMutations.ts`
- `web/oss/src/components/Playground/Components/ToolCallView/index.tsx`

### Message/Response Types
- `web/oss/src/lib/shared/variant/transformer/types/message.d.ts`
- `web/oss/src/lib/shared/variant/transformer/types/variant.d.ts`

### Execution Flow
- `web/oss/src/components/Playground/hooks/useWebWorker/assets/playground.worker.ts`
- `web/oss/src/lib/shared/variant/transformer/transformToRequestBody.ts`
