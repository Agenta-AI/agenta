# Runner To Harness

Once the runner has a `/run` request, it has to drive an actual coding agent. It drives one
engine, the `sandbox-agent` path, which talks to Pi or Claude over ACP (the Agent Client
Protocol). The `harness` field selects the agent, so there is no engine selector on the wire.
This boundary is where a neutral request becomes a harness-specific session, so it owns
harness selection, capability detection, and event mapping.

## The contract

**Harness selection.** The `harness` field picks the agent. `"pi_core"` and `"pi_agenta"`
both map to the ACP agent `"pi"` (`pi_agenta` is Pi with Agenta's forced opinion); `"claude"`
maps to the ACP agent `"claude"`. The default harness is `pi_core`. The `sandbox` field picks
`local` or `daytona`.

**The run plan.** `run-plan.ts` turns the request into a `RunPlan`, the resolved shape the
engine actually runs. It holds the resolved turn text, the working directory and tool relay
directory, the materialized skill dirs, the secrets and the legacy provider key var, the
sandbox permission boundary, and the harness files. It also carries `credentialMode`, which
decides whether the runner clears inherited provider env before applying `secrets`.

**The capability probe.** `capabilities.ts` asks the sandbox what the harness supports and
returns `HarnessCapabilities`:

```jsonc
{ "textMessages": true, "images": false, "fileAttachments": false, "mcpTools": false,
  "toolCalls": false, "reasoning": false, "planMode": false, "permissions": false,
  "usage": false, "streamingDeltas": false, "sessionLifecycle": false }
```

The probe gates real behavior. Tools only go over MCP when `mcpTools` is true, for example.
If the probe fails, the runner falls back to a static capability policy.

**The ACP event stream.** The harness emits ACP updates that the runner maps to neutral
events:

| ACP update | Becomes |
|---|---|
| `agent_message_chunk` | assistant text (Pi sends pure deltas, Claude cumulative) |
| `agent_thought_chunk` | reasoning |
| `tool_call` | a tool call with id, title, and raw input |
| `tool_call_update` | tool completion or failure with output |
| `usage_update` | token and cost roll-up |
| permission request | a permission interaction (see [Permission responder](../in-service/permission-responder.md)) |

**Abort.** HTTP streaming passes an `AbortSignal` into the sandbox start; a client disconnect
tears the sandbox down in the `finally` path.

## Owned by

- `services/agent/src/engines/sandbox_agent.ts`: the ACP driver, the one engine.
- `services/agent/src/engines/sandbox_agent/run-plan.ts`: the resolved run plan and the
  harness-to-ACP-agent remap.
- `services/agent/src/engines/sandbox_agent/capabilities.ts`: the capability probe.
- `services/agent/src/engines/sandbox_agent/permissions.ts`: permission wiring.

## Watch for when changing

- **Harness selection and the `pi_core`/`pi_agenta` to `pi` remap.** New harnesses thread
  through here.
- **The capability probe.** It gates tool delivery, permissions, and streaming. A wrong flag
  silently changes behavior rather than erroring.
- **ACP event mapping.** A missed or mis-mapped update drops content from the stream.
- **Pi versus Claude divergence.** Both run over ACP, but Pi takes tools natively and
  self-instruments traces, while Claude takes tools over MCP and the runner builds the spans.
- **Daytona behavior.** The sandbox provider changes the working directory and the file
  relay host. Test both `local` and `daytona`.
