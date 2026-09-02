# Slice: the execution watchdog

Branch `feat/session-execution-watchdog`. Commits `59fb1a7864` and `5bbd5a36df`.

This slice makes one RFC requirement true: **every accepted execution reaches exactly one
durable terminal outcome within a bounded time** (`requirements.md:36`, D-016 at
`decisions.md:129-139`). It adds no table, no transport, and no new subsystem.

## What happens today

A turn can run out of ways to end.

The runner writes its terminal record downstream of `await run(...)`
(`services/runner/src/server.ts:622`), and releases its alive watchdog in the `finally` around
that same await (`services/runner/src/server.ts:618`). Both are correct on every path where
`run()` returns. Neither happens when it does not. An await inside the run that never settles
leaves the heartbeat announcing `running=true` every thirty seconds for good, and each beat
re-arms a Redis lease whose TTL is an hour.

The user sees a session that is running, refuses a new message, and never finishes. The only
exits were the thirty-minute idle threshold and pressing Stop.

Three ways in, all reported:

- The sandbox dies under the turn ([#6418](https://github.com/Agenta-AI/agenta/issues/6418)).
  Verified: the agent-to-client half of the ACP channel is a long-lived SSE `GET`; when the peer
  dies the transport's read loop swallows the severed stream and never fails the readable
  (`services/runner/node_modules/acp-http-client/dist/index.js:335-339`), so the pending
  `session/prompt` request is structurally incapable of settling.
- The runner itself is gone: a container restart, a crash, an OOM kill. Nothing on the runner
  can write an outcome, because there is no runner.
- A write failure is swallowed and the turn beats on
  ([#6100](https://github.com/Agenta-AI/agenta/issues/6100),
  [#5327](https://github.com/Agenta-AI/agenta/issues/5327),
  [#6099](https://github.com/Agenta-AI/agenta/issues/6099)).

The existing run limits do not cover these. Time-to-first-byte (2 min) catches a sandbox that
dies before the first token and idle (30 min) catches one that dies mid-stream, but
`notePaused()` retires every timer permanently the moment a turn parks for a human
(`services/runner/src/engines/sandbox_agent/run-limits.ts:207-210`) — which is exactly when a
long turn is most likely to outlive its sandbox. Verified.

An embryonic watchdog already existed. `orphan_sweep.py` found stale rows and cleared their
Redis nest, but it wrote nothing to the transcript and told no open browser, so a swept
session's conversation simply stopped mid-turn. Verified before this change.

## What this slice changes

Two halves. Either one alone leaves a hole, because the runner cannot report an outcome when it
is gone, and the platform cannot see a dead sandbox under a runner that is still beating.

### API: settle an execution whose runner cannot report one

`api/oss/src/tasks/asyncio/sessions/orphan_sweep.py`, extended rather than duplicated. A second
job scanning the same rows would race this one: whichever collapsed the flags first would hide
the row from the other, and the terminal record would sometimes never be written.

For each stale row that claims a running turn, in this order:

1. Write the two records the dead runner owed, `_lost_turn_records` at `orphan_sweep.py:112`.
2. Collapse the row's flags so the session reads as ended.
3. Clear the Redis nest and tombstone the turn, so a late beat cannot re-nest it.
4. Publish the watch notification on the session channel and the project channel.

Step 1 is deliberately first. A crash between the steps leaves the row a candidate for the next
pass, which is recoverable; collapsing the flags first would hide the row forever with no
ending ever written.

**The records mirror the runner's own error path exactly**: an `error` event carrying the class
a client can act on, then the terminal `done`. A lone `done` would render as a clean finish,
which is the opposite of what happened. The message is character-for-character the runner's
`EXECUTION_LOST_MESSAGE`, so one outcome never reaches the user in two wordings.

**Idempotent twice over.** A stable `uuid5` per (turn, record) (`orphan_sweep.py:94`) means the
ingest upsert writes the same two rows however many passes or replicas see the turn. And
`RecordsDAO.settled_turns` (`api/oss/src/dbs/postgres/sessions/records/dao.py:233`) asks, in one
query per project, which turns already carry a terminal record — because a runner can die
*after* writing its outcome but *before* its final `is_running=false` beat lands. That turn is
already settled; its row still needs collapsing, but a second, contradictory ending would
corrupt the transcript. The records table lives in the tracing database and the stream rows in
the core database, so this is a two-phase read, never a join.

If that lookup fails, the pass writes nothing and still collapses the row. Saying nothing is
better than inventing a second ending.

### Runner: never wait on a run forever

`services/runner/src/sessions/turn-settle.ts` (new). `awaitTurnOrAbandon` wraps the run in
`server.ts`. It waits normally, and gives up when the platform says the turn is no longer
current, or when the hard deadline elapses. Giving up is two steps: `abort()` first, because
most hangs do unwind from an abort, and only if the run is still pending after the grace window
does the request write the outcome itself and stop waiting.

This closes the loop with the API half. When the watchdog settles a turn it tombstones it, so
the wedged runner's next heartbeat answers `is_current_turn: false`, which already aborts the
run (`services/runner/src/sessions/alive.ts:207`). Where that abort lands somewhere the signal
is observed, the turn ends cleanly. Where it does not, the grace window ends the request anyway.

`services/runner/src/engines/sandbox_agent/sandbox-liveness.ts` (new) covers the case the API
cannot see: a dead sandbox under a runner that is still beating happily. It probes the daemon's
own health route, a different socket from the wedged ACP channel, and trips the existing
run-limit path after three consecutive failures. Any HTTP status counts as alive, 401 and 404
included: the question is whether something is listening, and only a transport failure answers
it.

The turn is closed to further events once the request has written its outcome
(`services/runner/src/server.ts`, the `gatedEmit` wrapper). An abandoned run that unwinds
minutes later must not append a second ending.

The heartbeat itself gained a request timeout and an in-flight guard
(`services/runner/src/sessions/alive.ts`). Both beats used a bare `fetch` with no signal, so a
stalled socket never settled: beats piled up behind it, and the final beat in `release()` could
hold the whole request open after the turn had ended.

### Web

Two small changes, both found by tracing what a browser does when the records land.

- `execution_lost` joins `RETRYABLE_CODES`
  (`web/oss/src/components/AgentChatSlice/components/AgentMessage.tsx:154`). The retry wiring
  already existed; the code was simply in no branch, so the failed turn offered no action.
- The desktop watch now listens for `lifecycle`
  (`web/oss/src/components/AgentChatSlice/hooks/useSessionRecordsWatch.ts`). It previously
  registered only `ready`, `records-changed` and `interaction`, so the watchdog's `ended` event
  was received by the EventSource and discarded, and the session kept *looking* alive until the
  next fifteen-second liveness poll. Mobile already did this.

The error itself needed no frontend change: the replay adapter already folds
`{type: "error", message, code}` onto the interrupted turn and `done` already closes it.

## The timeouts, and how to change them

Every value is a setting. Nothing here needs a redesign to tune.

| Setting | Default | Environment variable |
|---|---|---|
| Grace past one heartbeat before a running turn is lost | 90 s | `AGENTA_SESSIONS_WATCHDOG_GRACE_SECONDS` |
| Grace before an alive-but-idle row is settled | 1800 s | `AGENTA_SESSIONS_WATCHDOG_IDLE_GRACE_SECONDS` |
| How often the watchdog runs | 60 s | `AGENTA_SESSIONS_WATCHDOG_INTERVAL_SECONDS` |
| Rows settled per pass | 500 | `AGENTA_SESSIONS_WATCHDOG_BATCH_SIZE` |
| Sandbox probe interval | 30 s | `AGENTA_RUNNER_SANDBOX_PROBE_INTERVAL_MS` |
| Sandbox probe timeout | 10 s | `AGENTA_RUNNER_SANDBOX_PROBE_TIMEOUT_MS` |
| Consecutive probe failures before the sandbox is declared gone | 3 | `AGENTA_RUNNER_SANDBOX_PROBE_FAILURES` |
| Hard per-turn deadline | 11.5 h | `AGENTA_RUNNER_TURN_HARD_DEADLINE_MS` |
| Grace after an abort before the request stops waiting | 60 s | `AGENTA_RUNNER_TURN_ABANDON_GRACE_MS` |
| Heartbeat request timeout | 15 s | `AGENTA_RUNNER_HEARTBEAT_TIMEOUT_MS` |

Definitions live in `api/oss/src/utils/env.py:564` (`SessionWatchdogConfig`),
`services/runner/src/engines/sandbox_agent/sandbox-liveness.ts` and
`services/runner/src/sessions/turn-settle.ts`.

Two of these deserve their reasoning stated.

**The running threshold is one heartbeat interval plus the grace, so 120 seconds by default.**
It was a flat 300 seconds. Five minutes was defensible for a sweep that only collapsed flags;
it is too long to make a user watch a dead turn now that the sweep writes a real ending. 120
seconds is three missed beats. Raise the grace if a healthy deployment ever settles a live turn.

**The hard per-turn deadline sits ABOVE the longest legitimate run, not below it.** The run
limits already own when a real turn should stop, and users have asked for longer runs, not
shorter ones ([#6084](https://github.com/Agenta-AI/agenta/issues/6084),
[#5356](https://github.com/Agenta-AI/agenta/issues/5356)). A turn that reaches this deadline is
one whose own limits already tripped and failed to end it. `AGENTA_RUNNER_RUN_TOTAL_TIMEOUT_MS`
is unchanged.

## Tests

**API**, `api/oss/tests/pytest/unit/sessions/test_execution_watchdog.py`, 8 tests, all passing.
A lost turn gets an `error` then a `done`; a second pass writes no second ending; record ids are
stable across passes; an idle row owes no ending; a running row with no turn id is settled
silently; open readers are told the session ended; the Redis nest follows the settled row; a
failed lookup never invents an ending.

The existing `test_orphan_sweep_thresholds.py` and `test_orphan_sweep_clears_redis.py` still
pass. Their fixtures gained the `turn_id` column, and the threshold assertion now names 120
seconds with the reason written down.

**Runner**, vitest, 14 tests, all passing.
`services/runner/tests/unit/sandbox-liveness.test.ts` (6): the threshold of consecutive
failures, tolerance of a single blip, a probe that *hangs* counted as a failure, and firing at
most once and never after dispose. `services/runner/tests/unit/turn-settle.test.ts` (8): the
happy path leaves no timer armed, a rejecting run still reaches the caller's own catch, an
interruption aborts first, a run that will not unwind hands back a reason, the hard deadline
works with no interruption signal at all, and an abort that throws does not break the settle.

Full suites: `services/runner` 2642 unit tests pass. `api/oss/tests/pytest/unit/sessions` 333
pass. 11 modules in that directory error on import with
`cannot import name 'InvalidHarnessKindError' from 'agenta.sdk.agents'`; that is pre-existing,
confirmed by running the same command on the unmodified tree, and comes from borrowing the main
checkout's virtual environment, whose SDK is installed from a different tree.

Commands:

```
cd services/runner && pnpm exec vitest run --project unit
cd api && PYTHONPATH=$PWD python -m pytest oss/tests/pytest/unit/sessions/ -q
```

## Live verification

Stack: `agenta-ee-dev-session-watchdog` at **http://144.76.237.122:8880**, EE, dev images,
local sandbox provider, its own Postgres on 5442. Deployed from this worktree at commit
`59fb1a7864`; the runner picked up `5bbd5a36df` by hot reload. Images were 40 minutes old at
deploy time, so `--build` was skipped as the brief allows.

### Scenario A: the runner is gone

A turn was opened by beating `POST /sessions/streams/heartbeat` once with
`is_running: true` — the runner's only liveness contribution — and then going silent, which is
byte-for-byte what a runner that died produces.

Before: the Redis lease had 3586 seconds left, a second turn asking for the session got
`is_current_turn = False`, and the session had zero records.

```
2026-09-02T21:26:29.624Z [WARN.] watchdog: settled a session_stream whose runner went silent
  extra={'session_id': 'wd-scenario-a-161c2d24',
         'stream_id': '01a06402-25b6-7072-97ea-9164efb69baf',
         'turn_id': 'e79207c5-813c-4913-98b8-a12d244afefb', 'lost': True}
2026-09-02T21:26:29.643Z [INFO.] watchdog: settled 1 sessions (1 turns marked lost)
```

The row was created at 21:24:17 and settled at 21:26:29, so 132 seconds: the 120-second
threshold plus part of one sweep interval.

After, all four verified by reading the stores:

| Check | Result |
|---|---|
| Records for the turn | `error` (`code: execution_lost`) at `21:26:29.623`, then `done` at `21:26:29.624` |
| Stream row flags | `is_alive: false, is_running: false, is_attached: false` |
| Redis `alive` / `running` / `owner` | all empty |
| Redis `superseded:...:turn:<lost turn>` | `1` |
| A new turn on the same session | `is_current_turn = True` |

### Scenario A2: the runner wrote its outcome but lost its final beat

The idempotency guard, on a real deployment. A turn was opened, the runner's own `done` record
was ingested, and the beating stopped.

```
2026-09-02T21:29:29.654Z [WARN.] watchdog: settled a session_stream whose runner went silent
  extra={'session_id': 'wd-already-settled-4863aef0', ..., 'lost': False}
2026-09-02T21:29:29.663Z [INFO.] watchdog: settled 2 sessions (1 turns marked lost)
```

`lost: False`, and the session still holds exactly one record: the runner's own `done`. The row
was collapsed and the Redis nest cleared, with no second ending invented. The other session
settled in the same pass was a genuinely different lost turn, and it got its own single
`error` + `done` pair.

### Scenario B: the sandbox dies under the turn

A real agent turn on the local sandbox provider (codex harness, OpenAI through the vault), asked
to run `sleep 240`. Once the tool call was in flight, the sandbox's process group was killed
from outside the runner.

The kill produced exactly the reported failure shape, and this is what made the first attempt
worth having:

```
Error: connect ECONNREFUSED 127.0.0.1:35171
  at async StreamableHttpAcpTransport.postMessage (acp-http-client/src/index.ts:406:21)
[sandbox-agent] unhandledRejection: TypeError: fetch failed
[sessions/alive] heartbeat OK session=wd-sandbox-gone-3eb8bb02 turn=0bc24bf1... running=true
```

The ACP socket was refusing every write while the heartbeat kept reporting the turn as running,
and the turn never ended. **The first version of the probe did not catch it**, because it called
`SandboxAgent.getSession()`, which reads a local persist driver and never touches the daemon —
so it answered happily while the sandbox was dead. That is fixed in `5bbd5a36df` and written
into the module docstring so nobody reaches for it again.

Re-run with the corrected probe. The sandbox was killed at 21:32:08, mid tool call:

```
[sandbox-agent] [sandbox-liveness] probe failed (1/3): fetch failed
[sessions/alive] heartbeat OK session=wd-sandbox-gone-75399fc3 turn=c682ebb5... running=true
[sandbox-agent] [sandbox-liveness] probe failed (2/3): fetch failed
[sessions/alive] heartbeat OK session=wd-sandbox-gone-75399fc3 turn=c682ebb5... running=true
[sandbox-agent] [sandbox-liveness] probe failed (3/3): fetch failed
[sandbox-agent] [sandbox-liveness] sandbox is gone: 3 consecutive liveness probes failed (last: fetch failed)
[sessions/alive] heartbeat OK session=wd-sandbox-gone-75399fc3 turn=c682ebb5... running=false
```

The turn ended at 21:33:30, 82 seconds after the kill, and the last line is the point of the
whole exercise: the beat that used to say `running=true` for ever now says `running=false` once
and stops.

The client's stream carried a real ending rather than closing on a broken pipe:

```
error:  {"type": "error", "errorText": "The sandbox running this session stopped responding,
         so the run was ended. Send the message again to start a fresh sandbox."}
finish: {"type": "finish", "messageMetadata": {...}}
```

And the durable transcript for that turn, read back from the records endpoint:

| Record | Content |
|---|---|
| `message` | the user's prompt |
| `message` | "I'm running the command and will report its output when it completes." |
| `tool_call` | `sleep 240 && echo finished` |
| `usage` | the turn's token accounting |
| `error` | `code: sandbox_gone`, with the line above |
| `done` | terminal |

The stream row ended as `is_alive: true, is_running: false`. That is the intended result and not
an oversight: the turn is over, and the session stays alive and reattachable. Only the runner
being gone entirely makes a session not alive.

Without this change the same kill produced, and stopped at, this — captured on the first attempt:

```
Error: connect ECONNREFUSED 127.0.0.1:35171
[sandbox-agent] unhandledRejection: TypeError: fetch failed
[sessions/alive] heartbeat OK session=... running=true      <- for ever
```

### Reproducing it

```bash
docker exec agenta-ee-dev-session-watchdog-runner-1 sh -c 'ps -eo pid,args | grep "[s]andbox-agent server"'
docker exec agenta-ee-dev-session-watchdog-runner-1 sh -c 'kill -9 -<pid>'
docker logs -f agenta-ee-dev-session-watchdog-runner-1 2>&1 | grep -E "sandbox-liveness|turn-settle"
docker logs -f agenta-ee-dev-session-watchdog-api-1 2>&1 | grep -i watchdog
```

The stack is left running. To tear it down:

```bash
cd /home/mahmoud/code/agenta-2-worktrees/slice-watchdog
set -a && . hosting/docker-compose/ee/.env.ee.dev.watchdog && set +a
bash ./hosting/docker-compose/run.sh --license ee --dev --env-file .env.ee.dev.watchdog --no-tunnel --down
```

The env file `hosting/docker-compose/ee/.env.ee.dev.watchdog` is gitignored and holds a
stack-local `AGENTA_SERVICES_INTERNAL_KEY` and the QA OpenAI key is in the stack's vault, not in
the repository.

## What this slice does not do

- It does not change `shouldPark` or any teardown rule. An abandoned run keeps its environment
  and still runs its own teardown if it ever unwinds. Reclaiming machines stays with the
  keep-alive pool.
- It does not close the turns ledger. `session_turns.end_time` still stays NULL on a lost turn.
  `SessionTurnsDAO.complete` is idempotent and safe to call, but it needs the turn index, which
  is an extra read per row, and nothing in the transcript depends on it.
- It does not hold a distributed lock across API replicas, because deterministic record ids make
  a concurrent pass harmless rather than merely unlikely. Two replicas would each do the work;
  neither would write a duplicate.
- It does not fix the originating tab. `refreshFromRecords` deliberately early-returns while the
  tab is busy, so a tab holding an open-but-dead HTTP stream ignores the watchdog's records until
  its own stream errors. Other tabs and a reload see the settled turn immediately.

## Open questions for Mahmoud

1. **Is 120 seconds the right time to declare a turn lost?** *Recommendation: ship it and watch.*
   It is three missed heartbeats, and it is now a setting rather than a constant, so a wrong
   answer costs a restart. The old 300 was chosen when the sweep only collapsed flags and nobody
   saw the result.

2. **Should the watchdog also close the turns ledger?** *Recommendation: not in this slice.*
   `session_turns.end_time` stays NULL on a lost turn, which is a real inconsistency, but nothing
   reads it for the transcript and closing it costs a query per row. Worth doing when something
   actually reports on turn durations.

3. **Should the sandbox probe run on Daytona too, given it cannot tell a deleted sandbox from a
   proxy error?** *Recommendation: yes, leave it on.* It is a strict improvement where the proxy
   does refuse, it costs one request per turn per thirty seconds, and the API watchdog is the
   backstop where the proxy answers for a sandbox that is gone.

4. **Does a lost turn deserve a distinct look in the transcript, rather than the same red
   callout as a model failure?** *Recommendation: leave it as it is for now.* The copy and the
   Try again button say the useful part, and a new visual state is worth designing only once we
   know how often users see this.

5. **The runner's SSE read loop swallows a severed stream instead of failing the pending
   request** (`acp-http-client/dist/index.js:335-339`). That is the true root cause of
   [#6418](https://github.com/Agenta-AI/agenta/issues/6418), and this slice bounds it rather than
   fixing it. *Recommendation: raise it upstream rather than growing the local patch.* The patch
   file already carries four changes, and a fifth in the read path is the kind that breaks
   quietly on the next version bump.
