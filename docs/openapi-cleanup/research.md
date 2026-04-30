# OpenAPI Cleanup — Research

## What was done on this branch

- Deleted `api/oss/src/open_api.py` (12 stale tag names, no descriptions, ~6 were for groups that no longer exist)
- Replaced it with inline `_OPENAPI_TAGS` in `api/entrypoints/routers.py`, right before `app = FastAPI(...)`
- 25 tags now declared, ordered, and grouped — each with a description
- Fixed all tag mismatches on router mounts: casing, renames, consolidations (see PR description)
- Added `include_in_schema=False` to Auth, Access Control, AI Services routers
- Added missing `tags=` to EE `_organization_router` and `workspace_router` (were landing in "default")
- Rewrote `extend_app_schema()` in `api/ee/src/main.py` as a proper `custom_openapi` closure — fixes hot-reload schema staleness

---

## Current tag list (OSS, in order)

```
Status
---
Organizations / Workspaces / Projects
---
Users
---
Keys
---
Workflows / Applications / Evaluators
---
Testsets / Testcases
---
Queries / Traces
---
Evaluations
---
Environments
---
Secrets
---
Tools
---
Folders
---
Events / Webhooks
---
OpenTelemetry
---
[Billing — injected by EE extend_app_schema, before Admin]
---
Admin
---
Deprecated
```

---

## Route mount inventory

Every `include_router()` call and its visible status:

| Prefix | Tag | Visible |
|--------|-----|---------|
| `/vault/v1` | Secrets | ✓ |
| `/webhooks` | Webhooks | ✓ |
| `/otlp/v1` | OpenTelemetry | ✓ |
| `/auth` | — | hidden |
| `/preview/tracing` | Deprecated | hidden |
| `/tracing` | Traces | ✓ |
| `/traces` | Traces | ✓ |
| `/preview/traces` | Traces | hidden |
| `/spans` | Traces | ✓ |
| `/preview/spans` | Traces | hidden |
| `/events` | Events | ✓ |
| `/simple/traces` | Traces | ✓ |
| `/preview/simple/traces` | Traces | hidden |
| `/testcases` | Testcases | ✓ |
| `/preview/testcases` | Testcases | hidden |
| `/testsets` | Testsets | ✓ |
| `/preview/testsets` | Testsets | hidden |
| `/simple/testsets` | Testsets | ✓ |
| `/preview/simple/testsets` | Testsets | hidden |
| `/queries` | Queries | ✓ |
| `/preview/queries` | Queries | hidden |
| `/simple/queries` | Queries | ✓ |
| `/preview/simple/queries` | Queries | hidden |
| `/folders` | Folders | ✓ |
| `/applications` | Applications | ✓ |
| `/preview/applications` | Applications | hidden |
| `/simple/applications` | Applications | ✓ |
| `/preview/simple/applications` | Applications | hidden |
| `/workflows` | Workflows | ✓ |
| `/preview/workflows` | Workflows | hidden |
| `/simple/workflows` | Workflows | ✓ |
| `/preview/simple/workflows` | Workflows | hidden |
| `/ai/services` | — | hidden |
| `/evaluators` | Evaluators | ✓ |
| `/preview/evaluators` | Evaluators | hidden |
| `/simple/evaluators` | Evaluators | ✓ |
| `/preview/simple/evaluators` | Evaluators | hidden |
| `/environments` | Environments | ✓ |
| `/preview/environments` | Environments | hidden |
| `/simple/environments` | Environments | ✓ |
| `/preview/simple/environments` | Environments | hidden |
| `/variants` | Deprecated | ✓ |
| `/tools` | Tools | ✓ |
| `/preview/tools` | Tools | hidden |
| `/admin/evaluations` | Evaluations + Admin | ✓ |
| `/evaluations` | Evaluations | ✓ |
| `/preview/evaluations` | Evaluations | hidden |
| `/simple/evaluations` | Evaluations | ✓ |
| `/preview/simple/evaluations` | Evaluations | hidden |
| `/simple/queues` | Evaluations | ✓ |
| `/preview/simple/queues` | Evaluations | hidden |
| `/admin` (×2) | Admin | ✓ |
| `/health` | Status | ✓ |
| `/permissions` | Access Control | hidden |
| `/projects` | Projects | ✓ |
| `/profile` | Users | ✓ |
| `/keys` | Keys | ✓ |
| `/organizations` | Organizations | ✓ |
| `/workspaces` | Workspaces | ✓ |

**EE additions (via `extend_main`):**

| Prefix | Tag | Visible |
|--------|-----|---------|
| `/billing` | Billing | ✓ |
| `/admin/billing` | Billing + Admin | ✓ |
| `/organizations` (EE new router) | Organizations | ✓ |
| `/organizations` (EE legacy router) | Organizations | ✓ |
| `/workspaces` (EE router) | Workspaces | ✓ |
| `/auth` | — | hidden |

---

## operation_id status

**58 routes are missing explicit `operation_id`** and will get auto-generated names from FastAPI (ugly, unstable, breaks SDK generation).

### `api/oss/src/apis/fastapi/evaluations/router.py` — 47 missing

This is the largest router in the codebase. It has three classes, only one of which registers `operation_id`. All missing routes get auto-generated names like `create_runs_evaluations_runs__post`.

**EvaluationsRouter** (lines 129–490) — 47 routes missing:

| Path | Method | Endpoint | Expected operation_id |
|------|--------|----------|-----------------------|
| `/runs/refresh` | POST | `refresh_runs` | `refresh_runs` |
| `/runs/` | POST | `create_runs` | `create_runs` |
| `/runs/` | PUT | `edit_runs` | `edit_runs` |
| `/runs/` | DELETE | `delete_runs` | `delete_runs` |
| `/runs/query` | POST | `query_runs` | `query_runs` |
| `/runs/close` | POST | `close_runs` | `close_runs` |
| `/runs/open` | POST | `open_runs` | `open_runs` |
| `/runs/{run_id}` | GET | `fetch_run` | `fetch_run` |
| `/runs/{run_id}` | PUT | `edit_run` | `edit_run` |
| `/runs/{run_id}` | DELETE | `delete_run` | `delete_run` |
| `/runs/{run_id}/close` | POST | `close_run` | `close_run` |
| `/runs/{run_id}/close/{status}` | POST | `close_run` (duplicate endpoint) | `close_run_with_status` |
| `/runs/{run_id}/open` | POST | `open_run` | `open_run` |
| `/scenarios/` | POST | `create_scenarios` | `create_scenarios` |
| `/scenarios/` | PUT | `edit_scenarios` | `edit_scenarios` |
| `/scenarios/` | DELETE | `delete_scenarios` | `delete_scenarios` |
| `/scenarios/query` | POST | `query_scenarios` | `query_scenarios` |
| `/scenarios/{scenario_id}` | GET | `fetch_scenario` | `fetch_scenario` |
| `/scenarios/{scenario_id}` | PUT | `edit_scenario` | `edit_scenario` |
| `/scenarios/{scenario_id}` | DELETE | `delete_scenario` | `delete_scenario` |
| `/results/` | POST | `create_results` | `create_results` |
| `/results/` | PUT | `edit_results` | `edit_results` |
| `/results/` | DELETE | `delete_results` | `delete_results` |
| `/results/query` | POST | `query_results` | `query_results` |
| `/results/{result_id}` | GET | `fetch_result` | `fetch_result` |
| `/results/{result_id}` | PUT | `edit_result` | `edit_result` |
| `/results/{result_id}` | DELETE | `delete_result` | `delete_result` |
| `/metrics/refresh` | POST | `refresh_metrics` | `refresh_metrics` |
| `/metrics/` | POST | `create_metrics` | `create_metrics` |
| `/metrics/` | PUT | `edit_metrics` | `edit_metrics` |
| `/metrics/` | DELETE | `delete_metrics` | `delete_metrics` |
| `/metrics/query` | POST | `query_metrics` | `query_metrics` |
| `/queues/` | POST | `create_queues` | `create_queues` |
| `/queues/` | PUT | `edit_queues` | `edit_queues` |
| `/queues/` | DELETE | `delete_queues` | `delete_queues` |
| `/queues/query` | POST | `query_queues` | `query_queues` |
| `/queues/{queue_id}` | GET | `fetch_queue` | `fetch_queue` |
| `/queues/{queue_id}` | PUT | `edit_queue` | `edit_queue` |
| `/queues/{queue_id}` | DELETE | `delete_queue` | `delete_queue` |
| `/queues/{queue_id}/scenarios/query` | POST | `query_queue_scenarios` | `query_queue_scenarios` |

**SimpleEvaluationsRouter** (lines ~1760–1836) — 8 missing (simple evaluation CRUD + lifecycle):

| Path | Method | Endpoint | Expected operation_id |
|------|--------|----------|-----------------------|
| `/` | POST | `create_evaluation` | `create_evaluation` |
| `/{evaluation_id}` | GET | `fetch_evaluation` | `fetch_evaluation` |
| `/{evaluation_id}` | PUT | `edit_evaluation` | `edit_evaluation` |
| `/{evaluation_id}` | DELETE | `delete_evaluation` | `delete_evaluation` |
| `/query` | POST | `query_evaluations` | `query_evaluations` |
| `/{evaluation_id}/start` | POST | `start_evaluation` | `start_evaluation` |
| `/{evaluation_id}/stop` | POST | `stop_evaluation` | `stop_evaluation` |
| `/{evaluation_id}/close` | POST | `close_evaluation` | `close_evaluation` |
| `/{evaluation_id}/open` | POST | `open_evaluation` | `open_evaluation` |

> Note: lines ~2134–2179 also appear in the scan — need to confirm those are a third router class or the same class continued.

---

### `api/ee/src/apis/fastapi/organizations/router.py` — 11 missing

Decorator-based (`@router.post`, `@router.get`, etc.) with no `operation_id` on any route. All 11 routes get auto-generated names.

| Path | Method | Handler | Expected operation_id |
|------|--------|---------|----------------------|
| `/` | POST | `create_domain` | `create_domain` |
| `/{domain_id}/verify` | POST | `verify_domain` | `verify_domain` |
| `/` | GET | `list_domains` | `list_domains` |
| `/refresh-token` | POST | `refresh_domain_token` | `refresh_domain_token` |
| `/reset` | POST | `reset_domain` | `reset_domain` |
| `/{domain_id}` | DELETE | `delete_domain` | `delete_domain` |
| `/providers/` | POST | `create_provider` | `create_provider` |
| `/providers/{provider_id}` | PATCH | `update_provider` | `update_provider` |
| `/providers/` | GET | `list_providers` | `list_providers` |
| `/providers/{provider_id}/test` | POST | `test_provider` | `test_provider` |
| `/providers/{provider_id}` | DELETE | `delete_provider` | `delete_provider` |

> Note: this router is mounted at `/organizations` — the exact paths above are relative to a sub-prefix (likely `/organizations/{org_id}/domains` and `/organizations/{org_id}/providers`). Exact prefixes TBD from the router's own prefix configuration.

---

### Summary

| File | Missing count | Impact |
|------|--------------|--------|
| `api/oss/src/apis/fastapi/evaluations/router.py` | ~47 | High — Evaluations is a core public API group |
| `api/ee/src/apis/fastapi/organizations/router.py` | 11 | Medium — EE only, but still consumer-facing |
| **Total** | **~58** | All generate unstable auto-named operation IDs |

All other routers (`/routers/`, all other `/apis/fastapi/*/router.py`, EE `/routers/`) have explicit `operation_id` on every route.

---

## The Traces group in detail

Three routers currently all tagged `Traces`, mounted at different prefixes:

### TracingRouter → `/tracing`
Legacy RPC-style API. 10 routes:
- `POST /spans/ingest` — `ingest_spans_rpc`
- `POST /spans/query` — `query_spans_rpc`
- `POST /spans/analytics` — `fetch_legacy_analytics`
- `POST /analytics/query` — `fetch_analytics`
- `POST /traces/` — `create_trace_tracing`
- `GET /traces/{trace_id}` — `fetch_trace_tracing`
- `PUT /traces/{trace_id}` — `edit_trace_tracing`
- `DELETE /traces/{trace_id}` — `delete_trace_tracing`
- `POST /sessions/query` — `list_sessions`
- `POST /users/query` — `list_users`

### TracesRouter → `/traces`
Newer REST-style API. 6 routes:
- `GET /` — `fetch_traces`
- `POST /query` — `query_traces`
- `POST /ingest` — `ingest_traces`
- `GET /{trace_id}` — `fetch_trace`
- `POST /` — `create_trace`
- `PUT /{trace_id}` — `edit_trace`

### SpansRouter → `/spans`
3 routes:
- `GET /` — `fetch_spans`
- `POST /query` — `query_spans`
- `GET /{trace_id}/{span_id}` — `fetch_span`

### SimpleTracesRouter → `/simple/traces`
5 routes:
- `POST /` — `create_simple_trace`
- `GET /{trace_id}` — `fetch_simple_trace`
- `PUT /{trace_id}` — `edit_simple_trace`
- `DELETE /{trace_id}` — `delete_simple_trace`
- `POST /query` — `query_simple_traces`

**Observation:** `tracing/router.py` is 1347 lines across 3 classes. The `/tracing` prefix is the legacy path (also mounted hidden at `/preview/tracing` tagged Deprecated). The content within it mixes genuinely deprecated endpoints (`fetch_legacy_analytics`, `create_trace_tracing`, `fetch_trace_tracing`, etc.) with potentially still-relevant ones (`list_sessions`, `list_users`, `fetch_analytics`).

---

## Known remaining issue

`"Access Control"` is used as a tag on the `/permissions` router mount but `include_in_schema=False` — so it never appears in the spec and doesn't need to be in `_OPENAPI_TAGS`. No action needed.

---

## In-flight PRs touching the same files

Seven open PRs (all by mmabrouk) are a coordinated batch adding endpoint docstrings and `Field(description=...)` to models. No behavior changes, no tag changes, no `operation_id` additions.

| PR | Domain | Router files touched |
|----|--------|---------------------|
| #4174 | Tracing (ingest/query/simple — baseline) | `tracing/router.py`, `tracing/models.py`, `traces/router.py`, `traces/models.py` |
| #4178 | Evaluators | `evaluators/router.py`, `evaluators/models.py` |
| #4179 | Folders (draft) | `folders/router.py`, `folders/models.py`, `core/folders/types.py` |
| #4232 | Applications | `applications/router.py`, `applications/models.py` |
| #4233 | Testsets + Testcases | `testsets/router.py`, `testsets/models.py`, `testcases/models.py` |
| #4234 | Workflows | `workflows/router.py`, `workflows/models.py` |
| #4235 | Tracing (full, extends #4174) | `tracing/router.py`, `tracing/models.py`, `traces/router.py`, `traces/models.py`, `otlp/router.py`, `otlp/models.py` |

**Implications for this cleanup branch:**

- No tag conflicts — these PRs don't set tags anywhere; our tag renames (in `entrypoints/routers.py`) are orthogonal.
- No `operation_id` conflicts — none of these PRs add `operation_id`; the 58 missing routes stay missing after all 7 merge.
- `tracing/router.py` has the most overlap (#4174, #4235 both touch it). Our branch only touches the mount in `entrypoints/routers.py`, not the router file itself — no conflict today. But any future work on `tracing/router.py` (deprecation, `operation_id`) must sequence after #4174 and #4235 merge.
- `evaluations/router.py` and `ee/organizations/router.py` (the two files with missing `operation_id`) are not touched by any of these PRs — safe to work on independently.

---

## What's not yet touched

- **Content cleanup inside the Traces group** — which endpoints from `/tracing`, `/traces`, `/spans`, `/simple/traces` should be visible, which hidden, and what the final public surface should look like
- **`/preview/*` mounts** — 18 hidden mounts kept for backward compat; no decision made on whether/when to remove them
- **`/simple/*` mounts** — visible duplicates for several domains (testsets, queries, applications, etc.); relationship to the non-simple versions not documented
- **EE organizations router duplication** — `organization_router` (new, from `apis/fastapi/organizations/router.py`) and `_organization_router` (legacy, from `ee/src/routers/organization_router.py`) both mounted at `/organizations` with the same tag; no dedup/deprecation plan
