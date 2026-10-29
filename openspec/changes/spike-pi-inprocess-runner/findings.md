# Findings: Pi in-process runner spike

Status: spike result, round 1 on 2026-09-23, rounds 2 to 6 on 2026-09-24. Written by the spike agent on a shared dev host, branch `spike/pi-inprocess-runner` (local only).

## Outcome

Status after the final fix batch (2026-09-24, night): Codex round 10's R9-2 (a completed turn lost from native history after a crash) and R9-3 (quoted `Authorization` header) and QA's QAR9-1 (tool-specs file) are fixed with failing tests first; R9-1 (an orphan command of a dead runner writes to the drive) is accepted by name for parity with `daytona`, with an in-sandbox lifetime cap on every command. Not deployed. See "Final fix batch".

Status after round 9 (2026-09-24, night): Codex round 8 is fixed or accepted by name (both P1s fixed with failing tests first, every P2 fixed), and the simplify pass removed the owner-lease plane, 16 of 22 in-process variables and the duck-typed provider checks; `engines/inprocess/` is 5,099 lines (was 5,576), the API diff +445 lines (was +1,395). The live QA's P0 (every `inprocess` turn failed with EACCES as a non-root runner) is fixed in the images and deployed. See "Round 9".

Status after the flag-safety round (2026-09-24, night): with the flag off, `local` and `daytona` differ from `release/v0.121.0` only by the shared changes accepted by name, each adjusted as decided; the shared bugs are fixed with failing tests first; Codex's round 7 P1s and P2s on the 2c code are fixed; the Composio and MCP issues are fixed or recorded as not ours; the configuration reference and the client error codes are documented. Not deployed; the release gate needs a deploy and an OpenAI key in the POC vault. See "Flag-safety round".

Status after round 7 (2026-09-24): the runner-side sync is gone (design 2c). Every Pi tool runs in the command sandbox on its geesefs mount of the drive; the runner opens no path the model chose and mounts nothing; Pi's conversation file goes to its own drive prefix through the object store, out of the sandbox's reach. The two open sync P0s (R6-P0-3, R6-P0-4) are gone with the code they were in. On real Daytona, the first tool call of a conversation takes about 2.7 s (a new sandbox and its mounts), a read-only tool call about 40 to 50 ms warm, a first call after an idle stop about 1.8 s. `engines/inprocess/` shrank from 6,591 to 5,482 lines. Compliance is 33 of 40 met, 5 partly, 2 untested. Found while measuring: a geesefs 0.43 read of a file that shrank behind the mount never ends (every provider; contained for `inprocess`, proposal for the others), and `fusermount -u` does not work inside a Daytona sandbox (`daytona`'s dead-mount cleanup does nothing). Not deployed: the POC deploy is Mahmoud's step (round 7, "Deploying to the POC").

Status after round 6 (2026-09-24): every item of Codex's round 6 review is fixed except the two sync P0s (R6-P0-3, R6-P0-4), which are open by instruction while a separate study decides whether mounting the drive in the sandbox replaces the runner-side sync; their reproductions are skipped tests. A sweep now only touches its own deployment's sandboxes (the deployment is the owner store's own id, not the API's address); a runner that loses its owner registration stops the command running on it and copies nothing back; an ambiguous command is never run again on a replacement sandbox; admission keeps a slot until the provider confirms the sandbox stopped or is gone; output reads are repeatable; a cancelled lock wait is cancelled in flight; and the web never shows a trace's text in place of a withheld error. Each fix has Codex's reproduction as a test, and the ownership fixes were probed live on real Daytona and the POC API's store. Compliance is 32 of 40 met, 6 partly, 2 untested: row 38 went back to partly met because of the two open sync P0s. What remains: the sync decision, the hard-isolation and custom-secret decisions, and a live re-test after the runner is deployed. The code is ready to deploy to the POC ("Deploying to the POC" in round 6).

Status after round 5, kept for history: every item of Codex's round 5 review is fixed, two of the five P0s by construction: a runner now uses only the command sandboxes it created, so a conversation that moves to another runner gets a fresh sandbox restored from the drive, and the per-conversation lease, adoption and quarantine machinery is deleted. A sandbox-side supervisor runs each command (Stop can no longer report a command dead before it starts; output is read back in bounded pieces), a push never goes over unapplied changes, and every conflict copy is checked. The `inprocess` source shrank from 6,362 to 6,116 lines. Independent runner processes were tested for crash takeover, a stall past the owner TTL and a restart, on real Daytona and the API's Redis. QA round 5's P0 (finished turns missing with 2 tabs) is fixed in the shared web. Compliance is unchanged at 33 of 40 met, 5 partly, 2 untested, on stronger evidence. What remains: the hard-isolation decision, the custom-secret design (both written as proposals for Mahmoud), and a live re-test after the runner is deployed. The code is ready to deploy to the POC ("Deploying to the POC" in round 5).

- **It works, and it is faster.** Pi runs inside the runner through the Pi SDK. A Daytona sandbox runs only the shell commands. The first answer comes about 5 to 7 s sooner than on `daytona`: `inprocess` calls the model 38 to 221 ms after the request arrives, `daytona` after 7.9 to 8.8 s (observed).
- **No turn stays silently unfinished.** A soak of 38 sessions on the product path (30 one after another, then 8 at once, mock model, 13 of them running a command) finished 38 of 38. All 38 execution rows are terminal (observed, `evidence/qa-round2/soak.json`). A runner restart mid-turn ends the turn in about 5 s with a readable sentence; a hard kill is closed by the API watchdog after about 128 s (observed, `restart-regression.sh`).
- **Real model.** Groq `openai/gpt-oss-120b`, connected in Settings like a user would, answered through the playground on `inprocess` (observed, `r2-64-groq-ui-no-kit.png`). Multi-step tool use with Groq works on the host runner and on the product path until Groq's free tier cap of 8,000 tokens per minute stops the second model call (observed).
- **The rework.** The provider now has one owner per concern: exact-path file confinement, one command sandbox per conversation, a listing-based sync, Pi built from memory, one credential store per connection, and provider traits instead of id checks. `local` and `daytona` take the same code paths as before.
- **A live proof of concept runs** on a shared dev host. See HANDOFF.md, "Live POC".

Terms used below:
- **Runner**: the Node service (`services/runner`) that receives a `/run` request and drives the agent.
- **Sandbox**: a Daytona sandbox, a remote Linux container billed while it runs.
- **Command sandbox**: the Daytona sandbox that `inprocess` uses only for shell commands.
- **Mock model**: `services/runner/spike/mock-llm.ts`, an OpenAI-compatible server that waits 300 ms before its first token and can be scripted to call tools.
- **TTFT**: time to first token, from the request reaching the runner to the first streamed answer text.
- **Warm pool**: the runner's keep-alive pool that holds a live session between turns.

## Final API QA fixes (2026-09-24, night)

- **QF-A1 (P1), fixed.** An agent that names no `sandbox.kind` ran on `local`: the SDK's `AgentTemplate.sandbox` defaulted to the literal `"local"`, and nothing read `AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER`. On a deployment with `daytona,inprocess`, such a run got a 403. Now the default is the configured default provider when it is enabled, else the first enabled provider, else `local` (`run_default_sandbox_provider` in `sdks/python/agenta/sdk/agents/sandbox_providers.py`, the SDK's existing settings reader). It never raises, so a bad registry still fails at the runner's and the API's boot, not at template parsing. The release has the same bug; accepted by name as a shared bug fix (GOAL.md). Test: `test_default_sandbox_provider.py` (6 cases). SDK unit 3,197 passed; services unit 209 passed; ruff clean.
- **QF-A2 (P1 in the report), not a product bug as reported.** The QA script started its 16 s Stop timer before `paced_invoke` slept for the Groq pacing (up to 95 s), so the Stop reached the API before the turn existed. The API's answer (`execution: idle`, `command.state: obsolete`) is the release's `not_running` branch, correct for that input. The branch does not change that path. A rerun with the Stop timed from the turn's start is in HANDOFF.md, "Deferred".

## Final fix batch (2026-09-24, night): Codex round 10 and QA round 9

Status: done in code and tests, commits `8c5f0f6876` to `b2c34cda21` on `spike/pi-inprocess-runner` (on top of `f0da0c3c84`). Not deployed.

### Decisions (Mahmoud's, recorded)

- **R9-2 is fixed**: the end of a turn waits for its transcript save, bounded.
- **R9-1 is accepted by name, for parity with `daytona`** (also in GOAL.md, "Decisions"). No lease.
- **R9-3 and QAR9-1 are fixed.**

### Items

| Item | Result | Test (failing first) |
| --- | --- | --- |
| R9-2 (P1): a completed turn can vanish from native history after a crash | Fixed. `InProcessAcpSession.prompt` returns only after the conversation file is on the drive, bounded by 15 s (`INPROCESS_LIMITS.transcriptSaveTimeoutMs`). The client's terminal frames come after `prompt` returns, so a runner that dies before the save lands never showed the turn as complete. When the save fails or times out, the turn still completes for the person, the runner logs "conversation file not saved to the drive (...); the next cold resume rebuilds from the conversation's records", and the session reports `nativeHistorySaved() === false`. `run-turn.ts` then does not make the turn a resume point: it drops the in-memory pointer and leaves the ledger row without `end_time`, so the next cold turn, on this runner or another, replays from the API's records (the existing path). The next save that lands (it puts the whole file) makes the file trusted again. A failed-turn rollback whose save does not land returns false (cold replay). The per-turn `pendingSave` chain is gone. | `pi-loop.test.ts` (real Pi loop): "ends the turn only after its conversation file is on the drive" (a 300 ms slow put); "still completes the turn when the save fails" and "... does not finish in time" (the flag goes false, the log names the mismatch, the next turn saves both turns). `failed-turn-continuity.test.ts`: a completed turn with an unsaved file is not a resume point; with a saved file it is, as before. |
| R9-1 (P1): an orphan command of a dead runner can write to the drive after a replacement took over | **Accepted by name** (parity, below). One cheap guard added: every in-process command runs under `setsid timeout -s KILL <lifetime>` in the sandbox, so the whole process group is killed at its lifetime even when no runner polls it. The lifetime is the command's own timeout, never more than the per-tool-call limit (`AGENTA_RUNNER_TOOL_CALL_TIMEOUT_MS`, 30 minutes by default), plus 60 s; while the runner lives, its own timeout or Stop comes first. Before this, a command without a model timeout had no bound in the sandbox (the runner-side timer died with the runner). The supervisor now writes the group id from `/proc/$$/stat` (the group leader is `timeout`). Nothing is done about old sandboxes at runner start-up. | `remote-command.test.ts`: "is killed in the sandbox at its lifetime, with everything it started, though nobody polls it" (a launched `sleep 2.5; echo old > file` with a 1 s lifetime never writes; its background child is gone); the lifetime rule. |
| R9-3 (P2): quoted-JSON `Authorization` bypasses the sanitizer | Fixed in both copies (`errors.ts`, `turnStatus.ts`): the rule allows a closing quote after the header name, so `{"Authorization": "Token abc..."}` becomes `{"Authorization": "Token [secret]"}`. Shared by every provider, inside the accepted sanitizer item. | `sandbox-agent-errors.test.ts` and `turnStatus.test.ts`, the same three vectors. |
| QAR9-1: the `<mount>.tool-specs.json` sidecar is world-readable and never deleted | Fixed. The runner-host write is `0600` (a `chmod` too, for a file an older runner left) and teardown removes it with the relay folder. Applies where the relay folder is on the runner host: `inprocess` and `local` (a Pi run with agent tools). On `local` this is inside the accepted "private relay folder per session" item: the file was left behind before; now it goes with the folder. | `kill-inflight-scope.test.ts`: the file exists at `0600` during the run and is gone after teardown. |
| Stale spike scripts | Deleted: `spike/lease-race.ts`, `takeover-runner.ts`, `two-process-takeover.ts` (it spawns `takeover-runner.ts`), `round6-probe.ts`, `round7-live.ts`, `command-probe.ts`; each imported the removed owner code. `spike/isolation-cost.ts` fails `tsc` only on two `ChildProcess` casts and still runs under `tsx`; kept. `spike/audit-intervals.ts` is untracked and not this agent's; not touched. | `tsc` over `spike/**` |
| `DaytonaSandbox.createdAt` | Removed from the interface and both implementations; nothing read it after the sweep went. The local test stand-in keeps its own field (a test reads it). | `tsc` |
| Transcript signer | Merged into the workspace: `ConversationWorkspace.signTranscriptMount`, replaced by `hold` for each environment. The registry's parallel `signers` map and its three deletes are gone. | the Pi loop and restart tests |
| `InRunnerHarness.start()` and the env handle types | Left as they are. `env.sandbox` and `env.session` are `any` on the release's shared `SessionEnvironment` for every provider; a typed start result would not remove the three `Partial<...>` casts without typing that shared environment as a union, a refactor of release code. | |
| The remaining `"daytona"` comparisons | All provider selection, none gate in-process behavior: `run-plan.ts:812` sets the release's `plan.isDaytona` (the `daytona` provider's own paths); `provider.ts:43` the daemon port of a `daytona/...` sandbox id and `:208` building the `daytona` provider; `session-identity.ts:106` the `daytona` keep-alive settings (`inprocess` has its own branch); `session-coordinator.ts:223` maps a request to its keep-alive provider name, and `:646` refreshes a parked daemon sandbox's Daytona activity, which only a `daytona` session has (an in-process command sandbox has its own idle stop). No change. | |

### Behavior changes to know

- A turn's end can wait up to 15 s longer when the drive is slow or down (the save). Before, the save ran after the turn's end.
- A Stop whose prompt settles only after that save may count as unsettled; the turn then drops its resume point (cold replay next time), which is the safe floor.
- An in-process command with no timeout of its own is killed in the sandbox 30 minutes and 60 s after it started (by default), even while the runner lives. The runner's own tool-call limit ends the turn at 30 minutes already, so a live run sees no change.

### R9-1, the accepted behavior

When a runner dies while a command runs, the command keeps running in its command sandbox and can still write to the drive through the sandbox's mount, until the first of: it ends by itself; its lifetime in the sandbox (above); Daytona stops the sandbox (autostop, 15 idle minutes by default, the `daytona` provider's `AGENTA_RUNNER_DAYTONA_AUTOSTOP_MINUTES`). A replacement runner uses a new sandbox on the same drive. When both write the same file, the last writer wins, with no conflict copy. `daytona` has exactly this exposure today: Pi and its commands run in the sandbox, which keeps running after its runner dies until Daytona's autostop, and a conversation that moves to another runner can meet it on the drive. No lease or fence is built (the owner-lease plane was removed in round 9 by the simplify rule).

### Clarifications of round 9's notes (Codex round 10 found them overstated)

- **The web copy of the error rules was kept, not removed.** `turnStatus.ts` still carries the sanitizer and the provider-body parser; removing them is Deferred (round 9, "Not applied"). Any note that says the web copy was removed is wrong.
- **The bookkeeping budget is `max(the plan's own bucket, the configured budget)`**, and the configured budget is 60,000 per minute by default (`env.py`); 60,000 is not an unconditional minimum.

### Flag-off parity

- R9-2: `run-turn.ts` asks `nativeHistorySaved` only of a session that has it (the in-process one); a `local` or `daytona` session has none, so its resume point is unchanged. Test: the unchanged `failed-turn-continuity.test.ts` cases.
- R9-3: stricter redaction for every provider (improvement), inside the accepted sanitizer item.
- QAR9-1: on `local`, a Pi run with agent tools now writes the specs file owner-only and deletes it at teardown, inside the accepted relay-folder item.
- The command lifetime, the signer merge and `createdAt` touch only `engines/inprocess/`.

### Tests

Runner: 3,779 unit, 26 integration (4 skipped: the real-store suite), `tsc` clean. Web: `pnpm lint-fix` clean; `@agenta/chat` 1,230, `tsc` clean. API: not touched. gitleaks: no leaks in `f0da0c3c84..HEAD`.

### Deploying this batch on the POC

The batch changes the runner and one web package. With the rebase onto `release/v0.121.2` (HANDOFF.md, "Progress"), the POC needs, from this HEAD: `runner` (`--rebuild runner`, then the POC deploy script); `api` (`--rebuild api`); `services` (`--rebuild services`); `web` (`--rebuild web` for web and web-mobile, web-mobile without the build cache for the new `posthog-js` dependency). No migration.

## Round 9 (2026-09-24, night): Codex round 8 fixes and the simplify pass

Status: done in code and tests, commits `982bd6104f` to `b504ec1b38` on `spike/pi-inprocess-runner`. The runner at `45c8621c8a` (the QAP-1 fix) is deployed on the POC by the coordinator; the rest is not deployed.

### Decisions (Mahmoud's, recorded)

- **Parity differences accepted by name** (added to GOAL.md, "Decisions"): the `provider_error` and `sandbox_capacity` codes on `local` and `daytona` (they come with the accepted provider-reason and capacity fixes; GOAL's exclusion means no full error-code project for the old providers); the blank line after the turn-context block (a bug fix); a cancelled empty turn no longer emits the synthetic no-output error (the accepted QA3A-3 fix); the denied-tool icon and the mobile failure-card copy (the accepted QA1 and label fixes).
- **The in-process code loads only when enabled.** `server.ts` imports `engines/inprocess/` on the first in-process run, and only when `inprocess` is in `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS`; the boot check (`assertInProcessEnvironment`) is imported the same way; the in-process keep-alive pool reads no runner config (its size is a constant). Test: `flag-off-loading.test.ts` (a malformed in-process variable is not read, and the module is never evaluated, with the flag off; failed before the change).
- **Bookkeeping budget = max(the plan's own bucket, the configured budget; 60,000 by default).** The middleware looks up the plan for a bookkeeping request (cached, as for every other request) and uses the larger of the plan's tightest matching bucket and the configured budget, so no self-hosted plan gets less than before. Test: `test_platform_bookkeeping_never_gets_less_than_the_plan_gave_it` (a 120,000 plan keeps 120,000; failed first).

### Codex round 8

| Item | Result | Test (failing first) |
| --- | --- | --- |
| P1: a timed-out write can land after a failed delete | Fixed. A retired sandbox stays "unsettled" until its delete is confirmed (at once, or by the slot's reconciliation). No new change (write, edit, command, helper) of that conversation starts while one is unsettled; after the slot wait (20 s in production) the change is refused: "An earlier command or change to the agent's files may still land, because the command sandbox it ran on is not confirmed deleted yet, so this one did not run. Try again in a few minutes." Reads are not blocked. A timed-out change now reports its timeout at once instead of waiting for the delete. | `sandbox-tools.test.ts`, "Codex round 8 P1" (delete fails: the next change and a command are refused, nothing written; after the delete succeeds, changes run) |
| P1: a read can overtake the turn-start refresh | Fixed by construction. `startTurn` only marks the turn; the first tool call of the turn (read, change or command) refreshes the sandbox's view inside its own `bringUp`, bounded by the refresh's own 30 s deadline, and a new mount counts as fresh. A failed or timed-out refresh fails the call with "The agent's files could not be refreshed in the command sandbox for this turn, so this call did not run (it could have seen an old version of a file). Try it again." and the next call refreshes again. The 12 s wait, `withinMs` and the queued refresh are gone. The refresh command is the mounter's (`DriveMounter.refreshCommand`), so tests no longer run a refresh that always failed. | same file, "fails a read with a sentence when the turn-start refresh fails" |
| P2: sanitizer gaps | Fixed in both copies: numeric credential values (`password=123456`), any `Authorization` scheme (`Authorization: Token abc...`), plural key fields (`api_keys`, `secrets`, `passwords`); `max_tokens`/`input_tokens` still stay. One shared pattern is not possible without a new package boundary (runner and web share no module), so the two copies carry identical tests. | `sandbox-agent-errors.test.ts`, `turnStatus.test.ts` |
| P2: restore keeps local-only unsaved history | Fixed: restore removes a local transcript the store does not have unless this process saved it last. | `transcript-store.test.ts` |
| P2: atomic write replaces a symlink | Fixed: the write helper resolves the target (`realpath`) and replaces the target, as the old in-place write did. | `sandbox-tools.test.ts`, "writes through a symlink" |
| P2: route drift test ignores methods | Fixed: the test reads (method, path) from the runner (the URL template, then its `method:`) and the SDK (`client.<method>(f"{api_base}...")`) and compares pairs; a test proves a flipped method is caught. | `test_bookkeeping_routes.py` |
| P2: custom plans lose capacity | Fixed by the max rule above. | `test_throttling.py` |
| P2: flag-off error codes | Accepted by name (above). | |
| Simplify: stale 2b comment in `turn-start-refresh.ts` | Fixed. | |
| Simplify: duplicate provider-body parsing | Not shared: it would need a new package both the runner and the web import. Identical tests instead. | |
| Simplify: inventory | `evidence/change-inventory/INVENTORY.md` marked historical (head `082606a659`) with a "what changed since" note. | |

### Found by the live parity QA during the round (`evidence/qa-parity/REPORT.md`)

- **QAP-1 (P0): every `inprocess` turn failed with EACCES** creating `/home/sandbox/agenta/mounts/...` on the runner. Root cause: not the `isDaytona` id check the report names. The runner-host folder at the sandbox's path is intended (Risk R4: Pi reads the run's `AGENTS.md` there, and one absolute path must name the same folder in both places). The images never created `/home/sandbox/agenta`; a root runner created it on the fly, and since `Dockerfile.dev` runs as `node` it cannot. `Dockerfile.gh` already ran as `node` in the release, so production would have failed the same way. Fix: both Dockerfiles bake `/home/sandbox/agenta/mounts` with mode 1777 before `USER node`, as they do `/var/lib/agenta/mounts`. Test: `runner-image-roots.test.ts`. Committed `45c8621c8a`; deployed by the coordinator.
- **QAP-3: that error reached the client raw** (a host path and a `sudo` command). An exception thrown while the run is planned now goes through `classifyRunError`: for `inprocess` one sentence with a reference, for `local`/`daytona` the redacted first line (a small shared change inside the accepted sanitizer item). Test: `acquire-plan-error.test.ts`.
- **QAP-2 (unconfirmed): a Stop mid-command on `daytona` showed the command's output once.** Not reproduced and no runner gap found: the API answered that cancel with `command.state: "obsolete"`, meaning it did not apply to the running turn (the turn it named was not current), so the command ran to its end as any un-stopped command does. The `daytona` cancel path is the release's. Recorded as unconfirmed; a rerun should send Stop after the tool call is visible.

### Simplify pass (GOAL item 7)

Four review agents (reuse, simplification, efficiency, altitude) over the whole change, plus `research/simplify-skill.md`. Applied (one commit each):

1. **The owner-lease and sweep system is gone** (runner `RunnerOwner`, `ApiOwnerStore`, `sweepSandboxes`, the sweep timers, the owner-loss abort path; API: every `/sessions/control/sandbox-leases/*` route, its service, Redis DAO and Lua scripts, the auth-middleware exemption, and their tests). Under 2c the drive is the only copy of the files, so a sandbox left by a runner that died holds nothing durable; Daytona's own intervals remove it, as they do for `daytona`. The owner and deployment labels stay (the deployment label is a digest of the API address). Given up: an orphan is stopped after 15 idle minutes and deleted 30 minutes later (the `daytona` provider's `AGENTA_RUNNER_DAYTONA_AUTOSTOP_MINUTES`/`AUTODELETE_MINUTES`, now used for command sandboxes too), instead of about 2 minutes by a sweep; while it lives it costs its running or stopped disk. Nothing reads or writes the drive through it. The API loses about 950 lines.
2. **Sixteen of the 22 `AGENTA_RUNNER_INPROCESS_*` variables are constants now.** Kept (a real operator reason each): `SANDBOX_SNAPSHOT` (a slimmer snapshot), `SANDBOX_LABELS` (cost attribution, audits), `IDLE_STOP_MS` (cost against warm starts), `MAX_RUNNING_SANDBOXES` (cost and quota cap), `MAX_SESSIONS` (memory per runner), `ALLOW_ENV_KEYS` (the boot refusal's escape). Removed: `AUTOSTOP_MINUTES`, `AUTODELETE_MINUTES`, `AUTOARCHIVE_MINUTES` (now the `daytona` provider's intervals, no archive), `OWNER_TTL_MS`, `DEPLOYMENT_ID` (with the lease plane), `SANDBOX_IMAGE`, `SANDBOX_CPU`, `SANDBOX_MEMORY_GIB`, `SANDBOX_DISK_GIB` (the command sandbox uses its snapshot or the `daytona` provider's image or snapshot), `MAX_CONCURRENT_SANDBOX_CREATES` (8), `SANDBOX_SLOT_WAIT_MS` (20 s), `HEAP_PRESSURE_RATIO` (0.85), `IDLE_TIMEOUT_MS` (120 s), `MODEL_SILENCE_TIMEOUT_MS` (600 s), `FILE_TOOL_MAX_BYTES` (64 MiB), `SESSION_POOL_MAX` (64). The configuration reference lists the six.
3. **One typed seam for the in-runner harness.** `RunPlan` carries `driveOnRunner`, `harnessInRunner` and `unknownErrorText`; the redundant `plan.isDaytona ||` halves are gone from `mount-lifecycle.ts`, `environment.ts` and `run-turn.ts`; `startTurn`, `onFirstCommand` and `rollbackFailedTurn` are declared on typed handles (`InRunnerSandboxHandle`, `InRunnerSessionHandle`) instead of duck-typed casts; `unknownErrorText()` in `errors.ts` is gone.
4. **Shutdown folds into the existing `interrupted` input**: the `urgent` race kind in `turn-settle.ts` is gone (the file is the release's again); an in-process turn gets a 3 s grace after its abort, inside the 5 s shutdown budget. Change: a displaced or stopped in-process turn that does not unwind is abandoned after 3 s, not 60 s.
5. **The shared subscription-login writer is the release's again** (`lockWithin`, `ABANDONED`, `writeIfUnchanged` and the `signal` option gone). The in-process credential store stops waiting at its deadline and lets the refresh finish under its lock, which writes a rotated token as usual. Given up: a hung refresh holds the lock until it ends (other sessions wait, as before the spike).
6. **One retry layer for interaction create** (`fetchControlPlane` `retryFailures`, 3 attempts inside one 30 s budget); a periodic heartbeat has one timeout. Change: a 429 answer now counts toward the three attempts.
7. **Efficiency**: transcript memory from the file's size (no `JSON.stringify` of the whole transcript per turn); the conversation file uploads after the turn ends, off its path (the next prompt, a rollback and dispose wait for it; given up: a crash in that window loses the last turn from the file, as a failed save already could); the skill snapshot uploads 8 files at a time, marker last; a reopened session's next event index from memory; command output polled at 400 ms unless a full chunk is backed up (was 150 ms whenever any output came); on-demand slot reconciliation at most every 2 s.
8. **Dead code and duplicate facts**: the pre-2c transcript migration (an unshipped layout), the throwaway-run branch (`conversationId` and the transcript store are required), host and session methods nothing calls (`getSession`, `getHealth`, `killSandbox`, `listFsEntries`, host-level permission hooks, `rawRespondPermission`), `isAbortError`, `CommandSandbox.live`, `registry.get`/`size`, `InRunnerRunFacts.durableRoots`, `DaytonaApi.listByLabels`, the stale `stats.sandboxId`; a session's transcript found by Pi's exact file-name rule (`transcriptFileForSession`) instead of a substring; the shared timer bound for the idle stop and the bash timeout; one liveness read and refetch rule in `@agenta/entities` for `/m` and `/w`; comments state facts instead of review rounds.

Not applied, and why:

- **The web copy of the error rules (altitude 4).** Making the runner write classified text into every span needs the classifier inside the Pi extension bundle and covers only the spans the runner emits; traces written by other paths, and every trace already stored, would still reach the web raw. Not bounded; Deferred.
- **Folding the turn refresh into the step's own script (efficiency 6).** It saves one ~50 ms call on the first tool call of a turn only, and would couple the refresh's failure contract into the file helper's error vocabulary that the round 8 P1 fix relies on.
- **`mountpoint` + `stat` instead of `ls` in the mount check (efficiency 4).** Needs the dead-mount reproduction on real geesefs first; Deferred.
- **The duplicate turn-start timeout on `daytona` (altitude 8, second half)** and **the session pool's teardown map (altitude 9)**: both are release code paths for the old providers; the two timers bound different things (the remote process and the client's wait), and merging the map into `session.teardownPromise` would change per-session idempotency for `local` and `daytona`.
- **Reuse of `daytona-provider.ts` helpers (typed not-found, allow-list normalization), one abort/sleep module, one skill walker, the active-turns registry folded into the execution registry, and the `TurnWatchdog` folded into `createRunLimits`**: each touches release code or needs a wider refactor than the reduction it buys tonight; recorded for after the release.
- **Renaming `isDaytona: traits.commandsInRemoteSandbox` in the teardown and acquire inputs**: those types are the release's and have many callers.
- **Test names that carry review rounds**: nits.

### Line counts

| | Before (`638afca083`) | After (HEAD) |
| --- | --- | --- |
| `services/runner/src/engines/inprocess/` | 5,576 | 5,099 |
| Shared source diff against the release (runner outside `inprocess`, API, web, SDK; no tests) | 65 files, +2,984 / -350 | 57 files, +2,233 / -372 |
| Shared diff with tests (no `openspec`, no `inprocess`, no `spike`) | 127 files, +10,932 / -471 | 122 files, +9,643 / -492 |
| API diff | 16 files, +1,395 / -25 | 4 files, +445 / -36 |

### Flag-off parity after this round

New shared changes this round, each small and inside an accepted item: a planning exception reads through the sanitizer (QAP-3); interaction create has one retry layer (429s count toward its three attempts); both runner images carry one more pre-created folder. The typed seam, the loading guard and the liveness refactor keep behavior. The lease routes' removal touches only `inprocess`.

### Tests

Runner: 3,773 unit and 23 integration (4 skipped: the real-store suite, which runs in a container of the runner image), `tsc` clean. API: 6,817 unit (oss and ee) passed, 119 skipped; `ruff format` and `ruff check` clean. Web: `pnpm lint-fix` clean; `@agenta/entities` 2,343, mobile 336, `AgentChatSlice` 355 (1 skipped), `@agenta/chat` 1,213; `tsc` clean for entities, mobile and oss. gitleaks: no leaks in `638afca083..HEAD` (30 commits).

### Deploying this round on the POC

The POC env file (git-ignored) now has `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS=daytona,inprocess` and `AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER=daytona`. Rebuild (not only recreate):
1. `runner`: `--rebuild runner` (Dockerfile changed in `45c8621c8a`; the rest is source), then the POC deploy script. It reads both variables.
2. `api`: `--rebuild api` (the lease routes are gone; the throttling rule changed). It reads both variables too (the enabled set and the default).
3. `web`: `--rebuild web` (web and web-mobile: the liveness refactor and the sanitizer rules; the entrypoint writes the enabled providers into `__env.js` at start).
No migration.

### Deferred (new scope, not done)

- The web copy of the error rules (`turnStatus.ts`) is kept. Removing it by classifying span errors at the source is still to do (above).
- `mountpoint` + `stat` as the mount check, after the dead-mount repro on real geesefs.
- Reuse of the `daytona-provider.ts` helpers, one abort/sleep module, one skill walker, active turns in the execution registry, the in-process watchdog in `createRunLimits`.

## The enabled-list rule (2026-09-25)

Mahmoud's requirement: the frontend preference is the only feature flag for `inprocess`. No deployment setting may be needed to turn it on. On 2026-09-24 a test deployment could not run `inprocess` because `inprocess` was not in its `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS`, and the agent could not change that setting. That was a design mistake: the code should have made the setting unnecessary. Commit `f549b63cf4`.

- **The rule.** Effective enabled providers = the configured list, plus `inprocess` whenever `daytona` is in it. `inprocess` goes last, so a default taken from the head of the list stays `daytona`. A list without `daytona` (for example `local`) does not get `inprocess`: its commands need Daytona. An explicit `inprocess` in the list is kept as written.
- **Where.** Every reader of the list applies the same rule: the runner (`withImpliedProviders` in `config/runner-config.ts`; the default is validated against the effective list, and the startup line prints it, `providers enabled=[daytona,inprocess]`), the SDK (`with_implied_sandbox_providers` in `sandbox_providers.py`, used by `enabled_sandbox_providers`, so `sandbox_provider_enabled`, `select_backend` and `run_default_sandbox_provider` follow), the API mirror (`env.py`, `RunnerConfig.enabled_sandbox_providers`), `web/entrypoint.sh` (the list the picker's deployment gate reads), and the two browser readers of that list (`getEnabledSandboxProviders` in `agenta-shared` and the OSS copy), for a web that runs without the entrypoint.
- **Refusals.** A run that asks for `inprocess` on a deployment without `daytona` is refused as before, and the sentence now says how to enable it: the runner adds "'inprocess' is enabled together with 'daytona'."; the SDK's 403 says "it is enabled together with 'daytona'; add daytona to AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS to enable".
- **A boot risk this rule created, and the fix.** The runner refused to boot when `inprocess` was enabled and a model provider key (or an ambient cloud credential such as `AWS_ACCESS_KEY_ID`) was in its own environment, because every in-process session would use it. With the rule, that refusal would reach every `daytona` deployment that keeps such a variable on the runner. First fix (commit `f549b63cf4`): an implied `inprocess` is dropped with a warning. The test deployment then showed that this is the hosted case: its runner receives the whole stage env file, provider keys included, so it dropped `inprocess` and every `inprocess` run got "not enabled" (`evidence/staging/REPORT-inprocess.md`). That would have made a deployment setting (remove the keys, or `AGENTA_RUNNER_INPROCESS_ALLOW_ENV_KEYS`) necessary again. Second fix: when `local` is not enabled, nothing on the runner reads those variables (`daytona` and `inprocess` runs carry their own keys; the in-process drive uses the mount's own S3 credentials), so the runner removes them from its own process environment at boot and logs their names (never values); `inprocess` stays on. With `local` enabled (its harness processes inherit the runner environment), the first fix stays: an implied `inprocess` is dropped with a warning, and an explicit one refuses the boot. Tests: `credentials.test.ts`, "removes the keys from the runner environment when no local sandbox can inherit them" (failing first) and "drops an inprocess that daytona implied". Risk on the flag-off path: a `daytona`-only runner no longer holds the stage's provider keys; no `daytona` code path reads them (checked: the daemon env is built from the run plan, the Daytona SDK uses its own key, `redaction.ts` reads the variables only to redact their values).
- **Turning `inprocess` off.** Not possible while `daytona` is enabled. The only way without a new variable was new list syntax (for example `-inprocess`), which four parsers (runner, SDK, API mirror, shell) would each have to learn and agree on. Not done, by the brief (no new variable) and by the simplify rule. If an operator needs it later, it is one variable or one syntax, added in the same four places. The per-user preference stays the switch, off by default.
- **What changed on the flag-off path.** A `daytona` runner now reads the `AGENTA_RUNNER_INPROCESS_*` settings at boot (a malformed one fails boot; none is set anywhere today) and loads the in-process module at boot for the key check, as an `inprocess` runner already did. Nothing runs on `inprocess` unless a run asks for it, and the picker offers it only with the preference on. `daytona` and `local` runs are unchanged.
- **Tests.** Runner and web entrypoint tests were written first and seen failing; the Python tests were written with the change. Runner `runner-config.test.ts` (7 new cases: the rule, the default, no `daytona`, explicit entries, `inprocess` as the default, the summary line, the refusal sentence, `withoutImpliedInProcess`) and `credentials.test.ts` (the boot fallback); SDK `test_default_sandbox_provider.py` (6 new cases); services `test_select_backend.py` (`inprocess` allowed on a `daytona`-only deployment, refused without `daytona`, with the sentence); API `test_env_runner_config.py` (3 new cases); web `sandboxProvidersEntrypoint.test.ts` (runs the real `entrypoint.sh` block, and the browser reader). Runs: runner 3,791 unit and 27 integration, `tsc` clean; SDK 3,203; services 211; API env tests 24, ruff clean; `agenta-shared` 554, entity-ui `agentSettings` 28, `pnpm lint-fix` clean, `tsc` clean (shared, oss); gitleaks clean.

## Feature flag (2026-09-24, night)

GOAL.md item 6. Commit `19c49c8507`, web only.

- **What.** A personal preference, "In-process agent runtime", in Settings, Preferences, Feature Flags. Its description: "Beta: offer Inprocess as a sandbox, which runs Pi inside the agent service and starts a sandbox only for commands." Off for everyone until a user turns it on. It is `inprocessSandboxEnabledAtom = userScopedFlagAtom("inprocess-sandbox")`, stored in the browser as `agenta:settings:<userId>:inprocess-sandbox`, like the other personal flags.
- **Where.** The atom is in `web/packages/agenta-shared/src/state/featureFlags.ts`. The row is in the shared `web/packages/agenta-settings-ui/src/PreferencesPage.tsx`, which both `/w` (`oss/.../settings/Preferences/Preferences.tsx`) and `/m` (`mobile/src/features/settings/PreferencesTab.tsx`) render with every binding, so both apps show it with no app code. The sandbox picker (`useModelHarness.tsx`, shared by `/w` and `/m`) offers `inprocess` only when the deployment enables it (`getEnabledSandboxProviders()`) and the preference is on.
- **An agent already saved with `inprocess`.** The picker keeps `inprocess` listed for that agent whatever the preference says, so the agent keeps running and nothing rewrites it. Why this rather than a "hidden by your preference" mark: the picker's normalize effect rewrites any saved value it does not list to the first listed option, and the preference reads off on every first render (the user id settles a tick later). Filtering a saved `inprocess` out would silently switch agents to `daytona`, even for a user who has the preference on. Keeping the saved value listed is one condition and needs no new copy.
- **Superseded on 2026-09-25:** the deployment no longer needs to list `inprocess`; it follows `daytona` ("The enabled-list rule", above). The preference is the only switch.
- **Why no server-side check.** Decided in GOAL.md item 6 by the simplify rule: the deployment's `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS` stays the real gate; the preference only decides what the picker offers, like every other personal flag. A user who sets `inprocess` through the API can run it, which is acceptable for a beta of a provider the operator allowed. A server check can be added later (research: `evidence/feature-flag/RESEARCH.md`, section 3).
- **The default stays the deployment's first enabled provider.** A new agent gets `enabledProviders[0]` (`ensureEnabledSandbox`, unchanged). For `daytona` to be the default, a deployment lists it first: `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS=daytona,inprocess` and `AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER=daytona`. The POC lists `inprocess,daytona` with `inprocess` as the default, so a new POC agent is created as `inprocess` even with the preference off (the picker then keeps it, by the rule above). To see the flag behave as it will in production, change those two lines in the POC env file and recreate the web containers.
- **Tests (written first, failing, then passing).** `agenta-entity-ui` `agentSettings.test.tsx`, four new cases: hidden while the preference is off even when the deployment enables it; offered next to `daytona` once on; still hidden when the deployment does not enable it; a saved `inprocess` agent is not rewritten and stays listed with the preference off (this case fails if the saved-value rule is removed; checked). The shared page's order and storage-key tests in `agenta-settings-ui` (`preferencesPage.test.tsx`), `/w` (`Preferences.test.tsx`) and `/m` (`preferencesTab.render.test.tsx`) include the new row and key. Runs: entity-ui `agentSettings` 28 of 28, settings-ui 127, agenta-shared 543, mobile and oss preferences tests 2 and 2. `pnpm lint-fix` clean; `tsc` clean for oss, mobile, agenta-shared, agenta-settings-ui and agenta-entity-ui.

## Flag-safety round (2026-09-24, night)

Status: done in code and tests, not deployed. With the flag off, `local` and `daytona` now differ from `release/v0.121.0` only by the shared changes accepted by name in GOAL.md, and each of those was adjusted as decided. Codex's round 7 P1s (the 2c code) are fixed first, each with a failing test. The release gate could not run: it needs this code deployed and an OpenAI key in the POC project's vault (the vault holds Groq, OpenRouter, the mock and a ChatGPT login only). Commits `01f69240cc` to `e22b61b5b1` on `spike/pi-inprocess-runner`.

### Shared bugs

| Item | What changed | Test (failing first) |
| --- | --- | --- |
| The "413" rule | Matches 413 only as an HTTP status: at the start of a line (after an optional `Label:`), after `HTTP`, or after `status`/`status code`; also "payload too large". It now runs after the credit and quota rules and before the rate-limit rule (Groq sends its per-request cap as 413 with code `rate_limit_exceeded`). A 401 with request id `req_ab413cd9` reads as an auth failure again; "idle timeout after 413s" is not "too large". | `sandbox-agent-errors.test.ts`, "flag-safety round" |
| The sanitizer | Redacts credentials only: `Bearer`/`Basic` values, the value of a field whose name ends in key, token, secret, password, passwd or credential(s) (so `max_tokens` is not one, and a value of digits only is a count), JWTs, `sk-`/`pk-`/`rk-` keys, and `Token`/`Bot` values that hold a digit. Paths, UUIDs, sandbox ids, organization ids and JSON bodies stay. The web port (`turnStatus.ts`) has the same rules. | same file; `turnStatus.test.ts` |
| Lost HTTP 400 reason | A raw `NNN {json}` provider error shows the body's own `message`, redacted: `provider_error` for a 4xx ("The model provider refused the request (HTTP 400): <reason>. You can keep going..."), and a retry sentence with `runner_error` for a 429 or 5xx. | same file |
| The web `{` `}` check | The run error leads when the runner classified the failure (any code but `runner_error`); braces mean nothing. A raw `NNN {json}` trace body reads as one sentence with its reason; 413 only as a status. | `turnStatus.test.ts`: a `KeyError: {'name'}` trace error now shows as is |
| `sandbox_busy` | Removed (nothing emitted it). | tsc |
| The `pointer` route | Removed with its service method, DAO method, Lua script, validator and tests. The lease record also loses `sandbox_id`, which only the pointer route set; `acquire` no longer returns it (the runner never read it). | `test_there_is_no_pointer_route`; lease tests 57 of 57 on a throwaway Redis |

The provider-error advice sentence changed from "This turn was left out of the conversation" to "You can keep going in this conversation": the failed turn's question now stays (below).

### Accepted shared changes, adjusted

| Item | Decision and why | Test |
| --- | --- | --- |
| Bookkeeping throttle budget | The default is 60,000 requests per minute per organization (was 6,000), above the largest plan's 36,000, so no organization's runner calls get less than the plan gave them before. Chosen over deriving the cap from the plan: that needs the plan lookup the split was made to skip, and the budget is the platform's, not the user's. The route list stays in one place (`_BOOKKEEPING_ROUTES`, 18 routes, not 17). | `test_bookkeeping_routes.py`: reads the runner and SDK sources; fails when the runner calls a run-credential route missing from the list, or a listed route has no caller; and keeps the default above every plan's bucket |
| Control-plane deadlines and retries | One budget for every provider, no gate: 30 s per call (`CONTROL_PLANE_BUDGET_MS`), attempts and waits together. Only idempotent calls go through it: reads, heartbeats, and interaction create, which the API already deduplicates on (project, session, token), so the token is its idempotency key and no API change was needed. The lease `acquire` (not safe to repeat) is sent once. Retries are for 429/502/503/504 only. A transport error is not retried: I first retried it, and 60 runner tests that fail fast on an unreachable API timed out, which is what a turn would do for 30 s per read while the API is down. `createInteraction` keeps its three attempts (any failure; the token makes a repeat safe) inside one 30 s budget instead of three nested ones. | `control-plane-fetch.test.ts` (default budget; a transport error returns at once), `session-interactions.test.ts` |
| Failed-turn history rule | One rule for the cold replay and the in-process rollback: keep the person's message, drop what the agent did (its text, tool calls, tool results, the error). The rollback now goes back to the turn's user message, not before it (Codex round 7 P1). Tool calls go too: in Pi's transcript a tool call cannot stay without its result, and the two paths must agree. | `session-reconstruct.test.ts`; `pi-loop.test.ts` (the question is in the next request and after a reload; the tool call and the refusal are not) |
| Pool eviction wait | The wait for a teardown still running on a key, which the default pool frees before its teardown ends, is bounded to 30 s and then refuses the turn with "The previous run of this conversation is still shutting down, so this turn did not start. Send the message again in a moment." (a public error, `runner_error`). The strict pool's wait on a key it still holds is the release's own and stays unbounded. | `session-pool-teardown.test.ts` |
| Web connection fixes | Kept as they are. | agenta-chat 1,212, agenta-sessions 125, agenta-entities 2,341, agenta-shared 543, mobile 338, AgentChatSlice 355 (1 skipped); the 3-tab test on `daytona` needs the deployed web |

### Codex round 7 (the 2c code)

| Item | Fix | Test |
| --- | --- | --- |
| P1: a timed-out write releases the order | A change whose Daytona call timed out retires its sandbox, and its turn in the change order ends only once that sandbox's delete settled, so a late write cannot land after a later one. Same for a runner helper that timed out. `SandboxUse.retire` now resolves when the delete settled. | `sandbox-tools.test.ts`, "Codex round 7" |
| P1: `O_TRUNC` in place | The write helper writes `.<name>.agenta-<id>` beside the target, `fsync`s it and renames it over the target, keeping the target's mode; on error the temporary file goes. Checked against real geesefs and SeaweedFS: 30 of 30 writes in the store when the call returns, and no temporary object left. | same; `sandbox-drive.test.ts` (real store) |
| P1: a failed flush reads as success | The supervisor records `exit code` and `unflushed` together; an unflushed exit is reported as "outcome unknown: it exited with code N, but its changes to the agent's files could not be confirmed as saved". The workspace flush after a stopped command logs a failure instead of ending in `; true`. | same |
| P1: a bounded stale read answers short | A read that got fewer bytes than the file's size fails with "The file changed in storage while it was read, so the read was stopped. Read it again." and drops the mount's cached state of that file (`.invalidate`), so the next read sees the store. The large-file path compares the downloaded bytes with the size too. | same (a sysfs file reports 4,096 bytes and reads fewer) |
| P1: first reads overtake the refresh | `read`, `ls`, `grep` and `find` wait for a turn-start refresh in progress, bounded to 12 s as `local` and `daytona` wait for theirs. | same |
| P1: a stalled large edit | The download body has a 120 s deadline and follows Stop; `edit` passes the Stop signal to its read (its write, once sent, still lands whole). | same |
| P1: rollback removes the question | See the failed-turn rule above. | `pi-loop.test.ts` |
| P2: a failed first mount | The sandbox is retired, so the next attempt starts on a new one instead of mounting over a dead node. | same, "Codex round 7 P2" |
| P2: `.tools/` on a replacement | A sandbox that replaced one with a dead mount during launch is prepared before the command runs on it. | same |
| P2: transcript restore by size | The store's copy wins unless the local file is the one this process saved last. | `transcript-store.test.ts` |
| P2: refresh logs success on failure | The refresh script exits non-zero when a root fails; `daytona`'s caller checks the exit code, `local`'s `execFile` already rejects, and the in-process caller logs it. | `turn-start-refresh.test.ts` |
| Simplify | `stopWhileRunning` removed; `SerialQueue`'s unused `busy`/`pending` removed; the workspace's own path mapper removed (it asks the drive); the 2b text in `sandbox-drive.ts` replaced; `DRIVE_UNREACHABLE_MESSAGE` no longer says reads still work. | |

### Small items

- **Private relay folder.** The tool relay folder on the runner host is created owner-only (mode 700) and deleted at the environment's teardown, after the relay loop stopped. It applies to `local` too: neutral there, because its processes run as the runner's user and the folder was already recreated each turn. `daytona`'s relay folder, in its sandbox, is unchanged. Honest limit: owner-only keeps other users out; `local` sessions run as the same user as the runner, so it does not separate a `local` session's code from an `inprocess` session's relay on one runner. Tests: `sandbox-agent-workspace.test.ts` (mode), `kill-inflight-scope.test.ts` (deleted with the environment; fails without the change).
- **Runner as a normal user.** `Dockerfile.gh` already ran as `node`. `Dockerfile.dev` now does too: `dist/`, `/pi-agent` and the runner state dir belong to `node`, `HOME=/home/node`, and the Codex adapter pin runs as `node`. Checked in a container of the new image as uid 1000: a geesefs mount with the `local` provider's own mount code against a real store (4 of 4), the Pi extension build in `/app`, the server start. `daytona` mounts happen in the Daytona sandbox and do not depend on the runner's user. An existing runner-state volume created by a root runner is root-owned and needs a one-time `chown` (deploy steps).
- **Old ChatGPT logins.** A session on a runner-host sandbox holds its connection's login folder from acquire to teardown. A sweep at boot and every 6 hours deletes the folders no session holds whose newest change is over 7 days old. "Connection no longer exists" is covered by the same rule: a deleted connection is never used again, so its copy goes within 7 days; asking the API per folder would add a call and a failure mode for no gain, since the API keeps the login of record and delivers it with every run. Test: `subscription-login-retention.test.ts`.

### Composio and MCP (QA report, three issues)

1. **MCP secrets in `daytona`'s secret plan: needed, and not the upstream secret.** With a gateway configured, the SDK resolves every MCP server to Agenta's gateway route (`<gateway>/gateways/mcps/custom/<slug>`) with one header, `X-AG-Credentials`, the run's gateway credential (`sdks/python/agenta/sdk/agents/mcp/resolver.py`). The upstream MCP secret stays in the gateway. On `daytona` the harness runs in the sandbox and is the MCP client, so the sandbox must present that header: it gets a Daytona Secret placeholder, and Daytona substitutes the real value only on egress to the gateway's exact host. So nothing is sent that the sandbox does not use; not changed. The QA's refusal came from the POC's gateway address being plain HTTP on a non-443 port (the internal API address), which a Daytona Secret cannot be pinned to; a production gateway is HTTPS on 443. On `inprocess` the MCP client is in the runner, so the sandbox gets nothing.
2. **`run_tool` with a provider action id: fixed.** `run_tool` accepts the catalog's action id (`HACKERNEWS_GET_MAX_ITEM_ID`) as well as its key (`GET_MAX_ITEM_ID`); both reach the same configured key. An unknown key is still refused with the one sentence, so the policy is not revealed by probing. Test: `gateway-policy-intake.test.ts`.
3. **`search_tools` finds nothing for `hackernews`: Composio's side, not ours.** Probed on the POC (`evidence/flag-safety/search_probe.*`, `search_raw_probe.*`): our API route answers `{"results": []}` before the runner's filter, and Composio's own search, asked with the toolkit hint `hackernews`, returns only other toolkits (`order_desk`, `quickbooks`, `shopify`, ... for "max item id"; `composio_search` for "top stories on hacker news"). The hint is a ranking hint, not a filter (documented in the adapter since 2026-08-27), and our translation correctly drops toolkits the run did not configure. Recorded as not ours. A fallback to the pinned catalog for a scoped search is new scope, so it goes to Deferred.

### Docs

- `docs/docs/self-host/reference/01-configuration.mdx`: a new "In-process" section with the 22 `AGENTA_RUNNER_INPROCESS_*` variables (role, default, Helm path), `inprocess` among the known provider ids, and the two `AGENTA_API_THROTTLING_BOOKKEEPING_*` variables under "Agenta API".
- `docs/docs/misc/07-errors.mdx`: a new "Agent run errors" section: the `data-agent-error` part, and the 16 codes of the agent runtime with what each means and whether a retry helps.

### Parity with the flag off

What still differs from `release/v0.121.0` for `local` and `daytona`, each accepted by name: the error rules above (413, credential-only redaction, provider reasons, `provider_error` and `sandbox_capacity` codes), the failed-turn rule, the 30 s control-plane budget, the bounded pool wait, the bookkeeping budget, the web lead rule and connection fixes, the owner-only relay folder (`local`), the login sweep (`local`), the non-root dev image, `run_tool` taking an action id, the turn-start refresh (round 7). Nothing else in the old paths changed this round.

Tests, all on this tree (`e22b61b5b1`): runner 3,777 unit passed (0 skipped) and 23 integration passed (4 skipped: the real-store suite, run separately in a container of the runner image, 4 of 4), `tsc` clean; API: sessions unit 890 passed (119 skipped), throttling and bookkeeping routes 26 of 26, lease tests 57 of 57 on a throwaway Redis, `ruff format` and `ruff check` clean; web: the six suites above green, prettier and the web lint clean (commit hook); gitleaks: no leaks in `ba6692bb73..HEAD` (15 commits).

**Release gate: not run.** Two blockers. (1) The code under test is not deployed: the POC runs the images built before this round. (2) The gate's `daytona` cells need a vault key the POC project does not have: C4 and X2 use OpenAI, C2 Anthropic, P3 a custom provider on HTTPS port 443 (the mock is on a non-443 port, which Daytona refuses by design). Command, once both are in place (export the three variables):

```bash
export AGENTA_BASE="<the POC URL>" AGENTA_PROJECT_ID="<the POC project id>" AGENTA_API_KEY="<the POC project ApiKey>"
cd .agents/skills/agent-release-gate
uv run resources/qa_product.py --cell C4 --require-store --release-base origin/release/v0.121.0
# and, for the concurrency faults the sandbox engine can hide:
uv run resources/qa_product.py --cell C4 --only burst --only crosstalk --burst-size 8
```

The agent under test must be on `daytona` (the gate's cells pick their provider), and `inprocess` stays off for it (no UI flag exists yet; the gate never selects `inprocess`).

### Decisions taken during the round

1. Credential-only redaction, as instructed; organization ids and JSON bodies are no longer cut. The web does the same, so a raw body can reach the screen only from a trace that is not `NNN {json}`, which is the release's own behavior.
2. The bookkeeping default above every plan instead of a per-plan cap (why above).
3. No transport-error retry in the control plane (why above).
4. The failed-turn rule drops the agent's text and tool calls as well as its results, so the replay and the rollback agree (why above).
5. The strict pool's teardown wait stays unbounded: it is the release's behavior, and bounding it was not accepted.
6. The relay change applies to `local` as well (neutral).
7. The login sweep uses "unused for 7 days" for deleted connections too (why above).
8. `daytona` keeps sending the gateway credential to its sandbox (needed; why above).
9. The release gate is prepared, not run (why above).

### Deferred (new scope, not done)

- A scoped `search_tools` that falls back to the pinned catalog when the provider's search ranks other toolkits first.
- The in-process relay separated from `local` sessions on the same runner (a different user or no shared host): the owner-only folder cannot do it.

## Round 7: all tools in the sandbox (2c)

Status after round 7 (2026-09-24): the runner-side sync is gone. Every Pi tool (`read`, `ls`, `grep`, `find`, `write`, `edit`, `bash`) runs in the command sandbox, on its geesefs mount of the session folder and the agent folder; the runner opens no path the model chose and mounts nothing. The drive holds the only copy of the files, so a stopped, replaced or lost sandbox loses only its own disk. Tested against the local stand-in, against a real store with a real geesefs mount, and on real Daytona. `engines/inprocess/` went from 6,591 to 5,482 lines. The design is in `design.md`, "Round 7". Not deployed: the POC deploy is Mahmoud's step ("Deploying to the POC", below).

**The change of direction.** The round started on option 2b (reads on a runner mount, writes in the sandbox). It was measured, built and tested green. Then Mahmoud chose 2c: every tool in the sandbox. 2c removes what 2b needed to keep two views in step: a runner geesefs mount per conversation, a refresh of the runner's view and a size check after every write, a refresh after every command, and a guard for the runner process against a geesefs read that never ends (found while measuring, below). The price is one Daytona call per read-only tool call (about 40 ms warm) and a read that starts the sandbox when none runs. 2c also closes a question 2b left open: in 2b the runner read files through a mount that another writer (the files pane) could change under it; in 2c only the sandbox reads, and it is refreshed at every turn start.

### Measured first (before building)

Setup (`evidence/round7/`, script `services/runner/spike/round7-measure.ts`, probe `r7probe.py`): the store is a throwaway SeaweedFS 4.47 in a Daytona sandbox of its own, with S3 keys generated for each run, reached over Daytona's public preview URL. Both views reach it over the network, and nothing on the dev box was exposed. The runner view is geesefs 0.43.0 in a container of the runner image on the dev box. The sandbox view is a command sandbox (EU, snapshot `agenta-agent-sandbox-v1`) mounted with `mountStorageRemote`, the `daytona` provider's code. The store sandbox counts as the "remote store": for a real S3 in the same region, the study measured 3 to 7 ms per request, so these numbers are an upper bound. A bare Daytona call took 13 ms (12 to 15).

| What | Measured | Verdict |
| --- | --- | --- |
| Remount after a start from stopped | Stop 1.6 to 1.8 s, start 0.7 to 1.8 s. The mount was gone after 3 of 3 starts. Remount 678 to 705 ms for the session folder plus 600 to 616 ms for the agent folder, one after the other; 3 of 3 then read the files. | Holds. The two mounts run in parallel, so a start from stopped costs about 0.7 s on top of the start. |
| First mount on a new sandbox | 662 ms plus 594 ms (one after the other) | Same as `daytona` today. |
| Turn-start refresh, 1,000 files in 10 folders | Refreshing the root: 42 to 77 ms (100 runs on the runner view: median 51 ms, 0 failures). A full walk after it: 20 to 30 ms. Refreshing all 13 folders: 128 to 272 ms. Refreshing every file: 17 to 30 s. | Holds: refresh the root only, never file by file. |
| What a root refresh makes visible after a files-pane write (straight to S3) | An overwrite, a new file in a folder, a deleted file and a new top-level file, including the listings: 6 of 6 cases on each view, 12 of 12 | One root refresh is enough. geesefs resets the cached state of everything below the refreshed folder. |
| A `write` through the sandbox, warm | The call (one Daytona call: write, `fsync`, report the size) took a median of 44 ms (39 to 60). The runner's refresh of the path took a median of 58 ms (44 to 116). The runner read the new content 20 of 20 times. 1 MiB (upload, move, `fsync`): 98 to 139 ms, 3 of 3. | About 100 ms per write, flat in the folder size. Today's sync: 41 ms to push one edit, plus the listings that grow with the folder. |
| A command's changes, reported by the files newer than a marker | Modify, rename, delete, a new folder, a removed folder, and a delete alone in a sub-folder: 10 of 10 seen after the runner refreshed the listed paths and their folders (121 to 178 ms). | See the next row. |
| What the marker list misses | geesefs gives a folder the newest time of its children, and a rename keeps a file's time. So a command that only deletes or only renames lists nothing. The 10 cases passed only because a parent folder was listed for another change. geesefs times also have one-second resolution, so a marker needs to be set one second back. | The list is not enough on its own: after a command, the runner refreshes the roots instead (about 50 ms, complete). |
| `--enable-perms` | `chmod 755` made in one mount was seen by a second mount made at the same time in the same sandbox, and the script ran. A new file got 644. The live run of the built code (below) showed that a later sandbox does not see the mode: it is not kept in the store. | Used for skills, with the modes set on every boot. |
| The sandbox user | uid 1001 `sandbox`, no `sudo`. `/etc/fuse.conf` has `user_allow_other`. | Nothing can be hidden inside the sandbox's mount, so Pi's conversation file moves to a prefix of its own. |

**No number killed the design** (2b at the time). The costs were about 0.7 s once per sandbox boot, about 50 ms per command and per turn start, and about 100 ms per `write`. The rows about the runner's view (a refresh after each write, the marker list) are what made 2c simpler: with one view there is nothing to refresh after a change.

### The 2c code on real Daytona

`services/runner/spike/round7-live.ts` runs the runner's own code (registry, command sandbox, the geesefs mount in the sandbox, Pi's file tools with our operations, the command supervisor, the conversation file through the store) against real Daytona (EU, `agenta-agent-sandbox-v1`) and the throwaway store, without Pi and without the API. Two runs, `evidence/round7/live-2c-run1.*` and `live-2c.*`; the second is after the fixes the first found (below).

| What | Run 1 | Run 2 |
| --- | --- | --- |
| First tool call, cold (a `read`: create the sandbox, mount both folders, read) | 2,574 ms | 2,729 ms |
| `read`, warm, median (range), 10 calls | 42 ms (40 to 44) | 49 ms (41 to 56) |
| `ls` | 43 ms | 45 ms |
| `find` | 34 ms | 39 ms |
| `grep` | 32 ms | 35 ms |
| `write` (one call: write, `fsync`) | 54 ms | 58 ms |
| `edit` (a read and a write) | 100 ms | 119 ms |
| `bash`, `echo hi` | 55 ms | 60 ms |
| First tool call after a stop (start, mount again, read) | 1,576 ms | 1,802 ms |
| A command that modifies, renames and deletes; `ls` and the store show all of it | yes | yes |
| A files-pane write (straight to the store), seen by the next turn after the turn-start refresh | yes | yes |
| geesefs killed in the sandbox: the next tool call | not tested (the test's own unmount did not work, see below) | the dead mount was found, the sandbox replaced, the read answered, 2,264 ms |
| A skill script whose file is 644 on the drive | failed | ran (mode set in this sandbox) |
| The same skill file, seen from a later sandbox with no modes to set | 644 | 644: the mode is not kept in the store, so it is set on every boot |
| Pi's conversation file | in its own prefix, not in the session folder | same |

Found by run 1 and fixed before run 2:
- **A mount cannot be replaced in place inside a Daytona sandbox.** `fusermount -u` fails there ("No such file or directory"; `/etc/mtab` points at `/proc/mounts`, the sandbox runs under sysbox), and after geesefs is killed, `ls` on the mount point never answered (the Daytona call timed out). So 2c replaces the sandbox when its mount is dead (every file tool call and every command launch checks the mounts first, `ls` bounded to 5 s), and when its mount credentials are about to expire and a newer environment has fresher ones. This also affects `daytona`: its `unmountRemoteDeadMount` does nothing inside a Daytona sandbox. Recorded, not changed (outside this change).
- **Skill modes after a new snapshot on a live sandbox.** The modes were set only when the drive was mounted, so a snapshot that reached the drive later got no modes. Now any change that finds modes not yet set refreshes the sandbox's view and sets them first.

### A geesefs hazard, for every provider

- **What:** a read of a file whose size the mount has cached, after the file got smaller in the store behind the mount's back, never ends. geesefs asks for the old size, gets fewer bytes, and retries the short read forever (up to 1 minute between attempts). The reading process sits in uninterruptible sleep (`D`): `kill -9` does not end it, a Daytona call that runs it never answers, and a refresh of the same file waits behind it.
- **Reproduction (exact, `evidence/round7/measure-run6-hang-unbounded.*` and `measure-run3-hang.*`):** mount a prefix with the `daytona` flags (`--no-detect --fsync-on-close -o allow_other`). `stat` a 1,000-byte file (its size is now cached; its content has not been read). Overwrite the object in S3 with 5 bytes. Read the file. geesefs logs `Error reading 0 +1000 of <key> (attempt N): EOF` every minute, 18 attempts in 18 minutes before the sandbox was deleted.
- **Who is exposed:** any mount that reads a file changed in the store by someone else, before a refresh: a files-pane edit that shrinks a file, then the agent reads it. On `local` and `inprocess` the reader can be the runner itself; on the runner, a stuck read holds one of Node's four file-system threads for good.
- **Newer geesefs:** no fix. The retry loop (`retryRead`, `core/file.go`) is unchanged on master as of 2026-09-09 (v0.43.9 is the latest tag); EOF is retried by design, because S3 can drop a connection mid-body.
- **What contains it:** `--read-retry-attempts N` bounds the loop. With 3 attempts, the stale read returned after 3.0 s with the bytes it had (empty here, not an error), a refresh then took 9 ms, and the next read returned the new content (`measure-run7-hang.*`). What prevents it: refresh before reading anything another writer changed. That is the turn-start refresh (every provider, this round), and for `inprocess` also the refresh after every sandbox write.
- **Applied in this round:** the `inprocess` sandbox mounts run with `--read-retry-attempts 6` (about 31 s of retries, then the read returns what it has); a transient connection drop is still retried long enough. The runner mounts nothing for `inprocess` any more, so no runner thread can be held by it. `local` and `daytona` mounts are unchanged. Proposal for Mahmoud: the same flag for their mounts (`local` reads on the runner host).

### Decisions taken during the round

1. **2c** (Mahmoud). Every tool in the sandbox; the runner mounts nothing.
2. **One Daytona call per read-only tool call.** Pi's tool definitions are kept (name, schema, prompt text, rendering, output). Each call gets operations that answer Pi's several steps from one call: `read`'s check, image sniff and read; `ls`'s check, stats and listing; `find`'s check and glob (the check runs the glob it is about to be asked for). Pi's `grep` spawns ripgrep where Pi runs, so `grep` keeps Pi's definition and output format and runs ripgrep in the sandbox. Why: about 40 ms per call instead of two to four calls.
3. **Reads are not ordered with changes; changes are ordered.** `write`, `edit`, commands and runner helpers run one at a time; a read runs as soon as the sandbox is up. Why: a read has no side effect, and a long command must not hold up a read in the same step.
4. **A write lands whole or not at all, and Stop waits for it.** The write's call is never cancelled once sent; the Stop is reported once it settled (Pi's own tools do the same), and the next change waits. Why: a write cut half way would leave the drive in an unknown state.
5. **A dead mount replaces the sandbox** (above), and a call that found it dead runs once more on the new one: it ran nothing the first time.
6. **Skills.** The runner puts its snapshot on the drive through the object store, once per digest, marker last; the sandbox mounts with `--enable-perms` and sets the executable skill files' modes on every boot. Chosen over copying skills to local disk: the path Pi's prompt shows stays valid and nothing is copied per start.
7. **Pi's conversation file.** Written by Pi to the runner's own disk, put in the session's `pi-sessions` prefix through the object store after every turn and every rollback (bounded to 15 s; a failure is logged and the next turn saves again), and brought back before a session opens. The sandbox's credentials cannot reach that prefix, so no command can read or change the history. A conversation from before round 7 has its file moved out of the session folder on its next resume. Why the object store and not a runner mount: the runner then needs no FUSE mount at all.
8. **No drive, no `inprocess`.** A run with no session or no object store is refused with a sentence naming `local` and `daytona`. Why: without a shared store there is nothing both sides can see, and supporting it would bring a copy protocol back.
9. **No early start** (Mahmoud). The `AGENTA_RUNNER_INPROCESS_SANDBOX_START` setting is removed; the sandbox starts on the first tool call.
10. **A `driveOnRunner` trait** (local true, daytona false, inprocess false) decides whether the runner host mounts the drive, instead of `!isDaytona`. It gates the runner-host mounts, their ENOTCONN remounts, the `agent-files` link repair and the agent mount teardown.

### What changed

- New: `sandbox/sandbox-drive.ts` (the mounts in the sandbox, the mount check, skill modes, replacing on a dead mount or expiring credentials), `sandbox/sandbox-files.ts` (read, write, ls in one call each), `tools/sandbox-search.ts` (grep and find with ripgrep in the sandbox), `workspace/drive-objects.ts` (one prefix of the drive through the object store), `workspace/transcript-store.ts`, `workspace/skill-snapshot.ts`.
- Rewritten: `tools/file-tools.ts`, `conversation-workspace.ts` (reads, ordered changes, commands, turn start), `conversation-registry.ts`, `harness-host.ts`.
- Changed: `remote-command.ts` (the launch checks the mounts; the supervisor flushes with `sync -f` before it records the exit code), `command-sandbox.ts` (a boot counter; the folder creation went, the mount makes them).
- Deleted, with their tests: `workspace/workspace-sync.ts` (865 lines), `workspace/tar-archive.ts` (178), `workspace/sandbox-listing.ts` (115), `workspace/drive-store.ts` (183), `workspace/workspace-fs.ts` (595), `tools/grep-tool.ts` (211), the stale-mount recovery in `index.ts` and the shared `prepareLocalCwd` hook. The skipped R6-P0-3 and R6-P0-4 reproductions went with `workspace-sync.test.ts`: the state they tested (changes waiting to be copied back) no longer exists.
- `engines/inprocess/`: 6,591 lines before, 5,482 after (1,109 fewer: 2,514 lines deleted, 1,405 added). Tests: 1,154 lines deleted, 795 added.

### Tests

- New, against the local stand-in (`tests/unit/inprocess/sandbox-tools.test.ts`, 17 tests): the first tool call starts the sandbox and a read-only call is one sandbox call; write, edit and read; large files through the file transfer both ways; Pi's errors for a missing path, a folder, a file over the limit; a command that changes, renames and deletes, seen by the file tools, and the supervisor's flush; a stopped command flushed; the turn-start refresh of a running sandbox, and nothing started without one; a remount after a start from stopped; one mount for tool calls that arrive together; a dead mount replaces the sandbox (command and file tool); expiring credentials replace it only for fresher ones; an unreachable store says so; a replaced sandbox loses only its own disk; Stop during a write (the write lands whole, the Stop is reported, the next change waits); Stop while waiting (nothing written); skill modes set and the script run.
- New, with the real Pi loop (`tests/integration/inprocess/pi-loop.test.ts`): write, read, edit and read in one turn, with the conversation file only in its own prefix; a skill script run in the sandbox, with the snapshot put on the drive; the history brought back on a runner that lost its disk, and a file from before round 7 moved out of the session folder. The earlier loop tests (approval pause, Stop mid-command, watchdog, restart, refused turn) pass unchanged.
- New, against a real store and a real geesefs mount (`tests/integration/inprocess/sandbox-drive.test.ts`, run by `spike/sandbox-drive-test.sh` in a container of the runner image with a throwaway SeaweedFS): 30 writes in the store when the call returns; a files-pane shrink, new file and delete seen after the turn-start refresh, and the shrunk file read without a hang; a command's changes in the store after the flush; the conversation file in its own prefix and back on another runner. 4 of 4.
- New: `tests/unit/turn-start-refresh.test.ts` (the three providers, and a failure never ends the turn).
- Runner: 3,748 unit tests passed (none skipped: the 6 that needed S3 or geesefs and the 2 sync reproductions went with the sync), 23 integration passed and 4 skipped (the real-store suite, run separately above), `tsc` clean.

### `local` and `daytona` parity

Shared changes, each in its own commit where it could be:
- **The turn-start refresh** (every provider, Mahmoud's item): one more step per turn, a `python3` call on the runner for `local` or one call into the sandbox for `daytona`, bounded to 10 s, never ends a turn; a failure leaves today's behavior (a view up to a minute old). Tested by `turn-start-refresh.test.ts`.
- **The `driveOnRunner` trait**: `local` has it true and takes every mount path as before; `daytona` never took the runner-host paths (`isDaytona`) and still does not. The unit suite covering the environment, mount lifecycle and teardown passes unchanged (one test fixture gained the `sandboxId` every real plan carries).
- **Opt-in geesefs flags**: no existing caller passes them.
- **The `prepareLocalCwd` hook** is removed; only `inprocess` set it.
- **The run facts** gain a signer for the `pi-sessions` prefix, read only by `inprocess`.

### Compliance, round 7

| Status | Round 6 | Round 7 |
| --- | --- | --- |
| Met | 32 | 33 |
| Partly met | 6 | 5 |
| Not met | 0 | 0 |
| Untested | 2 | 2 |

Row 38 (files and commands agree) is met again: there is one view of one copy, and the two open sync P0s are gone with the sync. Two rows change meaning with 2c, and the spec text now says so: "edit without a shell needs no sandbox" (now every tool call starts the sandbox, by design) and "skills readable without a sandbox" (the skill list is built without one; reading `SKILL.md` goes through the sandbox). Both are met under the new text. Still partly met: 4, 20, 22, 25, 32. Untested: 13, 21. The live checks on the POC (GOAL.md, item 2) are the next evidence.

### Not done, and why

- **The POC deploy and its live test:** Mahmoud's step; the deploy steps are below. The auto-mode classifier refused the POC deploy script from this agent as a production deploy.
- **The private relay folder per session, the non-root runner and the login-file cleanup:** GOAL.md item 2, next.
- **`verify_refusal.py`'s hardcoded connection slug:** not touched in this round (that folder was not changed).

### Deploying to the POC

The runner image does not change (no new dependency; `@aws-sdk/client-s3` was already there). Steps, with a runner that is idle:
1. the POC deploy script (copies `services/runner/src`).
2. Recreate the runner container instead of only restarting its process, so no geesefs mount from the round 6 runner is left in its mount namespace: `bash ./hosting/docker-compose/run.sh --license ee --dev --env-file <the POC env file> --recreate runner`.
3. Needed and present: the `ngrok-mounts` tunnel (the command sandbox mounts the POC store through it, as `daytona` does). Without it every `inprocess` tool call says the file store cannot be reached from the sandbox.
4. Remove `AGENTA_RUNNER_INPROCESS_SANDBOX_START` from the POC env if it is set (ignored now).
5. A conversation from before this deploy keeps its history: its conversation file is moved out of the session folder on its next resume.

## Round 6: what changed

Round 6 worked through Codex's round 6 review (`evidence/review-round6/codex-review.md`: four reproduced P0s, five P1s, two P2 protocol issues in the sweep, and wording that promised more than the code did). Codex's verdict on round 5 was "not ready for a single-tenant beta", and it was right: its reproductions showed a sweep deleting another deployment's live sandbox, a command running twice, a command that kept running and published its result after its runner lost ownership, and admission counting fewer sandboxes than were running.

Scope, by instruction: a separate study is deciding whether the runner-side file sync (push, pull, manifest, conflict copies) is replaced by mounting the drive inside the sandbox, so the sync design was not changed. R6-P0-3 and R6-P0-4 are therefore open; their reproductions are skipped tests. Everything else is fixed, each with Codex's reproduction as a test that fails on the round 5 code. Commits `4b076b4548` to `e266fad8ef`. Live probes are in `evidence/round6/`.

### Decisions taken during the round

1. **A deployment is its owner store, not an address.** The sweep's scope was a hash of the API URL, and two Compose deployments both use `http://api:8000`. Now the scope is the owner store's own id: the API has a new runner-only route, `POST /sessions/control/sandbox-leases/identity`, which creates a random id in the lease store's Redis the first time it is asked (an atomic set-if-absent, no expiry) and returns it ever after. `AGENTA_RUNNER_INPROCESS_DEPLOYMENT_ID` overrides it. Every sandbox carries it as the label `agenta.deployment`, the sweep lists only that label, and it checks the label again itself rather than trusting the provider's filter. Why the store and not a configured name by default: "this owner has no live record" means "this owner is gone" only in the store the owner registered in, and the store's own id is exactly that fact; it needs no operator discipline. A side effect in the safe direction: a store that loses its data also loses its id, so the sandboxes labelled with the old one are never swept by anyone and Daytona's auto-delete removes them. A configured id gives up that protection, and two deployments must never share one (said in the config's doc comment).
2. **Losing the owner registration is decided locally, by a deadline.** The record counts as held until the store refuses a renewal, or until a whole TTL has passed since the last renewal the store confirmed was sent. From then on the store may have granted the record to someone else, so an answer that arrives later ("held") changes nothing. Why the send time: it is the earliest moment the store can have extended the record, so the runner gives up before any other process can be granted it (assuming clocks that tick at the same rate, not synchronized clocks). The loss fires one signal.
3. **One signal ends every use of a sandbox.** `SandboxUse.signal` fires when this process lost the registration the sandbox was created under, or when the sandbox was retired, dropped or deleted. The command runner listens to it: the command is killed as on Stop, and its outcome is reported as unknown ("this agent service lost its registration as the command sandbox's owner while it ran, so it was stopped and its changes were not copied back"), unless the kill proves it never started, in which case it runs once on a fresh sandbox. The pull's signal includes it, and the pull checks the use before and after reading the listing, so nothing is copied back from a sandbox the process may no longer use. The sandbox is dropped, not deleted: its deleter is the sweep that takes the lost record over.
4. **An undecided attempt is decided only on its own sandbox.** A claim is a folder on one disk. `AttemptUndecidedError` now carries the sandbox id, and `settleAttempt` refuses to decide it anywhere else: on a replacement sandbox the outcome is unknown and the command is not run again. The case where the same sandbox comes back (Daytona stopped it behind the runner's back) still decides on it and runs the command once.
5. **A running slot is a sandbox that may be running.** It goes back only once the sandbox is known to be stopped or gone. A failed stop, a failed delete, a retired sandbox whose delete failed, and a sandbox dropped for its deleter keep the slot as "unresolved"; a check asks Daytona (5, 15, 30, 60 s, then every 2 minutes, and at once whenever a command is waiting for a slot) and gives the slot back when the sandbox is stopped, archived or gone ("not found" counts as gone; a retired or deleted one is deleted again on each check). A command that waits out its slot while unresolved sandboxes fill the cap is refused with: "This agent service is at its limit of running command sandboxes, and N of them are sandboxes it stopped using whose removal the sandbox provider has not confirmed yet, so the command did not run. Send it again in a few minutes." The stats line reports `unresolvedSlots`. Why: admission must count what the provider may still run, not what the runner meant to stop.
6. **Reading a finished command's output is a pure read.** Polls never delete. The small output file (the model saw all of it) is deleted by a separate call after the final poll's answer was received; if that call is lost, the file just stays in `/tmp`.
7. **Each lock attempt races the signal.** A subscription refresh that is cancelled while a lock attempt is in flight stops waiting at once, and a lock that attempt still obtains is released unused.
8. **Withheld error text has its own class, and the web keys on the class.** The `inprocess` fallback for an unrecognized error is now coded `internal_error` (was `runner_error`). The web cannot know a turn's sandbox provider, but it does get the failure class; for `internal_error` it shows the runner's sentence and never a trace's text in its place. For every other class the rule is unchanged (a specific trace error may lead a generic run error), and the trace text goes through the same sanitizer, which now also redacts quoted credentials (`password='...'`, `token="..."`, `'api_key': '...'`, backticks, a quote cut off). When `local` and `daytona` start withholding unknown text, the web rule already covers them.
9. **An unknown in-process model is a setting to change.** It was an "Unsupported model ... Allowed values" internal error, which the strict contract turned into "send it again". It is now `model_unavailable`: "The model '<id>' is not available to this agent. Pick another model in the agent's settings." (Codex's parity note: terminal configuration failures need actionable codes.)
10. **The sweep reads the whole listing and renews what it took over.** `DaytonaApi.findByLabels(limit)` became `listByLabels`, an async listing that the SDK pages by cursor, each page under its own deadline. The sweep collects the listing (ids and labels only), then acts, so no sandbox past the first 500 starves; no cursor has to persist between sweeps because every sweep reads it all. The record a sweep takes over is a `HeldRecord`, renewed every third of the TTL, and the sweep checks it before each deletion and stops when it is lost. The owner's own record is the same class, which removed the duplicated renewal code.

### Codex round 6: every item

| Item | Status | Fix and test |
| --- | --- | --- |
| R6-P0-1 the sweep can delete another deployment's sandboxes | Fixed | Decision 1. Codex's two-store reproduction is a test (`sandbox-owner.test.ts`): nothing deleted. Also tested: the label equals the store's identity for every runner on that store, a configured id wins and a bad one fails boot, the label is checked even when the provider ignores the filter, and an identity that changed (a wiped store) sweeps nothing of the old one. Live: `evidence/round6/round6-probe.json`, a sweep by another deployment and a sweep by a live peer on the POC store deleted nothing. |
| R6-P0-2 an ambiguous command retried on a replacement disk runs twice | Fixed | Decision 4. Codex's reproduction is a test (`remote-command.test.ts`): 2 creates, outcome unknown, the side effect happened once. A second test keeps the good case: a sandbox that comes back decides the attempt and the command runs once. |
| R6-P0-3 an incomplete pull listing clears the pending-pull barrier | Open, by instruction | Skipped test with Codex's reproduction (`workspace-sync.test.ts`, "the pending-pull barrier"); it fails on the current code. The sync's header comment now names the gap. |
| R6-P0-4 credential rotation deletes unapplied command results | Open, by instruction | Skipped test with Codex's reproduction, same place; fails on the current code. |
| R6-P1-1 losing the owner record does not invalidate active transactions | Fixed | Decisions 2 and 3. Tests: Codex's reproduction (the record expires mid-command: outcome unknown, nothing on the runner, the sandbox never wrote the file, the next command gets a new sandbox under a new owner id); a renewal answered 3 s late with a 1 s TTL (the command is stopped in under 3 s, the late "held" leaves the record lost); the record lost while the command's changes are being read (nothing copied back, the model is told). Live on real Daytona and the POC store with a 5 s TTL and renewals that never answer: the command (`sleep 20; echo late > file`) ended as unknown after 6.6 s and the file was never written. |
| R6-P1-2 a failed deletion releases admission capacity | Fixed | Decision 5. Tests (`command-sandbox.test.ts`): Codex's reproduction (cap 1, the old sandbox's delete fails on a rotation: one sandbox started, the command refused with the sentence and the `sandbox_capacity` class; once the delete works the command runs), a failed stop keeps the slot until Daytona reports it stopped, a deleted conversation's slot is kept until a retried delete succeeds, a dropped sandbox's slot is kept until it is gone. Live: the dropped sandbox's slot went back 2 s after a peer's sweep deleted it. |
| R6-P1-3 a lost completed-poll answer loses output | Fixed | Decision 6. Test: the final poll's answer is dropped; the next poll returns the output and exact totals, and the file is deleted afterwards. A second test: output the model did not see in full stays. Live: a small output file was deleted after it was received. |
| R6-P1-4 cancelling a lock acquisition misses an attempt in flight | Fixed | Decision 7. Test (`credentials.test.ts`): a lock attempt that answers after 1 s, cancelled at 100 ms: the call rejects within 600 ms, the callback never runs, and the late lock is released once. |
| R6-P1-5 the public error boundary is bypassed by trace display, and quoted credentials survive | Fixed | Decision 8. Runner tests with Codex's two examples and five more shapes; the web port has the same vectors. Web: Codex's reproduction (`runError` "The agent run failed (reference abc).", `traceError` "upstream failed: password='hunter-value'") shows the runner's sentence; with a generic `runner_error` the trace still leads, sanitized to `password=[secret]`. |
| P2 the sweep's takeover grant is not renewed during deletion | Fixed | Decision 10. Test: with a 1 s TTL and 600 ms deletions, another sweep cannot take the record 1.3 s in; every sandbox is deleted once. A lost record stops the deletions after the one in flight. |
| P2 the sweep reads only the first 500 sandboxes | Fixed | Decision 10. Test: 600 sandboxes of a live owner listed first, then 700 of a gone owner: all 700 deleted, 13 pages read. |
| Wording (Codex's list) | Fixed | See "Wording corrected" below. |

### Wording corrected

- "Nobody else's sandboxes are swept" (the URL-hash scope): the comment went with the hash; `sandbox-owner.ts` now says what the deployment id is and why.
- "its sandboxes are not used again" on owner loss: now true (decision 3), and the log line says running commands are stopped.
- "Reconciliation happens on the same disk": now enforced (decision 4), and `settleAttempt` says so.
- "A replacement never runs beside its predecessor past the cap": now true (decision 5).
- "The reference points to the full error": the log line holds the error redacted and cut to 500 characters; the comment and the sentence say "the error in the agent service's log".
- "Exactly one runner deletes" (round 5 findings, above): the store grants an expired record to one claimant at a time, and the sweep now renews it while it deletes; a sweep that loses it stops.
- The pending-pull barrier "for every command": it covers model commands; runner helpers skip the sync by design, and the two open gaps (R6-P0-3, P0-4) are named in `workspace-sync.ts`.
- "One tab holds at most one live stream" (round 5 commit and comments): not literal. The web comments now list what one tab can hold at once: per conversation on screen, one session stream (the live event stream, or the records watch when the shared reader is not advertised), plus the records watch as a second stream while an approval card waits; the project watch, only in the tab the others elected; and one invocation request per turn the tab sent that is still running. A conversation kept mounted off screen, and every conversation of a hidden browser tab, holds none. The tab election is described as converging within a beat or two, not as a lock (two tabs can both lead until they hear each other). So one ordinary tab holds 1 or 2 streams, up to 4 while it waits on an approval, runs a turn, and leads the project watch.

### `local` and `daytona` parity

Every shared change this round:

- **`sanitizeErrorText`** (runner and web) redacts quoted credential values for every provider: an improvement. Its other rules are unchanged.
- **The web's turn status**: the new rule applies only to the `internal_error` class, which only `inprocess` produces today, so `local` and `daytona` turns render as before (trace first on an answer-less turn, both sanitized). The desktop bubble now passes the failure class it already had.
- **`internal_error` and `model_unavailable`** are new public codes; neither is produced on `local` or `daytona`. The SDK passes any well-formed code through; the web's failure callout shows no action for a code it does not list (as for `runner_error`).
- **The lock cancellation** changes only the signalled path, which only `inprocess` uses; callers without a signal keep the library's own retrying call.
- **The API** gains one runner-only route; the existing lease routes are unchanged.
- Runner tests covering `local` and `daytona` all pass (numbers below).

### Numbers

- Live on real Daytona and the POC API's Redis (`evidence/round6/round6-probe.json`, `.log`): the store's identity was the same on repeated calls and on the sandbox's label; the sweeps of another deployment and of a live peer deleted nothing; with a 5 s TTL and renewals that never answered, the running command ended as unknown after 6.6 s and never wrote its file; the dropped sandbox's slot stayed unresolved until a peer's sweep deleted it, and went back 2 s later; the small output file was deleted after it was received; nothing was left afterwards.
- Host runner end to end (`evidence/round6/host-runner-e2e.log`), `inprocess` with the mock model and the POC API as the owner store: the runner registered under the store's id, a `bash` tool call ran in a new Daytona sandbox (first answer text at 2.7 s including the create), and the sandbox was deleted when the throwaway conversation ended.
- Tests: runner 3,735 unit (8 skipped: the 6 that need an S3 server or a geesefs mount, and the 2 open sync reproductions) and 18 integration, `tsc` clean. API: the lease tests 37 of 37 against a throwaway Redis (the new identity test included), the sessions unit suite 893 passed; ruff clean. Web: agenta-chat 1,265, agenta-sessions 125, AgentChatSlice 355; `tsc` clean for oss and agenta-chat; prettier and eslint clean on the touched files. gitleaks clean on `4ccf9570d1..HEAD`.
- `services/runner/src/engines/inprocess/` grew from 6,127 to 6,550 lines: the unresolved-slot reconciliation (the largest part), the store identity, the shared record renewal and the use signal.

### Compliance, round 6

Same 40 checks. A row is met only when code and a test back it.

| Status | Round 5 | Round 6 |
| --- | --- | --- |
| Met | 33 | 32 |
| Partly met | 5 | 6 |
| Not met | 0 | 0 |
| Untested | 2 | 2 |

Row 38 (files and commands agree) goes back to partly met: Codex's R6-P0-3 and P0-4 show two ways a command's unapplied result can be overwritten or lost, and they are open by instruction. Row 5 (scale past one runner) stays met on stronger ground: deployment-scoped sweeps, owner loss that ends running commands, and admission that counts what may still run, each with a test and a live probe. Row 28 (cancel stops the command) is unchanged. Row 24 (approve after 10 minutes) still needs its live re-test after deploy. Still partly met: 4, 20, 22, 25, 32, and now 38. Untested: 13, 21.

### Found, outside this change

- **A command whose pull keeps failing blocks the conversation's model commands until it succeeds**, with no way for a person to keep, export or discard the stranded changes (Codex). This belongs to the sync decision.
- **`internal_error` still advises "send it again"**, which is wrong for a terminal failure no rule recognized. Only a public code at each throw site fixes that (the list for `local` and `daytona` is in round 5).

### Incident during the round

While stopping the host runner I sent SIGTERM with `pkill -f "tsx src/server.ts"`, and the pattern also matched the runner container of another stack on the same host. It shut down gracefully and its restart policy brought it back healthy within seconds; its log shows no turn in the 10 minutes before. No other stack was touched. From now on processes are stopped by PID only.

### Not done, and why

- R6-P0-3 and R6-P0-4: by instruction, pending the drive-mount study.
- The live re-test of rounds 5 and 6 on the POC: the runner is not redeployed, by instruction.
- The items listed as not done in round 5 (hard isolation and custom secrets are decisions for Mahmoud; public codes on `local` and `daytona`; the files pane's conditional save).

### Deploying to the POC

No new dependency and no new required setting, so the POC deploy script is enough; the API route the new runner calls is already live (the API mounts this worktree). `AGENTA_RUNNER_INPROCESS_DEPLOYMENT_ID` is optional; leave it unset. On boot the runner asks the store for its id, registers, and labels new sandboxes `agenta.deployment=<id>`. Sandboxes made by the round 4 runner carry no deployment label, so no sweep touches them; Daytona's auto-delete removes them.

## Round 5: what changed

History. What is current is in "Round 6: what changed".

Round 5 worked through Codex's third review (`evidence/review-round5/codex-review.md`: five new P0s, P1-1 to P1-6, P2-1 to P2-3 and a bar for a single-tenant beta), the two round 5 QA reports (`evidence/qa-round5-api/REPORT.md`, `evidence/qa-round5-web/REPORT.md`) and eight decisions made before the round. The round's main instruction was to simplify: each earlier review found new P0s in the distributed-state machinery the round before had added (leases, adoption, quarantine, retries), so this round removes whole classes of states instead of adding more. Commits `bf7251d374` to the round 5 findings commit on this branch. Live probes are in `evidence/round5/`.

### Decisions made before the round

1. **No cross-runner sandbox adoption.** A runner uses only the command sandboxes it created. When a conversation moves to another runner (a restart, a crash, a reroute), that runner creates a fresh sandbox and restores it from the drive and `.tools/`; the old sandbox is never used again. Reason: the drive is already the source of truth for files, and adoption was what made a lease per operation necessary; without adoption no runner ever acts on a sandbox it did not create, so Codex's P0-1 (a lease that does not cover the operation it authorizes) and P0-2 (quarantine known to one process only) cannot happen. The only shared question left is who deletes a sandbox, which is decided by a Redis record and the sandbox's labels (below). Sandbox reuse within one runner (park, stop, start, `/tmp` intact) is unchanged. The spec text was updated to say so (`specs/sandbox-lifecycle/spec.md`, "Stop when idle, resume on demand", and `specs/session-continuity/spec.md`, "Runner restarted").
2. **Stop.** The command's process group is recorded before the command claims its attempt, so a claimed attempt always has a group to kill or an exit code. A kill not confirmed in time retires the sandbox and the turn reports that the command's outcome is unknown. Reason: Codex reproduced a command that ran after Stop had reported it dead (P0-3).
3. **Sync.** A command never starts while an earlier command's changes are not yet applied on the runner; a pull that keeps failing ends the command with a readable sentence and leaves the changes in the sandbox for the next attempt; every write result is checked; conflict copies get a name no other file has; a refused write is never reported as saved. Reason: P0-4 and P0-5 lost data.
4. **Bounds.** Output is read back with a real byte limit, the tar reader fails an over-limit entry mid-read instead of hanging, admission reserves before any await, grep has a memory bound, and a malformed grep pattern is an error.
5. **Credentials.** Cancelling a subscription refresh also cancels the wait for its lock.
6. **The public error contract** passes no raw error text: known classes map to sentences, paths, credentials and ids are redacted generically, and anything else is one generic sentence.
7. **Isolation.** Codex disagreed with the round 4 recommendation of worker threads. The section is rewritten below, with measurements, as a decision for Mahmoud.
8. **Custom secrets.** Codex agreed with the round 4 reading and withdrew its premise. The clean design is written below as a proposal for both providers, not built.

### Decisions taken during the round

- **Ownership is per runner process, and deletion is decided by one Redis record.** Each runner process registers an owner id (a fresh UUID, never reused) in the API's Redis through the existing lease routes and renews it every third of its TTL (`AGENTA_RUNNER_INPROCESS_OWNER_TTL_MS`, default 60 s, validated at boot against the API's 1 to 600 s range, which closes P2-2). Every sandbox it creates carries its owner id and the store's scope as labels. A sweep (30 s after boot, then every 2 minutes) deletes two kinds of sandboxes: its own that no conversation points at any more (a retired sandbox whose delete failed, the sandbox of a conversation the registry dropped), and those of an owner whose record expired, but only after it has taken that record over (the store grants an expired record to exactly one claimant, so exactly one runner deletes). A runner whose renewal finds its record gone stops using every sandbox it created under that id and registers a new one. A graceful shutdown hands the record back, so the next sweep cleans up at once. The existing session ownership claims (`owner:session:<id>`) keep routing turns to one runner; this record answers only "is the creator of this sandbox alive".
- **Runners sweep only their own store's sandboxes.** The scope label is a hash of the API base URL, so a runner never deletes the sandboxes of another deployment that shares the Daytona org and labels. Sandboxes without an owner label (created by a round 4 runner) are left to Daytona's auto-delete.
- **A small supervisor in the sandbox runs each command, instead of Daytona's session commands and log streaming.** One plain Daytona call starts it detached (`setsid`); it records the process group atomically, takes the claim, runs the command with stdout and stderr into one file, and records the exit code before removing the group file. Polls read the exit status, the file's size and at most 256 KiB of new output (a tail read when the command writes faster); the poll that sees the exit code also returns the exact line count and last-line length, so Pi's truncation notice is exact. Probed live first (`spike/supervisor-probe.ts`): the call returns at once, the process outlives it, and it sees the same environment, user and PATH as a session command. It also removed code: Daytona sessions, the log follower, the full-log backfill, the runner-side spill file and its upload, and the held-cleanup machinery. Warm commands got faster: 35 to 56 ms end to end on real Daytona, from 216 to 325 ms in round 4.
- **"Outcome unknown" is an outcome, not an exception.** A kill not confirmed within 5 s, polls that fail five times, or a command that died without an exit code end the tool call with `Command outcome unknown: <reason>. Check what it did before running it again.` When the sandbox's state is unknown it is retired first, and the pull does not read it (its command may still be writing).
- **A sandbox Daytona stopped behind the runner's back is revived, and the attempt decided on its disk.** When neither the launch nor the claim check answers, the transaction brings the sandbox back and takes the claim there: if it was free the command never ran and runs once more; if not, the outcome is unknown. Without this, every outside stop would have retired the sandbox.
- **A pull that keeps failing ends the command, not the whole turn.** The command's tool call fails with a sentence ("An earlier command's changes could not be copied back to the drive yet, so this command did not run..."), nothing is pushed, and the model can try again; every attempt retries the pull first. Ending the whole turn would lose the model's reasoning for a condition the next command may already find fixed.
- **Unknown error text is hidden for `inprocess` only.** The redaction rules got stronger for every provider, but hiding everything no rule recognizes would also hide the runner's own actionable sentences on `local` and `daytona` (24 existing tests pin them: a failed permission-component install, an unwritable mounted Pi directory, a sandbox owned by someone else, and others), which rule 8 of the handoff forbids. `classifyRunError` takes `unknownText: "hidden" | "sanitized"`; `inprocess` asks for `hidden`. Turning it on everywhere is a proposal: it needs a public code on each of those runner-authored sentences first.
- **A retired sandbox keeps its running slot until its delete ends,** so its replacement waits for it instead of running beside it past the runner's cap (Codex's second P1-3 reproduction).
- **QA5A-1 was a race in the shared session pool, not an approval expiry.** See QA round 5 below. The approval itself has no deadline: the pool's approval TTL only decides whether an answer resumes the warm session or goes the cold path, and both work.
- **The API's pointer route is no longer used by the runner.** It stays for now because the live POC runner (round 4) calls it; it can be removed once round 5 is deployed.

### Codex round 5: every item

| Item | Status | Fix and test |
| --- | --- | --- |
| P0-1 the lease does not cover the operation it authorizes | Fixed by construction | No runner acts on a sandbox it did not create (decision 1); the per-operation lease checks are deleted. Two-process test: a runner stalled past its TTL mid-command lost its sandbox to the other runner's sweep, its command ended as "outcome unknown", nothing reached the drive, and it resumed under a new owner id (`evidence/round5/two-process-takeover.json`). |
| P0-2 quarantine is local; another runner adopts the quarantined sandbox | Fixed by construction | No adoption. A retired sandbox is never used by anyone; its delete is retried by the owner's sweep (unit test: a retired sandbox whose delete failed is swept). |
| P0-3 Stop declares a command dead before it starts | Fixed | The group is recorded before the claim; the kill reads a claimed attempt without a group as "unknown", never "gone". Codex's 3 s pause after the claim, injected into the launch: Stop reports aborted and the side effect never appears (unit, and live on Daytona: `evidence/round5/command-probe.json`). The test fails when the supervisor is put back to claim-first. |
| P0-4 a repeated pull failure does not block a destructive push | Fixed | Codex's reproduction as a test: the second command does not run, the sandbox keeps `command-result`, and once the pull works both versions are kept. Fails on the round 4 code. |
| P0-5 a refused conflict copy is acknowledged as saved; names collide within a second | Fixed | Copies are created only if absent (`If-None-Match` on the drive, `O_EXCL` on runner folders) under `name.conflict-<UTC with milliseconds>-<6 hex>.ext`; a copy not written leaves the change pending, with a sentence that says so. Tests: a refused copy, two names in the same millisecond, exclusive create. Fail on the round 4 code. |
| P1-1 output fetched whole before truncation | Fixed | Bounded range reads (above). Unit: 8 MiB of output, no poll answer over 350 KB, exact totals. Live: 8 MiB in 82 ms, 256 KiB read back, largest answer 349,560 bytes. |
| P1-2 tar hangs on an over-limit chunk mid-entry | Fixed | A failure destroys the entry being read. Codex's shape as a test (8 KiB file, 4 KiB cap, delayed chunks): it rejects instead of hanging. |
| P1-3 admission caps bypassable | Fixed | The ledger's seat is taken synchronously before any await (three concurrent opens against a cap of one: one passes, at the host level; fails on the round 4 code); a retired sandbox keeps its slot until deleted (test: the replacement is created after the old one's delete). |
| P1-4 credential cancellation excludes lock acquisition | Fixed | The lock is taken one attempt at a time on the library's own schedule and the wait ends on the signal; a lock that arrives after the caller gave up runs nothing. Test with the lock held by another writer. |
| P1-5 the public error contract passes arbitrary text | Fixed for `inprocess`; redaction improved everywhere | See the decision above. Tests with `ENOENT:/home/tenant/file`, a Bearer token, `key=value`, a JWT, `org_` ids, long ids, and a URL and model id that must survive; the web port has the same rules and vectors. |
| P1-6 grep memory | Fixed | ripgrep prints context itself with a 500-byte column cap, reading stops at Pi's 50 KB byte limit, no file is read by the runner, context is capped at 50. Tests: a 10 MB line, a huge result with limit 1,000,000 and context 1,000. |
| P2-1 malformed grep pattern reads as "No matches found" | Fixed | Any ripgrep error that is not a per-file read error fails the call with ripgrep's message (`[` gives "unclosed character class"). |
| P2-2 boot accepts lease TTLs the API rejects | Fixed | The owner TTL is validated to 1,000 to 600,000 ms at boot. |
| P2-3 accounting and evidence incomplete | Fixed | The full-log backfill no longer exists; grep holds at most its byte limit; the stats line now reports external and ArrayBuffer memory (process-wide: no API attributes it to a session); transcript size is counted in bytes. The "two registries in one process" probe is deleted and replaced by the two-process test. |
| Comments that overpromised | Fixed | `remote-command.ts` rewritten; `drive-store.ts` now logs a failed mount refresh and says what the mount shows then; the `.tools/` comment says it reports each failed attempt and then stops; `turnStatus.ts` no longer calls the desktop copy authoritative (it is the one implementation). |

### QA round 5

| Id | Status | How |
| --- | --- | --- |
| QA5A-1 an approval answered at its 10-minute TTL leaks `Internal error: ENOENT` and the command never runs | Fixed (shared pool) | Not an expiry: the pool's approval-TTL eviction freed the key and started unmounting the conversation's drive (02:34:21.92); the approve turn arrived 130 ms later, found the key empty, built its environment on the still-mounted drive, and the old teardown unmounted it underneath (02:34:22.70). `local` and `inprocess` use the pool mode that frees a key before its teardown ends; `daytona`'s strict pool already waited. Now `evict` waits for a teardown still running on the key (test for both pool modes; the default mode fails without the fix). The raw text is also gone on `inprocess`: an unknown error is one sentence with a reference. Live re-test after deploy. |
| QA5A-2 a drive edit about 2 s before a command's overwrite was not preserved | Not a bug | The POC logs show the drive upload (02:44:14.277) landed before the command's sandbox was even created (02:44:14.416), so the command started from the drive's edit and its overwrite was a plain change. Both orderings are tests now: an edit after the command started is kept and the command's copy saved beside it; an edit before it started is what the command sees. |
| QA5W-4 a files-pane edit racing a command's write loses one side | Not a sync bug; the editor's save is an unconditional overwrite | The logs show the command's turn ended at 03:09:18 and the editor's save arrived at 03:09:42: the editor saved a buffer it had loaded before the command, over a result already on the drive. The sync never saw a race. The fix is a conditional save in the files pane (the API upload taking the version the editor opened, with a prompt on conflict), shared by every provider; recorded below. Test pinning the sync side. |
| QA5W-1 finished turns go missing and sends fail with 2 tabs | Fixed (shared web) | The root was not round 4's retries (they fire only after a failure and hold no connection): a session pane the user had visited stayed mounted while hidden and kept its live-event stream open and its 2 s queue poll running, so a tab held 2 streams plus one per visited pane, and 2 ordinary tabs reached Chrome's 6 connections per origin over plain HTTP/1.1. `main` opens the same streams, and the path does not depend on the sandbox provider, so `daytona` sessions were affected too. Now a hidden pane holds no stream and polls nothing (coming back re-reads the snapshot and records first, so a turn that ended while hidden renders from server records); the records watch opens only when the live stream is off (except while an approval card waits); one tab, elected over `BroadcastChannel` (Web Locks need HTTPS), holds the project watch and relays it to the others. Measured on the POC over plain HTTP (`evidence/round5/web-connections/`): one idle tab 4 streams to 2; 3 idle tabs 9 to 4; 3 tabs with one turn and a second send: before, the turn never rendered in 60 s, "Message wasn't sent" and a reload hung past 40 s; after, the turn rendered and every reload showed it; 3 tabs each sending a 5 s command at once: all sent, rendered in 12.2 to 12.3 s, reloads 2.4 to 7.3 s. Agenta's hosted cloud serves the web as HTTP/2 over TLS, so the limit mostly affects plain-HTTP self-hosting and this POC; the fix works over HTTP/1.1. Not fixed: the sending tab still holds the turn's POST open until the turn ends (closing it early needs a runner change: today a closed connection counts as a disconnect), and 4 or more visible tabs over HTTP/1.1 can still reach the limit. |
| QA5W-6 a raw `SessionRecordsUnavailableError` dev overlay | Fixed (shared web) | The overlay came from the cache layer: after restoring cached records it started a refetch whose failure nothing handled. `persisters.ts` handles it for the records and catalog caches (a test reproduced the unhandled rejection first). A failed first history read no longer shows "History no longer available" (QA5W-1 case D); it keeps the skeleton and retries after 5 s, backing off to 30 s. |
| QA5W-2 a model switch in one tab changes another session's model | Recorded, outside this change | Shared web; the model is part of the agent's saved revision (as QA4W-2). |
| QA5W-3 the build kit turns back on | Recorded, outside this change | Shared web (as QA4W-4). |
| "Always auto-approve" applies to the whole agent | By design | The card writes the tool's permission into the agent's draft configuration (`useAlwaysAllowTool`, "a draft-config grant"), the same on every provider. The approvals spec asks only for today's behavior ("Human-in-the-loop behavior is identical to today"). |

### Found, outside this change

- **The files pane saves unconditionally** (QA5W-4): an editor that opened a file before a command changed it overwrites the command's result on save. Proposal: the upload route takes an `If-Match` version (the one the editor loaded), the store refuses a moved file, and the editor offers "reload" or "save as a copy". Shared by every provider.
- **QA5W-2 and QA5W-3** (model switch across tabs, build kit default): shared web state, to be filed separately.
- **Unknown error text on `local` and `daytona`**: the runner-authored sentences that reach `classifyRunError` without a public code (found by the 24 tests above: `pi-permission-failclosed`, `sandbox-agent-orchestration`, `reconstruct-resume-nonfatal`, `daytona-transcript-recovery`, `sandbox-agent-errors`) need `withPublicCode` at their throw sites before `hidden` can be the default.

### What was deleted

Measured on `services/runner/src/engines/inprocess/`: 6,362 lines before (round 4 HEAD `4604fe0563`), 6,116 after, while the round added the owner record and sweep (289 lines), the supervisor, and the new bounds.

| Deleted | Lines | Replaced by |
| --- | --- | --- |
| `sandbox/sandbox-lease.ts`: the per-conversation lease, pointer and their stores | 321 | `sandbox/sandbox-owner.ts` (289): an owner record per process, the sweep |
| `LeasedSandbox` (every changing call checked the lease), adoption, lease upkeep, the pointer writes, lease-lost handling in `command-sandbox.ts` | 671 to 513 | nothing: a runner's own sandboxes need no check |
| Daytona session commands, log following, command lists and the whole-log fetch (`daytona-api.ts`), plus `get` and `setLabels` | 396 to 317 | the supervisor's files, read through the one plain call |
| The runner-side spill file, its disk-failure handling and its upload (`command-output.ts`, `conversation-workspace.ts`) | 208 to 136, 291 to 248 | the output file the command writes in the sandbox |
| The held-cleanup machinery (a kill or a session delete still in flight after the call returned) | part of the above | nothing: an attempt is decided through its claim |
| grep's whole-file reads and line cache for context | part of `grep-tool.ts` (214 to 211) | ripgrep's own context |
| `spike/daytona-transaction-probe.ts` (two registries in one process) | 79 | `spike/two-process-takeover.ts` with independent processes |
| The session machinery in the test stand-in (`tests/utils/local-daytona.ts`) | 285 to 154 | nothing |

`remote-command.ts` went from 306 to 332 lines (a rewrite; its scripts are longer than the session calls they replaced) and `workspace-sync.ts` from 816 to 851 (the pending-pull block and checked conflict copies).

### `local` and `daytona` parity

Every shared change this round:

- **`SessionPool.evict`** waits for a teardown still running on the key (QA5A-1). `daytona` uses the strict pool, which already waited: neutral. `local` gets the same fix: a plain improvement (the same race could unmount a local session's drive).
- **`sanitizeErrorText`** redacts more (paths after punctuation, credentials, JWTs, long ids) for every provider: improvement. **`classifyRunError`** keeps the redacted first line for `local` and `daytona` (`unknownText: "sanitized"`): neutral.
- **`mutateSubscriptionLogin`** changes only when a signal is passed (only `inprocess` passes one): neutral for the others.
- **`InRunnerHarnessStart`** lost its `sandboxPointer` field (used only by the in-runner harness): neutral.
- **Web**: the redaction rules in `turnStatus.ts` (improvement for every provider); the connection changes for QA5W-1 and QA5W-6 (hidden panes hold no stream, one project watch per browser, handled cache refetches) apply to every provider and are improvements; `useSessionHydration.connections.test.tsx` pins the stream counts.
- Runner tests covering `local` and `daytona` all pass (numbers below).

### Numbers

- Real Daytona, command path (`evidence/round5/command-probe.json`): create and first command 1.7 to 2.0 s; warm command 35 to 56 ms end to end (round 4: 216 to 325 ms); Stop in the middle of `sleep 60` confirmed 20 to 26 ms after it was pressed, nothing left running; Codex's injected 3 s pause after the claim: aborted, no side effect; 8 MiB of output in 70 to 82 ms, 256 KiB read back, the largest poll answer 349,560 bytes.
- Two independent runner processes on the POC API's Redis and real Daytona, owner TTL 5 s (`evidence/round5/two-process-takeover.json`): crash takeover, a new sandbox with the drive's file and none of the old sandbox's disk, the old sandbox not deleted before the dead owner's TTL (swept `[]`) and deleted after it; a runner stalled mid-command lost its sandbox to the other runner's sweep and resumed under a new owner id; a graceful restart's sandbox was swept at once by the next process.
- Owner record race on the POC API (`evidence/round5/owner-race.json`): 20 sweepers raced for an expired record, 1 granted; the stalled owner's renewal refused; a released record granted at once with a newer epoch.
- Store-level tests against a real SeaweedFS and a geesefs mount: `evidence/round5/store-tests.txt`. Conditional PUT and DELETE on SeaweedFS 4.47: 3 of 3 pass (a write on a moved version is refused, a create-only write refuses an existing name, a delete on a moved version is refused). Mount visibility, in a throwaway container of the POC runner image with geesefs mounted as the runner mounts it: 3 of 3 pass. Without the refresh the mount still served v1 after v2 had landed in the store; after the refresh it served v3 at once; a conflict copy created only-if-absent was visible through the mount and a second create of the name was refused.
- Isolation measurements: see "Hard isolation: a decision for Mahmoud" below.
- Tests: runner 3,713 unit tests (6 more skip without an S3 server or a geesefs mount; they pass against the real ones) and 18 integration tests; `tsc` clean. Web: turn-status 19 tests; agenta-chat 1,262, agenta-entities 2,349, agenta-shared 550, agenta-sessions 125 (6 new tab-leader tests), AgentChatSlice 355; `tsc` clean for oss and the touched packages. gitleaks clean on `4604fe0563..HEAD`.

### Compliance, round 5

Same 40 checks. A row is met only when code and a test back it.

| Status | Round 4 | Round 5 |
| --- | --- | --- |
| Met | 33 | 33 |
| Partly met | 5 | 5 |
| Not met | 0 | 0 |
| Untested | 2 | 2 |

The counts did not change; the evidence behind five rows did. Row 5 (scale past one runner) now rests on independent processes instead of two registries in one process. Row 10 (stop idle, resume with `/tmp`) holds on the runner that created the sandbox; on another runner the spec now asks for a fresh sandbox restored from the drive, which the two-process test shows. Row 24 (approve after 10 minutes) failed live in QA round 5 at the TTL boundary; the race is fixed and tested in units, and needs a live re-test after deploy. Row 28 (cancel stops the command) now has the supervisor and Codex's pause test, live. Row 38 (files and commands agree) now blocks a push over unapplied changes and checks every conflict copy.

Still partly met: 4 (no hard per-session memory bound; see the isolation decision), 20 (subscription refresh tested in units), 22 (custom secrets readable, as on `daytona`; see the proposal), 25 (two approvals sequential, a shared Pi constraint), 32 (images unchanged). Untested: 13 (Composio gateway tools), 21 (MCP secrets).

### Hacks left, and why

- **The pi-acp patch** (exports pi-acp's session class, two opt-in options). Upstreaming is the fix; the parity tests catch drift until then.
- **The file relay for Agenta tools in the same process.** It carries the tool policy and approval path `local` uses. The clean replacement is a typed, permission-aware transport behind the same policy.
- **Two pi-ai versions plus an alias.** Aligning the pins removes it.
- **`python3` to set one extended attribute** for the geesefs refresh. A failure is now logged, not swallowed.
- **Sandbox-side scripts are bash** (the sync's `find`, `tar`, `md5sum`, `base64`, and now the command supervisor). They run in our own snapshot. A small versioned binary in the snapshot would replace them; the supervisor's protocol (four files per attempt) is what it would implement.
- **Web commits skip the repo hooks** in this worktree (they fail on the root-owned `node_modules`); prettier and gitleaks run by hand.

### Hard isolation: a decision for Mahmoud

Sessions share one Node process. Admission and accounting keep the runner from taking on more than it can hold; they do not stop one session from using the whole process's memory, and a native crash ends every session. Round 4 recommended worker threads. Codex disagreed, and it is right: a worker's `resourceLimits` bound only that worker's V8 heap. They do not bound ArrayBuffers, other external memory or native memory, which is where several of this spike's failures lived (buffers, streams, file operations, SDK responses), and a native crash or a process-wide out-of-memory still ends every worker.

Measured on this box (Node 24, one Pi session with the mock model, 5 runs each, `evidence/round5/isolation-cost.txt`, `spike/isolation-cost.ts`):

| | In the runner process (today) | Worker thread | Child process |
| --- | --- | --- | --- |
| Memory added per session | 0.2 MB RSS, 0.3 to 0.5 MB heap | about 23 to 33 MB RSS once warm (the first worker pays about 190 to 435 MB of module loading; the second and third added 9 and 2 MB), 4.4 MB own heap | about 270 to 290 MB RSS each, growing linearly (no shared module cache) |
| Time to a session ready for a prompt | 5 ms | 16 ms inside the worker, but about 2 s from "create the worker" when it loads Pi's modules cold | 15 ms inside the process, plus the process and module start (about 2 s cold, inferred from the worker figure) |
| First token of one prompt (mock answers at 300 ms) | 304 ms | 379 ms | 385 ms |
| What bounds a session | nothing per session | its V8 heap only | the OS: cgroups or container limits bound all its memory and CPU; a crash ends one process |

A pre-started pool hides the start cost in both the worker and the process designs, so neither needs to slow the first answer.

Recommendation (Mahmoud decides):
- **Single tenant (one organization's sessions per runner):** keep sessions in the runner process, with the admission and accounting that exist now. Worker threads only if one session's CPU use delays the others too much; they are a responsiveness aid, not a memory or crash boundary.
- **Multi-tenant:** worker processes separated by tenant, each under OS-enforced limits (cgroups or container limits for memory, CPU and process count), a pre-started pool per tenant, and bounded IPC with backpressure between the runner and each worker. One process per session only where a session needs its own boundary. At about 280 MB per process, a pool per tenant costs roughly what `local` spends today per session, so the pool size per tenant is the lever. The infrastructure secrets (the Daytona key, the runner token) stay in the parent, never in a worker.

### Custom sandbox secrets: a proposal for both providers

Today `sandbox.credentials` reach both `daytona` and `inprocess` sandboxes as plain environment variables, readable by `echo`. The clean design extends the distinction the model credentials already make (`LOCAL_USE_MODEL_CREDENTIAL_BINDINGS` in `daytona-secret-plan.ts`) to sandbox credentials:

- **Two kinds, declared on the wire.** A `local_use` credential is one the sandbox must hold (a signing key, a certificate): it is delivered as an environment variable or a file, and the product says plainly that the agent can read it. An `opaque_http` credential is one only an HTTP call needs: the sandbox holds a placeholder, and the real value is substituted on the way out (Daytona Secrets today; a runner-side proxy is the alternative).
- **Destination policy from trusted configuration.** An `opaque_http` credential names the hosts it may reach, set by the person who stores the secret in the vault, never by the model or the run. The runner validates the list (exact hosts or `*.domain` suffixes, HTTPS only, no IP literals or private ranges) before it builds a sandbox; an invalid list refuses the run with a sentence.
- **Redirects.** Substitution applies per request to the request's own host; a redirect to a host outside the list is followed without the credential (or refused, a per-credential setting), never with it.
- **Rotation.** The sandbox's credential fingerprint (already a label) covers the kind and the host list as well as the value; any change rebuilds the substitution (Daytona: a new secret plan; `inprocess`: the sandbox is replaced, as it is today for a changed value).
- **Refusal, never a silent fallback.** A run that declares an `opaque_http` credential on a provider or plan that cannot substitute it is refused with a sentence; it is never delivered as plaintext instead.
- **Both providers.** `daytona` and `inprocess` share `materializeSandboxCredentials` and the secret plan, so both get the same behavior from one change: a wire field for the kind and the hosts (SDK, API, UI), the plan, and the refusal.

### The single-tenant beta bar: where it stands

Codex's bar, item by item: P0-1 to P0-5 fixed (two by construction); the tar hang, the admission reservations and the unbounded output and grep paths fixed; credential cancellation complete; the public-error boundary strict for `inprocess`; independent-process takeover tested for crash, lease expiry during a command and restart, with the rest of its list (failed retirement delete, ambiguous stop, repeated pull failure, conflict-name collision, mid-entry transfer failure) covered by unit tests with injected faults and, for Stop, live on Daytona; conditional PUT and DELETE and mount visibility against a real SeaweedFS: both pass against SeaweedFS 4.47 and a real geesefs mount (`evidence/round5/store-tests.txt`). What is not met: a live re-test of the round 5 fixes on the POC (the runner is not deployed yet, by instruction), and the QA5A-1 fix's live check at the 10-minute boundary.

### Not done, and why

- Hard isolation: a decision for Mahmoud (above).
- Hidden custom sandbox secrets: a proposal (above); needs a wire field in both providers.
- `unknownText: "hidden"` for `local` and `daytona`: needs public codes on their runner-authored sentences first (listed above).
- The files pane's conditional save (QA5W-4) and QA5W-2, QA5W-3: shared web, outside this change.
- A slimmer command-sandbox snapshot: an org-level Daytona change.
- Removing the API's pointer route: after round 5 is deployed.

### Deploying to the POC

The runner needs only the snapshot (no new dependency, no new environment): the POC deploy script. The setting `AGENTA_RUNNER_INPROCESS_SANDBOX_LEASE_TTL_MS` is now `AGENTA_RUNNER_INPROCESS_OWNER_TTL_MS` and `_SANDBOX_LEASE_WAIT_MS` is gone; the POC sets neither. Conversations that started on the round 4 runner get a new command sandbox on their next command; their old sandboxes carry no owner label, so no sweep touches them, and Daytona's auto-delete removes them. The API and web changes are already live (both containers mount this worktree). Restart the web container after deploying if its memory is high (it sat near its 8 GiB limit in round 4).

## Round 4: what changed

History. What is current is in "Round 6: what changed".

Round 4 worked through Codex's round 4 review (`evidence/review-round4/codex-review.md`: a fix-verification table, six reproduced P0s and five more bugs), the two round 4 QA reports (`evidence/qa-round4-api/REPORT.md`, `evidence/qa-round4-web/REPORT.md`) and thirteen decisions made before the round. Commits `c04fc684e6` to the round 4 findings commit on this branch. Live probes are in `evidence/round4-fixes/`.

### Decisions made before the round

1. **Sandbox ownership across runners goes through a store with a real compare-and-swap.** The conversation's sandbox pointer and a lease on it live in the API's durable Redis (the store session ownership already uses; the API stays the only Redis writer), behind runner-token routes `/sessions/control/sandbox-leases/{acquire,renew,pointer,release}`. Lua scripts on the Redis clock take a lease only when it is free or expired (epoch plus one, new token) and renew, move the pointer or release only with the current epoch and token. The runner checks that its lease has at least as long left as a call may take before every call that changes a sandbox. Daytona cannot check a token, so a call that sat in the network past the lease's end can still land: that residual window is documented in `sandbox-lease.ts`, and nothing is called fencing any more.
2. **A command runs at most once.** Every attempt has an id and a claim: the wrapper runs the command only if it takes the claim (an atomic `mkdir` in the sandbox). An ambiguous launch error is reconciled by taking the claim from outside: winning proves the command never started and never will, so it is retried; losing means it started, and it is followed through the Daytona session's command list.
3. **Network policy.** Each change carries a sequence number. A change that failed or timed out makes the sandbox's policy unknown, so the sandbox is quarantined and replaced; a late stale update can never reach a sandbox a command uses.
4. **Sync correctness.** Each direction acknowledges only what it carried. Drive files are read for the sandbox through the object store with their ETag and published back with a conditional write (SeaweedFS 4.47 supports `If-Match` and `If-None-Match` on PUT and DELETE; probed). A refused write keeps the drive's copy and saves the command's copy beside it as a conflict file. File to folder and folder to file are handled. The handwritten tar parser is replaced by node-tar.
5. **grep and find.** No host tool reopens a model-controlled path. See the decision taken during the round below.
6. **Custom secrets through Daytona Secrets, as the `daytona` provider does.** See the premise problem below.
7. **Cancellation and bounds.** Every layer has an elapsed-time budget; Stop keeps the sandbox until remote work is confirmed ended or the sandbox is quarantined; command output is bounded in memory with a bounded spill file, and every stream has an error listener.
8. **Isolation between sessions.** No worker processes this round. Per-session memory accounting, admission control, and the comparison in "Hard isolation options" below.
9. **Throttling.** The runner's bookkeeping gets its own budget only on an explicit list of routes; model-driven platform tools are charged to the plan buckets again.
10. **Errors.** One public error contract (a code and a sanitized sentence), emitted by the runner and rendered by the web; `runError` is sanitized; existing providers keep the old trace-first order.
11. **Credential refresh.** A refresh that times out releases the shared lock safely.
12. **Parity.** `local` and `daytona` behave the same; every shared change is listed below.
13. **Honesty in code.** Names and comments say what the code keeps; stale documentation is fixed.

### Decisions taken during the round

- **The custom-secret decision rests on a premise that does not hold, so it is recorded, not built.** Decision 6 says to use Daytona Secrets for `sandbox.credentials` "exactly as the `daytona` provider does". The `daytona` provider does not: its Daytona Secret plan (`daytona-secret-plan.ts`) covers the model credentials and HTTP MCP headers only, and `sandbox.credentials` reach its sandbox as plain environment variables, readable by `echo`, exactly as in `inprocess`. A Daytona Secret also needs the one host it may be sent to, and a sandbox credential carries no host on the wire (`SandboxCredential` is a binding and a value). So neither provider can hide these values today, and "exactly as `daytona`" is what `inprocess` already does: values set as Daytona environment variables at create, never in command text, a sandbox replaced when they change. The one secret mode on the wire (an environment binding) is supported; anything else is already refused by `materializeSandboxCredentials`. Round 1's answer to E3 ("the product already relies on" Daytona Secrets for `sandbox.credentials`) was wrong and is corrected here. Hiding them needs a new wire field (the allowed host) through the SDK, the API and the UI, in both providers. Spec row 22 stays partly met. Mahmoud: this is the one decision to revisit.
- **grep runs ripgrep over descriptors, not paths.** Decision 5 allowed either "ripgrep with the root as its sole argument and sub-paths as globs" or "search over already-opened handles". The first still lets ripgrep resolve intermediate path components while it walks, so a folder swapped for a link mid-walk (the agent folder is shared with `daytona` sessions, whose mounts can store links) could still redirect it. The second closes that: `WorkspaceFs` opens each file (one component at a time, `O_NOFOLLOW`, regular files only) and ripgrep searches the open descriptors as `/dev/fd/<n>` of its own process. ripgrep keeps the linear-time matching. Costs: `.gitignore` files are not applied (the walk skips `node_modules` and `.git`, like `find`), and one call searches at most 20,000 files.
- **Conditional writes go to the object store; the mount is told to refresh.** The runner sees the drive through a geesefs mount, which has no compare-and-swap. So the sync reads drive files for the sandbox, and publishes the command's changes, through S3 with the mount's own short-lived, prefix-scoped credentials, and then sets geesefs's refresh attribute (`.invalidate`) on the path so file tools read the new version at once. Probed in the runner image (`evidence/round4-fixes/geesefs-refresh.txt`): without the refresh the mount shows the old content; with it, the new one. Node has no `setxattr`, so one short `python3` call sets it for a batch of paths (python3 is in the runner image); if it fails, the mount shows the old version until its one-minute metadata cache expires. A drive file whose version is not known (read through the mount because the store did not have it yet) is never overwritten: a change to it is saved as a conflict copy.
- **Files are sent in as many archives as needed.** The batch limit used to defer files to "after the next command", so a command could run with stale inputs. Now every file within the per-file limit is sent before the command, one archive of at most 512 MB at a time; a file over 100 MB is removed from the sandbox (never left stale) and the model is told.
- **Adoption compares content.** On a disk this runner has no manifest for, a file counts as already there only if its MD5 matches (for a drive file, the drive's single-part ETag, which is that MD5), not on size and whole-second time.
- **A prompt after Stop whose old turn has not unwound in 10 s is refused as not sent** (`session_turn_in_use`), instead of being queued behind it and run later by surprise (R3-15).
- **A failed `.tools/` restore is optional, as on `daytona`, but explicit**: its result is a typed state per sandbox disk, the model is told each time, and it is tried again at most twice.
- **Stopped command sandboxes are archived after 30 minutes** (`AGENTA_RUNNER_INPROCESS_AUTOARCHIVE_MINUTES`), so their disk leaves the Daytona org's quota (QA4A-1).
- **Admission defaults**: 8 concurrent sandbox creates, 40 running command sandboxes, 20 s wait for a slot, 200 in-process sessions, refuse new sessions above 85% of the V8 heap limit. All configurable.

### Codex round 4: fix verification, re-checked

| Item | Codex said | Now | How |
| --- | --- | --- | --- |
| P0.1 error-text-driven upload/delete | Fixed | Fixed | Unchanged. |
| P0.2 event-mapping I/O, file boundary | Partly (grep) | Fixed | grep over confined descriptors; swap regression test (`grep-tool.test.ts`). |
| P0.3 fail-closed network | Partly (late update) | Fixed | Unconfirmed change quarantines the sandbox; late-update repro test (`command-sandbox.test.ts`). |
| P0.4 command/sync transaction | Partly | Fixed | Per-direction acknowledgement, conditional drive writes, type replacement, all inputs sent, content-checked adoption; tests in `workspace-sync.test.ts` and against a real SeaweedFS (`drive-store.test.ts`). |
| P0.5 bound and cancel everything | Partly | Fixed | Launch reconciled by claim (Stop does not wait for it), queued commands end on Stop, spill upload honours Stop, held cleanup that does not settle quarantines, control-plane budgets count elapsed time. |
| P0.6 opaque-secret contract | Partly | Partly | See the premise problem above. |
| P0.7 adversarial validation, hard isolation | Partly | Partly | 25 new fault-injection tests (below); output bounded; accounting and admission. No hard per-session bound: "Hard isolation options". |
| P1.1 credential lock | Fixed (original race) | Fixed | And the new liveness problem: see bug 8. |
| P1.2 registry pruning | Fixed | Fixed | Unchanged. |
| P1.3 config, lazy default | Fixed | Fixed | Unchanged; new settings validated at boot. |
| P1.4 retention, limits, metrics | Partly | Partly | Output bounded, sessions admitted, a stats line a minute. Not metrics in a metrics system. |
| P1.5 cold, cross-runner, long approvals | Partly | Fixed | Two runners on the real lease store and real Daytona (`evidence/round4-fixes/dtx-probe.txt`); QA round 4 approved after 10.8 min (API) and 10 min (web). |
| P2.1 casts, fake provider methods | Fixed | Fixed | Unchanged. |
| P2.2 pi-acp adapter parity | Fixed, limited coverage | Fixed, limited coverage | Unchanged. |
| P2.3 private package imports | Fixed | Fixed | Unchanged. |
| P2.4 direct dispatch, drivers, docs | Partly | Partly | Docs fixed ("How it is built (current)"); the file relay stays (a round 3 decision). |
| R3-4 bounded Daytona calls | Partly | Fixed | Unconfirmed mutations now quarantine (network, launch, kill, held cleanup, resume). |
| R3-5 network enforcement | Partly | Fixed | As P0.3. |
| R3-8 cross-runner ownership | Not fixed | Fixed, with a documented residual window | Decision 1. |
| R3-9 filesystem resource exposure | Partly | Fixed | The synchronous `statSync` and fire-and-forget unmount are gone: an awaited, bounded recovery runs before the plan is built. |
| R3-11 secrets in command text | Fixed narrowly | Fixed narrowly | As P0.6. |
| R3-12 credential store | Partly | Fixed | Bug 8. |
| R3-14 parallel commands | Fixed within one workspace | Fixed | Cross-runner ownership now through the lease store. |
| R3-15 queue after Stop | Fixed, 10 s fallback | Fixed | Refused as not sent after 10 s instead of queued. |
| R3-17 check then open | Partly | Fixed | As P0.2. |
| R3-20 internal paths in refusals | Partly | Fixed | ripgrep never sees a path; run errors are sanitized. |
| R3-21 cleanliness | Partly | Fixed | Names and comments; see "Naming" below. |
| R3W-2 command sees the drive | Partly | Fixed | Every input sent; over-limit files absent, not stale. QA round 4 confirmed the stale-mount race is gone. |
| R3W-5 raw error display | Partly | Fixed | Error contract, both sources sanitized. |
| QA3A-1 runtime throttling | Partly | Fixed | Decision 9. |
| QA3A-3 early cancel reads "no output" | Recorded | Fixed | SDK stream: a cancelled turn with no output ends as stopped, for every provider. |
| QA3A-4 restart message | Fixed | Fixed | Unchanged. |

### Codex round 4: the new bugs

| # | Bug | Status | Fix and test |
| --- | --- | --- | --- |
| 1 | P0: host-file disclosure through `grep` | Fixed | Descriptor-based search; Codex's swap probe as a test, by named path and through the walk. |
| 2 | P0: a late network update defeats fail-closed | Fixed | Quarantine on an unconfirmed change; test lands a stale "open" after a "block" and checks the command's sandbox never saw it. |
| 3 | P0: the lease is not fencing | Fixed (as a lease; the residual window is documented) | Redis compare-and-swap store; tests with interleaved delayed answers, expiry takeover (the stale runner's stop and pointer write are refused), a lost lease blocking a command; 11 real-Redis tests including 20 concurrent claimants; a live race against the POC API (1 of 20 granted, stale write refused). |
| 4 | P0: lost launch responses run a command twice | Fixed | Claim protocol; tests: a lost launch answer runs once and is followed, a provable pre-start failure is retried once, a slow launch plus Stop never runs. |
| 5 | P0: an unrelated push acknowledges output whose pull failed | Fixed | Per-direction acknowledgement; Codex's scenario as a test. |
| 6 | P0: the "atomic" conflict check overwrites drive edits | Fixed | Conditional writes on the store; an injected drive write between staging and publishing keeps the drive copy and saves a conflict copy; deletes are conditional too. |
| 7 | P0.4 gaps: batch limits, whole-second adoption, type replacement | Fixed | Tests for each. |
| 8 | P1: a timed-out refresh keeps the shared lock | Fixed | The signal reaches the locked section; on timeout the lock is released at once; a late rotated token is written only if nothing newer landed. Tests for both. |
| 9 | P1: runtime throttling separates principals, not bookkeeping | Fixed | Explicit bookkeeping route list with its own budget (`AGENTA_API_THROTTLING_BOOKKEEPING_CAPACITY`/`_RATE`); platform tools on the plan buckets. 23 throttling tests. |
| 10 | P1: retry budgets and Stop | Fixed | `fetchControlPlane` counts request time, gives each attempt a signal that fires when the budget is spent, reads HTTP-date `Retry-After`, and stops on the caller's signal; callers that had no deadline now have one. Queue waits, launch and spill upload respect Stop. |
| 11 | P1: error sanitization leaks and hides the better error | Fixed | Error contract; runner and web share the sanitizer rules and test vectors (Codex's two probes included); trace-first order restored for an answer-less turn, except when the trace holds only a raw provider body. |
| 12 | P0/P1: output handling threatens the process | Fixed | No accumulation in the command follower; the full-log backfill runs only under 1 MiB streamed; the spill file has an error listener; ENOSPC (`/dev/full`) and EACCES tests; a memory test pushes 26 MB through and stays under 2 MB. |

### QA round 4

| Id | Status | How |
| --- | --- | --- |
| QA4A-1 command turns fail on the Daytona org's 300 GiB disk quota at 60 sessions | Fixed in the runner; the quota itself is org-wide | Chat-only sessions never created sandboxes: the POC runner logs `sandbox_start=lazy` (the QA note that `early` was set is not what the container shows), and an integration test shows that a chat turn, a denied approval and park create nothing. The quota was hit because each command sandbox holds the snapshot's 5 GiB disk (snapshot `agenta-agent-sandbox-v1`: 2 CPU, 4 GiB memory, 5 GiB disk; 300 / 5 = 60) and a stopped sandbox keeps its disk until it is deleted 120 min later. Now: stopped sandboxes are archived after 30 min, each runner caps concurrent creates and running sandboxes (queued, then refused with a sentence), a quota refusal is asked once more after a jittered wait and then reads as a plain sentence (`sandbox_capacity`, no vendor upsell or link), and a slimmer snapshot, or an image with its own CPU, memory and disk, can be configured for `inprocess` only. A snapshot fixes its own resources, so the size cannot be requested per sandbox; a 2 to 3 GiB snapshot for command work is an operator step (not done: it is org-level). |
| QA4W-1 finished turns vanish under load | Fixed (web) | Not API slowness: traefik shows the snapshot call at 59 ms average and nothing over 4 s. The QA browser held six long-lived streams (two tabs times three), Chrome's HTTP/1.1 limit per site, so every other read queued past the 30 s client timeout; the stack is served over plain HTTP, so no HTTP/2. Two caches then stored the failed read as an answer: liveness emptied the live-session list (closing the reader of the turn in flight and stopping the poll) and records never retried. A failed read now throws, the cache keeps the last good value, records retry with backoff and the poll continues. Test: reads that hang past the timeout still deliver the finished turn. Also: the one slow window (01:18 to 01:25) was seven API hot reloads caused by this round's API edits, not load. Follow-ups outside this change: serve over HTTPS with HTTP/2, or hold fewer streams per tab. The POC web container sat at 7.98 of 8 GiB. |
| QA4W-3 Approve ignores a click and Ctrl+Enter | Click: not a bug. Ctrl+Enter: recorded | The QA tool's element reference matched "Approve" as a substring of four buttons; a real click on the card's button works. Ctrl+Enter from the composer is taken by the composer (new line) before the card sees it, while the dock advertises "Approve Ctrl+Enter". Which gesture wins is a product decision (`ApprovalCard.tsx`, `RichChatInput/plugins/SubmitPlugin.tsx`). |
| QA3A-3 early cancel reads "no output" | Fixed | See above. |
| QA4W-2 a model switch in one tab reaches the agent's other tabs | Recorded, outside this change | The model is part of the agent's saved revision, not of the session. |
| QA4W-4 the build kit turns back on | Recorded, outside this change | The switch lives in localStorage per revision id and defaults to on; a save makes a new revision. |

### Naming

What promised more than it kept is renamed or reworded: the label "fencing" and `stillHeld` are gone (the lease module says what it is not); the registry's `leases` and `lease()` are now `holders` and `hold()`, because "lease" now means the store lease; "atomic compare-and-replace" now says which writers the write gate serializes and that drive files rely on the store's conditional writes; "every wait watches Stop" is replaced by the actual behaviour, including the residual (a burst of output at the very end is part of Daytona's one log answer); `CommandNotStartedError` now means "provably never started".

### `local` and `daytona` parity

Every shared change this round, and why it is neutral or a plain improvement for `local` and `daytona`:

- **`fetchControlPlane` (heartbeat, admission, turn query, records query, interactions).** The budget now covers elapsed time, not only waits; each attempt gets a signal. The turn query and interaction calls had no deadline at all and now stop after 10 s. Improvement: a stalled socket can no longer hold a turn forever.
- **`classifyRunError`.** An error carrying a `publicCode` passes through (only `inprocess` code sets one); a Daytona quota refusal reads as a plain sentence (also for `daytona`: improvement); the unclassified fallback redacts absolute paths, organization ids, UUIDs, `sbx-` ids, keys and raw JSON bodies (improvement; a local user loses a path in an unclassified error, which is the intended privacy rule).
- **`RunErrorCode`** gains `sandbox_capacity`, `runner_capacity`, `sandbox_busy`. Codes are opaque strings downstream; nothing else reads them.
- **`prepareLocalCwd`** (a new optional dep, awaited before the plan). Neither `local` nor `daytona` sets it: neutral.
- **`InRunnerRunFacts.drives`** and the `.tools/` preparation returning its result: `inprocess` branches only.
- **`mutateSubscriptionLogin`** takes an optional signal on the local path; existing callers pass none: neutral.
- **SDK Vercel stream**: a cancelled turn with no output ends as stopped instead of "The agent produced no output." for every provider: improvement (QA3A-3).
- **API throttling**: bookkeeping routes get the reserved budget; platform tools are charged to the plan buckets as before round 3. Neutral to improvement.
- **API lease routes**: new, used only by `inprocess`.
- **Web**: the answer-less turn's error order is trace first again (the pre-round-3 order), both sources sanitized, and the runner's sentence leads only when the trace holds a raw provider body; records and liveness reads retry instead of storing a failure (QA4W-1). Improvements for every provider.
- **Runner tests** that cover `local` and `daytona` all pass (3,686 unit tests), including the provider-wiring parity tests from round 3.

### Numbers

- Real Daytona, one conversation (`evidence/round4-fixes/dtx-probe.txt`): first command with create 2.2 to 2.3 s; warm commands 216 to 325 ms end to end (lease check, push check, command, pull listing); Stop in the middle of `sleep 60` returned with the command dead at 1.5 s from the start of the call (Stop at 1.5 s); a second runner refused while the first held the conversation (after the 2 s wait); after the first runner parked, the second adopted the same sandbox (start plus policy) in 1.2 to 1.7 s.
- Lease store (live, POC API and Redis): 20 concurrent claimants, 1 granted; takeover after expiry at epoch 2 with the pointer kept; a stale holder's pointer write refused; release then claim at epoch 3.
- QA round 4 (API): 40 of 40 concurrent sessions without control-plane errors, 60 at once without any; two 65-turn sessions; a 10.8-minute approval; Stop at about 0.86 s; runner memory 278 MiB, peak 1,016 MiB, back to 305 MiB.
- Tests: runner 3,686 unit tests (plus 3 that need an S3 server, green against a local SeaweedFS) and 17 integration tests, `tsc` clean. API: 11 lease tests against a real Redis, 22 lease route tests, 23 throttling tests, 890 session tests. SDK: 23 stream tests. Web: 18 turn-status tests, 3 records-retry tests, agenta-chat 1,257, AgentChatSlice 352.
- Fault-injection tests added this round (25): late network update; failed network update; two claimants with interleaved late answers; lease expiry takeover (stop and pointer write refused); a command refused after the lease was lost; lost launch answer; provable pre-start failure; slow launch plus Stop; Stop while queued; failed pull followed by an unrelated push; drive write between staging and publishing; drive change during a command plus a refused delete; adoption with equal size and time but other content; type replacement both ways; ENOSPC on the spill file; EACCES on the spill folder; provider quota refused once; quota refused twice; slots full; grep swap by named path; grep swap through the walk; hung refresh releases the lock; late refresh after a newer login; control-plane request time and cancellation; stale mountpoint recovery. Against real services: 11 real-Redis lease tests (20 concurrent claimants among them), 3 real-S3 conditional-write tests, the live two-runner probe and the live lease race.

### Compliance, round 4

Same 40 checks as `CLAUDE-REVIEW.md` section 2. A row is met only when code and a test back it.

| Status | Round 3 now | Round 4 |
| --- | --- | --- |
| Met | 29 | 33 |
| Partly met | 9 | 5 |
| Not met | 0 | 0 |
| Untested | 2 | 2 |

Moved to Met: 5 (scale past one runner: the lease store, unit and real-Redis tests, the live two-runner probe), 8 (commands only in the sandbox: ripgrep no longer resolves any path, `find` is confined), 12 (measure: QA round 4's fresh product-path runs plus the stats line), 24 (approve after 10 minutes: QA round 4 at 10.8 and 10 minutes).

Still partly met: 4 (no hard per-session memory bound; accounting and admission only), 20 (subscription refresh tested in units), 22 (custom secrets readable, as on `daytona`; see the premise problem), 25 (two approvals sequential, a shared Pi constraint), 32 (images unchanged). Untested: 13 (Composio gateway tools), 21 (MCP secrets).

### Hacks left, and why

- **The pi-acp patch** (exports pi-acp's session class, two opt-in options). Upstreaming is the fix; the parity tests catch drift until then.
- **The file relay for Agenta tools in the same process.** A round 3 decision: it carries the tool policy and approval path `local` uses. The clean replacement is a direct, permission-aware transport.
- **Two pi-ai versions plus an alias.** The runner pins `@earendil-works/pi-ai@0.80.6` for other code and Pi 0.85.1 needs 0.85.1; the alias keeps both until they can be aligned.
- **`python3` to set one extended attribute.** Node has no `setxattr`; the refresh of the geesefs view after a publish is one short child process per batch.
- **The sandbox-side sync scripts are bash** (`find`, `tar`, `md5sum`, `base64`). They run in our own snapshot; a small sync agent in the sandbox would replace them.
- **Web commits skip the repo hooks** in this worktree (they fail on the root-owned `node_modules`); prettier, ESLint and gitleaks run by hand.

### Hard isolation options

Rewritten in round 5 with measurements, after Codex showed that worker `resourceLimits` bound only the V8 heap: see "Hard isolation: a decision for Mahmoud" under "Round 5: what changed". The round 4 recommendation (worker threads per session) is withdrawn.

### Not done, and why

- Hiding custom sandbox secrets: needs a wire field (see the premise problem).
- A slimmer snapshot for command sandboxes: org-level Daytona change; configuration is ready.
- Operational metrics in a metrics system: a log line a minute for now.
- HTTP/2 for the web (QA4W-1's root) and fewer streams per tab: outside this change.
- The Ctrl+Enter conflict on the approval card: a product decision.

### Deploying to the POC

The API and web changes are already live (both containers mount this worktree). The runner needs its image rebuilt (new direct dependencies: `@aws-sdk/client-s3` and `tar`, both pinned to versions already in the lockfile), then the snapshot:

1. `bash ./hosting/docker-compose/run.sh --license ee --dev --env-file <the POC env file> --rebuild runner`
2. the POC deploy script

No new environment is required (the lease routes use the runner token the runner already has). Conversations that started on the round 3 runner get a new command sandbox on their next command (the old label leases are not read any more); their old sandboxes are deleted by Daytona's auto-delete. The POC web container was at 7.98 of 8 GiB during QA; restart it after deploying.


## Round 3: what changed

History. What is current is in "Round 5: what changed" and "How it is built (current)".

Round 3 worked through two reviews (`evidence/review-round3/CLAUDE-REVIEW.md`, bugs R3-1 to R3-21; `evidence/review-round3/codex-review.md`, a P0/P1/P2 list) and the two round 3 QA reports (`evidence/qa-round3-api/REPORT.md`, `evidence/qa-round3-web/REPORT.md`). Commits `08cccbf3a6` to `54477d9ac4` on this branch.

### Decisions

Ten decisions were made before the round and are not repeated here (lazy start, the pi-acp patch, the command transaction, one file boundary, bounded calls, fail-closed network, secrets never in command text, the watchdog, one owner per sandbox, no casts). These were decided during it:

- **Custom sandbox secrets are Daytona environment variables set at create.** They never appear in command text, and a sandbox made with other values is replaced, not reused (a keyed fingerprint label compares them). `echo $MY_KEY` still shows the value. That is the same as `daytona` today: its Daytona Secrets cover the model and MCP credentials, and in `inprocess` those never reach the sandbox at all. Why: it meets "never in command text, never dropped" and keeps parity; hiding `sandbox.credentials` from `echo` needs a Daytona Secret per value with a known host, which neither provider has for these values.
- **Two approvals in one step stay sequential, as on every Pi provider.** Pi prepares tool calls one after another (`pi-agent-core` `agent-loop.js`, `executeToolCallsParallel`), so the second gate fires only after the first is answered. The runner then settles the second call as `DEFERRED_NOT_EXECUTED` and it asks again on the next turn. Changing that means pre-gating sibling calls in the shared extension, which changes `local` and `daytona` too. Recorded as a shared follow-up; the spec row stays "partly".
- **The Agenta tool relay stays a file relay in process** (design D4 not done). Why: the relay carries the tool policy and approval path that `local` uses, tested; a direct dispatch would fork the extension per provider for a saving of a few milliseconds per tool call.
- **`grep` keeps running ripgrep as a child process**, pointed only at a root `WorkspaceFs` resolved without following links. Why: ripgrep's regex engine is linear-time and runs off the event loop; a JavaScript grep on a model-written pattern could block every session.
- **The platform's own session traffic gets its own throttle budget** (QA3A-1). The API gives calls made with the runner's secret-resolve grant a per-organization "runtime" bucket (`AGENTA_API_THROTTLING_RUNTIME_CAPACITY`/`_RATE`, default 6,000 per minute), and the runner retries 429, 502, 503 and 504 on control-plane calls with `Retry-After` and jitter, within a budget. A first heartbeat that still gets no answer refuses the turn with "The platform is busy and could not start this turn. Your message was not sent. Send it again in a moment." instead of "already running a turn". Why: user traffic and platform bookkeeping were sharing one user budget, so 40 sessions starting together throttled each other.
- **A restart tells the person to resend** (QA3A-4). A turn that a restart ends reads "The agent service restarted, so this turn was ended. Send the message again in a moment." on the wire and in the transcript. The drain still refuses at once rather than queuing; the web UI shows the sentence as the run error.
- **The chat shows the runner's sentence first, and never a raw provider body** (R3W-5). `AgentMessage.tsx` and the shared `deriveTurnStatus` prefer the run error; a trace error that is a JSON body or names an `org-` id is replaced by what its HTTP status means, with the runner's own wording.

### R3 bugs

| Id | Status | How |
| --- | --- | --- |
| R3-1 `find` lists host files | Fixed | `WorkspaceFs.find` refuses absolute patterns and `..`, and walks only confined roots. |
| R3-2 `edit` can freeze the runner | Fixed | pi-acp's `editDiffs` option: event mapping reads no file. The diff comes from the edit's own bounded, confined read. FIFO test. |
| R3-3 sync deletes drive files | Fixed | A listing with an unreadable entry is incomplete, and an incomplete listing deletes nothing. |
| R3-4 Daytona awaits unbounded | Fixed | `boundedDaytonaApi`: every call has a deadline and an `AbortSignal`; a timed-out call quarantines the sandbox. |
| R3-5 network fails open | Fixed | The policy is applied while the sandbox comes up; if that fails, the command does not run. |
| R3-6 prompt failures lost | Fixed | `rejectPromptFailures`: the prompt rejects with its message and the queue moves on; auth errors keep their ACP mapping. |
| R3-7 watchdog kills silent work | Fixed | `TurnWatchdog` counts any model stream event, has a longer limit for the model and is suspended during tools and dialogs. Both limits are configurable. |
| R3-8 two runners own a sandbox | Fixed | A lease on the sandbox labels (owner, epoch, expiry) with fencing: stop and delete run only while the lease holds. Tested with the fake; not tested across two live runners. |
| R3-9 sync I/O and fan-out | Partly fixed | Walks are sequential and async; no sync read in the hot path. One `statSync` stays in the synchronous cwd seam, the same exposure as the shared `mkdirSync` right after it. |
| R3-10 early start by default | Fixed | Lazy by default. |
| R3-11 secrets in command text | Fixed | Environment variables at create, never in command text (see Decisions). |
| R3-12 credential store | Fixed | Reads and writes go through the locked, lineage-aware subscription writer, with the caller's signal and a timeout. |
| R3-13 park skips a busy sandbox | Fixed | One lifecycle queue; the stop runs after the last use ends; `settle` waits for it at shutdown. |
| R3-14 parallel `bash` pulls half files | Fixed | Commands of one conversation run as serialized transactions (push, run, pull). |
| R3-15 "Queued message" after Stop | Fixed | The next prompt waits (at most 10 s) for the stopped turn to unwind. Integration test fails without the fix. |
| R3-16 pull size unchecked | Fixed | The download is read as a stream with a byte cap. |
| R3-17 check-then-open | Fixed | Every path is opened one component at a time with `O_NOFOLLOW` through `/proc/self/fd`. |
| R3-18 shared state across sessions | Fixed | A private agent dir and an in-memory models store per session; mode hints live and die with the conversation. |
| R3-19 cached env refusal | Fixed | Checked once at boot; the boot fails with a clear message. |
| R3-20 runner paths in refusals | Fixed | Refusals show the model's own path. |
| R3-21 cleanliness | Fixed | One `shellQuote`, one `isInside`, typed config, no `process.env` outside config, no casts in `inprocess`, constant below the imports. `nextEventIndex` is kept: a resumed session's store can already hold events. |

### Codex list

| Item | Status | How |
| --- | --- | --- |
| P0.1 upload and delete driven by error text | Fixed | The bash tool owns its spill file; command output drives no file operation. Forged-path test. |
| P0.2 file I/O in event mapping | Fixed | R3-2, R3-17. |
| P0.3 network fail closed | Fixed | R3-5. |
| P0.4 one transaction per command | Fixed | Acquire, push, run, pull, release, pinned to a sandbox generation; complete listings; atomic compare-and-replace under the conversation's write gate; the manifest moves only after a transfer is acknowledged; a failed transfer leaves the state dirty and retried. |
| P0.5 bound and cancel everything | Fixed | R3-4; Stop ends a command within seconds and kills its process group; an uncertain sandbox is quarantined. |
| P0.6 opaque-secret contract | Fixed as decided | See Decisions: never in command text, never dropped, same as `daytona`. |
| P0.7 failure testing; hard isolation | Partly | Fault tests (hangs, failures, lost commands, replaced sandboxes, adversarial paths) are in. No per-session memory or CPU bound: sessions share one process. |
| P1.1 credential lock and lineage | Fixed | R3-12. |
| P1.2 registry pruning and ownership | Fixed | A lease is counted before pruning; the load test covers 40 concurrent sessions on the control plane. |
| P1.3 one config, validated, lazy default | Fixed | `RunnerInProcessConfig`, validated at boot. |
| P1.4 retention, FS limits, metrics | Partly | Bounded registry and pool, sequential walks, capped transfers. No metrics beyond logs. |
| P1.5 cold, cross-runner, long approvals on the product path | Partly | Restart and approval past the idle limit are integration-tested; QA round 3 approved after 5.5 min across an idle stop and resumed after a restart. Two live runners were not tested. |
| P2.1 casts and fake provider methods | Fixed | A typed `InRunnerHarness` contract; the provider builds no fake sandbox provider. |
| P2.2 pi-acp adapter with parity tests | Fixed | The patch exports pi-acp's own session class; tests compare our event conversion with Pi's and check the default class is unchanged. |
| P2.3 private package-path imports | Fixed | A pinned alias of `@earendil-works/pi-ai@0.85.1` for its public exports. One test reads Pi's `json-event.js` by path, only to compare. |
| P2.4 direct dispatch, stale drivers, docs | Partly | Direct dispatch not done (see Decisions). Stale spike drivers deleted. This section. |

### QA round 3

| Id | Status | How |
| --- | --- | --- |
| R3W-2 command before the drive is in the sandbox | Fixed | P0.4: a command never starts before the push for its generation succeeds; a drive that is not mounted refuses the command with a readable sentence. |
| R3W-5 413 shows raw JSON with the org id | Fixed | Runner: 413 and raw provider bodies read as sentences. Web: see Decisions. |
| QA3A-1 429s under load | Fixed | See Decisions. Load test: 40 concurrent sessions against a throttling fake, 0 failures (5 of 40 fail without the retry). |
| QA3A-2 skill script path; `allowExecutableFiles` rejected | Recorded | The invoke schema takes `allow_executable_files`; the camelCase name is the runner wire, which the SDK converts to. Not a mismatch in this change. |
| QA3A-3 early cancel reads as an error | Recorded | Shared SDK behavior (`vercel/stream.py`): a turn with no output gets "The agent produced no output." even when it was cancelled. Same on every provider. Follow-up: skip that backstop when the stop reason is "cancelled". |
| QA3A-4 drain window rejects turns | Fixed | Readable, retryable sentence (see Decisions). |
| Two approvals in one step | Recorded | Shared Pi constraint (see Decisions). |
| MCP names turn hyphens into underscores | Recorded | `piMcpToolName` in the shared extension; same on `daytona`. |
| R3W-4 approve buttons and synthetic clicks | Not changed | The integration test answers approvals through the same path without problems. |

### Found, outside this change

- **R3W-1, the model picker can crash the page** ("Maximum update depth exceeded", `SelectLLMProviderBase.tsx:706`). Steps: open an agent, new session; Model, expand a provider row, pick a model. Happened once in two tries. Shared UI.
- **R3W-3, a new session turns the build kit back on.** Steps: Advanced, Build kit, turn it off, Save; start a new session; open Build kit again: all tools are on. Same as round 2's R2-6. With the kit on, a small Groq prompt exceeds the free tier's 8,000 tokens per minute.

### `local` and `daytona` parity

- Every trait the shared code asks has the same answer for `local`, `daytona` and unknown ids as the id check it replaced (test in `provider-wiring.test.ts`).
- Active-turn shutdown, the urgent abandon, and the readable restart sentence apply only when the harness runs in the runner (`server.ts`).
- The unmount log change from round 2 is reverted: `local` and `daytona` log as before.
- Intentional shared changes, asked for by the QA findings: readable provider errors (402, 413, raw bodies; R3W-5), the chat's error choice (R3W-5), the control-plane retry and the API's runtime budget (QA3A-1), and the ToolActivity denied icon (round 2, QA1).

### Numbers

- A command on a running sandbox: about 130 ms end to end (was about 350 ms plus 1 s waiting on the log stream). A cold command, sandbox created lazily: about 2 s.
- Stop in the middle of a command: the turn ends as cancelled in under 6 s in the integration test; QA measured 1.67 s on the product path.
- Runner tests: 3,644 unit tests in 210 files, and 15 integration tests, all green; `tsc --noEmit` clean. New in round 3: 75 `inprocess` unit tests in 11 files, 6 integration tests that run the real Pi loop against a scripted model (approval pause past the idle limit, Stop mid-command, Stop then send, silence watchdog, slow reasoning not tripped, runner restart with `/tmp` intact), and the 40-session load test. API: 7 throttling tests. Web: 12 turn-status tests.

### Compliance, round 3

Same 40 checks as `CLAUDE-REVIEW.md` section 2.

| Status | Round 2 (author) | Round 3 review | Round 3 now |
| --- | --- | --- | --- |
| Met | 26 | 17 | 29 |
| Partly met | 12 | 18 | 9 |
| Not met | 0 | 3 | 0 |
| Untested | 2 | 2 | 2 |

Rows that moved to Met: 2 (lazy start; the approval test shows no sandbox before the command), 3 and 35 and 37 (R3-1, R3-2, R3-17), 10 and 27 (restart integration test, QA restart resume), 11 and 36 (lazy start), 17 (network fails closed), 23 (integration test), 28 (bounded, cancellable calls), 29 (pi-acp's own class, R3-15), 33 and 38 (the command transaction; files over 100 MB are still skipped with a notice to the model).

Still partly met, and why: 4 (no memory bound per session), 5 (two live runners not tested), 8 (ripgrep on the runner, confined), 12 (no fresh product-path soak this round), 20 (subscription refresh tested in units only), 22 (custom secrets readable by `echo`, as on `daytona`), 24 (approval tested at 5.5 min, not 10), 25 (two approvals are sequential, a shared Pi constraint), 32 (images unchanged). Untested: 13 (Composio gateway tools), 21 (MCP secrets).

### Hacks left, and why

- **`ToolDefinition<any, any>`** for the tool list: it is Pi's own `ToolDef` type for a mixed list.
- **The pi-acp patch** exports pi-acp's session class and adds two opt-in options. Upstreaming it is the real fix; the parity tests catch drift until then.
- **The file relay for Agenta tools**, ripgrep on the runner, and the one `statSync` in the cwd seam: see Decisions and R3-9.
- **Web commits skip the prettier and turbo-lint hooks** in this worktree: the hooks run `pnpm install`, which fails on the `node_modules` the web container created as uid 10001. Prettier and ESLint were run by hand on the changed files.

### Deploying to the POC (round 3, done)

The runner image now carries new dependencies (the pi-acp patch, the pi-ai alias), so the POC needs its own image before the snapshot:

1. `bash ./hosting/docker-compose/run.sh --license ee --dev --env-file <the POC env file> --rebuild runner` (builds the POC runner image only, then recreates the runner; the override no longer sets early start).
2. the POC deploy script (refuses while a turn runs, and refuses when the image's dependencies differ from the worktree's).

The image was built and checked once: the new code's imports resolve in it, and the boot checks pass with the POC's environment (lazy start, providers `inprocess,daytona`). Nothing was deployed. The web changes are already live on the POC, because its web container mounts `web/` from this worktree.

## Round 2: what changed

History.

### Compliance, before and after

Against the 40 checks of `evidence/review-round1/REVIEW.md` section 1. "Observed" means seen live or in a unit test; "inferred" means argued from code.

| Status | Round 1 | Round 2 |
| --- | --- | --- |
| Met | 11 | 26 |
| Partly met | 16 | 12 |
| Not met | 7 | 0 |
| Untested | 6 | 2 |

The full table is in "Spec compliance" below.

### Review bugs (CR1 to CR25)

| Id | Status | How |
| --- | --- | --- |
| CR1 file tools escape through `~/` and `file://` | Fixed | `WorkspaceFs.confine` resolves the exact path each operation opens, through the realpath of its longest existing parent. Unit tests cover `~`, `file://`, symlinks and `..`. |
| CR2 model can read the login | Fixed | Pi gets an empty private agent folder that no read root covers; the login lives in the connection store. |
| CR3 project settings run `npm` or `git` on the runner | Fixed | Pi is built from memory: in-memory settings, no extensions, themes or prompt templates from disk. |
| CR4 in-process pool invisible to the server | Fixed | One map each for pools, configs and engines; `inprocess` is an entry like `local` and `daytona`. |
| CR5 command hangs when the sandbox dies | Fixed | `SandboxLostError` after 5 failed polls, or 5 s after the logs end with no exit code. |
| CR6 cancel and timeout wrong | Fixed | No launch after a Stop during start or sync; aborted and timed-out commands read as such in Pi; the kill wait is bounded. |
| CR7 sandbox state trusted, never recovered | Fixed | Every start asks Daytona for the real state; stopped, starting, stopping and broken sandboxes each have a path. |
| CR8 parked-sandbox pointer has no owner | Fixed | One `CommandSandbox` per conversation in a registry. The pointer is the turn row's sandbox id; a Daytona label lookup is the fallback. |
| CR9 pull decides by mtime and loses output | Fixed | Before and after listings of the sandbox are diffed: renames, archives, deletes and new folders come back. |
| CR10 push marks files synced before upload, buffers all | Fixed | Push and pull stream GNU tar through temp files, with 100 MB per file and 512 MB per batch limits. |
| CR11 synchronous walks block every session | Fixed | All walks are async. |
| CR12 sync drops the exec bit | Fixed | Modes travel with the tar; mode hints cover the FUSE drive that ignores chmod. |
| CR13 two sessions break each other's refresh | Fixed | One `ConnectionCredentialStore` per login file per process, with serialized `modify` and atomic writes. |
| CR14 incomplete key guard, operator login leaks | Fixed | The guard uses pi-ai's own list of env keys. Managed runs get keys only from the run's model env. |
| CR15 custom sandbox secrets dropped | Partly fixed | The run's sandbox environment is exported into each command (observed). It is not delivered through Daytona Secrets, so `echo` shows it. |
| CR16 prompt during a prompt throws | Fixed | A turn queue, as in pi-acp. |
| CR17 execution never scoped to a project | Fixed | `inprocess` goes through the same dispatch as the others, including `onScopeResolved`. |
| CR18 event and prompt shape differs from pi-acp | Fixed | `session.ts` is a line-by-line port of pi-acp 0.0.29 on Pi 0.85.1: diffs, select, notify, input, editor. |
| CR19 `setModel` accepts any id | Fixed | Unknown ids fail with pi-acp's internal error. No sibling cloning. |
| CR20 Pi built-ins run on the host | Partly fixed | `powershell` is excluded, `find` runs in process. `grep` still runs `rg` on the runner, on the exact confined path. |
| CR21 truncated output points to a runner file | Fixed | The full output moves to `/tmp/agenta-output-*.log` in the sandbox. |
| CR22 throwaway run decided by `/tmp/` | Fixed | A run without a conversation id is a throwaway run. |
| CR23 `.tools/` restore inside the first bash call | Fixed | Runs once per sandbox disk, with the command's abort signal, not counted as a model command. `setup.sh` ran in the sandbox live (`r2-55-tools-restore.png`). |
| CR24 newline in a file name forges the pull list | Fixed | NUL-separated listings. |
| CR25 pull overwrites a newer runner write | Fixed | The runner copy wins, and the model is told. |

### QA round 1 bugs

| Id | Status | Why |
| --- | --- | --- |
| QA1 stopped or denied call shows a green check | Fixed | The summary icon is grey Prohibit when a call was denied (`ToolActivity.tsx`). |
| QA2 root trace latency misses approval wait | Not fixed | Shared tracing, not `inprocess`. Needs its own change. |
| QA3 "Add your model provider key" banner with a working model | Not fixed | Shared frontend; seen again in round 2 with a working Groq key. |
| QA4 geesefs unmount "fails" on every stop | Fixed | The pre-mount cleanup no longer logs a failure when nothing was mounted (`mount.ts`). |
| QA5 cryptic error for the mock model on `daytona` | Not fixed | `daytona` only, and this round must not change `daytona` behavior. |
| QA6 mock re-issues old directives | Fixed | The mock reads only the newest user text. |

### Structure

The review asked for six structural changes (S1 to S6). Five are done. One was changed on purpose.

- **S1, a direct Pi turn engine: not done, on purpose.** The runner's turn code (approvals, park and resume, carried gates, traces, continuity) consumes the ACP session contract. A second engine would duplicate the approval logic, which the spec forbids. Instead, `session.ts` is a faithful port of pi-acp on the same Pi version, so the two cannot drift silently. Replacing the contract for every provider is a separate project.
- **S2, one provider descriptor: done.** `SANDBOX_PROVIDER_TRAITS` answers four questions: files on the runner, commands in a remote sandbox, harness in the runner, allowed harnesses. Shared code asks these instead of comparing ids.
- **S3, one owner per sandbox: done.** `CommandSandboxRegistry` hands every environment of a conversation the same `CommandSandbox`. It reuses the shared teardown and pointer store.
- **S4, exact-path confinement and a manifest sync: done.** `WorkspaceFs` and `WorkspaceSync`.
- **S5, Pi from memory: done.**
- **S6, one credential store per connection: done.**

Code size: the `inprocess` module went from 1,811 to 3,329 lines in 10 files. Shared runner code: 259 lines added, 75 removed across 13 files (traits, pool maps, active-turn shutdown, teardown disposition, QA1 and QA4). Tests: 8 new test files for `inprocess`, plus `active-turns.test.ts` and a 402 case; the runner suite is 3,609 tests, all green, `tsc --noEmit` clean.

### Turns that never finish (P0)

- A graceful runner shutdown ends every running turn first (`endActiveTurns`, 5 s budget). The turn's record carries the readable sentence "The agent stopped responding and the run was closed. Send the message again to retry."
- A hard kill leaves nothing to end the turn from inside; the API's existing watchdog closes it after its 90 s heartbeat window (observed about 128 s).
- An `inprocess` turn with no event for 120 s, outside tool calls and approvals, ends with a readable error (`run-limits.ts`, `AGENTA_RUNNER_INPROCESS_IDLE_TIMEOUT_MS`).
- Provider errors go through the shared classifier and read as sentences: 401, 402 (OpenRouter's "insufficient credits" was added), and 429 and 413 rate limits (observed for 402, 429 and 413). One exception is in the web UI, see "What is left".

### Hacks kept, and why

- **Two casts at the engine seam** (`index.ts`). The environment uses the provider and the host structurally, but the seams are typed as sandbox-agent's `SandboxAgent.start` and provider builder. A typed seam broke existing test doubles through contravariance. The casts are the only place the types meet.
- **Pi's full-output path is read from its error text** (`tools.ts`). Pi's bash tool throws a plain `Error` on a non-zero exit, with the output file path only in the message. Without it, the model would get a runner path it cannot read.
- **Pi internals imported by path** (`pi-internals.ts`): pi-ai's `env-api-keys.js` and `mime.js`. They are the only source for the key list and image types. Pinned to Pi 0.85.1.
- **The mock model and the soak driver** keep test-only shortcuts (a 5 s wait before reading execution rows). Not product code.

### Latency, before and after the rework

Host runner, mock model, same machine.

| Measure | Round 1 | Round 2 |
| --- | --- | --- |
| TTFT | 0.34 to 0.51 s | 0.34 to 0.53 s |
| Environment ready | 0.03 to 0.2 s | 0.038 to 0.221 s |
| Command start, cold (no sandbox) | 2.3 to 2.8 s | about 1.55 s after the tool call |
| Command start, sandbox running | about 300 ms plus 30 to 45 ms sync | 1 to 9 ms wait plus about 350 ms exec |
| Command start, sandbox stopped | 1.5 s | 1.1 to 1.5 s |
| Stop during a command, click to stopped | about 12 s | 2.6 s, no process left |
| Product path, 38-session soak | not run | p50 2.5 s, max 4.7 s per turn |
| Groq `gpt-oss-120b` TTFT | not run | 557 ms (host runner) |

### What is left

- **Early start costs a sandbox per conversation.** The soak's 38 chat sessions created 38 sandboxes. The first soak run hit Daytona's shared 300 GiB disk cap after 27 sessions; the command failed with a readable tool error. Recommend lazy start by default (`AGENTA_RUNNER_INPROCESS_SANDBOX_START=lazy`).
- **The web UI shows the raw provider error** on a turn with no answer. `AgentMessage.tsx:336` prefers the trace's error over the runner's sentence, so a Groq 413 shows raw JSON although the runner recorded "Too many requests right now". Shared frontend, all providers.
- **Warm approval resume never engages** from the playground. The history fingerprint includes the approval id, so the resume goes cold. Parallel gates then read as "approved, result unknown" and ask again. Shared code.
- **Custom sandbox secrets** reach commands as env vars, so `echo` shows them. Daytona Secrets would hide them (CR15).
- **`grep` runs `rg` on the runner**, confined to the exact path (CR20).
- **No memory bound per session.**
- **Cross-runner resume** is untested; the pointer and the label lookup are built for it.
- **Untested:** Composio gateway tools, MCP servers with secrets, images to a vision model, approval after ten minutes.
- **Stored pointers from round 1** (`inprocess/pending-...`) are not usable ids; Daytona answers "not found" once and a new sandbox is created. Only this POC has them.

## The numbers (round 1)

Round 2 latency is in "Round 2: what changed". The rows below are the round 1 baseline.

All times are observed unless marked "inferred". Evidence files are in `evidence/`.

| Measure | `daytona` (today) | `local` (today) | `inprocess` (spike) |
| --- | --- | --- | --- |
| Environment ready (acquire), mock model | 7.0 to 7.7 s | 1.5 to 3.0 s | 0.03 to 0.2 s |
| Time until the first model request leaves | 7.9 to 8.8 s | about 2.2 to 3.0 s | about 0.05 to 0.25 s |
| TTFT, mock model (300 ms model latency) | not reachable from the sandbox (note 1) | 2.5 to 3.3 s | 0.34 to 0.51 s |
| TTFT, real model `gpt-5.6-luna` (ChatGPT subscription) | about 9.3 to 10.6 s (inferred, note 2) | 3.7 to 5.1 s | 1.5 to 3.3 s |
| TTFT through the product (`/services/agent/v0/invoke`), mock | not measured | not measured | new session 1.4 to 3.2 s, warm session 0.8 s |
| Command start, sandbox running | tens of ms (in-sandbox exec, inferred) | about 40 ms (host) | about 300 ms round trip, plus 30 to 45 ms sync when nothing changed |
| Command start, sandbox stopped | about 1 to 2 s start (inferred, same Daytona start) | n/a | 1.5 s (start 0.8 to 1.8 s; one outlier 13.3 s) |
| Command start, cold (no sandbox yet) | part of the 7 s acquire | n/a | 2.3 to 2.8 s (create 0.75 to 1.3 s); hidden when the sandbox is started early |
| Sandbox running seconds, one cold chat turn | about 10 s | 0 | 0 with lazy start; 1 to 3 s with early start |
| Sandbox running seconds, a session | whole session, including every model call, plus the 120 s warm window | 0 | while commands run, plus the time until the warm pool evicts (60 s default), then stopped |
| Runner memory per live session | n/a (runner holds an ACP client only) | a Pi process per session (not measured) | 1.6 to 3.3 MB RSS, 0.2 to 0.8 MB heap (10 to 100 sessions) |

Notes:
1. The mock model runs on this box, and Daytona sandboxes cannot reach it without exposing it publicly, which the spike did not do. The `daytona` rows therefore stop at the first model request (the request goes to an unresolvable host and fails fast; the stream shows when Pi sent it).
2. `daytona` real-model TTFT = observed time to first model request (7.9 to 8.8 s) + observed luna TTFT (1.4 to 1.8 s, bake-off). Not run directly: the only working real credential is the ChatGPT subscription, and delivering it to `daytona` writes the login into a Daytona sandbox, which the spike rules forbid.

Where the `daytona` time goes (runner timing log, one run): sandbox start 2.2 s, Pi install check 0.7 s, workspace 0.6 s, capability probe 0.3 s, ACP session open 3.1 s.

### Load test (step 7.1)

Mock model, 2 turns per session. Box memory was watched before and during each run: available memory never dropped below 21 GB; disks stayed at 47% (`/data`) and 72% (`/`).

| Sessions | Where | Failures | TTFT p50 / p95 | Memory |
| --- | --- | --- | --- | --- |
| 10 | Pi sessions in one process (`spike/load-sessions.ts`, removed in round 3) | 0 | 354 / 419 ms | 2.4 MB RSS per session |
| 25 | same | 0 | 322 / 333 ms | 3.3 MB per session |
| 50 | same | 0 | 333 / 350 ms | 2.0 MB per session |
| 100 | same | 0 | 354 / 385 ms | 1.6 MB per session |
| 10 | full runner, concurrent `/stream` cold turns (`spike/load-runner.ts`) | 0 | 588 / 590 ms | runner 327 to 356 MB |
| 25 | same | 0 | 631 / 633 ms | 356 to 407 MB |
| 50 | same | 0 | 754 / 798 ms | 407 to 464 MB |
| 100 | same | 0 | 1,267 / 1,271 ms | 465 to 499 MB |

Reading: the Pi session itself is cheap, in line with Rivet's 0.8 MB. At 100 simultaneous cold turns the runner's single event loop adds about 1 s (acquire work is CPU on one thread). A long real session keeps its transcript in memory (a 400-turn transcript is 643 KB on disk), so plan on a few MB per active session, not hundreds.

The 10-session real-model load run was not done: the subscription is personal and rate limited, and the spike kept paid volume small.

### Model bake-off

| Model | Route | Result |
| --- | --- | --- |
| `deepseek/deepseek-v4.1-flash` | OpenRouter | Blocked: 402 "Insufficient credits" on the named key. Not in the pinned catalog; the spike registers it by cloning a sibling OpenRouter entry. |
| `z-ai/glm-5.3-flash` | OpenRouter | Blocked: 402. In the pinned pi-ai 0.85.1 catalog. |
| `openai/gpt-5.6-luna` | OpenRouter | Blocked: 402. In the catalog. |
| `openai-codex/gpt-5.6-luna` | ChatGPT subscription | Works. TTFT 1.4 to 1.8 s over 3 runs, tool round trip correct 3 of 3, about $0.00002 per turn at list price. Chosen as the main model. |
| `google/gemini-3.8-flash` (fallback) | OpenRouter | Not tried (same 402). |

The subscription first answered "usage limit has been reached" and worked about an hour later. `gpt-5.3-codex-spark` and `gpt-5.4-mini` are refused for ChatGPT accounts. Evidence: `evidence/bakeoff-*.jsonl`.

A bug found on the way: when a model id is missing from the catalog, cloning "the first sibling" picked an `anthropic-messages` model on OpenRouter. The clone must match the API family (`openai-completions`). Fixed in the spike.

## How it was built (historical snapshot, rounds 1 to 6)

Superseded. The current design is in `design.md` and in the sections above. The runner-side sync, the sandbox lease routes, the 22 in-process settings and the 6,000-per-minute bookkeeping default described here are gone.

Pi runs in the runner through `createAgentSession` (Pi SDK 0.85.1). The runner's `acquireEnvironment` runs unchanged; for `inprocess` it gets an in-runner harness host instead of a sandbox-agent daemon (`InRunnerHarness`, `runtime-contracts.ts`). Code in `services/runner/src/engines/inprocess/`:

| File | Owns |
| --- | --- |
| `index.ts` | The provider: registry, the runner's sandbox owner and its sweep, sandbox slots, session ledger, the stale-mount recovery before the plan, the env-key refusal at boot, the stats line. |
| `harness-host.ts` | `InProcessHarnessHost`: sessions, runner file calls, processes, park and delete for one environment. |
| `session-ledger.ts` | Session admission (count, heap pressure) and per-session memory accounting. |
| `conversation-registry.ts` | One `ConversationWorkspace` per conversation in this runner; park, delete, pruning, counters. |
| `conversation-workspace.ts` | One command is one transaction: acquire, push, prepare, run, pull, release; cancellation while queued. |
| `pi/acp-session.ts` | pi-acp's own session class (exported by our patch) driven in process: events, prompts, Stop, dialogs. |
| `pi/pi-session-factory.ts`, `pi/credentials.ts`, `pi/extension-ui-channel.ts`, `pi/turn-watchdog.ts`, `pi/rpc-event.ts` | Pi built from memory; model keys and the subscription store; dialogs; the silence watchdog. |
| `sandbox/command-sandbox.ts` | The conversation's Daytona command sandbox on this runner: bring up, create, network policy, park, delete, retire. It only ever uses a sandbox this runner created. |
| `sandbox/sandbox-owner.ts` | The runner's owner record in the API's Redis (compare-and-swap behind `/sessions/control/sandbox-leases/*`), its renewal, and the sweep that deletes sandboxes nobody uses. |
| `sandbox/remote-command.ts` | One model command under a sandbox-side supervisor: the process group recorded before the claim, bounded output reads, Stop and its proof, "outcome unknown". |
| `sandbox/sandbox-slots.ts` | Admission for sandbox creates and running sandboxes. |
| `sandbox/daytona-api.ts`, `sandbox/serial-queue.ts` | Bounded Daytona calls; the lifecycle queue. |
| `tools/file-tools.ts`, `tools/grep-tool.ts`, `tools/bash-tool.ts`, `tools/command-output.ts`, `tools/edit-diffs.ts` | Pi's tools with our operations: file tools through `WorkspaceFs`, grep over confined descriptors with bounded output, `bash` in the command sandbox with its full output kept there. |
| `workspace/workspace-fs.ts` | `WorkspaceFs`: every path opened one component at a time with `O_NOFOLLOW`, regular files and folders only. |
| `workspace/workspace-sync.ts`, `workspace/sandbox-listing.ts`, `workspace/tar-archive.ts`, `workspace/drive-store.ts` | The sync around commands: per-direction acknowledgement, no push over unapplied changes, listings, node-tar archives, conditional writes and create-only conflict copies on the drive. |

API side: `api/oss/src/core/sessions/sandbox_leases/`, `api/oss/src/dbs/redis/sessions/sandbox_leases.py`, `SandboxLeasesRouter` in `api/oss/src/apis/fastapi/sessions/router.py` (since round 5 the runner uses acquire, renew and release for its owner record; the pointer route is unused). Shared code asks `sandboxProviderTraits(id)` (`config/runner-config.ts`) instead of comparing provider ids. Tool relay, approvals, gateway policy, tracing and continuity are the same code as for `local` and `daytona`.

Configuration (runner env, all validated at boot): `AGENTA_RUNNER_INPROCESS_SANDBOX_START` (`lazy` default, or `early`), `_SANDBOX_LABELS` (`k=v,...`), `_IDLE_STOP_MS` (5 min), `_AUTOSTOP_MINUTES` (15), `_AUTODELETE_MINUTES` (120), `_AUTOARCHIVE_MINUTES` (30), `_OWNER_TTL_MS` (60 s, 1 to 600 s), `_SANDBOX_SNAPSHOT` or `_SANDBOX_IMAGE` with `_SANDBOX_CPU`, `_SANDBOX_MEMORY_GIB`, `_SANDBOX_DISK_GIB` (image only), `_MAX_CONCURRENT_SANDBOX_CREATES` (8), `_MAX_RUNNING_SANDBOXES` (40), `_SANDBOX_SLOT_WAIT_MS` (20 s), `_MAX_SESSIONS` (200), `_HEAP_PRESSURE_RATIO` (0.85), `_IDLE_TIMEOUT_MS` (120 s), `_MODEL_SILENCE_TIMEOUT_MS` (10 min), `_FILE_TOOL_MAX_BYTES` (64 MiB), `_SESSION_POOL_MAX` (64), `_ALLOW_ENV_KEYS` (false); all prefixed `AGENTA_RUNNER_INPROCESS`. API: `AGENTA_API_THROTTLING_BOOKKEEPING_CAPACITY` and `_RATE` (6,000 per minute each).

## Spec compliance

History: the per-row detail as of round 2. The current counts and the rows that moved are in "Compliance, round 5".

Round 2 status against the 40 checks of the round 1 review. "Round 1" repeats the review's status.

### pi-inprocess-runtime

| Check | Round 1 | Round 2 | Evidence |
| --- | --- | --- | --- |
| Select `inprocess`; a non-Pi harness is refused before start | Met | Met (observed) | Trait `harnesses`; unit test in `provider-wiring.test.ts`. |
| Start answering without waiting for a sandbox | Met | Met (observed) | Environment ready 38 to 221 ms; the sandbox starts in the background. |
| Isolate sessions; no provider keys in process env; two users | Not met | Met (observed) | CR1, CR2, CR3, CR14 fixed with unit tests; two parallel POC sessions stayed in separate sandboxes. |
| Survive a bad session; bound memory | Not met | Partly met (observed) | Walks are async and pushes are bounded (CR10, CR11). No memory bound per session. |
| Scale past one runner | Partly met | Partly met (observed on one runner) | Pointer in the turn row plus label lookup; reattach after a runner restart observed. Cross-runner untested. |
| Keep tracing | Met | Met (observed) | Same extension and exporter. |
| Sub-agents not blocked | Met | Met (inferred) | Unchanged. |

### sandbox-lifecycle

| Check | Round 1 | Round 2 | Evidence |
| --- | --- | --- | --- |
| Commands run in the sandbox, never on the host | Partly met | Partly met (observed) | `bash`, `runProcess` and `.tools/` go to the sandbox; no project settings; `powershell` excluded. `grep` runs `rg` on the runner (CR20). |
| Start early; first command waits only for the rest | Met | Met (observed) | Single-flight start; a Stop during the start runs nothing (CR6). |
| Stop when idle; resume with `/tmp` intact | Partly met | Met (observed) | Stop and resume with `/tmp` and exec bits intact; outside stops and deleted sandboxes recover (unit, CR7). |
| No sandbox for sessions that never need one | Partly met | Partly met (observed) | Met with `lazy`. The default `early` made 38 sandboxes for 38 soak sessions. |
| Measure TTFT, command start, sandbox seconds | Partly met | Partly met | `daytona` real-model TTFT still inferred. |

### tool-execution

| Check | Round 1 | Round 2 | Evidence |
| --- | --- | --- | --- |
| Gateway tools without a sandbox (Composio) | Untested | Untested | No Composio connection on the POC. |
| MCP gateway; a denied tool is not offered | Untested | Met (observed) | Mock MCP server: allowed tool runs, "ask" tool shows a card, denied tool is not offered (`r2-39` to `r2-46`). |
| Platform tools; `commit_revision` asks | Untested | Met (observed) | `read_config` through the relay; commit shows an approval card (`r2-37`, `r2-38`). |
| Tools from scripts: decision recorded | Met | Met | Unchanged. |
| No new permission rules; same decision on both providers | Partly met | Met (observed) | A network policy is applied to the command sandbox instead of being refused. |

### secret-isolation

| Check | Round 1 | Round 2 | Evidence |
| --- | --- | --- | --- |
| Model credentials stay in the runner, not shown to the model | Not met | Met (observed) | CR1 and CR2 fixed; the sandbox env has no model or runner keys. |
| Agent runs `env` in the sandbox | Met | Met (observed) | Only the run's own custom secret appears. |
| ChatGPT subscription: refresh, publish, no older token written back | Partly met | Partly met (unit only) | CR13 fixed and unit-tested. No live login: installing the host login into the POC was refused as credential leakage. |
| MCP secrets stay server-side | Untested | Untested | The mock MCP server had no secret. |
| Custom secret usable, not readable | Not met | Partly met (observed) | Usable in commands (length 28 observed); readable by `echo` (CR15). |

### approvals

| Check | Round 1 | Round 2 | Evidence |
| --- | --- | --- | --- |
| Same cards; `ask` shows a card before `bash` | Met | Met (observed) | UI approve and deny, warm and cold (`r2-06` to `r2-11`). |
| Pause and resume; approve ten minutes later | Partly met | Partly met (observed) | Park and resume work on the cold path. Ten minutes not tested. Warm resume never engages (shared). |
| Two cards, each decision for its own call | Partly met | Partly met (observed) | Two cards answered in the UI (`r2-12` to `r2-14`). A parallel gate can read as "approved, result unknown" and ask again (shared). |

### session-continuity

| Check | Round 1 | Round 2 | Evidence |
| --- | --- | --- | --- |
| Continue a warm session | Met | Met (observed) | Pool hit. |
| Resume a cold session; restart keeps history | Partly met | Partly met (observed) | Runner restart then resume: history, sandbox by label, `/tmp` intact. Cross-runner untested. |
| Cancel stops the model and the command | Partly met | Met (observed) | Stop mid-command 2.6 s, no process left; unit tests for Stop during start, sync and kill. |
| Live events look the same as `daytona` | Partly met | Met (observed, unit) | pi-acp port; diffs, select, notify, input and editor mapped. |

### skills-and-attachments

| Check | Round 1 | Round 2 | Evidence |
| --- | --- | --- | --- |
| Skills listed and readable without a sandbox | Untested | Met (observed) | Skill found and read (`r2-27`, `r2-28`). |
| Skill scripts run in the sandbox | Not met | Met (observed) | Skill script ran in the sandbox (`r2-35`, `r2-36`); exec bits kept by mode hints (unit). |
| User images reach the model | Untested | Partly met (observed) | An image reached a non-vision mock as a file path. Vision model untested. |
| Shared files visible in the drive | Partly met | Met (observed) | Write, rename, delete and chmod all show in the files pane. |

### workspace-files

| Check | Round 1 | Round 2 | Evidence |
| --- | --- | --- | --- |
| Same folders and paths | Met | Met (observed) | Unchanged. |
| List, search, read, create, edit, delete; confined | Not met | Met (observed) | Deletes sync both ways; CR1 fixed. |
| Edit without shell needs no sandbox | Partly met | Partly met | Met with `lazy`; `early` starts one anyway. |
| Path escape refused | Not met | Met (unit) | `~`, `file://`, symlinks, `..`. |
| Files and commands agree | Partly met | Met (observed) | Rename, archive, delete and new folders come back (listing diff). |
| Keep folder features: README, `.tools/`, links, last writer | Partly met | Met (observed) | `setup.sh` ran in the sandbox before the first command (`r2-55`); `bin/` exec bits by unit test (CR12, CR23). |
| Temporary files stay on sandbox disk | Met | Met (observed) | `/tmp` survives stop and start. |

Totals: 26 met, 12 partly met, 0 not met, 2 untested.

### Soak and restart evidence

- `evidence/qa-round2/soak.json`: 38 of 38 finished, 38 terminal execution rows, all "completed".
- `evidence/qa-round2/soak-run1-quota.json`: the first run, where 4 command turns failed on Daytona's disk cap with a readable tool error; every turn still ended.
- `spike/restart-regression.sh`: graceful restart settles the UI in 5 s; a hard kill is closed by the API watchdog after about 128 s.

## Answers to the explorative directions

**E1, files without a sandbox.** Recommendation: runner folder as the source of truth, file tools on the runner, sync around commands (a fourth option, D, not in the design). It needs no store access from the sandbox and no second FUSE view, so "two views disagree" goes away: the views are identical at every command boundary. Costs: 30 to 45 ms per command plus a push of whatever changed. Round 2 replaced the mtime walk with listing diffs on both sides and tar streams: renames, deletes and new folders now come back, and files over 100 MB or batches over 512 MB are skipped with a notice. Open issue: the listing cost grows with the folder (R5). Option A (both sides mount the store) was not tested, because the dev store is not reachable from Daytona without exposing it. Option B (Daytona FS API for every file operation) needs a running sandbox for every read, which defeats goal 2.

**E2, early or lazy start.** Recommendation: lazy by default, early when a command is likely (for example the conversation has used `bash` before, or the agent has skill scripts). Early start hides a 0.75 to 1.3 s create behind the first model call; lazy start pays it once on the first command and costs zero sandbox seconds for chat-only turns. Start from stopped is 0.8 to 1.8 s (one 13 s outlier). The share of real sessions that run a command was not measured (needs production data).

**E3, custom secrets.** (Corrected in round 4: `daytona` does not deliver `sandbox.credentials` through Daytona Secrets; see "Decisions taken during the round".) Recommendation: Daytona Secrets for `sandbox.credentials`, once the wire carries the host each one may reach. They meet the "not readable" target for `echo` and `env` (observed for the model key). A runner-side egress proxy would move substitution into our code but adds a hop for all sandbox traffic; not worth it now. Wiring them into `inprocess` is a small reuse of `daytona-secret-plan.ts` (not done).

**E4, many runners.** Recommendation: stateless-capable, sticky as an optimization. Reloading a 400-turn session costs about 50 ms from local disk, so a turn can land on any runner. Keep the warm pool (it saves the reload and the sandbox reattach) and route a conversation back to its runner when possible. Since round 5 a runner never uses another runner's sandbox: a conversation that moves gets a fresh sandbox restored from the drive, and each runner's owner record in the API's Redis decides who deletes a sandbox whose runner is gone.

**E5, agentOS.** Not tried. E1 worked without it.

## Risks the design did not list

- **R1. One event loop for every session.** 100 simultaneous cold turns added about 1 s of latency. A CPU-heavy session (a huge edit, a large grep result, a big transcript) delays all others. Mitigation: worker threads per group of sessions, or a cap on sessions per runner.
- **R2. Infrastructure secrets in the same process** as model-driven code. File confinement is the wall between them (see secret-isolation).
- **R3. Host execution hides in shared code.** Round 2 closed `runProcess`, the `.tools/` restore, project settings and `powershell`. Round 4: `grep` still runs `rg` on the runner, but only over descriptors `WorkspaceFs` opened. Any code path written for `local` must be checked for `inprocess`.
- **R4. Runner paths must be valid sandbox paths.** The sandbox user cannot create `/var/lib/agenta`, so `inprocess` durable folders live under `/home/sandbox/agenta` on the runner too.
- **R5. Sync cost grows with the folder.** Each command lists the folder on both sides. Files over 100 MB and batches over 512 MB are skipped with a notice to the model.
- **R6. The HTTPS-only model endpoint rule** blocks a plain-http local model in the product path; the POC uses a self-signed certificate trusted only by its runner.
- **R7. (Closed in round 3.)** The port of pi-acp's event mapping is gone: pi-acp's own session class is used through a patch that exports it.
- **R8. Parked sandboxes wait for Daytona's auto-delete.** A parked command sandbox is stopped, not deleted, and Daytona deletes it after 120 minutes (`AGENTA_RUNNER_INPROCESS_AUTODELETE_MINUTES`).
- **R9. Parked sandboxes can fill the Daytona org.** Each command sandbox holds its snapshot's 5 GiB disk until it is deleted. Round 3 made lazy start the default; round 4 archives stopped sandboxes after 30 minutes, caps creates and running sandboxes per runner, and turns a quota refusal into a sentence (QA4A-1). The org quota is shared with other stacks.
- **R10. (Closed in round 3.)** Pi internals are no longer imported by path; a pinned alias of pi-ai 0.85.1 gives its public exports.

## Proposed decisions for Mahmoud (proposals, not decided)

- **P1.** Build `inprocess` as a real provider for Pi, behind a flag, with **lazy** sandbox start by default. Reason: 5 to 7 s faster first answer, and the soak showed early start costs one sandbox per conversation (R9).
- **P2.** Keep the ACP session contract, driven through pi-acp's own session class (round 3). Replace the contract for all providers later, as its own project. Reason: the turn, approval and continuity code consume it; a second engine would duplicate approval logic.
- **P3.** Files: the runner folder is the source of truth, file tools run on the runner, a listing-based sync runs around commands. Delete propagation and size limits are done.
- **P4.** Credentials: model keys per run, one credential store per subscription login, and the runner refuses `inprocess` with provider keys in its env. Publish refreshed subscription tokens straight to the API.
- **P5.** Custom sandbox secrets: deliver through Daytona Secrets so `echo` shows a placeholder (CR15). Needs the allowed host on the wire first, in both providers (round 4).
- **P6.** Continuity: keep the transcript in the durable session folder, let any runner resume, keep sticky routing as an optimization. A runner uses only the sandboxes it created; another runner restores a fresh one from the drive (round 5).
- **P7.** Before multi-tenant use: move infrastructure secrets out of the runner process that runs Pi, and decide on hard isolation (R1, R2; "Hard isolation: a decision for Mahmoud" in round 5).
- **P8.** Fix the shared web UI to show the runner's readable error instead of the raw trace error (`AgentMessage.tsx:336`), and the warm approval resume fingerprint. Both affect every provider.

## Step-by-step spec check (round 1)

Round 1 results, kept for history. Where they differ, "Spec compliance" above is current.

Each step of `tasks.md`, the requirements it touches, and the result. Pass = observed, Inferred = reasoned, Untested = not run.

- **0.1 Baseline.** sandbox-lifecycle "Measure time and cost": Pass for `daytona` acquire and time to first model request; real-model TTFT inferred (note 2). Baseline traces not captured (the host runner had no trace credential).
- **0.2 Daytona latency.** sandbox-lifecycle "Stop when idle, resume": Pass at the Daytona level (create 1.1 s, start from stopped 0.8 to 13.3 s, running command 17 to 40 ms, `/tmp` survives stop).
- **1.1 Provider id.** pi-inprocess-runtime "Select the provider", "Claude asks for inprocess": Pass.
- **1.2 Pi SDK session with a per-session runtime.** pi-inprocess-runtime "Isolate sessions", "Start answering without waiting": Pass.
- **1.3 Stream events, traces.** session-continuity "Live events", pi-inprocess-runtime "Keep tracing": Pass (UI and product traces).
- **2.1 Extension config per session.** pi-inprocess-runtime "Isolate sessions": Pass (`createAgentaExtension(env)`). Module-level state audit: `pi-mcp.ts` keys its registry by Pi instance (safe); `tracing/otel.ts` keys its maps by run and trace ids and shares one tracer provider (safe for spans, noted).
- **2.2 Relay executor.** tool-execution "No new permission rules": Pass. Decision: keep the local file relay instead of calling `executeRelayedTool` directly (D4 deferred). It already runs in process on local disk, adds about 100 ms per tool call, and touches nothing in the permission path.
- **2.3 Approvals.** approvals, all three scenarios: Pass, Pass, same as today.
- **3.1 Files.** workspace-files "Write then run", "Edit without shell": Pass with option D.
- **3.2 Confinement.** workspace-files "Path escape": Pass.
- **3.3 Skills.** skills-and-attachments "Read a skill", "Run a skill script": Inferred.
- **4.1 Bash in Daytona, early start.** sandbox-lifecycle "Commands run in the sandbox", "Start early": Pass.
- **4.2 Idle stop, cancel.** sandbox-lifecycle "Stop when idle", session-continuity "Cancel a turn": Pass.
- **4.3 `.tools/` restore.** workspace-files "Tools restore": Implemented, untested live.
- **5.1 ChatGPT subscription.** secret-isolation "ChatGPT subscription works": Pass for use; refresh simulated by unit test.
- **5.2 Custom secrets.** secret-isolation "Secret echoed": Pass for Daytona Secrets; "Secret in a command": Inferred.
- **5.3 No key in env or sandbox.** secret-isolation "Agent prints its environment": Pass (sandbox has no env vars; runner guard).
- **6.1 Transcript and rebuild.** session-continuity "Resume a cold session": Pass.
- **6.2 Reload time.** E4: 50 ms for 400 turns.
- **7.1 Load.** pi-inprocess-runtime "Isolate sessions": 10 to 100 sessions, zero failures. "Survive a bad session", memory bound: not built.
- **7.2 Compare.** Tables above.
- **7.3 Findings.** This file.
