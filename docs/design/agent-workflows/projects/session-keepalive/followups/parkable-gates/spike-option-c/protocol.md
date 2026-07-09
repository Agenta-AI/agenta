# Spike protocol: Option C wire hop (Pi `ctx.ui.confirm` to ACP `session/request_permission`)

This records the exact, reproducible steps run on the dev box on 2026-07-09 to prove or refute
Option C of the parkable-gates design. Option C claims a Pi approval can ride the ACP permission
plane the `pi-acp` bridge already has, so the runner's existing Claude-style park machinery holds
it unchanged.

The spike drives a real Pi session under the real `pi-acp` bridge, over a hand-written ACP stdio
client, and answers five questions: does the hop work mid-tool-gate, does the payload survive,
does the gate park for minutes, what do deny and drop do, and does the same shape survive the
`sandbox-agent` path the runner ships on.

Everything ran in scratch directories under `/tmp`. No git or `but` operations. The running
dev-stack containers and the subscription sidecar were left untouched. Only processes this spike
spawned were killed.

## Environment

- Box: hetznerdev, `/home/mahmoud/code/agenta`, Node 24.16.0.
- Pi: `@earendil-works/pi-coding-agent@0.79.4`, run via the bundled launcher at
  `services/runner/node_modules/.bin/pi`. Not installed globally; the bundled one is used.
- Bridge: `pi-acp@0.0.29` at `services/runner/node_modules/pi-acp/dist/index.js` (third-party MIT
  adapter by Sergii Kozak). It spawns `pi --mode rpc --no-themes`.
- ACP SDK: `@agentclientprotocol/sdk@0.26.0` (the one `pi-acp` depends on), used by the client.
- Model access: the host's codex subscription at `~/.pi/agent/auth.json` (provider
  `openai-codex`, which resolves to model `gpt-5.5`). Token valid through 2026-07-10. No API key
  needed and no OpenAI key used.
- Scratch root: `/tmp/agenta-spike-c/`.

## Isolation

Pi reads its config from an agent dir. To avoid touching the real `~/.pi/agent` (which holds the
production `agenta.js` extension and the live auth), the spike points Pi at an isolated agent dir
via `PI_CODING_AGENT_DIR=/tmp/agenta-spike-c/piagent`, containing:

- `auth.json` — a copy of the host's codex auth (so the isolated dir can reach the model).
- `settings.json` — `defaultProvider: "openai-codex"`, `defaultModel: "gpt-5.5"`,
  `defaultThinkingLevel: "low"` (cheapest working path, minimal generation).
- `trust.json` — pre-trusts the scratch cwd so no project-trust prompt fires.
- `extensions/spike.js` — the spike extension (below).

`pi-acp` swallows the Pi child's stderr (`child.stderr.on("data", () => {})`), so the spike sets
`PI_ACP_PI_COMMAND` to a two-line wrapper (`run-pi.sh`) that execs the real `pi` with `2>>` a log
file. That is the only way to see the extension's `[spike]` stderr.

## The spike extension (`spike-extension.js`)

A dependency-free ESM factory placed in the isolated agent dir's `extensions/`. It:

1. Registers one custom tool, `park_probe(token)`, whose `execute` returns
   `EXECUTED park_probe token=<token>`. Running it (and echoing the exact token) is how the spike
   proves the original call ran with its original arguments.
2. Registers a `tool_call` hook. When the model calls `park_probe`, the hook builds a JSON
   envelope `{v, gate, harness, toolName, toolCallId, input, probe}` — where `probe` deliberately
   contains quotes, backslashes, Japanese text, and a newline — and calls
   `ctx.ui.confirm("agenta-approval", JSON.stringify(envelope))`. On `true` it returns `undefined`
   (allow, so `execute` runs); on `false` it returns `{ block: true, reason: ... }` (deny).

This mirrors both Pi gates at once: the `tool_call` hook is the builtin-gate shape (Gate 2), and
gating a custom tool is the relay-gate shape (Gate 1). The hook is the exact seam the design's
Option C would use instead of the file-relay poll.

The hook passes **no** `opts` to `confirm` (no `timeout`, no `signal`). That matters for parking:
Pi's RPC dialog helper only arms a reaper when the caller passes `opts.timeout` or an
`opts.signal` that aborts (`pi-coding-agent/dist/modes/rpc/rpc-mode.js:44-80`). With neither, the
dialog waits indefinitely and, on cancel, resolves to the default `false` (fail-closed).

## The ACP client (`acp-client.mjs`)

A single-file Node ESM client using `ClientSideConnection` + `ndJsonStream` from the same ACP SDK
`pi-acp` uses. It:

1. Spawns `node pi-acp/dist/index.js` with `cwd` = the scratch project, and env
   `PI_CODING_AGENT_DIR`, `PI_ACP_PI_COMMAND` set as above.
2. Tees the agent-to-client and client-to-agent byte streams to `raw-in.log` / `raw-out.log` for a
   verbatim wire transcript, and logs every parsed ACP message to `transcript.jsonl`.
3. `initialize` (protocolVersion 1, fs read/write client capabilities) then `session/new` (cwd,
   empty `mcpServers`) then `session/prompt` with:
   `Call the park_probe tool exactly once with token "<TOKEN>". Do not call any other tool. After
   the tool result, reply with just the word done.`
4. Implements the client `requestPermission` handler. Any permission whose `toolCall.title` is not
   `agenta-approval` (for example a project-trust prompt) is auto-allowed to keep the run moving.
   For the `agenta-approval` gate, behavior is chosen by the `SCENARIO` env var:
   - `allow` — answer `{outcome:{outcome:"selected", optionId:"yes"}}` immediately.
   - `deny` — answer `optionId:"no"`.
   - `hold` — log a heartbeat every 15s, wait `HOLD_MS`, then answer `yes` (the park test).
   - `drop` — wait `HOLD_MS`, then EOF `pi-acp`'s stdin and destroy the read side without
     answering (simulates the ACP transport dropping while the request is pending).
   - `rejecterr` — throw from `requestPermission` so the ACP request itself is rejected while the
     daemon stays alive (the clean connection-error path).

## Runs executed

| Scenario | Command (from `/tmp/agenta-spike-c`) | Purpose |
|---|---|---|
| allow | `SCENARIO=allow TOKEN=TOKEN-ALLOW-a1b2 node client.mjs` | Q1 hop + Q2 payload |
| deny  | `SCENARIO=deny TOKEN=TOKEN-DENY-d3d4 node client.mjs` | Q4 deny |
| hold  | `SCENARIO=hold TOKEN=TOKEN-PARK-9f9f HOLD_MS=180000 MAX_MS=280000 node client.mjs` | Q3 park (3 min) |
| drop  | `SCENARIO=drop TOKEN=TOKEN-DROP-7a7a HOLD_MS=15000 node client.mjs` | Q4 transport drop |
| rejecterr | `SCENARIO=rejecterr TOKEN=TOKEN-REJ-5b5b node client.mjs` | Q4 clean reject |

Each writes `logs/<scenario>/transcript.jsonl` (structured), `raw-in.log` / `raw-out.log`
(verbatim wire), and appends `[spike]` lines to `logs/pi-stderr.log`. The transcripts are copied
into `evidence/` in this folder.

## Source-only checks (no daemon stood up)

Q5 (the `sandbox-agent` daemon path) was verified from the shipped runner source rather than by
standing up the daemon, to avoid any risk to the running stack:

- `services/runner/src/engines/sandbox_agent/acp-interactions.ts` — how the runner classifies and
  answers every ACP `session/request_permission`.
- `acp-http-client@0.4.2/dist/index.js:448-452` — the HTTP-proxied ACP layer forwards the whole
  `requestPermission(request)` to the runner's handler unchanged.

## Teardown

Killed the client, `pi-acp`, and the wrapped `pi` for every run (all spawned by this spike). After
the final run, `pgrep` for `client.mjs`/`pi-acp`/`run-pi.sh` returned nothing (no orphaned
process), port and dev-stack containers untouched. All outputs are new, uncommitted files under
`/tmp/agenta-spike-c` and this `spike-option-c/` folder.
