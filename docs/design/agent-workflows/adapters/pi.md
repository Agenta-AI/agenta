# The Pi adapter

Pi is the default harness. This page explains how we run it, how it gets its tools, and how
it traces itself. Pi is the richer of the two adapters because Pi has an extension API we
can use, so much of the work happens inside Pi rather than around it.

Read the [architecture](../architecture.md) and [ports and adapters](../ports-and-adapters.md)
pages first. This page assumes the relay and the wire contract.

## Two ways Pi runs

Pi runs through one of two engines, both behind the same port:

- **Over ACP, through rivet** (`engines/rivet.ts` with `harness: pi`). This is the main
  path and the one the rest of this page describes. The rivet daemon starts the `pi-acp`
  adapter, which starts the `pi` CLI.
- **In-process** (`engines/pi.ts`). This drives the Pi SDK directly inside the sidecar, with
  no daemon, no adapter, and no ACP. It is the simplest local path and a fallback. The last
  section covers it.

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

Pi 0.79.4 does not support MCP. So we do not deliver tools over MCP to Pi. Instead the
extension reads the resolved tool specs from `AGENTA_TOOL_SPECS` and registers each one with
Pi directly through `pi.registerTool`. Pi then sees them as native tools and runs the loop.

Each registered tool's body does one thing: it POSTs the call back to Agenta's `/tools/call`
with the tool's `callRef` (the WP-7 envelope). The model picks the tool and supplies the
arguments; Agenta runs the actual tool server-side. This is the key safety property: the
Composio key and the connection auth never enter the sandbox. The agent only ever asks
Agenta to run a named tool.

On Daytona the in-sandbox process cannot reach Agenta directly, so the extension writes each
tool request to a file (`AGENTA_TOOL_RELAY_DIR`) and the runner, which can reach Agenta,
relays it to `/tools/call` and writes the answer back. Same envelope, different delivery.

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

This is why the rivet engine does not also build spans for Pi. It would double them. The
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

Two things differ on Daytona. The rivet `-full` image ships the `pi-acp` adapter but not the
`pi` CLI, so the runner either installs `pi` into the sandbox at session time or runs from a
pre-baked snapshot that already has it (the snapshot path avoids a slow per-run install).
And auth comes from the provider key in the sandbox env when present, or from an uploaded
`auth.json` (the developer's OAuth login) when no key is set.

## The in-process engine

The legacy engine (`engines/pi.ts`) skips rivet entirely. It drives Pi's `createAgentSession`
directly, with everything in memory: AGENTS.md injected through the resource loader, the
session and settings managers in memory, and a throwaway working directory. It registers the
same WP-7 tools as Pi `customTools` (the same POST-back-to-`/tools/call` body) and traces
with the same extension logic, just wired in process rather than loaded from disk.

It returns the same `/run` result as the rivet path, which is the whole point of the port:
the workflow author cannot tell which engine ran. It exists for the simplest local case and
as a path that does not depend on the rivet daemon being present.
