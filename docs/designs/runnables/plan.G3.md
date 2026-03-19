# Plan: G3 — OpenAPI Discovery (Closed)

> Status: closed — not planned
> Date: 2026-03-17
> Gap: [gap-analysis.md § G3](./gap-analysis.md#g3-openapi-is-missing-as-a-first-class-discovery-surface-in-the-new-system)
> Parent plan: [plan.md § 1e](./plan.md#1e-route-isolation-g13)

---

## Decision

`{path}/openapi.json` is **dropped** as a goal for the new routing system.

The new system exposes one discovery surface per route:

```
{path}/inspect — GET, proprietary: WorkflowServiceRequest (schemas + flags + configuration)
```

All consumers (API, frontend, SDK) should use `/inspect` directly. The per-route OpenAPI spec
and its SDK helpers (`get_workflow_openapi`, `get_application_openapi`, `get_evaluator_openapi`)
are not part of the new system contract.

---

## What Is Complete

[plan.G13.md](./plan.G13.md) is complete:

- ✅ Per-route sub-app mounting — each `@ag.route()` call produces its own isolated FastAPI sub-app
- ✅ `{path}/inspect` — on every sub-app, returns `WorkflowServiceRequest` with schemas + flags

---

## Out of Scope

- Frontend flag migration — tracked in [plan.GFlags.md § G11](./plan.GFlags.md)
- Legacy `serving.py` openapi.json deprecation — tracked in [plan.G1.md](./plan.G1.md)
