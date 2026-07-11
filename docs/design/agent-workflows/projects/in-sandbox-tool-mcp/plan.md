# Plan

## The design in one paragraph

Ship a small, dependency-free MCP server bundle into the Daytona sandbox and advertise it to
the harness as an internal stdio MCP entry named `agenta-tools`. The harness's own ACP
adapter spawns it inside the sandbox at session creation; its `tools/list` serves the run's
public specs, and its `tools/call` writes a relay request file through the same relay-writer
module the Pi extension already uses. The runner's existing relay loop executes every call
server-side, behind the existing permission guard, with credentials that never enter the
sandbox. The handler and the relay writer become shared modules with a golden test pinning
the request file bytes, so Pi, local Claude, and the in-sandbox server are three transports
over one implementation. This revives PR #4873 onto today's code rather than building new.

## Transport: reconciling A1, A2, and daemon-spawned into one choice

Three candidates existed across the prior designs:

- **A1, HTTP on the sandbox loopback** (recommended by `claude-daytona-tools/design.md`):
  the runner uploads the bundle, starts it with `runProcess` on a fixed port, waits for
  readiness, and advertises `http://127.0.0.1:<port>/mcp`.
- **A2, stdio spawned by the harness** (implemented by PR #4873): the runner uploads the
  bundle and advertises an ACP `McpServerStdio` entry `{name, command, args, env}`; the
  harness's ACP adapter spawns it inside the sandbox and speaks newline-delimited JSON-RPC
  over its stdin/stdout.
- **Daemon-spawned** (recommended by `remote-tools-delivery/specs.md` as candidate b1):
  teach the sandbox-agent daemon a concept of "an extra in-sandbox MCP server attached to a
  session".

The daemon-spawned candidate collapses into A2: #4873 demonstrated that no daemon change is
needed, because the daemon already forwards `sessionInit.mcpServers` verbatim and the Claude
ACP adapter already spawns a stdio entry inside the sandbox. The daemon concept
`remote-tools-delivery` asked for exists; it is the harness adapter's own MCP-server list.

Between A1 and A2, the decision is **A2**, flipping the earlier `claude-daytona-tools`
recommendation. Two facts changed since that document:

1. **Warm sandbox reuse (PR #5225) makes a runner-managed long-lived process the wrong
   shape.** An A1 shim must be health-checked when a parked sandbox resumes, restarted after
   park-to-stopped (the VM stop killed it), and found and replaced when a tool-set change
   forces a cold session inside a reused sandbox (a stale process on the fixed port serving
   last turn's specs). Every one of those is a new failure mode with a live-QA cell. An A2
   shim inherits the session lifecycle instead: the adapter spawns it with the session's env
   at session creation, so a new session always means a fresh shim with fresh specs, a
   stopped VM cannot leave a stale one (the process died with the VM and respawns with the
   session), and an orphan whose parent died exits on its own when stdin closes.
2. **A2 is already implemented and unit-tested** (#4873), including the ACP entry mapping
   that was the main unknown when A1 was recommended ("stdio as fallback if port/readiness
   is fiddly"). The port and readiness management A1 requires is exactly the part with no
   existing code.

A2 also removes surface rather than adding it: no listener at all (not even loopback), no
port to choose, no readiness poll racing Claude's `tools/list` (the MCP handshake is
synchronous at spawn), and it works under `network: off` since it is stdio plus file I/O.

Costs of A2, stated honestly:

- **Stdio optics.** User stdio MCP is disabled, permanently. This entry is stdio too, but it
  is synthesized by the runner from resolved tools, never user-declared, and it runs inside
  the sandbox, not on the runner host. The implementation must keep the layers structurally
  separate: the internal entry is built after the user-stdio gate has already run
  (`run-plan.ts:341`), never flows through `toAcpMcpServers`, and a test pins that a
  user-declared stdio server is still refused on the exact path that ships the shim.
- **Dependence on the ACP adapter's typeless-entry-to-stdio mapping.** Verified against the
  adapter pin at #4873 time; re-verify against the current pin, and against Codex's ACP
  adapter when that harness lands. If an adapter ever refuses stdio entries, A1 is the
  documented fallback: the same bundle grows an HTTP mode (`tool-mcp-http.ts` relocated),
  the runner starts it via `runProcess`, and the lifecycle work above becomes real. Nothing
  in the shared modules is transport-specific, so the fallback swaps the outer loop only.

## What runs where

```
runner (holds credentials, executes)                sandbox (holds nothing secret)
------------------------------------                ------------------------------
resolve tools -> public specs ----------------------> shim env (specs + relay dir)
upload shim bundle (daemon FS API) -----------------> /home/sandbox/.agenta/tool-mcp.js
advertise McpServerStdio "agenta-tools" -----------> harness ACP adapter spawns shim
startToolRelay polls relay dir <--------------------- shim writes <id>.req.json
executeRelayedTool (guard, credentials) ------------> writes <id>.res.json
                                                      shim reads res, answers tools/call
```

Local runs are unchanged: Claude on the local sandbox keeps the runner-loopback HTTP server
(which also carries the client-tool pause), and Pi keeps its extension everywhere.

## Interfaces, by semantic role

No `/run` wire change and no new protocol field. Every new element classified:

- **Input (what to serve):** the public tool specs, carried to the shim as
  `AGENTA_AGENT_TOOLS_PUBLIC_SPECS` in the stdio entry's per-server `env`. This is the exact
  variable and shape the Pi extension reads (`pi-assets.ts:71`); #4873's parallel names are
  dropped so the public-spec contract has one source of truth.
- **Routing (where calls go):** `AGENTA_AGENT_TOOLS_RELAY_DIR`, same reuse.
- **Protocol context:** the ACP `McpServerStdio` entry `{name, command, args, env}`. `name`
  is `agenta-tools`, a stable identity coupled to the rendered permission rules
  (`claude_settings.py:60`); `command`/`args` are `node` plus the in-sandbox bundle path.
- **Config (runner-side, operator-owned):** `SANDBOX_AGENT_RELAY_MCP_BUNDLE`, the bundle
  location override (test and packaging use), defaulting to the esbuild output next to the
  Pi extension bundle. Later, a snapshot-bake skip flag mirroring
  `AGENTA_AGENT_SANDBOX_PI_INSTALLED`.
- **Credentials:** none, anywhere in this design. The shim has no credential field because
  execution stays where the credentials are. The entry's `headers` concept does not exist
  for stdio; nothing rides `env` except the two public variables above.
- **The relay file protocol:** unchanged, and now golden-pinned as the stable contract
  between any in-sandbox writer and the runner loop.

## Unification with Pi

The owner's priority. Today the "turn a model's tool call into a relay request" logic exists
in two call sites that both route through one writer (`runResolvedTool` ->
`relayToolCall`), plus an MCP message handler that exists once (`tool-mcp-http.ts:101`) and
was duplicated by #4873. The unification target is: one writer, one handler, three thin
transports.

**U1 (do now): shared modules.** Extract two pieces:

1. `tools/relay-client.ts`: the relay writer (`relayToolCall` plus its wait loop), moved
   out of `dispatch.ts` as #4873 did, with `dispatch.ts` re-exporting so existing call sites
   (the Pi extension, local Claude) are unchanged. It must bundle with zero non-relay code
   and honor the per-tool `timeoutMs` and an abort signal.
2. `tools/mcp-handler.ts`: the transport-neutral MCP message handler (initialize,
   tools/list with the shared schema accessor, tools/call, notifications, errors), factored
   from `tool-mcp-http.ts`, parameterized by an "execute" function and an optional
   client-tool pause hook. The HTTP server keeps its socket-abort pause; the stdio shim
   passes no pause hook in slice 1 (client tools are not delivered there yet).

The golden test pins the request file: the Pi extension path and the shim path, given the
same call, produce byte-identical `.req.json` content. That single test is what keeps "one
gateway-tool logic" true over time.

**U3 (do now, nearly free): one build pipeline.** The shim bundles in the same esbuild step
as the Pi extension, into `dist/`, baked into the runner image the same way. Same packaging,
same upload helper pattern, same snapshot-bake story later.

**U2 (explore later, not now): Pi consumes the in-sandbox MCP server directly.** The idea:
the Pi extension stops reading specs from env and instead dials the shim, lists its tools,
and registers a forwarding `registerTool` for each; eventually the extension is a generic
MCP client and user HTTP MCP could reach Pi through the same code. Honest trade-offs:

- Pi has no MCP client by design (pi-acp drops `mcpServers`), so this is new client code in
  the extension, not configuration.
- It adds a process and a hop to the one path that currently works on every backend, for no
  functional gain today: the extension already shares the writer and (after U1) would share
  nothing further by speaking MCP, because MCP is the part Pi does not need.
- Its real payoff is a different feature: user MCP on Pi (the open F-009 question) and
  retiring the env-var spec channel. Both are worth a decision when Codex lands and the
  MCP-client population grows, not before.

Recommendation: land U1+U3 now; write U2 up as a follow-up decision for the owner (see
[open-questions.md](open-questions.md)). After U1, "one gateway-tool logic" is concretely
true at the module level: both harness families execute tool calls through the same handler
semantics and the same writer bytes, verified by the golden.

## Lifecycle

- **Startup and readiness.** No race exists: the ACP adapter spawns the shim and completes
  the MCP handshake synchronously before the session prompt runs. A shim that fails to start
  (missing bundle, bad node) surfaces as an MCP server failure in the harness, and the
  fail-loud upload helper already refuses the run earlier if the bundle cannot be delivered.
- **Crash mid-turn.** If the shim dies, in-flight `tools/call`s fail in the harness and the
  model sees tool errors; the Claude SDK reports the server as failed. The runner relay loop
  is unaffected (it just stops seeing requests). No runner-side supervision is needed
  because the runner never owned the process.
- **Teardown, ephemeral delete.** The shim dies with the sandbox. Nothing to do.
- **Warm reuse, park-to-running.** The harness session stays alive, so the shim stays alive
  with it, still serving the specs that session was created with. Correct by construction:
  the keep-alive fingerprint includes `customTools` (`session-pool.ts:170`), so a live
  session is only continued when the tool set is unchanged.
- **Warm reuse, park-to-stopped.** The VM stop kills the harness and the shim. The next turn
  restarts the sandbox and builds or loads a session; the adapter respawns the shim from the
  session's MCP config. The bundle file survives on the sandbox filesystem; the upload
  helper can skip an unchanged existing file as an optimization.
- **Tool-set change between turns.** The fingerprint mismatch forces a cold session in the
  reused sandbox. The old session is destroyed (`destroySession`,
  `engines/sandbox_agent.ts:829-832`), which ends the old shim (stdin closes, the readline
  loop ends, the process exits). The new session spawns a fresh shim with the new specs in
  its env. No fixed port means no collision window.
- **Spec freshness invariant, stated once:** the shim's spec list is immutable per process,
  and a shim process never outlives the session that spawned it. Everything above is that
  invariant applied to each reuse case, and the live-QA matrix checks each case.

## Client tools: sequenced after, not in, the first slice

Client tools are advertised-and-paused on the local HTTP channel today (`MCP_PAUSED`
aborts the in-flight request so no result settles). Through the in-sandbox shim the shape is
different: the relay loop parks the call and writes no response file (`relay.ts:249-252`),
so the shim's wait would hang until the relay timeout and return an error to the model,
which is exactly the park-must-emit-no-result problem the client-tool continuation work
exists to solve (a parked call must produce no tool result, and the resumed turn must settle
the original call).

Sequencing, matching the prior designs: **slice 1 delivers executable (gateway/callback)
tools only.** A run that carries a client tool on the Claude+Daytona path keeps failing loud
with a narrowed, honest message (options considered: silently dropping client specs repeats
the F-032 silent-drop bug; advertising them and returning a synthetic error teaches the
model the tool is broken). When the continuation work lands, the shim inherits the pause
semantics by adding the pause hook to the shared handler, and the relay response protocol
gains whatever the continuation design chooses; that is deliberately not designed here.

## Gate change

`REMOTE_TOOLS_UNSUPPORTED_MESSAGE` narrows instead of disappearing. After slice 2 the refusal
fires only when: the harness is MCP-capable but the remote provider is not Daytona (fail
closed per provider until proven), or the run carries a client tool (until the continuation
work). The message text updates to say what is and is not supported and to point at this
workspace. The capability gate (`assertRequiredCapabilities`) is unchanged: Claude truthfully
advertises `mcpTools`, and now the advertisement is true on Daytona too.

## Security

The invariant, restated: **the sandbox sees public specs and a relay directory, nothing
else; every credentialed action executes runner-side; the shim opens no network surface.**

- No credential enters the sandbox: the shim env carries specs and a path. Private spec
  fields never leave runner memory (unchanged, `public-spec.ts`).
- No listener: stdio only. The loopback-only rule of the HTTP variant becomes "no socket at
  all".
- The user-stdio disable is not relaxed. The internal entry is synthesized downstream of the
  user gates, shares no constant and no code path with `toAcpMcpServers`' stdio branch, and
  a layering test pins: user stdio still refused, user HTTP still delivered, internal entry
  present, on the same Daytona run.
- The relay directory remains an in-sandbox capability: any sandbox process can write a
  request file. That is the accepted, pre-existing Pi posture, and the runner-side
  permission guard (`relay.ts:105`) re-checks every executable call, so a forged file cannot
  run a denied tool. The shim adds a second writer, not a second trust level.
- Strict-network runs with executable tools stay refused (`run-plan.ts:368`): execution
  still happens on the runner, outside the sandbox egress boundary. Unchanged.

## Coordination with event-driven-tool-relay

The sibling project replaces relay polling with filesystem-event wakeups. Two contact
points, agreed on paper:

1. **The file contract is shared and golden-pinned.** Request and response names, bytes, and
   delete-after-read semantics do not change in either project. The golden test in slice 1
   is the enforcement.
2. **The shim's response wait is one small function.** `relay-client.ts` isolates "wait for
   `<id>.res.json`" behind a single function with a timeout and an abort signal, currently
   implemented as the existing poll. The sibling swaps its internals for `fs.watch` without
   touching the handler or the writer. Nothing else in this project depends on how the wait
   is implemented.

## Packaging

Per-run upload first: `writeFsFile` the bundle (about 5 kB) via the fail-loud helper,
mirroring the Pi extension upload. Cold-start cost is one small FS write, negligible next to
the session create it rides along with, and the file persists across warm reuse. Snapshot
bake is a follow-up optimization in `build_snapshot.py` (same pattern as the pinned `pi`
install) with an env flag to skip the upload, worth doing once the path is hot; it changes
no licensing posture because the shim is Agenta code.

## Slices

**Slice 1: shared modules, no behavior change.**
Extract `tools/relay-client.ts` (writer + wait, timeout + signal) and `tools/mcp-handler.ts`
(transport-neutral handler) from `dispatch.ts`/`tool-mcp-http.ts`; re-export so all call
sites compile unchanged. Add the golden test pinning the request file bytes across the Pi
path and the handler path. All existing runner tests stay green.
Acceptance: zero behavior diff; golden committed.

**Slice 2: the shim, Daytona delivery, gate narrowing.**
Revive #4873 onto today's paths: the stdio entry bundle (thin loop over the shared handler +
writer), the esbuild step, the fail-loud upload helper, the `mcp.ts` Daytona non-Pi branch
building the internal `McpServerStdio` entry, engine wiring next to
`prepareDaytonaPiAssets`, and the narrowed run-plan gate (executable tools pass on Daytona
for MCP-capable harnesses; client tools and non-Daytona remotes still refuse loud). Unit
tests: handler over stdio framing, upload fail-loud, layering (user stdio refused / user
HTTP delivered / internal entry present), gate matrix.
Acceptance: runner tests + typecheck green; a fake-daemon integration test drives
shim -> relay dir -> `startToolRelay(localRelayHost())` -> mocked callback and asserts the
round trip.

**Slice 3: live QA and the replay pin.**
The matrix cell that has never been green: Claude + Daytona + gateway tool (github via the
`pi-agents` project, which holds live Composio connections), asserting the tool executes and
the result reaches the answer. Negatives: Claude+Daytona with no tools still runs (no shim
uploaded); Pi+Daytona unchanged; Claude+local unchanged. Warm-reuse cells: second turn
within the idle window (live session, same shim), second turn after park-to-stopped
(restart, respawn), tool-set change between turns (cold session in the reused sandbox,
fresh shim). Network-off cell: gateway tool executes with `network` restricted +
`best_effort` (relay is file I/O). Capture one green run and pin it with the
agent-replay-test recipe so the path regression-tests without a live LLM. Sandbox hygiene:
cheap model, verify the park/delete reaps everything.
Acceptance: matrix recorded in this workspace; replay test committed.

**Slice 4 (follow-ups, each its own decision):** client tools through the shim (after the
continuation work), snapshot bake, Codex ACP adapter verification, the U2 exploration
(Pi as an MCP client), and adopting the sibling's watch-based wait.

## Effort

Slices 1+2 are roughly two focused days (most code exists in #4873); slice 3 is one day
dominated by live QA. Risk is low: no wire change, no new network surface, local paths
untouched, and the one novel dependency (the adapter's stdio mapping) was already proven
once and is re-verified before merge.
