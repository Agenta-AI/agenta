# Research: how the relay works today

All anchors verified on `gitbutler/workspace` on 2026-07-11. Re-verify before implementing;
the runner moves fast.

## The two poll loops

### Hop 2: the runner discovers request files

`services/runner/src/tools/relay.ts:322-400` (`startToolRelay`) is the runner-side loop.
Each iteration calls `host.list(relayDir)`, queues every unseen `*.req.json` (a `seen` set
at `relay.ts:332` dedups), then sleeps.

The cadence (`relay.ts:53-80`):

- `RELAY_POLL_MS` = 300 ms (`AGENTA_AGENT_TOOLS_RELAY_POLLING`).
- `RELAY_TIMEOUT_MS` = 60 s (`AGENTA_AGENT_TOOLS_RELAY_TIMEOUT`); enforced by the writer,
  not this loop.
- Idle backoff: after `RELAY_POLL_IDLE_GROW_AFTER` = 5 idle polls the delay doubles per
  idle poll up to `RELAY_POLL_MAX_MS` = 1500 ms (`relayPollDelayMs`, `relay.ts:76-80`).
  Any new request resets it to 300 ms.

Two host implementations (`relay.ts:182-220`):

- `localRelayHost` (`relay.ts:182`): `readdirSync`/`readFileSync`/`writeFileSync` on the
  runner's own filesystem.
- `sandboxRelayHost` (`relay.ts:197-220`): `list` is a remote `ls -1 <dir>` via
  `sandbox.runProcess` with a 10 s timeout; `read`/`write` are `readFsFile`/`writeFsFile`
  daemon calls. On Daytona the active-turn poll is therefore ~3 remote execs per second,
  settling to ~0.7 per second when idle.

The loop is wired per turn at `services/runner/src/engines/sandbox_agent.ts:1761-1773`:
Daytona gets `sandboxRelayHost(env.sandbox)`, local gets `localRelayHost()`. It stops at
turn end (`sandbox_agent.ts:1842`), on pause teardown (`:823`), and on run teardown
(`:1950-1951`). `plan.useToolRelay` is true whenever the run has tool specs
(`engines/sandbox_agent/run-plan.ts:449`).

### Hop 1: the writer waits for the response file

`services/runner/src/tools/dispatch.ts:62-107` (`relayToolCall`) is the in-sandbox writer.
It writes `<id>.req.json`, then loops: check `existsSync(resPath)`, sleep `RELAY_POLL_MS`
(300 ms, `dispatch.ts:104`), until `RELAY_TIMEOUT_MS` (or the tool's own `timeoutMs` plus
10 s). On success it deletes both files (`dispatch.ts:91-100`).

All writers reach this one function:

- Pi's in-sandbox extension registers each tool with an `execute` that calls
  `runResolvedTool(spec, params, { toolCallId, relayDir, signal })`
  (`services/runner/src/extensions/agenta.ts:341-345`), which routes to `relayToolCall`
  when `relayDir` is set (`dispatch.ts:133-158`).
- Local Claude's loopback MCP handler dispatches every non-client `tools/call` to the
  same `runResolvedTool` with the run's `relayDir` (`tools/tool-mcp-http.ts:210-212`),
  so local Claude is a relay writer today, not a future one.
- The future Claude MCP shim on Daytona is planned to use the same dispatch module
  (`dispatch.ts:1-21` documents this sharing). A hop 1 change inside the shared writer
  therefore covers all three automatically.

## Partial-file exposure today

Nothing in the current relay publishes atomically; polling delay is what hides the write
interval:

- The writer creates the final request path directly with `writeFileSync`
  (`dispatch.ts:73`).
- The runner adds a discovered filename to `seen` before reading it (`relay.ts:338`) and
  parses asynchronously (`relay.ts:380`), so a partial read would error once and never
  retry that request.
- The runner writes the final response path directly (`relay.ts:362`), and the writer
  parses the moment `existsSync` is true (`dispatch.ts:87`).

Under 300 ms polling these windows are rarely hit. Any event-driven wake makes them hot,
which is why the plan amends publication (plan.md decision 2).

## The relay directory is a local filesystem on both ends of hop 1

`run-plan.ts:384-391`: the relay dir is deliberately an ephemeral plain directory, never
the geesefs-mounted durable cwd. Locally it is `$TMPDIR/agenta/relay/<name>`; on Daytona
it is `/home/sandbox/agenta/relay/<name>` inside the VM. This matters for the design:
inotify (Node's `fs.watch`) is unreliable on FUSE and network filesystems, but the relay
dir avoids those by construction. So:

- Inside the sandbox, the writer can `fs.watch` the relay dir and get instant response
  wakeups.
- On the local backend, the runner shares that same filesystem, so it can `fs.watch` for
  requests too.
- Only the Daytona hop 2 (runner to remote VM) has no local filesystem to watch.

Two non-relay files share the relay namespace and will cause spurious watch events, both
harmless because the loop filters by suffix:

- `<relayDir>/.agenta-usage.json`, Pi's usage writeback (`run-plan.ts:442`).
- `<relayDir>.otlp-auth`, a sibling path outside the dir (`sandbox_agent.ts:714`).

Cleanup: `engines/sandbox_agent/workspace.ts:63-66` removes the relay dir (`rm -rf`) when
preparing the workspace, and the writer deletes each req/res pair after reading the
response.

## The Daytona daemon API facts the watch exec depends on

- `sandbox.runProcess` is one blocking HTTP request (`POST /v1/processes/run`) that
  returns when the command exits. The request body accepts `timeoutMs` and the response
  reports `timedOut` (sandbox-agent SDK,
  `node_modules/sandbox-agent/dist/index.d.ts:502-523`). The mount code relies on the
  same blocking behavior (`engines/sandbox_agent/mount.ts:561`).
- The daemon is reached through a signed Daytona preview URL. The preview proxy
  authenticates with a cookie captured by `createCookieFetch`
  (`engines/sandbox_agent/daytona.ts:169-204`).
- That fetch layers on `createAcpFetch` (`engines/sandbox_agent/acp-fetch.ts`): an undici
  dispatcher with 60-minute `headersTimeout`/`bodyTimeout` and 10-minute keep-alive,
  built precisely so a request held open for human-timescale approval pauses is not
  reaped. Held requests through the preview proxy are therefore already a proven,
  production-exercised pattern; the watch exec adds nothing new in kind.
- The daemon file API includes a move endpoint: `moveFs` / `post_v1_fs_move`
  (`node_modules/sandbox-agent/dist/index.d.ts:2103`, `:3253`). Whether it performs a
  `rename(2)`-atomic same-directory move is not documented; the atomic-publication
  amendment (plan.md decision 2) needs that verified, with a shell `mv` exec as the
  fallback implementation.
- Node is present in the sandbox image (Pi runs on it), so a node one-liner watch script
  needs no install. Custom snapshots without node need the poll fallback.
- The SDK also offers `createProcess` (start a background process) plus
  `followProcessLogs` (a streaming log subscription). This is the raw material for the
  persistent-watcher alternative that plan.md evaluates and does not pick.

## The ACP side channel (for the doorbell alternative)

ACP carries session and prompt traffic from the runner to the sandbox; the runner observes
every frame, and the wire has a generic `extNotification` method/params channel. Pi's
extension could emit a "check the relay dir" notification when it writes a request. Two
limits, both noted in
[../mcp-delivery-architecture/gateway-mcp-location.md](../mcp-delivery-architecture/gateway-mcp-location.md):
the notification rides the live ACP session, so it only exists while a Pi session is
streaming, and the Claude MCP shim is a separate process with no ACP session at all, so a
doorbell from it would require the daemon to grow a watch or notify feature.

## Latency and request-volume baseline (what we are fixing)

Per tool call today:

- Hop 2 pickup: 0 to 300 ms when the turn is active, up to 1500 ms after idle backoff
  (the first call of a quiet turn always eats backoff).
- Hop 1 response wait: 0 to 300 ms.
- Total added: roughly 0.3 s typical, up to 1.8 s worst case, per call, on top of tool
  execution. Both hops apply on local and on Daytona.

Per active Daytona turn today: one `ls` exec per poll, ~3/s active, ~0.7/s idle. A
60-second turn costs roughly 40 to 200 daemon requests just for polling, plus one read and
one write per actual tool call.
