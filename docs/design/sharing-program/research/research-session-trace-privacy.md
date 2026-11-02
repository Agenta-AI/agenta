# Research appendix: session-trace-privacy (M9)

Checked on 2026-10-22 against main `42ffe80bfe`. Paths are relative to the repository root.

## Session deletion leaves spans (verified)

- `api/oss/src/core/sessions/service.py` `delete_session`: hard-deletes turns, interactions, session mounts and the stream row; "records: UNTOUCHED, cross-DB, tracing retention owns them". Without a tombstone, a deleted private session's id names no session, and its spans would fall back to the `VIEW_SPANS` rule.
- `api/ee/src/core/tracing/service.py` `flush_spans`: per-plan retention (`Retention` in `api/ee/src/core/access/entitlements/types.py`, weekly, monthly, quarterly; `None` means unlimited) deletes traces before a cutoff via `TracingRetentionDAO.delete_traces_before_cutoff`. OSS has no retention, so tombstones there are permanent (small rows).

## User-triggered service reads that must take the caller's scope (verified)

`TracingService` read callers outside the tracing routers:

- `api/oss/src/core/queries/service.py` (around line 201): saved-query retrieval with `include_trace_ids` or `include_traces` runs `tracing_service.query` and returns trace contents to the user (`retrieve_query_revision` in `api/oss/src/apis/fastapi/queries/router.py`).
- `api/oss/src/core/invocations/service.py`: `fetch_trace`, `query_traces`.
- `api/oss/src/core/annotations/service.py`: `fetch_trace`, `query_traces`.
- `api/oss/src/core/evaluations/service.py` (`analytics`, `query`), `core/evaluations/utils.py` (`fetch_trace`, `query_traces`), `core/evaluations/runtime/sources.py` (`query_traces`).
- `api/oss/src/core/tools/platform_handlers.py`: `query_spans` for the agent platform op.

Only ingest (linkage promotion, cost cumulation) and the turn usage write-back are maintenance reads.

## Linkage (verified)

- `api/oss/src/dbs/postgres/tracing/dbes.py`: `spans.session_id` indexed with `(project_id, session_id)`. `dbas.py` documents it as root-only ("children never populate these"). `promote_identity_by_trace` in `api/oss/src/core/tracing/utils/trees.py` lifts it from the root's `ag.session` attribute.
- `services/runner/src/tracing/otel.ts`: sets `session.id` only on the agent span.
- Spans land only at run end (runner export), so root and children usually share one batch.

## Analytics error handling (verified)

- `api/oss/src/apis/fastapi/tracing/router.py`: analytics handlers use `@suppress_exceptions(default=AnalyticsResponse())`, so any failure becomes an empty result. The dashboard (`web/packages/agenta-observability/src/api/dashboard.ts`) calls the spans analytics route.

## Turn usage (verified)

- `api/oss/src/dbs/postgres/sessions/turns/dbas.py`: `session_turns` has `trace_id`, `span_id`, `start_time`, `end_time`, no usage.
- `api/oss/src/core/sessions/turns/dtos.py` `SessionTurnComplete`: `session_id`, `turn_index`, `agent_session_id`, `end_time`; Pydantic default ignores unknown fields, so a newer runner sending usage to an older API is safe.
- Usage sources: the agent stream `finish` frame (`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`), runner `usage` session records, and ingest pricing (`calculate_costs`, `cumulate_costs` in `api/oss/src/core/tracing/utils/trees.py`).
- `web/packages/agenta-chat/src/components/TurnMetrics.tsx` reads the trace root first, then message usage.
