# Research

Verified against the working tree on 2026-07-11 (`gitbutler/workspace`, runner at
`services/runner/`). Every claim carries a file and line anchor. The full option analysis
lives in [../claude-daytona-tools/](../claude-daytona-tools/README.md) and
[../remote-tools-delivery/specs.md](../remote-tools-delivery/specs.md); this file records
the current state, what changed since those were written, and the PR #4873 autopsy.

## The refusal today

`buildRunPlan` refuses any run where the harness is not Pi, the sandbox is remote, and the
run carries any custom tool (`run-plan.ts:355`), with `REMOTE_TOOLS_UNSUPPORTED_MESSAGE`
(`run-plan.ts:64`). The gate keys on "not local" rather than "is Daytona" so a future remote
provider fails closed too (`run-plan.ts:281`). It counts client tools as well as executable
ones (`run-plan.ts:351-354`). Downstream, `buildSessionMcpServers` skips the internal channel
on Daytona and logs that run-plan should have refused the run (`engines/sandbox_agent/mcp.ts:245-264`).

## One execution path, two front-ends

Execution is solved and shared. `startToolRelay` (`tools/relay.ts:324`) polls the relay
directory through a pluggable host: local filesystem (`relay.ts:182`) or the Daytona daemon
FS API (`sandboxRelayHost`, `relay.ts:197`). Each request is executed against the private
spec in runner memory (`executeRelayedTool`, `relay.ts:226`): client tools pause through the
shared client-tool relay and write no response file (`relay.ts:249-252`), everything else is
re-checked by the runner-side permission guard (`RelayExecutionGuard`, `relay.ts:105`,
wired by the engine at `engines/sandbox_agent.ts:1762`) and then dispatched. The file
contract: request `{toolName, toolCallId, args}` written by `relayToolCall`
(`tools/dispatch.ts:78-82`), response `{ok, text?, error?}` (`relay.ts:90-96`), suffixes
`.req.json`/`.res.json` (`relay.ts:51-52`), writer deletes both files after reading the
response (`dispatch.ts:92-100`).

Front-end 1, Pi (works everywhere): the bundled extension (`extensions/agenta.ts:280`
`registerTools`) reads `AGENTA_AGENT_TOOLS_PUBLIC_SPECS` and `AGENTA_AGENT_TOOLS_RELAY_DIR`
from env (set by `buildPiExtensionEnv`, `engines/sandbox_agent/pi-assets.ts:71-72`) and
registers each public spec as a Pi tool whose `execute` calls
`runResolvedTool(spec, params, {toolCallId, relayDir, signal})` (`extensions/agenta.ts:341`).
With `relayDir` set, `runResolvedTool` routes to `relayToolCall` (`dispatch.ts:149-158`),
the shared relay writer. The extension is esbuild-bundled (`pi-assets.ts:25`,
`EXTENSION_BUNDLE`) and uploaded per run (`uploadPiExtensionToSandbox`, `pi-assets.ts:178`).

Front-end 2, Claude local only: `startInternalToolMcpServer` (`tools/tool-mcp-http.ts:271`)
is a dependency-free JSON-RPC-over-HTTP MCP server (only `node:http`/`node:crypto`), bound
to `127.0.0.1` (`tool-mcp-http.ts:50`) on an OS-assigned port (`:399`). `tools/list` serves
every public spec including client tools (`:126-149`, reading schemas through the shared
`specInputSchema` accessor that handles both `inputSchema` and `input_schema`); `tools/call`
routes non-client tools to the same `runResolvedTool` relay write (`:210-213`) and pauses a
client tool by aborting the in-flight HTTP request with no body (the `MCP_PAUSED` sentinel,
`:62`, `:190-192`). `buildToolMcpServers` (`tools/mcp-bridge.ts:97`) wraps it in a
`type: "http"` ACP entry named `agenta-tools` (`mcp-bridge.ts:119-127`). On Daytona that URL
would be the sandbox's own loopback, so the channel is skipped
(`engines/sandbox_agent/mcp.ts:245-251`).

The missing piece is exactly one thing: an in-sandbox process that speaks MCP and writes
relay request files. Pi has one; MCP-client harnesses have none.

## Contracts the design must not break

- **Server name `agenta-tools`.** The Python Claude adapter renders per-tool permission
  rules as `mcp__agenta-tools__<tool>` into `.claude/settings.json`
  (`sdks/python/agenta/sdk/agents/adapters/claude_settings.py:60`, `:175`). The in-sandbox
  server must keep the name or every rendered allow/deny rule silently stops matching.
- **The relay request record.** Both front-ends must emit the same
  `{"toolName":...,"toolCallId":...,"args":...}` record so one relay loop serves both.
  Today there is exactly one writer implementation (`relayToolCall`, `dispatch.ts:62`); the
  design keeps it that way by consuming the relay client PR #5232 extracts. The reader uses
  `JSON.parse` (`relay.ts:342`), so property order and whitespace are not protocol
  semantics; the contract tests pin the record shape, not bytes.
- **The public-spec env contract.** `AGENTA_AGENT_TOOLS_PUBLIC_SPECS` (a JSON array of
  `AdvertisedToolSpec`: name, description, inputSchema, kind, render, timeoutMs,
  `tools/public-spec.ts:12-19`) and `AGENTA_AGENT_TOOLS_RELAY_DIR`. One contract, one pair
  of names.
- **No wire change.** `/run` (`protocol.ts`) and its Python mirror stay untouched; the shim
  is runner-internal delivery.

## Warm sandbox reuse (PR #5225) and what it means for a shim

Facts, verified:

- After a clean turn a Daytona sandbox parks instead of being deleted: `pauseSandbox` at
  `engines/sandbox_agent.ts:838-843`; only a failed park falls through to delete (`:851`).
  Park-to-running keeps every process alive; park-to-stopped stops the VM, which kills every
  process, and the next turn restarts the same instance.
- The keep-alive config fingerprint includes `customTools` and `mcpServers`
  (`engines/sandbox_agent/session-pool.ts:154`, `:170-171`). A live session continues only
  when the tool set is unchanged; a changed tool set forces a cold session build, possibly
  inside the same reused sandbox.
- The relay directory is deliberately kept OFF the durable cwd: an ephemeral base
  (`/home/sandbox/agenta/relay` on Daytona, `$TMPDIR/agenta/relay` locally) keyed by
  `basename(cwd)` (`run-plan.ts:384-391`), so relay I/O never rides the geesefs mount (a
  flaky mount surfaces as ENOTCONN on relay files; the comment there says exactly this).
  Because the key comes from the durable cwd's basename, the path is stable across turns of
  one conversation.
- The internal MCP server's specs are fixed at session creation
  (`sessionInit.mcpServers`, `engines/sandbox_agent.ts:1275`); the engine closes it in
  `destroy` (`:826`).

Implications: a long-lived runner-started shim process (the A1 shape) must be found and
killed or replaced on cold rebuild in a reused sandbox (stale specs on a fixed port), must be
restarted after park-to-stopped, and must be health-checked on park-to-running resume. A
harness-spawned shim (the A2 shape) inherits the session lifecycle instead: the harness
spawns it with the session's env at session creation and normally dies with the session.
Two caveats bound that claim. First, the restart path after park-to-stopped can seed
persisted `sessionInit.mcpServers` and call `resumeSession()` / `session/load`
(`engines/sandbox_agent.ts:1267`) instead of creating a fresh session; whether the Claude
ACP adapter respawns dead MCP subprocesses there is adapter behavior the plan's slice 0
spike must prove. Second, the runner itself warns that an ACP subprocess can reparent to
PID 1 without graceful session cancellation (`engines/sandbox_agent.ts:827`), so
exit-on-stdin-close is an expectation, not a guarantee. With those caveats, this lifecycle
fact still flips the transport recommendation (see [plan.md](plan.md)).

One pre-existing residue risk, shared with Pi, stated precisely: workspace preparation
already clears the relay dir on Daytona before each environment build (`rm -rf` at
`workspace.ts:60-66`, with a comment giving exactly this rationale), so a cold build cannot
replay a crashed turn's orphaned `.req.json`. The residual window is the warm-continued
turn: a checked-out keep-alive session skips `prepareWorkspace`, and each turn starts a
fresh relay loop with a fresh per-turn seen-set (`relay.ts:334`), so an orphan from a
crashed turn inside one live environment can still be re-executed on the next turn. This is
not new with the shim. The [../event-driven-tool-relay/](../event-driven-tool-relay/README.md)
sibling owns relay mechanics, but its current plan explicitly does not change this property;
the ownership question is recorded in
[../mcp-delivery-architecture/orchestration.md](../mcp-delivery-architecture/orchestration.md).

## Daemon and ACP facts the transport choice depends on

- The daemon forwards `sessionInit.mcpServers` verbatim into the in-sandbox `newSession`;
  the Claude ACP adapter (`@zed-industries/claude-agent-acp`) maps a typeless
  `{name, command, args, env}` entry to a Claude SDK `{type: "stdio", ...}` MCP server and
  the Claude Agent SDK launches it inside the sandbox over newline-delimited JSON-RPC.
  Verified by PR #4873 against the then-bundled adapter; must be re-verified against the
  current pin during implementation.
- pi-acp accepts `mcpServers` in session init but drops it: Pi has no MCP client by design.
  Its extension `registerTool` is the bridge. Any "Pi consumes the MCP server directly" idea
  therefore requires new client code inside the Pi extension, not configuration.
- The only host-to-sandbox primitives are the daemon FS API and `runProcess`
  (`relay.ts:197-220`, `daytona.ts:50-75`). There is no runner-to-sandbox port forward and
  no sandbox-to-runner network path. The file relay is the only back-channel, and it works
  with sandbox networking fully disabled.
- The Daytona snapshot ships node (the Claude CLI is node,
  `services/runner/sandbox-images/daytona/build_snapshot.py:96`), so a node shim needs no
  new runtime. The snapshot build script is where a bake would go (same pattern as the
  pinned `pi` install, `build_snapshot.py:94`).

## PR #4873 autopsy: what it built, what to reuse, why it went stale

PR #4873 ("deliver Claude gateway tools on Daytona via an in-sandbox stdio MCP relay shim",
opened 2026-06-26, closed unmerged 2026-07-05) implemented the stdio variant end to end:

- `src/tools/relay-mcp-stdio.ts`: a 229-line stdio MCP server. Newline-delimited JSON-RPC
  loop, `initialize`/`tools/list`/`tools/call` handler mirroring `tool-mcp-http.ts`,
  `tools/call` writing through the relay client, stderr-only logging, fail-loud exit when
  the relay dir env is missing, concurrent in-flight calls with atomic line writes.
- `src/tools/relay-client.ts`: `relayToolCall` factored out of `dispatch.ts` so the bundle
  carries only file-relay code, no callback executor. Bundle: 5.3 kB, zero network calls.
- `src/engines/sandbox_agent/relay-shim.ts`: bundle path resolution
  (`SANDBOX_AGENT_RELAY_MCP_BUNDLE` override) plus a fail-loud upload helper that throws a
  named error when the bundle is missing or the upload fails.
- `mcp.ts`: the Daytona non-Pi branch builds an ACP `McpServerStdio` entry instead of
  skipping; `sandbox_agent.ts` uploads the shim on that path; the esbuild script bundles the
  shim next to the Pi extension.
- 16 unit tests: the handler, the stdio session entry, the fail-loud upload, and the
  no-shim/Pi/client-only branches.

Why it never merged, and what a straight rebase would miss:

1. **The repo moved under it.** Every path is pre-rename (`services/agent/`, now
   `services/runner/`), and the engine was refactored around it.
2. **It was never live-verified.** The PR's own gate was "do not merge until a real
   Claude+Daytona+callback run is green," and Daytona credentials/credit blocked that at the
   time. The urgency then dropped when the fail-loud gate (#5047) shipped separately.
3. **The internal channel evolved past its handler.** Since #4873: client tools are
   advertised and paused on the channel (`MCP_PAUSED`, `tool-mcp-http.ts:62`), the
   snake-case `input_schema` accessor fixed empty schemas for platform-catalog tools
   (`tool-mcp-http.ts:140-146`), the runner-side relay permission guard landed
   (`relay.ts:105`), and idle-backoff changed relay polling (`relay.ts:68-80`). #4873's
   shim duplicated the handler instead of sharing it, so none of those fixes reach it.
4. **Small divergences to correct on revival:** it introduced parallel env var names
   (`AGENTA_TOOL_PUBLIC_SPECS`/`AGENTA_TOOL_RELAY_DIR`) instead of reusing the Pi
   extension's `AGENTA_AGENT_TOOLS_*` pair, and its `relayToolCall` call dropped the
   per-tool `timeoutMs` budget that the public spec now carries.
5. **Warm reuse did not exist yet.** #4873 assumed a single-run ephemeral sandbox. The
   lifecycle analysis in [plan.md](plan.md) is new.

The verdict: the architecture and most of the code are sound and reviewed (Codex xhigh at
the time); the revival re-homes it onto today's paths, consumes the relay client PR #5232
extracts instead of carrying its own copy, replaces the parallel env names with a specs
file plus the shared relay-dir variable, restores the per-tool timeout, and adds the reuse
lifecycle and live QA that were missing.

## Constraints carried over (summary; full list in prior art)

From `claude-daytona-tools/research.md`, still true and re-verified: no credential may cross
into the sandbox (public specs only, `tool-mcp-http.ts:131-135`); the user stdio MCP disable
is about processes on the runner host (`run-plan.ts:337-343`, `mcp.ts:148-155`) and must not
be relaxed by whatever spawns the shim; the SSRF guard shapes why sandbox-reachable runner
URLs are the wrong direction (`mcp.ts:62-96`); strict-network runs with executable tools are
refused on Daytona because execution happens runner-side (`run-plan.ts:368-379`), and this
project does not change that.
