# Local Claude Code Stop, and what a runner restart destroys

> AGENT-GENERATED, low weight. Written on 2026-09-03 by the local-Claude-and-restart lane.
> Mahmoud decides. Every claim below is either **verified** (observed on a running stack, with
> the request, the log line, and the database row quoted) or **read** (taken from the merged
> code, with a `path:line`). Nothing here was merged, pushed, or committed.

## The answer first

Claude Code runs on the local sandbox provider and every Stop path works for it exactly as it
works for Pi: the Stop settles in about 110 to 165 ms, the terminal record says `cancelled`, the
sandbox is parked warm, and the next message lands on the same sandbox and the same native
Claude session and recalls the codeword. Three Stop shapes were driven and all three pass.
A runner restart is a different story, and the result is one clear defect. A `docker restart`
of the runner destroys the sandbox and the native harness session, which is expected on the
local provider, but it also **refuses every continuation for 90 to 150 seconds** with "This
session is already running a turn", even when the Stop settled cleanly before the restart. The
refusal clears only when the API watchdog sweep releases the Redis nest. Conversation content
does survive, but through the client's replayed transcript, not through native resume: the
durable native-session hydration never fires, because a cancelled turn's ledger row is never
completed. That is Spike A's known "a cancelled turn drops its continuity record", and this run
shows it costs more than a cold rebuild.

Two further findings are Claude-specific and matter for the test plan. Claude Code refuses a
standalone `sleep`, so the release gate's `sleep 45` cell cannot be reused unchanged for the
Claude harness. And the Claude harness does not gate its `Terminal` tool under an `ask` policy,
while it does gate its `Write` tool and Pi gates its `Bash` tool under the same configuration.

## Scenario table

Stack `agenta-ee-dev-session-integ2`, EE, dev images, local sandbox provider, on
`http://144.76.237.122:8680`. Worktree `~/code/agenta-2-worktrees/integration`, branch
`agent/session-execution-integration`, commit `9110c080007fc5a2c0191c72426bff5e99b4c685`.

| # | Scenario | Provider | Harness | Result | Timing | Evidence |
|---|---|---|---|---|---|---|
| 1 | Smoke: one plain turn | local | claude | **Pass** | 12.1 s | `smoke.json` |
| 2 | Stop during model output | local | claude | **Pass** | Stop at 1140 streamed characters, settled 165 ms | `claude-stop.json`, cell `stop-output` |
| 3 | Stop during a long-running shell tool | local | claude | **Pass** | settled 155 ms | `claude-stop.json`, cell `stop-tool` |
| 4 | Stop while an approval card waits | local | claude | **Pass** | settled 111 ms, late answer 409 | `claude-stop.json`, cell `stop-approval` |
| 5 | Continuation after each Stop | local | claude | **Pass**, same sandbox and same native session in all three | 1.6 to 2.5 s | same file |
| 6 | Restart the runner after a settled Stop | local | pi_core | **Fail**, continuation refused for 123.6 s | watchdog releases it | `restart-after-stop.json` |
| 7 | Restart the runner under a running turn | local | pi_core | **Pass** for the watchdog, cold for identity | settled 108.3 s | `restart-mid-turn.json` |
| A | Claude `Terminal` under an `ask` policy | local | claude | **Not gated**, the tool just runs | n/a | `probe1.json`, `probe_claude_tool.json` |
| B | Claude `Write` under an `ask` policy | local | claude | Gated, a `user_approval` row appears | n/a | `probe_claude_tool.json` |
| C | Pi `Bash` and `Write` under an `ask` policy | local | pi_core | Gated, the control | n/a | `probe2.json`, `probe_claude_tool.json` |

Raw evidence, drivers and logs: `~/agenta-qa-evidence/2026-09-03-session-round2/local-restart/`.

## The Anthropic key

Loaded from `~/.agenta-qa-secrets.env` (variable `ANTHROPIC_API_KEY`, file mode 600) into the
vault of project `01a0671c-fcc2-7601-b03c-375e24f99f9c` through
`POST /api/vault/v1/secrets/` with `secret.kind = provider_key` and
`secret.data.kind = anthropic`, at 13:39:42 local time on 2026-09-03, answering HTTP 200. Each
later driver run mints its own project and repeats the same load; the last Part 1 run loaded it
at 13:52:26. The value was never printed, logged, or written to a file. The agent configuration
that consumes it is `harness.kind = claude`, `llm.provider = anthropic`, `llm.model = sonnet`,
`llm.connection = {mode: agenta, slug: null}`, which is the vault-backed managed connection.

Claude Code needed nothing the local runner image lacks. The first plain turn answered in
12.1 seconds with a real `text-delta` stream and a `session_turns` row carrying both a native
`agent_session_id` and a `sandbox_id`.

## Part 1: the three Stop shapes on Claude

All three used one project and the durable Stop route `POST /api/sessions/{session_id}/cancel`.

### Stop during model output

The prompt asks for a 3000-word essay and forbids every tool, so the Stop lands while text is
streaming and no tool is running. The driver watches the live frame sink and stops once at
least 400 characters have arrived.

Session `a555ba3b-5bea-4ef3-a51f-4ba33399db01`, turn `f52a61db-aaae-4631-88fb-0fc4c4b656f5`.
1140 characters had streamed. The Stop answered `202` in 85 ms with
`{"execution": {"state": "stopping"}}`. The turn ended 165 ms after the request was sent.

```
11:52:41.256 [control] aborted command=01a0671d-3015-7272-9012-158a609a0346 session=a555ba3b-... turn=f52a61db-...
11:52:41.317 [control] outcome reported command=01a0671d-3015-7272-9012-158a609a0346 session=a555ba3b-... state=stopped
11:52:41.347 [keepalive] park-cancelled key=01a0671c-fcc2-7601-b03c-375e24f99f9c:a555ba3b-... ttl=60000ms
11:52:46.504 [keepalive] hit-continue key=01a0671c-fcc2-7601-b03c-375e24f99f9c:a555ba3b-...
11:52:46.504 [reconcile] shadow key=... harness=claude decision=reuse(hit-continue) plan=reuse(no-op) agree facets=[none]
```

The terminal record is a single `done` with `stopReason: cancelled`. The command row went
`pending` to `applied` / `stopped`, created at `11:52:41.228911+00` and settled at
`11:52:41.277605+00`, which is 49 ms. The continuation recalled `ESSAY81BB85` in 2.0 seconds.

### Stop during a long-running shell tool

This cell needed a new prompt. Claude Code refuses a standalone `sleep`, so the design's
`sleep 45` tool never runs on the Claude harness. See the findings. The prompt instead asks for
`until [ -f <a file that never appears> ]; do sleep 2; done` and forbids backgrounding it, which
Claude Code runs in the foreground with a ten-minute tool timeout.

Session `29ecc220-495e-4bba-b51b-462f2e517c26`, turn `cf79e7e2-758f-48d9-bf1f-79e7e541735c`.
The Stop was sent while the `Terminal` call was on the wire. It answered `202` in 81 ms and the
turn ended 155 ms later, with `park-cancelled` at `11:53:00.270` and `hit-continue` at
`11:53:05.480`. The command settled `applied` / `stopped` in 48 ms. The terminal record is one
`done` with `stopReason: cancelled`. The continuation recalled `MANGOBE06B4` in 2.0 seconds.

### Stop while an approval card waits

The gating tool for Claude is `Write`, not `Terminal`. The prompt asks Claude to create a file,
with `runner.permissions.default = "ask"`.

Session `fe766ecd-4c5e-40e2-bde4-11a745cbaace`, turn `13a460f1-5c7a-463c-9b68-50df5b4ffd4b`.
The gate opened as a `user_approval` interaction in state `pending`, the turn's own frames ending
`tool-approval-request`. The Stop answered `202` in 111 ms. Afterwards the interaction read
`cancelled`, and the late answer through
`POST /api/sessions/interactions/{id}/respond` was refused:

```
409 {"detail":"Interaction is no longer pending"}
```

The command settled `applied` / `not_running` in 64 ms, which is correct: nothing was running to
abort. The terminal record for that turn is `done` with `stopReason: paused`, not `cancelled`.
The pool entry survived and the parked gate was answered on the resume:

```
11:53:23.516 [keepalive] resume key=...:fe766ecd-... gates=1 answered=1 carried=0 approve=0 reject=1 tool=Write
11:53:23.543 [sandbox-agent] [keepalive] resume answered gate reply=reject tool=Write
11:53:25.703 [keepalive] hit-continue key=...:fe766ecd-...
```

The first message after the Stop answered the gate rather than the user, exactly as the
integration lane's open question 3 describes: "I wasn't able to write the file, the write
permission was denied." The second message recalled `PEAR9FD425`. So the behaviour the
integration lane saw on Pi reproduces on Claude.

### Sandbox and native session identity across every Claude Stop

Read from `session_turns` on Postgres port 5441. Every cell's continuation kept both ids.

| Cell | `sandbox_id` | `agent_session_id` | Same after the continuation |
|---|---|---|---|
| stop-output | `local/127.0.0.1:46743` | `c32cf324-17a6-459c-a6d4-18a403df7dd0` | yes, both |
| stop-tool | `local/127.0.0.1:35537` | `4429e8ad-9a97-4946-b4f3-3722f0e6ae61` | yes, both |
| stop-approval | `local/127.0.0.1:33069` | `b583d918-a064-4833-9475-1859395fb434` | yes, both |

### Redis after settlement

The same shape in all three cells, read from `redis-volatile` a few seconds after the Stop.
There is no `running:` key: it is correctly cleared. The `alive:` key still names the cancelled
turn, which is the designed nest (`alive ⊇ running ⊇ attached`) and is what keeps the session
reattachable. `redis-durable` holds nothing for these sessions.

```
alive:<project>:session:<session>          -> <the cancelled turn id>
started:<project>:session:<session>:turn:<turn> -> <epoch ms>
superseded:<project>:session:<session>:turn:<turn> -> 1
owner:<project>:session:<session>          -> <a runner replica id>   (short TTL)
```

## Part 2: the runner restart

Driven on Pi, so the model-key path is the one the integration lane already proved.

### Scenario 6: restart after a Stop that had already settled

Run three times. The first two only recorded the refusal; the third retried the continuation
every twenty seconds so the refusal could be timed.

The Stop settled completely before the restart. Session
`25d65917-7df8-41c2-90df-74fa9a778d7c`, turn `3aec93b8-e77f-44d8-a040-b4271cd789ef`: the command
row reached `applied` / `stopped`, the terminal record read `stopReason: cancelled`, the runner
logged `park-cancelled`, and the session row already read `is_running: false` one second before
the restart:

```
{"at": "13:57:37.564", "turn_id": "3aec93b8-...", "flags": {"is_alive": true, "is_running": false, "is_attached": false}}
```

The runner was then restarted at `13:57:38.612` and reported healthy 6.1 seconds later. Every
continuation after that was refused:

| Attempt | Seconds after the restart | Result |
|---|---|---|
| 1 | 9.9 | refused |
| 2 | 30.0 | refused |
| 3 | 50.1 | refused |
| 4 | 70.2 | refused |
| 5 | 90.3 | refused |
| 6 | 123.6 | admitted, recalled `FIG6D67E3` |

The client sees `This session is already running a turn. Your message was not sent.` and the
runner logs the admission refusal:

```
[sessions] admission REFUSED session=25d65917-...; another turn owns this session. No pool resolve, no eviction.
```

The refusal is decided by the platform, not by the runner's memory. `services/runner/src/server.ts:623`
says so: the first heartbeat's atomic `nx` acquire answers `admitted: false`, and the runner
stops there. **Read**, and consistent with the timing: the refusal lasts as long as the
watchdog's 90-second stale-heartbeat threshold plus a sweep tick, which is the same 90-to-150
second budget the watchdog slice ships. The sweep is what releases it, and its own log line
shows it had nothing else to do, because the Stop had already written the turn's ending:

```
11:57:42.518 [WARN.] watchdog: settled a session_stream whose runner went silent
  extra={'session_id': 'b6058c7f-bd15-4ed1-af2f-c04091a9656a', ...}
11:57:42.531 [INFO.] watchdog: settled 1 sessions (0 turns marked lost, 0 commands lost)
```

Zero turns marked lost. The sweep's only real effect here was to free the session.

### Scenario 7: restart under a running turn, with no Stop

Session `b10bc001-3d9b-4c52-a677-34d2495f5bd6`, turn `05bbb71e-c76e-4e47-b7d2-92ed23615542`.
The runner was restarted at `14:00:58.399` while a `sleep 300` tool ran, and reported healthy
12.5 seconds later. The client's stream died with the container, which is expected of a request
whose process is gone:

```
peer closed connection without sending complete message body (incomplete chunked read)
```

The watchdog settled the execution 108.3 seconds after the restart, inside the 90-to-150 second
budget, with exactly one terminal pair and no second ending:

```
error  code: execution_lost  "The agent stopped responding and the run was closed. Send the message again to retry."
done
```

```
12:02:42.602 [WARN.] watchdog: settled a session_stream whose runner went silent
  extra={'session_id': 'b10bc001-3d9b-4c52-a677-34d2495f5bd6', ...}
12:02:42.628 [INFO.] watchdog: settled 1 sessions (1 turns marked lost, 0 commands lost)
```

The session row afterwards reads `is_alive: true, is_running: false`, which is correct. The
continuation was admitted on its first attempt, because the driver had already waited for the
watchdog to settle. It ran cold and recalled `PLUM3C5E70` in 16.8 seconds.

### What survives a runner restart

| Thing | Survives | Mechanism, and how it was observed |
|---|---|---|
| Sandbox identity | **No** | A new `sandbox_id` in `session_turns` after every restart: `local/127.0.0.1:40379` replaced `local/127.0.0.1:34095` (scenario 6), `local/127.0.0.1:46771` replaced `local/127.0.0.1:43091` (scenario 7). On the local provider the sandbox is a process the runner owns, so the process pool dies with the container. The runner does not try to reconnect: it logs `[keepalive] miss key=...; cold` and `[reconcile] shadow ... decision=rebuild(miss) plan=rebuild(rebuild-sandbox)`, then builds a new sandbox from scratch (`stage=sandbox_start ... mode=create`). |
| Harness identity | **No** | A new `agent_session_id` after every restart: `01a06723-77fd-7238-8495-ab1a71ff6900` replaced `01a06721-9e14-7593-ac34-4df95672755e` (scenario 6), `01a06726-9618-7335-a72d-7a17bd125b4f` replaced `01a06724-a357-7af4-96cb-44cb41066184` (scenario 7). The durable path that exists for exactly this case, `hydrateHarnessSessionFromDurable` in `services/runner/src/engines/sandbox_agent/session-continuity-durable.ts:138`, never fired: it logs `[session-continuity/durable] hydrated ...` when it seeds the store, and the runner container logged that string **zero** times across the whole day's runs. |
| Conversation continuity | **Yes** | Both restarts recalled the codeword. It came from the **client's replayed transcript**, not from the harness's own session file: the driver sends the full message history on every turn exactly as the browser does, and the runner rebuilt the session cold (`create_session ... mode=create`, never `session/load`). So the content survives while the native session does not, and the cost is a cold rebuild plus a full replay rather than a warm continuation. |

### Why the harness identity does not survive, precisely

`hydrateHarnessSessionFromDurable` reads the latest `session_turns` row and returns without
seeding the store unless the row has `agent_session_id`, `turn_index` **and** `end_time`
(`session-continuity-durable.ts:170-175`). **Read.** A Stopped turn never gets `end_time`.
**Verified** in Postgres: turn 0 of every stopped session still has a null `end_time` long after
the Stop settled, while a turn that ended normally has one.

```
 turn_index | harness_kind |           agent_session_id           |      sandbox_id       | end_time
          0 | pi_core      | 01a06724-a357-7af4-96cb-44cb41066184 | local/127.0.0.1:43091 |
          1 | pi_core      | 01a06726-9618-7335-a72d-7a17bd125b4f | local/127.0.0.1:46771 | 2026-09-03 12:03:06.473+00
```

So Spike A's note is confirmed as the deciding factor for both (b) and (c), and it decides more
than the spike expected. The spike said a cancelled turn's warm resume works only while the
environment stays in the process pool, and that a restart would make the next turn "rebuild cold
AND replay the conversation as text". That is exactly what happens. What the spike did not
predict is scenario 6: the session is also **unusable for 90 to 150 seconds** after the restart,
because the platform still believes the cancelled turn owns it.

## Findings

1. **A runner restart makes a stopped session unusable for 90 to 150 seconds.** This is the one
   defect worth acting on. Every ingredient of the Stop was correct: the command settled
   `applied` / `stopped`, the terminal record said `cancelled`, `park-cancelled` was logged, and
   the session row read `is_running: false` before the restart. The continuation is still refused
   with a message that tells the user to stop a turn that is already stopped. Only the watchdog
   sweep frees it, and the sweep's own log line says it marked zero turns lost, so its only real
   work was releasing the session. Reproduced three times.

2. **The durable native-session hydration never fires after a Stop.** The code exists and is
   wired, but its `end_time` precondition can never be met by a stopped turn, so the branch is
   dead on exactly the path it was written for. Zero `[session-continuity/durable] hydrated`
   lines in a whole day of runs, including six restarts.

3. **Claude Code refuses a standalone `sleep`.** The `sleep 45` prompt the design and the release
   gate use returns a `tool-output-error` in about six seconds with Claude Code's own guard text,
   "Blocked: standalone sleep 45. To wait for a condition, use Monitor with an until-loop". The
   turn then ends early, so a Stop sent on the design's schedule arrives after the turn is over
   and correctly answers `409 ... is not the running execution (current: none)`. Any Claude cell
   that needs a long-running tool must use the blocking until-loop form and must forbid
   `run_in_background`, because Claude Code otherwise backgrounds the loop and returns at once.
   This is a test-plan fix, not a product defect.

4. **The Claude harness does not gate its `Terminal` tool under an `ask` policy.** With
   `runner.permissions.default = "ask"`, `echo hello` and the blocking loop both ran with no
   approval card and no `session_interactions` row. The same policy gates Claude's `Write` tool,
   and gates Pi's `Bash` and `Write` tools. Checked against the database rather than the API,
   because the API reading is unreliable (finding 5): across the whole day exactly four
   `user_approval` rows exist, two on `claude` turns and two on `pi_core` turns, and both Claude
   rows come from a `Write` call. This one is worth a second opinion from whoever owns the
   permission plan, because it reads as a hole rather than a design choice.

5. **`POST /sessions/interactions/query` ignores a filter sent as `interaction`.** The route
   reads `body.query` (`api/oss/src/apis/fastapi/sessions/router.py:1049`), and the integration
   lane's driver sends `{"interaction": {"session_id": ...}}`, so the filter is silently dropped
   and the call returns every interaction in the project. **Verified**: a query for a Claude
   session returned a Pi session's row. It did not change the integration lane's conclusions,
   because its project held one session at a time, but it will mislead the next reader of that
   driver. Fixed in this lane's copy.

6. **Everything else about Stop behaves identically on Claude and on Pi.** Settle latency, the
   terminal record, the park, the warm continuation, the cancelled approval gate, the refused
   late answer, and the first-message-answers-the-gate behaviour all reproduce. Spike A recorded
   Claude as untested and expected it to behave like the others. It does.

## Open questions for Mahmoud

1. **Should a Stop complete the turn ledger row, so a restart can resume the native session?**
   *Recommendation: yes, and treat it as the fix for finding 1 as well.* Reason: one missing
   `end_time` currently causes three separate losses. It kills the native resume the durable
   hydration was written for, it forces a full cold rebuild plus a transcript replay, and it is
   the state the platform is still holding when it refuses the continuation. This is Spike A's
   open question 4, and this run is the evidence that it is not cosmetic. It needs care, because
   a stopped turn is genuinely not a faithful resume point, so the row probably needs to record
   "ended, and ended by a Stop" rather than simply being marked complete.

2. **Should a continuation refused by admission tell the user to wait, rather than to stop?**
   *Recommendation: yes, a one-line copy change, independent of question 1.* Reason: the current
   text is "Wait for the reply, or stop the turn, then send again", and after a restart there is
   no reply coming and nothing left to stop. Even once question 1 is fixed there will be a window
   where a genuinely lost runner leaves this state, and the honest message is that the previous
   turn is being cleaned up and the session will accept a message shortly.

3. **Is the ungated Claude `Terminal` tool intended?** *Recommendation: treat it as a defect
   until someone who owns the permission plan says otherwise.* Reason: an `ask` policy that lets
   arbitrary shell commands run without a card is the one gap in this area a user would call a
   security bug, and the same policy does gate Claude's file writes, so the machinery is present
   and only this tool escapes it. I did not attempt a fix; the cause is below the runner's gate
   evaluation, in whether the harness raises the permission request at all.

4. **Should the release gate's Stop cell be written per harness, or should the prompt be
   harness-neutral?** *Recommendation: harness-neutral, using the blocking until-loop.* Reason:
   the loop runs on Pi and on Claude, so one prompt covers both and the gate stops carrying a
   `sleep` that silently no-ops on one harness. The cell should also assert that a tool call
   actually reached `tool-input-available` before it sends the Stop, which is what caught this.

5. **Do we need the same restart measurement on Daytona before the RFC is accepted?**
   *Recommendation: no, but say so explicitly in the RFC.* Reason: on Daytona the sandbox is
   remote and `sandbox-reconnect.ts` exists precisely so a resumed session can find it again, so
   the sandbox-identity row of the table above could plausibly read "yes" there while the harness
   identity still reads "no" for the same `end_time` reason. That is a different result, not a
   more complete one, and it costs a Daytona budget to obtain. The finding that matters,
   question 1, is provider-independent.

## What this lane did not do

- It did not change any product code, and it did not commit, push, or merge anything.
- It did not run the browser. Every scenario drove `POST /services/agent/v0/invoke`, the same
  endpoint the playground drives.
- It did not run any scenario on the Daytona provider.
- It did not test the Claude Code subscription path (`~/.claude/.credentials.json`); the vault
  API key worked on the first attempt, so the subscription sidecar was never needed.
- It did not measure scenario 6 on the Claude harness. The refusal is decided by the platform's
  admission acquire, which is harness-independent, so the Pi measurement should carry over, but
  that is an expectation and not a measurement.
- It did not attempt to fix findings 1, 3 or 4.
