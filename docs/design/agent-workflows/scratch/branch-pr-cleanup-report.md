# Agent-workflows branch & PR cleanup report

Date: 2026-06-22
Scope: the agent-workflows PR set (#4771–#4789) vs the GitButler workspace on
`gitbutler/workspace`.

This is a findings + plan document. Nothing has been changed. Review before acting.

## TL;DR

- The agent-workflows work is split into 7 stacks. Six are applied as GitButler
  lanes and map cleanly to PRs. One (the rivet/Agenta-harness integration) is a
  merge-based branch that GitButler cannot stack, so it lives off-workspace.
- **Two PRs are stale duplicates and should be closed:** `#4774`
  (feat/agent-runner-engine) is superseded by `#4778` (feat/agent-runner-engines);
  `#4777` (docs/agent-workflows-design) is superseded by `#4779`
  (docs/agent-workflows).
- **A large body of uncommitted work exists only in the working tree** (77 tracked
  files changed, 32 untracked, net +1623/-2504). The headline pieces — a
  `rivet → sandbox_agent` code rename and ~6 new design-doc folders — are saved
  nowhere else. This is the main risk.
- Every applied lane is already pushed and in sync with its origin branch.

## The stacks (PR ↔ local lane map)

| Stack | PR | head branch | base | Applied lane? | Status |
|---|---|---|---|---|---|
| A. SDK | #4771 | feat/agent-sdk-runtime | main | yes (`sd`) | live |
| A. SDK | #4772 | feat/agent-service | feat/agent-sdk-runtime | yes (`rv`) | live |
| A. SDK | #4785 | fix/composio-no-auth-toolkits | feat/agent-service | yes (`fi`) | live |
| B. Runner | #4773 | feat/agent-runner-tools | main | folded into `nn` base | live (base PR) |
| B. Runner | #4778 | feat/agent-runner-engines | feat/agent-runner-tools | yes (`nn`) | **live** |
| B. Runner | #4774 | feat/agent-runner-engine | feat/agent-runner-tools | no | **SUPERSEDED → close** |
| B. Runner | #4784 (draft) | chore/agent-runner-test-setup | feat/agent-runner-engines | no | draft, stacked on #4778 |
| C. Frontend | #4775 | feat/agent-playground-ui | main | yes (`pl`) | live |
| C. Frontend | #4780 | fe-feat/agent-chat-ui-slice | feat/agent-playground-ui | yes (`ha`) | live |
| D. Hosting | #4776 | chore/agent-hosting-compose | main | yes (`st`) | live |
| E. Sandbox-agent | #4786 | chore/sandbox-agent-core | main | yes (`cor`) | live |
| E. Sandbox-agent | #4787 | chore/sandbox-agent-railway | chore/sandbox-agent-core | yes (`ra`) | live |
| E. Sandbox-agent | #4788 | chore/sandbox-agent-kubernetes | chore/sandbox-agent-core | yes (`ku`) | live |
| E. Sandbox-agent | #4789 | ci/sandbox-agent-image | chore/sandbox-agent-core | yes (`ci`) | live |
| F. Docs | #4779 | docs/agent-workflows | main | yes (`do`) | **live** |
| F. Docs | #4777 | docs/agent-workflows-design | main | no | **SUPERSEDED → close** |
| G. Rivet harness | #4782 | feat/agenta-on-rivet | integration/agenta-rivet-base | no | merge-based, off-workspace |
| G. Rivet harness | (no PR) | integration/agenta-rivet-base | — | no | merge bundle of A–F |

Related, not in the cleanup list but agent-adjacent:
- `#4783` (draft) `claude/git-butler-agent-prs-b227dz` → main — "Sandbox runtime
  metering — scoped-resource design" (design doc).

## Question 1 — PR branches not applied locally: deprecated, mistake, or fine?

Five branches have PRs (or are PR bases) but are not GitButler lanes:

1. **`feat/agent-runner-engine` (#4774) — DEPRECATED, close it.**
   It is the older sibling of `feat/agent-runner-engines` (#4778). Same logical
   commits, different SHAs, but #4778 additionally has
   `fix(agent): install python3 and rebuild the Pi extension` and the
   `extension-tools.test.ts` + `Dockerfile.dev` work. The plural-named #4778 is the
   one applied locally and the one we keep. Singular #4774 should be closed.

2. **`docs/agent-workflows-design` (#4777) — DEPRECATED, close it.**
   Superseded by `docs/agent-workflows` (#4779). #4779 contains everything in #4777
   plus the QA matrix, findings, and driver (28 extra files / +2921 lines). #4779 is
   the applied lane.

3. **`feat/agent-runner-tools` (#4773) — NOT deprecated, keep.**
   It is the genuine base of the runner stack. Its two commits (`wire protocol`,
   `tool bridge secrets`) sit at the bottom of the `nn` lane, which is why it is not
   a separate lane. On GitHub the #4778 diff is computed from the merge-base, so the
   #4773 → #4778 split is coherent. Minor wart: the "keep tool bridge secrets
   runner-side" commit was re-created with a different SHA inside #4778, so it
   appears in both branches' history (GitHub's 3-dot diff hides this). Harmless;
   leave as is.

4. **`feat/agenta-on-rivet` (#4782) + `integration/agenta-rivet-base` — NOT a
   mistake, but fragile.**
   `integration/agenta-rivet-base` is a **merge commit** that bundles the SDK,
   service, runner, hosting, and docs stacks into one branch; `#4782` adds a single
   harness commit (`run the Agenta harness on the rivet/ACP backend with forced
   skills`) on top. It is not applied as a lane because GitButler cannot stack a
   merge-based branch — this is the documented "series need linear history" gotcha.
   So it is deliberately off-workspace, used as an integration/demo target. Two
   concerns: (a) it still uses the old **rivet** naming while the rest of the work is
   moving to **sandbox-agent**, and (b) it will drift as the underlying stacks change.

No branch here is an accidental orphan. The only true deletions are the two
superseded duplicates (#4774, #4777).

## Question 2 — Local work without an open PR

- **Every applied lane already has a PR**, and every lane is pushed and in sync with
  its origin branch. There is no committed-but-unpushed or committed-but-PR-less lane
  inside the agent-workflows scope.
- The only "work without a PR" is the **uncommitted working-tree changes** (see Q3) —
  they are not committed to any lane, so they have no PR by definition.
- There are also many unrelated local branches in the repo (e.g. `feat/agent-tools-wp7`,
  `feat/agent-harness-port`, POC branches). Those are out of scope for this cleanup
  and not part of the #4771–#4789 set.

## Question 3 — Local changes not saved anywhere else (the real risk)

There is substantial uncommitted work on `gitbutler/workspace` that is **not in any
branch, local or remote**:

- **`rivet → sandbox_agent` code rename (working-tree only):**
  - new: `sdks/python/agenta/sdk/agents/adapters/sandbox_agent.py`
  - new: `services/agent/src/engines/sandbox_agent.ts`
  - deleted: `rivet.py`, `rivet.ts`
  No remote branch contains `sandbox_agent.py`. This is the missing other half of the
  sandbox-agent rename: the `chore/sandbox-agent-*` branches (#4786–#4789) renamed the
  deployment/runner surface but **left the engine + SDK adapter named `rivet`**. The
  working tree finishes that rename and is uncommitted.

- **New design-doc folders (working-tree only):**
  `provider-model-auth/`, `skills-config/`, `model-config/`, `code-tool-sandbox/`,
  `harness-capabilities/`, plus `feature-matrix-test.md`, `qa/cleanup-plan.md`,
  `qa/implementation-plan.md`. None exist in any remote branch.
  (`typescript-structure/` is the one exception — it also lives in
  `chore/agent-runner-test-setup`, draft #4784.)

- **Test relocation tail:** the 8 `services/agent/test/*.test.ts` deletions are the
  cleanup half of the relocation to `services/agent/tests/unit/*` that #4786 (`cor`)
  introduced. #4786 added the new layout but did not delete the old files; the working
  tree deletes them. So this deletion belongs with the #4786 stack.

- **Local-only husky hooks:** `.husky/post-checkout-user`, `.husky/pre-commit-user`
  (plus edits to the tracked husky scripts and `.gitignore`). Likely local
  developer-machine config, not feature work.

- Plus broad edits across `sdks/python/agenta/sdk/agents/*`, `services/agent/src/*`,
  `services/oss/src/agent/*`, and `web/oss/.../AgentChatSlice` — net **+1623/-2504**
  across 77 tracked files. Because these overlap files already committed in the lanes,
  they represent a **newer, diverged version** sitting on top of what the PRs contain.

**Risk:** all of the above lives only in the working tree of one machine. A bad
`but` operation, a reset, or a worktree mishap loses it. It needs to be triaged into
lanes/branches and committed, or deliberately parked.

## Recommended plan

Do these in order. Steps 1–2 are safe and reversible; step 3 needs your decisions.

### 1. Close the two duplicate PRs
- Close **#4774** (feat/agent-runner-engine) with a note pointing to #4778.
- Close **#4777** (docs/agent-workflows-design) with a note pointing to #4779.
- After closing, delete their remote branches (`feat/agent-runner-engine`,
  `docs/agent-workflows-design`) and the local refs, so the rename stops being
  ambiguous.

### 2. Snapshot before touching the workspace
- `but oplog snapshot -m "pre-cleanup 2026-06-22"` so any lane surgery is reversible.

### 3. Triage the uncommitted work (the important part)
Assign each cluster to a destination, then commit. Suggested mapping:

- **`rivet → sandbox_agent` rename** → this is the conceptual completion of the
  sandbox-agent line. Decide one of:
  - fold it into the `#4786` `chore/sandbox-agent-core` lane (`cor`) so the rename is
    complete in one place, **or**
  - give it its own lane `chore/sandbox-agent-rename` stacked on `cor`.
  Either way it must also update the SDK/service references and the rivet harness
  (#4782) eventually.
- **`services/agent/test/*` deletions** → fold into the `#4786` lane (`cor`) next to
  the relocation that created `tests/unit/`.
- **Design-doc folders** (`provider-model-auth/`, `skills-config/`, `model-config/`,
  `code-tool-sandbox/`, `harness-capabilities/`, `feature-matrix-test.md`,
  `qa/*-plan.md`) → fold into the docs lane `#4779` (`do`), or a new
  `docs/agent-workflows-more` lane if you want to keep #4779 scoped to what is already
  in review.
- **`.husky/*-user`, `.gitignore`, husky script edits** → if these are local-machine
  config, keep them unassigned (do not commit), or move to a small
  `chore/husky-user-hooks` branch (a branch of that name already exists locally —
  check whether this belongs there).
- **Remaining sdk/service/web edits** → diff each against what the lane already has;
  these are the diverged "newer version". Decide per file whether to `but absorb`
  into the owning lane or drop.

### 4. Decide the rivet-harness branch's future (#4782)
- Keep `integration/agenta-rivet-base` as a throwaway integration target, **or**
  rebuild the single harness commit `955d1cc92a` as a clean lane on top of the real
  stack once the `sandbox_agent` rename lands — and rename the branch off "rivet".
- Until then, expect it to drift; do not treat it as a mergeable PR.

### 5. Land order once the tree is clean
Bottom-up, each PR's base set to its parent so each shows only its own diff:
1. A: #4771 → #4772 → #4785
2. B: #4773 → #4778 (then draft #4784)
3. C: #4775 → #4780
4. D: #4776
5. E: #4786 → {#4787, #4788, #4789}
6. F: #4779
7. G: #4782 last (or rebuilt per step 4)

## One-line answers

1. **Branches in a PR but not applied locally:** #4774 and #4777 are stale duplicates
   → close them. #4773 (runner base), #4782 + integration branch (merge-based harness)
   are intentional, not mistakes — keep, but rename #4782 off "rivet".
2. **Local work with no PR:** none among the committed lanes (all pushed, all have
   PRs). Only the uncommitted working tree has no PR.
3. **Local changes saved nowhere else:** yes, and it is significant — the
   `rivet → sandbox_agent` rename and ~6 design-doc folders exist only in the working
   tree. Triage and commit before any risky `but` operation.
