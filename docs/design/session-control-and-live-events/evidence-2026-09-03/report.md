# Complete report, session-control round two, 2026-09-03

> AGENT-GENERATED, LOW WEIGHT. Every conclusion below was produced by unattended agents and
> checked by the lead agent against the lane reports and the logs. Mahmoud decides. Nothing was
> merged. Every code change sits on the branch of the pull request that owns that code.

## Answer in one paragraph

Warm Stop works on Daytona and on the local provider, with Pi and with Claude Code, on every path
the brief named: during model output, during a long tool, and while an approval waits. The next
message continues in the same sandbox and the same native harness session every time. The round
found and fixed seven defects that the overnight run could not see: a Stop that names its turn was
refused during an approval, an outcome report could lose a race and leave the command unsettled,
a Stop just after the turn ended evicted the warm sandbox, the session row kept `is_running: true`
after a Stop, a stopped turn never wrote its continuity record so a runner restart lost the native
session, the runner never released its Redis owner claim at shutdown so a restarted runner was
refused for two minutes, and a stopped Codex turn left its shell command running in the parked
sandbox. Late runner output after a watchdog ending is now quarantined at records ingest. One
scenario is designed to stay imperfect: a runner killed with SIGKILL still waits for the 120 s
owner lease.

## Scenario results

| Scenario | Provider | Harness | Commit | Result | Timing | Report |
|---|---|---|---|---|---|---|
| Stop during model output, continue | Daytona | Pi | `9110c08000` | pass, same sandbox and native session, build id recalled | Stop answered 70 to 104 ms, harness cancel 19 to 151 ms, stream ended 0.3 to 1.7 s after the request | `daytona-pi-claude.md` |
| Stop during a long tool, continue | Daytona | Pi | `9110c08000` | pass | same ranges | same |
| Stop while waiting for approval, continue | Daytona | Pi | `9110c08000` | pass, gate cancelled, late answer refused | same ranges | same |
| The same three | Daytona | Claude Code | `9110c08000` | pass; one sandbox of three hit the known Daytona Secret placeholder and the runner's rebuild-once guard passed on retry | same ranges | same |
| The same three | local | Pi | `9110c08000` | pass | Stop 79 to 248 ms, harness cancel 16 to 50 ms | same |
| The same three | local | Claude Code | `9110c08000` | pass, same sandbox and native session | cancel settled 165 ms, 155 ms, 111 ms | `local-claude-and-restart.md` |
| Stop, restart the runner, continue | local | Pi | `9110c08000` | sandbox and harness identity lost, conversation survived only through the client transcript, continuation refused 90 to 150 s | admitted at 123.6 s | same |
| Stop, restart the runner, continue | local | Pi | `5a10e6b100` (PR #6496) | native session hydrated (`mode=load`), codeword recalled with an empty client transcript, continuation admitted on the first attempt; the sandbox id is new on the local provider by design | admitted 19.6 s after SIGTERM restart; SIGKILL still waits for the lease (67.5 s) | `cancel-continuity.md` |
| Restart the runner mid-turn, no Stop | local | Pi | `9110c08000` | watchdog wrote exactly one `execution_lost` and `done` pair | 108 s | `local-claude-and-restart.md` |
| Stop during `sleep 300`, inspect the parked sandbox | local | Codex | `9110c08000` | shell child alive for the whole 60 s park window and into the warm continuation | | `child-process-cleanup.md` |
| same | local | Pi and Claude Code | `9110c08000` | child killed within 0.2 s | | same |
| same, with the reap | local | Codex | `9e21fba4ee` (PR #6496) | child killed at the Stop, sandbox parked, next message warm, new shell command ran | | same |
| Runner paused past 90 s, watchdog settles, runner thaws | local | Pi | `3f8f096714` (PR #6501) | the old run appended a tool call, its result, a `usage`, and a second `done` 3 to 4 s after the ending | | `watchdog-stale-tail.md` |
| same, with the ingest guard | local | Pi | `3f25f06d64` (PR #6501) | late records marked `quarantined_at` within 0.4 s, endpoint returns 4 rows instead of 7, one ending rendered; an ordinary Stop untouched | | same |
| After a Stop, sample the session row for 3 min | local | Pi | `58bec4d382` (PR #6503) | row kept `is_running: true` for 193 s; the collection query every liveness poll drives is served from Postgres alone | | `post-stop-mirror.md` |
| same, with the mirror at settlement | local | Pi | `76e4b1368b` (PR #6503) | `is_running: false` at Stop plus 0.15 s, `is_alive: true`; warm resume 2.01 s inside the park window against 14.16 s cold after it | | same |
| Stop naming its turn while the turn waits on an approval | local and Daytona | Pi and Claude Code | `9110c08000` | 409 four of four; the same Stop without an id cancelled the gate | | `daytona-pi-claude.md` |
| same, fixed | local | Pi | `89d7c7c90d` (PR #6503) | 202, gate `pending` to `cancelled`; a stale id still 409 | | `post-stop-mirror.md` |
| Stop during output, outcome report | local and Daytona | Pi | `9110c08000` | 409 on four of nine turns; the command sat `claimed` until the watchdog settled it `lost` | one case exactly 120 s | `daytona-pi-claude.md` |
| same, fixed | local | Pi | `89d7c7c90d` | the runner's report accepted whether the row is `pending` or `claimed`; the duplicate refused | | `post-stop-mirror.md` |
| Stop fired the instant the prompt settles | local | Pi | `89d7c7c90d` | live registry entry aborted during teardown, park refused (`no-park:end_turn`), cold rebuild 7.21 s | | same |
| same, fixed | local | Pi | `38cbc92201` (PR #6503) | run marked settled at prompt settle, applier no-op, command `obsolete`/`not_running`, parked, warm 1.91 s | | same |
| Every reader of Redis `running` and `alive` | code reading | | `9110c08000` | the candidate rule (clear `running`, keep `alive`) is what the code does and every input path admits a new Send under it; the defect was the row mirror, now fixed | | `post-stop-liveness.md` |
| All branches re-merged and thirteen cells re-run | local and Daytona | Pi, Codex | `7f2ef31307` (PR #6506) | 13 of 13 pass; the combined run found two more sweep defects, fixed on that branch (`a161a29df6`, `e6a033063a`): a stopped row whose runner died got no ending, and the ending left the dead turn's `alive` lock in place | runner-gone settled 137.5 s, stale tail quarantined after a 107 s pause | `integration-refresh.md` |

## How credentials were obtained

- Daytona: the key in every session env file (copied from `.env.ee.dev.local` in the `agenta-2`
  tree) lists and creates sandboxes but returns 403 on `GET /api/secret`, and the runner refuses
  to start a Daytona sandbox without a Secrets-capable key. The key in
  `/home/mahmoud/code/agenta/hosting/docker-compose/ee/.env.ee.dev.local` returns 200 there. The
  lead copied that value into the integration stack's env file and recreated only its runner
  container at 14:18. The runner log before the recreate is saved in the evidence folder.
- OpenAI, for Pi and Codex: `OPENAI_API_KEY` from `~/.agenta-qa-openai.env`, loaded into each
  test project's vault through `POST /api/vault/v1/secrets/`.
- Anthropic, for Claude Code: `ANTHROPIC_API_KEY` from `~/.agenta-qa-secrets.env`, loaded the
  same way. The Claude Max subscription login in `~/.claude/.credentials.json` was not needed.
- Provider selection is per request: `sandbox: {"kind": "daytona"}` or `{"kind": "local"}`
  inside `data.parameters.agent` on the invoke, beside the harness kind.
- No credential value appears in any report or evidence file; gitleaks over the evidence folders
  reports only interaction tokens inside runner logs.

## Branch heads and pull requests

| Branch | Head | PR | What changed today |
|---|---|---|---|
| `spike/session-cancel-warm` | `5a10e6b100` | #6496 | Codex child reap on Stop; age rounding; continuity record for a stopped turn; owner-claim release at runner shutdown through `release_owner` on the heartbeat |
| `feat/session-execution-watchdog` | `3f25f06d64` | #6501 | `quarantined_at` on session records with a migration; ingest guard for late output after the watchdog's ending; the watchdog marks its own writer |
| `feat/session-durable-cancel` | `38cbc92201` | #6503 | mirror write at settlement; named Stop on a parked approval; outcome race; settled-run no-op inside teardown; `not_running` versus `lost` on the `running` key; liveness polls key on `is_running` |
| `agent/session-execution-integration` | `7f2ef31307` | #6506 | re-merge of the above, the thirteen-cell run, and two sweep fixes that belong on #6501 (an ending for a stopped row whose runner died; release of the dead turn's `alive` lock; a bounded sweep pass) |
| `agent/session-execution-overnight` | this branch | #6505 | this report and the lane reports |
| `feat/session-single-turn-admission`, `feat/session-stop-guard`, `fix/records-worker-ack-after-commit` | unchanged | #6500, #6504, #6502 | |

## Test commands

| Where | Command | Result |
|---|---|---|
| `spike/session-cancel-warm` at `5a10e6b100` | `cd services/runner && pnpm run build:extension && pnpm test` | 162 files, 2687 pass (run by the lead on the folded tip) |
| same | `pnpm vitest run tests/unit/reap-exec.test.ts` | 18 pass |
| same | `pnpm exec vitest run --project unit tests/unit/cancel-continuity.test.ts` | 6 pass |
| `feat/session-execution-watchdog` at `3f25f06d64` | `pytest oss/tests/pytest/unit/sessions/ -q` against live Postgres 5442 | 554 pass, 0 skipped |
| same | `test_late_record_quarantine.py`, `test_late_record_quarantine_dao.py` | 13 and 7 pass |
| `feat/session-durable-cancel` at `38cbc92201` | API session unit tests in the api container against live Postgres | 564 pass |
| same | `cd services/runner && pnpm test` | 2671 pass |
| same | `@agenta/entities`, `@agenta/navigation`, `@agenta/mobile` | 1468, 46, 144 pass |
| all Python | `uvx ruff@0.15.12 format` and `check` | clean |
| all web | `cd web && pnpm lint-fix` | clean |
| `agent/session-execution-integration` at `e6a033063a` | API session unit tests in the api container | 627 pass plus the 16 Redis-contract tests with the fixture copied in; the two watchdog files 18 pass |

## Findings that need a decision

1. **Quarantine or reject late output** (PR #6501). Built: quarantine, because a late `usage`
   carries token accounting and the tool result is what support asks for; a late `done` is
   quarantined too so one ending stays effective. Reject is one flag away.
2. **Ship the Codex reap or bump the Codex pin** (PR #6496). The reap works on both providers
   through the sandbox process API and needs no snapshot rebuild; the pin sits at 1.1.7 against a
   published 1.8.0 that may kill its own child.
3. **`not_running` versus `lost` past teardown** (PR #6503). The discriminator is now the `running`
   key, which mislabels a misrouted Stop in a multi-runner deployment as `not_running`; that
   deployment does not exist today.
4. **Runner stop grace period.** The shutdown handler's budgets (three times 5 s) exceed Docker's
   10 s default; a `stop_grace_period` on the runner service touches the shared compose file.
5. **The Claude Code builtin shell tool is not gated by the `ask` permission** while Pi's is and
   platform tools are. Reported, not fixed; it reads as a security gap.
6. **Post-Stop liveness rule for the RFC**: clear `running` at settlement, keep `alive` until
   normal idle expiry, and let settlement write the row mirror. This is what the code does now.

## Not done

- Codex on Daytona was not run (the Daytona matrix covered Pi and Claude Code; Codex was
  measured on the local provider only).
- The reap's `ps` call was not verified against the Daytona snapshot image.
- The two desktop Stop notices and the mobile surfaces changed on PR #6503 were unit-tested but
  not seen in a browser.
- The Claude subscription path was not exercised, because the API key path worked.
