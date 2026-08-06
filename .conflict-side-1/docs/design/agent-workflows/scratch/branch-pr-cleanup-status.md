# Agent-workflows branch & PR cleanup — status tracker

Last updated: 2026-06-22
Companion to [`branch-pr-cleanup-report.md`](./branch-pr-cleanup-report.md) (full findings).

Legend: ✅ done · 🔄 in progress · ⬜ not started · 🧭 needs a decision

## Decisions locked

- Close **#4774** (feat/agent-runner-engine) as superseded by **#4778**, after
  salvaging any still-relevant review context into #4778.
- Close **#4777** (docs/agent-workflows-design) as superseded by **#4779**.
- Close **#4782** (feat/agenta-on-rivet) and abandon `integration/agenta-rivet-base`.
  Not worth more investment right now.

## Progress

| # | Item | State | Notes |
|---|---|---|---|
| 1 | Carry #4774 context into #4778, then close #4774 | ✅ | #4774 CLOSED. Carry-over [comment](https://github.com/Agenta-AI/agenta/pull/4778#issuecomment-4767220910) on #4778 salvaged 3 live items (see below). |
| 2 | Close #4777 | ✅ | Closed by Mahmoud. |
| 3 | Close #4782 + abandon `integration/agenta-rivet-base` | ✅ | #4782 CLOSED. integration branch abandoned. |
| 4 | Sync #4775 playground lane up to origin | ✅ | Playground lane in sync with origin (`592282099d`). |
| 5 | Re-stack #4780 on the pushed playground head | ✅ | #4780 committed + pushed, in sync. |
| 6 | Tidy #4773 → #4778 stack (duplicate commit) | ⏸️ | Deferred to the parent-branch restack (see runner-stack note). |
| 7 | Triage the uncommitted working-tree work | ✅ | Code rename + test deletions + all docs committed & pushed. Remaining = parked/temp/deferred only. |
| 8 | Push everything; PRs in sync | ✅ | 11 branches pushed (rv/fi force-pushed). All 7 open PRs match local. 4 new docs branches created on origin. |
| 9 | Delete remote branches of closed PRs | ⬜ | `feat/agent-runner-engine`, `docs/agent-workflows-design`, `feat/agenta-on-rivet`, `integration/agenta-rivet-base`. Ready to delete. |
| 10 | Runner stack (#4773 series + apply #4784) | ⏸️ | Deferred to the review phase. In-place apply blocked by rename conflict (see note). |
| 11 | Parent branch `big-agents` (create, retarget, switch target) | ✅ | Done 2026-06-22 (see below). |

## Parent branch `big-agents` — DONE 2026-06-22
- Created `big-agents` off main, pushed (`origin/big-agents` at `a97e608369`).
- GitButler target switched `origin/main` → `origin/big-agents` (unapply all → `but config
  target` → re-apply each branch). NOTE: `but unapply` has no `--force` flag; and re-applying
  a stack base does NOT bring its stacked children — apply each branch explicitly.
- Retargeted the 6 bottom PRs to `big-agents`: #4771, #4773, #4775, #4776, #4779, #4786
  (via `gh api .../pulls/N -X PATCH -f base=big-agents`). Stacked PRs keep their parents.
- Fixed the #4775/#4780 skew: rebased `ha` (chat-ui) onto the playground tip `592282` in a
  throwaway worktree, re-applied, force-pushed #4780.
- Final: all 16 project lanes applied (only project lanes), all in sync with origin.
- Next: review each PR vs `big-agents`, assemble the deferred runner stack, merge into
  `big-agents`, then `big-agents` → main.

## What's next (in priority order)

### A. Finish the closes (cheap, reversible)
- Wait for the subagent to confirm #4774 is closed and the carry-over comment is on #4778.
- Confirm #4777 and #4782 show closed.
- Then delete the four dead remote branches (item 8). Keep the local refs until we are
  sure nothing references them.

### B. Fix the #4775 / #4780 playground stack (correctness)
The report's first draft said this branch was "in sync." That was wrong. Corrected:
- Origin and PR **#4775** are at `592282` = `fix(frontend): address agent playground review`.
- The local GitButler lane is at `7120276` = its **parent**. So the **lane is one commit
  BEHIND** origin/PR, missing the pushed review-fix.
- The local **#4780** chat-ui lane is stacked on the behind commit `7120276`, not on the
  pushed playground head, so the review-fix is missing underneath it too.
- Fix direction: pull the lane UP to origin (`592282`), then re-stack #4780 on top. Do
  NOT push the lane over the PR — that would drop the pushed review commit.
- Low data-loss risk: the extra commit is safe on origin.

### C. Optional: tidy the #4773 → #4778 runner stack
- Origin `feat/agent-runner-tools` tip (`46062dc6c9`) is not an ancestor of
  `feat/agent-runner-engines`. They fork at the wire-protocol commit, and #4778 re-does
  the `keep tool bridge secrets runner-side` commit under a new SHA, so that change shows
  in both PR diffs.
- Minor. If we want a clean stack, rebase #4778 onto the real tip of #4773. Otherwise
  GitHub's merge-base diff keeps it readable. Low priority.

### D. Triage the uncommitted working-tree work (the real risk) 🧭

**Decision taken: Option A — distribute each file's changes into its owning lane.** End
goal is to stack all these PRs against a new parent branch (e.g. a `agents` GitButler
branch), then review and merge there, so per-lane precision matters less than getting the
work committed roughly in the right place. Safety snapshot taken: `but oplog restore
bd31da6592`.

**Done — code-side `rivet → sandbox-agent` rename distributed (unpushed local commits):**
| Lane / PR | New commit | Files |
|---|---|---|
| #4771 `feat/agent-sdk-runtime` | `2a7c1299b2` | 16 (SDK, incl. `rivet.py → sandbox_agent.py`) |
| #4772 `feat/agent-service` | `490f304ad3` | 4 (`services/oss/src/agent/**`) |
| #4778 `feat/agent-runner-engines` | `348240268e` | 21 (`services/agent/src/**`, incl. `rivet.ts → sandbox_agent.ts`) |
| #4776 `chore/agent-hosting-compose` | `14ab328e6d` | 1 (dev compose) |
| #4780 `fe-feat/agent-chat-ui-slice` | `1da72d5fda` | 1 (`generateId` swap, not a rename) |

Verified: zero `rivet` refs remain in code; both renames captured atomically.

**New design-doc folders — decision taken: each on its own parallel branch off main.**
| Branch | Folders | Commit | State |
|---|---|---|---|
| `docs/agent-model-config-and-provider-auth` | `provider-model-auth/` + `model-config/` | `8fa45cd8a0` | ✅ committed |
| `docs/agent-skills-config` | `skills-config/` | `ef5d62e62e` | ✅ committed |
| `docs/agent-code-tool-sandbox` | `code-tool-sandbox/` | `0fa7ee286c` | ✅ committed (30 n8n redacted; home-dir path genericized) |
| `docs/agent-harness-capabilities` | `harness-capabilities/` | `d98415923c` | ✅ committed (no n8n found; scan clean) |

`n8n` confirmed present in 4 `code-tool-sandbox/` files; subagents redact to "redacted"
and also scan for other sensitive mentions before commit.

**Existing docs + QA reports → #4779 (done):**
- 28 files committed to `docs/agent-workflows` as `8b07fca4d8` (25 rename-ref edits to
  existing docs + `feature-matrix-test.md` + `qa/cleanup-plan.md` + `qa/implementation-plan.md`).
  Gotcha hit: `ruff-format` reformatted `qa/scripts/run_matrix.py` and GitButler aborted
  the commit; fixed by formatting the file first, then committing.

**`services/agent/test/` deletions → #4778 (done):**
- 8 old test files removed, committed to `feat/agent-runner-engines` as `8f6e48b9a8`
  (`test(agent): remove old test/ files relocated to tests/unit`). Per Mahmoud: if the
  deletion is meaningful, delete them — it is (the files were relocated to `tests/unit/`
  in #4786).

**Runner stack assembly (#4773 series + apply #4784) — BLOCKED in-place. 🧭**
- Tried (snapshot `5c3b9d9641` taken first): `but apply chore/agent-runner-test-setup`.
  GitButler aborted on conflict (`on_workspace_conflict=AbortAndReportConflictingStacks`)
  and left the workspace untouched (15 lanes intact, nothing lost).
- Root cause: #4784 was written for the old `rivet` naming. We just renamed #4778 (its
  base) to `sandbox-agent`. So #4784's changes to 6 shared source files (`cli.ts`,
  `server.ts`, `tools/dispatch.ts`, `package.json`, `tsconfig.json`, `pnpm-lock.yaml`) no
  longer fit on the renamed engines. (The 8 `test/` deletions are NOT a conflict — both
  sides delete them.)
- Chicken-and-egg: to apply #4784 it must first carry the rename, but it is unapplied, so
  editing it is the awkward path. GitButler won't apply-with-conflict to let us resolve.
- DECISION: assemble the runner stack during the parent-branch restack, where #4784 gets
  rebuilt on the new base and the rename folds in once, cleanly. Not worth fragile in-place
  surgery now. `typescript-structure/` edits are backed up at `/tmp/ts-structure-backup/`
  and still live in the working tree; they fold into #4784 at that point.

**Still unassigned, parked:**
- **husky/.gitignore (5 files)** — per Mahmoud, GitButler/local hook config. Leave alone.
- **Three session tracker docs** (`branch-cleanup-report.md`, `branch-pr-cleanup-report.md`,
  `branch-pr-cleanup-status.md`) — session scratch, left unassigned.

### (legacy notes from the original plan)
Net +1623/-2504 across 77 tracked files plus 32 untracked, committed to no lane and
pushed nowhere. Assign each cluster to an owner, then commit per lane (never a blanket
`but commit`). Proposed mapping:

- **`rivet → sandbox_agent` code rename** (new `sandbox_agent.py`, `sandbox_agent.ts`;
  `rivet.py`/`rivet.ts` deleted) — exists in no branch. This is the missing other half
  of the sandbox-agent rename that #4786–#4789 started on the deployment surface. Decide:
  fold into #4786 (`chore/sandbox-agent-core`) or give it its own lane. Must also update
  SDK/service references and eventually the harness work.
- **`services/agent/test/*` deletions** — the cleanup tail of the relocation to
  `tests/unit/` that #4786 introduced. Fold into #4786.
- **New design-doc folders** (`provider-model-auth/`, `skills-config/`, `model-config/`,
  `code-tool-sandbox/`, `harness-capabilities/`, `feature-matrix-test.md`,
  `qa/*-plan.md`) — exist in no branch (except `typescript-structure/`, which is in draft
  #4784). Fold into #4779 docs lane or a new docs follow-up.
- **`.husky/*-user`, `.gitignore`, husky script edits** — likely local-machine config.
  Keep unassigned or move to a small chore branch. Confirm with Mahmoud.
- **Remaining sdk/service/web edits** — diff each against the owning lane; `but absorb`
  or drop per file. These are the diverged "newer version" of committed work.

Before any of this: `but oplog snapshot -m "pre-cleanup 2026-06-22"`.

## Live findings carried from #4774 into #4778 (worth fixing before merge)
Posted as a [comment on #4778](https://github.com/Agenta-AI/agenta/pull/4778#issuecomment-4767220910):
- CLI `process.exit` in `src/cli.ts` can truncate the JSON result on stdout (Node may
  exit before the write flushes).
- Streaming client-disconnect abort in `src/server.ts` reaches `runRivet` only, not
  `runPi`, so a disconnected client leaves an in-process Pi run executing.
- Design caveat (keep, do not "fix"): `server.ts` deliberately swallows background
  rejections from the rivet SDK so one stray rejection cannot kill the sidecar.

## Related PRs noticed (not part of this cleanup, no action yet)
- **#4784** (draft) `chore/agent-runner-test-setup` → #4778: vitest suite + CI. Keep,
  stacked on #4778.
- **#4783** (draft) `claude/git-butler-agent-prs-b227dz`: sandbox metering design doc.

## Land order once the tree is clean
1. SDK: #4771 → #4772 → #4785
2. Runner: #4773 → #4778 (then draft #4784)
3. Frontend: #4775 → #4780
4. Hosting: #4776
5. Sandbox-agent: #4786 → {#4787, #4788, #4789}
6. Docs: #4779
