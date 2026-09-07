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
- GitButler stacked branches (lane routing, recovery, PR bases): the `gitbutler-stacks` skill.
- API architecture (layering, domains, endpoints, exceptions, DTOs): `api/AGENTS.md`.
- Local dev stack run commands: `hosting/AGENTS.md`.
- Package vs app placement, `@agenta/*` packages, package unit tests: the
  `agenta-package-practices` skill.
- Testing: [docs/designs/testing/README.md](docs/designs/testing/README.md).
- Docs writing: the Diátaxis framework digest at `.agents/docs/diataxis/`, and the
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
- **Recovery:** `but oplog list` then `but oplog restore <sha>` rewinds the whole workspace
  (including uncommitted changes) to any prior snapshot. Take a `but oplog snapshot -m "..."`
  before anything risky.

Sync a lane by **rebasing on main, not by merging main into it** — merge commits between
branches collapse a GitButler series.

**Stacked branches have their own rules**, and they are the source of most `but` pain:
mis-routed hunks, dropped hunks, stale cliIds, collapsed series. Load the
`gitbutler-stacks` skill before doing any multi-lane work; do not improvise from these
basics.

## Before committing

- Frontend changes: run `pnpm lint-fix` within the `web` folder. Details: `web/AGENTS.md`.
- API or SDK changes: run `ruff format` then `ruff check --fix` within the SDK or API
  folder (from the repo root: `ruff format` then `ruff check`). Fix all errors before
  committing. Details: `api/AGENTS.md`.
- Theme color changes: edit the source of truth `web/oss/src/styles/theme/palette.ts`,
  then run `pnpm generate:tailwind-tokens` in the `web` folder and commit the regenerated
  files (`theme-variables.css`, `theme/antd-overrides.generated.ts`). Do not hand-edit the
  generated files.

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
- `cd <area> && py-run-tests` — run that area's tests, where `area` is one of
  `sdks/python`, `api`, or `services`
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
