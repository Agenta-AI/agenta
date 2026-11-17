---
name: gitbutler-stacks
description: Hard-won GitButler mechanics for multi-lane work in this repo — committing to a specific lane in a stack, spreading a pile of edits back across an existing stack, ordering a stack and setting PR bases, and recovering from a scrambled workspace. Use when working with stacked branches, when `but rub`/`but absorb`/`but commit --only` mis-routes a change, when a stack collapses or a commit lands on the wrong lane, or when a hunk gets dropped. Not needed for ordinary single-lane work.
---

# GitButler stacks (Agenta)

Everyday `but` usage — `but status`, `but commit`, `but push`, `but absorb` — is covered by
the root `AGENTS.md`. This skill is the multi-lane layer: it only matters once you have a
**stack** of branches, which is roughly 6% of the work here.

**Read the first rule first.** Most of what follows exists to undo damage that only happens
when edits are made first and assigned to lanes afterward. Committing each change to its lane
as you go avoids nearly all of it.

## Prefer one lane at a time

Land a lane before starting the next. A single lane per session needs none of the machinery
below — no `--only` staging discipline, no stash isolation, no oplog restores. Reach for a
stack only when a change genuinely depends on another in-flight branch's commits.

Sync a lane with **rebase, not merge**. Merge commits between branches are what collapse a
series (see the first hard-won gotcha).

## Committing to specific lanes in a stack (the part that bites)

Changes are assigned to the **stack**, not to an individual branch. `but rub <file>
<branch>` and `but commit <branch> --only` both operate on the stack's *assigned-changes*
set — `--only` commits **whatever is currently assigned** to the named branch, regardless
of which branch name you used when staging. So:

- **Never pre-stage multiple lanes' files and then commit them one lane at a time.** The
  first `but commit --only` sweeps the entire assigned set into that one branch (the others
  end up empty or scrambled). Instead, work **one lane at a time**: assign exactly that
  lane's files → `but commit <branch> --only` → **verify** → then assign the next lane's
  files. Keep the assigned set equal to exactly one lane's files at each commit.
- **Verify every commit immediately:** `git show --stat --name-only <branch>`. If a file
  from another lane leaked in, stop and fix before continuing.
- **`but rub` by path goes stale after any mutation.** Every `but` mutation kicks a
  background sync that invalidates the path index, so the *next* path-based
  `but rub <path> ...` often fails with "Source '<path>' not found". Use the stable
  **cliId** instead (the 2-4 char code in `but status` / `but status --json`):
  `but rub <cliId> <target>`. cliIds survive across the sync; paths don't.
- **Splitting one file across two stacked lanes** (e.g. `routers.py` where the lower lane
  owns half the edit and the upper lane the other half): you cannot split mixed hunks
  reliably. Instead use sequential working-tree states — make the file the lower lane's
  version, commit it to the lower lane; then edit the file to add the upper lane's delta
  and `but rub <fileCliId> <upperCommitCliId>` to amend that delta into the upper commit.
- The **branch ref can diverge from the workspace-applied commit** mid-session (after
  absorb/amend/rebase). The **working tree is the source of truth**; `but push` pushes the
  applied state. Don't panic if `git diff <branch> -- <file>` shows a delta while
  `git status` is clean — verify against `git show "<branch>:<file>"` and re-push.

## Spreading a pile of edits back across an existing stack (the reliable way)

When you have a working tree full of changes that belong to *many* lanes of an
already-pushed stack (e.g. a review-pass that fixes files across wp0…wp4), do NOT try to
assign-and-commit lane by lane against the live working tree — `but rub`/`but commit
--only`/`but absorb` all route by **hunk dependency across the whole stack**, and they
mis-route in three predictable ways that scramble the stack and waste hours:

- **New (untracked) files ignore the target branch.** `but rub <newFileCliId> <lowerLane>`
  dumps every untracked file into the **topmost** lane's staging group, not the one you
  named. New files cannot be assigned to a lower lane at all.
- **`but absorb` sends anything it can't attribute to the docs/top lane.** Renamed files,
  new files, and hunks in line-regions the target lane's original commit never touched all
  fall to the "last commit in the primary lane" fallback — silently the wrong lane.
- **A multi-hunk file whose hunks belong to different commits won't commit whole.** `but
  commit <lane>` / `-p <file>` commits the attributable hunks and **drops the rest**
  ("Warning: Some selected changes could not be committed"), often leaving an empty
  no-change commit. Splitting one file across lower+upper lanes is the §"Splitting one file
  across two stacked lanes" case above.

The technique that actually works — **git-stash isolation, one lane at a time:**

1. `but oplog snapshot -m "pristine"` then `git stash push -u` everything. Working tree
   clean, every lane back at its remote tip. This snapshot is your only safe recovery
   point — `but oplog restore` it whenever a step scrambles the stack (it does, often).
2. For each lane, restore **only that lane's files** into the clean tree:
   tracked-modified from `git checkout 'stash@{0}' -- <paths>`; **untracked/new** files
   from the stash's untracked parent `git checkout 'stash@{0}^3' -- <paths>`; reproduce
   deletes/renames with `git rm`. Verify with `git status` that ONLY that lane's files are
   present — nothing else.
3. Land them: if every hunk dependency-attributes cleanly to existing commits in that lane
   (and the lane below), a blanket `but absorb` (no source — the tree holds only this
   lane's files, so there's nothing to mis-route) puts each hunk in the right commit. If
   the lane needs **new** files, use `but commit <lane>` instead (the new files have only
   this lane to land in because the tree is isolated).
4. **Verify the lane's tip TREE, not the diff** (commit history within a lane doesn't
   matter; the resulting tree does): `git show <lane>:<file>` for each touched file, plus
   `git ls-tree -r <lane> <dir>` for moves/deletes. Then check the lanes *above* it for
   resurrected deletes / phantom files (the rebase re-materializes deleted dirs as
   untracked — `rm -rf` that residue; it's noise, the tip tree is authoritative).
5. Next lane. Push at the very end with `but push <lane> -f` and confirm every lane's
   `git rev-parse <lane>` == `git ls-remote origin <lane>`.

Unrelated fixes that depend on nothing in the stack (e.g. a stale test for code already on
main) go on their **own parallel lane**: isolate just that file, `but commit -c <newlane>`.

## Stacks are linear; a fan-out is expressed through PR bases, not graph shape

A GitButler **stack** is a linear series. `but branch new <name> --anchor <parent>` does NOT
create a sibling of `<parent>` — it **inserts the new branch into the line** on top of it. So
anchoring two branches on the same parent produces `parent → first → second`, not two children
of `parent`. `but branch new <name>` with **no** anchor makes a separate parallel stack, but a
parallel stack branches off the workspace base (main), so a branch that genuinely depends on an
ancestor's commits can't live there with a clean diff.

This matters when a design's dependency tree fans out (e.g. a web lane and an SDK lane that both
depend on an API lane but not on each other). You cannot draw that fan-out in the git graph here.
You don't need to. The clean per-PR diff is a **PR-base** property, not a graph-shape property:
a stacked branch contains every commit below it, and GitHub shows only the delta against the base
you set. So put everything in **one linear stack in dependency order** and set each PR's base to
the branch directly below it. Order independent lanes however you like (sort by fewest conflicts);
lanes that touch disjoint files (e.g. `web/**` vs `api/**`) can sit anywhere in the line.

- Build the line with `but move <branch> <target-branch>` (stacks `<branch>` on top of `<target>`)
  and `but move <branch> zz` (tears `<branch>` off into its own parallel stack). Use these to
  reorder after the fact; take a `but oplog snapshot` first.
- **Verify the line by diffing, not by eyeballing the tree.** For each branch, run
  `git diff --name-only <base>..<branch>` where `<base>` is the branch below it. The file list
  must be exactly that lane's files. If a lower lane's files appear, the order is wrong (a lane got
  inserted into another's ancestry) — `but move` it out of the way and re-diff.
- A branch torn off to its own parallel stack (base = main) gives a **wrong** diff against an
  ancestor branch: `git diff <ancestor>..<torn-off>` reverses the ancestor's own changes (their
  merge base is main). That's the tell that the branch needs to be stacked, not parallel.
- Set PR bases to match: bottom lane `--base main`, every other lane `--base <branch-below-it>`.

## Hard-won gotchas (don't relearn these)

- **GitButler series need linear history.** A stack of branches connected by
  `git merge` commits (e.g. branches synced by merging a release in) can collapse
  to a single series (the tip) when unapplied/re-applied — the intermediate
  branches stop being addressable and you can't `but commit` to them. Prefer
  GitButler's own stacking over merging branches into each other.
- **Don't sync a behind lane with `unapply` → `git branch -f origin/<b>` →
  `apply`.** Pointing a series at a merge-based origin ref flattens the stack.
  There is no clean "fast-forward this series to its own remote" in the CLI when
  origin is merge-based and ahead.
- **`but pull` rebases applied branches on the TARGET (main), not on each
  branch's own upstream.** It will not advance a series to `origin/<that-branch>`.
- **Recovery: `but oplog list` then `but oplog restore <sha>`** rewinds the whole
  workspace (including uncommitted changes) to any prior snapshot — this is how
  you undo a botched unapply/apply and get a collapsed stack's series back. Take
  a `but oplog snapshot -m "..."` before risky operations.
- **A dropped-hunk commit can damage the working tree, not just the commit.**
  When `but commit --only` warns "Some selected changes could not be committed",
  check the FILE in the tree afterwards, not only the commit: the reconcile can
  rewrite the working copy and silently lose the uncommitted hunks. Recover the
  exact bytes from a snapshot's worktree subtree:
  `git cat-file -p <oplog-sha>:worktree/<path>` (every oplog entry stores one).
- **Hunks land on the lane whose commits own their line regions — put the file
  there instead of fighting.** If a file's edits sit in regions a higher lane's
  commit created, committing them to the lower lane drops them and `but absorb`
  amends the higher lane's commit anyway (and an absorb that amends a LOWER
  commit can leave a `{conflicted}` commit above it; if that happens, restore
  the snapshot rather than uncommitting around it). Keep code and its tests
  together on whichever lane attribution chooses.
- **Parse cliIds from `but status --json`** (`filePath`/`cliId` pairs), never by
  grepping the human output — the graph art breaks naive extraction and a wrong
  token silently rubs the wrong thing. Commit cliIds also rotate after every
  background sync, so re-read them in the same breath as the command that uses
  them.
- **Lane a test with the half that appears LAST, not the half you were thinking
  about.** A test that drives two halves (a DAO and its wrapper, an API parser
  and the SDK catalog) fails in isolation on every lane between them if it lands
  below the upper half — and a green local run proves nothing, because the
  working tree has all lanes applied. The cheap check before landing any new
  test file: ask which lane's tip FIRST contains every symbol the test touches,
  and put the test there. (Three instances in one day before this rule.)
- **Remote-tracking refs go stale under `but push` and lie convincingly.**
  `git show <remote>/<branch>:<file>` can show old content long after the push
  landed (observed: the tracking ref pointing at neither the local ref nor the
  real remote head). Verify pushes ONLY with `git ls-remote` against
  `git rev-parse <branch>`, and inspect remote content via the commit object,
  never via the remote-tracking shortcut.
