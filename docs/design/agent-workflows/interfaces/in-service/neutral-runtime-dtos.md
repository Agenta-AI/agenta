# Neutral Runtime DTOs

These are the vocabulary the Python runtime speaks. They are neutral on purpose: no Vercel
names, no harness names, no wire quirks. Adapters translate into and out of them at the
edges, so the rest of the runtime stays decoupled from any one protocol or harness. Change a
field here and you change the meaning everywhere at once, which is why these models earn
their own page.

The message representation is the most load-bearing of them, so it gets a full appendix at
the end.

How these DTOs sit in the SDK runtime layering, and which adapters translate at the edges, is
narrated in [Ports and adapters](../../documentation/ports-and-adapters.md#runtime-package).
This page owns the review lens: the field meanings and what to check when one moves.

## The types

All in `dtos.py`. The ones that carry the most weight:

- **`AgentConfig`**: the parsed editable config. `instructions`, `model`/`model_ref`,
  `tools`, `mcp_servers`, `skills`, `sandbox_permission`, and a `harness_options` bag keyed
  by harness name. Built by `from_params(...)`. The editable schema is
  [Agent config schema](../public-edge/agent-config-schema.md).
- **`RunSelection`**: `harness` (default `pi_core`), `sandbox` (default `local`),
  `permission_policy` (`auto` | `deny`). The `harness` value is the bare `HarnessType` string.
- **`HarnessType` and `HARNESS_IDENTITIES`**: the closed harness enum plus the single source for
  each harness's interface identity — a versioned slug (`agenta:harness:<value>:v0`, the repo's
  slug grammar) and a display name. The agent_config schema builds its harness `oneOf` from
  `HARNESS_IDENTITIES`; the stored/wire value stays the bare enum string, so only the interface
  gains the slug + name. See [Agent config schema](../public-edge/agent-config-schema.md).
- **`SessionConfig`**: everything one run needs, assembled by the handler: the agent config,
  secrets, resolved connection, permission policy, trace, session id, and the resolved tool
  and MCP inputs.
- **`Message` and `ContentBlock`**: the neutral conversation shape. See the appendix.
- **`AgentEvent`**: a `type` plus a free `data` dict. The streamed event vocabulary
  (`message`, `thought`, `tool_call`, `tool_result`, `usage`, `error`, `done`).
- **`AgentResult`**: the parsed run result (output, messages, events, usage, stop reason,
  capabilities, session id, model, trace id).
- **`HarnessCapabilities`**: the boolean feature flags a harness reports.
- **`TraceContext`**: the trace block sent to the runner.
- **`PiAgentConfig`, `ClaudeAgentConfig`, `AgentaAgentConfig`**: harness-specific configs
  that subclass a common base and each emit their own `/run` wire fields. They are the bridge
  from neutral config to harness behavior; see [Harness adapters](harness-adapters.md).

## Appendix: the message representation, all cases

A `Message` is `{role, content}`, where `content` is a plain string or a list of
`ContentBlock`. A bare string normalizes to one `text` block; a list of all-text blocks
collapses back to a string. The Python model is snake_case, the wire (`to_wire`) is
camelCase, and `from_raw` accepts either, so inbound coercion is forgiving.

```python
class Message:
    role: str
    content: str | list[ContentBlock]   # "" by default
```

A `ContentBlock` is one piece of a message, discriminated by `type`. It carries only the
fields its type uses, and `to_wire` emits just the ones that are set.

| `type` | Fields used | Meaning |
|---|---|---|
| `text` | `text` | a span of text (the only kind callers send today) |
| `image` | `data` (base64), `mime_type`, `uri` | an image for an image-capable harness |
| `resource` | `data`, `mime_type`, `uri` | a non-image attachment |
| `tool_call` | `tool_call_id`, `tool_name`, `input` | a resolved tool call, for structured continuation |
| `tool_result` | `tool_call_id`, `tool_name`, `output`, `is_error` | that call's result |

The wire shape of each (camelCase, only set fields emitted):

```jsonc
{ "type": "text", "text": "hello" }
{ "type": "image", "data": "<base64>", "mimeType": "image/png", "uri": "https://..." }
{ "type": "resource", "data": "<base64>", "mimeType": "application/pdf", "uri": "..." }
{ "type": "tool_call", "toolCallId": "call_1", "toolName": "search", "input": { "q": "..." } }
{ "type": "tool_result", "toolCallId": "call_1", "toolName": "search",
  "output": { "...": "..." }, "isError": false }
```

The `tool_call` and `tool_result` carriers exist so a cross-turn approval round trip replays
as a real tool call plus its result: the [`/messages`](../public-edge/agent-messages.md)
egress folds inbound Vercel tool and approval parts into these blocks, and the model resumes
from the result instead of re-asking. The Vercel side of that mapping is in
[Browser protocol adapter](browser-protocol-adapter.md). This neutral model mirrors
`ContentBlock` in `services/agent/src/protocol.ts`.

Note that this `Message` is the agent runtime's type, deliberately not re-exported as
`agenta.Message`. A different `Message` (the prompt-template one) lives in
`agenta.sdk.utils.types`; the two never appear in the same call.

## Owned by

- `sdks/python/agenta/sdk/agents/dtos.py`

## Watch for when changing

- **Message content shape.** `ContentBlock` is how tool calls, results, images, and approvals
  travel through the runtime. The `from_raw`/`to_wire` pair coerces and camelCases; keep both
  in step with the TypeScript mirror.
- **Event names and data.** The browser adapter maps these to strict Vercel parts. A rename
  ripples outward.
- **Capability names.** They gate behavior across the runner and the form.
- **Harness-specific config fields.** Each subclass owns a slice of the `/run` wire. Adding a
  field here usually means adding a wire field and a golden fixture.
