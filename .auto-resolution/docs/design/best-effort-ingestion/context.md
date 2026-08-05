# Context: Best-Effort OTLP Ingestion

## Problem Statement

Agenta's OTLP trace ingestion pipeline has multiple failure points where a single bad field or span can cause disproportionate data loss:

1. **JSON-stringified attributes rejected**: OTel JS/TS SDKs can only set primitive attributes (string/number/boolean). Structured `ag.data.*` values often arrive JSON-stringified. Strict validation caused entire spans to be dropped.

2. **No per-span isolation**: In several pipeline stages, one malformed span causes the entire batch of all spans to fail (HTTP 500).

3. **Silent span drops**: Many validation/parsing failures result in the span returning `None` and being silently filtered out with no error signal.

4. **Worker ACKs before DB write**: The async worker ACKs messages during deserialization, before the DB write succeeds. Failed DB writes still result in ACK, permanently losing spans.

5. **`@suppress_exceptions` on DAO**: The `TracingDAO.ingest` method swallows ALL exceptions and returns `[]`. Any DB error is silent, and spans are permanently lost.

## Root Cause: OTel Attribute Type Constraints

The OpenTelemetry JS SDK's `setAttribute()` method only accepts primitives:

```typescript
// From @opentelemetry/api types
type AttributeValue = string | number | boolean | Array<string | number | boolean>;
```

The OTLP protocol supports nested maps via `AnyValue.kvlist_value` in protobuf, but the JS SDK API doesn't expose this through `setAttribute()`. **JSON-stringifying structured data is the standard pattern** for JS/TS OTel users.

## Why `outputs` Should NOT Be JSON-Parsed

- `outputs` can legitimately be a plain string (e.g., LLM completion text from OpenInference's `output.value`)
- The frontend already handles string-valued outputs via `JSON.parse` in `getValueAtPath`
- Parsing server-side would change the stored type, potentially breaking downstream rendering
- Non-output `ag.data.*` fields are parsed best-effort when they are JSON strings

## Goals

1. **Field-level resilience**: If a single field fails to parse/validate, drop/sanitize just that field, not the entire span
2. **Per-span isolation**: If one span in a batch fails, process the rest successfully
3. **Graceful degradation**: Optional enrichments (metrics, costs, evals) should fail silently without affecting core span storage
4. **Visibility**: Log warnings for dropped/sanitized data so operators can diagnose issues
5. **No data shape changes**: Don't change the semantics of existing fields (especially `inputs`/`outputs`)

## Non-Goals (Deferred to Follow-up PRs)

1. **Removing `@suppress_exceptions` from DAO**: Needs careful design with retry/DLQ strategy
2. **Moving ACK after DB write**: Requires worker refactor with idempotency guarantees
3. **S3-backed durability**: Upload events to blob storage before queuing (external reference pattern)
4. **Dead letter queue**: Proper DLQ for permanently failed spans
5. **Queue sharding**: Horizontal scalability for high-throughput ingestion

## Success Criteria

- OTel JS examples work out of the box without span drops
- A malformed span doesn't kill the entire batch
- A bad field doesn't kill the entire span
- Operators can see warnings about sanitized/dropped data in logs
