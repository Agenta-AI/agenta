# The Claude Code adapter

Claude Code is the second harness. It proves the central claim of this PoC: that swapping
the agent is one config value. Where the [Pi adapter](pi.md) does much of its work inside Pi
through an extension, Claude does its work through standard ACP. That makes Claude the
template for any MCP-capable harness sandbox-agent can drive.

Read the [architecture](../architecture.md) and [ports and adapters](../ports-and-adapters.md)
pages first.

## Running Claude

The daemon resolves the harness id `claude` to the `claude-agent-acp` adapter, which starts
the `claude` CLI. One operational detail is worth calling out, because it caused a real bug.
The daemon does not ship the `claude` CLI. It downloads it over HTTPS the first time a run
asks for Claude. The sidecar image is a slim Node image with no root certificates, so that
HTTPS download failed until we added `ca-certificates` to the image. With the certs in
place, the download verifies and Claude runs.

Auth is config, like everything else. Claude authenticates with `ANTHROPIC_API_KEY` from the
project vault when present, or with an OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`) otherwise. The
runner turns the common failures into one clear line, so a user sees "add the project's
Anthropic key" rather than a stack trace.

## Tools over MCP

Claude reports the `mcpTools` capability, so the runner delivers tools to Claude the standard
ACP way, over MCP. This is the branch that `buildSessionMcpServers`
(`engines/sandbox_agent/mcp.ts`) chooses: deliver over MCP when the harness reports `mcpTools`,
not when the harness name is something in particular. In practice the capability comes from the
static per-harness fallback (`engines/sandbox_agent/capabilities.ts`): the daemon rarely fills
a real `info.capabilities`, so the runner uses `mcpTools: true` for any non-Pi harness.

The mechanism is a small MCP server named `agenta-tools` (`tools/tool-mcp-http.ts`, built by
`tools/mcp-bridge.ts` `buildToolMcpServers`) that the runner serves on a loopback HTTP endpoint
and attaches to the session as an ACP `type: "http"` MCP server. This is an Agenta tool DELIVERY
vehicle, not a user-declared MCP server: it carries the same gateway and code specs the Pi
extension would register, just exposed over MCP because Claude cannot take a native tool. It runs
in the already-running runner process (no runner-host child) and is reachable only from loopback;
it holds only public metadata (names, descriptions, schemas) and a relay directory; the
`call_ref`, the code, the scoped secrets, and the callback auth never reach it. When the model
calls a tool, the server relays the request back to the runner over the file relay
(`tools/relay.ts`), and the runner runs the private spec from memory and POSTs to `/tools/call`.
The safety property is identical to Pi's: the provider key and the connection auth stay
server-side, and the agent only ever asks Agenta to run a named tool.

(This internal channel was disabled as collateral with the user-stdio-MCP disable in PR #4831 and
restored over loopback HTTP by the gateway-tool-mcp project. It is independent of the user MCP
capability below — the two toggle separately.)

User-declared `mcp_servers` are a separate thing and effectively off today. They would reach
Claude through `toAcpMcpServers` as additional ACP stdio servers, but only when
`AGENTA_AGENT_MCPS_ENABLED` is set (off by default), so in practice no user MCP server is
attached. See [tools.md](../tools.md#status-and-known-gaps).

## Permissions

Claude gates tool use behind its own permission prompt. There are two places a per-tool
permission lands, and both matter.

The first is static, written before the session starts: the claude adapter renders a
`.claude/settings.json` file (`sdks/python/agenta/sdk/agents/adapters/claude_settings.py`,
delivered on the `harnessFiles` wire seam) whose `permissions.allow` / `permissions.ask` /
`permissions.deny` lists Claude Code reads via `settingSources`. Each backend-resolved EXECUTABLE
tool (callback/code) gets a per-tool rule `mcp__agenta-tools__<name>`, because that is how Claude
addresses a tool of the internal `agenta-tools` MCP server above. A tool whose effective
permission is `allow` (an explicit `allow`, or a read-hinted tool under the `allow_reads`
policy) gets an allow rule, so Claude runs it without raising a gate; `deny` gets a deny
rule; `ask` or unset gets no allow rule, so the gate still fires.

The second is dynamic: a gate that does fire arrives at `session.onPermissionRequest`, where
the runner's `ApprovalResponder` (`services/runner/src/responder.ts`) answers it. The verdict
comes from the shared decision module (`services/runner/src/permission-plan.ts`): the tool's
explicit permission wins, then a matching authored rule, then the policy mode in
`permissions.default`. `allow` approves the call, `deny` refuses it, and `ask` pauses the
turn, emits one approval request, and waits for a human. Pi never raises this hook; on Pi
the tool relay enforces the same decision function.

Both layers are needed because Claude's gate fires BEFORE the runner relay that would
otherwise honor an `allow`. Without the settings.json rule, an `allow` resolved tool always
paused (finding F-046); the rule is what lets it run. The `ask`/unset path is left to the
gate on purpose, so human approval is preserved. Note that `permissions.default: "allow"` is
not a per-tool override: a tool set to `ask` or `deny` keeps its own verdict, because the
explicit per-tool permission always beats the policy mode.

## Tracing from the event stream

Claude does not self-instrument the way Pi does, because we do not load an Agenta extension
into Claude. So the runner builds the trace itself, from the ACP event stream. It subscribes
to the session's `session/update` notifications and turns them into the same span tree Pi
produces:

```
invoke_agent            (AGENT)
  turn 0                (CHAIN)
    chat <model>        (LLM)
    execute_tool <name> (TOOL)   one per ACP tool_call
```

This is the general path. Any harness sandbox-agent drives that does not bring its own
instrumentation gets traced this way. Pi is the exception that traces itself; Claude is the
rule.

## Usage and output

Claude reports usage in two places, so the runner reads both. The per-call input and output
token split rides on the ACP `PromptResponse`, and the cost rides on the `usage_update`
event. The runner combines them into the run total, which then rolls onto the workflow span
the same way Pi's writeback total does.

Output needs one small piece of care. Claude streams text deltas and also periodically
streams a full cumulative snapshot of the message so far. If the runner naively appended
everything, the answer would double. The runner detects a snapshot (a chunk that is a
superset of what it already has) and replaces rather than appends, so the final text is
correct whether a chunk is a delta or a snapshot.

## Models

Claude ignores a model id meant for another provider. Ask it for `gpt-5.5` and it keeps its
own default. The runner handles this honestly: when the harness does not accept the requested
model, the chat span is labelled `chat` rather than falsely claiming a model the run did not
use.

## What Claude demonstrates

Claude is the proof that the seam works. Adding it took a `ClaudeHarness` (which holds its
Pi-versus-Claude config mapping) and no change to the workflow handler above the ports; the
same `SandboxAgentBackend` drives it. It also exercises the capability-driven branches the design is
built on: tools over MCP because it reports `mcpTools`, a permission answer because it gates
tools, and event-stream tracing because it does not self-instrument. A future harness that
sandbox-agent can drive would reuse this exact path. A future harness that sandbox-agent cannot drive would
instead get its own backend beside `SandboxAgentBackend`, behind the same
`/run` contract.
