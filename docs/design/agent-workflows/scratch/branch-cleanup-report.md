# Agent workflows branch and PR cleanup report

Date: 2026-06-22

This report compares the local GitButler workspace against the open agent-workflows PR set inspected on 2026-06-22. It has been updated after comparison with `docs/design/agent-workflows/branch-pr-cleanup-report.md`.

This is a read-only assessment: no branches, commits, or PRs were mutated while gathering the data.

## Executive summary

The agent-workflows work is split across several live stacks. Most applied GitButler lanes map cleanly to open PRs. The main operational risk is not the committed lanes; it is the large `zz [unassigned changes]` bucket, which contains newer work that is not safely saved into any branch or PR.

Main cleanup findings:

1. `#4774` is a stale duplicate of the runner-engine work and should be closed in favor of `#4778`. [closed]
2. `#4777` is a stale duplicate of the docs work and should be closed in favor of `#4779`. [closed]
3. `#4773` is not deprecated. It is the runner-tools base PR. Locally its commits are folded into the bottom of the applied `feat/agent-runner-engines` lane, so it does not appear as a separate GitButler lane.
4. `#4782` is not a normal GitButler lane because it is based on `integration/agenta-rivet-base`, a merge-based integration branch. Keep it only as an integration/demo branch unless it is rebuilt as a clean linear lane later. [closed]
5. `#4775` remains the one local/remote ambiguity. GitHub reports remote head `592282` with two commits, while current `but status` shows applied lane `feat/agent-playground-ui` at `7120276` only. Treat this as a real discrepancy until reconciled.
6. The unassigned working tree contains significant work saved nowhere else, including the `rivet -> sandbox_agent` rename, several new design-doc folders, test relocation cleanup, local husky hook changes, and broad SDK/service/runner/frontend deltas.

## Current stack map

| Stack | PR | Head branch | Base | Applied lane? | Status |
|---|---:|---|---|---|---|
| SDK | `#4771` | `feat/agent-sdk-runtime` | `main` | yes, `sd` | live |
| SDK | `#4772` | `feat/agent-service` | `feat/agent-sdk-runtime` | yes, `rv` | live |
| SDK/tools | `#4785` | `fix/composio-no-auth-toolkits` | `feat/agent-service` | yes, `fi` | live |
| Runner | `#4773` | `feat/agent-runner-tools` | `main` | folded into `nn` base | live base PR |
| Runner | `#4778` | `feat/agent-runner-engines` | `feat/agent-runner-tools` | yes, `nn` | live |
| Runner | `#4774` | `feat/agent-runner-engine` | `feat/agent-runner-tools` | no | superseded; close |
| Frontend | `#4775` | `feat/agent-playground-ui` | `main` | yes, `pl`, but local display differs from PR head | reconcile |
| Frontend | `#4780` | `fe-feat/agent-chat-ui-slice` | `feat/agent-playground-ui` | yes, `ha` | live |
| Hosting | `#4776` | `chore/agent-hosting-compose` | `main` | yes, `st` | live |
| Sandbox-agent | `#4786` | `chore/sandbox-agent-core` | `main` | yes, `cor` | live |
| Sandbox-agent | `#4787` | `chore/sandbox-agent-railway` | `chore/sandbox-agent-core` | yes, `ra` | live |
| Sandbox-agent | `#4788` | `chore/sandbox-agent-kubernetes` | `chore/sandbox-agent-core` | yes, `ku` | live |
| Sandbox-agent | `#4789` | `ci/sandbox-agent-image` | `chore/sandbox-agent-core` | yes, `ci` | live |
| Docs | `#4779` | `docs/agent-workflows` | `main` | yes, `do` | live |
| Docs | `#4777` | `docs/agent-workflows-design` | `main` | no | superseded; close |
| Rivet/Agenta harness | `#4782` | `feat/agenta-on-rivet` | `integration/agenta-rivet-base` | no | merge-based, off-workspace |

Related but outside the original list:

| PR | Branch | Status |
|---:|---|---|
| `#4784` | `chore/agent-runner-test-setup` | draft, stacked on `#4778` |
| `#4783` | `claude/git-butler-agent-prs-b227dz` | draft, agent-adjacent design doc |

## Question 1: PR branches not applied locally

### `#4774` / `feat/agent-runner-engine`

Deprecated. Close it.

This is the older singular-named runner-engine PR. The local applied lane and current live PR are `feat/agent-runner-engines` / `#4778`. `#4778` contains the runner-engine work plus later fixes, including the Python3 / Pi extension rebuild work.

### `#4777` / `docs/agent-workflows-design`

Deprecated. Close it.

This is the older docs PR. The applied docs lane and current live PR are `docs/agent-workflows` / `#4779`, which includes the original design docs plus the QA matrix, findings, and driver work.

### `#4773` / `feat/agent-runner-tools`

Keep it.

This is the runner-tools base PR, not an orphan. Locally the runner-tools commits sit at the bottom of the applied `nn` lane for `feat/agent-runner-engines`, which is why there is no separate applied GitButler lane for `feat/agent-runner-tools`. That is acceptable for the current stack as long as GitHub continues to show `#4778` based on `feat/agent-runner-tools`.

### `#4782` / `feat/agenta-on-rivet`

Keep only if it remains useful as an integration branch; otherwise rebuild or close later.

This PR is based on `integration/agenta-rivet-base`, which is a merge-based bundle of the in-flight agent-workflows stacks. GitButler series need linear history, so this branch is deliberately off-workspace. The practical risk is drift: as the underlying SDK/service/runner/hosting/docs branches change, this integration branch must be manually refreshed.

The branch also still uses the old `rivet` naming while the rest of the work is moving toward `sandbox-agent`. If it remains alive, it should eventually be rebuilt or renamed after the sandbox-agent rename lands.

### `#4775` / `feat/agent-playground-ui`

Reconcile before merging.

Current GitHub metadata reports:

| Field | Value |
|---|---|
| PR head | `592282099d8394d1e194e33550e6ec940d66d63f` |
| Commits | `7120276dd9` then `592282099d` |
| Base | `main` |

Current `but status` reports the applied `pl` lane as:

| Field | Value |
|---|---|
| Local displayed head | `7120276dd9` |
| Commit shown | `feat(frontend): agent config playground controls` |

That means the remote PR has a review-fix commit that is not shown in the applied GitButler lane display. This may be a GitButler display/stacking artifact, or the local lane may be behind the remote branch. Do not force-push or rewrite `#4775` until this is resolved explicitly.

## Question 2: Local work without an open PR

For committed/applied GitButler lanes, every lane in the agent-workflows scope has an open PR or is part of a known PR stack.

The work without an open PR is the uncommitted working tree. Because it is not committed to any lane, it has no PR by definition.

## Question 3: Local changes not saved elsewhere

Yes. This is the main risk.

The other cleanup report records 77 tracked files changed, 32 untracked files, and net `+1623/-2504` in the working tree. The current `but status` also shows both cleanup reports themselves as unassigned files.

Important working-tree-only clusters:

| Cluster | Evidence from current status / other report | Suggested owner |
|---|---|---|
| `rivet -> sandbox_agent` code rename | New/renamed `sdks/python/agenta/sdk/agents/adapters/sandbox_agent.py`, `services/agent/src/engines/sandbox_agent.ts`; old `rivet.py` / `rivet.ts` deleted or renamed | Fold into `#4786` / `chore/sandbox-agent-core`, or create a new `chore/sandbox-agent-rename` lane stacked on `#4786` |
| Test relocation cleanup | Old `services/agent/test/*.test.ts` files deleted after `#4786` introduced `services/agent/tests/unit/*` | Fold into `#4786` |
| New design-doc folders | `provider-model-auth/`, `skills-config/`, `model-config/`, `code-tool-sandbox/`, `harness-capabilities/`, `typescript-structure/`, QA plan files | Fold into `#4779`, or split into a follow-up docs lane if `#4779` should stay stable |
| Local husky/user hooks | `.husky/post-checkout-user`, `.husky/pre-commit-user`, tracked hook edits, `.gitignore` edits | Keep local/unassigned, discard, or move to a small chore branch only if intended for the repo |
| SDK/service/runner/frontend deltas | Broad edits across `sdks/python/agenta/sdk/agents/**`, `services/agent/**`, `services/oss/src/agent/**`, `web/oss/src/components/AgentChatSlice/state/sessions.ts` | Diff per file and absorb into owning lanes only after confirming intent |
| Cleanup reports | `docs/design/agent-workflows/branch-cleanup-report.md`, `docs/design/agent-workflows/branch-pr-cleanup-report.md` | Decide whether to keep one, both, or fold into docs lane |

Important GitButler caution: do not run plain `but commit` here. It would sweep all unassigned changes into one branch. Use file assignment first, for example `but rub <path> <branch>`, then commit with `--only`.

## Recommended cleanup plan

1. Take a GitButler safety snapshot before branch surgery:

```bash
but oplog snapshot -m "pre-cleanup 2026-06-22"
```

2. Close stale duplicate PRs:

`#4774` is superseded by `#4778`.

`#4777` is superseded by `#4779`.

3. Do not close `#4773`.

Treat `#4773` as the live runner-tools base PR. Its absence as a separate applied GitButler lane is expected because its commits are folded into the `nn` lane locally.

4. Resolve `#4775` before any push/rewrite.

The remote PR head is `592282`, but current `but status` displays local `pl` at `7120276`. Determine whether this is only GitButler display behavior or whether the local lane is missing the remote review-fix commit.

5. Decide the future of `#4782`.

Either keep `integration/agenta-rivet-base` as a throwaway integration target, or rebuild the single harness commit as a clean linear lane after the sandbox-agent rename lands. Until then, do not treat it as a normal merge-ready PR.

6. Triage unassigned changes by owner:

| Unassigned bucket | Likely owner |
|---|---|
| SDK deltas | `feat/agent-sdk-runtime` |
| Service deltas | `feat/agent-service` |
| Runner wire/tool deltas | `feat/agent-runner-tools` |
| Runner engine/server/tracing deltas | `feat/agent-runner-engines` |
| Sandbox-agent rename and test relocation | `chore/sandbox-agent-core` or new `chore/sandbox-agent-rename` |
| Hosting compose deltas | `chore/agent-hosting-compose` or sandbox-agent deployment branches |
| Docs deltas | `docs/agent-workflows` or a new docs follow-up |
| Hook/plumbing changes | Keep unassigned, discard, or separate chore PR |

7. Only after assignment, commit each lane separately and push.

## Landing order once clean

1. SDK stack: `#4771` -> `#4772` -> `#4785`
2. Runner stack: `#4773` -> `#4778`, then draft `#4784` if kept
3. Frontend stack: `#4775` -> `#4780`
4. Hosting: `#4776`
5. Sandbox-agent stack: `#4786` -> `#4787`, `#4788`, `#4789`
6. Docs: `#4779`
7. Rivet/Agenta harness: `#4782` last, or rebuilt after the sandbox-agent rename

## One-line answers

1. PR branches not applied locally: close `#4774` and `#4777`; keep `#4773`; treat `#4782` as merge-based/off-workspace; reconcile `#4775` because GitHub and GitButler currently disagree on its visible head.
2. Local work with no PR: no committed applied lane lacks a PR, but the uncommitted working tree has no PR.
3. Local changes saved nowhere else: yes, significantly. The `rivet -> sandbox_agent` rename, new design-doc folders, test relocation cleanup, husky/user-hook changes, and broad SDK/service/runner/frontend edits are working-tree-only until triaged and committed.
