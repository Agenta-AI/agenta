# Experiment protocol: harness session resume across a process kill

This file records the exact, reproducible steps run on the dev box on 2026-07-09 to answer two
questions about coding-agent harness behavior:

- Q1 (write timing): is the harness session file on disk current mid-turn, at the moment the
  harness is blocked on a permission gate, with the pending `tool_use` already persisted? Or is it
  flushed only at turn end?
- Q2 (dangling-call handling): when a session file ends in an unanswered `tool_use` and the harness
  loads it, does it (A) answer/re-ask the SAME `tool_use` id, (B) settle it as interrupted and let
  the model re-issue a NEW `tool_use` with full structured context, or (C) fail or drop back to the
  last user message?

Everything ran in scratch directories. No git or `but` operations. The running dev-stack containers,
the subscription sidecar, and other agents' Claude sessions were left untouched.

## Environment

- Box: hetznerdev, `/home/mahmoud/code/agenta`.
- `claude` CLI: version 2.1.205, authenticated with a Claude Max subscription (OAuth), model
  `claude-fable-5`.
- `claude-agent-acp` (the ACP adapter the runner ships on): version 0.23.1, at
  `services/runner/node_modules/@zed-industries/claude-agent-acp/`. It wraps
  `@anthropic-ai/claude-agent-sdk`, which spawns the same `claude` CLI under the hood.
- Pi: `@earendil-works/pi-coding-agent` 0.79.4 bundled under
  `services/runner/node_modules/.pnpm/`, plus `pi-acp` 0.0.29. Pi is not installed on the host
  (`which pi` fails), so Pi was analyzed from source (static-only). See report for the reasoning.
- Scratch root: `/home/mahmoud/.claude/jobs/1d53079e/tmp/exp-claude/`.

## The logging proxy

A ~110-line single-file Python proxy (`proxy.py`, run with `uv run`) listens on
`127.0.0.1:8791`, forwards every request to `https://api.anthropic.com`, and appends a JSONL log
line per request: method, path, model, message count, and a compact per-message signature
(`role[blocktype+blocktype...]` with `tool_use`/`tool_result` ids). The harness is pointed at it with
`ANTHROPIC_BASE_URL=http://127.0.0.1:8791`. This makes the invariant check a literal diff of the
call sequence. The Claude Max subscription traffic did route through the proxy, so it captured real
calls.

Note: the proxy logs request bodies only (not responses), so a model's `tool_use` output appears in
the NEXT request (as history), never in the request that produced it.

## A required workaround: child-session env scrubbing

The box runs Claude agents. Their environment exports `CLAUDECODE=1`,
`CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SESSION_ID`, and related vars. A `claude` (or ACP adapter)
launched with those inherited auto-enters bypass-permissions mode, which never hangs on a gate. Every
launch below first unsets: `CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_SESSION_ID
CLAUDE_CODE_CHILD_SESSION CLAUDE_CODE_BRIDGE_SESSION_ID CLAUDE_CODE_EXECPATH CLAUDE_CODE_SSE_PORT`.
This scrubbing is essential to reproduce a real permission gate.

## Experiment C, Level 1: Claude Code CLI

Driven under tmux (session `expclaude`) so a real TTY permission prompt can hang. Two full cycles
were run (`proj/` and `proj2/`) to confirm reproducibility.

1. Start the proxy in the background.
2. `tmux new-session -d -s expclaude -x 200 -y 50`. In the pane: unset the child-session vars, `cd`
   into the scratch project dir, `export ANTHROPIC_BASE_URL=http://127.0.0.1:8791`, then launch
   `claude --permission-mode default`. Accept the folder-trust prompt with `1`.
3. Send the prompt: `Run this exact bash command with the Bash tool, nothing else: echo TOKEN-8f3a
   > proof.txt` (cycle 2 used `TOKEN-9c2b`).
4. Poll `tmux capture-pane` until the Bash permission prompt appears ("Do you want to proceed?").
5. While blocked (Q1 evidence):
   - Find the session JSONL under
     `~/.claude/projects/-home-mahmoud--claude-jobs-1d53079e-tmp-exp-claude-proj/<session-id>.jsonl`.
   - Copy it aside. Extract every `tool_use`/`tool_result` block with a small Python script.
   - Record file mtime and line count three times over several seconds to confirm it is stable.
6. Kill (Q2 setup): identify the exact process tree (pane bash -> `claude` child -> any MCP
   subprocess it spawned), verify no other claude matches, then `kill -9` only those PIDs. Re-hash the
   JSONL to confirm the kill lost nothing. Confirm `proof.txt` was never written.
7. Resume: in the same pane, same cwd, run
   `claude --resume <session-id> --permission-mode default`.
8. Observe whether the pending permission auto-re-fires. Send a `continue` nudge. Approve any prompt
   that appears with `1`. Confirm `proof.txt` now holds the token.
9. Analyze the post-resume JSONL: was the ORIGINAL `toolu_` id answered with a real `tool_result`,
   or did a NEW `tool_use` id appear? Cross-check the proxy log for how the dangling `tool_use` was
   repaired on the wire.

## Experiment C, Level 2: the ACP path (claude-agent-acp)

This is the path the runner actually ships on. Driven by a ~180-line Node ACP client
(`acp_client.mjs`) that speaks newline-delimited JSON-RPC over the adapter's stdio (the framing the
ACP SDK uses). Run from the `services/runner` directory so the adapter resolves its SDK dependency.

1. Spawn daemon D1: `node .../claude-agent-acp/dist/index.js` with cwd `proj3/`, the proxy env, and
   the scrubbed env. Client capabilities advertise `fs.readTextFile`/`fs.writeTextFile`.
2. `initialize` (protocolVersion 1) -> `session/new` (cwd) -> capture `sessionId`.
3. `session/prompt` with the gated Bash command. The client is wired to HOLD (never answer) the
   `session/request_permission` request when it arrives.
4. When `session/request_permission` arrives for the Bash `toolCallId`, snapshot the JSONL and record
   the id. Do not answer.
5. `kill -9` daemon D1 (simulating the sandbox dying with the gate parked). Re-read the JSONL.
6. Spawn a fresh daemon D2. `initialize`. Then `session/load` with the recorded `sessionId` AND
   `_meta.claudeCode.options.resume = <sessionId>` (the resume id must travel in that meta path; a
   bare top-level `sessionId` no-ops for resume).
7. Observe the replay: does the adapter re-emit the original dangling call as a live
   `session/request_permission`, or as a settled `tool_call` update?
8. `session/prompt` "continue". This time the client APPROVES any permission request (selecting the
   `allow_once` option). Record which `toolCallId`s fire, whether the original id is among them, and
   whether `proof.txt` ends up with the token.
9. Analyze the final JSONL and the proxy call signatures.

## Experiment P: Pi (static source analysis)

Pi is not on the host. Rather than stand up a container (and risk disturbing the dev stack), Pi's
persistence and load paths were read directly from the bundled, unminified source:
`@earendil-works/pi-coding-agent/dist/core/agent-session.js`, `.../session-manager.js`,
`@earendil-works/pi-agent-core/dist/agent-loop.js`,
`@earendil-works/pi-ai/dist/providers/transform-messages.js`, and the `pi-acp/dist/index.js`
adapter. An existing on-disk session file under `~/.pi/agent/sessions/` confirmed the JSONL shape.
Findings and exact line citations are in the report, clearly labeled static-only.

## Teardown

Killed the tmux session, the proxy process (and its `uv`-spawned python child), and both ACP
daemons. Verified port 8791 free, no stray `claude`/proxy processes in the scratch cwds, and that
other agents' sessions were untouched. No containers were started. All outputs are new, uncommitted
files.
