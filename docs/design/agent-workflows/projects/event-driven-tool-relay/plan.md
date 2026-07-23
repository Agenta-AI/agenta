# Plan: event-driven tool relay

## The design in one paragraph

Make relay-file publication atomic, then add wake sources that shorten the poll sleeps.
An event never carries data and never triggers execution directly; it only means "poll
now". Both directions publish via a temporary name plus a same-directory rename, so a
wake can never observe a partial file. Inside the sandbox, the writer watches the relay
dir with `fs.watch` and wakes the moment `<id>.res.json` lands (hop 1). On the local
backend the runner does the same for `<id>.req.json`. On Daytona, where the runner cannot
watch a remote filesystem, the runner holds one bounded, blocking exec in the sandbox: a
small node script that arms a watch, lists the relay dir, and exits on the first request
or at its window bound. While that watch is healthy the runner suspends its remote `ls`
polling and keeps only an ultra-slow safety poll; when the watch cannot run, the turn
falls back to today's poll loop. Every wake feeds the existing list-then-read pass with
its existing `seen` dedup.

This mechanism is writer-agnostic because it watches the relay directory, not any writer.
Today the relay has two writers: Pi's in-sandbox extension, and local Claude through the
runner's loopback MCP handler (both route through the same dispatch module,
`tool-mcp-http.ts:210` -> `runResolvedTool` -> `relayToolCall`). Tomorrow the in-sandbox
stdio MCP shim ([../in-sandbox-tool-mcp/plan.md](../in-sandbox-tool-mcp/plan.md), PR
#5234) becomes the third. Nothing here assumes Pi.

## Decision 1: what an event means

**Options.**

- (a) The event carries the filename; the runner handles that file directly.
- (b) The event is a wake signal only; the list pass remains the single source of truth.

**Choice: (b).** With (a), every event-path defect becomes a correctness bug: a coalesced
event (two request files, one notification) drops a call, and a duplicate event
double-executes. With (b), those are harmless because the list pass and the `seen` set
(relay.ts:332) handle multiple files and duplicate filenames. The poll path and the event
path converge on one code path, so the fallback is exercised on every wake, not only in
disaster. The cost is one extra directory list per wake.

**Correction from review.** An earlier draft claimed the `seen` set also handles
partially written files. It does not; it only dedups filenames. Under polling, the 300 ms
delay usually hides the write interval, but an event can arrive mid-write. The runner
would then mark the request seen (relay.ts:338), read partial JSON (relay.ts:380), write
an error response, and never retry. The response direction has the same defect: the
writer parses the moment the file exists (dispatch.ts:87) while the runner writes the
final path directly (relay.ts:362). Wake-only semantics therefore require atomic
publication, which is decision 2.

## Decision 2: atomic file publication (protocol amendment)

Both directions publish via a temporary name plus a same-directory rename:

```text
<id>.req.json.tmp.<nonce>  -> rename ->  <id>.req.json
<id>.res.json.tmp.<nonce>  -> rename ->  <id>.res.json
```

The final file contract (names, contents, who deletes what) does not change. Temporary
names never match the `.req.json`/`.res.json` suffix filters, so no reader ever sees
them. A same-directory rename is atomic on POSIX, so the final name either does not exist
or holds complete bytes.

Where the rename runs:

- The in-sandbox writer (hop 1 request, both backends): `fs.renameSync`, local to the
  sandbox filesystem.
- The runner's response write, local backend: `fs.renameSync` in `localRelayHost`.
- The runner's response write, Daytona: `RelayHost` gains a rename capability. The
  daemon SDK exposes `moveFs` (`post_v1_fs_move`), but whether it is a
  `rename(2)`-atomic same-directory move is unverified (open question 2). If it is not,
  the capability is implemented as a shell `mv` exec instead (an `mv` within one
  filesystem is `rename(2)`).

**Rejected weaker fallback: reader-side JSON parse retry.** Retrying a failed parse
interacts badly with the `seen` set and exactly-once execution: a parse failure would
have to un-see the file and retry under a deadline, and a genuinely corrupt file would
then loop. Correctness would once again depend on timing. Publication-side atomicity
removes the class of bug instead of handling it.

## Decision 3: the wake contract

The seam between a wake source and a poll loop is a coalesced, single-flight activity
source, not a bare promise race. An earlier draft proposed
`Promise.race([sleep(delay), watcher.wake()])`; review showed that shape leaks listeners
on timer wins and can launch overlapping Daytona execs. The contract is:

```ts
interface RelayActivitySource {
  wait(options: {
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<"activity" | "timeout" | "closed">;

  close(): void;
}
```

Invariants, each pinned by a unit test:

- At most one underlying Daytona `runProcess` exists per relay, ever (single-flight).
- Notifications coalesce into one sticky pending wake: any number of events while no
  waiter is present resolve the next `wait()` immediately with `"activity"`.
- A timer win leaves no accumulated listener; thousands of consecutive timeouts produce
  zero listener growth.
- An event that arrives between a directory scan and the next `wait()` stays observable
  (an epoch counter or sticky bit that `wait()` consumes).
- `close()` resolves in-flight waits with `"closed"`, prevents rearming, and aborts the
  in-flight held exec request, so relay stop (turn end, pause, teardown) cannot leave a
  request pinned on a stalled proxy or daemon.
- Errors are consumed and logged once. They degrade the source (the wait resolves like a
  timeout and the loop polls); they never become unhandled rejections.

Both loops use the same shape: `wait()`, then run the list pass regardless of the
outcome, then loop unless `"closed"`. Polling stays authoritative; the source only
shortens the sleep. When no source is available the loop uses a plain sleep, which is
byte-for-byte today's behavior.

## Decision 4: the hop 2 mechanism on Daytona

**Choice: a re-issued bounded watch exec that replaces the runner's remote polling while
healthy.** One `sandbox.runProcess` runs a small node script in the sandbox:

1. Arm `fs.watch` on the relay dir.
2. List the dir; if a `*.req.json` is already present, exit immediately.
3. Wait for the sticky watch signal, an in-script periodic `readdir` hit, or the internal
   window timer; then exit.

The arm-then-list order matters. An earlier draft listed first and then watched, claiming
that closed the created-before-armed race; it does not, because a file can land after the
list returns and before `fs.watch` arms. Arming first, then listing, then waiting on a
sticky signal closes it: a file that lands during the list fires the already-armed watch,
and the sticky bit keeps the event observable.

The runner treats the exec's completion as the wake, runs the list pass, and issues the
next window. While the watch is healthy:

- The runner does **not** run its 300 ms to 1.5 s remote `ls` poll. This is the request
  reduction; racing the watch against the full poll loop, as an earlier draft did, would
  have reduced nothing.
- The script's own periodic `readdir` (every 2 s, in-sandbox, no network cost) is the
  in-window correctness fallback against `fs.watch` losing an event.
- The runner keeps a hard outer bound on each window: the daemon request's `timeoutMs`
  is the window plus a 5 s grace, and an `AbortSignal` fires at the same bound, so a
  stalled proxy cannot hold the socket past the window. The grace exists so a normal
  window expiry (the script's internal timer) is never misclassified as a daemon timeout
  and counted as a failure.

**Fallback demotion.** If the watch exec cannot start, is rejected, or exits abnormally
repeatedly (three consecutive failures, retried with jittered exponential backoff, 1 s
doubling to a 30 s cap, plus or minus 20 percent), the runner stops issuing windows for
the turn and switches back to the classic poll loop at today's cadence, including the
idle backoff. One log line records the demotion.

**The safety poll: kept, at 30 s.** While the watch is healthy the runner additionally
runs one remote `ls` every 30 s. Decision and reasoning:

- The alternative (rely on the in-script `readdir` plus the outer timeout alone) makes
  the worst case depend on the watch subsystem detecting its own failure. The in-script
  `readdir` shares fate with the script: a wedged node process, a paused sandbox, or a
  daemon that accepted the exec but never delivers completion all silence it, and the
  outer timeout only catches those after window plus grace, followed by the demotion
  counter, which is itself new code that can be wrong.
- The safety poll is independent of every one of those layers. It uses the same primitive
  today's loop uses (a plain remote list) and nothing else, so it preserves the
  reliability principle as an absolute property: pickup latency is bounded by 30 s no
  matter what the watch subsystem does, including lying about success.
- It is nearly free: 2 requests per minute next to the watch's 2.4 re-issues per minute.
  Keeping it does not change the order of magnitude of the reduction.
- A request first discovered by the safety poll while a watch window was supposedly
  healthy counts as a watch miss and feeds the same demotion counter.

**Request volume, honestly.** Today an active Daytona turn costs about 200 remote `ls`
requests per minute (300 ms cadence), settling to about 40 per minute after idle backoff.
The healthy watch mode costs about 2.4 watch re-issues plus 2 safety polls per minute,
about 4.4 requests per minute total: roughly 45x fewer than today's active cadence and
roughly 9x fewer than today's idle floor. Per actual tool call, the list, read, and write
daemon calls are unchanged. An earlier draft claimed a ~75x reduction while also keeping
the full poll loop racing the watch; that combination was wrong, and would have reduced
request volume not at all.

### Alternatives considered and rejected

None of the following is part of the design. Each was evaluated and rejected.

- **Persistent watcher process** (`createProcess` plus `followProcessLogs`). Wins on
  request count (one process, one stream, no re-issue) but buys three new failure
  surfaces: stream reconnect (the log follow can drop and must resubscribe without
  missing prints), orphan lifecycle (the process outlives turns and must be killed on
  turn end, teardown, and runner restart, exactly the orphaned-watcher problem the
  requirements call out), and output handling (log truncation and backpressure). The
  re-issued exec is self-healing by construction: each window is a fresh request, a
  wedged script or daemon restart costs at most one window, and an orphan dies at its
  own internal timer even if the runner vanished. Revisit only if window re-issues ever
  show up in profiles.
- **ACP doorbell.** Rejected first because it cannot serve Claude at all: the MCP shim
  is a separate process with no ACP session, so a doorbell only ever covers Pi. It also
  only works while a session is streaming, and it couples the tool transport to the
  harness wire, which the delivery architecture deliberately avoids. It could return
  later as an extra wake hint on top of the watch, never as the mechanism.
- **No event path on Daytona; just tighten the poll interval.** Fails the goal: 100 ms
  polling still adds up per call and triples the daemon request volume that the idle
  backoff was added to reduce.

### Watch exec details (hardening, from review)

- The script is generated inline by the runner (a `node -e` argument), not uploaded, so
  there is no asset to version inside the sandbox.
- The relay directory is passed as an argv value (`process.argv`), never interpolated
  into the script source or a shell string. A regression test covers a path containing
  quotes, whitespace, shell metacharacters, and newlines.
- The script wakes on every directory event. It ignores `eventType` and `filename`
  entirely (filenames may be absent per the Node docs), so a rename versus create
  distinction cannot break it; every event is merely a wake.
- It handles a synchronous `fs.watch` throw and the watcher `error` event: both close
  cleanly and exit, which the runner treats as a wake plus a failure count.
- It closes the watcher and clears the timer on every exit path.
- Its exit (the exec completion) is the wake signal. The runner does not parse stdout,
  and the script does not `process.exit()` immediately after `console.log` (piped
  stdout can truncate).
- The internal window timer expires the script normally; the daemon `timeoutMs` sits at
  window plus grace, so normal expiry never races the daemon timeout.
- Node documents `fs.watch` caveats that this design absorbs by construction: it is not
  fully portable, filenames may be absent, and it is unreliable on virtualized or
  network filesystems. The relay dir is a plain local directory inside the VM by
  construction (research.md), and the periodic `readdir` covers residual event loss.
  One gotcha needs a live check: deleting and recreating the watched directory leaves
  the watcher attached to the old inode (Node `fs.watch` docs). `workspace.ts:60`
  recreates the relay dir when preparing a workspace; the QA pass includes a
  directory-replacement cell.
- The runner stops issuing windows when the relay loop stops (`active` flag, plus
  `close()` aborting the held request); the last in-sandbox script expires on its own
  internal timer.

## Decision 5: where the code lives (slice 0)

The relay client moves to its final modules first, as a no-behavior-change extraction:

- `tools/relay-protocol.ts`: the suffixes, the temp-name scheme, request/response JSON
  types, and `sanitizeRelayId`. Bundle-safe by rule: no server-side imports, so the
  future shim bundle and the runner both consume it.
- `tools/relay-client.ts`: request publication (write temp, rename), the response wait
  as one exported function, `waitForRelayResponse(resPath, { timeoutMs, signal })`
  (final name at implementation time), per-tool timeout, abort, and pair cleanup.
  `dispatch.ts` re-exports so existing call sites (the Pi extension, local Claude's
  loopback handler) compile unchanged.
- `tools/relay.ts`: stays the runner-side consumer and executor. Shared wake helpers do
  **not** live here: the shim bundle must never import server-heavy code, so the
  writer-side watch lives inside `relay-client.ts`'s wait function and the runner-side
  wake lives behind a `RelayHost` capability (`waitForActivity` or similar, returning
  the decision 3 activity source), implemented by `localRelayHost` with `fs.watch` and
  by `sandboxRelayHost` with the watch exec. `RelayHost` also gains the rename
  capability from decision 2.

The hop 1 watch therefore lives inside `waitForRelayResponse`, not in `dispatch.ts` as an
earlier draft said. Every relay writer goes through that one function, so the second and
third writers get the fast path with zero extra work.

**Ownership, settled with the sibling project.** This project owns the extraction as
slice 0. The in-sandbox-tool-mcp plan originally defined `relay-client.ts` and the
`waitForRelayResponse` contract as its own slice 1
([../in-sandbox-tool-mcp/plan.md](../in-sandbox-tool-mcp/plan.md):117) and sequenced
that slice before this watcher (plan.md:269); that project now consumes the modules this
slice 0 creates, with the identical contract, and its workspace is being corrected to
match. The landing-order note in
[../mcp-delivery-architecture/orchestration.md](../mcp-delivery-architecture/orchestration.md)
needs the same update (tracked in [open-questions.md](open-questions.md)).

## Decision 6: poll cadence and idle backoff

- **Hop 1 and local hop 2:** the existing poll cadence survives as a cheap safety timer
  racing the watch. A local `existsSync` or `readdirSync` every 300 ms costs nothing
  worth optimizing, and it keeps the degrade path exercised.
- **Daytona hop 2, watch healthy:** the remote poll is suspended (decision 4); the 30 s
  safety poll replaces it. The idle backoff does not run in this mode; there is nothing
  for it to back off.
- **Daytona hop 2, fallback mode:** today's loop, byte for byte, including the 300 ms
  cadence and the idle backoff to 1.5 s.
- `RELAY_TIMEOUT_MS` and the writer's deadline logic are untouched in every mode.

## Decision 7: configuration surface

Three environment variables, per hop, in the existing `AGENTA_AGENT_TOOLS_RELAY_*`
family. By semantic role: all three are **config**, operator-owned. An earlier draft had
one flag for both hops; review rejected that granularity because the in-sandbox response
watch and the remote Daytona exec have different owners and different failure modes.

| Variable | Default | Meaning |
| --- | --- | --- |
| `AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED` | `true` | Hop 1: the writer's in-sandbox `fs.watch` on the response file. Read by the writer from its env (the existing relay env channel). Off means the writer keeps today's 300 ms poll only. |
| `AGENTA_AGENT_TOOLS_RELAY_REMOTE_WATCH_ENABLED` | `false` initially, flip to `true` after QA | Hop 2 on Daytona: the watch exec plus suspended polling. Off means today's poll loop, byte for byte. |
| `AGENTA_AGENT_TOOLS_RELAY_REMOTE_WATCH_WINDOW_MS` | `25000` | Bounded lifetime of one watch exec window. Validated and clamped, below. |

**Window validation and clamping.** The value is parsed as an integer. A missing or
unparseable value falls back to the 25000 default with one warning log. A parsed value is
clamped to the range 5000 to 120000, again with one warning log: below 5 s the re-issue
cadence becomes the request storm this design removes; above 2 min the bounded-lifetime
and orphan-cleanup assumptions stop holding. Each issued window applies about 20 percent
jitter so a fleet of turns does not re-issue in lockstep. The 25 s default is a plausible
operational starting value, not a measured one; QA revisits it.

The runner-local hop 2 watch (local backend, in-process `fs.watch`) ships without a flag:
its failure mode is "fall back to the poll" and it has no operational surface an operator
would need to switch. The remote watch gets the flag because it changes what the runner
asks the daemon to do.

Existing variables (`AGENTA_AGENT_TOOLS_RELAY_POLLING`, `_POLLING_MAX`,
`_IDLE_GROW_AFTER`, `_TIMEOUT`) keep their names and meanings; they now describe the
fallback mode and the local safety timers.

## Does this make anything worse? (reliability and scalability)

### Races and partial files

- **Partial files.** Removed by construction (decision 2): a final-name file is always
  complete. Delayed and chunked writes become invisible to readers.
- **File created before the watch is armed.** Writer side (hop 1): arm `fs.watch`, then
  check `existsSync`, then wait; the response cannot fall between the check and the
  watch because the watch is already armed. Sandbox side (hop 2): the script arms before
  listing (decision 4). Runner side: a list pass runs on every wake and window start,
  and the safety poll fires regardless.
- **Event coalescing.** Two request files, one wake: the list pass returns both; the
  `seen` set dedups across wakes. The activity source's sticky bit means a wake can
  never be lost between a scan and the next wait.
- **Duplicate detection.** Unchanged: the `seen` set guards re-listing the same request
  filename; the writer deletes the pair after reading. Duplicate events cause duplicate
  lists, not duplicate executions.
- **Spurious events.** Pi's usage file lives inside the relay dir and its writes fire
  watch events, as do the `.tmp.<nonce>` names themselves. Cost: an extra list pass that
  finds nothing new. Accepted; filtering event payloads would reintroduce the
  trust-the-event problem decision 1 rejects.

### Watcher lifecycle

- **Watcher crash or absence.** The loop's worst case is the racing timer: today's poll
  cadence on hop 1 and local hop 2, the 30 s safety poll plus fallback demotion on
  Daytona. A watch exec that fails repeatedly is demoted for the turn with one log line
  and jittered backoff on the way there.
- **Orphaned watcher processes.** None by design: each watch exec dies at its own
  internal timer, and the daemon's `timeoutMs` (window plus grace) backstops that, even
  if the runner is gone. Turn end stops new windows and aborts the held request; sandbox
  teardown kills the VM and the script with it.
- **Runner restart mid-watch.** The in-flight window expires in the sandbox within the
  window bound. The restarted runner starts a fresh relay loop that lists first, so
  request files written during the gap are found. Stale request files from a crashed
  turn inside a warm-continued environment are a pre-existing property this project does
  not change; ownership of that residue is an open question raised by the sibling
  project (see open-questions.md).

### Held connections and Daytona limits

- **Concurrency shape.** N concurrent Daytona turns hold N watch requests. Undici's
  keep-alive (10 min, acp-fetch.ts) means today's ~3/s polling already keeps roughly one
  persistent connection per sandbox host; the held watch rides that same connection.
  Connections and file descriptors per run: approximately unchanged. Requests per run:
  about 4.4 per minute against about 200 per minute active today (decision 4 has the
  honest arithmetic).
- **Proxy and daemon tolerance.** The ACP prompt request is already held open for
  human-timescale approval pauses through the same preview proxy and cookie auth; that
  is production evidence that held requests survive the path. The 25 s window sits far
  below the 60-minute undici timeouts and any plausible proxy idle limit. Daytona's
  documented limits cover organization request rates, not concurrent execs per sandbox;
  this design needs exactly one concurrent exec above today's baseline per sandbox.
  **These capacity assumptions are rollout gates, not facts**: the QA pass at expected
  peak turn concurrency (test plan) must confirm them before the default flips.
- **Runner memory.** One pending promise, one activity source, and one small script
  string per active turn. Negligible against existing per-turn state.

### Interplay with neighbors

- **`RELAY_TIMEOUT_MS`.** Unchanged. The writer's deadline still governs; the watch only
  makes the success path faster.
- **Idle backoff.** Survives in fallback mode only (decision 6).
- **Warm sessions (session-keepalive).** The relay loop is per-turn and stays per-turn.
  An idle warm sandbox runs no relay loop, no watch exec, and no safety poll: zero relay
  requests, same as today. If the relay ever becomes per-session, the window design
  carries over; only the start/stop call sites move.
- **The second and third writers.** The final-file contract is untouched, hop 1 lives in
  the shared `waitForRelayResponse`, and the hop 2 watch is directory-level, so any
  writer's request files wake the runner identically.

### Latency accounting (what the numbers measure)

Three different measures, defined so the target is not ambiguous:

- **Wake latency**: request-file rename to the runner observing the watch exec
  completion. One held-request completion through the preview proxy.
- **Handler pickup** (the `stage=relay_pickup` metric): request-file publication to
  handler start. After the wake the runner still lists and then reads the request, so
  this is wake latency plus two daemon round-trips, not a single round-trip as an
  earlier draft implied. At a 20 to 50 ms proxy round-trip this lands around 60 to
  150 ms.
- **Full relay completion**: pickup plus execution plus the response write (a daemon
  write and a rename) plus the hop 1 in-sandbox wake (near zero) plus the writer's read
  and delete.

The target is **median handler pickup under 150 ms on Daytona and under 10 ms locally**,
measured during QA. It is a rollout gate to verify, not an asserted fact, and it depends
on proxy round-trip times the repo does not control. Hop 1 alone (the response wait)
drops from a 0 to 300 ms poll interval to one filesystem event on every backend.

## Slices

0. **Relay-client extraction (no behavior change).** Create `tools/relay-protocol.ts`
   and `tools/relay-client.ts` as specified in decision 5; `dispatch.ts` re-exports;
   all call sites compile unchanged; golden test pins the request-file bytes. This is
   the slice the sibling project consumes (decision 5).
1. **Atomic publication.** Temp-name plus rename in both directions; the `RelayHost`
   rename capability with the local and Daytona implementations; the Daytona rename
   atomicity check (open question 2) resolves here. Tests: delayed and chunked
   publication, rename verification on both hosts.
2. **Hop 1 and local hop 2 watches.** The activity source (decision 3) with the local
   `fs.watch` implementations, inside `waitForRelayResponse` and behind
   `RelayHost.waitForActivity` for `localRelayHost`. `RESPONSE_WATCH_ENABLED` wired.
   Unit tests including the invariant set. This alone removes about 0.6 s per call
   locally and about 0.3 s per call on Daytona (the response wait).
3. **Daytona watch exec (flag off).** The inline hardened script, the window loop with
   suspend-while-healthy, the safety poll, the demotion guard with jittered backoff,
   window validation and clamping, wired behind `REMOTE_WATCH_ENABLED`. Unit tests with
   a fake sandbox handle.
4. **Measurement and QA.** The `stage=relay_pickup` timing log (request-file publication
   to handler start). Run the Daytona tool cells of the QA matrix with the flag on;
   record before and after per-call latency distributions and request counts in
   status.md. Flip the default after a clean pass.
5. **Docs sync.** Env var inventory and the relay description in
   `docs/design/agent-workflows/documentation/` (tools page), per the keep-docs-in-sync
   rule.

## Test plan

Deterministic tests prove ordering and invariants; live QA records latency
distributions. No strict latency assertions in CI.

**Unit (vitest, `services/runner/tests/unit/`).**

- Activity source invariants: coalescing under simultaneous notifications and calls; an
  event at every arm/list/wait boundary stays observable; thousands of timer wins with
  zero listener growth; at most one concurrent `runProcess` per relay (a counting fake
  asserts the maximum); `close()` during a held window resolves waiters with `"closed"`
  and aborts the exec request; a rejecting source degrades to the timer and logs once.
- Publication: a reader never observes partial JSON under delayed and chunked writes;
  temp names are invisible to the suffix filters; rename semantics on `localRelayHost`
  and on a fake sandbox host.
- Watch exec script builder: arm-before-list ordering (an injected file between arm and
  list still wakes); exits on first event; exits at the window bound via the internal
  timer; the in-script `readdir` catches a lost event; argv-passed relay dir with
  quotes, whitespace, shell metacharacters, and newlines; watcher `error` and
  synchronous `fs.watch` throw both exit cleanly.
- Window loop: suspend-while-healthy (no remote `ls` between wakes except the 30 s
  safety poll); demotion after repeated immediate exec failure, repeated abnormal exit,
  and repeated daemon-level timeout, each with jittered backoff; normal window expiry is
  not counted as failure (the grace test); a safety-poll discovery increments the miss
  counter; fallback mode equals today's loop.
- Config: window parsing, invalid-value fallback, min and max clamping, jitter bounds.
- `startToolRelay` with a fake host: request handled on wake without waiting a poll
  interval; watcher death mid-turn does not stall the loop; `seen` dedup across wake and
  poll pickups of the same file; `stop()` during a held window ends the turn cleanly.
- `waitForRelayResponse`: response via watch resolves promptly; watch failure falls back
  to the 300 ms poll; deadline and abort behavior unchanged; golden request-file bytes
  across the Pi path and the client module (slice 0).

**Integration.**

- Local end-to-end: real `startToolRelay` with `localRelayHost` plus a real writer
  against a temp dir; round trip completes in well under one poll interval.
- The race, deterministically: with injected hooks, publish the request file in the gap
  between watch arming and the first list, and assert pickup; same for the response file
  on the writer side.
- The watch script as a process: spawn the actual node script against a temp dir; cover
  the pre-existing-file path, the event path, the `readdir` fallback path, and the
  timeout path.
- Failure injection against a fake daemon: daemon restart mid-window, proxy disconnect,
  sandbox pause, relay-directory deletion and recreation (the inode gotcha), node
  missing from the image, `ENOSPC` and `EMFILE` from `fs.watch`, immediate exec
  failure, repeated timeout. Each must land in a wake, a demotion, or a clean fallback;
  never a hang.

**Live QA and measurement.**

- Batch load at expected peak turn concurrency; record request count, open sockets, held
  execs, and p50/p95/p99 handler pickup and fallback latency, before and after, in
  status.md.
- The Daytona capacity gates (concurrent held execs per sandbox and per organization,
  proxy behavior under N held requests) are confirmed here before any default flip.

## Rollout

1. Slice 0 and slice 1 ship unflagged (a refactor and a publication change with no
   observable contract change). Runner tests plus one dev-box smoke run gate them.
2. Slice 2 ships with `RESPONSE_WATCH_ENABLED=true` (in-process, degrade-to-poll) after
   the invariant tests pass.
3. Slice 3 ships with `REMOTE_WATCH_ENABLED=false`. QA on the dev box with the flag on
   (slice 4), including the capacity gates. Flip the default to `true` in a follow-up
   commit once the matrix passes; the flag stays as the operator kill switch.
4. The incident playbook is one line: set
   `AGENTA_AGENT_TOOLS_RELAY_REMOTE_WATCH_ENABLED=false` and the Daytona relay is
   byte-for-byte today's behavior; set `RESPONSE_WATCH_ENABLED=false` and the writer is
   too.
