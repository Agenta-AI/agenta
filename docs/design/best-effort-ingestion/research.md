# Research: Pipeline Analysis

## OTLP Ingestion Pipeline Failure Analysis

A full trace-through of Agenta's OTLP ingestion identified critical points where one bad field or span can cause larger data loss than intended.

### Pipeline Overview

The ingestion path has two phases:

1. **Synchronous phase (HTTP route):** receives OTLP payload, parses protobuf, transforms spans, publishes to Redis stream, returns response.
2. **Asynchronous phase (worker):** consumes stream entries, deserializes, checks entitlements, writes to Postgres.

### Highest-Risk Failure Points (ranked)

| Rank | Stage | Component | Error Type | Scope of Loss | Silent? | Retryable? |
|------|-------|-----------|-----------|---------------|---------|------------|
| 1 | 8.1 | `@suppress_exceptions` on `TracingDAO.ingest` | Any DB error | Entire project batch | Yes | No (ACKed) |
| 2 | 1.5 | Router list-comprehension parsing | Any span parse error | Entire request batch | No (500) | Yes (client retry) |
| 3 | 2.3 | Protobuf per-span parsing | Malformed span | Entire request batch | No (500) | Yes (client retry) |
| 4 | 3B.1 | Adapter registry | Adapter crash | Entire request batch | No (500) | Yes (client retry) |
| 5 | 7.3-7.4 | Worker ACK timing | DB/write failure | Project/org spans | Yes | No (ACKed) |

### Stage-by-Stage Summary

#### Stage 1: OTLP HTTP Route (`otlp/router.py`)

- request body read failure -> `400`
- payload too large -> `413`
- protobuf parse failure -> `500`
- span transformation had all-or-nothing behavior before hardening
- stream publish failure -> `500`

#### Stage 2: Protobuf Parsing (`otlp/opentelemetry/otlp.py`)

- decompression errors were logged; parse could fail downstream
- no per-span guard in parser loop before hardening
- `_decode_value` unknown cases degraded to string output

#### Stage 3: Feature/Builder Processing

- adapter failures previously propagated and dropped batch
- builder failures could produce silent span drop (`None` filtered out)

#### Stage 4: Final Span Preparation (`tracing/utils.py`)

- strict `AgAttributes` validation could drop whole span
- enum parsing could raise on unknown values
- reference/event parsing failures could drop span

#### Stage 7-8: Worker + DAO

- deserialization failures are ACKed (dropped permanently)
- entitlement check failures can drop org batch
- DAO exception suppression can hide DB failures

## Reference Patterns Considered

External ingestion systems commonly use these resilience patterns:

1. per-span isolation over per-batch failure
2. fail-open parsing for optional fields
3. retry with backoff and DLQ for persistence failures
4. optional truncation for oversized fields
5. strict visibility via structured warnings

## Applied in This PR

1. field-level sanitization in `initialize_ag_attributes`
2. JSON string parsing for `ag.data.*` except `outputs`
3. per-span isolation in OTLP router
4. per-span isolation in protobuf parser loop
5. per-adapter isolation in adapter registry
6. enum fallback for invalid trace/span type values

## Deferred for Follow-Up

1. remove DAO-level broad exception suppression
2. move ACK after confirmed persistence
3. DLQ/retry policy improvements
4. optional blob-backed durability for ingestion events
