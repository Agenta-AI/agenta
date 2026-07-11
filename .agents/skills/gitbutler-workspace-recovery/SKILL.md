---
name: gitbutler-workspace-recovery
description: Recover, reconcile, and operate safely in a GitButler workspace. Use when Codex is in `gitbutler/workspace`, the user says to use GitButler only, local lanes/stacks diverge from remote PR branches, merged PR changes still appear as unassigned changes, `but pull` reports conflicts, the workspace looks wedged, GitButler hunk locks or empty commits appear, or a multi-agent GitButler workflow needs coordination, cleanup, sync, or PR repair.
---

# GitButler Workspace Recovery

Use this skill when the repo is in GitButler workspace mode and correctness matters more
than speed. The main goals are:

- Preserve every intended local change.
- Avoid clobbering other lanes or PR branches.
- Keep the local GitButler workspace, remote PR branches, and target branch in sync.
- Recover safely from hunk locks, stale local branches, duplicate-stack graph issues, and
  redundant unassigned overlays.

For the full incident-derived runbook, read
[references/recovery-runbook.md](references/recovery-runbook.md) when doing an actual
repair or merge/sync operation.

## Freeze Rule (read first)

The moment the workspace looks wedged, stop. Run no `but` mutation of any kind, not even
`but branch new`, until the wedge is diagnosed.

Wedge signatures:

- `but pull` reports a failed integration, or `completed_with_conflicts` naming a lane that
  has no way to conflict (e.g. one with zero commits).
- `Could not find branch CLI id '' in IdMap`.
- Any conflict message that attributes the conflict to a lane that cannot conflict.

On 2026-07-11 a `but branch new` issued while the workspace was wedged created phantom
commits, a junk local ref at the wrong SHA, and a 47-parent display corruption in `but
status`. Retrying or "working around" a wedge with another `but` write compounds the
damage every time. Diagnose first using
[references/recovery-runbook.md](references/recovery-runbook.md) section 4. If work must
ship while the wedge is still unresolved, use the plumbing escape hatch (runbook section
12) instead of any `but` command.

Also keep applied lanes to about 15 or fewer before pulling; `but pull` against a heavily
saturated workspace (~30 applied lanes) is what triggers these wedges in the first place.
See root `AGENTS.md`, "Wedge prevention and freeze rule".

## Non-Negotiables

- Use `but` for local VCS operations in GitButler workspace mode.
- Do not use raw `git commit`, `git reset`, branch switching, or worktrees unless the user
  explicitly overrides the GitButler-only rule. The one exception is the plumbing escape
  hatch (runbook section 12), which exists precisely for when `but` itself is blocked.
- Serialize GitButler writes. Do not run `but` writes in parallel. GitButler can lock its
  local DB, and parallel writes make diagnosis worse.
- Take an oplog snapshot before any risky operation:

```bash
but oplog snapshot -m "before <operation>"
```

- Prefer `but pull --check --json` before `but pull --json`.
- Treat `but discard <id>` as destructive: it can cascade to items beyond the one ID named.
  Only discard after proving the content is already present in the target/base or is
  intentionally local-only noise, and never as a batch (runbook section 13).
- Never run `but clean` while any applied lane has zero commits; it can sweep the lane
  itself (runbook section 13).
- Before any `but oplog restore`, back up every agent's uncommitted work first (runbook
  section 11). A restore rewinds uncommitted content for the whole workspace, not just the
  operator's own changes.
- If a coordination file has a lock protocol, honor it. Release locks when done.

## Fast Orientation

Start with these checks:

```bash
but status --json -f
but pull --check --json
```

If GitHub remote state matters, use the GitHub app or `gh api` for PR/branch reads. That
is remote API work, not local VCS work. Verify:

- target branch head (`big-agents`, `main`, etc.)
- each PR state/head/base/mergeability
- compare result for `base...head`
- whether a PR marked "merged" actually put the expected files in the target branch

## Common Failure Patterns

### Wedged Workspace: Stale-Parent Workspace Commit

If every topology operation (apply, unapply, commit, pull) fails cherry-picking the
synthetic "GitButler Workspace Commit" (`Failed to merge bases while cherry picking commit
...`), this is a stale-parent wedge, not a hunk lock or a real file conflict. Stop per the
Freeze Rule above and follow
[references/recovery-runbook.md](references/recovery-runbook.md) section 4. Note that a
`but pull` can report an error while the base has still advanced underneath it; check
`mergeBase` before assuming the pull did nothing.

### Empty GitButler Commits

If `but commit`, `but amend`, or `but rub` creates an empty commit while the file still
shows as changed, suspect a hunk lock to a sibling stack. Do not keep retrying.

Actions:

1. Check `but status --json -f` for assigned/unassigned ownership.
2. Compare the file's base lines against sibling lanes.
3. If the hunk depends on a sibling stack, land or merge the owning PR first, then reapply
   the orphan hunk after the base contains the dependency.

### Remote PR Fixed, Local Branch Still Dirty

If you repair or rebuild a PR branch remotely, the local GitButler branch may become stale
and un-rebasable. Once that PR is merged into the target branch, the stale local branch is
safe to delete from the workspace only after confirming its content is in the target.

Useful sequence:

```bash
but pull --check --json
but oplog snapshot -m "before removing stale merged branch"
but branch delete <branch>
but pull --json
```

If delete fails before pull because of worktree overlays, see the full runbook.

### Merged Remote Changes Still Show as Unassigned

After the target branch advances, GitButler can show many unassigned changes that are
byte-for-byte identical to the new target branch. This is a redundant overlay, not new
work. Prove it by comparing local blob hashes to the target branch tree, then discard only
matching `but status` IDs, one at a time (see the discard caution above and runbook
section 13). Leave local-only coordination files alone until the end.

### `but pull` Says `completed_with_conflicts`

Read the JSON. If it lists no file conflicts and one stale branch as
`conflicted_not_rebasable`, the base may still have advanced successfully. Check:

```bash
but status --json -f
```

If `mergeBase` equals the remote target head and `behind` is `0`, delete the stale branch
afterward. If instead the conflict is attributed to a lane that cannot conflict, treat it
as a stale-parent wedge (section above) rather than a normal conflict.

## Verification Bar

Before declaring success:

- `but status --json -f` shows `upstreamState.behind == 0`.
- `mergeBase.commitId` equals the remote target branch SHA.
- `unassignedChanges` is empty or only intentional local files remain.
- `stacks` is empty, or only intentionally active lanes remain.
- Every relevant PR is closed/merged or explicitly left open with a reason.
- Any coordination lock is released.

## Communication

Report concrete state, not vibes:

- PR numbers and merge SHAs.
- target branch SHA.
- GitButler `mergeBase`, `behind`, unassigned count, and stack count.
- Tests run and their result.
- Restore points (`but oplog snapshot` IDs) for risky operations.
