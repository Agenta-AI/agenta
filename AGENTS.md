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

## Before committing

- Frontend changes: run `pnpm lint-fix` within the `web` folder. Details: `web/AGENTS.md`.
- API or SDK changes: run `ruff format` then `ruff check --fix` within the SDK or API
  folder (from the repo root: `ruff format` then `ruff check`). Fix all errors before
  committing. Details: `api/AGENTS.md`.
- Ant Design token changes: run `pnpm generate:tailwind-tokens` in the `web` folder and
  commit the generated file.

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
