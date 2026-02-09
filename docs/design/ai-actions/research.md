# Research Notes (Repo)

## New backend stack conventions (confirmed)

- New endpoints should live under `api/oss/src/apis/fastapi/*` and core logic under `api/oss/src/core/*`.
- Composition root wiring happens in `api/entrypoints/routers.py`.

## Existing invocation / completion primitives

### Workflows service (FastAPI)

- `api/oss/src/apis/fastapi/workflows/router.py` implements `invoke_workflow(...)` and calls `WorkflowsService.invoke_workflow(...)`.
- `api/oss/src/core/workflows/service.py` wraps invocation by signing a `Secret <token>` and calling the SDK runner (`_invoke_workflow`).

This path is used for invoking workflows within the current instance; it is not a direct "call cloud.agenta.ai with ApiKey" client.

### Legacy LLM app invocation service

- `api/oss/src/services/llm_apps_service.py` posts to `{uri}/test` using `Authorization: Secret <token>`.
- This is part of the legacy stack and should not be used as a template for new AI action endpoints.

## Frontend API patterns

- API client wrapper: `web/oss/src/services/api.ts`.
- Existing domain APIs live under `web/oss/src/services/*/api/*` (e.g. `promptVersioning`, `testsets`).

## Likely UI integration surfaces (Chapter 1)

- Prompt editing lives in Playground components under `web/oss/src/components/Playground/*`.

No existing `ai/services` endpoints or UI hooks were found in OSS.
