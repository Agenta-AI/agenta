# Research

Verified against the working tree on 2026-06-25. Paths are repo-relative. The relevant runner
code lives under `services/agent/src/`.

## 1. How Claude got gateway/callback tools BEFORE #4831

Two delivery paths existed, branching on harness:

- **Pi** — native, via the bundled extension. `extensions/agenta.ts` `registerTools` reads
  `AGENTA_TOOL_PUBLIC_SPECS` (public metadata only) + `AGENTA_TOOL_RELAY_DIR`, calls
  `pi.registerTool(...)` for each, and each tool's `execute` relays back to the runner via
  `tools/dispatch.ts` `runResolvedTool`. **No MCP involved.** This path is untouched by #4831.

- **Claude (and any non-Pi, MCP-only harness)** — an internal stdio MCP bridge. The chain:
  1. `engines/sandbox_agent.ts` (~L284) calls `buildSessionMcpServers(...)`.
  2. `engines/sandbox_agent/mcp.ts` `buildSessionMcpServers` (for a non-Pi harness with
     `capabilities.mcpTools`) returned
     `[...buildToolMcpServers(toolSpecs, toolCallback, relayDir), ...toAcpMcpServers(userMcpServers)]`.
     The **first** term is the internal gateway-tool channel; the **second** is the user's MCP
     servers. They were already two distinct terms — the layering existed; #4831 collapsed both.
  3. `tools/mcp-bridge.ts` `buildToolMcpServers` (before #4831) returned ONE ACP
     `McpServerStdio` entry: `{ name: "agenta-tools", command: <tsx>, args: [mcp-server.ts],
     env: [AGENTA_TOOL_PUBLIC_SPECS, AGENTA_TOOL_RELAY_DIR] }`. The env carried **only public
     specs + the relay dir** — never scoped env, code, callback auth, or callback endpoints.
  4. `tools/mcp-server.ts` (before #4831) was a dependency-free JSON-RPC-over-stdio MCP server.
     The daemon launched it as a session MCP server. It served `initialize` / `tools/list`
     (advertising the public specs, filtering out `client` tools) / `tools/call`. On a call it
     invoked `runResolvedTool(spec, args, { toolCallId, relayDir })`, which writes a relay
     request file the runner watches.
  5. The runner-side relay loop (`tools/relay.ts` `startToolRelay`) reads the request, executes
     the **private** resolved spec in memory (`executeRelayedTool` → `callAgentaTool` →
     `/tools/call`), and writes the response file. This is where the Composio key / connection
     auth / callback bearer are applied — **server-side, in runner memory.**

**Key property:** even in the OLD stdio design, the bridge child process was a dumb protocol
translator. It held only public metadata and a relay-dir path. Every credentialed action
happened back on the runner via the relay. The sandbox/harness never saw a secret. This is why
the user calls the internal channel secure regardless of where the bridge process runs.

### Where the gateway secret actually lives (server-side, a layer above)

`tools/callback.ts` `callAgentaTool` POSTs the OpenAI-style envelope to Agenta's `/tools/call`
with the `toolCallback.authorization` bearer. The Composio key and connection auth resolve on
the **platform** side of `/tools/call`. The runner never holds the Composio key; the
harness/sandbox never holds even the callback bearer. The whole point of `callRef` + the
callback is that the credential stays server-side (see `tools/dispatch.ts` header comment:
"POST back through Agenta's /tools/call so the Composio key and connection auth stay
server-side").

## 2. EXACTLY what #4831 disabled

PR #4831 (feat commit `b0ad4ed500`) made the MCP delivery throw a single named constant for
EVERYTHING. The current working-tree state:

- `tools/mcp-bridge.ts` — `buildToolMcpServers` now: returns `[]` for an empty/all-`client`
  spec list, otherwise **throws `MCP_UNSUPPORTED_MESSAGE`** ("MCP servers are not supported by
  the sidecar."). The launcher, the env construction, and the `agenta-tools` server entry were
  all deleted. The `mcp-server.ts` stdio implementation is gone.
- `tools/mcp-server.ts` — reduced to a refusing stub: it writes `MCP_UNSUPPORTED_MESSAGE` to
  stderr and `process.exit(1)`.
- `engines/sandbox_agent/mcp.ts` — `toAcpMcpServers` (the **user** MCP path) throws
  `MCP_UNSUPPORTED_MESSAGE` for any real stdio server (`command` present); it delivers HTTP
  servers (added by #4834) and skips command-less/url-less entries.
- `engines/sandbox_agent/run-plan.ts` — `buildRunPlan` rejects up front any run whose
  `request.mcpServers` contains a stdio server with a `command` (`hasStdioMcpServer` →
  `MCP_UNSUPPORTED_MESSAGE`). This is the user-facing gate and is correct.

So #4831 conflated two things into `buildToolMcpServers` throwing:

- **Correct:** user stdio MCP delivery (`toAcpMcpServers` stdio branch + `run-plan.ts`
  `hasStdioMcpServer`) — keep.
- **Collateral:** the internal gateway-tool channel (`buildToolMcpServers`) — wrongly disabled.

Note `buildSessionMcpServers` still calls `buildToolMcpServers(toolSpecs, ...)` first, so any
non-Pi run carrying gateway `toolSpecs` hits the throw.

## 3. The fail-loud interaction (why it is a HARD failure today, not a silent drop)

`engines/sandbox_agent/capabilities.ts` `assertRequiredCapabilities` (added by commit
`5170e577de`) runs in the engine BEFORE `buildSessionMcpServers`. For a non-Pi harness with
tool specs it checks the probed `mcpTools` + `toolCalls` flags. Claude probes **`mcpTools:true`,
`toolCalls:true`**, so the capability gate **passes** — the runner believes Claude can receive
tools. Then `buildSessionMcpServers` → `buildToolMcpServers` **throws**. The engine catch turns
the throw into `{ ok: false, error: "MCP servers are not supported by the sidecar." }`.

Result: a Claude run with gateway tools fails the whole run. This is the visible regression and
also an internal contradiction — the capability gate asserts the channel exists, then the
delivery says it does not. The QA matrix corroborates the historical expectation that gateway
tools worked on Claude (`docs/design/agent-workflows/feature-matrix-test.md`,
`project_agent_workflows_qa` memory: "gateway PASS (github via pi-agents project)").

## 4. What #4834 (HTTP MCP) gives us to reuse

PR #4834 (`http-mcp-transport/`) enabled user-declared `transport: "http"` MCP delivery in
`engines/sandbox_agent/mcp.ts`:

- `McpServerHttp` interface: `{ type: "http"; name; url; headers: Array<{name, value}> }`,
  mirroring the ACP `McpServer` `type: "http"` variant.
- `toAcpMcpServers` builds that entry for an http server and maps each resolved `env` entry to
  an HTTP header. **No runner-host process launches** — the harness opens the connection and
  the secret rides in a header.
- The research notes (verified there) that **Claude Code supports `type: "http"|"sse"` MCP
  with a `headers` map natively**, and the bundled `@zed-industries/claude-agent-acp` documents
  custom-header injection. So Claude can consume an HTTP MCP server today.

This is the proven, safe transport. The recommended fix delivers the internal gateway-tool
channel over the SAME HTTP transport (an internal MCP endpoint the runner serves on loopback),
so we never re-introduce a stdio child and we reuse a path already exercised by #4834.

## 5. Call sites and seams (where a fix lands)

- `engines/sandbox_agent/mcp.ts` — `buildSessionMcpServers` is the one composition point. It
  already separates the internal channel (`buildToolMcpServers`) from the user channel
  (`toAcpMcpServers`). The fix re-populates the internal term without touching the user term.
- `engines/sandbox_agent.ts` (~L284-299) — passes `toolSpecs`, `toolCallback`, `relayDir`,
  `capabilities` into `buildSessionMcpServers`, then hands `mcpServers` to
  `sandbox.createSession({ sessionInit: { cwd, mcpServers } })`. The relay loop
  (`startToolRelay`) is already started when `plan.useToolRelay` is true (it is, whenever there
  are executable tool specs). So the runner-side execution half is already in place and
  untouched; only the **delivery** half (advertising the tools to Claude) needs restoring.
- `tools/dispatch.ts` `runResolvedTool` + `tools/relay.ts` `startToolRelay` /
  `executeRelayedTool` — the execution + server-side credential path. Unchanged; reused.
- `tools/public-spec.ts` `publicToolSpecs` / `executableToolSpecs` — produce the
  metadata-only advertisement. Reused (this is the "no secrets cross the boundary" guarantee).
- Tests: `tests/unit/mcp-servers.test.ts`, `tests/unit/tool-bridge.test.ts`,
  `tests/unit/sandbox-agent-orchestration.test.ts` were rewritten by #4831 to assert the throw;
  they are where the restored behavior is re-asserted.

## 6. Constraint: the wire contract is mirrored

`protocol.ts` is the `/run` wire source, hand-mirrored in
`sdks/python/agenta/sdk/agents/utils/wire.py` and pinned by golden fixtures (see
`services/agent/CLAUDE.md`). The internal gateway-tool channel is **synthesized by the runner
from `customTools`** — it is not a new wire field. So the recommended fix needs **no
`protocol.ts` / `wire.py` / golden change** (a strong reason to prefer it). `customTools` and
`toolCallback` already ride the wire. This mirrors #4834's "no-SDK-change" outcome.
