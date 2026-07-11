# Engine review: `engines/sandbox_agent` (runner) — 2026-07-05

Deep read-only review of the sandbox_agent engine subsystem (~3.5k lines) ahead of the
production launch. Scope: `services/runner/src/engines/sandbox_agent.ts`, everything under
`services/runner/src/engines/sandbox_agent/`, `engines/skills.ts`, their unit tests, and
the `sandbox-agent` npm surface as used. Adjacent modules (`server.ts`, `tools/relay.ts`,
`tools/dispatch.ts`, `sessions/*`) were read where the engine's control flow crosses into
them.

All file:line references are against the working tree on 2026-07-05.

---

## 1. How a run actually flows (verified)

### local + pi (the default cell)

1. `runSandboxAgent` (`sandbox_agent.ts:317`) — if the request is session-owned and
   carries a run credential, it first POSTs `/sessions/mounts/sign` (`mount.ts:54`) and
   derives a **durable cwd** `/tmp/agenta/mounts/<project>/<mount>` from the returned
   prefix (`sandbox_agent.ts:344-352`). Best-effort: a 503/failed sign means ephemeral cwd.
2. `buildRunPlan` (`run-plan.ts:238`) — pure derivation: harness→ACP agent mapping
   (`pi_core`/`pi_agenta`→`pi`), fail-loud gates (filesystem policy, local network policy,
   code tools, Pi user-MCP, stdio MCP, non-Pi remote tools, strict-network + executable
   tools), cwd creation (`mkdtemp` or the durable dir), relay dir
   (`/tmp/agenta/relay/<basename(cwd)>`), skill materialization (`skills.ts:115`).
3. Daemon env is built clear-then-apply (`daemon.ts:132`), `plan.secrets` applied, Claude
   connection env if applicable, Pi extension env (traceparent, OTLP, public tool specs,
   relay dir, usage path, builtin gating) (`pi-assets.ts:33`).
4. `prepareLocalPiAssets` (`pi-assets.ts:229`) — skills or system prompt present → a
   throwaway agent dir seeded with `auth.json`/`settings.json` + extension + skills, and
   `env.PI_CODING_AGENT_DIR` repointed at it; otherwise the extension is installed into
   `process.env.PI_CODING_AGENT_DIR` **only if that env var is set**.
5. `SandboxAgent.start` with the `local()` provider — spawns a **fresh
   `sandbox-agent server` daemon per run** on a free loopback port, custom long-timeout
   undici fetch (`acp-fetch.ts:48`), the caller's abort signal, in-memory persist. Handle
   registered in `inFlightSandboxes` for the SIGTERM sweeper.
6. Durable cwd geesefs-mounted on-host **before** workspace materialization
   (`sandbox_agent.ts:544-548`), with a stale-ENOTCONN detection + one re-sign/remount
   retry, plus a runtime remount trigger scanning every ACP event for ENOTCONN
   (`sandbox_agent.ts:479-491`).
7. `prepareWorkspace` (`workspace.ts:43`) writes `AGENTS.md` (or `CLAUDE.md` for claude),
   `harnessFiles`, relay dir, and non-Pi project-local skills into the cwd.
8. Capability probe (`capabilities.ts:120`) + `assertRequiredCapabilities` (non-Pi + tools
   + no `mcpTools`/`toolCalls` → refuse). `buildSessionMcpServers` (`mcp.ts:218`) — for Pi
   returns `[]` (tools ride the extension); for local Claude starts the loopback HTTP MCP
   server on port 0.
9. `createSession({agent, cwd, mcpServers})`, `applyModel` (exact → suffix-match →
   harness default; `strict` throws for pinned Claude deployments), otel run created from
   the resolved model, `session.onEvent` wired into the otel state machine with
   paused-tool-call frame suppression.
10. Permission plumbing: ACP reverse-RPC responder (`acp-interactions.ts:39`) for
    harness-raised gates (Claude), the file-relay permission protocol for Pi builtins, the
    shared client-tool relay (`client-tools.ts:196`). One pause per turn
    (`PendingApprovalLatch`); a pause destroys the session, never replies to the gate
    (F-024/F-040), and resolves `pause.signal`.
11. If the plan has tools or builtin gating, `startToolRelay` (`relay.ts:399`) polls the
    relay dir; Pi's extension writes `<id>.req.json`, the runner executes the private spec
    (gateway `/tools/call`, direct call, or client-tool pause) and writes `<id>.res.json`.
12. `session.prompt([...])` raced against `pause.signal`. Paused → `stopReason:"paused"`,
    result undefined. Usage resolved (Pi usage file → prompt/stream merge), swallowed Pi
    error peeked from Pi's transcript on empty output, trace finished + flushed, result
    returned.
13. `finally`: await runtime remount, deregister handle, stop relay, abort loopback MCP
    calls, close MCP server, `destroySandbox()` (kills the daemon), `dispose()`, unmount
    durable cwd, `workspace.cleanup()` (recursive rm of cwd), remove throwaway agent dir,
    remove skills temp root.

### daytona + claude

Differences: `buildSandboxProvider` returns `daytona({create})` with snapshot/target,
network policy fields, `envVars` (extension env + secrets), `ephemeral: true` +
`autoStopInterval ≥ 1` as the leak backstop (`provider.ts:75-99`). The SDK creates the
sandbox and starts the daemon inside it; ACP HTTP goes through the Daytona preview proxy
with a per-host cookie jar fetch (`daytona.ts:152`). `prepareDaytonaPiAssets` is a no-op
for Claude. Workspace files are written through the sandbox FS API. Tools are refused
up-front (`REMOTE_TOOLS_UNSUPPORTED_MESSAGE`, `run-plan.ts:355-357`) because the loopback
MCP channel is unreachable from inside the sandbox and only Pi's extension writes the file
relay. `CLAUDE.md` is the instructions filename. Session-owned runs additionally discover
the ngrok tunnel and geesefs-mount the store prefix **inside** the sandbox — but only
*after* the workspace was materialized (see finding 2). Teardown deletes the Daytona
sandbox; a killed process is covered by the signal sweeper and, failing that, by
auto-stop + ephemeral delete.

The `agenta` harness is `pi_agenta`: same `pi` ACP agent, but forced `_agenta.*` skills
always arrive on the request, so it always takes the throwaway-agent-dir path — which
matters for finding 6.

---

## 2. Strengths — keep this

- **Fail-loud gate discipline.** `run-plan.ts` refuses every capability the runner cannot
  actually deliver (code tools, stdio MCP, Pi user-MCP, non-Pi remote tools, unenforceable
  network/filesystem policy) with named-constant messages, *before* any resource is
  created. The capability gate (`assertRequiredCapabilities`) extends this to probed
  capabilities. This is the single best property of the subsystem — protect it.
- **Layered leak backstops.** Per-run `finally` → `inFlightSandboxes` + SIGTERM handler
  (`server.ts:378`) → Daytona `ephemeral + autoStopInterval` server-side self-reap
  (`provider.ts:41-99`). Each layer documents which failure mode the next one covers.
- **Clear-then-apply credential env** (`daemon.ts:73-159`): the managed-run daemon
  inherits zero provider keys; the clear set is deliberately a superset of the apply set.
- **DI seams everywhere.** `SandboxAgentDeps` lets the 1100-line orchestration test drive
  the whole engine with fakes; pure helpers (`run-plan`, `capabilities`, `model`, `usage`,
  `skills`, `mount`) are directly unit-tested. 20+ test files cover the subsystem.
- **Comments carry rationale and finding IDs** (F-024, F-040, F1, S1b, Security rule 5/6).
  A new reader can reconstruct *why* every odd branch exists. Rare and valuable.
- **Careful pause semantics**: one latch per turn, no harness reply on pause, paused-id
  frame suppression, prompt-vs-pause race with orphan-rejection swallowing.
- **Wire-boundary re-validation** in `skills.ts` (name slug, path traversal, SKILL.md
  clobber, exec default-deny) and the SSRF guard in `mcp.ts`.

---

## 3. Findings

Severity: blocker / high / medium / low. Horizon: short (before/at launch), medium
(1-2 months), long (structural).

### F1 — BLOCKER: no run deadline anywhere; a hung harness leaks everything, forever

- **Where:** `sandbox_agent.ts:858-871` (the prompt race has only two exits: resolve or
  pause), `acp-fetch.ts:32-41` (`headersTimeout`/`bodyTimeout` default **0** = disabled),
  `server.ts:204-213` (session-owned runs deliberately do NOT abort on client disconnect).
- **What:** `session.prompt()` has no timeout, and the HITL fix disabled the only
  transport-level timeouts. For a session-owned run there is no abort path at all: the
  client disconnecting does nothing, and nothing else ever fires.
- **Failure scenario:** a provider outage / pi-acp adapter wedge / Daytona proxy stall
  makes the prompt never resolve. The `finally` never runs → the local daemon (or Daytona
  sandbox, kept non-idle by the open connection) lives forever, the geesefs mount stays
  held, the HTTP response is held open, and the alive watchdog **keeps heartbeating the
  session lock indefinitely** (`server.ts:236`, released only in the handler's `finally`)
  — so the platform believes the session is live and healthy while it is wedged. Under
  load, N wedged runs = N leaked daemons + N held sockets on a single-process Node server.
- **Recommendation (short):** add a configurable overall run deadline (env, generous
  default e.g. 30-60 min; HITL pauses already end the turn so they don't need the
  connection held). Race it alongside `pause.signal`, treat expiry as
  `{ok:false, error:"run timed out after ..."}`, and let the existing `finally` reclaim
  everything. Consider a separate, shorter first-event/health deadline (daemon up but
  harness never responds).

### F2 — HIGH: Daytona durable-cwd mount happens AFTER workspace materialization, hiding AGENTS.md / CLAUDE.md / harnessFiles / skills

- **Where:** `sandbox_agent.ts:550-574` (`prepareWorkspace` writes into `plan.cwd`) runs
  before `sandbox_agent.ts:576-599` (`mountStorageRemote` geesefs-mounts *the same*
  `plan.cwd` inside the sandbox). The local path explicitly does the opposite, with a
  comment explaining why (`sandbox_agent.ts:544-548`: "Mount before local workspace
  materialization so AGENTS.md, harness files, and skills land in the durable prefix
  instead of being hidden under the later FUSE mount").
- **What:** on a session-owned Daytona run with the store tunnel up, the instructions
  file, the harness config files, and the non-Pi skill tree are written into the plain
  directory, then the FUSE mount shadows them for the whole run. `harnessFiles` includes
  the rendered `.claude/settings.json` **permissions** for Claude — so the Layer-1
  permission config silently does not apply. (If geesefs instead refuses the non-empty
  mountpoint, the failure inverts: the durable cwd silently doesn't attach.)
- **Failure scenario:** daytona + claude + session: the agent runs with no instructions
  and no authored permission rules; nothing errors.
- **Recommendation (short):** move the remote mount above `prepareWorkspace`, mirroring
  the local ordering (the local block already sits above it; hoist the daytona block to
  the same spot). Add an orchestration test asserting call order for the daytona path.

### F3 — HIGH: stale relay request files are re-executed on the next turn of a durable session (duplicate side effects, stolen client-tool outputs)

- **Where:** `run-plan.ts:388-391` (`relayDir = <base>/relay/<basename(cwd)>` — constant
  across turns for a durable cwd), `relay.ts:465-487` (the loop's `seen` set is per-run;
  any `.req.json` not seen this run is executed), `tools/dispatch.ts:66-108` (the
  extension unlinks req/res only after a response arrives — a paused or torn-down call
  leaves its `.req.json` behind). No code ever removes `relayDir` (grep confirms: no
  cleanup site).
- **What:** turn N pauses on a client tool (or the daemon dies mid-call, or the extension
  times out) → `<id>.req.json` stays on disk. Turn N+1 of the same session reuses the same
  `relayDir`, and the fresh relay loop re-executes the stale request.
- **Failure scenarios:**
  - A *gateway* tool req is replayed → a second `POST /tools/call` → the external action
    (send email, create ticket) executes twice.
  - A stale *client* tool req calls `onClientTool({consume:true})` and can consume the
    stored browser output intended for the harness's re-raised call — the real call then
    finds nothing, pauses again, and the session ping-pongs.
  - `usageOutPath` (`run-plan.ts:442`, same dir) is never deleted after reading
    (`usage.ts:6-26`), so a turn where Pi fails to write reports the *previous* turn's
    usage as its own.
- **Recommendation (short):** clear the relay dir (or at minimum all `*.req.json` /
  `*.res.json` / the usage file) at run start before `startToolRelay`, and/or make the
  relay dir per-turn (`<basename(cwd)>-<turnId>`) with best-effort removal in the
  `finally`. Also fixes the unbounded `/tmp/agenta/relay` accumulation.

### F4 — HIGH: `rmSync(cwd, recursive)` after a *best-effort* unmount can delete durable store data through a live FUSE mount

- **Where:** `sandbox_agent.ts:961-967`: `unmountStorage(mountedCwd)` (best-effort,
  swallows failure) is immediately followed by `workspace.cleanup()` →
  `rmSync(plan.cwd, {recursive, force})` (`workspace.ts:112-115`, and the pre-init
  fallback at `sandbox_agent.ts:492-496`). `unmountStorage` itself logs — and proceeds
  past — the case where the mountpoint is *still present after detach*
  (`mount.ts:294-302`).
- **What:** the rm is unconditional; the unmount is not. If `fusermount -uz` fails
  (EPERM, binary missing, race) or the lazy detach hasn't landed, the recursive delete
  walks *through the mounted filesystem* and erases the session's objects in the store —
  the exact data the durable-cwd feature exists to preserve.
- **Failure scenario:** flaky fusermount on one host → every completed turn on that host
  silently wipes its session's durable files; users see their workspace reset each turn.
- **Recommendation (short):** make the rm conditional: after unmount, re-check
  `mountpoint -q` (the check already exists inside `unmountStorage`) and **skip** the
  recursive rm when the path is still a mountpoint (or when `mountedCwd` was set at all —
  the durable dir under `/tmp/agenta/mounts/...` is cheap to leave and is reused next
  turn anyway; only ephemeral `mkdtemp` cwds need rm).

### F5 — HIGH: unknown sandbox id silently falls back to LOCAL host execution

- **Where:** `provider.ts:119-129` (`if (sandboxId === "daytona") ... else local(...)`),
  `run-plan.ts:381-383` (`cwd = isDaytona ? ... : createLocalCwd(...)`). The fail-closed
  treatment exists only for the tools gate (`isRemoteSandbox`, `run-plan.ts:279-282`) —
  the comment even acknowledges the fall-through.
- **What:** a request with `sandbox: "e2b"` (or any typo/future provider) runs the
  harness **on the runner host** with `ok: true`, while the caller believes it bought
  sandbox isolation. That inverts the trust boundary the rest of the file works hard to
  fail-closed on (network policy, remote tools).
- **Recommendation (short):** whitelist sandbox ids in `buildRunPlan`
  (`local | daytona`) and refuse anything else with a named
  `SANDBOX_UNSUPPORTED_MESSAGE`, exactly like the other gates.

### F6 — HIGH: swallowed-Pi-error detection reads the wrong agent dir whenever skills or a system prompt are present — i.e. always, for the `agenta` harness

- **Where:** `sandbox_agent.ts:897-903` passes `plan.sourcePiAgentDir` to
  `findSwallowedPiError`; `run-plan.ts:453-454` sets it from
  `process.env.PI_CODING_AGENT_DIR`; but `prepareLocalPiAssets` (`pi-assets.ts:236-251`)
  repoints the **daemon's** `PI_CODING_AGENT_DIR` at the throwaway per-run dir whenever
  skills or a system prompt exist — so Pi writes its session transcript under
  `<runAgentDir>/sessions`, and the scan looks in the untouched source dir.
- **What:** the F-030 "silent No response" fix is dead for exactly those runs: a provider
  failure (bad key, out of quota) returns `ok:true` with empty output again. `pi_agenta`
  always ships forced skills, so the whole agenta harness is unprotected. Worse, on a
  durable cwd the scan can match an *older* transcript for the same cwd and attribute a
  previous turn's error to this turn.
- **Recommendation (short):** carry the *effective* agent dir on the plan (or return it
  from `prepareLocalPiAssets` and pass it to the scan): `runAgentDir ?? plan.sourcePiAgentDir`.
  One-line-ish fix; add a test with skills present.

### F7 — HIGH: no per-session concurrency guard in the runner; a second concurrent turn shares the durable cwd and relay dir with the first, and the first finisher tears both down

- **Where:** the durable cwd is keyed only by the sign prefix (`sandbox_agent.ts:344-352`);
  `mountStorage` is idempotent ("already mounted" short-circuit, `mount.ts:212-215`); the
  `finally` unmounts + rm's unconditionally (`sandbox_agent.ts:961-967`); relayDir shares
  the same key (F3). Nothing runner-side rejects a second in-flight run for the same
  `sessionId` (the alive watchdog *heartbeats* the lock but never checks ownership before
  running).
- **Failure scenario:** the coordination plane's turn lock is the only guard; any path
  around it (retry after a timeout the runner didn't observe, a direct API caller, a
  replica split-brain) means run B's cwd is lazily unmounted and recursively deleted
  under it mid-prompt by run A's `finally`, and both relay loops consume each other's
  req files.
- **Recommendation (short/medium):** an in-process `Map<sessionId, Promise>` mutex (cheap,
  single-replica correct today since affinity routing pins a session to a replica) that
  either queues or refuses a concurrent same-session run with a clear error. Reference-count
  or key the mount per turn if true concurrency is ever wanted.

### F8 — HIGH (config-dependent): production compose never sets `PI_CODING_AGENT_DIR`, so a plain local Pi run (no skills, no system prompt) silently loses the extension — tracing, usage capture, builtin gating, and tool delivery

- **Where:** `pi-assets.ts:254-257` (`if (process.env.PI_CODING_AGENT_DIR)
  installPiExtensionLocal(...)` — else nothing); the gh compose sets no such env
  (`hosting/docker-compose/ee/docker-compose.gh.yml:266-289`), only the dev compose does
  (`.../docker-compose.dev.yml:404`).
- **What:** without the env, the extension is never installed into the default
  `~/.pi/agent`, and Pi loads nothing: no OTel self-instrumentation, no usage file, no
  native tool registration (the relay loop polls a dir nobody writes → tools advertised
  in the plan are silently never callable), no builtin gating enforcement
  (`AGENTA_AGENT_BUILTIN_GATING` env is set but the enforcing extension is absent).
  A run *with* a system prompt or skills takes the throwaway-dir path and works — so the
  degradation is intermittent per-request, the worst kind.
- **Recommendation (short):** set `PI_CODING_AGENT_DIR` in the gh compose (as dev does),
  AND make the code fail loud: if `plan.isPi && (plan.useToolRelay || tracing wanted)` and
  no agent dir is configured, either always use a throwaway dir (cheap; it already exists
  for the skills path) or refuse the run. Silent-drop is exactly what the rest of
  `run-plan.ts` was built to prevent.

### F9 — MEDIUM: Claude runs silently drop `systemPrompt` / `appendSystemPrompt`

- **Where:** `run-plan.ts:403-408` — both are gated `isPi ? ... : undefined`; no refusal,
  no log for the non-Pi case.
- **What:** a request that sets a system prompt on a claude run gets `ok:true` with the
  prompt ignored — the F-032-class silent drop the codebase elsewhere refuses loudly. (If
  the Python adapter renders it into `harnessFiles`/CLAUDE.md, then the runner-side field
  is dead for claude and should be *refused* when present, to keep one source of truth.)
- **Recommendation (short):** either deliver (Claude Agent SDK supports
  append-system-prompt via its options; could ride `harnessFiles`) or gate with a
  `SYSTEM_PROMPT_UNSUPPORTED_MESSAGE` like the other unsupported combinations.

### F10 — MEDIUM: durable-cwd sandbox detection duplicates — and disagrees with — `buildRunPlan`

- **Where:** `sandbox_agent.ts:345-348` uses
  `request.sandbox ?? process.env.SANDBOX_AGENT_PROVIDER ?? "local"`, while
  `buildRunPlan` uses `request.sandbox || deps.sandboxProvider || "local"`
  (`run-plan.ts:250`). Two drifts: `??` vs `||` (an empty-string `sandbox` picks the
  local durable path while the plan goes daytona), and the engine ignores the injected
  `deps.sandboxProvider` (tests / embedders that inject it get a mis-derived durable cwd).
- **Failure scenario:** `SANDBOX_AGENT_PROVIDER=daytona` + `sandbox:""` → durableCwd is
  `/tmp/agenta/...` (a host path) handed to `createDaytonaCwd` as the *in-sandbox* cwd.
- **Recommendation (short):** derive "is daytona" once. Either sign after `buildRunPlan`
  with a plan-provided flag (the sign inputs don't need the plan; only the *derivation*
  does), or extract one `resolveSandboxId(request, deps)` used by both.

### F11 — MEDIUM: `process.env.AGENTA_API_URL` is mutated from request data

- **Where:** `server.ts:229-232` — the first session-owned request whose OTLP endpoint
  parses sets a process-global env var used by `apiBase()` for *all* subsequent
  heartbeats/persists/mount-signs.
- **What:** first-request-wins global state; a request with a wrong/malicious endpoint
  poisons every later run's API base (until restart) when `AGENTA_API_INTERNAL_URL` is
  unset. Also a hidden ordering dependency that will confound debugging.
- **Recommendation (short):** thread the per-request api base explicitly (the mount code
  already takes `apiBase` as a dep) instead of writing env; require
  `AGENTA_API_INTERNAL_URL` in deployment.

### F12 — MEDIUM: error surfacing loses fidelity — two-pattern taxonomy, first-line truncation, and raw `err.stack` on the transport catch

- **Where:** `errors.ts:39-54` (only insufficient-credit and auth patterns; everything
  else is `raw.split("\n")[0]`), `server.ts:263-265` and `server.ts:352-354` (engine
  *throws* — which should be impossible but are the ones you most need context for —
  return the full JS stack to the platform user).
- **What:** the platform shows these strings to users. "fetch failed" (the most common
  daemon/proxy failure) reaches users verbatim with zero actionable content; rate-limit,
  model-not-found, and network classes all collapse to their first line; meanwhile the
  transport catch leaks internals (paths, module names).
- **Recommendation (short):** wrap results in a small error envelope
  `{kind, message, detail?}` with a few more recognized classes (rate limit, model not
  found, sandbox create failed, daemon unreachable, timeout — pairs with F1); log the full
  error server-side, return the classified line; never return `err.stack` on the HTTP
  edge. (medium): move classification next to the wire contract so the Python side can
  branch on `kind`.

### F13 — MEDIUM: per-run Daytona `npm install` of the Pi CLI (default ON)

- **Where:** `daytona.ts:50-70`, `DAYTONA_PI_INSTALL` defaults true; gh compose sets
  `AGENTA_AGENT_SANDBOX_PI_INSTALLED: false` → wait, it sets the *env* default `false`
  which makes `DAYTONA_PI_INSTALL = process.env... !== "false"` → install **disabled** in
  gh. The dev default (`true`) still pays up to 180 s of npm registry time per run, and a
  registry hiccup is "best-effort logged" (`daytona.ts:67-69`) then the run proceeds and
  fails later with an opaque pi-acp spawn error.
- **Recommendation (medium):** bake `pi` into the snapshot everywhere (the memory-noted
  `agenta-sandbox-pi` snapshot already does); when install *is* enabled and fails, fail
  the run loudly instead of proceeding.

### F14 — MEDIUM: `containsTransportEndpointDisconnected` deep-walks every ACP event on the hot path

- **Where:** `sandbox_agent.ts:284-315` and its call inside `session.onEvent`
  (`sandbox_agent.ts:717-718`), active on every local mounted run.
- **What:** a full recursive traversal (every string, every array element) of every
  event — including large `agent_message_chunk` payloads — per event, for the life of the
  prompt, to find one ENOTCONN marker. O(total stream bytes) extra CPU on the
  single-threaded server; also a false-positive vector (a run whose *content* contains
  "ENOTCONN" triggers a remount).
- **Recommendation (medium):** only inspect the frames that can carry an error (e.g.
  `tool_call_update` error fields / adapter error notifications) or cap depth/size; the
  remount limit of 1 already bounds the damage, so precision matters more than recall.

### F15 — MEDIUM: managed runs still expose the host harness login (HOME / CLAUDE_CONFIG_DIR always inherited)

- **Where:** `daemon.ts:146-150` — `CLAUDE_CONFIG_DIR` and `HOME` are copied on every
  run, including `credentialMode === "env"`.
- **What:** clear-then-apply scrubs env keys, but a local Claude harness whose resolved
  key is rejected can silently fall back to the sidecar's own OAuth login files —
  spending the operator's subscription and mislabeling billing, with nothing in the
  result revealing which credential actually authenticated. (Pi has the same shape:
  `PI_CODING_AGENT_DIR` seeded with the host `auth.json` even for managed runs,
  `pi-assets.ts:196-203`.)
- **Recommendation (medium):** on `credentialMode === "env"`, point HOME /
  CLAUDE_CONFIG_DIR / the Pi agent-dir seed at a login-less throwaway dir so a bad key
  fails loud as auth (which `errors.ts` already classifies) instead of falling back.

### F16 — MEDIUM: `finally` teardown is serial and unbounded against a slow Daytona API

- **Where:** `sandbox_agent.ts:952-972` — six sequential awaits; `destroySandbox()` has
  no timeout here (the *shutdown* sweep is bounded, the per-run path is not), and
  `toolRelay.stop()` waits for the current poll sleep + all in-flight tool executions.
- **What:** a slow Daytona delete (30-60 s under API degradation) holds the HTTP
  response and the event-loop slot for every finishing run; N finishing runs serialize
  their slowness onto the caller-visible latency.
- **Recommendation (medium):** send the terminal result *before* the heavy teardown
  (restructure so the result is computed, streamed, then cleanup runs detached with its
  own bounded timeout + the in-flight registry as backstop), or bound `destroySandbox`
  with a race + rely on autostop.

### F17 — MEDIUM: capability probe failure is indistinguishable from "capabilities absent", and the static fallback guesses generously

- **Where:** `capabilities.ts:120-134` — `catch {}` on `getAgent` collapses "daemon
  down", "agent unknown", and "no capabilities field" into the same static guess, which
  asserts `toolCalls: true, streamingDeltas: true, sessionLifecycle: true` for any
  harness.
- **What:** a daemon that is actually broken proceeds to `createSession` and fails there
  with a less specific error; a new harness gets optimistic defaults that re-enable the
  silent-drop class the gate exists to prevent (the gate only checks `mcpTools`+`toolCalls`,
  both guessed true for non-Pi).
- **Recommendation (medium):** log the probe error with its class; for an *unknown*
  harness id, prefer pessimistic static flags (`mcpTools:false`) so the tool gate
  fails closed on guesses, consistent with `isRemoteSandbox`'s fail-closed reasoning.

### F18 — LOW: README layout is stale (`engines/pi.ts` no longer exists; result example says `POST /run` only)

- **Where:** `services/runner/README.md:31,47` list `engines/pi.ts` as a live engine;
  `src/engines/` contains only `sandbox_agent`. `AGENTS.md` already says "one engine".
  Also `/stream` (the productized route, `server.ts:314-319`) is absent from the README.
- **Recommendation (short, cheap):** delete the pi-engine references, document `/stream`
  and `/kill`.

### F19 — LOW: `readBody` is unbounded; one giant body OOMs the single-process sidecar

- **Where:** `server.ts:285-291`. Trusted-network mitigates; a Content-Length cap
  (a few MB) is one line. Horizon: short.

### F20 — LOW: `pickModel` suffix matching can silently select a different provider's model

- **Where:** `model.ts:7-16` — `wanted "openai/gpt-x"` matches `"azureopenai/gpt-x"` by
  suffix. The resolved id is at least returned/logged/stamped on the span. Horizon: medium
  (tighten to same-provider suffix match, or log the cross-provider hop).

### F21 — LOW: `buildRunPlan` creates the cwd before its own trailing asserts, leaking a temp dir on an invariant trip

- **Where:** `run-plan.ts:381` (cwd) vs `run-plan.ts:413-421` (asserts) — also
  `resolveSkillDirs` at 396 leaks its temp root if a later assert throws (the cleanup
  only rides the returned plan). Invariants "should never fire", so low. Horizon: medium
  (order asserts before resource creation).

### F22 — LOW: `uploadDirToSandbox` reads every file as UTF-8

- **Where:** `pi-assets.ts:304-307` — a binary asset in a skill (image, wasm) is
  corrupted on upload. Wire skills are strings today, so latent. Horizon: medium (read
  Buffer, pass bytes; `writeFsFile` accepts `BodyInit`).

### F23 — LOW: history replay is quadratic and truncates mid-message

- **Where:** `transcript.ts:69-81` — every turn re-sends the whole prior transcript as
  text (cold model: token cost grows O(n²) over a conversation) and `slice(-maxChars)`
  can cut a message mid-way, and the "Conversation so far:" framing is spoofable by
  message content (a user message containing "assistant:" lines). Known design
  trade-off; note for the session/persistence roadmap. Horizon: long.

### F24 — LOW: `KNOWN_PROVIDER_ENV_VARS` is a hand-synced list across three codebases

- **Where:** `daemon.ts:73-108` — the comment demands agreement with Python
  `_PROVIDER_ENV_VARS`, SDK `capabilities.py`, and `_CLOUD_SECRET_ENV_BY_DEPLOYMENT`,
  with no test pinning it. A new provider added on the Python side silently re-opens the
  inherited-credential leak for managed runs. Horizon: medium (a golden-fixture parity
  test like the wire contract's).

---

## 4. Structure and quality (the 973-line orchestrator)

**Verdict: the extraction into `sandbox_agent/*` modules is genuinely good; the residual
orchestrator is the remaining debt.**

- `runSandboxAgent` is one ~650-line function. The worst offender is the durable-cwd
  concern: `signMount` + derivation + `mountLocalDurableCwd` + `reSignAndRemountLocalCwd`
  + `remountLocalCwdAfterRuntimeEnotconn` + the remount-retry wrapper around
  `prepareWorkspace` + three `finally` steps ≈ 130 lines of closures interleaved with
  everything else (`sandbox_agent.ts:326-497, 544-599, 953-967`). Extract a
  `DurableCwdController` (mount/ensure/handleEvent/teardown) in `mount.ts`'s module and
  the function shrinks by a third *and* F2/F4/F10 become single-owner fixes. Horizon: medium.
- Sandbox branching is one honest seam (`plan.isDaytona`, 37 refs) and mostly lives in
  the right modules (mount local vs remote, workspace, mcp gate, relay host, usage read).
  Two leaks back into the orchestrator: the daytona-asset block and the mount-ordering
  divergence (F2). Acceptable.
- Harness branching: name-string checks are well-contained (7 sites, all funneled through
  `buildRunPlan`-derived facts: `acpAgent`, `isPi`, `instructionsFile`, `legacyHarnessApiKeyVar`).
  But `plan.isPi` appears ~34 times, encoding a *bundle* of facts (tool delivery =
  extension, self-tracing when local, usage via file, system-prompt support, relay
  permission enforcement, swallowed-error recovery). A third harness family (codex is on
  the roadmap) forces a re-audit of every `isPi`. Derive a `HarnessProfile`
  (`toolDelivery: "extension"|"mcp"`, `selfTraces`, `usageSource`, `supportsSystemPromptFiles`,
  `instructionsFile`, `permissionGate: "relay"|"acp"`) once in `buildRunPlan` and branch on
  named facts. Horizon: medium/long.
- Positional argument counts: `buildSandboxProvider(6)` (`provider.ts:111-118`),
  `startToolRelay(7)` (`relay.ts:399-407`) — Python-style positional bags in TS; convert
  to option objects before the signatures grow again. Horizon: medium.
- `sandbox: any`, `session: any`, `event: any` throughout, even though
  `sandbox-agent/dist/index.d.ts` fully types `SandboxAgent`/`Session`/`SessionEvent`.
  Adopting the SDK types (or a narrowed structural interface) would have flagged the
  event-shape guessing (`payload?.params?.update ?? payload?.update`) and will catch the
  next SDK upgrade drift at `tsc` time. Horizon: medium.
- Dead-ish: `plan.legacyHarnessApiKeyVar` is consumed only inside `buildRunPlan` to
  compute `hasApiKey` (and one test); it needn't ride the plan. `mcp.ts`'s
  `McpServerStdio` half of `McpServerEntry` is a permanently-throwing path kept for shape.
  Low.
- Tests: strong pure-helper and DI-orchestration coverage (~4.6k test lines). **Untested
  seams that the findings above live in:** the `finally` ordering with a mounted cwd,
  daytona workspace/mount ordering, relayDir reuse across two sequential runs, concurrent
  same-session runs, any timeout behavior, and the swallowed-error path with skills
  present. Each blocker/high fix above should land with one.

---

## 5. Top-10 priorities

1. **F1 (blocker, short):** overall run deadline + first-response deadline; wire into the
   prompt race so the existing `finally` reclaims resources.
2. **F4 (high, short):** never `rmSync` a cwd that is (or may still be) a live FUSE
   mount — condition the cleanup on the unmount verification.
3. **F3 (high, short):** clear/scope the relay dir per turn; delete the usage file after
   reading.
4. **F2 (high, short):** hoist the Daytona remote mount above `prepareWorkspace`, mirror
   the local ordering, add a call-order test.
5. **F6 (high, short):** point `findSwallowedPiError` at the effective (per-run) Pi agent
   dir — the `agenta` harness currently has zero swallowed-error protection.
6. **F5 (high, short):** whitelist sandbox ids; refuse unknown providers instead of
   silently executing on the host.
7. **F8 (high, short):** set `PI_CODING_AGENT_DIR` in gh compose AND make missing
   extension delivery fail loud (or always use the throwaway dir).
8. **F7 (high, short/medium):** in-process per-session mutex so concurrent turns can't
   tear down each other's mount/relay.
9. **F12 (medium, short):** error envelope with kind classification; stop returning
   `err.stack`; grow `conciseError` beyond two patterns.
10. **Structure (medium):** extract `DurableCwdController`; introduce `HarnessProfile`
    to collapse the `isPi` fact-bundle; adopt the SDK types; add lifecycle integration
    tests (mount ordering, relay reuse, teardown ordering).
