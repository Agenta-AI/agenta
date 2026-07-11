# In-sandbox platform-tool MCP

Deliver Agenta gateway and platform tools to MCP-client harnesses (Claude Code today, Codex
next) running in a Daytona sandbox, by running our own small MCP server inside the sandbox.
Its `tools/call` handler writes to the file relay the runner already polls and executes
server-side. Today that combination gets zero tools and the run is refused up front
(`services/runner/src/engines/sandbox_agent/run-plan.ts:355`,
`REMOTE_TOOLS_UNSUPPORTED_MESSAGE`).

The design goal the owner cares about most is unification with Pi: one gateway-tool code
path serving both the Pi extension and the new MCP server, pinned by a golden test so the
relay protocol cannot fork per harness.

## Glossary

- **Runner**: the Node sidecar (`services/runner/`) that executes agent runs. It holds the
  run's credentials and executes gateway and platform tools server-side.
- **Harness**: the coding agent that runs inside the sandbox (Pi, Claude Code, later Codex).
- **Sandbox**: the isolated environment the harness runs in. Local (same machine as the
  runner) or Daytona (a remote cloud VM the runner reaches through a daemon API).
- **Daemon**: the sandbox-agent process inside the sandbox that the runner drives over a
  signed URL. It creates harness sessions and reads/writes sandbox files for the runner.
- **File relay**: the file-based tool-call channel. An in-sandbox writer creates
  `<id>.req.json` in a relay directory; the runner polls the directory, executes the call
  with runner-held credentials, and writes `<id>.res.json` back.
- **Gateway tools**: backend-resolved tools (Composio actions, workflow-as-tool, platform
  operations) executed through Agenta's `/tools/call` with server-side credentials.
- **Client tools**: browser-fulfilled tools (for example `request_connection`). A call
  pauses the turn and a human answers it in the playground.
- **Public spec**: the credential-free advertisement shape of a resolved tool (name,
  description, input schema, kind). Private fields (`callRef`, code, scoped env, callback
  auth) never leave runner memory.
- **The shim**: this project's deliverable. A small, dependency-free MCP server process
  inside the sandbox that advertises the public specs and forwards each `tools/call` to
  the file relay.
- **Warm reuse / park**: since PR #5225 a Daytona sandbox survives across turns. It stays
  running for an idle window (park-to-running), then stops without deletion
  (park-to-stopped) and restarts on the next turn.

## Files and reading order

1. [context.md](context.md): why the work exists, the settled owner decisions (including
   the user-MCP HTTP-only policy), goals, non-goals, and neighboring projects.
2. [research.md](research.md): the verified current state with file and line anchors, what
   PR #4873 built and why it went stale, and the warm-reuse lifecycle facts the design
   must survive.
3. [plan.md](plan.md): the recommended design (transport choice, unification path,
   lifecycle, security), the implementation slices, and the test plan.
4. [open-questions.md](open-questions.md): the decisions the owner still needs to make.
5. [status.md](status.md): progress and provenance. Source of truth for state.

## Prior art this builds on (not duplicated here)

- [../claude-daytona-tools/](../claude-daytona-tools/README.md): the full option analysis.
  Option A (in-sandbox MCP front-end over the relay) recommended; Option B (tunnel the
  runner's MCP) rejected.
- [../remote-tools-delivery/specs.md](../remote-tools-delivery/specs.md): independent
  reconfirmation; recommends the in-sandbox relay client.
- [../mcp-delivery-architecture/](../mcp-delivery-architecture/README.md): the umbrella.
  `gateway-mcp-location.md` records the 2026-07-11 owner decision that rejects the
  API-hosted gateway and commits to the in-sandbox front-end.
- [../gateway-tool-mcp/](../gateway-tool-mcp/README.md): the three-MCP-layer distinction
  (user stdio / internal gateway channel / user HTTP) that this plan keeps separable.
- PR #4873 (closed, unmerged): a working implementation of the stdio variant, pre-rename.
  Mined in [research.md](research.md).

## Status

DESIGN ONLY. No runtime code changes in this PR. See [status.md](status.md).
