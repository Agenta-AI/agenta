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
- PR branch: `agent/hosted-subscription-connections-plan-20260907`.
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

Stack: `agenta-ee-dev-hostedsub` on `http://144.76.237.122:8780`, built from this worktree with
the gitignored override `hosting/docker-compose/ee/docker-compose.dev.hostedsub.local.yml`. The
runner mounts copies of the operator logins from `~/agenta-hostedsub/` (never the host files).
Both access tokens were valid at the time, so neither baseline exercised a refresh.

Use [the communication log](communication-log.md) for updates and [working research](working-research.md)
for experiments and findings. Record actual commands and evidence here as implementation proceeds.
