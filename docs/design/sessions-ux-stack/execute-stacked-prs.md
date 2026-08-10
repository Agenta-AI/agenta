# Execute: stacked draft PRs for the sessions-UX work onto `release/v0.112.0`

Read this whole file before running anything. Read the root `AGENTS.md` section
**"Spreading a pile of edits back across an existing stack"** too — its warnings are load-bearing.

Every shell block below opens with `set -euo pipefail` so a failing command stops the block instead
of letting the next step run on a half-built state. **Save each block to a file and run it with
`bash <file>`** — pasting `set -e` into an interactive shell means the first failure closes your
session.

## Verified state (2026-08-10, re-verify before you start)

| fact | value |
|---|---|
| worktree | `.claude/worktrees/sessions-ux`, branch `pkg/settings-spine` |
| backup ref | **`backup/pre-stack-112`** already exists at the current tip — do not delete |
| target | `origin/release/v0.112.0` = PR **#5827**, OPEN, → `main` |
| tip merged into 112 | **zero conflicts** (`git merge-tree` clean) |
| commits not yet in 112 | **83** |
| working tree | clean except untracked `docs/design/sessions-ux-stack/` |

### The thing that invalidates the old lane table

Four lanes are **already merged into `release/v0.112.0`** under names that differ from the local
branches:

`pkg/ui-surfaces` · `pkg/sessions` · `pkg/sessions-ui` · `pkg/entity-ui-agent`

All four are ancestors of 112 and 0 commits ahead. That is why `pkg/auth` shrank from 11 commits
to 1 the moment origin was refetched — most of its content is already in.

**So the lane table in `restack-onto-112.md` is stale.** Do not cherry-pick from it blind: you
will open PRs whose diffs are already merged, on a release branch other people are assembling,
and CodeRabbit will review the duplicates. Phase 1 exists to rebuild that table from fact.

## Phase 0 — confirm nothing moved

```bash
set -euo pipefail
cd .claude/worktrees/sessions-ux
git fetch origin release/v0.112.0 main
git rev-parse --verify "backup/pre-stack-112^{commit}"  # must exist; aborts here if it doesn't
git status --porcelain                                  # only the untracked docs dir
git rev-list --count origin/release/v0.112.0..HEAD      # 83, or re-derive everything
```

`git rev-list --count`, not `git log | wc -l`: a pipeline reports `wc`'s status, so a `git log`
that fails still prints a plausible number and the check reads as passing.

If the count differs from 83, more has landed; redo Phase 1 from scratch rather than adjusting.

## Phase 1 — rebuild the lane table from fact

For every local lane branch, find what it still contributes:

```bash
set -euo pipefail
for b in pkg/auth pkg/navigation pkg/navigation-ui pkg/ui-primitives pkg/session-surfaces \
         pkg/chat-engine oss/chat-on-shared-engine mobile/chat-and-shell playground/de-antd \
         pkg/ui-styles pkg/observability pkg/entities-drive pkg/entity-ui-drive \
         pkg/navigation-shell pkg/sessions-tabs pkg/home-ui oss/wire-up \
         mobile/agents-templates-settings pkg/agent-overview-layout pkg/agent-overview-body; do
  if git rev-parse --verify -q "refs/heads/$b" >/dev/null; then
    printf "%-38s %s\n" "$b" "$(git rev-list --count "origin/release/v0.112.0..$b")"
  else
    printf "%-38s %s\n" "$b" "ABSENT"        # a missing branch is a finding, not a zero
  fi
done
```

Drop every lane with 0. For the rest, list the surviving commits
(`git log --oneline origin/release/v0.112.0..<lane>`) and record which files each touches
(`git show --stat`). **Trust the file lists, not the commit subjects** — the previous mapping was
built from subjects and that is exactly where it went wrong.

Then map this session's commits onto lanes. **Never select them by count or offset** ("the newest
50"): one commit added, amended or reordered by another agent shifts every index, and the range
silently picks up unrelated commits while dropping session ones.

Pin the boundary by SHA instead, once, before anything moves. The previous carve stopped at the
highest lane branch that already exists, so that ref *is* the boundary:

```bash
set -euo pipefail
base=$(git rev-parse origin/release/v0.112.0)
tip=$(git rev-parse HEAD)                      # write these two SHAs down; they are the contract
boundary=$(git rev-parse pkg/agent-overview-body)   # highest pre-existing lane from Phase 1
git merge-base --is-ancestor "$boundary" "$tip"     # fails loudly if it is not on this line
git merge-base --is-ancestor "$base" "$boundary"    # …and that the line starts at 112

git log --oneline "$boundary..$tip"            # this session's commits — stable under reordering
git rev-list --count "$boundary..$tip"
```

Cross-check that list against the SHA table in `restack-onto-112.md` (validate each with
`git rev-parse --verify '<sha>^{commit}'` — one entry there was malformed). Treat the grouping in
that doc as a hypothesis to check per commit, not as truth.

**Their commits are not contiguous.** You cannot cut this history at branch points; you must
cherry-pick per lane. If a subject-based selection is unavoidable, use `git log --grep` with an
anchored pattern and print the resulting SHAs — never a positional slice.

## Phase 2 — build the lanes

One linear line, each lane on top of the one below:

Most of these lane names **already exist locally** (Phase 1 will show you which). `git checkout -b`
fails on an existing name and `-B` silently discards whatever it pointed at — so neither is safe on
its own. The semantics chosen here are **refuse, never reset**: an existing lane branch is a signal
that the lane may already be built, and re-deriving it blind is how work gets lost.

```bash
set -euo pipefail
base=origin/release/v0.112.0

new_lane () {                       # refuse to clobber; the operator decides what to do
  local lane=$1 start=$2
  if git rev-parse --verify -q "refs/heads/$lane" >/dev/null; then
    echo "refusing: $lane already exists at $(git rev-parse --short "$lane")." >&2
    echo "  inspect it first — the lane may already be correct." >&2
    echo "  to rebuild deliberately: git branch backup/$lane $lane && git branch -D $lane" >&2
    return 1
  fi
  git checkout -b "$lane" "$start"
}

new_lane <lane-1> "$base"
git cherry-pick <its commits, oldest first>
# verify, then
new_lane <lane-2> <lane-1>
...
```

Every deletion goes through a `backup/<lane>` ref first. That is what made this session recoverable
(see `backup/pre-stack-112` in Phase 0) and it costs nothing.

After **every** lane, before moving on:

```bash
set -euo pipefail
git diff --name-only <lane-below>..<lane>   # exactly this lane's files, nothing from below
```

If a lower lane's file appears, the order is wrong. Fix it there and then — it compounds upward.

### Commits that span two lanes

Some commits touch a package **and** `web/mobile` (`fd30503` adds the Domains and SSO sections
*and* wires them into `/m`). Do not split hunks. Use sequential working-tree states: make the file
the lower lane's version and commit that; then edit to add the upper lane's delta and commit it
there. If a split is not worth the effort, put the whole commit in the **upper** lane and say so in
the PR body — a package change riding with its consumer is honest; a half-applied commit is not.

## Phase 3 — gates, before anything is pushed

```bash
set -euo pipefail
cd web
pnpm lint-fix                                   # 24/24
for p in @agenta/shared @agenta/ui @agenta/entities @agenta/entity-ui @agenta/settings-ui \
         @agenta/oss @agenta/ee @agenta/mobile; do
  echo "== $p"
  pnpm --filter "$p" exec tsc --noEmit          # non-zero exit aborts the whole gate
done
echo "typecheck clean for all 8 packages"
```

**Run `tsc` directly; never `$(… | grep -c 'error TS')`.** Inside a command substitution the
pipeline's status is `grep`'s, so `pnpm` failing for any reason that isn't a type error — bad
filter, missing package, OOM, a crashed compiler — prints `0` and the gate reads as green. The
`echo "== $p"` before each run is there so a failure tells you *which* package stopped it.

Run `lint-fix` **before** staging, not after committing. Prettier reflows imports once a
specifier changes length, and a stray reformat on a lower lane shows up in every lane above it.

## Phase 4 — push and open the PRs, bottom-up

Do the bottom lane end-to-end first and check it on GitHub before doing the rest.

```bash
set -euo pipefail
git push -u origin <lane>
# `git push` prints nothing useful on success — prove it landed before opening the PR.
# Compare SHAs against ls-remote; never against the remote-tracking ref, which goes stale.
local_sha=$(git rev-parse <lane>)
remote_sha=$(git ls-remote --heads origin <lane> | awk '{print $1}')
test -n "$remote_sha" && test "$local_sha" = "$remote_sha"

body=$(mktemp)
trap 'rm -f "$body"' EXIT
cat > "$body" <<'BODY'
<what this lane does, and why it is its own lane>

Stacked on `<lane-below>`; review only this lane's diff.
BODY

gh pr create --draft \
  --base <lane-below-or-release/v0.112.0> \
  --head <lane> \
  --title "<type>(<area>): <what changed>" \
  --body-file "$body"

gh pr comment <number> --body "@coderabbitai review"
```

The body goes through a temp file, not `--body-file <(cat <<'BODY' … )`. A heredoc inside a
process substitution **does not parse under bash 3.2**, which is what `/bin/bash` still is on
macOS — `unexpected EOF while looking for matching`. The `mktemp` form parses under bash 3.2,
bash 5 and zsh alike.

- **Every PR is a draft.** `--draft` on create; do not mark ready.
- **Bottom lane's base is `release/v0.112.0`**, every other lane's base is the lane directly
  below it. Wrong bases turn each PR into a diff of the whole stack.
- **Comment `@coderabbitai review` under each** after creating it.
- Title convention is in the root `AGENTS.md`; the `write-pr-description` skill has the body
  format. Never put "Claude", "Anthropic" or `Co-Authored-By` in a commit or PR.

## Phase 5 — verify the stack on GitHub

For each PR, the **Files changed** tab must show only that lane's files. If it shows the lane
below's too, the base is wrong — no need to re-push, just repoint the PR:

```bash
set -euo pipefail
gh api -X PATCH repos/:owner/:repo/pulls/<n> -f base=<correct-lane-below>
```

**Do not use `gh pr edit`.** It fails on this repo with a GraphQL error about Projects (classic)
being deprecated (`repository.pullRequest.projectCards`), and it fails the same way for `--base`,
`--title` and `--body`. The REST route above is the working path for all three (`-f title=…`,
`-f body=…`). This is recorded repo knowledge, not a preference.

## Known traps from the session that produced this

- **`git checkout <stash> -- <path>` applies the stash's whole tree, not its diff.** That stash
  sits on a divergent parent; doing this reverted 276 files and deleted a directory another agent
  had just added. To apply a stash's changes, use `git diff <stash>^ <stash> -- <paths>` and
  `git apply --3way`.
- **That diff covers tracked files only — untracked files live in the stash's *third parent*.**
  `git stash push -u` builds a commit with up to three parents: `^1` = HEAD, `^2` = the index,
  `^3` = the untracked files. `git diff <stash>^ <stash>` and `git checkout <stash> -- <paths>`
  both miss `^3` entirely, so anything that was untracked comes back silently absent — which is
  exactly how `docs/design/sessions-ux-stack/` was nearly lost. Restore in two steps:

  ```bash
  set -euo pipefail
  stash=stash@{0}
  git diff "$stash^" "$stash" -- <tracked-paths> | git apply --3way   # tracked
  if git rev-parse --verify -q "$stash^3" >/dev/null; then            # untracked, if any
    git checkout "$stash^3" -- <untracked-paths>
  fi
  git status --porcelain -- <all-paths>                               # eyeball the result
  ```

  `git rev-parse --verify "$stash^3"` failing is meaningful: it means the stash was taken without
  `-u`, so there are no untracked files to recover. Never assume — check. Same trap, same fix, in
  the root `AGENTS.md` §"Spreading a pile of edits back across an existing stack".
- **`rebase -i` / `add -i` are unavailable here.** To fold a change into a non-tip commit:
  `git reset --soft HEAD~1`, unstage what does not belong, `git add` what does,
  `git commit --amend --no-edit`, then recreate the dropped commit.
- **`but rub` / `but absorb` mis-route against a live working tree** — new files go to the topmost
  lane, unattributable hunks go to the docs lane, multi-hunk files commit partially with a warning
  that is easy to miss. Use stash isolation.
- **A green `tsc` does not mean an edit landed.** A string-replace that matches nothing is a
  silent no-op and the gates still pass. Grep the file back after scripted edits.

## Two things that are not verified

1. **Nothing in this stack has been run in a browser.** The `@rc-component/form` migration
   (`e2db4ba`) touches the elicitation form the chat runtime drives; the `/m` write sheets call
   real mutation endpoints. Static gates only. Say so in the PR bodies.
2. `web/packages/agenta-sessions/test-results/junit.xml` is **tracked**, so every test run dirties
   the tree. It should be untracked and gitignored — worth a separate small PR, not smuggled into
   a lane.

## Housekeeping

`docs/design/sessions-ux-stack/` is untracked. That is how these docs got swept into a
`git stash -u` and nearly lost once already. Commit them — probably on the bottom lane.

---

## Outcome (executed 2026-08-10)

### What Phase 1 actually found

The premise of Phases 2 and 3 was wrong in our favour: **the stack was already built.** All 83
commits sat on a single linear chain (no merge commits) with `origin/release/v0.112.0` as an
*ancestor* of the tip, and 29 local lane branches already pointed at the right cut points. Nothing
needed cherry-picking; Phase 2 collapsed into "verify the chain".

Two claims in the doc above were re-checked and corrected:

- **`pkg/ui-surfaces` · `pkg/sessions` · `pkg/sessions-ui` · `pkg/entity-ui-agent` are merged into
  112 — but only on `origin`.** The remote refs are 0 ahead of 112. The *local* branches of the
  same name are stale, diverged, and not ancestors of the tip. They are dead; ignore them.
- **No commit in the 83 duplicates 112.** `git cherry origin/release/v0.112.0 HEAD` returns 83 `+`
  and 0 `-`. The "PRs whose diffs are already merged" hazard did not materialise.

The lane order that was already in the branches differs from `restack-onto-112.md`'s proposal —
`pkg/settings-spine` sits *below* `pkg/ui-data-table`, not above it, and four proposed lanes
(`pkg/shared-edition-gates`, `pkg/entity-ui-drillin-bridge`, `mobile/settings`,
`mobile/drillin-bridge`) do not exist as branches; their commits were folded into neighbouring
lanes. The branches won; the table in that doc is superseded by the list below.

### The stack as opened

29 draft PRs, `#5865`–`#5893`, bottom to top. Bottom's base is `release/v0.112.0`; every other
lane's base is the lane directly below it. Verified on GitHub: every PR's base is correct, every
PR's changed-file count equals `git diff --name-only <below>..<lane>`, all 29 are drafts, and
`@coderabbitai review` is requested on each.

| PR | lane | commits | files |
|---|---|---|---|
| 5865 | `pkg/auth` | 1 | 49 |
| 5866 | `pkg/navigation` | 1 | 25 |
| 5867 | `pkg/navigation-ui` | 1 | 39 |
| 5868 | `pkg/ui-primitives` | 1 | 10 |
| 5869 | `pkg/session-surfaces` | 1 | 42 |
| 5870 | `pkg/chat-engine` | 1 | 45 |
| 5871 | `oss/chat-on-shared-engine` | 1 | 100 |
| 5872 | `mobile/chat-and-shell` | 1 | 40 |
| 5873 | `playground/de-antd` | 1 | 15 |
| 5874 | `pkg/ui-styles` | 2 | 21 |
| 5875 | `pkg/observability` | 1 | 14 |
| 5876 | `pkg/entities-drive` | 1 | 31 |
| 5877 | `pkg/entity-ui-drive` | 1 | 44 |
| 5878 | `pkg/navigation-shell` | 1 | 20 |
| 5879 | `pkg/sessions-tabs` | 2 | 48 |
| 5880 | `pkg/home-ui` | 1 | 65 |
| 5881 | `oss/wire-up` | 1 | 18 |
| 5882 | `mobile/agents-templates-settings` | 1 | 30 |
| 5883 | `pkg/agent-overview-layout` | 1 | 4 |
| 5884 | `pkg/agent-overview-body` | 8 | 24 |
| 5885 | `pkg/settings-spine` | 12 | 73 |
| 5886 | `pkg/ui-data-table` | 4 | 9 |
| 5887 | `oss/drop-reexport-shims` | 1 | 108 |
| 5888 | `pkg/entities-organization` | 1 | 42 |
| 5889 | `pkg/settings-org-pages` | 8 | 13 |
| 5890 | `pkg/settings-tools-triggers` | 5 | 64 |
| 5891 | `pkg/entity-ui-form-engine` | 1 | 5 |
| 5892 | `pkg/settings-ee-pages` | 12 | 95 |
| 5893 | `pkg/ui-data-table-responsive` | 10 | 88 |

Gates before pushing: `pnpm lint-fix` 24/24 with a clean tree afterwards, and `tsc --noEmit` = 0
errors for `@agenta/shared`, `ui`, `entities`, `entity-ui`, `settings-ui`, `oss`, `ee`, `mobile`.
(`restack-onto-112.md` warned that `@agenta/mobile` had 17 errors from another agent's in-flight
work — that has since settled.)

### New traps found while executing

- **A batch `git push origin <28 refs>` is rejected wholesale with `GH013: Repository rule
  violations`**, with no indication of which rule. The same refs push fine one at a time. Push
  lanes sequentially and verify each with `git ls-remote` before moving on.
- **`gh pr edit` fails on this repo** with a GraphQL error about Projects (classic) being
  deprecated (`repository.pullRequest.projectCards`). To change a PR's base, title or body, use
  the REST route instead: `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -f base=... -f title=...`.

### Still open

- Nothing here has been run in a browser. `#5891` (`SchemaForm`/`SubscriptionForm` onto
  `@rc-component/form`) sits under the elicitation form the chat runtime drives, and `#5892`'s `/m`
  write paths call real mutation endpoints. Both PR bodies say so.
- `web/oss/test-results/junit.xml` and `web/packages/agenta-sessions/test-results/junit.xml` are
  still tracked. Left alone deliberately — untracking them is an independent change and does not
  belong in any of these lanes.
