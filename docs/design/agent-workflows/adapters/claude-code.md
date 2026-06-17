# The Claude Code adapter

Claude Code is the second harness. It proves the central claim of this PoC: that swapping
the agent is one config value. Where the [Pi adapter](pi.md) does much of its work inside Pi
through an extension, Claude does its work through standard ACP. That makes Claude the
template for any MCP-capable harness rivet can drive.

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

Claude advertises the `mcpTools` capability, so the runner delivers tools to Claude the
standard ACP way, over MCP. This is the branch that the [capability probe](../ports-and-adapters.md)
chooses: deliver over MCP when the harness reports `mcpTools`, not when the harness name is
something in particular.

The mechanism is a small stdio MCP server (`tools/mcp-server.ts`) that the daemon launches
and attaches to the session. Its tool bodies POST back to Agenta's `/tools/call` with the
same WP-7 envelope the Pi path uses. The resolved specs and the callback endpoint reach the
MCP server through its environment, so nothing tool-specific is written to a file the agent
can read. The safety property is identical to Pi's: the provider key and the connection auth
stay server-side, and the agent only ever asks Agenta to run a named tool.

## Permissions

Claude gates tool use behind a permission prompt. In an Agenta run there is no human at the
keyboard to answer it, so the runner answers for it. By default it auto-approves, because the
tools are backend-resolved and trusted. The per-run permission policy (or an env override)
can flip this to deny, which rejects tool use instead. This is handled on
`session.onPermissionRequest`, a hook Pi does not need because Pi does not gate tools this
way.

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

This is the general path. Any harness rivet drives that does not bring its own
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

Claude is the proof that the seam works. Adding it required no change above the port and no
new Python class. It also exercises the capability-driven branches the design is built on:
tools over MCP because it reports `mcpTools`, a permission answer because it gates tools, and
event-stream tracing because it does not self-instrument. A future harness that rivet can
drive would reuse this exact path. A future harness that rivet cannot drive would instead get
its own engine beside `engines/pi.ts` and `engines/rivet.ts`, behind the same `/run`
contract.
