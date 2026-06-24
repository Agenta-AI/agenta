# The Pi adapter

Pi is the default harness. This page explains how we run it, how it gets its tools, and how
it traces itself. Pi is the richer of the two adapters because Pi has an extension API we
can use, so much of the work happens inside Pi rather than around it.

Read the [architecture](../architecture.md) and [ports and adapters](../ports-and-adapters.md)
pages first. This page assumes the relay and the wire contract.

## How Pi runs

Pi runs over ACP, through sandbox-agent (`engines/sandbox_agent.ts`). The harness value
`pi_core` (plain Pi) and `pi_agenta` (Pi with Agenta's forced opinion) both map to the `pi`
ACP agent. This is the one engine the runner has. The sandbox-agent daemon starts the
`pi-acp` adapter, which starts the `pi` CLI.

## The ACP path: pi-acp plus a bundled extension

On the ACP path, the daemon resolves the harness id `pi` to the `pi-acp` adapter. One detail
matters: `pi-acp` does not bundle Pi. It spawns the `pi` CLI from `PATH`, so the runner
points it at our pinned `pi` binary (`PI_ACP_PI_COMMAND`) and puts our `node_modules/.bin`
on the daemon's `PATH`.

The interesting part is what we load into Pi. We ship a single **Pi extension**
(`extensions/agenta.ts`, bundled to `dist/extensions/agenta.js`) and install it into Pi's
agent directory. Pi loads it on every run. This one extension does two jobs: it delivers our
tools the Pi-native way, and it traces the run. Both are driven entirely by environment
variables, so the extension stays inert when none are set and is safe to install globally.

## Tools, the Pi-native way

Pi 0.79.4 does not support MCP, and `pi-acp` does not forward MCP servers either. So we do not
deliver anything over MCP to Pi: the runner's tool-delivery fork
(`buildSessionMcpServers` in `engines/sandbox_agent/mcp.ts`) returns an empty MCP list for Pi,
and tools come through the extension instead. The extension reads the resolved tool specs from
`AGENTA_TOOL_PUBLIC_SPECS` (public metadata only: name, description, input schema) and
registers each one with Pi directly through `pi.registerTool`. Pi then sees them as native
tools and runs the loop. The private parts of each spec (the `call_ref`, the code, the scoped
secrets, the callback auth) never reach the extension; they stay in runner memory and the
extension relays every call back.

Each registered tool's body does one thing: it POSTs the call back to Agenta's `/tools/call`
with the tool's `callRef` (the callback-tool envelope). The model picks the tool and supplies the
arguments; Agenta runs the actual tool server-side. This is the key safety property: the
Composio key and the connection auth never enter the sandbox. The agent only ever asks
Agenta to run a named tool.

On Daytona the in-sandbox process cannot reach Agenta directly, so the extension writes each
tool request to a file (`AGENTA_TOOL_RELAY_DIR`) and the runner, which can reach Agenta,
relays it to `/tools/call` and writes the answer back. Same envelope, different delivery.

## System prompt: AGENTS.md, SYSTEM, and APPEND_SYSTEM

Pi builds its system prompt from three separate inputs, and they stack rather than compete:

- **`AGENTS.md`** is project context. Pi wraps it in a `<project_context>` block and appends
  it after the base prompt. It loads with no trust gate, and it is what `instructions` on the
  neutral `AgentConfig` becomes. This is the right home for project conventions, commands,
  and preferences.
- **`APPEND_SYSTEM`** adds to Pi's built-in base prompt without replacing it. Reach for this
  when you only want to add framing on top of Pi's default coding-assistant prompt.
- **`SYSTEM`** replaces the base prompt outright. Pi throws away its default
  "you are a coding assistant" persona, the tool list, and the built-in guidelines, and uses
  your text instead. Use it only when a workflow needs a fundamentally different agent.

The key fact: these are not either/or with `AGENTS.md`. Even when `SYSTEM` replaces the base
prompt, Pi still appends the `AGENTS.md` context after it. So `AGENTS.md` stays the project
layer, and `SYSTEM` / `APPEND_SYSTEM` only change Pi's base persona. For almost every agent,
`AGENTS.md` alone is enough; the other two are a deliberate opt-in.

### How to set them

`SYSTEM` and `APPEND_SYSTEM` are Pi-specific, so they ride the neutral config's per-harness
escape hatch, `AgentConfig.harness_options`. It is a bag keyed by harness name; each Harness
adapter reads only its own slice:

```python
AgentConfig(
    instructions="Project: a SQL analytics tool. Run `make lint` before finishing.",  # AGENTS.md
    harness_options={
        "pi_core": {
            "system": "You are a SQL expert. Only answer with queries.",  # replaces base prompt
            "append_system": "Always explain each query in one line.",     # adds to base prompt
        }
    },
)
```

`PiHarness` lifts the `pi_core` slice onto `PiAgentConfig.system` / `append_system`, which emit
`systemPrompt` / `appendSystemPrompt` on the `/run` wire. An empty or whitespace value is
dropped, so it never reaches the runner as a real override.

### Delivery status

The **ACP (sandbox-agent) path honors both**. The engine writes `SYSTEM.md` /
`APPEND_SYSTEM.md` into the per-run Pi agent dir, local and Daytona
(`services/agent/src/engines/sandbox_agent/pi-assets.ts`), and Pi loads them on the run.
Because each run gets its own agent dir, the override stays scoped to that run and never
leaks to a later run on the same sidecar. `AGENTS.md` still applies alongside, because Pi
loads context files regardless.

## Tracing: Pi instruments itself

Pi emits lifecycle events on an in-process event bus (`pi.on(...)`). The extension hooks
those events and turns them into OpenTelemetry spans, the same span tree completion and chat
already produce:

```
invoke_agent            (AGENT)
  turn N                (CHAIN)
    chat <model>        (LLM)    real token usage from the provider call
    execute_tool <name> (TOOL)   one per tool the turn ran
```

The runner passes the caller's `traceparent` to the extension as `AGENTA_TRACEPARENT`. The
extension starts `invoke_agent` as a child of that span, so the whole Pi run joins the same
trace as the `/invoke` request. Because Pi self-instruments with real provider data, its
spans carry true per-call token counts, not estimates.

This is why the sandbox-agent engine does not also build spans for Pi. It would double them. The
engine emits its own spans only for harnesses that do not self-instrument (see the
[Claude Code adapter](claude-code.md)).

## Usage writeback: the one extra hop

Pi reports no token usage over ACP. It only has the numbers in-process. And the Pi spans and
the workflow span ship to Agenta in separate batches, so Agenta cannot roll Pi's per-call
tokens up onto the workflow span on its own.

The fix is a small handoff. On `agent_end`, the extension writes the run's token and cost
totals to a file (`AGENTA_USAGE_OUT`). The runner reads that file after the prompt finishes
and returns the totals on the `/run` result. The Python service then stamps them on the live
workflow span. The result is that `_agent` shows the agent's real tokens and cost even
though the two traces shipped separately.

## Models and output

Pi exposes provider-prefixed model ids, like `openai-codex/gpt-5.5`. The runner normalizes a
requested id to Pi's own id: it tries the value as given, and on rejection it matches by the
part after the provider prefix. If nothing matches, Pi keeps its default and the run still
answers.

For output, Pi streams pure text deltas over ACP (`agent_message_chunk`). The runner
appends them in order to build the final answer.

## Daytona notes

Two things differ on Daytona. The sandbox-agent `-full` image ships the `pi-acp` adapter but not the
`pi` CLI, so the runner either installs `pi` into the sandbox at session time or runs from a
pre-baked snapshot that already has it (the snapshot path avoids a slow per-run install).
And auth comes from the provider key in the sandbox env when present, or from an uploaded
`auth.json` (the developer's OAuth login) when no key is set.
