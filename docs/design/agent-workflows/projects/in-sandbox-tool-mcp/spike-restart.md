# Spike: does session/load respawn the in-sandbox stdio MCP shim after a Daytona restart?

Slice 0 of the in-sandbox platform-tool MCP project. Run 2026-07-12 against the live
Daytona EU target with the exact pinned stack. Scripts and raw method: `spike/spike-mcp.js`
(the mini stdio MCP server), `spike/spike-restart-driver.ts` (the full create, park,
restart, resume cycle), `spike/spike-adapter-pin.ts` (version probes).

## Verdict: YES, session/load respawns the shim

The patched `resumeSession` reached ACP `session/load` (`loadedFromContinuity=true`, same
`agentSessionId` before and after the VM stop/start), and the Claude ACP adapter respawned
the stdio MCP subprocess as part of handling the load: a fresh process appeared with a new
pid, received `initialize`, `notifications/initialized`, and `tools/list`, and stayed
alive. No special handling is needed in the engine.

**Implementation consequence: A2 is locked.** The typeless `{name, command, args, env}`
entry in `sessionInit.mcpServers` works on both `session/new` and `session/load`. The
engine's existing resume path (`engines/sandbox_agent.ts`, the `persist.updateSession` +
`sandbox.resumeSession(localSessionId)` block) needs no fork for sessions that carry the
internal shim entry.

## The pinned stack (as observed inside the sandbox)

| Component | Version | How observed |
|---|---|---|
| Daytona snapshot | `agenta-sandbox-pi` (target `eu`) | `SANDBOX_AGENT_DAYTONA_SNAPSHOT` in the ee dev env file |
| In-sandbox daemon | `sandbox-agent 0.5.0-rc.2` (`/usr/local/bin/sandbox-agent`) | `sandbox-agent --version` |
| Claude ACP adapter | `@zed-industries/claude-agent-acp 0.22.2` | `agent_processes/claude/node_modules/@zed-industries/claude-agent-acp/package.json` |
| Claude Agent SDK | `@anthropic-ai/claude-agent-sdk 0.2.76` | same node_modules tree |
| ACP SDK | `@agentclientprotocol/sdk 0.16.1` | same node_modules tree |
| In-sandbox Node | v22.22.1 | `node --version` |
| Runner client lib | `sandbox-agent@0.4.2` + `patches/sandbox-agent@0.4.2.patch` | `services/runner/package.json` `patchedDependencies` |

The adapter lives at
`/home/sandbox/.local/share/sandbox-agent/bin/agent_processes/claude/node_modules/.bin/claude-agent-acp`
and runs as a long-lived process per live connection; it spawns a `claude` (Agent SDK)
child per session.

## Observed behavior, step by step

Sandbox `daytona/f686d918-1f49-4285-b89f-13e912641500`, local session id
`spike-restart:claude`, cwd `/home/sandbox/agenta/spike-cwd`, MCP entry
`{name: "agenta-tools", command: "node", args: ["/home/sandbox/agenta/spike/spike-mcp.js"], env: []}`
(no `type` field).

1. **createSession (session/new)** returned `agentSessionId=bf7709ea-0556-4760-b20b-13e9d47f6a24`.
   Within ~1.2s the shim log showed spawn #1, driven to readiness immediately (not lazily
   at first tool use):

   ```
   spawned pid=145 at=2026-07-12T03:21:23.112Z
   pid=145 method=initialize
   pid=145 method=notifications/initialized
   pid=145 method=tools/list
   ```

   A `/proc` scan confirmed pid 145 (`node /home/sandbox/agenta/spike/spike-mcp.js`) live,
   next to the adapter (pid 112 `claude-agent-acp`) and its SDK child (pid 129 `claude`).

2. **Park** (engine order: `destroySession` then `pauseSandbox`) stopped the VM; Daytona
   reported `state=stopped` ~7s later.

3. **Reconnect** (`SandboxAgent.start({..., sandboxId})`) restarted the VM and the daemon.
   Before resume: the shim log still held only the pid-145 lines (disk survived the stop),
   and no shim process was running. So nothing respawns at daemon restart alone.

4. **Resume** (fresh persist seeded with the prior `agentSessionId`, then
   `resumeSession("spike-restart:claude")`):

   ```
   resumeSession ok agentSessionId=bf7709ea-... prior=bf7709ea-... loadedFromContinuity=true
   ```

   ~1s later the log showed spawn #2 with a NEW pid, fully re-initialized:

   ```
   spawned pid=147 at=2026-07-12T03:21:36.399Z
   pid=147 method=initialize
   pid=147 method=notifications/initialized
   pid=147 method=tools/list
   ```

   `/proc` confirmed pid 147 live, with a fresh adapter (pid 114) and `claude` child
   (pid 131). The respawn is tied to `session/load` itself, not to any prompt: no turn ran
   between reconnect and the spawn line.

## Limitations and side findings

- **No model-visible tool call was exercised.** The only Anthropic key available
  (`ANTHROPIC_API_KEY` in the ee dev env) has no credit: both one-turn prompts failed with
  `Internal error: Credit balance is too low` before any tokens ran. The respawn question
  is adapter lifecycle behavior, not model behavior, and the log evidence (initialize +
  tools/list received by the new pid on the load path, twice symmetric with session/new)
  answers it. A funded key would let a follow-up prove the last inch (the model calling
  `spike_echo` after restart).
- **MCP servers spawn eagerly.** The adapter launches and initializes stdio MCP servers at
  session creation AND at session load, before any prompt. The shim will therefore be
  running (and its tools listable) as soon as the session exists.
- **Stale `sandboxId` after park creates a fresh sandbox silently.** `pauseSandbox()`
  clears the handle's provider refs, so reading `sandbox.sandboxId` after park yields
  `undefined`, and `SandboxAgent.start` with `sandboxId: undefined` quietly creates a new
  VM (spike iteration 2 hit this). The engine is safe because it persists the pointer via
  `writeSandboxPointer` before parking, but any new code must capture the id pre-park.
- **`destroySession` before park does not break resume.** The engine's park order
  (session/cancel then stop) leaves the Claude session loadable; `session/load` restored
  the same `agentSessionId`.
- **Snapshot env naming.** The runner code reads `DAYTONA_SNAPSHOT`, but in the ee dev env
  file that name points at the API code-evaluator snapshot (`daytona-small`, no daemon).
  The sandbox-agent snapshot is under `SANDBOX_AGENT_DAYTONA_SNAPSHOT=agenta-sandbox-pi`.
  The deployed ee-dev runner container currently shows `DAYTONA_SNAPSHOT=daytona-small`
  with `SANDBOX_AGENT_PROVIDER=local`, so Daytona runs from that container would pick the
  daemon-less snapshot if enabled; worth a config sweep, tracked outside this spike.

## Teardown verification

All sandboxes created across every driver iteration were deleted and verified gone by
direct `get` (404) and a full account list:

- `95389f3f-6844-49e5-b4c2-f7af60807a94` (iteration 2, phase A): gone
- `ca1a5af0-4547-4501-8616-461501513ed7` (iteration 2, accidental fresh create): gone
- `f686d918-1f49-4285-b89f-13e912641500` (iteration 3, the evidence run): gone
- `1720bab9-f9c4-4d5a-a5df-59525fe980ba` (adapter pin probe): gone

Account sandbox list after the spike: **0 sandboxes**.
