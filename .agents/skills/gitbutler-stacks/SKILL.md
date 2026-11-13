---
name: gitbutler-stacks
description: GitButler mechanics for multi-lane work in this repo. Covers committing to a specific lane in a stack, spreading a pile of edits back across an existing stack, ordering a stack and setting PR bases, and recovering from a scrambled workspace. Use when working with stacked branches, when `but commit`, `but amend` or `but absorb` puts a change on the wrong lane, when a stack collapses or a commit lands on the wrong lane, or when a hunk gets dropped. Not needed for ordinary single-lane work.
---

# GitButler stacks (Agenta)

The root `AGENTS.md` covers everyday `but` usage, syncing by rebase instead of merge, and
oplog recovery. This skill covers the extra rules that apply once you have a stack of
branches. All commands here match `but` 0.22.3. Check `but <command> --help` before you use a
flag that this file does not show.

Most of the damage below happens when you make edits first and sort them into lanes later.
Commit each change to its lane as you make it, and most of this file never applies.

## Prefer one lane at a time

Land a lane before you start the next. A single lane needs none of the steps below. Build a
stack only when a change depends on the commits of another branch that is still in review.

## Committing to a specific lane

`but commit` with no change IDs commits every uncommitted change. In a stack, always name the
changes and the branch:

```bash
but status --json                       # read cliId for each filePath
but diff                                # read hunk IDs when one file needs splitting
but commit -b <branch> -m "message" <id> <id>
```

- Use `-b <branch>` to put the commit at the tip of that branch. Use `-A <commit>` or
  `-B <commit>` to place it next to a specific commit. Only one targeting flag is allowed.
- Check every commit at once with `git show --stat <branch>`. If a file from another lane is
  in it, stop and fix it before you continue.
- Read IDs from `but status --json` (`filePath` and `cliId` pairs). Do not grep the human
  output, because the graph art breaks simple parsing. File and hunk IDs change after every
  mutation, so read them again just before each command that uses them. A commit's change ID
  stays stable when commits move; prefer it over the short prefix.
- To add more changes to a commit that already exists, use
  `but amend -t <commit-or-branch> <id>`. A branch target amends its tip commit; name the
  commit to amend anything below the tip.
- To split one file across two stacked lanes, use two working-tree states. First make the file
  match the lower lane's version and commit it to the lower lane. Then add the upper lane's
  edits and run `but amend -t <upper-commit> <file-id>`. Mixed hunks in one state do not split
  reliably.
- The branch ref can differ from the commit applied in the workspace after an amend, absorb
  or rebase. The working tree is the source of truth. If `git diff <branch> -- <file>` shows a
  delta while `git status` is clean, check `git show "<branch>:<file>"` before you act.

## Spreading a pile of edits back across an existing stack

Sometimes the working tree holds changes for many lanes of a stack that is already pushed, for
example after a review pass. Do not commit lane by lane against that full working tree.
`but commit`, `but amend` and `but absorb` route hunks by their dependency on commits across
the whole stack, and they put changes in the wrong place in three known ways:

- **New files land on the top lane.** Untracked files have no commit to depend on. With the
  old assignment model they always went to the topmost lane, whatever lane you named. Check
  the commit after any new file.
- **`but absorb` sends what it cannot attribute to a fallback.** `but absorb --help` says
  that such changes go into "the topmost commit of the leftmost (first) branch". Renamed
  files, new files, and hunks in regions the lane's commits never touched all take this path.
  Run `but absorb --dry-run` first and read the plan.
- **A file whose hunks belong to different commits does not commit whole.** The command
  commits the hunks it can attribute and drops the rest with "Warning: Some selected changes
  could not be committed". It can leave an empty commit behind.

Isolate one lane at a time with `git stash`:

1. Run `but oplog snapshot -m "pristine"`, then `git stash push -u`. The working tree is now
   clean, and each lane is at its remote tip. Restore this snapshot with
   `but oplog restore <sha>` whenever a step scrambles the stack.
2. For each lane, restore only that lane's files. Take tracked files with
   `git checkout 'stash@{0}' -- <paths>`. Take untracked files from the stash's untracked
   parent with `git checkout 'stash@{0}^3' -- <paths>`. Repeat deletes and renames with
   `git rm`. Run `git status` and confirm that only this lane's files are changed.
3. Land them. If every hunk attributes to commits in this lane or the lane below, run
   `but absorb --dry-run`, then `but absorb`. The tree holds only this lane's files, so
   nothing can go to the wrong lane. If the lane needs new files, use
   `but commit -b <lane> -m "message" <id> ...` instead.
4. Check the tree at the lane's tip, not the diff. Run `git show <lane>:<file>` for each
   touched file and `git ls-tree -r <lane> <dir>` for moves and deletes. Then check the lanes
   above for deleted files that came back. A rebase can recreate deleted directories as
   untracked files. Remove that residue with `rm -rf`; the tip tree is what counts.
5. Go to the next lane. When all lanes are done, push each one with
   `but push <lane> --no-verify`. A rebased lane that is already on the remote needs a force
   push. Ask the user before any force push. Confirm each push with
   `git rev-parse <lane>` against `git ls-remote --heads origin <lane>`.

A fix that depends on nothing in the stack, such as a stale test for code already on main,
goes on its own parallel lane. Isolate that file and run
`but commit -b <new-lane> -m "message" <id>`. If `<new-lane>` does not exist, `but commit`
creates it as an unstacked branch.

## Stacks are linear; express a fan-out through PR bases

A GitButler stack is a linear series. `but branch new <name> -A <parent>` does not create a
sibling of `<parent>`. It puts the new branch into the line on top of `<parent>`. Two branches
created above the same parent form a line, not two children. `but branch new <name>` with no
`-A` or `-B` makes a parallel stack on the workspace base (main). A branch that needs an
ancestor's commits cannot live there with a clean diff.

You cannot draw a fan-out (for example, a web lane and an SDK lane that both need an API lane)
in this graph. You do not need to. A clean diff per PR comes from the PR base, not the graph
shape. A stacked branch contains every commit below it, and GitHub shows only the delta
against the base you set. Put all lanes in one linear stack in dependency order, and set each
PR's base to the branch directly below it. Order independent lanes to reduce conflicts. Lanes
that touch separate files, such as `web/**` and `api/**`, can sit anywhere in the line.

- Reorder with `but move <branch> -A <target-branch>`, which stacks `<branch>` on top of
  `<target-branch>`. Use `but move <branch> --unstack` to make it a parallel stack. `-B` only
  works for commits and committed files, not branches. Run `but oplog snapshot -m "..."` first.
- Check the line by diffing. For each branch, run `git diff --name-only <base>..<branch>`,
  where `<base>` is the branch below it. The list must hold exactly that lane's files. If a
  lower lane's files show up, the order is wrong. Move the branch and diff again.
- A branch moved to its own parallel stack (base main) gives a wrong diff against an ancestor
  branch. `git diff <ancestor>..<branch>` shows the ancestor's own changes in reverse, because
  their merge base is main. This tells you the branch must be stacked, not parallel.
- Set PR bases to match. The bottom lane uses `--base main` (or the open release branch).
  Every other lane uses `--base <branch-below-it>`.

## Gotchas

- **Merge commits collapse a series.** See the rebase rule in `AGENTS.md`. When you unapply
  and apply a stack whose branches are joined by merge commits, it can collapse to one series
  at the tip. The middle branches then stop accepting commits. Do not sync a lane that is
  behind with `but unapply`, `git branch -f <b> origin/<b>`, `but apply`. Pointing a series at
  a merge-based remote ref flattens the stack. Use `but oplog restore` to get the series back.
- **`but pull` rebases applied branches onto the target branch.** It does not move a series
  to `origin/<that-branch>`.
- **A dropped hunk can damage the working tree, not only the commit.** After a "Some
  selected changes could not be committed" warning, check the file in the tree. The reconcile
  step can rewrite the working copy and lose the uncommitted hunks. Each oplog entry stores
  the worktree, so recover the exact bytes with
  `git cat-file -p <oplog-sha>:worktree/<path>`.
- **Put a file on the lane whose commits own its line regions.** If the edits sit in regions
  that a higher lane's commit created, a commit to the lower lane drops them, and
  `but absorb` amends the higher lane's commit anyway. An absorb that amends a lower commit
  can leave a conflicted commit above it. If that happens, restore the snapshot instead of
  uncommitting around it. Keep code and its tests on the lane that attribution chooses.
- **Put a test on the lane where all its symbols first exist.** A test that drives two
  halves (a DAO and its wrapper, an API parser and the SDK catalog) fails on every lane
  between them if it lands below the upper half. A green local run proves nothing, because
  the working tree has all lanes applied. Before you land a new test file, find the lowest
  lane whose tip contains every symbol the test uses, and put the test there.
- **Remote-tracking refs can be stale after `but push`.** `git show origin/<branch>:<file>`
  can show old content after the push landed. Check pushes only with `git ls-remote` against
  `git rev-parse <branch>`, and read remote content through the commit object.
