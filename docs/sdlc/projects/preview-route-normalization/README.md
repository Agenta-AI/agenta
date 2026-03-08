# Preview Route Normalization

This workspace tracks the plan to keep legacy `/preview/*` endpoints working while introducing canonical non-preview mounts and exposing only canonical paths in OpenAPI.

## Prompt

Create a migration plan for preview route cleanup, identify which routes are safe vs open risk, and track migration status for frontend and SDK consumers.

## Documents

- `context.md` - Why this change exists, goals, and constraints.
- `research.md` - Current route inventory, usage findings, and risk notes.
- `route-matrix.md` - Per-route safety and migration status (API + frontend + SDK).
- `plan.md` - Phased rollout plan with exit criteria.
- `status.md` - Current execution status, decisions, and next actions.

## Current headline

- Feasible approach: dual-mount routes, hide preview mounts from schema (`include_in_schema=False`), then migrate clients.
- Most domains are safe to add now.
- `environments` remains open/risky due existing legacy `/environments` router also mounted.
