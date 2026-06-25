# Runner To Harness

Once the runner has a `/run` request, it has to drive an actual coding agent. It does this
one of two ways: the legacy in-process Pi engine, or the `sandbox-agent` path that talks to
Pi or Claude over ACP (the Agent Client Protocol). The deployed service sends
`backend: sandbox-agent`, so the ACP path is the one that runs in production. This boundary
is where a neutral request becomes a harness-specific session, so it owns harness selection,
capability detection, and event mapping.

## The contract

**Harness selection.** The `harness` field picks the agent. `"agenta"` maps to the ACP
agent `"pi"` (Pi with Agenta's forced opinion), and other values map to their own ACP agent.
The `sandbox` field picks `local` or `daytona`.

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

- `services/agent/src/engines/sandbox_agent.ts`: the ACP driver.
- `services/agent/src/engines/sandbox_agent/run-plan.ts`: the resolved run plan.
- `services/agent/src/engines/sandbox_agent/capabilities.ts`: the capability probe.
- `services/agent/src/engines/sandbox_agent/permissions.ts`: permission wiring.
- `services/agent/src/engines/pi.ts`: the legacy in-process path.

## Watch for when changing

- **Harness selection and the `agenta` to `pi` remap.** New harnesses thread through here.
- **The capability probe.** It gates tool delivery, permissions, and streaming. A wrong flag
  silently changes behavior rather than erroring.
- **ACP event mapping.** A missed or mis-mapped update drops content from the stream.
- **Pi versus ACP divergence.** Pi takes tools natively and can self-instrument traces; the
  ACP path delivers tools over MCP and the runner builds the spans.
- **Daytona behavior.** The sandbox provider changes the working directory and the file
  relay host. Test both `local` and `daytona`.
