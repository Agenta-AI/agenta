# Railway Preview Environments

Create a fully programmatic Railway deployment workflow for Agenta, starting with OSS baseline deployment and evolving to per-PR preview environments.

## User Request

"Create a plan for this how to do it. The goal is to reach the point where we can have preview environments using railways, but maybe the first step is to deploy oss version programmatically."

## Scope

- Phase 1: programmatic OSS deployment on Railway (no manual UI configuration after token setup)
- Phase 2: harden CI/CD and config-as-code
- Phase 3: automated per-PR preview environments (create/update/delete lifecycle)

## Files

- **[context.md](./context.md)** - Problem statement, goals, non-goals, constraints
- **[research.md](./research.md)** - Findings from Agenta and Railway docs/codebase
- **[plan.md](./plan.md)** - Execution phases, milestones, and deliverables
- **[status.md](./status.md)** - Current progress, decisions, and next actions
- **[qa.md](./qa.md)** - Validation strategy and smoke checks for each phase
- **[deployment-notes.md](./deployment-notes.md)** - What we changed on Railway, why we changed it, and how to operate upgrades

## Quick References

- Agenta compose baseline: `hosting/docker-compose/oss/docker-compose.gh.yml`
- Agenta env template: `hosting/docker-compose/oss/env.oss.gh.example`
- API root path: `api/entrypoints/routers.py:174`
- API CORS defaults: `api/entrypoints/routers.py:192`
- Services health endpoint: `services/entrypoints/main.py:20`
- Railway CLI docs: project/service/environment/variable/volume/domain/deployment
