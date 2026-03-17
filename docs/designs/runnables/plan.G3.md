# Plan: G3 — OpenAPI as First-Class Discovery Surface

> Status: draft
> Date: 2026-03-17
> Gap: [gap-analysis.md § G3](./gap-analysis.md#g3-openapi-is-missing-as-a-first-class-discovery-surface-in-the-new-system)
> Parent plan: [plan.md § 1e](./plan.md#1e-route-isolation-and-per-workflow-openapi-g3-g13)

---

## Goal

Each workflow namespace exposes two consistent discovery surfaces:

```
{path}/inspect      — GET, proprietary: WorkflowServiceRequest (schemas + flags + configuration)
{path}/openapi.json — GET, standard:   OpenAPI 3.x spec (schemas + flags as x-agenta-flags)
```

---

## What Already Exists

[plan.G13.md](./plan.G13.md) is complete:

- ✅ Per-route sub-app mounting — each `@ag.route()` call produces its own isolated FastAPI sub-app
- ✅ `{path}/openapi.json` — auto-generated per sub-app, enriched with `x-agenta-schemas` via `_attach_openapi_schema`
- ✅ `{path}/inspect` — on every sub-app, returns `WorkflowServiceRequest` with schemas + flags

Flag consistency between inspect and openapi.json is tracked in **plan.GFlags.md § S11a**.

---

## Remaining Gap — SDK Discovery Helpers

The gap-analysis called for `get_workflow_openapi()`, `get_application_openapi()`, `get_evaluator_openapi()` in the SDK. These don't exist in `running.py`.

**File:** `sdk/agenta/sdk/decorators/running.py`

```python
async def get_openapi(*, url: str, path: str = "/") -> dict:
    """Fetch the per-route openapi.json for a workflow, application, or evaluator."""
    base = url.rstrip("/")
    route_base = path.rstrip("/")
    endpoint = f"{base}{route_base}/openapi.json"
    async with httpx.AsyncClient() as client:
        response = await client.get(endpoint)
        response.raise_for_status()
        return response.json()

get_workflow_openapi = get_openapi
get_application_openapi = get_openapi
get_evaluator_openapi = get_openapi
```

One implementation, three aliases — applications and evaluators are workflows.

---

## Acceptance Criteria

1. `get_openapi(url=..., path=...)` returns the per-route OpenAPI dict
2. `get_workflow_openapi`, `get_application_openapi`, `get_evaluator_openapi` are aliases for `get_openapi`

---

## Out of Scope

- Flags in `openapi.json` — tracked in [plan.GFlags.md § S11a](./plan.GFlags.md)
- Frontend flag migration — tracked in [plan.GFlags.md § G11](./plan.GFlags.md)
- Legacy `serving.py` openapi.json deprecation — tracked in [plan.G1.md](./plan.G1.md)
