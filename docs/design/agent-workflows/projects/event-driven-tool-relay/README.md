# Event-driven tool relay

Remove the polling latency from the sandbox-to-runner tool relay. Today every gateway tool
call waits on two poll loops (0.3 s to 1.5 s per hop). This project replaces the waiting
with filesystem-event wakeups while keeping polling as the correctness fallback. The relay
files, the security model, and the wire contract do not change.

## Glossary

- **Runner**: the Node sidecar (`services/runner/`) that executes agent runs. It holds the
  run's credentials and executes gateway and platform tools server-side.
- **Harness**: the coding agent that runs inside the sandbox (Pi or Claude Code).
- **Sandbox**: the isolated environment the harness runs in. Local (same machine as the
  runner) or Daytona (a remote cloud VM the runner reaches through a daemon API).
- **Relay**: the file-based channel for tool calls. The in-sandbox writer creates
  `<id>.req.json` in a relay directory; the runner executes the call with its own
  credentials and writes `<id>.res.json`; the writer reads it and deletes both files.
- **Hop 1**: the in-sandbox writer waiting for `<id>.res.json`.
- **Hop 2**: the runner discovering `<id>.req.json`. On Daytona this is a remote `ls`
  through the daemon API; locally it is a directory read.
- **Watch exec**: the proposed hop 2 mechanism on Daytona. One bounded, blocking
  `runProcess` call runs a small node script in the sandbox that lists the relay directory,
  then watches it, prints when a request appears, and exits. The runner re-issues it in a
  loop.

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
- [../claude-daytona-tools/design.md](../claude-daytona-tools/design.md): the in-sandbox
  MCP shim for Claude. It will become a second writer of the same relay files; the design
  here must not assume Pi is the only writer.
- [../session-keepalive/README.md](../session-keepalive/README.md): warm sessions. The
  relay loop is per-turn, so keep-alive and this project interact only at turn boundaries.
