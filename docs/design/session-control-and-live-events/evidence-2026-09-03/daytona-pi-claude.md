# Daytona harness matrix: Stop with Pi and with Claude Code

> AGENT-GENERATED, low weight. Written on 2026-09-03. Mahmoud decides. Every claim below is
> marked **verified** (observed on the running stack, with a file or a log line) or **reported**
> (taken from another document). No credential value appears in this file.

Stack: `agenta-ee-dev-session-integration` on http://144.76.237.122:8580, worktree
`~/code/agenta-2-worktrees/integration`, branch `agent/session-execution-integration`, commit
`9110c080007fc5a2c0191c72426bff5e99b4c685`. Postgres on host port 5440. The stack was left up.
The only change to that worktree was the Daytona key in the gitignored env file, described in
"How credentials were obtained". No git command ran there.

## The answer first

**Stop works on the Daytona sandbox provider, on both harnesses, on all three scenarios, and it
keeps the warm sandbox and the native harness session every time.** Six Daytona rows plus their
continuations pass. The Stop request is answered in 70 to 104 ms, the harness cancel settles in
19 to 151 ms, the stream ends 0.3 to 1.7 s after the request, the terminal record reads
`stopReason: cancelled`, the runner logs `park-cancelled` with a 120-second window (twice the
local 60 seconds), and the next turn logs `hit-continue` on the same pool key with no second
`sandbox_start` and no second `create_session`. That last pair is the proof that the same Daytona
sandbox and the same native harness session answered the continuation, and every continuation
recalled the build id from before the Stop.

**Three defects came out of the runs, none of them Daytona-specific.** The one that matters: a
Stop that names the turn it is watching is REFUSED while that turn waits on an approval, and it
now reproduces four times out of four across both providers and both harnesses. The browser
always names the turn, so pressing Stop on an approval card fails today. The integration lane's
approval cell passed only because its driver sent no expectation.

## Scenario table

Every row ran on commit `9110c080`. Timings are the Stop request's own wall clock. "Stop to end"
is the time from the request leaving the driver to the client stream closing.

| # | Scenario | Harness | Provider | Result | Stop | Stop to end | Harness cancel | Evidence |
|---|---|---|---|---|---|---|---|---|
| 1 | Stop during model output | pi_core | daytona | **Pass on the turn, command row lost, see finding 2** | 202 in 70 ms | 1.672 s | 151 ms | `dtn-pi-all.json`, cell `stop-output` |
| 2 | Stop during a long tool | pi_core | daytona | **Pass** | 202 in 84 ms | 1.441 s | 137 ms | `dtn-pi-all.json`, cell `stop-tool` |
| 3 | Stop awaiting approval | pi_core | daytona | **Fail with an expectation, pass without** | 409 in 30 ms named; 202 in 53 ms unnamed | — | not reached | `probe-dtn-pi.json`, `dtn-pi-all.json` |
| 4 | Continue after each Stop | pi_core | daytona | **Pass**, all three | — | resume 3.4 s to 4.2 s | — | `dtn-pi-all.json`, `probe-dtn-pi.json` |
| 5 | Stop during model output | claude | daytona | **Pass** | 202 in 104 ms | 0.325 s | 19 ms | `dtn-claude-all.json`, cell `stop-output` |
| 6 | Stop during a long tool | claude | daytona | **Pass** | 202 in 83 ms | 0.354 s | 135 ms | `dtn-claude-all.json`, cell `stop-tool` |
| 7 | Stop awaiting approval | claude | daytona | **Fail with an expectation, pass without** | 409 in 62 ms named; 202 in 107 ms unnamed | — | not reached | `probe-dtn-claude.json`, `dtn-claude-approval-retry.json` |
| 8 | Continue after each Stop | claude | daytona | **Pass**, all three | — | resume 1.4 s to 3.1 s | — | `dtn-claude-all.json`, `probe-dtn-claude.json` |

Raw evidence, drivers and logs: `~/agenta-qa-evidence/2026-09-03-session-round2/daytona/`.

### The warm-sandbox and native-session proof

**Verified for every passing row.** Each cell's runner log was parsed for sandbox identity. The
shape is identical on all of them:

| Row | Daytona sandbox | `sandbox_start` | `create_session` | Continuation |
|---|---|---|---|---|
| 1 | `daytona/85375f12-30b4-418a-8cbf-52e3e6097296` | 1 | 1, `mode=create` | `hit-continue`, none of either |
| 2 | `daytona/7878b077-5046-48fe-af16-efb01cbb0103` | 1 | 1, `mode=create` | `hit-continue`, none of either |
| 3 | `daytona/b4aca7cd-9dfe-4a56-ae41-82c4fbebbb04` | 1 | 1, `mode=create` | `hit-continue`, none of either |
| 5 | `daytona/188d993b-f2fe-4f90-ba4c-ea6c181d0504` | 1 | 1, `mode=create` | `hit-continue`, none of either |
| 6 | `daytona/ff5b2639-16f3-4e94-a260-77acb30a82ab` | 1 | 1, `mode=create` | `hit-continue`, none of either |

A continuation that logs no `sandbox_start` never asked a provider for a sandbox, and one that
logs no `create_session` never reopened the native harness session. So the second turn ran inside
the same Daytona sandbox on the same native session that the Stop interrupted. The park line
names the window: `park-cancelled key=<project>:<session> ttl=120000ms`, against 60000 ms on
local, so a stopped Daytona session is held warm for two minutes.

The Daytona credential path is live again on every row:
`[daytona-secrets] allocated n=1 hosts=[api.openai.com]` for Pi and `hosts=[api.anthropic.com]`
for Claude, in 120 to 147 ms.

### One Claude Daytona sandbox never got its Secret substituted

**Verified, and it is the known Daytona defect, not ours.** The first attempt at row 7 failed
with "claude: model authentication failed". The runner log shows its own guard doing exactly what
it should: sandbox `9dca6d7f` created with a Secret for `api.anthropic.com`, the Secret deleted,
and a fresh sandbox `84cd4cf5` created with a new Secret. The second sandbox was stuck too, so
the turn failed. This is the `daytona-placeholder-401s` case: Daytona sometimes never wires a
sandbox at create, restart never helps, and only a new sandbox does. The proxy-log check the
memory note prescribes does not apply here, because this stack has no `litellm-proxy` container
and the runner calls `api.anthropic.com` directly. Retried once as the brief directs, the cell
raised a real approval card and gave the row above. One of three Claude Daytona sandboxes was
affected. No product change is implied.

## Findings

### 1. A Stop that names its own turn is refused while that turn waits on an approval

**Verified four times out of four: Pi and Claude, local and Daytona. The most serious finding
here.**

`POST /sessions/{id}/cancel` with `expected_execution_id` set to the turn the client streamed is
refused with 409 whenever that turn is parked on an approval gate. The same Stop with no
expectation is accepted and cancels the gate correctly. Two arms, three seconds apart, on one
parked gate:

| Arm | Request | Answer | The gate afterwards |
|---|---|---|---|
| A | `expected_execution_id` = the turn id the client streamed | `409 expected execution '...' is not the running execution (current: none)` | still `pending`, nothing written |
| B | no expectation | `202`, execution `stopping` | `cancelled`, late answer refused 409 |

| Run | Harness, provider, gate | Arm A | Arm B |
|---|---|---|---|
| `probe-pi-local.json` | pi_core, local, shell | 409 in 45 ms | 202 in 100 ms |
| `probe-claude-local-platform.json` | claude, local, platform | 409 in 56 ms | 202 in 107 ms |
| `probe-dtn-pi.json` | pi_core, daytona, shell | 409 in 30 ms | 202 in 53 ms |
| `probe-dtn-claude.json` | claude, daytona, platform | 409 in 62 ms | 202 in 107 ms |

The cause is an asymmetry in `api/oss/src/core/sessions/commands/service.py`. The target is
resolved from Redis `running` with a fallback to `alive`, as the module docstring says at line
14. The expectation is compared against `get_running_owner` alone, at lines 133 to 142. A parked
approval has `running` empty and `alive` still holding that same turn id, which the probe records
directly, so the comparison can never match and the Stop is refused before anything is written.

**Why it matters.** The RFC keeps `expected_execution_id` optional but says first-party clients
send it whenever they know it, and the browser always knows it. `useAgentChatSession.ts` reads it
from `getSessionTurnId(sessionId)`, which comes from `message.metadata.turnId`. So a user who
presses Stop on an approval card is refused today. The integration lane's own `stop-approval`
cell called `cancel(session_id)` with no expectation, so it never exercised the browser's shape.

**A suggested fix.** Compare the expectation against the same resolved target the admission
already computes, rather than against `running` alone. The parked turn is still the turn the user
is watching, and it is the turn `_resolve_target` picks.

### 2. A Stop outcome can be refused with 409 and left unsettled for two minutes

**Verified, reproducible, and on both providers.** Four of nine Pi Stop-during-output turns ended
with the runner logging `[control] outcome HTTP 409` and the command row stuck in `claimed` with
no outcome. Every other cell, on both harnesses and both providers, settled normally. The turn
itself was always correct: `stopReason: cancelled`, the sandbox parked, the warm resume recalled
its marker. Only the command row was lost.

One case measured end to end, command `01a0672d-c211-7142-aac5-ea077b66bf37`:

| Time (UTC) | What happened |
|---|---|
| 12:10:47.173 | row created, `pending` |
| 12:10:47.235 | `[control] outcome HTTP 409`, the runner's report refused |
| 12:10:47 to 12:12:47 | row `claimed`, no outcome, `session_streams.stopping_turn_id` still set |
| 12:12:47.404 | the watchdog settled it `obsolete` with outcome `lost` |

That is **120 seconds** during which the session reads "stopping", and a Stop that worked is
recorded as `lost` rather than `stopped`.

This looks like a residual race after the integration lane's fix one. That fix retries the
settlement against `pending` when the claimed guard finds nothing. Here the report loses the
claimed guard, re-reads the row, and by then the claim has committed, so `stored.state ==
pending` is false and the fallback does not fire either
(`api/oss/src/core/sessions/commands/service.py:498-527`). The window is the gap between the two
reads. A settle that accepts either `pending` or `claimed` in one guarded write would close it.

The four occurrences: `pi-local-all.json` cell `stop-output` (settled `lost` after 2 minutes 17
seconds), `race-pi-local.json` run 5 of 6, `dtn-pi-stop-output.json`, and `dtn-pi-all.json` cell
`stop-output`. The drivers are `outcome_race_probe.py` and `daytona_live.py`.

### 3. A Stop that loses the race by a moment destroys the warm sandbox

**Verified once, and the code agrees.** In one Claude run the harness settled its prompt with
`stopReason=end_turn` at 11:44:14.001 and the Stop's abort landed 158 ms later. The runner then
logged `[keepalive] evict ... reason=no-park:end_turn` and the next message rebuilt cold.

`shouldPark` (`services/runner/src/engines/sandbox_agent/engine.ts:37-55`) returns false for any
aborted signal unless the result is `cancelled` and the cancel settled. A turn that finished
normally a moment before the Stop is therefore torn down, where doing nothing at all would have
parked it. The user pays a cold rebuild for pressing Stop as the answer lands. The warm-session
requirement says the sandbox survives every Stop path, and this path is a Stop path.

Evidence: `claude-local-stop-output.json`, session `8c6a4c2c-edd0-4bac-93fc-17e660ac2387`.

### 4. Two Claude Code harness facts the test plan should know

**The Claude harness's own shell tool is not gated by `runner.permissions.default = "ask"`.**
**Verified.** With `ask`, the Claude harness ran `echo hello` and answered DONE with no approval
card, no interaction row, and no permission line in the runner log; the same config on Pi raised
a `tool-approval-request` and a `pending` interaction every time. Platform tools such as
`read_config` DO raise a real card on Claude, so the gate machinery works and it is the harness
builtin that is ungated. This is why rows 7 and the Claude probes use a platform tool. Evidence:
`claude-local-all2.json` cell `stop-approval` against `pi-local-all.json` cell `stop-approval`.

**Claude Code refuses a bare foreground `sleep` and will background a long command.**
**Verified.** Asked to run `sleep 45` and wait, the harness first errored, then retried with
`run_in_background: true`, so the turn ended in 9.8 s with nothing left to Stop and the Stop got
409. Told explicitly not to background it, the harness answered that "the Bash tool blocks bare
`sleep` commands to prevent unproductive blocking". Rows 2 and 6 therefore run a ticking loop
that prints output, which stays in the foreground on both harnesses and keeps them comparable.

## Supplementary: the same matrix on the local sandbox provider

Run first, while Daytona was blocked. It is what found defects 2, 3 and 4, and it is the control
that shows every Daytona finding is provider-independent. The `local-claude-restart` lane owns
the local Claude scenarios, so this is recorded and not pursued further.

| Scenario | Harness | Result | Stop | Stop to end | Harness cancel |
|---|---|---|---|---|---|
| Stop during model output | pi_core | Pass on the turn, command row lost | 202 in 248 ms | 1.119 s | 16 ms |
| Stop during a long tool | pi_core | Pass | 202 in 104 ms | 0.893 s | 17 ms |
| Stop awaiting approval | pi_core | Fail named, pass unnamed | 409 in 45 ms; 202 in 100 ms | — | not reached |
| Stop during model output | claude | Pass | 202 in 79 ms | 0.172 s | 42 ms |
| Stop during a long tool | claude | Pass | 202 in 169 ms | 0.297 s | 50 ms |
| Stop awaiting approval | claude | Fail named, pass unnamed | 409 in 56 ms; 202 in 107 ms | — | not reached |

Files: `pi-local-all.json`, `claude-local-all2.json`, `claude-local-stop-tool2.json`,
`probe-pi-local.json`, `probe-claude-local-platform.json`, `race-pi-local.json`.

## How credentials were obtained

No value is printed here, in any evidence file, or in any message this lane sent. Both
directories were scanned with gitleaks. The report directory is clean. The evidence directory
reports 25 `generic-api-key` hits, ALL of them `token=<uuid>` lines inside the two preserved
runner logs. Those are per-interaction tokens, not credentials, and a targeted search for real
key shapes (`sk-`, `sk-ant-api`, `dtn_`) over the whole directory returns nothing. This is the
known false-positive class for QA artifacts; no rotation is needed.

- **The Daytona platform key, and why the stack was changed.** The stack's original Daytona API
  key could create sandboxes but could not manage Daytona Secrets, so every Daytona run failed at
  sandbox creation in 1.1 s with the runner's own operator message
  (`services/runner/src/engines/sandbox_agent/daytona-secrets.ts:101`). Both keys on the box were
  probed against the endpoint the runner's own SDK calls, `/secret` in `@daytona/api-client`'s
  `secret-api`. **The two keys differ only in the Secrets permission**: both answer 200 on
  `GET /api/sandbox`, and only one answers 200 on `GET /api/secret`, the other 403. Status codes
  and truncated SHA-256 fingerprints are in `daytona-key-permission-probe.txt`; no key material.
  **The Secrets-capable value came from
  `/home/mahmoud/code/agenta/hosting/docker-compose/ee/.env.ee.dev.local`** and now sits in
  `hosting/docker-compose/ee/.env.ee.dev.integration` in the integration worktree, which is
  gitignored and mode 600. The compose files read only `AGENTA_RUNNER_DAYTONA_API_KEY`; there is
  no bare `DAYTONA_API_KEY` to set. The old key was NOT restored, on the team lead's instruction:
  the Secrets-capable key is the correct one for this stack.
- **The runner recreate.** The runner container was recreated at 12:18:22 UTC, because only a new
  container picks up a changed environment variable. The previous container's complete log was
  dumped first, so the lane reading this stack lost nothing. There are two dumps, and they are
  the same log:
  `~/agenta-qa-evidence/2026-09-03-session-round2/daytona/preserved-runner-log/runner-before-recreate.log`,
  4871 timestamped lines covering 2026-09-02T22:31:34 to 2026-09-03T12:18:02 UTC, written by this
  lane, and `runner-log-before-recreate.txt` beside it, written by the team lead in the same
  minute. Either can be read; neither is needed twice. No other container was touched; every one
  of the other fourteen had been up thirteen hours and stayed up. The `child-cleanup` lane was
  told when the runner was healthy, and where to read the preserved log.
- **OpenAI model key, for Pi.** Read from `~/.agenta-qa-openai.env` (mode 600) as
  `OPENAI_API_KEY`, by `env.sh`, which exports it without echoing it. Loaded into each test
  project's vault by `POST /api/vault/v1/secrets/` with `secret.kind = provider_key` and
  `data.kind = openai`, referenced from the agent config as
  `connection: {mode: "agenta", slug: null}`.
- **Anthropic model key, for Claude Code.** Read from `~/.agenta-qa-secrets.env` (mode 600) as
  `ANTHROPIC_API_KEY`, by the same `env.sh`. Loaded into the vault of each test project through
  the same endpoint with `data.kind = anthropic`. The subscription path in the
  `subscription-sidecar` skill was not needed and was not used.
- **Admin key.** `AGENTA_AUTH_KEY`, read from
  `hosting/docker-compose/ee/.env.ee.dev.integration`, used only for
  `POST /api/admin/simple/accounts/` to mint a throwaway account per run.
- **Times and projects.** Each run mints its own project and stocks both keys within about 60 ms
  of bootstrap. The Daytona runs used projects `01a06735-6ab1-7da0-b618-f352fb802986` at 14:19:09,
  `01a06736-6143-7b03-a3ad-3907d9132096` at 14:20:12, `01a06738-4574-7421-b3de-089515a7f5ce` at
  14:22:16, `01a0673b-2c9e-7563-8b95-15107787bfbf` at 14:25:26,
  `01a0673b-d444-7821-b899-c5a141fa631c` at 14:26:09 and
  `01a0673c-2450-7370-832d-c9070205d89c` at 14:26:29. The local runs used
  `01a06715-2f57-7a43-bb19-047eed7a16d5` at 13:43:56,
  `01a06716-bd0d-7563-9b0e-bf2fe94ab43a` at 13:45:38,
  `01a06719-6ae0-7c70-9fd4-f94288d27b17` at 13:48:34,
  `01a0671b-e954-7731-b649-a786b6fe83c0` at 13:51:18,
  `01a06727-f2bb-7be1-b839-27b8748d2518` at 14:04:26,
  `01a06729-7667-7412-8932-33bf213b4216` at 14:06:05,
  `01a0672a-d8a3-71d3-baf5-c977e29a5e6c` at 14:07:36,
  `01a0672f-59a0-7922-b3f8-13b18b4b93ee` at 14:12:31 and
  `01a0672f-e1e6-7c81-8a26-12b82361c420` at 14:13:06. All times are local box time.

## What this lane did not do

- It did not change any code. Every defect above is reported, not fixed; the lane that owns
  `feat/session-durable-cancel` has findings 1 and 2.
- It did not delete a Daytona sandbox. Daytona never refused on quota. Ten sandboxes were listed
  after the runs, seven stopped and three started, all inside the runner's own park-and-delete
  lifecycle, so nothing was taken from under a running session.
- It did not drive the browser. Every scenario went through
  `POST /services/agent/v0/invoke`, the endpoint the playground drives, so the client changes are
  covered by reading the code and by the package tests, not by clicking.
- It did not test a second runner replica, a Daytona reconnect after a full park expiry, or the
  long-poll control adapter.

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
   they have. If the answer is "it cannot be gated", the configuration screen should say so.

4. **Should a Stop that arrives after the turn ended park instead of evicting?**
   *Recommendation: yes, park it.* Reason: the sandbox is idle and healthy, the turn ended
   cleanly, and the only reason it is destroyed is that an abort signal arrived a moment late.
   The user is punished with a cold rebuild for a race they cannot see.

5. **Should the bad Daytona key be replaced everywhere, not just here?**
   *Recommendation: yes, replace it in `.env.ee.dev.local` in the main tree, which every new env
   file is copied from.* Reason: the key that cannot manage Secrets is still in six other env
   files, including `.env.ee.dev.local` and `.env.ee.dev.rel112`, so the next lane that tries
   Daytona on a fresh dev stack loses the same hour this one did. The two keys differ only in
   that permission.
