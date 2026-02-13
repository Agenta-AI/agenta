# Context

## Problem Statement

Custom workflows in Agenta cannot be interacted with as chat applications in the playground. There's no way to have a multi-turn conversation with a custom workflow.

The current chat detection mechanism is a heuristic based on input shape (checking if `messages` property exists in the request body), not an explicit declaration. This makes it fragile and doesn't allow custom workflows to opt-in to chat behavior.

## Who Has This Problem

- Developers building custom workflows
- The Agenta team when building agents
- Anyone who wants multi-turn conversation capabilities with custom LLM workflows

## Goals

1. Enable custom workflows to declare themselves as chat applications
2. Define a clear, explicit interface for chat discovery
3. Follow OpenAPI conventions for extensibility
4. Maintain backward compatibility

## Non-Goals

1. Unifying chat and completion into a single service type (separate future work)
2. Cleaning up the existing chat/completion interface (only touch as needed)
3. Solving tool call evaluation (separate problem)
4. UI changes to allow chat as completion mode (independent work)

## Current State

### Application Types

| Type | Output Shape | Database Value |
|------|-------------|----------------|
| Chat | Message object (role, content) | `SERVICE:chat` |
| Completion | Arbitrary JSON | `SERVICE:completion` |
| Custom Workflow | Arbitrary JSON | `CUSTOM` |

### Chat Detection (Current)

The frontend uses two heuristics:

1. **New transformer** (`genericTransformer/index.ts`): Checks `properties?.messages !== undefined`
2. **Legacy parser** (`openapi_parser.ts`): Checks `x-parameter === "messages"`

Both look at input shape, not output shape or explicit declaration.

### WorkflowFlags (Current)

```python
class WorkflowFlags(BaseModel):
    is_custom: bool = False
    is_evaluator: bool = False
    is_human: bool = False
```

These flags are returned by `/inspect` and used throughout the system.
