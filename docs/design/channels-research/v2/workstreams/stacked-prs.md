# Stacked PRs for the channels rollout

Research note. Answers whether a stacked-PR workflow should carry the 15 work
packages (WP0–WP14) to review, given the dependency graph and checkpoint
structure in `README.md` and `plan.md`.

## What a stack buys us here

A stack buys a reviewer "small diff with correct context" — each layer's PR
shows only its own delta against the layer below, not against `main`. That is
valuable exactly where one package's reviewable unit is genuinely built on
another's code, in sequence, inside the same checkpoint.

Looking at the actual graph:

- **Within a checkpoint, most packages are siblings, not a chain.** C1 =
  WP1+WP2+WP3. WP2 and WP3 both depend on WP1's interfaces, but WP2 and WP3 do
  not depend on each other — they are parallel consumers of the same stub, per
  the "stubs-first, on the shared branch" model in `README.md`. Stacking WP2
  on WP3 (or vice versa) would be fake sequencing: it forces an arbitrary
  order on two branches that have no real code dependency, and it makes
  whichever one is "on top" block on review of the other for no reason. The
  right relationship for siblings is **parallel branches off the same base**,
  not a stack.
- **A stack earns its keep only where the dependency is a true code
  dependency inside one checkpoint's review window** — e.g. if WP9 (commands)
  turned out to need WP10's (fill) output type mid-checkpoint at C4, a
  two-deep stack for that pair would be the honest shape. Scanning the graph,
  this case is rare: the design's whole point of the seed commit + stub
  interfaces (`README.md` "Stubs-first") is to convert most cross-package
  dependencies into *interface* dependencies resolved before any worktree
  starts, specifically so packages don't need to stack on each other's
  in-flight code.
- **WP1's migration is a fan-out dependency, not a stack dependency.** Every
  later package needs WP1's tables to exist, but they need it as a merged,
  landed fact at the start of their checkpoint — not as a branch they rebase
  on mid-review. This is the seed-commit pattern already designed in, and it
  is not what stacked PRs solve.
- **Across checkpoints, nothing should stack at all.** C1 through C5 are
  explicitly not continuous — `README.md`'s "Rebase discipline" says packages
  rebase on the base branch *at checkpoints and never between*. A stack that
  spanned C1→C5 would keep five checkpoints' worth of branches alive
  simultaneously, which is the opposite of the checkpoint model's intent
  (integration pain concentrated at defined points, not smeared across the
  whole build).
- **Where it does help:** the 4 collision files. A collision file's diff is
  genuinely sequential — WP3, WP4, WP5, WP8 each prepare a wiring block for
  `api/entrypoints/routers.py`, and those blocks must apply in some order at
  the checkpoint. That ordering is naturally a short stack (3–4 PRs deep) at
  the moment of the checkpoint merge, not before. Same for the migration:
  if WP1 and WP7 ever needed two separate reviewable diffs against the same
  revision file (the design avoids this by giving WP1 sole ownership), that
  would be a stack too.

**Honest read: full stacking (all 15 packages as one graph-shaped stack) is
the wrong tool.** Most of the graph is breadth (siblings sharing a base), not
depth (chains). The place a stack is genuinely useful is narrow: the 3–4-PR
collision-file merges at each checkpoint, and any single pair of packages
that turns out to have a real same-checkpoint code dependency despite the
stub design. Treat stacking as a tactic for those spots, not the default
shape for the whole rollout.

## Two corrections from the repo itself

Both were verified after this note's first pass and change what the recommendation
rests on, though not the recommendation.

**The merge style is two-tier, not one.** Feature PRs *squash*-merge onto the
current **release branch** (`release/v0.110.0`), and that branch merges into `main`
as a **true merge commit**. Reading only `main`'s log shows merges and suggests no
squashing; reading only `gh pr view` shows squashes and suggests no merge commits.
Both are true at different levels. The practical consequence: **our PRs target the
release branch**, which is also where the 17-PR precedent landed — not `main`.

**The repo already has a stacking convention, and it is GitButler.** `AGENTS.md`
documents the `but` CLI with a long list of hard-won gotchas, which makes an
external tool a non-starter: adopting Graphite here would mean two competing
workflows in one repo.

Read that section closely and it argues *for* the recommendation below rather than
against it. Its §"Stacks are linear; a fan-out is expressed through PR bases"
states that a GitButler stack cannot express a fan-out at all — anchoring two
branches on one parent inserts them in a line rather than making siblings. Our
graph is a fan-out. And every failure mode its §"Spreading a pile of edits back
across an existing stack" warns about comes from **one working tree holding many
lanes' changes**, which is exactly what per-package worktrees with disjoint file
ownership avoid.

So: use `but` if a genuine chain appears, follow its rule of setting each PR's base
to the branch below, and otherwise keep packages as parallel branches — which the
repo's own precedent already does.

## Options

| Tool | Actively maintained (2026) | Cost | Requires a hosted service | Works against a fork remote |
| --- | --- | --- | --- | --- |
| GitHub native stacked PRs (`gh stack`, public preview since 2026-07-30) | Yes — GitHub-shipped | Free | No (GitHub itself) | **No — explicitly unsupported.** "Stacked pull requests require all branches to be in the same repository. Cross-fork stacks are not supported." |
| Graphite (`gt`) | Yes | Free tier covers CLI + stacking; Starter $20/user/mo, Team $40/user/mo | Yes, for the dashboard/merge-queue/AI-review features; CLI stacking itself talks to GitHub directly | Partial/fragile — Graphite pushes stack branches into whichever repo it's pointed at; using it against a fork means all stack branches live on the fork, which works, but community reports note friction (Graphite prefers pushing under the "main" configured repo, and misconfigured remotes silently break "publish") |
| git-town | Yes — v23 shipped May 2026 | Free, open source | No | Yes — general-purpose git workflow tool, remote-agnostic, works with whatever `origin`/`upstream` is configured |
| spr (ejoffe/spr) | Uncertain — low recent visible activity; could not confirm active 2026 releases | Free, open source | No | Yes — one-commit-one-PR model, pure GitHub API, remote-agnostic |
| ghstack | Uncertain — long-standing but low recent visible activity; treat as community-maintained, not vendor-maintained | Free, open source | No | Yes — but it deliberately creates synthetic base/head branches at the *target* repo, so it wants push access to where PRs land, same constraint as any tool pushing branches for review |
| Sapling (`sl`) | Yes — Meta-maintained, active | Free, open source | No | Yes — `sl pr submit` creates overlapping PRs against a single target repo; same single-repository assumption as the others |

**Fork-remote flag: every stacking tool here — native GitHub included —
assumes the whole stack's branches live in one repository.** None support a
stack where the base sits in the upstream org repo and layers are pushed to
a personal fork (the classic outside-contributor shape). That is not this
repo's situation, though: `git remote -v` shows this worktree's
`pushDefault` is a personal fork remote, and *all* branches for this work
would be pushed there — base and every layer. That is a single-repo stack
from the tool's point of view (the "repository" is the fork), so none of the
above are ruled out by the fork remote itself. What *would* break every
option here is a workflow where WP1's branch pushes to the fork but a later
checkpoint's PR is opened directly against the upstream org repo with a
different base — don't do that; keep the whole stack's branches on one
remote for its lifetime.

Sources:
- [GitHub Docs — About stacked pull requests](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs)
- [GitHub Docs — Stacked pull requests CLI commands](https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands)
- [GitHub Changelog — Stacked pull requests are now in public preview](https://github.blog/changelog/2026-07-30-stacked-pull-requests-are-now-in-public-preview/)
- [GitHub Engineering blog — Turn one giant AI-generated pull request into a reviewable stack](https://github.blog/engineering/turn-one-giant-ai-generated-pull-request-to-a-reviewable-stack/)
- [Graphite pricing](https://graphite.com/pricing)
- [git-town releases](https://github.com/git-town/git-town/releases)
- [ejoffe/spr](https://github.com/ejoffe/spr)
- [facebook/sapling](https://github.com/facebook/sapling)

## Recommendation

**Do not build one 15-deep stack. Use plain parallel branches off the base
for the breadth of the graph, and reserve a short-lived, manually-managed
stack (plain git, no tool) for the collision-file merges at each
checkpoint.**

Reasoning:
- The dependency graph is mostly breadth (siblings on a shared stub), not
  depth — a stacking tool's core value (cascading rebase across a chain) has
  little to bite on here. Adopting Graphite or `gh stack` org-wide for this
  work would add a workflow and a base-branch discipline that most packages
  never need.
- Nothing here is cross-fork in the way that breaks native GitHub stacking —
  but nothing here needs the parts of Graphite that cost money either (merge
  queue, AI review). A paid tool bought for a four-file collision problem is
  the wrong trade.
- This org has already solved the "many parallel packages converge in
  sequence" problem once, on this exact repo, without a stacking tool: the
  `agent-config-editing-s1a` … `s7e` slices (17 PRs, `gh pr list` confirms
  each based on `release/v0.110.0` and squash-merged independently within a
  40-second window) landed as **parallel PRs against a shared integration
  branch**, not a stack. That is the precedent to repeat, not deviate from.
- Squash-merge is confirmed as this org's convention (see below), and
  squash-merge is the case where stacking tools are weakest: after a squash,
  every layer above the merged one needs a rebase-not-merge onto the new
  trunk tip, because the squash commit's hash never matches anything in the
  upstream branches' history. Native `gh stack` and Graphite both handle this
  automatically for true chains, but for siblings-on-a-shared-base (this
  repo's actual shape) plain `git rebase --onto` after each checkpoint is
  simpler and has no tool-specific failure mode to learn.

Concrete workflow — plain git, checkpoint-scoped:

**Setup (once per checkpoint's worktrees):**
```bash
# each package worktree branches from the seed/checkpoint commit
git worktree add ../wp4 -b wp4-inbox-worker <checkpoint-base-sha>
```

**Daily work (each package, independently):**
```bash
git add -p && git commit
git push -u origin wp4-inbox-worker   # origin here is whichever remote is configured for this worktree
gh pr create --base <checkpoint-base-branch> --title "..." --draft
```

**When the checkpoint's base branch moves (e.g. a sibling package merges first):**
```bash
git fetch origin
git rebase origin/<checkpoint-base-branch>
git push --force-with-lease
```

**For the 4 collision files, at the checkpoint only** — this is the one
place a real stack exists, and it is short-lived (hours, not the whole
checkpoint):
```bash
# each package that touches a collision file prepares its wiring block
# as a small commit on top of the checkpoint-base merge commit, in the
# agreed apply order (e.g. WP3, then WP4, then WP5, then WP8 for routers.py)
git checkout -b collision-routers-c2 <checkpoint-base-after-merges>
git cherry-pick <wp3-routers-commit>
git push -u origin collision-routers-c2 && gh pr create --base <checkpoint-base-branch>
git checkout -b collision-routers-c2-wp4 collision-routers-c2
git cherry-pick <wp4-routers-commit>
git push -u origin collision-routers-c2-wp4 && gh pr create --base collision-routers-c2
# ...continue for wp5, wp8; merge bottom-up, retargeting the next PR's base
# to the checkpoint branch after each merge (gh pr edit <n> --base <branch>)
```

If this collision-stacking becomes routine (more than the 4 known files, or
recurring every checkpoint), revisit and adopt `git-town` — it is free,
actively maintained (v23, May 2026), remote-agnostic, and automates exactly
the "retarget base after the branch below merges" step without requiring a
hosted account. Do not reach for Graphite unless the team wants its paid
merge-queue/AI-review features for reasons beyond this rollout.

## How it maps onto our checkpoints

Given C1=WP1+WP2+WP3, C2=WP4+WP7+WP5, C3=WP6+WP8, C4=WP9+WP10+WP13, C5=WP12
then WP11:

- **C1 (WP1, WP2, WP3):** three parallel branches off the seed commit, three
  independent PRs against the checkpoint base. WP2 and WP3 both read WP1's
  frozen `interfaces.py`, but neither stacks on the other or on WP1 — they
  branch from the same stub commit and merge independently. No stack.
- **C2 (WP4, WP7, WP5):** same shape — three parallel branches off the C1
  merge point. WP4/WP5 are the two worker halves and are siblings, not a
  chain (`README.md` "The two worker halves" — split precisely so they don't
  depend on each other). No stack.
- **C3 (WP6, WP8):** two parallel branches. No stack.
- **C4 (WP9, WP10, WP13):** three parallel branches. WP13 is a separate repo
  area (`web/oss/src/…`) and has zero file overlap with WP9/WP10 — it could
  even land on its own schedule. No stack.
- **C5 (WP12 then WP11):** this is the one real candidate for an actual
  two-deep stack. The ordering word "then" in the prompt indicates WP11
  (Slack over the bridge) needs WP12 (the bridge itself) to exist first as
  code, not just as an interface — check `specs-wp11.md`/`specs-wp12.md` to
  confirm this is a genuine code dependency and not another stub-resolved
  case. If confirmed: branch WP11 from WP12's branch tip (not from the C5
  base), open WP11's PR with `--base wp12-bridge`, and retarget it to the C5
  base branch once WP12 merges (`gh pr edit <wp11-pr> --base <c5-base>`, then
  rebase). If WP12's interface was already frozen and stubbed before C5
  started (consistent with the seed-commit pattern), WP11 can instead branch
  from the same base as WP12 in parallel, and "then" only describes merge
  order, not branch ancestry — verify which case applies before setting up
  the stack.
- **Collision files, every checkpoint that touches them:** the short
  cherry-pick stack described in Recommendation, scoped to that checkpoint's
  merge window only, never left standing afterward.

## Failure modes to avoid

- **Force-push after merge-queue entry wipes CI progress on siblings.**
  GitHub's merge queue force-pushes stacked branches once the bottom of the
  queue passes, discarding in-flight CI on the branches above even though
  their contents are unchanged — wasting runner time and, per community
  reports, can silently drop queue entries instead of continuing the stack
  ([GitHub community discussion #38167](https://github.com/orgs/community/discussions/38167)).
  *Rule:* don't put more than one of this rollout's checkpoint PRs in a merge
  queue at once; merge the collision-file stack sequentially by hand, confirm
  each merge, then submit the next.
- **Web-UI rebase on a stacked PR resets commit signing.** GitHub's own docs
  note that rebasing a stack through the web UI "resets the committer" and
  produces unsigned commits, which can trip signed-commit branch protection.
  *Rule:* rebase stacks from the terminal (`git rebase`, not the web "Update
  branch" button) for any branch that must stay signed.
- **Force-push wipes inline review comments anchored to old line numbers.**
  Any rebase or squash that changes commit SHAs orphans comment threads tied
  to the old diff. *Rule:* resolve or copy out open review threads on a
  collision-file PR *before* rebasing it onto a newer base; don't rebase
  mid-review if it can wait until the reviewer signs off first.
- **Redundant CI on every stack level.** Each layer's PR re-runs full CI
  against its own (growing) diff, so an N-deep stack can run CI roughly
  N times for shared code. *Rule:* keep any real stack (the collision-file
  case) at 2–4 levels max and merge it within one sitting — don't let it sit
  open across a workday accumulating re-runs.
- **Fake-stacking siblings that don't actually depend on each other.**
  The biggest risk specific to this rollout: because WP2/WP3, WP4/WP5,
  WP9/WP10/WP13, etc. all merge into the *same* checkpoint, it's tempting to
  stack them "for order." Doing so makes an unrelated package's review delay
  block another package's merge for no code reason. *Rule:* stack only pairs
  with a real code dependency (verified against `specs-wp*.md`, not assumed
  from checkpoint grouping); everything else is a parallel branch off the
  same base.
- **Stacking across checkpoints instead of within one.** A branch that
  outlives its checkpoint accumulates drift and defeats the "rebase only at
  checkpoints" discipline already designed in. *Rule:* no stack (real or
  parallel-branch) survives past the checkpoint it was built for; it merges
  or it's abandoned and rebuilt fresh off the next checkpoint's base.
- **Editing a collision file outside its checkpoint's stack.** `routers.py`,
  `auth.py`, the migration chain, and `interfaces.py` are the four files
  where an out-of-turn edit guarantees a conflict. *Rule:* the existing
  README rule stands — these are touched only inside the checkpoint's
  serialised stack, never from a package's day-to-day branch.
- **Assuming a fork-remote stack can retarget onto the upstream repo.**
  Native GitHub stacking and every third-party tool here assume one
  repository for the whole stack. *Rule:* if any PR in a stack needs to move
  from the fork to the upstream org repo, that PR is re-opened against the
  upstream repo as a fresh, non-stacked PR — it cannot be "retargeted" across
  repositories by any of these tools.
