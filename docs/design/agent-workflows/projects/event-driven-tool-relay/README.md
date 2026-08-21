# Event-driven tool relay

Remove the polling latency from the sandbox-to-runner tool relay. Today every gateway tool
call waits on two poll loops (0.3 s to 1.5 s per hop). This project replaces the waiting
with filesystem-event wakeups while keeping polling as the correctness fallback. The final
relay files, the security model, and the wire contract do not change; publication becomes
atomic (a temp name plus a rename) so an event can never expose a partial file.

## Who writes the relay

The fast path covers every writer, current and future, because the watch is on the relay
directory, not on any writer:

- **Pi's in-sandbox extension** (today): each registered tool executes through
  `runResolvedTool`, which routes to the shared relay writer.
- **Local Claude** (today): the runner's loopback MCP handler dispatches `tools/call`
  through the same `runResolvedTool`, so local Claude writes the same relay files.
- **The in-sandbox stdio MCP shim** (tomorrow,
  [PR #5234](../in-sandbox-tool-mcp/README.md)): Claude on Daytona, a third writer of the
  same files through the same client module. This project's slice 0 extracts that shared
  client module (`tools/relay-client.ts`); the shim consumes it.

## Glossary

- **Runner**: the Node sidecar (`services/runner/`) that executes agent runs. It holds the
  run's credentials and executes gateway and platform tools server-side.
- **Harness**: the coding agent that runs inside the sandbox (Pi or Claude Code).
- **Sandbox**: the isolated environment the harness runs in. Local (same machine as the
  runner) or Daytona (a remote cloud VM the runner reaches through a daemon API).
- **Relay**: the file-based channel for tool calls. The in-sandbox writer creates
  `<id>.req.json` in a relay directory; the runner executes the call with its own
  credentials and writes `<id>.res.json`; the writer reads it and deletes both files.
  Both sides publish via `<name>.tmp.<nonce>` plus a same-directory rename.
- **Hop 1**: the in-sandbox writer waiting for `<id>.res.json`.
- **Hop 2**: the runner discovering `<id>.req.json`. On Daytona this is a remote `ls`
  through the daemon API; locally it is a directory read.
- **Watch exec**: the proposed hop 2 mechanism on Daytona. One bounded, blocking
  `runProcess` call runs a small node script in the sandbox that arms a directory watch,
  lists the relay directory, and exits when a request appears or its window ends. The
  runner treats each completion as a wake and re-issues the exec; while the watch is
  healthy the runner suspends its remote polling apart from a slow safety poll.

## Files and reading order

1. [context.md](context.md): why the relay exists, the settled decisions this project
   builds on, goals and non-goals.
2. [research.md](research.md): how the relay works today, with verified file and line
   anchors, plus the daemon API facts the design depends on.
3. [plan.md](plan.md): the design. Each decision lists its options and why one wins.
   Slices, test plan, measurement, and rollout with the poll fallback.
4. [open-questions.md](open-questions.md): what the owner still needs to decide or verify.
5. [status.md](status.md): progress and provenance.

## Related projects

- [../mcp-delivery-architecture/gateway-mcp-location.md](../mcp-delivery-architecture/gateway-mcp-location.md):
  the decision that keeps tool delivery on the runner and the file relay. This project is
  the latency follow-up named in that decision.
- [../in-sandbox-tool-mcp/README.md](../in-sandbox-tool-mcp/README.md): the in-sandbox
  MCP shim for Claude on Daytona (PR #5234). It becomes the third writer of the same relay
  files and consumes this project's slice 0 modules.
- [../mcp-delivery-architecture/orchestration.md](../mcp-delivery-architecture/orchestration.md):
  the landing order across the three tool-delivery plans.
- [../claude-daytona-tools/design.md](../claude-daytona-tools/design.md): the earlier
  shim design that #5234 supersedes; kept for provenance.
- [../session-keepalive/README.md](../session-keepalive/README.md): warm sessions. The
  relay loop is per-turn, so keep-alive and this project interact only at turn boundaries.
