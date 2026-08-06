# Protocol

The agent workflow has two public HTTP surfaces and one internal runner surface.

| Surface | Status | Consumer | Purpose |
| --- | --- | --- | --- |
| `POST /invoke` | Implemented | Generic workflow clients | Batch workflow call. Returns one final response. |
| `POST /messages` | Implemented | Browser chat clients | Agent chat call. Accepts Vercel `UIMessage` input and can stream Vercel SSE. |
| `POST /run` | Implemented internal wire | Python SDK backend adapters | Runs one agent turn through the TypeScript runner sidecar or CLI. |

## `/invoke`

`/invoke` keeps the normal workflow contract. The agent handler reads messages from
`data.inputs.messages`, reads config from `data.parameters`, runs one cold turn, and returns:

```json
{
  "role": "assistant",
  "content": "..."
}
```

Usage is recorded on the workflow span. It is not added to the response body.

## `/messages`

`/messages` is registered only for agent routes. It adapts the browser chat contract to the
same runtime that `/invoke` uses.

Request:

```json
{
  "session_id": "sess_abc",
  "data": {
    "messages": [],
    "inputs": {},
    "parameters": {
      "agent": {
        "agents_md": "...",
        "model": "gpt-5.5",
        "harness": "pi_core",
        "sandbox": "local"
      }
    }
  }
}
```

Important details:

- `session_id` is optional. The server mints one when it is absent.
- Client-supplied ids must match `^[A-Za-z0-9._:-]{1,128}$`.
- The runtime is cold: the client sends the full conversation in `data.messages` on every
  turn. The server does not persist session history, so the id only tags the turn (for
  tracing) and is echoed back.
- `data.messages` is a Vercel `UIMessage[]`. The adapter folds it into neutral runtime
  `Message` objects before invoking the workflow.
- `data.stream` is not a stored config value. The route sets it from the `Accept` header.

Response modes:

| Accept | Result |
| --- | --- |
| `application/json` or absent | A normal `WorkflowBatchResponse` with the assistant output and `session_id`. |
| `text/event-stream` | A Vercel UI Message Stream framed as SSE. |

Pre-stream failures stay JSON even when the client asked for SSE. This matters because tool
resolution, config parsing, or auth can fail before the stream starts.

## Vercel Stream Parts

The runtime emits neutral `AgentEvent` objects. The Vercel adapter maps them to stream parts.

| Agent event | Vercel part |
| --- | --- |
| `message` | `text-start`, `text-delta`, `text-end` |
| `message_start`, `message_delta`, `message_end` | Matching text lifecycle parts |
| `thought` | `reasoning-start`, `reasoning-delta`, `reasoning-end` |
| `reasoning_start`, `reasoning_delta`, `reasoning_end` | Matching reasoning lifecycle parts |
| `tool_call` | `tool-input-start`, `tool-input-available` |
| `tool_result` | `tool-output-available`, `tool-output-error`, or `tool-output-denied` |
| `interaction_request` | `tool-approval-request` or a `data-*` interaction part |
| `data` | `data-<name>` |
| `file` | `file` |
| `usage` | `messageMetadata.usage` on `finish` |
| `error` | `error` |
| `done` | `finish-step`, then `finish` |

The first `start` part carries `messageMetadata.sessionId`. The SSE stream ends with
`data: [DONE]`.

## `/run`

`/run` is the internal Python-to-TypeScript boundary. The Python side serializes it in
`sdks/python/agenta/sdk/agents/utils/wire.py`. The TypeScript side mirrors it in
`services/agent/src/protocol.ts`.

The review lens for this boundary, including the full request and result shapes and what can
break when a field moves, is in the interface inventory's
[Service to agent runner](../interfaces/cross-service/service-to-agent-runner.md). This page
owns the field-by-field narrative.

The runner drives one engine, the sandbox-agent ACP path. The `harness` field selects the
agent, so there is no engine selector on the wire.

Request fields include:

| Field | Meaning |
| --- | --- |
| `harness` | Harness id, the bare string `pi_core`, `pi_agenta`, or `claude`. `pi_core` and `pi_agenta` both drive the `pi` ACP agent; `pi_agenta` is Pi with Agenta's forced skills, prompt, and policy. `claude` drives the `claude` ACP agent. The wire value is bare; the agent_config *interface* dresses each value with a versioned slug + display name (see [Agent config schema](../interfaces/public-edge/agent-config-schema.md)), but the wire and the runner selector are unchanged. |
| `sandbox` | Sandbox id, usually `local` or `daytona`. |
| `sessionId` | External conversation id. The runtime is cold and receives history in `messages`. |
| `agentsMd` | Instructions that become `AGENTS.md`. |
| `systemPrompt`, `appendSystemPrompt` | Pi prompt overrides. The sandbox-agent engine writes `SYSTEM.md` / `APPEND_SYSTEM.md` into the per-run Pi agent dir, local and Daytona. |
| `skills` | Resolved inline skill packages (full `SKILL.md` content, with `@ag.embed` references inlined server-side), declared in the agent config. All three harnesses wire them; the runner materializes each into a skill dir (`pi_core`/`pi_agenta` through Pi's agent-dir scope, Claude under project-local `.claude/skills`). Omitted when none are declared. |
| `model` | Requested model id. Not honored on the Pi ACP path; pi-acp accepts only its default model (see Ground Truth). |
| `messages` | Conversation history and current turn. |
| `secrets` | Provider env vars resolved by the service. |
| `tools`, `customTools`, `toolCallback`, `mcpServers` | Resolved tool delivery. |
| `permissions` | Permission plan: `{default?, rules?}`. `default` is one of `allow`, `ask`, `deny`, or `allow_reads`; missing, it falls back to `allow_reads`, and a malformed block fails toward `ask`. `rules` is an optional list of `{pattern, permission}` entries for harness builtins. The runner enforces it on every harness. |
| `trace` | Trace context for nested spans. |

One-shot calls return one JSON result. Streaming calls use NDJSON internally: one
`{"kind":"event"}` record per live event, followed by one `{"kind":"result"}` terminal
record. The browser never sees this NDJSON directly; `/messages` converts it to Vercel SSE.

This page covers the `/run` wire only. A separate internal channel, the relay directory the
runner shares with the sandbox (used for Daytona tool calls and, now, for Pi builtin
permission checks), recently gained a second record kind. See
[Tools](tools.md#built-in-tools-the-harness-runs-them-natively-gated-through-the-same-relay)
for the permission record shape.
