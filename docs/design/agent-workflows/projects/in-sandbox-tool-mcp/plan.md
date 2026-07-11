# Plan

Revised 2026-07-11 after a Codex xhigh review. The verdict: approve A2 conditionally, reject
the earlier scope. This revision adopts the cuts. The minimum viable feature is now: prove
the restart path (slice 0), consume the relay modules that PR #5232 owns, add a small stdio
entrypoint, deliver executable tools on Claude+Daytona, and prove the warm lifecycle live.
Everything else moved to explicit follow-ups.

## The design in one paragraph

Ship a small, dependency-free MCP server bundle into the Daytona sandbox and advertise it to
the harness as an internal stdio MCP entry named `agenta-tools`. The harness's own ACP
adapter spawns it inside the sandbox at session creation; its `tools/list` serves the run's
public specs, and its `tools/call` writes a relay request file through the shared relay
client that PR #5232 extracts. The runner's existing relay loop executes every call
server-side, behind the existing permission guard, with credentials that never enter the
sandbox. This revives PR #4873 onto today's code rather than building new. One condition
gates the transport choice: a pre-implementation spike must prove that the pinned Claude ACP
adapter respawns the shim on the stop-and-restart path.

## Transport: A2, conditionally

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
ACP adapter already spawns a stdio entry inside the sandbox.

Between A1 and A2, the recommendation stays **A2**, but for a narrower reason than earlier
drafts claimed. A2's real advantage is mechanism count: no listener, no port allocation, no
readiness endpoint, no PID bookkeeping, and no runner-side process supervision. A2 is also
already implemented and unit-tested (#4873), including the ACP entry mapping that was the
main unknown when A1 was recommended. It works under `network: off` since it is stdio plus
file I/O.

**What earlier drafts overstated, corrected here:**

- **Restart is not "correct by construction".** The restart path after park-to-stopped can
  seed persisted `sessionInit.mcpServers` and call `resumeSession()` / `session/load`
  (`engines/sandbox_agent.ts:1267`) rather than create a fresh ACP session. Whether the
  Claude ACP adapter recreates dead MCP subprocesses on that path is external adapter
  behavior. It must be proven, not inferred. Slice 0 is that proof, and A2 is locked only
  after it passes.
- **Orphan exit is an expectation, not a guarantee.** The runner itself warns that an ACP
  subprocess can reparent to PID 1 unless graceful session cancellation occurs
  (`engines/sandbox_agent.ts:827`). "Stdin closes, so the shim exits" describes the normal
  path; the live QA must watch for reparented survivors.

**Documented fallbacks, in order:** if the spike shows that `session/load` silently loses
MCP servers, force a cold `createSession` for any session that contains the internal shim
(the sandbox is still reused; only the harness session rebuilds). If the adapter cannot
spawn stdio entries at all, A1 is the last resort: the same bundle grows an HTTP mode, the
runner starts it via `runProcess`, and the lifecycle work A1 requires becomes real. Do not
build transport-neutral machinery for A1 now.

## What runs where

```
runner (holds credentials, executes)                sandbox (holds nothing secret)
------------------------------------                ------------------------------
resolve tools -> public specs (file) ---------------> specs file beside the bundle
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

- **Input (what to serve):** the public tool specs, delivered as a file uploaded next to
  the bundle, with the path in the stdio entry's per-server `env`. Decided now, not
  deferred: `AGENTA_AGENT_TOOLS_PUBLIC_SPECS` can carry many large JSON Schemas, and under
  A2 the env is copied through four layers (runner session config, daemon/ACP protocol
  state, adapter spawn environment, child process environment). An unbounded input through
  an exec environment is not acceptable, and a size limit would trade a working case for a
  loud failure. The relay directory is already a path capability and public specs are not
  credentials, so a file is the robust shape. Pi keeps its env variable; the spec content
  contract (the `AdvertisedToolSpec` array) stays one shape for both consumers.
- **Routing (where calls go):** `AGENTA_AGENT_TOOLS_RELAY_DIR`, reused unchanged.
- **Protocol context:** the ACP `McpServerStdio` entry `{name, command, args, env}`. `name`
  is `agenta-tools`, a stable identity coupled to the rendered permission rules
  (`claude_settings.py:60`); `command`/`args` are `node` plus the in-sandbox bundle path.
  The `McpServerStdio` shape moves out of `tools/mcp-bridge.ts` (which is the local HTTP
  channel) into `engines/sandbox_agent/mcp.ts` or a small ACP MCP types module beside it.
- **Config (runner-side, operator-owned):** `SANDBOX_AGENT_RELAY_MCP_BUNDLE`, the bundle
  location override (test and packaging use), defaulting to the esbuild output next to the
  Pi extension bundle. The override selects code, so it is trusted deployment
  configuration, never run or request configuration.
- **Credentials:** none, anywhere in this design. The shim has no credential field because
  execution stays where the credentials are.
- **The relay file protocol:** unchanged, owned by PR #5232 together with the relay client
  and its contract tests.

## Unification with Pi, stated honestly

The owner's priority is one gateway-tool logic. The earlier draft oversold what an MCP
handler buys here, so this section now separates the real unification from the local one.

**The real unification is the relay client and the relay file protocol.** Pi never speaks
MCP: pi-acp drops `mcpServers`, and the Pi extension registers tools directly and calls
`runResolvedTool` (`extensions/agenta.ts:280`). What Pi, local Claude, and the shim
genuinely share is the code that turns a tool call into a relay request file and waits for
the response. That code is `tools/relay-client.ts` and `tools/relay-protocol.ts`, and
**PR #5232 (event-driven-tool-relay) owns their extraction as its slice 0**. That PR is an
explicit prerequisite of this project. This project consumes those modules and adds only
shim-specific tests. Earlier drafts had this project extracting the modules and landing
first; that ordering is reversed and the conflict is closed.

**An MCP handler is not Pi unification.** A shared MCP message dispatcher would unify
exactly two transports: the local HTTP server and the stdio shim. That is useful but local.
The plan therefore cuts the standalone "transport-neutral handler, zero behavior change"
slice. Instead, while implementing the stdio shim, extract the smallest reusable MCP method
dispatcher only if it clearly reduces duplication against `tool-mcp-http.ts`; otherwise
temporarily duplicate the small protocol switch with focused parity tests and extract after
both transports stabilize. If a module is extracted, name it for what it is:
`internal-tool-mcp-handler.ts`, not a generic `mcp-handler.ts`, in a repository that also
has user HTTP MCP and deliberately disabled user stdio MCP. Do not pre-design a client-tool
pause hook for a protocol that is not designed yet; that insertion point gets added when
the continuation or bridge work needs it.

**One build pipeline (kept, nearly free).** The shim bundles in the same esbuild step as
the Pi extension, into `dist/`, baked into the runner image the same way.

**Pi consuming the shim directly (the old U2) is cut from this project** and recorded as a
follow-up decision; see the follow-ups list in the slices section.

## Lifecycle

- **Startup and readiness.** No race exists: the ACP adapter spawns the shim and completes
  the MCP handshake synchronously before the session prompt runs. A shim that fails to start
  (missing bundle, bad node) surfaces as an MCP server failure in the harness, and the
  fail-loud upload helper already refuses the run earlier if the bundle cannot be delivered.
- **Crash mid-turn.** If the shim dies, in-flight `tools/call`s fail in the harness and the
  model sees tool errors; the Claude SDK reports the server as failed. The runner relay loop
  is unaffected (it just stops seeing requests). No runner-side supervision is needed
  because the runner never owned the process. One case deserves its own statement: if the
  shim dies after writing `<id>.req.json` but before reading the response, the runner still
  executes the call (side effects happen) and writes a `.res.json` nobody consumes, while
  the model sees an MCP failure. The relay is at-least-once from the executor's point of
  view, and this property is shared with Pi's writer today. Slice 1's integration tests
  must cover crash-after-write.
- **Teardown, ephemeral delete.** The shim dies with the sandbox. Nothing to do.
- **Warm reuse, park-to-running.** The harness session stays alive, so the shim stays alive
  with it, still serving the specs that session was created with. The keep-alive fingerprint
  includes `customTools` (`session-pool.ts:170`), so a live session is only continued when
  the tool set is unchanged.
- **Warm reuse, park-to-stopped.** The VM stop kills the harness and the shim. The next turn
  restarts the sandbox and either builds a fresh session or loads the old one. The fresh
  build respawns the shim by construction. The `session/load` path is the open risk that
  slice 0 proves: the adapter may seed the persisted MCP config without respawning the
  subprocess, or may restore it, or may fail the load. Until the spike answers this, no
  claim is made. The documented fallback if restoration fails is a forced cold
  `createSession` for sessions containing the shim.
- **Tool-set change between turns.** The fingerprint mismatch forces a cold session in the
  reused sandbox. The old session is destroyed (`destroySession`,
  `engines/sandbox_agent.ts:829-832`), which normally ends the old shim (stdin closes, the
  readline loop ends, the process exits); the reparenting caveat above applies and the live
  QA checks for survivors. The new session spawns a fresh shim with the new specs. No fixed
  port means no collision window.
- **Warm-reuse edge cases the tests must cover, beyond the above:**
  - `session/load` after VM stop (the slice 0 spike, then a live QA cell).
  - Sanitized tool-call-ID collision: distinct raw IDs can sanitize to the same relay
    filename; two concurrent calls must not share a file.
  - Bundle-version skew in a reused sandbox: a sandbox that survived a runner deploy holds
    an old bundle file; the upload helper must overwrite rather than skip when content
    differs (hash or size check, not existence check).
  - Partial request visibility: the writer writes directly to the final `.req.json` path
    while the runner polls. PR #5232's plan amends the protocol with write-to-temp plus
    atomic rename; this project inherits that amendment through the shared relay client and
    must not work around it.

## Client tools: sequenced after, not in, this project

Client tools are advertised-and-paused on the local HTTP channel today (`MCP_PAUSED`
aborts the in-flight request so no result settles). Through the in-sandbox shim the shape is
different: the relay loop parks the call and writes no response file (`relay.ts:249-252`),
so the shim's wait would hang until the relay timeout and return an error to the model.

This project delivers executable (gateway/callback) tools only. A run that carries a client
tool on the Claude+Daytona path keeps failing loud with a narrowed, honest message (options
considered: silently dropping client specs repeats the F-032 silent-drop bug; advertising
them and returning a synthetic error teaches the model the tool is broken).

Ownership, stated plainly so the gap cannot hide: neither this project nor
[../mcp-client-tool-continuation/](../mcp-client-tool-continuation/README.md) designs the
Daytona client-tool bridge. That bridge needs a relay park protocol, a stdio analogue for
abort-without-result, and an answer to the Daytona auto-stop race. The recommendation to
open one owned workspace for it lives in
[../mcp-delivery-architecture/orchestration.md](../mcp-delivery-architecture/orchestration.md).

## Gate change

`REMOTE_TOOLS_UNSUPPORTED_MESSAGE` narrows instead of disappearing. After slice 1 the refusal
fires only when: the harness is MCP-capable but the remote provider is not Daytona (fail
closed per provider until proven), or the run carries a client tool (until the bridge work).
The message text updates to say what is and is not supported and to point at this workspace.
The capability gate (`assertRequiredCapabilities`) is unchanged: Claude truthfully advertises
`mcpTools`, and now the advertisement is true on Daytona too.

## Security

The invariant, restated: **the sandbox sees public specs and a relay directory, nothing
else; every credentialed action executes runner-side; the shim opens no network surface.**

- No credential enters the sandbox: the shim env carries a specs-file path and the relay
  dir. Private spec fields never leave runner memory (unchanged, `public-spec.ts`).
- No listener: stdio only. The loopback-only rule of the HTTP variant becomes "no socket at
  all".
- The user-stdio disable is not relaxed, and the separation is structural, not test-only:
  - The internal entry gets its own constructor and type, separate from any user MCP entry
    type. Its `command`, `args`, and `env` are built entirely from runner constants and
    operator configuration; no user-supplied `command`, `args`, `env`, or `transport` field
    can flow into it.
  - The internal entry is synthesized after the user-stdio refusal has already run
    (`run-plan.ts:341`) and never flows through `toAcpMcpServers`. `toAcpMcpServers` stays
    incapable of returning stdio; this project must not generalize it.
  - The reserved server name `agenta-tools` is rejected for user-declared MCP servers at
    validation time. The Python adapter already ignores user MCP permissions with that name
    (`claude_settings.py:119`); the runner adds the matching refusal on the declaration
    itself.
  - A layering test pins: user stdio still refused, user HTTP still delivered, internal
    entry present, on the same Daytona run.
- The relay directory remains an in-sandbox capability: any sandbox process can write a
  request file. That is the accepted, pre-existing Pi posture, and the runner-side
  permission guard (`relay.ts:105`) re-checks every executable call, so a forged file cannot
  run a denied tool. The shim adds a second writer, not a second trust level.
- Strict-network runs with executable tools stay refused (`run-plan.ts:368`): execution
  still happens on the runner, outside the sandbox egress boundary. Unchanged.

## Coordination with event-driven-tool-relay (PR #5232)

The sibling owns the relay mechanics this project rides on. Contact points:

1. **PR #5232 slice 0 is this project's prerequisite.** It extracts `tools/relay-client.ts`
   and `tools/relay-protocol.ts` and lands their contract tests. This project consumes the
   modules; it does not create, move, or re-test them beyond shim-specific integration.
2. **The response-wait seam lives in the extracted client.** The sibling swaps its internals
   for `fs.watch`; nothing in this project depends on how the wait is implemented, and
   adopting the watch inside the shim is a follow-up, not v1.
3. **The relay file protocol, including the atomic-rename amendment and the
   orphaned-request residue across warm-continued turns, is owned there.** This project's
   tests exercise the protocol; they do not redefine it. The residue ownership decision is
   tracked in
   [../mcp-delivery-architecture/orchestration.md](../mcp-delivery-architecture/orchestration.md).

## Naming and placement

- Stdio entrypoint: `tools/tool-mcp-stdio.ts` (bundled to the sandbox).
- If a shared dispatcher is extracted: `tools/internal-tool-mcp-handler.ts`.
- Upload and bundle-path helpers: under `engines/sandbox_agent/`, analogous to
  `pi-assets.ts`.
- ACP MCP entry shapes (`McpServerStdio`): move out of `tools/mcp-bridge.ts` into
  `engines/sandbox_agent/mcp.ts` or a small types module beside it; `mcp-bridge.ts` is the
  local HTTP channel and should not export ACP entry types.
- Server name: `agenta-tools`, unchanged; `claude_settings.py` couples the rendered
  permission rules to it.

## Packaging

Per-run upload: `writeFsFile` the bundle (about 5 kB) plus the specs file via the fail-loud
helper, mirroring the Pi extension upload. Cold-start cost is two small FS writes,
negligible next to the session create they ride along with. Five kilobytes does not justify
snapshot lifecycle and version-skew machinery, so snapshot bake stays a follow-up with its
own decision.

## Slices

**Slice 0: the restart spike (gates A2).**
Against the exact pinned Claude ACP adapter: create a session with the internal stdio MCP,
stop and restart the VM, exercise the real `resumeSession` / `session/load` path, and verify
that `tools/list` succeeds and a new shim PID exists. Define what happens when MCP
restoration fails: does `session/load` fail and fall back to `session/new`, or does it
return a session with zero tools? Record the answer in this workspace. Only then lock A2.
If restoration silently loses MCP servers, adopt the documented fallback (force cold
`createSession` for sessions containing the shim); A1 is the last resort.
Acceptance: a written spike report with the adapter pin, the observed behavior, and the
decision.

**Prerequisite (external): PR #5232 slice 0** lands `tools/relay-client.ts` and
`tools/relay-protocol.ts` with their contract tests.

**Slice 1: the shim, Daytona delivery, gate narrowing.**
Revive #4873 onto today's paths: `tool-mcp-stdio.ts` (a thin stdio loop over the consumed
relay client), the esbuild step, the fail-loud upload helper for bundle and specs file, the
`engines/sandbox_agent/mcp.ts` Daytona non-Pi branch building the internal `McpServerStdio`
entry via its dedicated constructor, engine wiring next to `prepareDaytonaPiAssets`, and the
narrowed run-plan gate (executable tools pass on Daytona for MCP-capable harnesses; client
tools and non-Daytona remotes still refuse loud). Tests are semantic contract tests, not
byte goldens: the shim's request is accepted by a real `startToolRelay` loop; IDs are
sanitized, bounded, and collision-free; timeout and abort clean up; concurrent calls get
distinct files and distinct responses; stdout carries only complete JSON-RPC lines and
logging stays on stderr; the layering test (user stdio refused / user HTTP delivered /
internal entry present); the gate matrix; upload fail-loud.
Acceptance: runner tests and typecheck green; a fake-daemon integration test drives
shim -> relay dir -> `startToolRelay(localRelayHost())` -> mocked callback and asserts the
round trip.

**Slice 2: live acceptance before merge.**
The matrix cell that has never been green: Claude + Daytona + gateway tool (github via the
`pi-agents` project, which holds live Composio connections), asserting the tool executes and
the result reaches the answer. Negatives: Claude+Daytona with no tools still runs (no shim
uploaded); Pi+Daytona unchanged; Claude+local unchanged. Warm-reuse cells: second turn
within the idle window (live session, same shim), second turn after park-to-stopped
(restart, respawn, per the slice 0 finding), tool-set change between turns (cold session in
the reused sandbox, fresh shim, no reparented survivor). Network-off cell: gateway tool
executes with `network` restricted + `best_effort` (relay is file I/O; `best_effort` is
required because the strict-network refusal for executable tools at `run-plan.ts:368`
stays, unchanged by this project). Sandbox hygiene: cheap model, verify the park/delete
reaps everything.
Acceptance: matrix recorded in this workspace.

**Follow-ups, cut from v1, each its own decision:**

- Client tools through the shim (needs the Daytona client-tool bridge workspace).
- Codex-on-Daytona verification (when the Codex harness is in scope).
- Snapshot bake and its skip flag.
- Pi as an MCP client (the old U2 exploration).
- Adopting the sibling's watch-based response wait inside the shim.
- Replay capture: a recorded `/run` response does not prove Daytona process spawning or
  restart behavior; add a replay test later only if it protects a deterministic
  runner/service contract worth pinning.

## Effort

Slice 0 is half a day of live spike work. Slice 1 is roughly one focused day once PR #5232
slice 0 has landed (most code exists in #4873); slice 2 is one day dominated by live QA.
Risk concentrates in the one novel dependency: the adapter's stdio mapping and its restart
behavior, which slice 0 proves before any implementation is committed.
