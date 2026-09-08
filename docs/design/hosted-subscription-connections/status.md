# Status

## Current state

Updated 2026-09-08 16:30 UTC. The exploratory implementation is on the branch
`spike/hosted-subscription-exploration` (head pushed to origin) and runs on the stack below. All
four tracks are committed. Every scenario in the evidence table below ran against the real
provider unless marked simulated or not established. Remaining work is cleanup for a production
PR, a two-replica test, and the Codex review items listed at the end of the table.

## Workspace

- PR: [#6622](https://github.com/Agenta-AI/agenta/pull/6622).
- Starting commit: `a8abc8f73e3189e4c9ba76b89278cf80813d01e8`.
- Integration worktree: `/home/mahmoud/code/agenta-2-worktrees/hosted-subscriptions`.
- Local branch: `spike/hosted-subscription-exploration`.
- PR branch: `agent/hosted-subscription-connections-plan-20260907` (Codex's plan PR).
- Implementation branch on origin: `spike/hosted-subscription-exploration` at `e2773a30c0` (2026-09-08).
- Workflow: ordinary Git in the explicitly requested worktree. Do not initialize GitButler here.

## Landed on the branch (2026-09-08)

| Commit | Track | What |
| --- | --- | --- |
| `d471df22e8` | docs | research, contract, refresh probes, log |
| `0ebff58cec` | SDK | self_managed with a slug, subscription block on the wire, `subscription_login_required` on the 422 envelope and the stream |
| `e26c03fdd1` | API | `subscription_provider` secret kind, login attempts through the runner, push and failure routes with generation then expiry |

In the working tree, not yet committed: the runner track (device-login attempts, per-connection
home, materialize, push-back, error codes, Daytona in-VM home) and the web track (ChatGPT card,
attempt poll, picker row, chat error buttons). Both are being verified and finished.

Codex harness: out for now. Codex 0.145.0 refuses a login file without `id_token`, and Pi never
stores one. Pi is the harness for this slice.

## How to run it

- Deploy: `bash ./hosting/docker-compose/run.sh --license ee --dev --env-file .env.ee.dev.hostedsub --no-tunnel` from this worktree (the env file and the gitignored image-tag override are local to the box). The runner image must be rebuilt once for the two new packages: `--rebuild runner`.
- Product path: Settings, AI providers, Connect ChatGPT, approve the device code, then pick the "ChatGPT · Subscription" row in an agent's model picker.
- Cells: `docs/design/hosted-subscription-connections/research/experiments/hosted_subscription_cells.py` (needs `AGENTA_BASE`, `AGENTA_PROJECT_ID`, `AGENTA_API_KEY`): `connect --wait`, `chat`, `parallel --count 3`, `refresh --runner <container>`, `dead --runner <container>`. The `refresh` cell also needs the stored login expired in the database (a pgcrypto update on the `secrets` row, see the log entry fable-006), because Pi refreshes only on expiry and a token lives 10 days.
- Unit tests: `cd api && uv run --no-sync pytest oss/tests/pytest/unit/secrets oss/tests/pytest/unit/vault`; `cd sdks/python && uv run --no-sync pytest oss/tests/pytest/unit/agents`; runner `pnpm exec vitest run --project unit tests/unit/subscription-*` inside the runner container; web per-package `vitest run` in agenta-entities, agenta-entity-ui, agenta-chat, oss.

## Known limits and follow-ups

- A pending device-login attempt lives in the runner process. A runner restart or a second runner replica behind one URL drops it; the API reports `failed` with "attempt not found; try again".
- The vault read is cached for a short time, so a refreshed login pushed by one runner reaches another runner's next turn after the cache expires. The measured overlap of roughly an hour absorbed that delay in today's tests; it is an observation, not a guarantee.
- Codex harness is out: Codex 0.145.0 refuses a login file without `id_token`, which Pi never stores.
- `fs.watch` fails with EMFILE on a host whose root user has exhausted inotify instances; the publisher polls every 5 s instead. A production host with the same limit behaves the same.
- The onboarding draft agent selects the deployment-login row by default when a runner mounts an operator login. On a cloud runner with no mount this does not arise. Consider preferring a ready hosted connection.
- Not measured: a real cross-runner loser (two runner replicas), and the Daytona 30 s poll window with a real loser. Both paths have unit tests only.
- The picker cannot select a `needs_login` connection, so the chat error card path was proven on the API only.

## Ownership and next work

| Owner | Work | State |
| --- | --- | --- |
| Mahmoud | Edit and send the Fable prompt; relay the delivered version. | Pending. |
| Fable | Parallel research, experiments, and product implementation. | Done for this handoff: all tracks on `spike/hosted-subscription-exploration`, live cells recorded above. Open: Codex review of the branch, the follow-ups listed above. |
| Codex | Prepare handoff, then review evidence and contribute after the user relays the handoff. | Handoff prepared. |

## Evidence so far (2026-09-08)

| Scenario | Result | Evidence |
| --- | --- | --- |
| Baseline: existing mounted-login path, Pi `openai-codex` (gate cell S1, chat) | passed, real provider | `~/agenta-qa-evidence/2026-09-08-hosted-subscriptions/gate-S1-chat.log` |
| Baseline: existing mounted-login path, Codex `runtime_provided` (gate cell S2, chat) | passed, real provider | `~/agenta-qa-evidence/2026-09-08-hosted-subscriptions/gate-S2-chat.log` |

| UI sign-in: Connect ChatGPT on the AI providers page, device code approved by Mahmoud in his ChatGPT account, card shows Connected | passed, real provider, 2026-09-08 12:13 UTC | runner log: attempt `a86ee295` succeeded and delivered; `web/10-ai-providers-resiros-connected.png` |
| Model list: the hosted connection appears as a "ChatGPT · Subscription" row with its 7 models | passed | `web/13-model-picker-dropdown.png`, `web/15-model-selected.png` |
| Chat turn through the hosted connection from the playground (Pi, gpt-5.3-codex-spark) | passed, real provider | `web/16-chat-turn-hosted.png`; runner log `connection=self_managed:chatgpt credentialMode=runtime_provided` |
| Second login in the test project (device code through the API routes) | passed, real provider; login_state ready, version 1, generation 1 | `connect-wait-2.log` |
| Three parallel sessions, two turns each, local sandbox, hosted connection | passed 3/3, real provider | `cell-parallel.log` |
| One session on a Daytona sandbox, hosted connection, login delivered to in-VM disk | passed, real provider | `cell-chat-daytona.log`; runner log `materialized=true scope=daytona` |
| Forced refresh by expiring only the runner's local copy | not established: the materialize rule restored the newer API copy (`reason=later-expiry`), so Pi never refreshed. Correct behavior; the test needs the stored login expired too. | `cell-refresh.log` |
| Publish of a refreshed login: the runner's local copy was rotated through the real provider (a newer lineage), then one turn pushed it to the API | passed, real provider; stored login_version 1 to 2, runner log `push ok version=2` | `cell-publish-after-external-rotation.log` |
| Stale-session simulation with garbage tokens and a later expiry in the local copy | FAILED and found a defect: the runner published the garbage file to the API before any check, the stored login became unusable (version 3, `needs_login`). Fix in progress on both sides: validate the JWT and account claim before a push, and refuse it on the API. The simulation itself was unrealistic; a real stale session holds a real older lineage, which the materialize rule replaces from the store before the turn (`reason=later-expiry`, observed). | `cell-stale.log`; runner log `push ok version=3` then `failure report ok stale=false` |
| Re-login after a dead stored login: device code through the API routes, login_generation 1 to 2 | passed, real provider; version 4, generation 2 | `connect-wait-3.log` |
| A session created on generation 1 continues after the re-login | passed: the session started cold (`keepalive miss; cold`) and answered | `cell-continuity-after-relogin.log` |
| Real Pi refresh, first attempt | not established: the turn received a cached copy of the secret with the original expiry (the vault read is cached for a short time), so Pi saw a valid token and did not refresh. The earlier "half passed" reading of this row was wrong: the local file was the delivered login, not a refresh. | `cell-refresh-2.log` |
| Real Pi refresh, second attempt: stored login expired in the database, cache cleared, local copy expired, one turn | passed, real provider: Pi refreshed under its lock (new refresh fingerprint, expiry 10 days out), the publisher pushed within the turn (`push ok version=5`), the stored login moved from version 4 to 5. The materialize-time push correctly skipped the expired local copy (`check=expires_past`). | `cell-refresh-3.log` |
| Dead login: local copy with garbage tokens, current meta version | passed: the push was refused before it left the runner (`check=access_not_jwt`), the refresh check answered terminal (401), the failure report was not stale, the connection became `needs_login`, and the client got `subscription_login_required`. | `cell-dead.log` |
| Re-login from the product UI: "Sign in again" on the AI providers card of a `needs_login` connection, device code approved, card flipped to Connected by its own poll | passed, real provider; generation 2 to 3, version 6 | `web/20-ai-providers-needs-login.png`, `web/21-picker-needs-login-row.png`, `web/23-card-pending-code-blanked.png`, `web/24-card-connected-after-relogin.png` |
| An older session continues after the UI re-login | passed: cold start, `materialized=true reason=newer-generation`, answered | `cell-continuity-after-relogin-2.log` |
| Chat error card with a Sign in again button, live in the browser | not established in the browser: the picker refuses a `needs_login` row, so no agent could be sent through a dead connection from the UI in this session. The code `subscription_login_required` reached the client on the API path (`cell-dead.log`), and the button rendering is covered by unit tests. | `cell-dead.log` |
| Login attempt survives a runner restart | failed by design: attempts live in the runner process; a hot reload dropped a pending attempt, the API reported `attempt not found; try again` | runner log 11:53 UTC |

Known UI gap: the picker shows two identical "ChatGPT · Subscription" rows on a dev runner that
also mounts an operator login folder. The hosted row needs a distinct label.

Stack: `agenta-ee-dev-hostedsub` on `http://144.76.237.122:8780`, built from this worktree with
the gitignored override `hosting/docker-compose/ee/docker-compose.dev.hostedsub.local.yml`. The
runner mounts copies of the operator logins from `~/agenta-hostedsub/` (never the host files).
Both access tokens were valid at the time, so neither baseline exercised a refresh.

Use [the communication log](communication-log.md) for updates and [working research](working-research.md)
for experiments and findings. Record actual commands and evidence here as implementation proceeds.
