# OpenAPI Cleanup — Summary

What changed across FastAPI routers, the OpenAPI spec, the Docusaurus reference, and the Fern-generated clients.

## Tracing surface

### Canonical (flat, resource-first) — `Traces` tag

**Spans** — read + dimensional aggregates:

- `POST /spans/query`
- `POST /spans/analytics/query` *(new)*
- `POST /spans/sessions/query` *(new)*
- `POST /spans/users/query` *(new)*
- `GET /spans/?trace_id=&span_id=` (repeated and CSV both accepted)
- `GET /spans/{trace_id}/{span_id}`

**Traces** — full CRUD:

- `POST /traces/`, `GET /traces/{trace_id}`, `PUT /traces/{trace_id}`, `DELETE /traces/{trace_id}` *(DELETE added)*
- `GET /traces/?trace_id=` (repeated and CSV)
- `POST /traces/query`

**Unchanged**: `/simple/traces/*` (simplified SDK surface, trace-only by design), `POST /otlp/v1/traces` (OTel ingest).

### Deprecated — `Deprecated` tag, excluded from SDK regen

- All of `/tracing/*` (entire `TracingRouter` mount)
- `POST /traces/ingest` (use OTLP or `POST /traces/`)
- `POST /tracing/spans/ingest`, `POST /tracing/spans/analytics`
- `POST /variants/configs/fetch`
- `/preview/tracing/*`, `/preview/traces/*`, `/preview/spans/*` (also `include_in_schema=False`)

### Skipped (not implemented despite being in the original plan)

- `/traces/analytics/query`, `/traces/sessions/query`, `/traces/users/query` — the underlying aggregations are span-row-native; no semantic divergence today justifies the doubled surface. Add later if/when a trace-row-native aggregation lands.
- `POST /spans/`, `POST /spans/ingest` — folded into `POST /traces/` and OTLP.

## Beyond the tracing scope (also shipped)

These were collateral cleanups discovered while wiring up the `Deprecated` tag — they fix duplicate `operation_id` warnings and an unrelated FastAPI deprecation warning that surfaced once the Swagger logs were quiet enough to read.

- **Removed 9 dead legacy organization handlers** in `api/ee/src/routers/organization_router.py` (`list/create/get/delete/verify_organization_domain`, `list/create/get/update/delete_organization_provider`). They were full duplicates of `api/ee/src/apis/fastapi/organizations/router.py` mounted at the same `/organizations` prefix. The web app and SDK already used the new router; the old paths were unreachable in practice.
- **Removed EE re-mount of `auth_router`** in `api/ee/src/main.py`. OSS already mounts `auth_router` at `/auth`; the EE re-mount was a duplicate.
- **Removed `default_response_class=ORJSONResponse`** from the FastAPI app. FastAPI now serializes via Pydantic faster, and `ORJSONResponse` emits a deprecation warning.

## FastAPI tagging gotcha

`include_router(prefix=..., tags=["Foo"])` *prepends* `Foo` to each route's tags, so a route registered with `tags=["Deprecated"]` under a mount tagged `["Foo"]` ends up tagged `["Foo", "Deprecated"]` — and Swagger UI groups by the **first** tag. Two patterns in this repo as a result:

1. **Mount-level deprecation** — when the entire mount is deprecated (`/tracing`, `/preview/*`), pass `deprecated=True, tags=["Deprecated"]` on `include_router(...)` only. Don't repeat the tag at the route level (it would just duplicate to `["Deprecated", "Deprecated"]`).
2. **Single deprecated route in a non-deprecated mount** — split that route onto a sibling `APIRouter` (e.g. `TracesRouter.deprecated_router`) and mount it separately with `tags=["Deprecated"]`. This is what `/traces/ingest` does.

A route-level `tags=["Deprecated"]` alone does *not* override an active mount-level tag.

## Regen state

- **OpenAPI spec** ([`docs/docs/reference/openapi.json`](../docs/reference/openapi.json)) — refreshed.
- **Docusaurus API reference** ([`docs/docs/reference/api/`](../docs/reference/api/)) — `delete-trace.api.mdx` added; `fetch-legacy-analytics.api.mdx` and `ingest-spans.api.mdx` updated to reflect deprecated state; sidebar regenerated.
- **Python client** ([`clients/python/agenta_client/`](../../clients/python/agenta_client/)) — `delete_trace`, `query_spans_analytics`, `query_spans_sessions`, `query_spans_users` added; legacy org handlers replaced by the new no-`organization_id`-in-path signatures.
- **TypeScript client** ([`web/packages/agenta-api-client/src/generated/`](../../web/packages/agenta-api-client/src/generated/)) — same deltas; `DeleteTraceRequest` added.
- **Endpoint table** ([`endpoints.md`](endpoints.md)) — regenerated. 357/406 routes mapped; the 49 unmapped are admin-tagged or `include_in_schema=False`.

## Open follow-ups

- Set a removal date for the deprecated `/tracing/*` mount once SDK consumers have migrated.
- Decide whether trace-row-native analytics is worth implementing (would expose `/traces/analytics/query` etc. with semantically distinct aggregation, not a focus-flag re-route of span aggregation).
- The legacy organization handler removal left lifecycle handlers in `api/ee/src/routers/organization_router.py` (organization create/update/delete, workspace create/update, transfer_ownership). Worth migrating those into `api/ee/src/apis/fastapi/organizations/router.py` so the legacy file can be deleted entirely.
