# Status

## Current state

The working research document and editable Fable handoff are prepared. The intended result is an
integrated exploratory implementation, with alternative experiments running alongside product work.
There is no timebox. No new authentication implementation or live refresh validation has been
completed in this worktree.

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

## Ownership and next work

| Owner | Work | State |
| --- | --- | --- |
| Mahmoud | Edit and send the Fable prompt; relay the delivered version. | Pending. |
| Fable | Parallel research, experiments, and product implementation. | Research done. SDK and API landed. Runner and web being finished. Next: integrated live run (UI login needs Mahmoud), concurrency and refresh cells, re-login cell. |
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
| Login attempt survives a runner restart | failed by design: attempts live in the runner process; a hot reload dropped a pending attempt, the API reported `attempt not found; try again` | runner log 11:53 UTC |

Known UI gap: the picker shows two identical "ChatGPT · Subscription" rows on a dev runner that
also mounts an operator login folder. The hosted row needs a distinct label.

Stack: `agenta-ee-dev-hostedsub` on `http://144.76.237.122:8780`, built from this worktree with
the gitignored override `hosting/docker-compose/ee/docker-compose.dev.hostedsub.local.yml`. The
runner mounts copies of the operator logins from `~/agenta-hostedsub/` (never the host files).
Both access tokens were valid at the time, so neither baseline exercised a refresh.

Use [the communication log](communication-log.md) for updates and [working research](working-research.md)
for experiments and findings. Record actual commands and evidence here as implementation proceeds.
