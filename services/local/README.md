# Agenta Local

A standalone, single-user desktop-style runtime for Agenta agents. It runs entirely on
your machine: a loopback FastAPI service backed by SQLite, a static web renderer, and a
local sandbox runner executing Pi-harness agents through the `agenta` SDK. No Docker, no
PostgreSQL, no Agenta Cloud request.

See `AGENTS.md` for contributor conventions and `docs/design/agenta-local-poc/plan.md`
for the design.
