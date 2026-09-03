# Child-process cleanup after a Stop

> AGENT-GENERATED, low weight. Measurements are real and reproducible; the conclusions and the
> recommendation are an agent's. Mahmoud makes the final decisions.

## The answer in one paragraph

Spike A's finding is confirmed and now has a mechanism and a fix. A stopped Codex turn leaves its
shell command running inside the parked sandbox; Pi kills its child inside 0.2 seconds, and Claude
Code does too, which Spike A could not measure. The leak is not a Codex bug we can reach from the
ACP bridge: `@agentclientprotocol/codex-acp` is a thin JavaScript bridge over a Rust `codex
app-server` subprocess, the shell child is a DIRECT child of that Rust process, and the bridge
holds no pid for it. The bridge's `cancel()` sends `turn/interrupt`, that request succeeds, and the
prompt settles `cancelled` in about 48 ms. The Rust core simply abandons the exec, and that core is
a stripped vendored binary we pin rather than build. So the narrowest change we own is a reap from
the RUNNER, through the sandbox daemon's one-off process API, killing only descendants of the
`codex app-server` that are younger than the turn that was stopped. It is implemented on
`spike/session-cancel-warm`, it ships in the runner image alone, and it needs NO Daytona snapshot
rebuild. Live on a dedicated stack: the child is gone at the Stop, the sandbox still parks, the next
message resumes warm on the same sandbox, and that next turn can still run a shell command.

## Scenarios

| Scenario | Provider | Harness | Stack / commit | Result | Timing | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Stop a running `sleep`, watch across the park window | local | codex | integration `9110c08000`, 8580 | child ALIVE after Stop | alive 56.3 s, gone by 61.4 s | `run-codex-2.json`, `runner-codex-2.log` |
| Stop, then continue INSIDE the park window | local | codex | integration `9110c08000` | child alive through the warm turn 2 | alive at 20.5 s and after turn 2 | `run-codex-3-warm-turn2.json` |
| Same, with a `python3` blocking command | local | codex | integration `9110c08000` | child ALIVE, so not a `sleep` artefact | alive at 35.8 s and after turn 2 | `run-codex-4-python.json` |
| Stop a running `sleep` | local | pi_core | integration `9110c08000` | child GONE | gone by 0.2 s | `run-pi_core-1.json` |
| Stop a running `python3` blocker | local | claude | integration `9110c08000` | child GONE | gone by 0.2 s | `run-claude-3.json` |
| Fix: Stop a running `sleep` | local | codex | spike `9e21fba4ee`, 8980 | child KILLED, sandbox parked, warm resume | reap at the abort | `fix-codex-1.json`, `runner-fix-codex-1.log` |
| Fix: turn 2 runs a NEW shell command | local | codex | spike `9e21fba4ee` | warm turn 2 executed `echo` and returned it | turn 2 in 4.4 s, no `sandbox_start` | `fix-codex-2-turn2shell.json` |
| Fix: Pi regression check | local | pi_core | spike `9e21fba4ee` | no reap line, parked, warm turn 2 ran a shell command | turn 2 in 3.2 s | `fix-pi_core-1.json` |
| Fix, after the rounding refinement | local | codex | spike `5cdd23ab72` | child killed, parked, warm turn 2 ran a shell command | turn 2 in 3.5 s | `fix-codex-3-final.json`, `runner-fix-codex-3.log` |

Raw evidence: `~/agenta-qa-evidence/2026-09-03-session-round2/child-cleanup/`. The driver is
`child_cleanup_live.py` in that folder. Every run mints its own account and project, so the other
lane's Daytona work on 8580 was never touched. Nothing in the integration worktree was edited and
its runner was not restarted.

The Anthropic key for the Claude harness was loaded from `~/.agenta-qa-secrets.env` into the vault
of project `01a0671a-a1de-7672-8212-c5fe7203dd2b` and every later probe project, through
`POST /api/vault/v1/secrets/` with `secret.data.kind = "anthropic"`, at 13:49 on 2026-09-03. The
value was never printed, logged or written to a file.

## Part 1: what actually happens, per harness

| Harness | Cancel answered | Child alive after Stop | Parent chain of the child | How long it survives |
| --- | --- | --- | --- | --- |
| Codex | yes, 48 ms | YES | `sleep` <- `codex app-server` <- `node codex.js app-server` <- `node codex-acp` <- `sandbox-agent server` <- runner | until the park window closes, measured 56 to 61 s on a 60 s window |
| Pi (`pi_core`) | yes, 19 to 53 ms | no | `sleep` <- `pi` <- `node pi-acp` <- `sandbox-agent server` <- runner | gone inside 0.2 s |
| Claude Code | yes | no | `bash -c` and its `python3` <- `claude` native binary <- `node claude-agent-acp` <- `sandbox-agent server` <- runner | gone inside 0.2 s |

Three things this adds to Spike A.

**The survival time is exactly the park window, and the sandbox teardown is what ends it.** The
Codex child was alive at 56.3 s after the Stop and gone at 61.4 s, and the runner logged
`[keepalive] expire key=... (TTL 60000ms)` in that gap. So the leak is not self-limiting in any
other way. On the recommended 600 s stopped window it would be ten minutes; on Daytona it is 120 s
of billed compute per Stop.

**The child survives into the resumed turn.** Sending the continuation inside the park window gave
`hit-continue` with a 2.5 s turn 2, and the `sleep` was still running with the same pid throughout.
This is the product-visible case: the user Stops, types again immediately, and the abandoned
command keeps consuming the sandbox.

**Claude Code kills its child, which Spike A listed as untested and expected to match Codex.** It
matches Pi instead. Two of three harnesses clean up.

One measurement trap worth recording. Claude Code's Bash tool REFUSES a long standalone `sleep`
("the system is blocking standalone sleep commands longer than a few seconds"), and when asked
again it backgrounds the command and finishes the turn, which is not a cancel test at all. Use a
blocking `python3 -c 'import time; time.sleep(N)'` instead. Re-running Codex with the same python
command gave the identical leak, so the difference between the harnesses is real and not an
artefact of which command was used.

## Part 2: where each harness runs its shell tool, and why they differ

All three adapters are installed by the Rust `sandbox-agent` daemon, not by this repository. Pi and
Claude resolve from the runner's own `node_modules` (so a pnpm patch reaches them); Codex resolves
from the daemon's private directory under `$HOME`.

**Pi kills its child because the whole chain is one Node process.**

- `services/runner/node_modules/pi-acp/dist/index.js:2310` — `cancel()` calls `session.cancel()`.
- `pi-acp/dist/index.js:804` — that calls `this.proc.abort()`, an RPC to the `pi` process.
- `@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js:328` — `case "abort"` calls
  `session.abort()`.
- `@earendil-works/pi-agent-core/dist/agent.js:198` — `this.activeRun?.abortController.abort()`.
- `@earendil-works/pi-agent-core/dist/agent-loop.js:453` — the same signal is handed to every tool.
- `@earendil-works/pi-coding-agent/dist/core/tools/bash.js:55` — the shell is spawned
  `detached: process.platform !== "win32"`, so it gets its own process group.
- `bash.js:68` — `const onAbort = () => { if (child.pid) killProcessTree(child.pid); }`.
- `@earendil-works/pi-coding-agent/dist/utils/shell.js:189` — `process.kill(-pid, "SIGKILL")`.

**Claude Code has no kill in its bridge, and its child dies anyway.**

- `@agentclientprotocol/claude-agent-acp/dist/acp-agent.js:1468` is `cancel()`; its only outbound
  action, at `:1522`, is `await session.query.interrupt()`.
- `@anthropic-ai/claude-agent-sdk/sdk.mjs:62` — `interrupt()` writes a `{subtype:"interrupt"}`
  control request to the native CLI's stdin. The Bash tool lives inside that native binary.
- The kill therefore happens inside the `claude` binary, which we do not read. Measured, it kills
  both the `bash -c` wrapper and its child within 0.2 s. Empirically Claude behaves like Pi.

**Codex sends a cooperative interrupt and nothing kills the exec.**

- `.../agent_processes/codex/node_modules/@agentclientprotocol/codex-acp/dist/index.js:30089` —
  `cancel()` calls `interruptSessionTurn(sessionState, "Cancel", false)`.
- `codex-acp/dist/index.js:29797` — that resolves a real turn id and calls
  `codexAcpClient.turnInterrupt({ threadId, turnId })`, logging success or failure. Nothing else.
- `codex-acp/dist/index.js:30512` — the wire form is a JSON-RPC request `turn/interrupt`.
- `codex-acp/dist/index.js:22072` — the app-server is spawned
  `spawn(codexPath, ["app-server"], { env: spawnEnv })`, with no `detached` and no process group.
- The only two `.kill()` sites in the whole bundle are the login command's `finally`
  (`:31036`) and a process-wide shutdown on stdin close (`:31141`). Neither is reachable from
  `cancel()`.

So the bridge does its part. The daemon confirms the notification arrives: the Rust daemon logs
`acp_proxy: POST received ... method=session/cancel ... server_id=sdk-codex-...` for every run. The
shell child is spawned by the Rust core (`codex_core::exec`, `codex_core::tools::runtimes::shell`),
which holds the only pid, and it does not kill it on `turn/interrupt`. The app-server protocol has
a `process/kill` method, but it takes a `processHandle` from `process/spawn`, which is a
client-driven process API and not the model's exec tool. There is no protocol affordance to kill a
running exec other than the interrupt that already fails to do it.

**Which surface owns what.**

| Bundle | Where it lives | How a change ships |
| --- | --- | --- |
| `pi-acp`, `@earendil-works/pi-*` | the runner's `node_modules` | pnpm patch, runner image only |
| `@agentclientprotocol/claude-agent-acp` | the runner's `node_modules` | pnpm patch, runner image only |
| `@agentclientprotocol/codex-acp` | the daemon's `$HOME/.local/share/sandbox-agent/bin/agent_processes/codex/` | NOT a pnpm patch. `scripts/patch-codex-acp-approvals.ts` at `docker/Dockerfile.gh:139` for the runner image, AND a base64-embedded duplicate in `services/runner/images/sandbox/daytona/build_snapshot.py:224` for the Daytona snapshot |
| the `codex` Rust core | vendored inside the codex adapter, pinned to `1.1.7` at `docker/Dockerfile.gh:130` | not ours; only a version bump |

The duplication is the reason a codex-acp patch is expensive. `codex-acp-patch.json:2` says it
plainly: both surfaces must patch identically or a Daytona run silently diverges from a local one.

## The change

**A reap from the runner, not a patch to the bridge.** After a settled Codex cancel, the runner runs
`ps` inside the sandbox through the daemon's one-off process API, selects the leaked pids in
TypeScript, and runs `kill -9` on them. The sandbox client already exposes `runProcess`, and it
reaches the sandbox identically on the local and the Daytona provider.

| File | Change |
| --- | --- |
| `services/runner/src/engines/sandbox_agent/reap-exec.ts` | New. Parses the process table, finds the app-server, selects the leaked pids, kills them. |
| `services/runner/src/engines/sandbox_agent/run-turn.ts` | Records when the prompt was issued; calls the reap after a settled cancel when `plan.acpAgent === "codex"`. |
| `services/runner/tests/unit/reap-exec.test.ts` | New. 18 tests. |

**Why here and not in codex-acp.** A bridge patch would have to do the same `/proc` walk, because
the bridge holds no pid either. It would then need the Daytona snapshot rebuilt and the anchor
duplicated in `build_snapshot.py`, and it would be a third patch to a vendored bundle. The runner
already has a first-class API into the sandbox, so the same walk in our own code is smaller, typed
and unit-testable, and it ships in one image.

**Answer to the snapshot question: no rebuild is needed.** The change is runner source only. It uses
`ProcessRunRequest`, an API the daemon in the current snapshot (`rivetdev/sandbox-agent:0.5.0-rc.2-full`)
already serves.

**Two rules keep the reap off a warm session.** Only descendants of the `codex app-server` process
are candidates, so the daemon, the bridge, the launcher and the app-server itself are never touched.
And only descendants YOUNGER than the stopped turn are candidates, so an stdio MCP server, which
starts when the session is created, is never selected. The age is rounded DOWN, so every rounding
error makes the reap kill less. That refinement came from a real observation: on a cold first turn
Codex clones its plugin repository with `git fetch` about one second before the prompt, and a
ceiling round put that process one second inside the turn's window.

**A failed reap does not destroy the sandbox.** Every failure path logs a reason and returns; the
park decision is untouched. Trading a warm session for a tidier process table is the wrong trade.
The outcomes are `no-run-process`, `ps-failed`, `no-app-server`, `nothing-to-reap`, `too-many` and
`kill-failed`, each one log line the release gate can assert on.

## Part 3: live verification of the fix

Stack `agenta-ee-dev-session-cleanup` on `http://144.76.237.122:8980`, built from
`~/code/agenta-2-worktrees/spike-a-cancel`, EE, dev image, local sandbox provider, deployed with
`--no-tunnel` and no `--build`, torn down with `--down` afterwards.

One note on the Stop route. The brief asked for the public cancel route with the turn id, and the
integration measurements in Part 1 used exactly that: `POST /api/sessions/{session_id}/cancel` with
`expected_execution_id`, answering 202 with `execution.state: "stopping"`. The spike branch predates
that route, so the verification runs fall back to `POST /api/sessions/streams/`. Both end in the same
runner abort, and the runner-side evidence is the same.

Runner log for the final run, commit `5cdd23ab72`:

```
[sandbox-agent] stage=harness_cancel sent=true settled=true elapsed_ms=93
[sandbox-agent] stage=harness_reap killed=2 pids=1919,1941 app_server=1765 turn_elapsed_s=27
[sandbox-agent] prompt stopReason=cancelled
[keepalive] park-cancelled key=...:b9e83159-789a-44d2-abb6-a6cd3190900b ttl=60000ms
[keepalive] hit-continue key=...:b9e83159-789a-44d2-abb6-a6cd3190900b
[reconcile] shadow key=... harness=codex decision=reuse(hit-continue) plan=reuse(no-op) agree facets=[none]
[sandbox-agent] prompt stopReason=end_turn
```

There is no `stage=sandbox_start` between the two turns, so turn 2 reused the same sandbox and the
same native session. Turn 2 ran a NEW shell command and returned its output verbatim, which is the
check that matters: the reap kills two processes, the `sleep` and a `codex-code-mode-host` helper
the app-server spawns for the exec, and the harness respawns that helper on the next tool call. The
Pi run on the same stack logged no `harness_reap` line at all, parked, and resumed warm.

## Findings

1. **The Codex leak lives for exactly as long as the park.** It ends when the sandbox is destroyed,
   never before. Lengthening the stopped window lengthens the leak one for one.
2. **Claude Code cleans up.** Spike A's "expected to match, from code" was wrong in the safe
   direction. Only Codex leaks.
3. **The leak is not `sleep`-specific.** A `python3` blocker leaks identically.
4. **The bridge cannot fix this.** The Codex shell has no JavaScript-visible pid on any surface we
   patch, so a codex-acp patch would have to do the same process-table walk while costing a Daytona
   snapshot rebuild and a second copy of the edit in `build_snapshot.py`.
5. **The reap kills a helper as well as the command.** `codex-code-mode-host` is spawned for the
   exec and is correctly in scope; the harness respawns it, verified by a shell command on the warm
   turn after the Stop.
6. **The age rule is tight on a cold turn.** Codex's plugin `git fetch` starts about one second
   before the prompt. Flooring the turn age keeps it out today, but the margin is one second, not a
   comfortable one. See the open questions.

## Open questions for Mahmoud

1. **Ship the runner-side reap, or wait for a Codex version that kills its own exec?** The pin is
   `1.1.7`; `@agentclientprotocol/codex-acp` is now at `1.8.0`. Recommendation: ship the reap. A
   version bump is a small diff with a large blast radius (it moves the Rust core, the approval
   patch anchor and the model behavior at once), it is unverified against this bug, and the reap
   stays correct even after a bump because it would then find nothing to kill.
2. **Is the one-second margin on a cold turn good enough, or should the reap anchor on the first
   tool call instead of the prompt?** Recommendation: anchor on the first tool call of the turn, as
   a follow-up rather than now. The leaked process is by definition a tool call and cannot predate
   the turn's first one, so it is strictly tighter, and it removes the only case where a
   session-owned helper is close to the boundary. It needs a timestamp threaded out of the tool
   relay, which is more plumbing than this spike should add.
3. **Does the Daytona snapshot's image have a `ps` that understands `-eo`?** Not verifiable from
   here; every run used the local provider. Recommendation: assert it once in the release gate. The
   failure mode is safe (`skipped=ps-failed`, the sandbox still parks), but a silent skip on Daytona
   would mean the leak is billed compute nobody notices.
4. **Should the release gate's leftover-process check now be a hard FAIL on every harness?** Spike A
   added it as a check that fails on Codex on purpose. Recommendation: yes, make it a hard fail on
   all three, per provider. It is the only assertion that catches this class, and all three harnesses
   pass it locally today.
5. **Should the same reap run on a teardown that is NOT a Stop?** Today only a settled Codex cancel
   reaps; a failed turn still destroys the sandbox, which kills everything anyway. Recommendation:
   leave it. Adding a reap where the destroy already does the job is machinery without a case.
