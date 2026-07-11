# Plan: event-driven tool relay

## The design in one paragraph

Keep both poll loops exactly as they are and add wake sources that shorten their sleeps.
An event never carries data and never triggers execution directly; it only means "poll
now". Inside the sandbox, the writer watches the relay dir with `fs.watch` and wakes the
moment `<id>.res.json` lands (hop 1). On the local backend the runner does the same for
`<id>.req.json`. On Daytona, where the runner cannot watch a remote filesystem, the runner
holds one bounded, blocking exec in the sandbox: a small node script that lists the relay
dir, watches it, prints when a request appears, and exits; the runner re-issues it each
window (hop 2). Every wake feeds the existing list-then-read pass with its existing `seen`
dedup. If any watcher dies, the sleep timer it was racing against fires and the loop polls
as it does today.

## Decision 1: what an event means

**Options.**

- (a) The event carries the filename; the runner handles that file directly.
- (b) The event is a wake signal only; the list pass remains the single source of truth.

**Choice: (b).** With (a), every event-path defect becomes a correctness bug: a coalesced
event (two request files, one notification) drops a call, a renamed or partially written
file crashes the handler, a duplicate event double-executes. With (b), all of those are
harmless because the list pass and the `seen` set (relay.ts:332) already handle multiple
files, partial names, and duplicates. The poll path and the event path converge on one
code path, so the fallback is exercised on every wake, not only in disaster. The cost is
one extra directory list per wake, which is cheap on a local filesystem and one daemon
request on Daytona.

Concretely, the runner loop's `await sleep(delay)` (relay.ts:389) becomes
`await Promise.race([sleep(delay), watcher.wake()])`. The writer loop in `relayToolCall`
(dispatch.ts:87-105) gets the same shape. A watcher is an optional object with a `wake()`
promise and a `close()`; when absent or broken, the race degenerates to the plain sleep.
This structure is the reliability principle made mechanical: a dead watcher cannot delay
anything beyond today's poll interval.

## Decision 2: the hop 2 mechanism on Daytona

**Options.**

- (a) Re-issued bounded watch exec. One `sandbox.runProcess` runs a node script:
  list the dir; if a `*.req.json` is already there, print and exit (this closes the
  created-before-armed race); otherwise `fs.watch` with a bounded timeout (the watch
  window, default 25 s); print on the first relevant event or timeout; exit. The runner
  treats any completion (output, timeout, error) as a wake, runs the list pass, and
  issues the next watch exec.
- (b) Persistent watcher process. `createProcess` starts a long-lived watcher; the runner
  subscribes to its stdout with `followProcessLogs`; each printed filename is a wake.
- (c) ACP doorbell. Pi's extension emits an `extNotification` ("check the relay dir")
  right after writing a request file; the runner observes the frame and wakes the loop.
- (d) No event path on Daytona; just tighten the poll interval.

**Choice: (a).** Reasons, option by option:

- (a) is self-healing by construction. Each window is a fresh request: a wedged script, a
  dropped connection, or a daemon restart costs at most one window, after which the next
  issue starts clean; and while a window is broken, the racing backstop poll still runs.
  There is no orphan to clean up: the script exits on its own timeout even if the runner
  vanished, so a runner restart or crash leaves nothing behind beyond the tail of the
  current window. It replaces ~3 execs/second with ~0.04 held requests/second.
- (b) wins on request count (one process, one stream, no re-issue) but buys three new
  failure surfaces: stream reconnect (the log follow can drop and must resubscribe
  without missing prints), orphan lifecycle (the process outlives turns and must be
  killed on turn end, teardown, and runner restart, exactly the "orphaned watcher"
  problem the requirements call out), and output handling (log truncation and
  backpressure). Option (a)'s re-issue cost is one small request per 25 s per active
  turn; that does not justify (b)'s lifecycle machinery. Revisit if window re-issues
  ever show up in profiles.
- (c) is cheap and real: the runner already observes every ACP frame, and the channel
  exists. But it only covers Pi (the MCP shim is a separate process with no ACP
  session), only works while the session is streaming, and couples the tool transport to
  the harness wire, which decision 3 of the delivery architecture deliberately avoids.
  It also cannot be the only mechanism for the same reason polling stays: a dropped
  frame must not strand a call. Verdict: feasible, insufficient alone, and redundant
  once (a) exists. Keep it in the back pocket as an additional wake hint if (a)'s
  round-trip ever matters; do not build it now.
- (d) fails the goal. 100 ms polling still adds up per call and triples the daemon
  request volume that the idle backoff was added to reduce.

**Watch exec details.**

- The script is generated inline by the runner (a `node -e` argument), not uploaded, so
  there is no asset to version inside the sandbox.
- It watches for `*.req.json` events but its exit is only a wake; the runner's list pass
  decides what is actually there.
- Window default 25 s: short enough that any proxy idle limit is irrelevant and an
  orphaned script dies quickly, long enough that re-issue traffic is negligible. The
  60-minute undici timeouts (acp-fetch.ts) sit far above it as the transport backstop.
- The runner stops issuing new windows when the relay loop stops (`active` flag); the
  last window expires on its own inside the sandbox.
- If the exec fails in a way that suggests the fast path cannot work (node missing in a
  custom snapshot, repeated non-zero exits), the runner logs once and stops issuing
  windows for the turn; the backstop poll carries the turn at today's cadence.

## Decision 3: where the hop 1 watch lives

**Options.**

- (a) In `relayToolCall` (tools/dispatch.ts), the shared writer.
- (b) In Pi's extension (extensions/agenta.ts), the only writer today.

**Choice: (a).** `relayToolCall` is the one function every relay writer goes through: Pi's
extension calls it via `runResolvedTool` today, and the Claude MCP shim is designed to use
the same dispatch module. Putting the watch there means the second writer gets the fast
path with zero extra work and the req/res file contract stays the only coupling between
writers. Option (b) would leave the shim on 300 ms polling and split the relay's timing
behavior across writers.

The runner-local watch (the local backend's hop 2) lives next to `localRelayHost` so
`startToolRelay` can race it, keeping `relay.ts` the single home of relay timing.

## Decision 4: what happens to the poll cadence and idle backoff

**Options.**

- (a) Keep every existing constant; the watch only shortens sleeps.
- (b) Lengthen the backstop poll (for example, cap at 5 s instead of 1.5 s) when a watch
  is active and healthy.

**Choice: (a) for the initial slices, (b) as a measured follow-up.** The watch already
removes the latency, so lengthening the backstop buys only fewer fallback requests, and
doing both changes at once makes a regression ambiguous (was the missed call a watch bug
or a backoff bug?). Ship the watch with today's constants, measure, then raise the cap in
a follow-up if the daemon request count still matters. `RELAY_TIMEOUT_MS` and the writer's
deadline logic are untouched either way; the idle backoff survives as the backstop
cadence.

## Decision 5: configuration surface

Two new environment variables, both in the existing `AGENTA_AGENT_TOOLS_RELAY_*` family.
By semantic role (per the interface-design review): both are **config**, operator-owned,
service-level, read by the runner only. Nothing new crosses the wire, enters the sandbox
env, or touches the SDK.

| Variable | Role | Default | Meaning |
| --- | --- | --- | --- |
| `AGENTA_AGENT_TOOLS_RELAY_WATCH` | config (rollout switch) | `false` initially, flip to `true` after QA | Enables the Daytona watch exec (hop 2). |
| `AGENTA_AGENT_TOOLS_RELAY_WATCH_WINDOW_MS` | config | `25000` | Bounded lifetime of one watch exec window. |

The hop 1 and local-backend watches (plain `fs.watch` on a local filesystem) ship without
a flag: they are in-process, their failure mode is "fall back to the poll", and gating
them would put a flag inside the sandbox env for no operational benefit. The Daytona watch
exec gets the flag because it changes what the runner asks the daemon to do, which is the
part an operator may need to switch off against a misbehaving provider.

Existing variables (`AGENTA_AGENT_TOOLS_RELAY_POLLING`, `_POLLING_MAX`,
`_IDLE_GROW_AFTER`, `_TIMEOUT`) keep their names and meanings.

## Does this make anything worse? (reliability and scalability)

### Races and duplicates

- **File created before the watch is armed.** Three independent covers: the watch exec
  script lists before watching; the runner runs a list pass on every wake and on every
  window start; the backstop poll fires regardless. Writer side (hop 1): arm `fs.watch`,
  then check `existsSync`, then wait; the response cannot fall between the check and the
  watch because the watch is already armed.
- **Event coalescing.** Two request files, one event (or one window exit): the wake
  triggers a full list, which returns both; the `seen` set dedups across wakes. Nothing
  is lost.
- **Duplicate detection.** Unchanged: the `seen` set already guards re-listing the same
  request file; the writer already deletes the pair after reading. Duplicate events cause
  duplicate lists, not duplicate executions.
- **Spurious events.** Pi's usage file lives inside the relay dir and its writes will
  fire watch events. Cost: an extra list pass that finds nothing. Accepted; filtering
  event names would reintroduce the trust-the-event-payload problem decision 1 rejects.

### Watcher lifecycle

- **Watcher crash or absence.** The `Promise.race` structure means the loop's worst case
  is exactly today's poll cadence. A watch exec that errors repeatedly is disabled for
  the turn with one log line.
- **Orphaned watcher processes.** None by design: each watch exec dies at its own bounded
  timeout, enforced by the daemon (`timeoutMs` on `runProcess`), even if the runner is
  gone. Turn end stops new windows; sandbox teardown kills the VM and the script with it.
- **Runner restart mid-watch.** The in-flight window expires in the sandbox within the
  window bound. The restarted runner starts a fresh relay loop that lists first, so
  request files written during the gap are found. Stale request files from a crashed run
  behave exactly as they do today (a fresh loop would execute them); this project does
  not change that property.

### Held connections and Daytona limits

- **Concurrency shape.** N concurrent Daytona turns hold N watch requests. But undici's
  keep-alive (10 min, acp-fetch.ts) means today's 3/s polling already keeps roughly one
  persistent connection per sandbox host; the held watch rides that same connection.
  Connection and fd count per run: approximately unchanged. Requests per run: down about
  two orders of magnitude (from ~180/min to ~2.4/min idle).
- **Proxy and daemon tolerance.** The ACP prompt request is already held open for
  human-timescale approval pauses through the same preview proxy and cookie auth; that is
  the production evidence that held requests survive the path. The 25 s window sits far
  below both the 60-minute undici timeouts and any plausible proxy idle limit.
  Daytona-side limits on concurrent execs per sandbox are not documented in the repo;
  the design needs exactly one concurrent exec per sandbox above today's baseline, which
  is the smallest possible ask. Verification is open question 1.
- **Runner memory.** One pending promise and one small script string per active turn.
  Negligible against the existing per-turn state.

### Interplay with neighbors

- **`RELAY_TIMEOUT_MS`.** Unchanged. The writer's deadline still governs; the watch only
  makes the success path faster.
- **Idle backoff.** Survives as the backstop cadence (decision 4). Its reset-on-activity
  behavior still works because wakes feed the same `sawNew` accounting.
- **Warm sessions (session-keepalive).** The relay loop is per-turn and stays per-turn. A
  kept-alive session between turns runs no relay loop and no watch exec, so an idle warm
  sandbox costs zero relay requests, same as today. If the relay ever becomes
  per-session, the watch window design carries over unchanged; only the start/stop call
  sites move.
- **The second writer (Claude MCP shim).** The file contract is untouched, hop 1 lives in
  the shared `relayToolCall`, and the hop 2 watch is directory-level, so a second writer's
  request files wake the runner identically. Nothing in this design is Pi-specific.

### Net verdict

Latency: hop 1 drops to one filesystem event (~0 ms). Hop 2 drops to ~0 ms locally and to
one daemon round-trip on Daytona (the script prints, the held request completes, the
runner lists and reads). Per-call relay overhead goes from 0.3-1.8 s to under ~150 ms on
Daytona and near zero locally. Request volume on Daytona drops sharply. Failure modes are
bounded by the untouched poll loop. The one genuinely new cost is one held daemon request
per active turn, which the ACP channel already proves out at far longer durations.

## Slices

1. **Hop 1 and local hop 2 (no flag).** Add the watcher abstraction to `relay.ts`
   (wake-race helper + local `fs.watch` watcher) and use it in `startToolRelay` and in
   `relayToolCall`. Unit tests. This alone removes ~0.6 s per call locally and ~0.3 s per
   call on Daytona (the response wait).
2. **Daytona watch exec (flag off).** The inline node watch script, the window loop, the
   disable-on-repeated-failure guard, wired into `sandboxRelayHost` usage in
   `startToolRelay` behind `AGENTA_AGENT_TOOLS_RELAY_WATCH`. Unit tests with a fake
   sandbox handle.
3. **Measurement and QA.** A `[timing] stage=relay_pickup` log (request-file write to
   handler start) alongside the existing timing lines. Run the Daytona tool cells of the
   QA matrix with the flag on; record before/after per-call latency in status.md. Flip
   the default after a clean pass.
4. **Docs sync.** Env var inventory and the relay description in
   `docs/design/agent-workflows/documentation/` (tools page), per the keep-docs-in-sync
   rule.

## Test plan

**Unit (vitest, `services/runner/tests/unit/`).**

- Wake-race helper: event before sleep expiry wakes early; no event falls through at the
  poll delay; a watcher whose `wake()` rejects degrades to the sleep (the degrade test).
- Local watcher: file created after arming wakes; file created before arming is found by
  the accompanying list (simulated arm gap); two files, one wake, both handled; close is
  idempotent.
- `startToolRelay` with a fake host and a controllable fake watcher: request handled on
  wake without waiting a poll interval; watcher death mid-turn does not stall the loop;
  `seen` dedup across wake and poll pickups of the same file.
- Watch exec script builder: emits list-first behavior; exits on first event; exits at
  the window bound; the runner's window loop treats error, timeout, and output uniformly
  as wakes and disables after repeated failures.
- `relayToolCall`: response via watch resolves promptly; watch failure falls back to the
  300 ms poll; deadline behavior unchanged.

**Integration.**

- Local end-to-end: real `startToolRelay` with `localRelayHost` plus a real
  `relayToolCall` against a temp dir; assert round-trip completes in well under one poll
  interval.
- The race, deterministically: with injected hooks, write the request file in the gap
  between the watcher arming and the first list, and assert pickup; same for the
  response file on the writer side.
- The watch script as a process: spawn the actual node script against a temp dir; cover
  the pre-existing-file path, the event path, and the timeout path.

**Measurement.**

- The `stage=relay_pickup` timing log gives per-call pickup latency in both modes.
- Before/after comparison on the dev box: a Daytona run with several gateway tool calls,
  flag off then on; record median and worst per-call relay overhead in status.md. Success
  is median pickup under 150 ms on Daytona and under 10 ms locally, with zero missed
  calls across the QA matrix tool cells.

## Rollout

1. Slice 1 ships unflagged (in-process watches, poll fallback intact). Runner tests plus
   one dev-box smoke run gate it.
2. Slice 2 ships with `AGENTA_AGENT_TOOLS_RELAY_WATCH=false`. QA on the dev box with the
   flag on (slice 3). Flip the default to `true` in a follow-up commit once the matrix
   passes; the flag stays as the operator kill switch.
3. Any incident playbook is one line: set `AGENTA_AGENT_TOOLS_RELAY_WATCH=false` and the
   relay is byte-for-byte today's behavior on Daytona; slice 1's in-process watches have
   no operational surface to switch.
