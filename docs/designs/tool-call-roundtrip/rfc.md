# RFC: Tool calls survive the trace to playground round trip

## Status

Open. Investigation done. Problem 3 implemented. Problems 1 and 2 still open.

## Summary

A chat conversation that uses tool calls should load into the playground and
run without error. Today it fails. When we replay such a conversation, OpenAI
rejects it with:

```
Invalid parameter: messages with role 'tool' must be a response to a
preceeding message with 'tool_calls'.
```

OpenAI requires a strict pairing. The assistant message must carry a
`tool_calls` array. Each following `tool` message must carry a `tool_call_id`
that points back to one of those calls. The round trip breaks that pairing in
two different places, and a third issue makes tool results hard to read. The
three problems are independent and can be fixed on their own.

## Background: the required shape

A valid tool exchange looks like this.

```json
{ "role": "assistant", "content": "", "tool_calls": [
    { "id": "call_abc", "type": "function",
      "function": { "name": "get_weather", "arguments": "{\"location\":\"berlin\"}" } } ] }
{ "role": "tool", "name": "get_weather", "tool_call_id": "call_abc", "content": "12" }
```

The `id` on the assistant call and the `tool_call_id` on the tool reply must
match. If either side is missing, the request is invalid.

## Problem 1: ingestion drops tool calls from LangChain openinference traces

### Symptom

A conversation traced from LangChain (via openinference) stores an assistant
message with no `tool_calls` and a tool message with no `tool_call_id`. The
assistant content is a plain sentence such as
`"Calling HTTP_Request with input: {...}"`. Replay fails.

### Root cause

The openinference LangChain instrumentation is lossy in its flattened output.
The `llm.input_messages` attributes carry only `role` and `content`. The full
structure, including `tool_calls`, `tool_call_id`, and the tool `name`, exists
only inside `input.value`, serialized in the LangChain constructor format
(`{"messages": [[{lc, type, id, kwargs}, ...]]}`).

Our adapter then makes the loss permanent. In
`api/oss/src/apis/fastapi/otlp/extractors/adapters/openinference_adapter.py`:

- `input.value` maps to `ag.data.inputs` (line 21).
- `llm.input_messages.*` maps to `ag.data.inputs.prompt.*`, role and content
  only (line 101, lines 212 to 232).
- For chat spans, because `ag.data.inputs.prompt.*` exists, the adapter deletes
  `ag.data.inputs` (lines 246 to 248).

That deletion throws away the only copy of the data that still held the tool
calls.

### Proposed fix

Teach the adapter to parse `input.value` when it holds the LangChain serialized
message format. Read the role from the `id` array (`AIMessage` to assistant,
`ToolMessage` to tool, and so on). Lift the fields the flattened messages lost:
`tool_calls`, `tool_call_id`, and `name`. Convert LangChain's tool-call shape
`{id, name, args, type: "tool_call"}` into the OpenAI shape
`{id, type: "function", function: {name, arguments}}`, with `args` serialized to
a JSON string. Merge by index onto the existing prompt so we keep the clean role
and content and only add the missing tool fields.

Open question: gate this strictly to LangChain spans (detect from metadata
`ls_integration: "langchain_chat_model"` or the `langchain_core` markers inside
`input.value`), or apply it to any openinference chat span whose `input.value`
carries richer message data than the flattened messages.

### Location

`api/oss/src/apis/fastapi/otlp/extractors/adapters/openinference_adapter.py`

Add a test fixture built from the real captured span (gpt-5.4-nano, n8n
HTTP_Request tool).

## Problem 2: playground load collapses multi-assistant turns

### Symptom

A correctly structured conversation, traced from our own SDK, still fails on
replay. The source span has the assistant `tool_calls` and the tool
`tool_call_id` set correctly. After loading into the playground, the assistant
that called the tool is gone, and the tool message is orphaned.

### Root cause

The turn-grouping logic builds one assistant message per user turn. It selects
the assistant as `assistantSource`, the last non-user, non-tool message in the
turn (`web/packages/agenta-playground/src/state/helpers/extractAndLoadChatMessages.ts`,
lines 293 to 298). It attaches `tool_calls` only from that source (lines 301,
346 to 348).

When a turn holds a tool-calling assistant, then a tool result, then a final
assistant summary, the logic picks the summary. The summary has no `tool_calls`.
The tool-calling assistant is dropped. The tool message keeps its
`tool_call_id` but now points to nothing. Replay fails.

The model assumes one assistant response per turn. It cannot represent the real
shape: assistant with tool calls, then tool result, then assistant reply.

### Proposed fix

Stop collapsing a turn to a single assistant message. Preserve every
assistant and tool message in order, keeping `tool_calls`, `tool_call_id`, and
`name` on each. The playground message model and session assignment need to
handle more than one assistant message per turn.

### Location

`web/packages/agenta-playground/src/state/helpers/extractAndLoadChatMessages.ts`

## Problem 3: beautified view renders tool results poorly

### Status: implemented

Fixed in `getMessagePartText` in `BeautifiedJsonView.tsx`. The view had since
been refactored into a part-based system (`getMessageContentParts`,
`getStructuredMessagePart`, `getMessagePartText`, `getMessageContentDisplay`),
but the gap remained: a plain object part such as `{message, endpoints}` matched
no branch and returned `null`, so it rendered empty. The fix adds a gated
fallback. When a part is an object with no part `type`, render the whole object
as formatted JSON instead of dropping it. Typed media parts (`image_url`,
`file`) still return `null` and are left to their own renderers, so they are not
dumped as JSON. A stringified tool result already parses through
`tryParseJsonString`, so it now renders structured too.

### Symptom

In the beautified JSON view, a tool message whose content is structured (an
array of objects, or a JSON string holding such an array) renders empty or as
raw JSON. Example content: `[{ "message": "n8n Tool Webhook", "endpoints": {...} }]`.

### Root cause

A plain object part such as `{message, endpoints}` matched no branch in
`getMessagePartText` and returned `null`, so the per-item loop produced nothing
and the bubble showed no useful text.

### Location

`web/oss/src/components/DrillInView/BeautifiedJsonView.tsx`

## Relationship between the problems

Problems 1 and 2 both break the assistant and tool pairing, so both cause the
same OpenAI replay error, but at different layers. Problem 1 is backend
ingestion. Problem 2 is frontend load. A conversation can hit either or both.
Problem 3 is display only and does not affect replay.

## Suggested order

1. Problem 3, display. Done.
2. Problem 2, frontend playground load. It blocks replay for cleanly traced
   conversations, including ones from our own SDK.
3. Problem 1, ingestion. It blocks replay for LangChain openinference traces.
