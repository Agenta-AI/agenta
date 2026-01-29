# Research: Playground & Tools Support

## Objective

Understand how the playground should handle tools for completion/chat modes.

## Current Playground State

> TODO: Analyze current implementation

### Completion Mode
- How it currently works: ...
- Limitations: ...

### Chat Mode
- How it currently works: ...
- Limitations: ...

## Tools in OpenAI/Anthropic APIs

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
            "location": {"type": "string"}
          }
        }
      }
    }
  ]
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
        }
      }
    }
  ]
}
```

## Playground UX Questions

1. **Tool Definition UI**
   - How do users define tools?
   - JSON editor vs. form-based?
   - Import from OpenAPI spec?

2. **Tool Execution in Playground**
   - Who executes tools? User or Agenta?
   - Mock responses for testing?
   - Real execution with user's endpoints?

3. **Message Display**
   - How to show tool calls in chat?
   - How to show tool responses?
   - Error handling display?

4. **Iteration Loop**
   - Auto-continue after tool response?
   - Manual step-through?
   - Max iterations?

## UI Mockup Ideas

> TODO: Sketch UI concepts

### Tool Definition Panel
- ...

### Chat with Tools
- ...

### Tool Execution Results
- ...

## Technical Implementation

### Frontend Changes Needed
- ...

### Backend Changes Needed
- ...

### SDK Changes Needed
- ...

## Findings

_Document research findings here_

## Recommendations

_Summarize recommendations after research_
