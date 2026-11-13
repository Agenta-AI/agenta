# Tracing API Cleanup

## Goal

Flatten the tracing API surface to match the rest of the codebase's resource-first convention, eliminate duplicates, and reduce the public surface (drop API ingest in favor of OTLP + explicit create).

## Current state (problems)

- `/tracing/*` is the only category-grouping prefix in the API; every other domain is flat (`/variants`, `/evaluations`, `/applications`, etc.).
- `/traces/*`, `/spans/*`, and `/tracing/*` overlap heavily — same handlers, different response shapes via a `focus` flag.
- `/preview/*` re-mounts of the same routers exist with `include_in_schema=False` (migration leftovers).
- Two analytics endpoints coexist: `/tracing/spans/analytics` (legacy, fixed metrics, `OldAnalyticsResponse`) and `/tracing/analytics/query` (spec-based, current). The new one is a strict superset.
- Three ingest paths: `/otlp/v1/traces`, `/tracing/spans/ingest`, `/traces/ingest` — the latter two are wrappers around the same service method.

## Target surface

### Canonical (keep / add)

```
SPANS                                  TRACES
POST /spans/query                      POST /traces/query
POST /spans/analytics/query
POST /spans/sessions/query
POST /spans/users/query
GET  /spans/                           GET  /traces/
GET  /spans/{trace_id}/{span_id}       GET  /traces/{trace_id}
                                       POST /traces/                  (create)
                                       PUT  /traces/{trace_id}        (edit)
                                       DELETE /traces/{trace_id}      (delete)
```

Also kept unchanged:
- `/simple/traces/*` — simplified SDK surface (no `/simple/spans/*`; trace-only is intentional).
- `/otlp/v1/traces` — OTel ingest, the production path.

### Design decisions

**Verb suffix on read RPCs.** `query`, `analytics/query`, `sessions/query`, `users/query` use `query` as a verb suffix. Bare `/spans/query` and `/traces/query` are the primary operations on the resource; `analytics`, `sessions`, `users` are sub-views that are then queried.

**Sessions / users / analytics on spans only.** The query verbs (`/analytics/query`, `/sessions/query`, `/users/query`) live under `/spans/` only — not mirrored on `/traces/`. The trace-side mirrors were considered (with `focus=TRACE`) but skipped: the underlying aggregations are span-row-native, and exposing them as both `/spans/...` and `/traces/...` doubled the surface without buying behavior. Trace-row-native aggregation can be added later as `/traces/analytics/query` etc. when there's a real semantic divergence.

**Ingest dropped from the public API.** `/spans/ingest` and `/traces/ingest` are deprecated. Two real ways in:
- **OTLP** (`/otlp/v1/traces`) — instrument with OTel.
- **Create** (`POST /traces/`) — explicit per-trace creation.

**GET multi-id query params.** Both repeated (`?trace_id=a&trace_id=b`) and CSV (`?trace_ids=a,b,c`) forms remain accepted. No canonicalization.

## Deprecated

Mark with `deprecated=True` in FastAPI **and** ensure the route surfaces under the `Deprecated` OpenAPI tag (uppercase, matching the existing tag entry in `_OPENAPI_TAGS`). SDK regeneration filters out anything under `Deprecated` plus anything with `deprecated: true`. **No cutover** — endpoints remain functional.

- All of `/tracing/*` (entire `TracingRouter` mount)
- All of `/preview/*` mounts (`/preview/tracing/*`, `/preview/traces/*`, `/preview/spans/*`) — also `include_in_schema=False`
- `/spans/ingest`, `/traces/ingest`, `/tracing/spans/ingest`
- `/tracing/spans/analytics` (the `legacy_analytics` handler)
- `/variants/configs/fetch` (legacy variants config fetcher)

### How tagging works (FastAPI gotcha)

FastAPI **prepends** the mount-level `tags=` to each route's tags, so a route registered with `tags=["Deprecated"]` under a mount with `tags=["Traces"]` ends up tagged `["Traces", "Deprecated"]` — and Swagger UI groups by the first tag. Two patterns are used here:

1. **Mount-level deprecation** — when the entire mount is deprecated (`/tracing`, `/preview/*`), pass `deprecated=True, tags=["Deprecated"]` on `include_router(...)`. Don't repeat the tag at the route level (it would just duplicate to `["Deprecated", "Deprecated"]`).
2. **Single deprecated route in a non-deprecated mount** — split that route onto a sibling `APIRouter` (e.g. `TracesRouter.deprecated_router`) and mount it separately with `tags=["Deprecated"]`. This is what `/traces/ingest` does. A route-level `tags=["Deprecated"]` alone won't work because the mount's `Traces` tag wins for grouping.

## Files to edit

1. **[application/api/oss/src/apis/fastapi/tracing/router.py](application/api/oss/src/apis/fastapi/tracing/router.py)**
   - `SpansRouter`: add `analytics/query`, `sessions/query`, `users/query` routes wired to `TracingService.analytics`, `TracingService.sessions`, `TracingService.users`.
   - `TracesRouter`: confirm trace CRUD (POST/, GET/{id}, PUT/{id}, DELETE/{id}) is present and canonical. Add `DELETE /{trace_id}` if missing. The `/ingest` route lives on a separate `self.deprecated_router` so its tag groups correctly.
   - Mark `/spans/ingest` (TracingRouter) and `fetch_legacy_analytics` (`/tracing/spans/analytics`) with `deprecated=True` (no route-level `tags=`; the mount tags them).

2. **[application/api/entrypoints/routers.py](application/api/entrypoints/routers.py)**
   - `/tracing/*` mount: `deprecated=True, tags=["Deprecated"]`.
   - `/preview/tracing`, `/preview/traces`, `/preview/spans` mounts: `deprecated=True, tags=["Deprecated"], include_in_schema=False`.
   - `traces.deprecated_router` mounted at `/traces` with `tags=["Deprecated"]` (carries `/ingest` only).

3. **[application/api/oss/src/apis/fastapi/legacy_variants/router.py](application/api/oss/src/apis/fastapi/legacy_variants/router.py)**
   - Mark `/configs/fetch` with `deprecated=True, tags=["Deprecated"]`.

4. **OpenAPI spec regeneration** — auto-generated; verify the Deprecated tag groups all expected endpoints and the SDK regeneration excludes them.

## Beyond original scope (also shipped)

- **Removed 9 dead legacy organization handlers** from `api/ee/src/routers/organization_router.py` (full duplicates of `api/ee/src/apis/fastapi/organizations/router.py` at the same `/organizations` prefix). Fixes 9 duplicate `operation_id` warnings.
- **Removed EE re-mount of `auth_router`** from `api/ee/src/main.py` — OSS already mounts it at `/auth`. Fixes 4 duplicate `operation_id` warnings.
- **Removed `default_response_class=ORJSONResponse`** from the FastAPI app in `routers.py`. Fixes a deprecation warning; FastAPI now serializes via Pydantic faster.

## Open follow-ups (post-cleanup)

- Decide whether to eventually implement trace-row-native analytics (would expose `/traces/analytics/query` etc. with semantically distinct aggregation, not a focus-flag re-route of span aggregation).
- Decide on a removal date for the deprecated endpoints once SDK / client migrations are tracked.
- Regenerate API clients (`bash clients/scripts/generate.sh`) so the deleted org handlers and added `/spans/{analytics,sessions,users}/query` are reflected.
