# Daytona harness matrix: Stop with Pi and with Claude Code

> AGENT-GENERATED, low weight. Written on 2026-09-03. Mahmoud decides. Every claim below is
> marked **verified** (observed on the running stack, with a file or a log line) or **reported**
> (taken from another document). No credential value appears in this file.

Stack: `agenta-ee-dev-session-integration` on http://144.76.237.122:8580, worktree
`~/code/agenta-2-worktrees/integration`, branch `agent/session-execution-integration`, commit
`9110c080007fc5a2c0191c72426bff5e99b4c685`. Postgres on host port 5440. The stack was left up
and its runner was not restarted. No file in that worktree was changed and no git command ran
there.

## The answer first

**The Daytona half of this lane is blocked, and the block is a Daytona API key permission, not
the product.** The key in every session worktree's env file can create sandboxes but cannot
manage Daytona Secrets, so every Daytona run fails at sandbox creation in about one second with
the runner's own operator message. There is no plaintext fallback by design, so the two ways out
are a Secrets-capable key or `AGENTA_RUNNER_DAYTONA_OPAQUE_SECRETS=off`. Both are process
environment, so both need the shared stack's runner container recreated, which this lane's brief
forbids. A Secrets-capable key does exist on the box. The lead was asked twice and had not
answered when this file was written. **Everything else in the brief was run on the local sandbox
provider instead, and it found three defects, one of which breaks a Stop the browser sends every
day.** The headline: a Stop that names the turn it is watching is REFUSED while that turn waits
on an approval, on both harnesses. The integration lane's approval cell passed only because its
driver sent no expectation.

## Scenario table

Every row ran on commit `9110c080` against the stack above. "Provider" is `local` on every row,
because Daytona is blocked. Timings are the Stop request's own wall clock.

| # | Scenario | Harness | Provider | Result | Stop latency | Harness cancel | Evidence |
|---|---|---|---|---|---|---|---|
| 1 | Stop during model output | pi_core | local | **Pass on the turn, command row lost, see finding 3** | 202 in 248 ms, stream ended 1.119 s after the request | 16 ms | `pi-local-all.json`, cell `stop-output` |
| 2 | Stop during a long tool | pi_core | local | **Pass** | 202 in 104 ms, stream ended 893 ms after the request | 17 ms | `pi-local-all.json`, cell `stop-tool` |
| 3 | Stop awaiting approval | pi_core | local | **Fail with an expectation, pass without** | 409 in 45 ms with the expectation; 202 in 100 ms without | not reached | `probe-pi-local.json` |
| 4 | Continue after each Stop | pi_core | local | **Pass**, all three | resume 1.6 s to 5.5 s | — | `pi-local-all.json`, `probe-pi-local.json` |
| 5 | Stop during model output | claude | local | **Pass** | 202 in 79 ms, stream ended 172 ms after the request | 42 ms | `claude-local-all2.json`, cell `stop-output` |
| 6 | Stop during a long tool | claude | local | **Pass** | 202 in 169 ms, stream ended 297 ms after the request | 50 ms | `claude-local-stop-tool2.json` |
| 7 | Stop awaiting approval | claude | local | **Fail with an expectation, pass without** | 409 in 56 ms with the expectation; 202 in 107 ms without | not reached | `probe-claude-local-platform.json` |
| 8 | Continue after each Stop | claude | local | **Pass**, all three | resume 1.8 s to 4.4 s | — | `claude-local-all2.json`, `claude-local-stop-tool2.json` |
| — | Every scenario | both | **daytona** | **Blocked** | run failed in 1.1 s at sandbox creation | — | `pi-stop-output.json`, `daytona-key-permission-probe.txt` |

Raw evidence, drivers and logs: `~/agenta-qa-evidence/2026-09-03-session-round2/daytona/`.

### What each pass rests on

Row 1 and row 5 (**verified**). The terminal record carries `stopReason: cancelled`. The runner
logged `park-cancelled ... ttl=60000ms`, so the sandbox stayed warm, and the next turn logged
`hit-continue` on the same pool key. The continuation recalled the build id the first turn was
given. On row 5 the command row settled `applied` with outcome `stopped` in 37 ms. **Row 1's
command row did not settle**: it is the first of the two occurrences in finding 3, and the
watchdog ended it `lost` 2 minutes 17 seconds later. The turn was cancelled and parked correctly
either way, so the row passes on Stop behaviour and fails only on the command record.

Row 2 and row 6 (**verified**). The same shape, plus the interrupted tool call: the stream ended
`tool-output-error`, which is the `INTERRUPTED_BY_USER` sentinel, and no tool output was
invented. Claude Code's Bash tool refuses a bare foreground `sleep`, so this row runs a ticking
loop instead. See finding 4.

Row 3 and row 7 (**verified**). The gate reached `pending`, the named Stop was refused, the
unnamed Stop moved the gate to `cancelled`, and the late answer through
`POST /sessions/interactions/{id}/respond` was refused with
`409 {"detail":"Interaction is no longer pending"}`. The Claude row raises its gate with a
platform tool, because the Claude harness's own shell tool is not gated. See finding 3.

Row 4 and row 8 (**verified**). Each continuation asked for the build id from before the Stop and
got it back. On the warm rows the runner logged `hit-continue` on the same pool key, so the same
sandbox and the same native harness session answered.

## Findings

### 1. Daytona is blocked by a key that cannot manage Secrets

**Verified.** The first Daytona run failed in 1.1 s with the runner's own message: "Daytona
refused to manage Secrets with this API key. This runner hides each model and MCP key by storing
it as a Daytona Secret, which is the default, and that needs an API key allowed to manage
Secrets, not only to create sandboxes."

Two distinct Daytona keys exist on this box. Both were probed directly against the Daytona API
that the runner's own SDK calls, `/secret` in `@daytona/api-client`'s `secret-api`. Status codes
only, recorded in `daytona-key-permission-probe.txt`:

| Key, by where it lives | `GET /api/sandbox` | `GET /api/secret` |
|---|---|---|
| `.env.ee.dev.integration`, and every other session worktree, and the main tree's `.env.ee.dev.local` and `.env.ee.dev.rel112` | 200 | **403** |
| `agenta/hosting/docker-compose/ee/.env.ee.dev.local`, also the main tree's `.env.ee.dev.preview` | 200 | **200** |

This is the exact split the `daytona-secrets-recut` memory note describes: managing Secrets is a
permission separate from creating sandboxes. It is not the placeholder-401 case, because the run
never reaches a model call. No retry helps.

The runner offers exactly two ways out, and it names them itself
(`services/runner/src/engines/sandbox_agent/daytona-secrets.ts:101`): grant the permission to the
key, or set `AGENTA_RUNNER_DAYTONA_OPAQUE_SECRETS=off` to send credentials as plain environment
variables. `services/runner/src/engines/sandbox_agent/run-plan.ts:536` confirms there is no third
path: with the flag on, the plan is always built for a Daytona run. Both fixes are process
environment, so both need the runner container recreated.

**What this lane did not do, and why.** It did not recreate the runner, because the brief forbids
restarting it and another lane is reading this stack's runner log, which a recreate destroys. It
did not deploy a second stack: `free -g` fell from 28 GB available to 14 GB during this session
with swap already full, and adding fifteen containers risks other people's stacks for a benefit a
one-container recreate delivers more cheaply. It did not use another running stack, because the
only one holding the Secrets-capable key runs a branch without the session-control slices, so its
Stop route does not exist.

### 2. A Stop that names its own turn is refused while that turn waits on an approval

**Verified on both harnesses. This is the most serious finding here.**

`POST /sessions/{id}/cancel` with `expected_execution_id` set to the turn the client streamed is
refused with 409 whenever that turn is parked on an approval gate. The same Stop with no
expectation is accepted and cancels the gate correctly. Two arms, three seconds apart, on one
parked gate:

| Arm | Request | Answer | The gate afterwards |
|---|---|---|---|
| A | `expected_execution_id` = the turn id the client streamed | `409 expected execution '...' is not the running execution (current: none)` | still `pending`, nothing written |
| B | no expectation | `202`, execution `stopping` | `cancelled`, late answer refused 409 |

The cause is an asymmetry in `api/oss/src/core/sessions/commands/service.py`. The target is
resolved from Redis `running` with a fallback to `alive`, as the module docstring says at line
14. The expectation is compared against `get_running_owner` alone, at lines 133 to 142. A parked
approval has `running` cleared and `alive` still holding that same turn id, so the comparison can
never match and the Stop is refused before anything is written.

**Why it matters.** The RFC keeps `expected_execution_id` optional but says first-party clients
send it whenever they know it, and the browser always knows it. `useAgentChatSession.ts` reads it
from `getSessionTurnId(sessionId)`, which comes from `message.metadata.turnId`. So a user who
presses Stop on an approval card is refused today. The integration lane's own `stop-approval`
cell passed because its driver called `cancel(session_id)` with no expectation; it never exercised
the shape the browser sends.

**A suggested fix.** Compare the expectation against the same resolved target the admission
already computes, rather than against `running` alone. The parked turn is still the turn the user
is watching, and it is the turn `_resolve_target` picks.

Evidence: `probe-pi-local.json` (Pi, shell gate) and `probe-claude-local-platform.json` (Claude,
platform gate). The driver is `approval_stop_probe.py`.

### 3. A Stop outcome can be refused with 409 and left unsettled for two minutes

**Verified, and reproducible.** Two of ten Pi Stop-during-output turns ended with the runner
logging `[control] outcome HTTP 409` and the command row stuck in `claimed` with no outcome. The
turn itself was always correct: `stopReason: cancelled`, the sandbox parked, the warm resume
recalled its marker. Only the command row was lost.

One measured case end to end, command `01a0672d-c211-7142-aac5-ea077b66bf37`:

| Time (UTC) | What happened |
|---|---|
| 12:10:47.173 | row created, `pending` |
| 12:10:47.235 | `[control] outcome HTTP 409`, the runner's report refused |
| 12:10:47 to 12:12:47 | row `claimed`, no outcome, and `session_streams.stopping_turn_id` still set |
| 12:12:47.404 | the watchdog settled it `obsolete` with outcome `lost` |

That is **120 seconds** during which the session reads "stopping", and a Stop that worked is
recorded as `lost` rather than `stopped`.

This looks like a residual race after the integration lane's fix one. That fix retries the
settlement against `pending` when the claimed guard finds nothing. Here the report loses the
claimed guard, re-reads the row, and by then the claim has committed, so `stored.state ==
pending` is false and the fallback does not fire either
(`api/oss/src/core/sessions/commands/service.py:498-527`). The window is the gap between the two
reads. A settle that accepts either `pending` or `claimed` in one guarded write would close it.

Evidence: `race-pi-local.json`, six runs, one `UNSETTLED`. The earlier occurrence is in
`pi-local-all.json`, cell `stop-output`, command `01a0671c-1b2e-75f2-8b7f-4fb589f50efd`, settled
`lost` after 2 minutes 17 seconds. The driver is `outcome_race_probe.py`.

### 4. Two Claude Code harness facts the test plan should know

**The Claude harness's own shell tool is not gated by `runner.permissions.default = "ask"`.**
**Verified.** With `ask`, the Claude harness ran `echo hello` and answered DONE with no approval
card, no interaction row, and no permission line in the runner log; the same config on Pi raised
a `tool-approval-request` and a `pending` interaction every time. Platform tools such as
`read_config` DO raise a real card on Claude, so the gate machinery works and it is the harness
builtin that is ungated. This is why scenario 3 on Claude uses a platform tool. Evidence:
`claude-local-all2.json` cell `stop-approval` against `pi-local-all.json` cell `stop-approval`,
and `claude-local-tool-platform.json`.

**Claude Code refuses a bare foreground `sleep` and will background a long command.** **Verified.**
Asked to run `sleep 45` and wait, the harness first errored, then retried with
`run_in_background: true`, so the turn ended in 9.8 s with nothing left to Stop and the Stop got
409. Told explicitly not to background it, the harness answered that "the Bash tool blocks bare
`sleep` commands to prevent unproductive blocking". A ticking loop that prints output runs in the
foreground on both harnesses and is what row 6 uses.

### 5. A Stop that loses the race by a moment destroys the warm sandbox

**Verified once, and the code agrees.** In one Claude run the harness settled its prompt with
`stopReason=end_turn` at 11:44:14.001 and the Stop's abort landed 158 ms later. The runner then
logged `[keepalive] evict ... reason=no-park:end_turn` and the next message rebuilt cold.

`shouldPark` (`services/runner/src/engines/sandbox_agent/engine.ts:37-55`) returns false for any
aborted signal unless the result is `cancelled` and the cancel settled. A turn that finished
normally a moment before the Stop is therefore torn down, where doing nothing at all would have
parked it. The user pays a cold rebuild for pressing Stop as the answer lands. The warm-session
requirement says the sandbox survives every Stop path, and this path is a Stop path.

Evidence: `claude-local-stop-output.json`, session `8c6a4c2c-edd0-4bac-93fc-17e660ac2387`.

## How credentials were obtained

No value is printed here, in any evidence file, or in any message this lane sent.

- **OpenAI model key, for Pi.** Read from `~/.agenta-qa-openai.env` (mode 600) as
  `OPENAI_API_KEY`, by `env.sh`, which exports it without echoing it. Loaded into each test
  project's vault by `POST /api/vault/v1/secrets/` with
  `secret.kind = provider_key` and `data.kind = openai`, referenced from the agent config as
  `connection: {mode: "agenta", slug: null}`.
- **Anthropic model key, for Claude Code.** Read from `~/.agenta-qa-secrets.env` (mode 600) as
  `ANTHROPIC_API_KEY`, by the same `env.sh`. Loaded into the vault of each test project through
  the same endpoint with `data.kind = anthropic`. The subscription path in the
  `subscription-sidecar` skill was not needed and was not used.
- **Admin key.** `AGENTA_AUTH_KEY`, read from
  `hosting/docker-compose/ee/.env.ee.dev.integration`, used only for
  `POST /api/admin/simple/accounts/` to mint a throwaway account per run.
- **Times and projects.** Each run mints its own project and stocks both keys within about 60 ms
  of bootstrap. The projects used: `01a06715-2f57-7a43-bb19-047eed7a16d5` at 13:43:56,
  `01a06716-bd0d-7563-9b0e-bf2fe94ab43a` at 13:45:38,
  `01a06719-6ae0-7c70-9fd4-f94288d27b17` at 13:48:34,
  `01a0671b-e954-7731-b649-a786b6fe83c0` at 13:51:18,
  `01a06727-f2bb-7be1-b839-27b8748d2518` at 14:04:26,
  `01a06729-7667-7412-8932-33bf213b4216` at 14:06:05,
  `01a0672a-d8a3-71d3-baf5-c977e29a5e6c` at 14:07:36,
  `01a0672f-59a0-7922-b3f8-13b18b4b93ee` at 14:12:31 and
  `01a0672f-e1e6-7c81-8a26-12b82361c420` at 14:13:06. All times are local box time.
- **Daytona.** The two platform keys were read from env files only to compare their permissions.
  They were never written anywhere. The probe file records status codes and a truncated SHA-256,
  not key material.

## What this lane did not do

- It did not run a single scenario on the Daytona sandbox provider. Finding 1 says why.
- It did not restart or recreate any container, did not deploy a stack, and did not delete a
  Daytona sandbox. No Daytona sandbox was ever created, so there was nothing to clean up and no
  quota was touched.
- It did not change any code. Every defect above is reported, not fixed.
- It did not drive the browser. Every scenario went through
  `POST /services/agent/v0/invoke`, the endpoint the playground drives.
- It did not measure the harness cancel on Daytona, so the park-versus-delete cost on a real
  paid sandbox is still unmeasured, exactly as spike A left it.

## Open questions for Mahmoud

1. **Which fix closes the approval Stop, the API guard or the client?** *Recommendation: the API
   guard. Compare `expected_execution_id` against the resolved target, not against `running`
   alone.* Reason: the parked turn IS the turn the user is watching, and `_resolve_target`
   already knows that. Telling clients to drop the expectation on approvals would give up the
   late-Stop guard exactly where a stale Stop is most likely, because an approval card can sit on
   screen for minutes.

2. **Should a settle accept `pending` or `claimed` in one write?** *Recommendation: yes.* Reason:
   the two-read fallback added by the integration lane closes most of the race but not the middle
   of it, and the residual costs the user two minutes of "stopping" and mislabels a working Stop
   as `lost`. One guarded write over both states has the same safety, since both states mean no
   other writer holds a terminal outcome.

3. **Should `runner.permissions.default = "ask"` gate the Claude harness's own shell?**
   *Recommendation: decide it deliberately and write it down either way.* Reason: today Pi gates
   its builtin shell and Claude does not, so the same agent configuration has two different
   safety postures depending on the harness, and nothing in the product tells the user which one
   they have. If the answer is "it cannot be gated", the config UI should say so.

4. **Should a Stop that arrives after the turn ended park instead of evicting?**
   *Recommendation: yes, park it.* Reason: the sandbox is idle and healthy, the turn ended
   cleanly, and the only reason it is destroyed is that an abort signal arrived a moment late.
   The user is punished with a cold rebuild for a race they cannot see.

5. **How should this box get a Secrets-capable Daytona key into the dev env files?**
   *Recommendation: replace the key in `.env.ee.dev.local` in the main tree, which every new env
   file is copied from, and re-run this matrix.* Reason: the bad key is in seven env files
   already, so every future Daytona lane will hit this wall, and the good key is right there in a
   neighbouring tree. Until then no dev stack can test Daytona at all.
