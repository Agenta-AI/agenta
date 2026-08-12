# Workstreams

One pair of files per work package: `specs-wp{k}.md` (what to build) and `tasks-wp{k}.md`
(the ordered checklist). They exist so a package can be handed to someone — or to an agent in
its own worktree — with no context beyond `v1/`.

`specs-*` states the target. `tasks-*` is a working document: check items off, add what was
missed. Neither carries history; the design documents in `v1/` remain the source of truth,
and a spec that disagrees with them is a bug in the spec.

**Status: not yet written.** `plan.md` carries candidate packages, and they will not survive
contact with `entities.md` and `policy.md` unchanged. Writing specs now would mean rewriting
them.

## The base

Everything branches from the **current upstream release branch**, not `main` and not a fork.
That is where this org integrates: feature PRs squash-merge onto the release branch, and the
release branch merges into `main` as a true merge commit. The two diverge, so this is a real
choice rather than a detail.

Re-read the release branch name when starting — it advances. Check the migration head before
branching; if it is not what a spec assumes, the base is wrong and every revision number
shifts.

## Working in parallel

Every package runs in its **own git worktree**, branched from the same base, and merges back
through review. `plan.md` says what needs what; this section says how to start before a
dependency is finished.

### Stubs first, on the shared branch

The dependencies between these packages are almost entirely **interface** dependencies. So the
interfaces land first, on the base branch, before any worktree starts:

1. **Seed commit** — the credential resolution signature, the adapter ports, and the domain
   exceptions, all declared and all raising not-implemented.
2. **Every worktree branches from that commit.** A package that depends on another codes
   against the stub and never waits.
3. **The owner of each stub fills it in** in their own worktree. Nobody edits a file they do
   not own.

The seed commit is why light dependencies do not serialise, and it is the one thing that must
be right before anything starts.

**The critical part of the seed is the credential lookup signature.** It must take the owner
as a parameter from the outset even while the only answer is the project. Every package that
resolves a credential inherits it, and retrofitting it later means touching all of them.

## File ownership

*To establish* once packages firm up. The rule that matters: one owner per file, and a
package that needs to change another package's file coordinates rather than edits.

## Stacked branches

A stack here is linear. A dependency fan-out is expressed through **PR bases**, not graph
shape: put everything in one line in dependency order and set each PR's base to the branch
below it, so each PR shows only its own diff. Lanes touching disjoint files can sit anywhere
in the line.

Verify the line by diffing each branch against the one below it — the file list must be
exactly that lane's files — rather than by eyeballing the tree.
