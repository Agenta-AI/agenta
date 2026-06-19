# Agent Workflows

This workspace documents the current agent workflow implementation and the work still
needed to make it production-ready.

The source of truth is the code listed in [Ground Truth](ground-truth.md). Design pages at
this level describe the current implementation unless they explicitly say "planned",
"blocked", or "not implemented". Historical work-package notes and old RFCs live in
[trash/](trash/).

## Read In This Order

1. [Ground Truth](ground-truth.md): what the current code does, what is wired, and what is
   still missing.
2. [Status](status.md): current cleanup state, decisions, blockers, and next steps.
3. [Meeting Alignment](meeting-alignment.md): where the current work matches the June 18
   design discussion, where it diverges, and what still needs to be done.
4. [Architecture](architecture.md): the service, agent runner sidecar, harnesses, and
   sandboxes.
5. [Protocol](protocol.md): `/invoke`, `/messages`, `/load-session`, and the runner `/run`
   wire contract.
6. [Ports and Adapters](ports-and-adapters.md): the SDK runtime ports, backend adapters,
   harness adapters, and browser protocol adapter.
7. [Agent Template](agent-template.md): the intended split between generic agent identity,
   harness-specific config, and runtime infrastructure.
8. [Sessions](sessions.md): cold replay, streaming, session ids, and the missing session
   store.
9. [Triggers](triggers.md): planned trigger/event integration and the missing Compose.io
   POC.
10. [Pi Adapter](adapters/pi.md): Pi-specific tool delivery, prompt layers, tracing, and
   usage writeback.
11. [Claude Code Adapter](adapters/claude-code.md): Claude over ACP, MCP tool delivery,
   permissions, tracing, and usage.
12. [Agenta Harness](adapters/agenta.md): the experimental Agenta-flavored Pi harness.
13. [SDK Local Tools](sdk-local-tools/): planned and partly implemented work for standalone
   SDK tool resolution. This remains blocked by `LocalBackend`.
14. [PR Stack](pr-stack.md): functional breakpoints for reviewable stacked PRs.
15. [Implementation Review](implementation-review.md): high-level cleanup risks and PR
    slicing notes.
16. [Open Issues](open-issues.md): deferred decisions that need ownership.

## Current State

The agent workflow runs a coding harness as an Agenta workflow. It supports:

- A batch `/invoke` path that returns the final assistant message.
- An agent-only `/messages` path that accepts Vercel `UIMessage` input and can stream a
  Vercel UI Message Stream over SSE.
- A `/load-session` route with the right contract but no durable storage by default.
- Pi and Claude harnesses through the rivet runner.
- Pi and the experimental `agenta` harness through the in-process Pi backend.
- Server-resolved tool specs, code tool execution, callback tools, and MCP plumbing behind
  a feature flag.

The main missing pieces are durable server-owned sessions, future session snapshot
interfaces, the agent template/config split, trigger integration, a working standalone
`LocalBackend`, production Agenta harness content, first-class built-in workflow
registration, and the final cleanup of historical work-package names in comments and docs.

## Trash

[trash/](trash/) holds old work-package notes, research spikes, and superseded RFCs. It is
kept for archaeology only. Do not treat it as design truth unless a current page links to a
specific note as background.
