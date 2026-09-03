# Integration refresh, 2026-09-03

> AGENT-GENERATED, LOW WEIGHT. The five slice branches that moved on 2026-09-03 were merged
> again into `agent/session-execution-integration`, and the gate cells were re-run on one stack
> (`agenta-ee-dev-session-integration`, port 8580, local provider, Pi unless stated). The first
> agent on this lane was lost to repeated API overloads; the lead finished it by hand.

## Merges, in order

| Merge commit | Branch and tip | Notes |
|---|---|---|
| `d719bbd3d1` | `spike/session-cancel-warm` `5cdd23ab72` | Codex child reap, age rounding |
| `05d7f95a3e` | `spike/session-cancel-continuity` `0a232b27f5` (later folded into Spike A as `5a10e6b100`) | continuity record for a stopped turn, owner release at shutdown |
| `e2db970563` | `feat/session-execution-watchdog` `3f25f06d64` | late-record quarantine, migration |
| `2fb4cf82a7` | `feat/session-durable-cancel` `38cbc92201` | mirror write, named Stop on approval, outcome race, settled-run no-op |
| `78714ff6c0`, `cabad606ae` | reconciliation | quarantine counter moved to where records are typed; one test reformatted to the CI ruff |

Two conflicts were real: in `services/runner/src/server.ts` the watchdog resolves the interruption signal and the durable cancel aborts with the user-stop label, and both are kept; in `web/oss/src/components/AgentChatSlice/hooks/useAgentChatSession.ts` three Stop implementations met and the new route wins with the Stop guard's refusal handling folded in.

## Defects the combined run found, fixed on this branch

| Commit | Defect | Fix | Belongs on |
|---|---|---|---|
| `a161a29df6` | After a durable Stop cleared `is_running` on the row, a runner that died before writing its terminal record left the turn with no ending forever: the sweep only settled rows that still claimed to run, and the idle branch collapsed the row after 30 minutes without an ending. Observed: Stop settled at 13:09:19, runner killed, turn `295351c3` still carried only the user message five minutes on. | A second selection in `orphan_sweep.py` asks the records plane whether a stale not-running row's turn has a terminal record and writes one if not, without collapsing the row. | PR #6501 |
| `e6a033063a` | The ending landed (96.7 s) but the dead turn still held the session's Redis `alive` lock for an hour, so the next message was refused with "another turn owns this session". | The ending-only path releases `alive` only if it still names the dead turn, and tombstones the turn. | PR #6501 |
| `e6a033063a` | The sweep loop went silent between 13:49 and the next reload at 14:07 with nothing logged, while a stale running row waited; the cause was not found (a quiet pass logs nothing, so only a stale row proves the hang). | Every pass is bounded by a timeout that logs and moves on; a slow pass logs its duration. | PR #6501 |

A cherry-pick of `a161a29df6` onto `feat/session-execution-watchdog` conflicts in `orphan_sweep.py` because the integration sweep also carries the command-claim settlement from PR #6503; the port happens when PR #6503 lands below it.

## Cells on head `e6a033063a` (or `a161a29df6` where noted)

| Cell | Result | Timing and evidence |
|---|---|---|
| stop-warm | pass | Stop 202 in 0.10 s, `stopReason: cancelled`, resume 5.9 s, marker recalled. `lead-local-cells.json`, `stop-warm-2.json` |
| double-send | pass | second send refused at once with "This session is already running a turn", turn one finished in 54.6 s, third message recalled the marker in 2.6 s. `lead-local-cells.json` |
| stale-stop | pass | 409 naming the current turn; bare Stop 202; turn three ran and recalled. `lead-local-cells.json` |
| stop-approval, named turn | pass | `expected_execution_id` from `message.metadata.turnId`, 202, gate `pending` to `cancelled`, late answer 409, resume 2.5 s. `lead-local-cells.json` |
| stop-after-finish | pass | Stop fired 1 ms after `prompt stopReason=`, command `obsolete`/`not_running`, parked, resume recalled in 2.4 s. `stop-after-finish.json` |
| runner-gone while a Stop is claimed | pass on `e6a033063a` | `execution_lost` ending 137.5 s after the restart, the next message ran. Failed on `a161a29df6` (ending at 96.7 s, next message refused). `lead2-runner-gone.json`, `lead-local-cells.json` |
| sandbox-gone | pass | turn ended with `sandbox_gone` after 101.5 s, terminal records present. `lead-local-cells.json` |
| stale-tail | pass on `e6a033063a` | runner paused 107 s before `execution_lost`; after the thaw the late `done` was quarantined at 14:14:12, two terminal records, one ending rendered. Failed on `a161a29df6` (no ending during the pause). `lead2-stale-tail.json`, `lead2-row-poll.txt` |
| restart-after-stop | pass | refused 0 s, admitted 12.8 s after the restart, `hydrated`, marker recalled. `restart-after-stop.json` |
| post-stop-row | pass | row `is_running: false` 0.17 s after the Stop, `is_alive: true`. `post-stop-row.json` |
| codex-child (Codex) | pass | child gone 0.3 s after the Stop, `park-cancelled`. `codex-child-2.json` |
| records-outage | pass | Postgres down 21 s during a turn, 5 records landed, Redis drained. `lead-local-cells.json` |
| stop-warm on Daytona | pass | `stopReason: cancelled`, resume recalled in 4.5 s. `lead-daytona-stop-warm.json` |

Evidence: `~/agenta-qa-evidence/2026-09-03-session-round2/integration-refresh/`.

## Tests on head `e6a033063a`

- API session unit tests inside the api container against live Postgres: 627 pass plus the 16 Redis-contract tests once the runner fixture is copied in (24 in that file); the two watchdog files: 18 pass.
- `uvx ruff@0.15.12 format` and `check`: clean.
- Runner and web suites were run by the lanes on the slice tips; the merged runner suite was not re-run after the last two commits, which touch only the API.
