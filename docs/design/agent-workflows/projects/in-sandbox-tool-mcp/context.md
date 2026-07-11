# Context

## What the user sees today

A Claude Code run on Daytona that carries any custom tool fails immediately with
`REMOTE_TOOLS_UNSUPPORTED_MESSAGE` (`services/runner/src/engines/sandbox_agent/run-plan.ts:355`).
The same run works on the local sandbox, and the same tools work on Daytona with the Pi
harness. The refusal is deliberate (PR #5047 replaced an earlier silent zero-tools success),
but it leaves a hole in the product: the harness we want customers to use for serious agents
(Claude, soon Codex) cannot use platform tools in the sandbox environment we want to be the
default (Daytona, now fast thanks to warm reuse).

The cause is an advertisement gap, not an execution gap. Tool execution on Daytona is solved
and harness-agnostic: the runner polls a relay directory in the sandbox filesystem, executes
each request with runner-held credentials, and writes the response back. Pi works because its
bundled extension runs inside the sandbox and writes those request files. Claude takes tools
only over MCP, and the only MCP server we run today binds to the runner's own loopback, which
is unreachable from inside a remote sandbox. Nothing inside the sandbox speaks MCP for us.

## Settled decisions (owner, 2026-07-11)

These are decided. This workspace encodes them; it does not reopen them.

1. **The sandbox talks only to the runner.** An API-hosted tool gateway (a platform MCP
   endpoint the sandbox dials directly) was analyzed and rejected in
   [../mcp-delivery-architecture/gateway-mcp-location.md](../mcp-delivery-architecture/gateway-mcp-location.md).
   Warm sandboxes are the priority, and the committed model is: gateway-tool logic stays in
   the runner, credentials never enter the sandbox, and delivery to MCP-client harnesses goes
   through an in-sandbox front-end feeding the file relay.
2. **User-declared MCP servers: HTTP transport only, permanently.** We will never host or
   run arbitrary user stdio/npx MCP servers, on the runner host or in the sandbox. A user who
   wants a local MCP server runs it themselves and gives us the URL and host. This supersedes
   the L1 direction ("run user stdio MCP in the sandbox") in
   [../mcp-delivery-architecture/directions.md](../mcp-delivery-architecture/directions.md).
   Authentication for user HTTP MCP servers: an API key in a request header, which the
   existing mechanism already supports (named secrets become headers,
   `services/runner/src/engines/sandbox_agent/mcp.ts:119`). OAuth for user MCP servers is a
   later feature, named as future work and out of scope here.
3. **Platform tools (our own) are delivered by our own MCP server running inside the
   sandbox**, feeding the existing file relay. This project designs that server.
4. **The design goal that matters most is unification with Pi.** Today Pi gets tools through
   its bundled in-sandbox extension (`registerTool`, writing relay request files) and local
   Claude gets them through a runner-loopback HTTP MCP server. The owner wants one
   gateway-tool logic serving both, in closely shared code, so the relay protocol and the
   execution semantics cannot drift per harness.

## The three MCP layers, kept separable

The word "MCP" names three different things in this codebase
(established in [../gateway-tool-mcp/README.md](../gateway-tool-mcp/README.md); conflating
them caused the #4831 regression). This plan touches only the second.

| Layer | Declared by | Status | This project |
| --- | --- | --- | --- |
| User stdio/npx MCP servers | The user (`transport: "stdio"`) | Disabled, now permanently (decision 2) | Untouched. The mechanism that spawns our shim must not relax this gate. |
| Internal gateway-tool channel | Nobody; synthesized by the runner from the run's resolved tools | Local only (runner-loopback HTTP) | Extended into the sandbox. This is the whole project. |
| User HTTP MCP servers | The user (`transport: "http"` + URL) | Built, SSRF-guarded, behind `AGENTA_AGENT_MCPS_ENABLED` (default off) | Untouched. API-key-in-header auth is the current answer; OAuth is future work. |

## Goals

1. A Claude run on Daytona with gateway/callback tools succeeds, and the tools actually
   execute (the current refusal stops firing for that combination).
2. The delivery is harness-agnostic on the sandbox side: any MCP-client harness (Codex next)
   gets the same tools with no per-harness work beyond its ACP adapter.
3. One shared implementation of "turn a tool call into a relay request" serves the Pi
   extension, the local Claude channel, and the new in-sandbox server, pinned by a golden
   test on the relay request file bytes.
4. The lifecycle survives warm sandbox reuse (PR #5225): a parked-and-resumed sandbox, a
   stopped-and-restarted sandbox, and a tool-set change between turns must all behave
   correctly.
5. No security invariant weakens: public specs and the relay directory are the only things
   that enter the sandbox; no credential ever does; no new network surface opens.

## Non-goals

- Client tools (browser round-trip, `request_connection`) on Claude+Daytona in the first
  slice. Their pause semantics depend on the client-tool continuation work
  ([../agent-client-tool-cleanup/](../agent-client-tool-cleanup/),
  [../mcp-client-tool-continuation/](../mcp-client-tool-continuation/)). Gateway/callback
  tools land first; the plan states the sequencing.
- Changing the relay file protocol or its polling mechanics. The sibling project
  [../event-driven-tool-relay/](../event-driven-tool-relay/README.md) owns relay latency;
  this plan only keeps the shim compatible with it.
- Re-enabling user stdio MCP in any form (decision 2).
- OAuth for user HTTP MCP servers (future work).
- Any new remote sandbox provider. The fail-closed gate for non-Daytona remote providers
  stays until delivery is proven per provider.
- Changing how local Claude gets tools. The runner-loopback HTTP channel works and keeps its
  client-tool pause behavior; it stays.

## Neighboring projects

- [../claude-daytona-tools/](../claude-daytona-tools/README.md) and
  [../remote-tools-delivery/specs.md](../remote-tools-delivery/specs.md): the two prior
  designs this plan reconciles into one implementation path.
- [../mcp-delivery-architecture/](../mcp-delivery-architecture/README.md): the umbrella and
  the decision record.
- [../event-driven-tool-relay/](../event-driven-tool-relay/README.md): concurrent sibling.
  It replaces relay polling with filesystem-event wakeups. The shim is a second writer of
  the same relay files, so the two projects share the file contract; neither implements the
  other's scope.
- [../session-keepalive/](../session-keepalive/) and the warm-Daytona work (PR #5225): the
  reuse lifecycle this design must survive.
- [../agent-client-tool-cleanup/](../agent-client-tool-cleanup/): the park-and-resume
  redesign client tools depend on.
