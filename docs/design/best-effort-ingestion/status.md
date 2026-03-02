# Status: Best-Effort OTLP Ingestion

## Current State

**Branch**: `feat/otlp-best-effort-hardening`  
**PR**: https://github.com/Agenta-AI/agenta/pull/3857  
**Last Updated**: 2026-02-27  
**Status**: PR CREATED - Ready for review

---

## Progress Tracker

| Phase | Description | Status | Notes |
|-------|-------------|--------|-------|
| 1 | JSON parsing for `ag.data.*` except `outputs` | DONE | Handles JSON-stringified OTEL values for non-output fields |
| 2 | Field-level sanitization with Pydantic fallback | DONE | Invalid fields move to `ag.unsupported` instead of dropping span |
| 3 | Per-span isolation in OTLP router | DONE | One bad span no longer fails the whole batch |
| 4 | Per-span isolation in protobuf parsing | DONE | Malformed protobuf span is skipped; others continue |
| 5 | Adapter registry error isolation | DONE | One failing adapter no longer aborts feature extraction |
| 6 | Enum fallbacks for trace/span types | DONE | Unknown enum values fall back to INVOCATION/TASK |

---

## Implemented Changes

- Updated `api/oss/src/apis/fastapi/tracing/utils.py`:
  - Parse JSON for all `ag.data` fields except `outputs`
  - Catch `ValidationError` from `AgAttributes` and sanitize invalid fields into `ag.unsupported`
  - Added safe fallback to minimal `ag` block if repeated validation fails
  - Added enum fallbacks in `_parse_span_from_request`
- Updated `api/oss/src/apis/fastapi/otlp/router.py`:
  - Replaced all-or-nothing span parsing with per-span isolation
- Updated `api/oss/src/apis/fastapi/otlp/opentelemetry/otlp.py`:
  - Added per-span isolation in protobuf parsing loop
- Updated `api/oss/src/apis/fastapi/otlp/extractors/adapter_registry.py`:
  - Added per-adapter try/except isolation

---

## Added Unit Tests

- `api/oss/tests/pytest/unit/tracing/test_utils.py`
  - JSON parsing behavior for `ag.data` fields
  - `outputs` remains raw string
  - invalid `ag.data` values are sanitized into `ag.unsupported`
  - invalid trace/span enum values fall back safely
- `api/oss/tests/pytest/unit/otlp/test_adapter_registry.py`
  - adapter failures do not stop subsequent adapters
- `api/oss/tests/pytest/unit/otlp/test_parse_otlp_stream.py`
  - malformed span in protobuf payload is skipped
- `api/oss/tests/pytest/unit/otlp/test_otlp_router.py`
  - one span failure in request still queues successful spans

---

## Deferred for Follow-Up PRs

1. Remove `@suppress_exceptions` from DAO ingest path
2. Move worker ACK to post-persistence success
3. Add ingestion DLQ and retry policy improvements
4. Optional blob-store-backed durability (S3-style pattern)
