# Contributor Guide

This is a monorepo. Agent and contributor instructions are organized in layers so the
always-loaded set stays small. This root file holds only cross-cutting rules. Area
conventions live in nested `AGENTS.md` files and in skills. See
[How agent instructions are organized](#how-agent-instructions-are-organized) at the
bottom.

## Repo map

- `web/` — frontend (Next.js, OSS + EE + shared `@agenta/*` packages). See `web/AGENTS.md`.
- `api/` — FastAPI backend (OSS + EE + entrypoints). See `api/AGENTS.md`.
- `hosting/` — docker-compose, railway, local dev stack. See `hosting/AGENTS.md`.
- `clients/`, `sdk/`, `sdks/` — SDKs and client codegen.
- `docs/` — documentation (Docusaurus).
- `examples/`, `services/`, `chat-ui/` — example apps and supporting services.

## Where conventions live

- Frontend (imports, state, data fetching, styling, React, Fern client): `web/AGENTS.md`.
- API architecture (layering, domains, endpoints, exceptions, DTOs): `api/AGENTS.md`.
- Local dev stack run commands: `hosting/AGENTS.md`.
- Package vs app placement, `@agenta/*` packages, package unit tests: the
  `agenta-package-practices` skill.
- Testing: [docs/designs/testing/README.md](docs/designs/testing/README.md).
- Docs writing: the Diátaxis framework digest at `agents/docs/diataxis/`, and the
  `write-docs` skill for Agenta style, voice, and structure.

## Branching and PRs with GitButler

This repo may be in GitButler workspace mode (current branch `gitbutler/workspace`).
If so, use the `but` CLI instead of raw `git branch`/`git commit`:

- `but status` shows lanes and unassigned changes; `but branch new <name>` creates a
  parallel lane; add `--anchor <parent-branch>` to stack on a parent.
- `but commit <branch> -m "..."` commits the uncommitted changes to that branch.
  Pre-commit hooks (ruff, prettier, gitleaks) run; if a hook reformats files the
  commit aborts — just rerun it. Changes belonging to another lane's commits stay
  unassigned rather than being folded in.
- `but pr new` needs interactive forge auth; use `but push <branch>` then
  `gh pr create --head <branch> --base <parent-or-main>` instead. For stacked PRs,
  set `--base` to the parent branch so each PR shows only its own diff.
- **`but push` prints NOTHING on success.** It is not a confirmation — always verify
  the push landed by comparing SHAs:
  `git ls-remote --heads origin <branch>` vs `git rev-parse <branch>`. They must match.
- To update an already-committed file, `but absorb <path>` amends it into the right
  commit; force-push with `but push <branch> -f`.

### Committing to specific lanes in a stack (the part that bites)

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

### Spreading a pile of edits back across an existing stack (the reliable way)

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

### Stacks are linear; a fan-out is expressed through PR bases, not graph shape

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

### Hard-won gotchas (don't relearn these)

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

## Before committing

- Frontend changes: run `pnpm lint-fix` within the `web` folder. Details: `web/AGENTS.md`.
- API or SDK changes: run `ruff format` then `ruff check --fix` within the SDK or API
  folder (from the repo root: `ruff format` then `ruff check`). Fix all errors before
  committing. Details: `api/AGENTS.md`.
- Ant Design token changes: run `pnpm generate:tailwind-tokens` in the `web` folder and
  commit the generated file.

## Local dev loop (deploy + test)

From the repo root. **`load-env` must match the edition and image you deploy** — the env
file and the `run.sh` flags always agree:

- OSS + dev → `load-env hosting/docker-compose/oss/.env.oss.dev` + `run.sh --oss --dev`
- OSS + gh  → `load-env hosting/docker-compose/oss/.env.oss.gh`  + `run.sh --oss --gh`
- EE  + dev → `load-env hosting/docker-compose/ee/.env.ee.dev`   + `run.sh --ee --dev`
- EE  + gh  → `load-env hosting/docker-compose/ee/.env.ee.gh`    + `run.sh --ee --gh`

- `load-env <env-file>` — load env vars into the shell (pick the row above).
- `bash ./hosting/docker-compose/run.sh <flags> --build` — deploy to the local
  docker-compose stack (`--oss`/`--ee`, `--dev`/`--gh`; `--down` to stop, `--nuke` to drop
  volumes). Use the SAME edition/image as load-env.
- `cd "sdks/python" | "api" | "services" && py-run-tests` — run that area's tests
  (`py-run-tests` = `uv sync --locked && uv run --no-sync python run-tests.py`).
- Postgres is reachable locally with `username:password`; EE DB name is `agenta_ee_core`.
- Tests mint ephemeral accounts + API keys via the admin endpoint
  `POST /admin/simple/accounts/` (with `Authorization: Access AUTH_KEY`,
  `create_api_keys/return_api_keys: true`). Reuse the fixtures in
  `api/oss/tests/pytest/utils/accounts.py` (`foo_account`/`cls_account`/`mod_account` →
  `{api_url, credentials: "ApiKey ..."}`); do not hand-roll account creation.

## Environment config

- For API configuration, add new environment variables to `api/oss/src/utils/env.py` and
  consume them via the shared `env` object. Do not call `os.getenv(...)` directly for
  application config. Full detail: `api/AGENTS.md`.

## Testing

For comprehensive testing documentation, see
[docs/designs/testing/README.md](docs/designs/testing/README.md).

## Packs

- Hosting: [docs/packs/hosting.md](docs/packs/hosting.md)
- Testing: [docs/packs/testing.md](docs/packs/testing.md)

## PR instructions

- If the user provides you with the issue id, title the PR:
  `[issue-id] fix(frontend): <Title>` where `fix` is the type (fix, feat, chore, ci, doc,
  test, using better-branch) and `frontend` is the area, which could be API, SDK,
  frontend, docs, and so on.
- For the PR body (structure, before/after, what to cut), the `write-pr-description`
  skill has the full procedure and a worked example.

## How agent instructions are organized

This repo keeps the always-loaded instruction layer small and pushes scope-specific or
procedural guidance into layers that load on demand. All three tools we use (Claude Code,
Codex, Cursor) read this structure.

- **Root `AGENTS.md`** (this file): cross-cutting facts only. `CLAUDE.md` re-imports it so
  Claude Code reads the same content.
- **Nested `<dir>/AGENTS.md`** (`web/`, `api/`, `hosting/`): area conventions, loaded only
  when working in that directory. Each has a `CLAUDE.md` symlink so Claude loads it too.
- **Skills** (`.agents/skills/`, symlinked into `.claude/skills/`): procedures and heavy
  reference, loaded on demand. Discoverable by Codex (`.agents/skills`) and Claude (the
  symlink); the `SKILL.md` format is shared across tools.
- **Tool rules** (`.claude/rules/`, `.cursor/rules/`): thin, path-scoped enforcement only.
  They point to the relevant `AGENTS.md`; they do not duplicate it.

When adding a new instruction, put it at the lowest scope that fits and do not grow this
root file. Splitting a long file into `@import`s does not save context, so move content
down a level instead. The full model and rationale:
[docs/design/agents-md-compartmentalization/playbook.md](docs/design/agents-md-compartmentalization/playbook.md).
