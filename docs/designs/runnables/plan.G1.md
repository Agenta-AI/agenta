# Plan: G1 — Dual Serving Systems (SDK Removal)

> Status: draft
> Date: 2026-03-17
> Gap: [gap-analysis.md § G1](./gap-analysis.md#g1-dual-serving-systems)
> Parent plan: [plan.md § Checkpoint 2](./plan.md#checkpoint-2-contract-future)

---

## Goal

Declare the new serving system canonical, verify it covers all legacy capabilities, then remove the legacy system in checkpoint 2. No deprecation warnings — the old SDK version stays available for users who depend on the legacy endpoints.

Web consumer migration is tracked separately in [G18](./gap-analysis.md#g18-web-consumers-still-targeting-legacy-serving-endpoints).

---

## System Map

### Legacy system

**SDK decorator:** `@ag.entrypoint` — `sdk/agenta/sdk/decorators/serving.py`

Endpoints registered:

| Path | Mode | Notes |
|------|------|-------|
| `{prefix}/test` | playground | primary non-legacy playground path |
| `{prefix}/run` | deployed | primary non-legacy deployed path |
| `{prefix}/playground/run` | playground | new path alias |
| `{prefix}/playground/run/{route}` | playground | per-route alias |
| `{prefix}/run/{route}` | deployed | per-route alias |
| `{prefix}/generate` | playground | **LEGACY** — `TODO` comment present |
| `{prefix}/generate_deployed` | deployed | **LEGACY** — `TODO` comment present |
| `{prefix}/openapi.json` | discovery | shared OpenAPI for entire app |

`{prefix}` = `AGENTA_RUNTIME_PREFIX` env var (default `""`).

Response shape: `BaseResponse` (`sdk/agenta/sdk/types.py`):
```python
class BaseResponse(BaseModel):
    version: str = "3.0"
    data: Union[str, dict, None]
    content_type: str
    tree: Optional[dict]       # inline trace — SDK-internal
    tree_id: Optional[str]
    trace_id: Optional[str]
    span_id: Optional[str]
```

### New system

**SDK decorators:** `@ag.route` + `@ag.workflow` — `sdk/agenta/sdk/decorators/routing.py` + `running.py`

Endpoints registered per decorated function:

| Path | Method | Notes |
|------|--------|-------|
| `{path}/invoke` | POST | execute; content-negotiated response |
| `{path}/inspect` | GET | discover interface, schemas, flags |

Response shape: `WorkflowServiceBatchResponse` or `WorkflowServiceStreamResponse` (`sdk/agenta/sdk/models/workflows.py`):
```python
class WorkflowServiceBatchResponse(BaseModel):
    version: str = "2025.07.14"
    data: Optional[WorkflowServiceResponseData]   # outputs
    status: WorkflowServiceStatus                 # code + message + stacktrace
    trace_id: Optional[str]
    span_id: Optional[str]
```

---

## Coverage Verification

| Legacy capability | New equivalent | Covered? |
|---|---|---|
| Execute workflow (playground mode) | `POST {path}/invoke` | ✅ |
| Execute workflow (deployed mode) | `POST {path}/invoke` (url on revision encodes target) | ✅ |
| Streaming response | `POST {path}/invoke` + `Accept: text/event-stream` | ✅ |
| Discover interface + schemas | `GET {path}/inspect` | ✅ |
| OpenAPI discovery (`/openapi.json`) | `GET {path}/inspect` | ✅ `/inspect` is the sole discovery surface |
| Config injection (`ag_config` key) | `WorkflowServiceConfiguration` in request | ✅ |
| Inline trace in response (`tree`) | Trace written to OTel backend instead | ✅ (different mechanism) |

All SDK-side capabilities are covered.

---

## Steps

### S1. Declare canonical system (doc only)

The new system (`routing.py` + `running.py` + `@ag.route/@ag.workflow`) is canonical going forward.
The legacy system (`serving.py` + `@ag.entrypoint`) is kept during checkpoint 1, removed in checkpoint 2.
`/generate` and `/generate_deployed` are already marked `# LEGACY` — no further expansion of these paths is allowed.

No code change in this step.

---

### S2. Checkpoint 2 — Remove legacy system

Gated on G18 (web consumer migration) being complete. Once that is done:

#### S2a. Delete `serving.py` and the `middleware/` folder

`serving.py` is the only consumer of everything in `sdk/agenta/sdk/middleware/` except `vault.py`.
`vault.py` is a thin class that wraps shared logic from `middlewares/running/vault.py` — it belongs in `middlewares/routing/` alongside the other routing middlewares.

Files to delete:
- `sdk/agenta/sdk/decorators/serving.py`
- `sdk/agenta/sdk/middleware/mock.py`
- `sdk/agenta/sdk/middleware/inline.py`
- `sdk/agenta/sdk/middleware/config.py`
- `sdk/agenta/sdk/middleware/otel.py`
- `sdk/agenta/sdk/middleware/auth.py`
- `sdk/agenta/sdk/middleware/cors.py`
- `sdk/agenta/sdk/middleware/__init__.py`

#### S2b. Drop HTTP-layer `VaultMiddleware`

`sdk/agenta/sdk/middleware/vault.py` was an HTTP-layer middleware that pre-fetched secrets into `request.state.vault`. This is redundant — the running-layer `VaultMiddleware` in `middlewares/running/vault.py` already fetches secrets inside the invoke pipeline. Drop the HTTP-layer one entirely.

- Delete `sdk/agenta/sdk/middleware/vault.py` (done with S2a)
- Remove `VaultMiddleware` import and `app.add_middleware(VaultMiddleware)` from `routing.py`
- Remove `req.state.vault` read in `invoke_endpoint`; pass `secrets=None` instead

#### S2c. Update `__init__.py` public API

`sdk/agenta/sdk/__init__.py` line 74 currently imports the old `route` (wraps `@entrypoint`) and `app` (legacy `_LazyApp`) from `serving.py`.

```python
# before
from agenta.sdk.decorators.serving import route, app

# after
from agenta.sdk.decorators.routing import route, default_app as app
```

`entrypoint` is dropped from the public API — no re-export.

#### S2d. Delete `sdk/templates/`

`sdk/templates/` contains example apps (`simple_prompt`, `compose_email`, `extract_data_to_json`) that use `@ag.entrypoint` and the old config API (`ag.config.default`, `ag.FloatParam`, `ag.TextParam`). They are entirely legacy. Delete the folder.

---

## File Index

| File | Role | Action |
|---|---|---|
| `sdk/agenta/sdk/decorators/serving.py` | Legacy `@entrypoint` + legacy `route` + `_LazyApp` | S2a: delete |
| `sdk/agenta/sdk/middleware/mock.py` | Legacy mock middleware | S2a: delete |
| `sdk/agenta/sdk/middleware/inline.py` | Legacy inline middleware | S2a: delete |
| `sdk/agenta/sdk/middleware/config.py` | Legacy config middleware | S2a: delete |
| `sdk/agenta/sdk/middleware/otel.py` | Legacy OTel middleware | S2a: delete |
| `sdk/agenta/sdk/middleware/auth.py` | Legacy auth middleware | S2a: delete |
| `sdk/agenta/sdk/middleware/cors.py` | Legacy CORS middleware | S2a: delete |
| `sdk/agenta/sdk/middleware/__init__.py` | Legacy middleware package | S2a: delete |
| `sdk/agenta/sdk/middleware/vault.py` | HTTP-layer `VaultMiddleware` | S2b: drop (running-layer handles it) |
| `sdk/agenta/sdk/decorators/routing.py` | New `@route` | S2b: remove vault middleware + `req.state.vault` read |
| `sdk/agenta/sdk/decorators/running.py` | New `@workflow` | canonical — no changes |
| `sdk/agenta/sdk/__init__.py` | Public API | S2c: re-point `route` + `app` to `routing.py` |
| `sdk/templates/` | Legacy example apps | S2d: delete |
