# GitButler Recovery Runbook

This runbook captures the lessons from the agent-workflows reconcile on 2026-06-24
(multiple stacked PRs, hunk locks, stale local GitButler branches, remote PR repair, an
already-merged UI branch that was not actually present in the target, and a final clean
sync to `origin/big-agents`), and from the workspace-wedge incident on 2026-07-11 (a
saturated 30-lane workspace, a stale-parent workspace commit, a botched `but oplog
restore`, and two PRs shipped via raw plumbing while `but` was blocked).

## Freeze Rule (read first)

The moment the workspace looks wedged, stop. Run no `but` mutation of any kind, not even
`but branch new`, until the wedge is diagnosed.

Wedge signatures:

- `but pull` reports a failed integration, or `completed_with_conflicts` naming a lane
  that has no way to conflict (e.g. one with zero commits).
- `Could not find branch CLI id '' in IdMap`.
- Any conflict message that attributes the conflict to a lane that cannot conflict.

On 2026-07-11 a `but branch new` issued while the workspace was wedged created phantom
commits, a junk local ref at the wrong SHA, and a 47-parent display corruption in `but
status`. Retrying or "working around" a wedge with another `but` write compounds the
damage every time. Diagnose using section 4 below. If work must ship while the wedge is
still unresolved, use the plumbing escape hatch in section 12 instead of any `but`
command.

Keep applied lanes to about 15 or fewer before pulling. `but pull` against a heavily
saturated workspace (~30 applied lanes) is what triggers open GitButler integration bugs
(#11364, #14497, #12355) in the first place; unapply idle lanes before pulling. Upgrading
GitButler does not help; these bugs are open as of 0.21.0.

## 1. Work From Ground Truth

Do not trust one source of truth when GitButler is tangled.

Use three views:

- Local GitButler state: `but status --json -f`
- Pull feasibility: `but pull --check --json`
- Remote PR/branch state: GitHub app or `gh api`

For each relevant PR, record:

- PR number, base, head, state, merged flag
- head SHA and merge commit SHA if merged
- compare status: ahead/behind/diverged
- changed file list

For the target branch, record:

- remote head SHA
- local GitButler `mergeBase`
- `upstreamState.behind`

## 2. Respect GitButler's Model

GitButler has three different surfaces:

- committed branch/stack changes
- assigned/unassigned working tree changes
- the projected workspace graph

Do not assume a file showing as unassigned means "new work." It can be a projection artifact
after the target branch moved.

Rules:

- One `but` write at a time.
- Do not run `but status`, `but discard`, `but branch delete`, or `but pull` in parallel
  with another `but` write.
- After a DB-lock error, serialize all later GitButler operations.
- Prefer JSON output and narrow it with `jq`.
- Never repeat a failed topology operation blindly.

## 3. Hunk Locks and Empty Commits

Symptoms:

- `but commit <lane> -p <id>` creates an empty commit.
- `but amend <id> <commit>` says it succeeded, but the file remains changed.
- The same file has base lines from one stack and replacement lines from a sibling stack.

Diagnosis:

- The hunk belongs to a sibling lane according to GitButler's dependency model.
- The intended target lane cannot accept it until the sibling's commits are in the base.

Resolution:

1. Stop retrying commits.
2. Preserve state with `but oplog snapshot`.
3. Merge the sibling/owner PRs into the target branch in dependency order.
4. Pull/update the target branch.
5. Re-check whether the hunk is still an unassigned change.
6. If it remains and is truly not in the target branch, land it as a follow-up from the new
   base.

This is a hunk-dependency issue, not a wedge. If instead every topology operation fails
cherry-picking the workspace commit itself, see section 4.

## 4. Wedged Workspace: Stale-Parent Workspace Commit Signature

GitButler tracks the workspace as a synthetic "GitButler Workspace Commit" that merges
every applied lane. That commit can carry stale parents left over from an old projection.
When it does, every topology operation (apply, unapply, commit, pull) fails cherry-picking
it, with an error like:

```text
Failed to merge bases while cherry picking commit <sha>
```

This is the signature of a stale-parent wedge, distinct from an ordinary hunk lock
(section 3) or a genuine file conflict.

A `but pull` can report an error and still have advanced the base underneath it. Do not
trust the error text alone. Check:

```bash
but status --json -f | jq '.mergeBase, .upstreamState'
```

If `mergeBase.commitId` already equals the remote target branch SHA, the pull's
integration step (not the fetch/merge step) is what failed, and the fix is narrower than
it looks.

Fix, only after securing uncommitted work (section 11):

1. Snapshot: `but oplog snapshot -m "before workspace-commit rebuild"`.
2. Confirm every agent's uncommitted changes are backed up (section 11). A workspace-commit
   rebuild can touch the working tree.
3. Rebuild the workspace commit so it no longer carries the stale parents. This is a
   GitButler-internal repair; do not attempt it by hand-editing refs. If the installed
   GitButler CLI has no direct "rebuild workspace commit" command, unapply every lane,
   confirm the workspace commit is gone, then re-apply lanes one at a time, verifying `but
   status` after each.
4. Re-run `but pull --check --json` and confirm it completes without the cherry-pick error
   before resuming normal work.

If step 3 does not clear the wedge, stop using `but` and fall back to the plumbing escape
hatch (section 12) to keep shipping work while a human or GitButler support resolves the
underlying repo state.

## 5. Repairing a Dirty Remote PR Branch

When a PR branch is stale/diverged but the local workspace contains the intended file
contents, the safest remote repair is:

1. Compare `base...head` to get the PR's file set.
2. Create a new tree from the current base branch tree.
3. For each PR file, use the verified local content, or remote head content if local does
   not exist.
4. Create one new commit parented on the current base.
5. Force-update the PR branch ref to that commit.
6. Verify every changed remote file matches local content.
7. Merge the PR with an expected head SHA.

This is remote API work. It avoids local GitButler topology surgery. Use the GitHub app
where possible; use `gh api` when the connector does not expose tree/ref operations.

Guardrails:

- Snapshot before remote branch rewrites.
- Only rewrite branches owned by this workspace/effort.
- Do not force-update a branch if another human/session owns it and its contents are
  unknown.
- Verify file contents after the rewrite before merging.

## 6. Handling "Merged" Branches That Did Not Land Expected Files

A PR can be closed/merged while the current target branch still lacks expected files due to
stacking, wrong base, branch replacement, or later graph movement.

Check representative files directly on the target branch:

```bash
gh api repos/<owner>/<repo>/contents/<path>?ref=<target>
```

If missing:

1. Compare target branch against the source branch.
2. Rebuild a fresh reconciliation branch from the current target.
3. Add the exact intended file set from the local workspace or source branch.
4. Open/merge a small restore PR.

In the incident, Arda's UI branch was marked merged, but `big-agents` missed 77 UI/RAG
files. The fix was a new restore PR built from current `big-agents` with those 77 files,
then merged last.

## 7. Clearing Redundant Unassigned Overlays

After remote PRs merge and the base moves, GitButler may still show the old local file
contents as unassigned changes. If those file contents are already in the new target
branch, discard the overlay.

Safe proof:

1. Fetch the target branch tree through GitHub API.
2. Compute each local file's Git blob SHA:

```text
sha1("blob <byte_length>\\0" + bytes)
```

3. Compare against the target tree blob SHA.
4. Only discard unassigned IDs where local blob SHA equals target blob SHA.
5. Leave local-only coordination files or hook wrappers for a final decision.

Discard through GitButler:

```bash
but discard <cli-id>
```

Run this serially, one ID at a time. Recompute `but status --json` between discards
because IDs can change, and because a discard can cascade beyond the single ID named (see
section 13).

## 8. Final Pull and Stale Branch Cleanup

Preferred flow:

1. `but oplog snapshot -m "before final pull"`
2. `but pull --check --json`
3. If no worktree conflicts: `but pull --json`
4. Inspect the result.

If `but pull` reports `completed_with_conflicts` but:

- `conflicts` contains only a stale branch with no files, and
- `but status` shows `upstreamState.behind == 0`, and
- `mergeBase` equals remote target head,

then the base update likely succeeded. Delete the stale local branch:

```bash
but branch delete <merged-stale-branch>
```

If delete fails before the pull because of overlays, clear redundant overlays first, then
retry after the base update.

If instead `but status` shows the cherry-pick failure described in section 4, this is a
stale-parent wedge, not a normal stale-branch case; follow section 4, not this section.

## 9. GitButler Hook Noise

GitButler may modify `.husky/pre-commit`, `.husky/post-checkout`, and create
`*-user` hook files while managing the workspace branch. Treat these as local GitButler
runtime noise unless the task explicitly concerns hooks.

At the end, if they are the only remaining unassigned changes and the user did not ask to
commit them, discard them with `but discard <id>`.

## 10. Coordination Files and Locks

If a coordination file has a `BUT-LOCK`:

- Set it before risky `but` writes.
- Refresh it for long operations.
- Release it when done.
- If the remote file already says `FREE` and the local edit only contains stale local
  chatter, discard the local file after release.

Do not leave a stale local lock as the final state.

## 11. Before Any `but oplog restore`: Back Up Uncommitted Work

`but oplog restore` rewinds the entire workspace, including every agent's UNCOMMITTED
working-tree content, to the snapshot's state. On 2026-07-11 this wiped other agents'
in-flight files twice, because the restoring agent had not accounted for concurrent work.

Mandatory sequence before any `but oplog restore`:

1. Freeze all agents' tree writes. Confirm on the coordination board (or directly) that no
   other agent is mid-edit.
2. List every modified and untracked file: `git status --porcelain`.
3. Back up each listed file to a tmp directory, preserving relative paths, before running
   the restore. A flat loop over the `git status --porcelain` list that copies each path
   into a tmp directory is enough; the point is a copy that exists outside the working tree
   GitButler is about to rewind.
4. Run `but oplog restore <snapshot-id>`.
5. Diff the backup against the restored working tree. Re-apply any content that the
   restore discarded and that still belongs in the tree.

Skipping steps 1-3 is what caused the data loss. Treat them as non-optional even under
time pressure.

## 12. Escape Hatch: Publish via Plumbing When `but` Is Blocked

When the workspace is wedged (section 4) or otherwise blocked and work needs to ship,
build and push a commit with raw `git` plumbing against a temporary index. This never
touches the real index, never moves local refs, and never invokes `but`, so it cannot make
the wedge worse.

```bash
export GIT_INDEX_FILE=$(mktemp)
git read-tree <remote-tip-or-base-sha>      # seed the temp index from a known-good tree
# for each changed file:
blob=$(git hash-object -w <path>)
git update-index --add --cacheinfo 100644 "$blob" "<path>"
tree=$(git write-tree)
commit=$(git commit-tree "$tree" -p <parent-sha> -m "<message>")
git push --no-verify origin "$commit":refs/heads/<branch>
unset GIT_INDEX_FILE
```

Rules:

- Use the remote tip (or the intended base branch) as the `read-tree` source, never the
  local working directory's HEAD; the point is to build the tree from known-good state
  plus the specific files you intend to change.
- Never move a local ref (no `git update-ref`, no `git branch -f`) and never touch the
  real index. Confirm `GIT_INDEX_FILE` is set to the temp file before any `git
  update-index` or `git write-tree` call, and `unset` it immediately after.
- Verify the push landed: `git ls-remote --heads origin <branch>` must equal `<commit>`.
- This is a publishing escape hatch, not a wedge fix. It gets a PR out; it does not repair
  the workspace. Still follow section 4 (or ask a human) to clear the underlying wedge.

This recipe shipped two PRs on 2026-07-11 while the workspace was blocked by a
stale-parent wedge.

## 13. `but clean` and `but discard` Cascade Cautions

`but clean` must never run when any applied lane has zero commits. GitButler can
attribute an empty lane's placeholder state to "nothing to keep" and sweep the lane
itself, not just stray files. Before running `but clean`, check `but status --json -f`
for any stack with `commits | length == 0` and either commit or unapply that lane first.

`but discard` can cascade further than the single ID it names. Discarding one path can
pull in dozens of dependent items under GitButler's hunk-dependency model, including
protected or coordination files you did not intend to touch. Before discarding:

1. Run the discard in isolation, one ID at a time, never as a batch.
2. Check what the discard actually claims to remove (GitButler reports the affected set)
   before confirming.
3. Re-run `but status --json -f` immediately after each discard to confirm nothing besides
   the intended ID changed.

Section 7 (clearing redundant unassigned overlays) already requires serial discards for
this reason; the same caution applies to any other use of `but discard`.

## 14. Success Checklist

Remote:

- All intended PRs are merged or intentionally left open.
- Target branch contains the expected representative files.
- Target branch SHA is recorded.

Local:

- `but status --json -f` has `unassignedChanges | length == 0`.
- `upstreamState.behind == 0`.
- `mergeBase.commitId == <remote target SHA>`.
- `stacks | length == 0`, unless the user intentionally wants active lanes left applied.

Communication:

- Report merged PRs and SHAs.
- Report final GitButler state.
- Report tests and known gaps.
- Report snapshot IDs if risky operations were performed.

## 15. Commands Worth Memorizing

Status summary:

```bash
but status --json -f
```

Pull dry-run:

```bash
but pull --check --json
```

Snapshot:

```bash
but oplog snapshot -m "before <operation>"
```

Restore (back up uncommitted work first — section 11):

```bash
but oplog restore <snapshot-id>
```

Undo last operation:

```bash
but undo
```

Unapply an idle lane before a pull, to keep applied lanes under the ~15 threshold:

```bash
but unapply <branch>
```

Delete stale local branch after it is merged remotely:

```bash
but branch delete <branch>
```

Discard a proven-redundant unassigned change (one at a time — section 13):

```bash
but discard <cli-id>
```

Plumbing escape hatch when `but` is blocked: section 12.
