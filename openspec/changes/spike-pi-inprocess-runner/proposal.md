# Spike: run Pi inside the runner, use the sandbox as a tool

Status: DRAFT for Mahmoud. Exploratory spike, not production. No code written yet.

## Why

Today every Pi session starts a sandbox and runs Pi (a Node.js process) inside it. On Daytona that costs a full sandbox for the whole session, even while the model is only thinking, and the user waits for the sandbox before the agent says anything.

Pi is a library. It can run inside the runner process, next to hundreds of other sessions. Rivet measured about 0.8 MB per extra session in that setup (best case, no tools). The sandbox is then needed only when the agent runs a command.

Goals, in order:

1. The agent starts answering as soon as the user talks to it. No wait for a sandbox.
2. The sandbox runs only when a command needs it.
3. The architecture gets simpler, not more complex.

## What Changes

- Add a third runner provider next to `local` and `daytona`. Working name: `inprocess`. Pi only.
- Pi runs in the runner process through the Pi SDK. Each session has its own Pi objects, credentials and tools.
- Tools that call Agenta or outside services (Composio gateway, MCP gateway, platform tools, client tools) run in the runner. No sandbox, no file relay.
- Every tool call (file tools and shell commands) runs in a Daytona sandbox. The sandbox starts on the first tool call, stops when idle, and starts again on the next tool call. (Decided in round 7; the first proposal started it in the background when the session opened.)
- File reading and editing: the spike tests whether this can work without the sandbox (see design.md, direction E1).
- Everything the user sees stays the same: files, permissions, approvals, secrets rules, sessions.

## Capabilities

### New Capabilities

- `pi-inprocess-runtime`: run many Pi sessions in one runner process, isolated from each other.
- `workspace-files`: the agent sees and edits the same agent folder and session folder as today.
- `sandbox-lifecycle`: start the sandbox on the first tool call, run tool calls in it, stop it when idle.
- `tool-execution`: gateway, MCP, platform and client tools run in the runner under the same permissions.
- `secret-isolation`: model keys, subscription logins, MCP secrets and custom secrets stay out of the model's reach.
- `approvals`: human-in-the-loop behavior does not change.
- `session-continuity`: sessions resume, cancel and move between runners as today.
- `skills-and-attachments`: skills, user images and shared files keep working.

### Modified Capabilities

None. The `local` and `daytona` providers do not change.

## Out of scope for the spike

- Claude Code and Codex. They are separate programs and stay on today's path.
- Channels (Slack, Telegram). They sit above the runner.
- Sub-agents. The spike records the requirement but does not build it.
- Production hardening, migrations, UI changes.

## Decision on agentOS versus Rivet actors

We borrow Rivet's Pi integration pattern (Pi SDK in process, sandbox as tools), not the Rivet actor runtime. We already own session lifecycle, persistence, approvals and multi-runner routing. Adding RivetKit actors would duplicate them.

agentOS is not the main line. It adds a second sandbox layer while we still need Daytona for real commands. It stays as an optional direction (design.md, E5) if file work without Daytona turns out hard.

## Impact

New code in `services/runner` behind a new provider id. No wire contract change expected; if one is needed, the spike records it. Work happens in a worktree on a shared dev host.
