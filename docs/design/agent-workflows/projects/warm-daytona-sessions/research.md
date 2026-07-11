# Research: the current code, the fallback ladder, Daytona billing

This file is the evidence behind `context.md`. Read `context.md` first for the story; read this
when you want to see the code that proves it. It covers four things, in order: what happens in
the runner during one turn, the gap that defeats warm reuse, the local warm-reuse pool and why
it is kept off Daytona, and how Daytona bills a stopped sandbox.

All line references are against the working tree at the time of writing (HEAD carries PR #5197
plus commit `60990d396e`). Treat them as pointers, not exact addresses.

## What happens during one turn

### Create: the sandbox flags (`provider.ts`)

`buildDaytonaCreate` returns, among the network and env fields:

```ts
autoStopInterval: daytonaAutoStopMinutes(),      // DEFAULT 5
autoArchiveInterval: daytonaAutoArchiveMinutes(), // DEFAULT 15
autoDeleteInterval: daytonaAutoDeleteMinutes(),   // DEFAULT 30
ephemeral: false,
```

The code comment states the intent: stop preserves the disk (the sandbox is parked), archive
moves that disk to cheaper cold storage, delete reaps it. `ephemeral: false` is what makes a
stop park the sandbox rather than delete it. The three intervals are timers Daytona runs itself.
A sandbox that is left idle stops after 5 minutes, archives after 15, and deletes after 30, so
an abandoned sandbox reaps itself through `autoDelete` instead of through `ephemeral`. Operators
can override the three with `DAYTONA_AUTOSTOP`, `DAYTONA_AUTOARCHIVE`, and `DAYTONA_AUTODELETE`
(whole minutes, floor 1).

This is the opposite of the F-020 premise. F-020 was written against `ephemeral: true` and a
single 15-minute stop timer.

### Teardown: park or delete (`sandbox_agent.ts`, the `destroy` closure)

`environment.destroy` takes `opts?: { keepWarm?: boolean }`. The branch that matters:

```ts
// keepWarm pauses a remote sandbox (parked, resumable) instead of deleting it; falls back to destroy.
const parked =
  opts?.keepWarm && plan.isDaytona && environment.sandbox?.pauseSandbox
    ? await environment.sandbox.pauseSandbox().then(() => true).catch(() => false)
    : false;
if (!parked) await environment.sandbox?.destroySandbox().catch(() => {});
```

Order matters. The graceful session cancel (`destroySession`) runs before this, then the park or
delete, then `dispose()`, then the durable-storage unmount. So a parked sandbox has its harness
session cancelled and its host mount torn down. Resume re-mounts and re-opens the session.

### When the runner asks to park (`shouldPark`)

```ts
if (signal?.aborted) return false;   // aborted run: destroy, do not park
if (clientGone?.()) return false;    // client disconnected mid-turn: destroy, do not park
if (!result.ok) return false;        // failed turn: teardown as today
if (result.stopReason === "paused") return false; // a plain pause never parks
return true;
```

Both run paths pass `keepWarm: env.resumable && result !== undefined && shouldPark(...)`, where
`env.resumable = Boolean(plan.isDaytona && sessionForMount)`. The two paths are `runSandboxAgent`
(the plain path) and the keep-alive `runCold` in `server.ts`. In plain terms: a Daytona chat
turn that succeeds, is not aborted, is not a plain pause, and has a conversation id parks the
sandbox to stopped and records its id. A failed turn does not park. This matters because every
tool-using Daytona turn currently fails (see F-018 below), so those failures do not leave a warm
sandbox behind.

### Reconnect: restart the stored sandbox (`sandbox-reconnect.ts` plus the acquire path)

At the start of a Daytona run that has a conversation id and a run credential:

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
`sandbox_id` field. A failed read, a failed write, and a failed reconnect are all best-effort and
fall back to a fresh build. F-020 called this reconnect path a dead end because the sandbox was
always deleted before the next turn. With the park path keeping the sandbox alive, the stored id
now has something to resolve against, in principle.

Two problems with this code are worth flagging up front, because the plan addresses them:

- The `writeSandboxId` PUT is fire-and-forget (`void`) and last-writer-wins. It has no
  compare-and-set. If two turns race on one conversation, a delayed older write can replace a
  newer sandbox id.
- The vendored `SandboxAgent.start({sandboxId})` cleans up only sandboxes it created itself. So a
  reconnect that starts the old instance and then fails a later step (daemon, URL, or client
  setup) leaves it running while the runner builds a second one.

### The gap that defeats it all: the Daytona provider has no pause or reconnect

The vendored Daytona provider (`node_modules/sandbox-agent/dist/providers/daytona.js`) implements
only `create`, `destroy`, `getUrl`, and `ensureServer`. The provider interface declares `pause?`
and `reconnect?` as optional. The e2b and sprites providers implement them; the Daytona provider
does not. The consequences, verified in the vendored `dist/chunk-TVCDKGSM.js`:

- `pauseSandbox()` with no `provider.pause` calls `provider.destroy(rawSandboxId)`. So the
  runner's `keepWarm` park deletes the sandbox anyway.
- `pauseSandbox()` clears the provider handle and the raw id in its `finally` block, even when
  `provider.pause()` throws. The runner's fallback `destroySandbox()` then has no provider to work
  with and silently does nothing. A failed pause therefore leaks a running sandbox.
- `start({sandboxId})` calls `provider.reconnect` and then `ensureServer`. With `reconnect`
  missing (and `ensureServer` unable to start a stopped instance), reconnect always throws and
  falls to a fresh build.

So at HEAD, despite all the `keepWarm` plumbing, every Daytona turn still deletes and rebuilds.
F-020's observed behavior stands; only its explanation is out of date. This is the finding the
whole plan turns on.

### The session-reload patch (`patches/sandbox-agent@0.4.2.patch`)

Commit `60990d396e` patches the vendored `sandbox-agent` package to add native session reload:

- A `loadRemoteSession(...)` call and a capability flag read from
  `initResult.agentCapabilities.loadSession`.
- The resume path now tries `loadRemoteSession` (the harness's native "reload this session" call)
  when the agent advertises `loadSession` and a prior session id exists. It falls back to
  transcript replay only when reload is unsupported or throws.
- The local provider now spawns its daemon detached and kills it by process group, so a runner
  exit reaps the whole local process tree instead of orphaning children.

This is the durable-continuity bridge (`harness-session-resume`), already landed. It matters here
because a restarted sandbox now reloads the harness session in place rather than replaying text,
which is the highest-fidelity way to resume.

## The fallback ladder: three levels of reuse

The `session-keepalive` and `harness-session-resume` workspaces define a fallback ladder keyed on
the conversation id. This project builds out the bottom two levels for Daytona. From fastest to
slowest:

1. **Live-warm.** The sandbox is still running from the last turn, inside a short time window.
   Fastest, highest fidelity: the live process tree, native memory, byte-exact approval resume.
   The cost is idle RAM locally, idle billed compute remotely. This is what the **park-to-running**
   proposal builds.
2. **Stopped-restart.** The sandbox was stopped but its disk survived. The runner restarts it and
   the harness runs its native session reload. Full fidelity, paid per turn as a restart plus
   mount plus reload. Zero idle compute cost while parked. This is what the **park-to-stopped**
   proposal builds.
3. **Cold rebuild.** Neither survived. The runner builds a fresh sandbox and replays the
   transcript. Always available, always correct, about twenty seconds. This is today's floor and
   stays the floor.

The levels compose; they do not replace each other. Park-to-stopped gives memory across a
stopped-sandbox gap. Park-to-running gives memory within a short live window. Durable continuity
(PR #5197) is the machinery that keeps levels 2 and 3 correct.

## The local keep-alive pool, and why it is kept off Daytona

Local (non-Daytona) sessions already get warm reuse from an in-memory pool (`session-pool.ts`).
It is a per-process map from a pool key to a live session, with a size cap and idle reaping. The
facts that bear on extending it to Daytona:

- The pool key is `<projectId>:<sessionId>`. Without a project scope there is no parking, which is
  the safe default.
- Two idle timers: a plain idle time-to-live (`AGENTA_RUNNER_SESSION_TTL_MS`, default 60s) and an
  approval-wait time-to-live (`AGENTA_RUNNER_SESSION_APPROVAL_TTL_MS`, default 300s). A size cap
  (`AGENTA_RUNNER_SESSION_POOL_MAX`, default 8). An on/off flag
  (`AGENTA_RUNNER_SESSION_KEEPALIVE`, default off).
- Each pooled session holds the live environment, a config fingerprint, a history fingerprint, a
  credential epoch, a state (busy, idle, awaiting approval, or destroyed), and one idempotent
  `destroy()` closure supplied by the engine. The pool never imports the engine.
- Eviction routes every teardown through that one `destroy()`. The size cap evicts only idle
  sessions, never a busy or approval-parked one. If nothing can be evicted, the new session runs
  unparked (best-effort).
- The gate that keeps this local: `resolvesToLocalProvider(requestSandbox)` and `isLocalSandbox`
  in `server.ts`. The module comment is explicit that the size cap is a local measure, "how many
  ~300 MB hot Claude trees fit on this runner host," never a global one.

The reason it is local-only is cost, measured on the Hetzner dev box. A parked Claude tree is
about 330 MB of memory at near-zero idle CPU, so the cap is a memory-budget knob. Remote is
different in kind. A parked Daytona sandbox is not host memory; it is either billed compute (if
kept running) or billed storage (if stopped). So a remote pool's cap is a dollar cap, not a
memory cap, and it needs its own reaping logic. This is exactly why `session-keepalive` deferred
Daytona to a later slice, which is this project's park-to-running level.

The credential epoch and the two fingerprints carry over unchanged. A parked session that
outlives its mount credential, or whose resolved secrets rotate, is evicted to cold. On Daytona
the mount-credential expiry is the tighter bound, so that check matters more there than locally.

## Daytona lifecycle and billing: measured numbers (2026-07-11)

A Daytona sandbox moves through four states: running, stopped, archived, deleted. A stopped
sandbox keeps its disk but loses all process memory; Daytona's docs are explicit that stopping a
container sandbox kills its processes and clears memory, and there is no CRIU-style memory freeze
for the container class (only Daytona's separate VM sandbox class has pause/resume with memory,
and we do not use it). An archived sandbox has its filesystem moved to object storage and resumes
via a plain `start()`, just more slowly; it must be stopped before it can be archived. One more
rule matters: Daytona's idle clock for the stop timer resets on external API calls, not on
processes running inside the sandbox. So a long, silent, in-sandbox operation can be auto-stopped
mid-turn.

On 2026-07-11 we measured the lifecycle directly against the Daytona API (SDK 0.187.0, snapshot
`agenta-sandbox-pi`, target `eu`, two repetitions; every sandbox created was deleted, with zero
sandboxes in the organization before and after). "Usable" means a trivial `echo` exec succeeds
through the Daytona API; the measurement deliberately does not start our daemon, upload assets,
mount storage, or load a harness, so it isolates the sandbox lifecycle from our pipeline. The
sandbox provisions 2 vCPU, 4 GiB RAM, 8 GiB disk.

| Transition | Rep 1 | Rep 2 |
|---|---|---|
| Cold create to usable | 1.7 s | 1.2 s |
| Stop (running to stopped) | 2.0 s | 1.8 s |
| Start from stopped to usable | 0.8 s | 0.7 s |
| Archive (stopped to archived) | 82.3 s | 50.3 s |
| Start from archived to usable | 33.2 s | 65.7 s |
| Delete | 0.1 s | 0.2 s |

Prices, from Daytona's public pricing page (Linux sandboxes, checked 2026-07-11): $0.0504 per
vCPU-hour, $0.0162 per GiB of RAM per hour, $0.000108 per GiB of disk per hour (first 5 GiB
free). Daytona's billing docs confirm a stopped sandbox bills for its reserved disk only, and an
archived sandbox bills for no active resources (object storage; the per-GiB price is not
published). For our 2 vCPU / 4 GiB / 8 GiB sandbox that gives:

| State | Billing | Cost for our sandbox | Resume to usable (sandbox only) |
|---|---|---|---|
| Running | compute + RAM + disk | about $0.17/hour, or $0.0028/minute | zero, already up |
| Stopped | reserved disk only | about $0.0009/hour (about 2 cents/day) | 0.7 to 0.8 s |
| Archived | object storage | below stopped; exact price unpublished | 33 to 66 s |
| Deleted | nothing | zero | 1.2 to 1.7 s (fresh create) |

Three conclusions follow:

1. **Archive is worthless for us.** Restoring from archive (33 to 66 s) is slower than deleting
   and creating fresh from the snapshot (1.2 to 1.7 s), and the disk it frees costs under a tenth
   of a cent per hour. Our sandboxes keep almost nothing on their own disk (24 KiB written above
   the snapshot layers in the measurement; the durable data lives in the mounted cloud storage),
   so archive's one advantage, freeing disk quota, buys us nothing. The demotion ladder should be
   stop then delete, with the archive step configured out: `DAYTONA_AUTOARCHIVE` strictly greater
   than `DAYTONA_AUTODELETE` (equal values would race, and "archive interval 0 means maximum" is
   unusable because our `positiveMinutes()` parser treats 0 as unset). Daytona documents
   auto-delete as firing after continuous stopped time with no archive step required; the
   archive-disabled path still gets one explicit live check in the verification slice.
2. **Sandbox creation is not the 20-second problem.** A cold create to a usable exec is under 2
   seconds at the Daytona API, so almost all of the roughly 20 seconds QA measured per turn sits
   in our own per-turn pipeline: daemon startup inside the sandbox, asset upload, the geesefs
   mounts, harness startup, and the session reload. This is arithmetic, not instrumentation; the
   split across those steps is unmeasured, and the verification slice instruments it. Two
   corollaries: park-to-stopped skips only the create at the provider level (and today's Daytona
   path re-uploads Pi assets and rematerializes workspace files on every start, so the prepared
   disk saves less than it could); park-to-running is the only level that skips the whole
   pipeline.
3. **Parked-running compute is cheap in absolute terms.** $0.0028 per parked minute. A 60-second
   keep-warm window after each turn costs at most about a third of a cent; a cap of 4 concurrently
   running parked sandboxes has a worst-case burn of about $0.67/hour.

Park-to-stopped parks to Stopped: storage cost only, and the delete timer bounds even that.
Park-to-running parks to Running for a short window: the parked cost is live compute, so its
time-to-live is a direct cost knob and its running cap bounds the concurrent spend.

### Cleaning up abandoned sandboxes

`ephemeral: true` used to auto-delete a sandbox the moment it stopped. That is why it existed: a
crashed runner could not leave a sandbox billing for long. `ephemeral: false` removes that reflex.
The new backstop is the stop-then-delete timer cascade, plus the process-group kill for local
trees from the patch above. So a hard-killed runner now leaves a running Daytona sandbox billing
compute until the stop timer fires, then billing storage until the delete timer fires. With the
measured prices this abandonment budget is now a number, not a question: about 1.4 cents per
crash at a 5-minute stop timer, about 4 cents at the 15-minute value the plan proposes, plus a
fraction of a cent of storage until the delete timer. That is acceptable without a separate
sweeper; the timers are the sweeper.

## PR #5197 (durable session continuity)

PR #5197 ("Resume agent sessions across the sandbox lifecycle", branch `feat/sessions-continuity`,
open, base `big-agents`) is the durable-continuity base this project builds on. What it ships:

- `session-continuity.ts`: an in-memory store mapping `(sessionId, harness)` to
  `{agentSessionId, turnIndex}`, with a guard that lets a harness reload a session only if it
  authored the most recent completed turn. That guard makes switching between Pi and Claude safe.
- `session-continuity-durable.ts`: mirrors that store into `session_states.data` (a GET then a
  fire-and-forget PUT) so a runner restart does not lose continuity. Its own risk list flags that
  this write path has no concurrency guard and can drop a harness entry under concurrent writers;
  the failure mode is a silent cold replay.
- `sandbox-reconnect.ts`: changes `session_states.sandbox_id` from a display label (like "local")
  to the actual Daytona instance id.
- Per-harness transcript mounts: the harness transcript directories get the same durable
  cloud-storage treatment as the working directory (credentials deliberately excluded), so even a
  dead sandbox can reload its session natively. `AGENTA_SESSION_HARNESS_MOUNTS=false` disables it.
- The detached mount rewrite that fixed F-017 (a 60-second stream death), heartbeat ownership via
  an atomic Redis claim, and the `sandbox-agent@0.4.2` patch described above.
- An API-side `orphan_sweep.py` task. One scope fact matters here: it only cleans Postgres rows
  and Redis locks. It never contacts the runner or Daytona and cannot stop or delete a sandbox. It
  is not a provider-side leak sweeper.

Its own risk list also names: a failed turn parking its sandbox warm (the `shouldPark` gate now
prevents this), the 5-minute stop timer versus long human-in-the-loop waits, legacy `sandbox_id`
label values causing one doomed reconnect, and deploy order (API before runner).

## Interaction with F-018 (the Daytona tool-call hang)

F-018: every tool call that runs inside a Daytona sandbox hangs, because the permission check the
tool needs never reaches the runner. The turn is capped at 300 seconds by a guard and then fails.
The consequence for this project: a tool-using Daytona turn fails, and a failed turn does not park
(`shouldPark` returns false on a failed result). So warm reuse helps chat first. It also means
neither reuse level can be fully validated on tool turns until F-018 lands. The build-kit default
agent, whose first turn is a tool call, gets no benefit until then.

F-018 has its own implementation workspace, `../daytona-gate-delivery/`. Its gate and resume
model (a file-based gate, a stored decision the model's reissued call resolves against, and a
two-lifetime timeout) is the contract this plan's pending-approval section in `plan.md` follows.
