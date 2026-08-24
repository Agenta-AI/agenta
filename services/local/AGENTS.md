# services/local

Agenta Local: a standalone, single-user local runtime for Agenta agents (SQLite storage,
loopback FastAPI service, Pi-backed execution through the SDK).

## Layer direction

```text
Router -> Service -> DAO Interface -> DAO Implementation -> DB
```

Concrete dependencies are wired only by
`src/agenta_local/entrypoints/server.py`. Core services never import FastAPI,
SQLAlchemy, Alembic, or concrete adapters.

## Scope

Local-only, single-user, offline. No multi-tenancy, no platform API calls at runtime.
Mutable state lives under XDG data/state paths; installation files stay read-only.

## Prohibited imports

Never import `api.oss`, `api.ee`, or broad-services `oss.src` modules, and never import
platform DAOs. The only Agenta code this project depends on is the `agenta` SDK
(`sdks/python`) and `agenta-client` (`clients/python`), both resolved to checkout paths in
`uv.lock`.

## Commands

Run from `services/local`:

```bash
uv lock
uv sync --locked
uv run --no-sync pytest tests/pytest/unit
uv run --no-sync pytest tests/pytest/integration
uv run --no-sync pytest tests/pytest/acceptance
```

Format/lint with the repository-pinned Ruff (`uvx ruff format . && uvx ruff check --fix .`
from `services/local`; the root `ruff.toml` applies).
