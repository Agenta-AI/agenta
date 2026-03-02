# Execution Plan: Best-Effort OTLP Ingestion

## Summary

This plan improves resilience across the OTLP ingestion pipeline in phases, from most targeted (field-level) to broader (per-span isolation). Each phase is independently valuable and can be shipped incrementally.

---

## Phase 1: JSON String Parsing for All Fields Except `outputs`

**Status**: DONE (already implemented)

**File**: `api/oss/src/apis/fastapi/tracing/utils.py`, function `initialize_ag_attributes`

**What**: Parse JSON strings back to dicts/lists for all data fields except `outputs`.

**Implementation**:
```python
if key != "outputs" and isinstance(value, str):
    try:
        parsed = loads(value)
        if isinstance(parsed, (dict, list)):
            value = parsed
    except (ValueError, TypeError):
        pass
```

**Why all fields except `outputs`**:
- `inputs`: Usually a dict/list, parse it
- `parameters`: Always a dict (model config, hyperparameters), parse it
- `internals`: Always a dict (internal state), parse it
- `outputs`: Can be a **plain string** (LLM completion text) - do NOT parse

---

## Phase 2: Field-Level Sanitization with Pydantic Fallback

**Status**: DONE

**File**: `api/oss/src/apis/fastapi/tracing/utils.py`, function `initialize_ag_attributes` (~line 460)

**Problem**: If `AgAttributes(**cleaned_ag)` Pydantic validation fails on ANY field, the exception propagates and the entire span is dropped.

**Implementation**:

```python
from pydantic import ValidationError

# Around line 460, where AgAttributes is instantiated:
try:
    ag_attrs = AgAttributes(**cleaned_ag)
except ValidationError as e:
    # Identify which fields failed
    failed_fields = set()
    for error in e.errors():
        if error["loc"]:
            # Get the top-level field name
            field_name = str(error["loc"][0])
            failed_fields.add(field_name)
    
    # Move failed fields to unsupported bucket
    for field in failed_fields:
        if field in cleaned_ag:
            unsupported[field] = cleaned_ag.pop(field)
            logger.warning(
                f"Moved invalid field '{field}' to ag.unsupported",
                extra={"field": field, "error": str(e)}
            )
    
    # Retry without the bad fields
    ag_attrs = AgAttributes(**cleaned_ag)
```

**Rationale**: This is a safety net after Phase 1. If JSON parsing fails or the parsed value still doesn't match the expected schema, we gracefully degrade instead of dropping the span.

---

## Phase 3: Per-Span Isolation in Router

**Status**: DONE

**File**: `api/oss/src/apis/fastapi/otlp/router.py`, lines 154-174

**Problem**: The list comprehension `[parse_from_otel_span_dto(s) for s in otel_spans]` is wrapped in a single try/except. One bad span causes HTTP 500 for the entire batch.

**Implementation**:

```python
# Replace list comprehension with explicit loop
spans = []
failed_count = 0
for otel_span in otel_spans:
    try:
        span = parse_from_otel_span_dto(otel_span)
        if span is not None:
            spans.append(span)
    except Exception as e:
        failed_count += 1
        logger.warning(
            "Failed to parse span, skipping",
            extra={
                "span_id": getattr(otel_span, "span_id", "unknown"),
                "trace_id": getattr(otel_span, "trace_id", "unknown"),
                "error": str(e),
            }
        )

if failed_count > 0:
    logger.info(f"Processed {len(spans)} spans, skipped {failed_count} failed spans")

# Only return 500 if ALL spans failed
if not spans and otel_spans:
    return create_otlp_response(500, "All spans failed to parse")
```

**Rationale**: This is the highest-impact change. One bad span should not kill unrelated good spans in the same batch.

---

## Phase 4: Per-Span Isolation in Protobuf Parsing

**Status**: DONE

**File**: `api/oss/src/apis/fastapi/otlp/opentelemetry/otlp.py`, lines 129-223

**Problem**: The span iteration loop has no per-span try/except. One malformed protobuf span kills ALL spans.

**Implementation**:

```python
# Inside the span iteration loop (for span in scope.spans)
for span in scope.spans:
    try:
        # existing span field extraction code...
        otel_span = OTelSpanDTO(...)
        otel_spans.append(otel_span)
    except Exception as e:
        logger.warning(
            "Failed to parse protobuf span, skipping",
            extra={"error": str(e)}
        )
        continue
```

**Note**: Protobuf-level per-span failures are comparatively rare in practice. This remains a defensive hardening layer and is lower priority than router-level per-span isolation.

---

## Phase 5: Adapter Registry Error Isolation

**Status**: DONE

**File**: `api/oss/src/apis/fastapi/otlp/extractors/adapter_registry.py`, lines 69-71

**Problem**: No try/except around adapter execution. A crashing adapter kills the entire batch.

**Implementation**:

```python
for adapter in self._adapters:
    try:
        adapter.process(attributes, features_obj)
    except Exception as e:
        logger.warning(
            f"Adapter {adapter.__class__.__name__} failed, continuing with other adapters",
            extra={"error": str(e)}
        )
        continue
```

**Rationale**: Adapters extract optional semantic conventions (OpenInference, OpenLLMetry, etc.). A failing adapter shouldn't prevent the span from being stored with whatever features were extracted by other adapters.

---

## Phase 6: Type/Enum Fallbacks

**Status**: DONE

**File**: `api/oss/src/apis/fastapi/tracing/utils.py`, ~line 585

**Problem**: `TraceType(value)` and `SpanType(value)` raise ValueError for unknown enum strings, dropping the span.

**Implementation**:

```python
# For trace type
try:
    trace_type = TraceType(ag["type"].get("trace")) if ag["type"].get("trace") else TraceType.INVOCATION
except ValueError:
    logger.warning(f"Unknown trace type '{ag['type'].get('trace')}', defaulting to INVOCATION")
    trace_type = TraceType.INVOCATION

# For span type
try:
    span_type = SpanType(ag["type"].get("span")) if ag["type"].get("span") else SpanType.TASK
except ValueError:
    logger.warning(f"Unknown span type '{ag['type'].get('span')}', defaulting to TASK")
    span_type = SpanType.TASK
```

**Rationale**: New span/trace types might be added. Old backends should gracefully handle unknown types from newer SDKs.

---

## Deferred Items (Future PRs)

| Item | Why Deferred | Recommended Approach |
|------|-------------|---------------------|
| Remove `@suppress_exceptions` on `TracingDAO.ingest` | High risk - could crash worker. Needs retry/DLQ. | Add DLQ first, then remove suppression. |
| Move ACK after DB write | Requires idempotency guarantees to handle duplicate processing. | Implement proper upsert semantics first. |
| S3-backed durability | Architectural change - upload to blob before queue. | Consider as a separate architecture initiative. |
| Dead letter queue | Needs infrastructure (Redis streams or separate queue). | Design and implement as separate feature. |
| Queue sharding | Scalability concern, not resilience. | Address when throughput becomes an issue. |
| Field truncation at DB layer | Oversized fields can fail persistence in some backends. | Consider if we hit similar issues. |

---

## PR Description Template

```markdown
## Summary

This PR improves the resilience of the OTLP trace ingestion pipeline by implementing best-effort parsing and per-span error isolation.

### Problem

OTel JS/TS SDKs send structured data as JSON strings (because `setAttribute()` only accepts primitives). The backend expected structured values for `ag.data.*` fields, causing validation to fail and **silently drop entire spans**.

More broadly, the pipeline had multiple places where a single bad field or span could cause disproportionate data loss.

### Changes

1. **JSON string parsing** for all `ag.data.*` fields except `outputs`
2. **Field-level sanitization**: Bad fields move to `ag.unsupported` instead of dropping the span
3. **Per-span isolation in router**: One bad span doesn't kill the batch
4. **Per-span isolation in protobuf parsing**: Defensive measure for malformed protos
5. **Adapter error isolation**: Failing adapters don't crash the pipeline
6. **Enum fallbacks**: Unknown trace/span types default gracefully

### Example/Docs Fixes

- Fixed `gpt-5` -> `gpt-4o-mini` in examples
- Added missing imports and packages in docs
- Fixed version numbers in README

### Testing

Verified on worktree deployment at `http://144.76.237.122:8480`:
- OTel JS example sends traces successfully
- Spans with JSON-stringified inputs/parameters/internals appear correctly in UI
- Malformed spans are skipped without affecting good spans

### Not in This PR

- Removing `@suppress_exceptions` from DAO (needs DLQ)
- Moving ACK after DB write (needs idempotency)
- S3-backed durability (architectural change)
```

---

## Implementation Order

All phases are implemented in this branch.
