# Research: the current code, the fallback model, Daytona billing

All line numbers are against the working tree at the time of writing (HEAD carries PR #5197
plus commit `60990d396e`). Treat them as pointers, not exact addresses.

## The turn lifecycle at HEAD

### Provider create flags (`provider.ts`)

`buildDaytonaCreate` returns, among the network and env fields:

```ts
autoStopInterval: daytonaAutoStopMinutes(),      // DEFAULT 5
autoArchiveInterval: daytonaAutoArchiveMinutes(), // DEFAULT 15
autoDeleteInterval: daytonaAutoDeleteMinutes(),   // DEFAULT 30
ephemeral: false,
```

The comment states the intent: "stop preserves the disk (warm), archive moves it to cold
storage, delete reaps it (dead). `ephemeral: false` so a stop parks rather than deletes; the
three intervals ... are the platform-run reapers. A leaked sandbox self-reaps via autoDelete
instead of ephemeral." So the "TTL sweeper for stopped sandboxes" that Tier 1 needs is already
delegated to Daytona's own idle intervals. Overrides are `DAYTONA_AUTOSTOP`,
`DAYTONA_AUTOARCHIVE`, `DAYTONA_AUTODELETE` (whole minutes, floor 1).

This is the exact opposite of the F-020 premise. F-020 was written against `ephemeral: true` and
a single 15-minute autostop.

### Turn-end teardown (`sandbox_agent.ts`, the `destroy` closure)

`environment.destroy` takes `opts?: { keepWarm?: boolean }`. The relevant branch:

```ts
// keepWarm pauses a remote sandbox (parked, resumable) instead of deleting it; falls back to destroy.
const parked =
  opts?.keepWarm && plan.isDaytona && environment.sandbox?.pauseSandbox
    ? await environment.sandbox.pauseSandbox().then(() => true).catch(() => false)
    : false;
if (!parked) await environment.sandbox?.destroySandbox().catch(() => {});
```

Order matters: the graceful `session/cancel` (`destroySession`) runs BEFORE this, then the park
or delete, then `dispose()`, then the durable-cwd unmount. So a parked sandbox has its harness
session cancelled and its host mount torn down; resume re-mounts and re-opens the session.

### Who requests keepWarm

`shouldPark` gates it:

```ts
if (signal?.aborted) return false;   // aborted run: destroy, do not park
if (clientGone?.()) return false;    // client disconnected mid-turn: destroy, do not park
if (!result.ok) return false;        // failed turn: teardown as today
if (result.stopReason === "paused") return false; // a plain pause never parks
return true;
```

Both run paths pass `keepWarm: env.resumable && result !== undefined && shouldPark(...)`, where
`env.resumable = Boolean(plan.isDaytona && sessionForMount)`. The two paths are
`runSandboxAgent` (the plain path) and the keep-alive `runCold` in `server.ts`. Net effect at
HEAD: a successful, non-aborted, non-paused Daytona chat turn that has a session id parks the
sandbox to stopped and records its id. A failed turn (which today includes every tool-using
Daytona turn, per F-018) does not park, so F-018 failures do not leak a warm sandbox.

### Reconnect (`sandbox-reconnect.ts` + acquire path)

At acquire, for a Daytona run with a session and a run credential:

```ts
const storedSandboxId = plan.isDaytona && sessionForMount && runCred
  ? await readStoredSandboxId(sessionForMount, { authorization: runCred, log })
  : undefined;
if (storedSandboxId) {
  try {
    environment.sandbox = await startSandboxAgent({ ...startOptions, sandboxId: storedSandboxId });
    log(`reconnected sandbox=${storedSandboxId} ...`);
  } catch (err) {
    log(`reconnect failed sandbox=${storedSandboxId}, creating fresh: ...`);
  }
}
if (!environment.sandbox) environment.sandbox = await startSandboxAgent(startOptions);
if (sessionForMount && runCred) {
  const liveSandboxId = environment.sandbox?.sandboxId ?? plan.sandboxId;
  void writeSandboxId(sessionForMount, liveSandboxId, { authorization: runCred, log });
}
```

The stored id lives in the sessions plane: `GET`/`PUT /sessions/states/?session_id=...` with a
`sandbox_id` field. Read failure, write failure, and reconnect failure are all best-effort and
degrade to a fresh create. This is the "dead rung" F-020 named, now reachable because the park
path keeps the sandbox alive for the stored id to resolve against.

Two caveats the review round surfaced. The `writeSandboxId` PUT is fire-and-forget (`void`) and
last-writer-wins, with no compare-and-set; a delayed older write can replace a newer sandbox id
when two turns race on one session. And the vendored `SandboxAgent.start({sandboxId})` cleans up
only sandboxes it created itself, so a reconnect that starts the old instance and then fails a
later step (daemon, URL, client) leaves it running while the ladder creates a second one.

### The vendored provider gap (the load-bearing finding)

The vendored Daytona provider (`node_modules/sandbox-agent/dist/providers/daytona.js`)
implements only `create`, `destroy`, `getUrl`, and `ensureServer`. The `SandboxProvider`
interface declares `pause?` and `reconnect?` as optional, and the e2b and sprites providers
implement them, but daytona does not. Verified consequences in `dist/chunk-TVCDKGSM.js`:

- `pauseSandbox()` with no `provider.pause` calls `provider.destroy(rawSandboxId)`. So the
  runner's keepWarm park deletes the sandbox anyway.
- `pauseSandbox()` clears `sandboxProvider` and the raw id in its `finally`, even when
  `provider.pause()` throws. The runner's fallback `destroySandbox()` then has no provider and
  silently no-ops, so a failed pause leaks a running sandbox.
- `start({sandboxId})` calls `provider.reconnect` then `ensureServer`; with `reconnect` missing
  (and `ensureServer` unable to start a stopped instance) reconnect always throws and falls to a
  fresh create.

So at HEAD, despite the keepWarm plumbing, every Daytona turn still deletes and recreates.
F-020's observed behavior stands; only its mechanism description is out of date.

### The sandbox-agent patch (`patches/sandbox-agent@0.4.2.patch`)

Commit `60990d396e` patches the vendored `sandbox-agent` package to add native session resume:

- `LiveAcpConnection.loadRemoteSession(...)` and a `loadSessionSupported` capability flag read
  from `initResult.agentCapabilities.loadSession`.
- `SandboxAgent`'s resume path now tries `loadRemoteSession` (ACP `session/load` with
  `_meta.claudeCode.options.resume`) when the agent advertises `loadSession` and a prior
  `agentSessionId` exists, and only falls back to `collectReplayEvents` + `createRemoteSession`
  (transcript replay) when load is unsupported or throws.
- The `local` provider spawns the daemon `detached: true` and kills by process group
  (`killGroup`), so a runner exit reaps the whole local tree instead of orphaning children.

This is the `harness-session-resume` "Half B: pnpm patch" bridge, landed. It matters here
because a reconnected (Tier 1) or pool-parked (Tier 2) sandbox now resumes the harness session
in place rather than replaying text, which is the high-fidelity rung.

## The three-tier fallback model (from the sibling workspaces)

The `session-keepalive` and `harness-session-resume` workspaces define a fallback ladder keyed
on the conversation `session_id`. This project extends its bottom two rungs to Daytona.

1. Live pool hit inside the TTL: keep-alive. Fastest, highest fidelity (the live process tree,
   native memory, byte-exact approval resume). Costs idle RAM locally, idle compute remotely.
   This is Tier 2 here.
2. Pool miss but the sandbox and harness session survive: session resume. The sandbox restarts
   from stopped and the harness runs `session/load`. Full fidelity, paid per turn as a restart
   plus mount plus load. Zero idle live cost when parked to stopped. This is Tier 1 here.
3. Both miss: cold replay. Always available, always correct, about 20 seconds. The floor.

The tiers compose. They do not replace each other. Tier 1 is memory across a stopped-sandbox
gap; Tier 2 is memory within a short live window. Durable continuity (PR #5197) is the machinery
that makes rungs 2 and 3 correct.

## The local keep-alive pool (`session-pool.ts`), and why it is local-only

The pool is a per-process `Map<poolKey, LiveSession>` with an LRU cap and TTL reaping. Key facts
that bear on extending it to Daytona:

- Pool key is `<projectId>:<sessionId>`. No project scope means no park (safety default).
- Two TTLs: idle `AGENTA_RUNNER_SESSION_TTL_MS` (default 60s), approval
  `AGENTA_RUNNER_SESSION_APPROVAL_TTL_MS` (default 300s). Cap `AGENTA_RUNNER_SESSION_POOL_MAX`
  (default 8). Flag `AGENTA_RUNNER_SESSION_KEEPALIVE` (default off).
- A `LiveSession` holds the live environment, a config fingerprint, a history fingerprint, a
  credential epoch, a state (`busy`/`idle`/`awaiting_approval`/`destroyed`), and one idempotent
  `destroy()` closure the engine supplies. The pool never imports the engine.
- Eviction routes every teardown through that one `destroy()`. LRU evicts only idle sessions;
  it never evicts a busy or approval-parked one; if nothing is evictable, the new session runs
  unparked (best-effort).
- The gate: `resolvesToLocalProvider(requestSandbox)` and `isLocalSandbox` in `server.ts`. The
  module comment is explicit that `poolMax` is a LOCAL parameter, "how many ~300 MB hot Claude
  trees fit on this runner host," never a global one.

The local-only rationale, measured on the Hetzner dev box: a parked Claude tree is about 330 MB
RSS (about 224 MB Pss) at near-zero idle CPU, so the cap is a RAM-budget knob. Remote is
different in kind. A parked Daytona sandbox is not host RAM; it is billed compute (Tier 2) or
billed storage (Tier 1). So the cap for a remote pool is a dollar cap, not a RAM cap, and it
needs its own reaper reasoning. This is why `session-keepalive` deferred Daytona to slice 3.

The credential epoch and the two fingerprints (config and history) carry over unchanged. A
parked session that outlives its mount credential or whose resolved secrets rotate evicts to
cold. On Daytona the mount-credential expiry is the tighter bound, so the epoch check is more
load-bearing there than locally.

## Daytona lifecycle and billing semantics

The five states the provider comment names, with billing as the provider comments and Daytona's
public docs describe them. Per the Daytona limits and billing pages, a stopped sandbox frees CPU
and RAM but keeps billing disk; billing tracks CPU, RAM, and disk usage. An archived sandbox
moves its filesystem to object storage and resumes via a plain `start()` (no separate restore
API), just slower, and archiving requires the sandbox to be stopped first. One more semantic
that matters: Daytona's inactivity clock for autoStop resets on external API interactions, not
on processes running inside the sandbox, so a long silent in-sandbox operation can be
auto-stopped mid-turn.

| State | How reached | Disk | Billing | Resume cost |
|---|---|---|---|---|
| Running (hot) | create, or start a stopped one | live | full compute | none, already up |
| Stopped (warm) | `pauseSandbox()` / autoStop after 5 min idle | retained | storage only, no compute | fast start (about 1s) + remount + session load |
| Archived (cold) | autoArchive after 15 min idle | moved to cold storage | cheaper cold storage | slower restore + remount + load |
| Deleted (dead) | autoDelete after 30 min idle, or `destroySandbox()` | gone | none | full cold create + mount + replay |

Tier 1 parks to Stopped: storage cost only, and the autoArchive then autoDelete cascade bounds
even that. Tier 2 parks to Running for a short TTL: the parked cost is live compute, so the TTL
is a direct billing knob, and the pool cap bounds the concurrent spend.

The orphan question. `ephemeral: true` used to auto-delete a sandbox the moment it stopped,
which is why it existed as a leak backstop: a crashed runner could not leave a sandbox billing
for long. `ephemeral: false` removes that reflex. The new backstop is the autoStop (5 min) to
autoArchive (15 min) to autoDelete (30 min) cascade plus the local-tree process-group kill from
the patch. So a SIGKILL'd runner now leaves a running Daytona sandbox billing compute until
autoStop stops it (up to 5 idle minutes of compute), then storage until autoDelete. That is a
larger orphan budget than `ephemeral: true` gave. Whether 5 minutes of orphaned compute is
acceptable is a decision for `plan.md` and a billing owner.

## PR #5197 (durable session continuity)

PR #5197 ("Resume agent sessions across the sandbox lifecycle", `feat/sessions-continuity`,
open, base `big-agents`) is the durable-continuity base this project builds on. What it ships:

- `session-continuity.ts`: an in-memory store mapping `(sessionId, harness)` to
  `{agentSessionId, turnIndex}`, with a staleness guard (a harness may `session/load` only if it
  authored the most recent completed turn) that makes Pi/Claude switching safe.
- `session-continuity-durable.ts`: mirrors that store into `session_states.data` (GET then PUT,
  fire and forget) so a runner restart does not lose continuity. Its own risk list flags that
  this write path has no concurrency guard and can drop a harness entry under concurrent
  writers; the failure mode is a silent cold replay.
- `sandbox-reconnect.ts`: `session_states.sandbox_id` changes meaning from a display label
  ("local") to the actual Daytona instance id.
- Per-harness transcript mounts: `~/.claude/projects` and Pi's sessions dir get the same durable
  geesefs treatment as the session cwd (credentials deliberately excluded), so even a dead
  sandbox can `session/load` natively. `AGENTA_SESSION_HARNESS_MOUNTS=false` disables this.
- The detached-geesefs mount rewrite (fixes F-017's 60-second stream death), heartbeat ownership
  via an atomic Redis claim, and the `sandbox-agent@0.4.2` dist patch described above.
- An API-side `orphan_sweep.py` task. Important scope fact, verified in the review round: it
  only cleans Postgres rows and Redis locks. It never contacts the runner or Daytona and cannot
  stop or delete a sandbox. It is not a provider-side leak sweeper.

Its own risk list also names: a failed turn parking its sandbox warm (HEAD's `shouldPark` now
gates this), the 5-minute autoStop versus long HITL waits, legacy `sandbox_id` label values
causing one doomed reconnect, and deploy order (API before runner).

## Interaction with F-018 (Daytona tool-call hang)

F-018: every sandbox-executed tool call on Daytona hangs because the Pi builtin gate's reverse
permission RPC never reaches the runner; the turn is bounded at 300s by the run-limits guard and
then fails. Consequence for this project: a tool-using Daytona turn fails, and a failed turn does
not park (`shouldPark` returns false on `!result.ok`). So warmth benefits chat first. It also
means Tier 1 and Tier 2 cannot be fully validated on tool turns until F-018 lands. The build-kit
default agent, whose first turn is a tool call, gets no benefit until then.
