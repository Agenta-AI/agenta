# RFC: Chat Interface for Custom Workflows

> This document is the original RFC as provided. See [plan.md](./plan.md) for implementation details.

## Goal

Enable custom workflows to work as chat. Do it cleanly by defining a clear interface.

## Who Has This Problem

Developers building custom workflows. This includes us when we build agents.

## Context: Today's State

### Application Types

| Type | Output Shape | Notes |
|------|-------------|-------|
| Chat | Message object | Has role, content, etc. |
| Completion | String (or JSON if tool call) | Inconsistent shape |
| Custom Workflow | Arbitrary JSON | Developer-defined |

The database stores these as app_type: SERVICE:chat, SERVICE:completion, or CUSTOM.

### Playground Interaction

| Type | UI Component | Behavior |
|------|-------------|----------|
| Chat | `<GenerationChat />` | Multi-message conversation. Single input row. Cannot load multiple test cases side-by-side. |
| Completion | `<GenerationCompletion />` | Single turn. Multiple input rows. Can load and compare test cases. |
| Custom Workflow | `<GenerationCompletion />` | Same as completion. |

The frontend switches UI based on chat detection (see below).

### Chat Detection

The frontend checks whether the OpenAPI spec's /run endpoint has a messages property in the request body. If yes, it treats the application as chat.

This is a heuristic based on input shape, not output shape.

### Evaluation

| Type | What Evaluators Receive |
|------|------------------------|
| Chat | Extracts .content from the message object. Tool calls are ignored. |
| Completion | Takes output at face value. |
| Custom Workflow | Takes output at face value. |

Built-in evaluators call validate_string_output() which extracts .content from dict outputs. SDK evaluators can compare dicts directly.

### Add to Test Set

| Type | What Gets Stored |
|------|-----------------|
| Chat | The raw output becomes the expected output. |
| Completion | The raw output becomes the expected output. |
| Custom Workflow | The raw output becomes the expected output. |

Test sets detect chat columns by checking if a column contains an array of objects with role and content fields.

## Current Limitations

1. Custom workflows cannot be interacted with as chat in the playground
2. Chat applications cannot have multiple conversation threads side-by-side in the playground
3. Chat applications cannot be treated as completion
4. Tool calls are ignored in chat evaluation

## Scope

### In Scope

- Defining what makes a chat application a chat application
- Defining how Agenta discovers that something can be interacted with as a chat application
- Defining how Agenta discovers how to call that chat application (the interface)
- Defining the behavior of different components (UI, evaluators, test sets) with chat applications versus other applications

### Out of Scope

- Unifying chat and completion into a single service type
- Cleaning up the chat/completion interface for its own sake
- Solving tool call evaluation (separate problem)

## Proposal

### 1. What Is a Chat Application?

A chat application has two properties:

1. The application returns one or multiple message object (for now, the chat completion message spec)
2. The application accepts message history as input (typically a messages parameter)

### 2. How Does Agenta Discover a Chat Application?

**Decision:** Vendor extension in OpenAPI via `/inspect` endpoint.

Add `x-agenta.flags` to the operation (or use the existing `flags` field in `WorkflowServiceRequest`):

```yaml
# For new workflow system, exposed via /inspect response:
{
  "flags": {
    "is_chat": true
  }
}
```

Agenta reads `flags.is_chat`. If true, Agenta treats the workflow as a chat application.

### 3. How Does Agenta Call a Chat Application?

Current conventions for chat/completion services:

| Field | Convention |
|-------|------------|
| Message history input | `messages` |
| Dynamic inputs ("global inputs") | Nested under `inputs` |
| Output | A message object (or array) at the root of the response |

### 4. How Do Components Behave With Chat vs Completion?

**Playground:** Chat applications use multi-message conversation UI; non-chat use simple I/O UI.

**Evaluation:** Evaluators read `flags.is_chat` and base behavior on it.

**Test Sets:** No change needed. Store raw, detect chat columns by shape.

## Next Steps

1. Add `is_chat` support to the SDK so workflows can declare `is_chat: true`
2. Update the frontend to read `flags.is_chat` and use it for chat detection
3. Update evaluation to read `flags.is_chat` and base behavior on it
