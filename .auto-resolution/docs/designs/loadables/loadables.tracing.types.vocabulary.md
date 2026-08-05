# Loadables / Trace + Span Type Vocabulary And Usage Map

Status: draft for alignment  

---

## 1) Shared Vocabulary

### 1.1 New Types

| Name | Definition | Shape | Meaning |
|---|---|---|---|
| `Trace` | `TraceID(trace_id) + SpansTree(spans)` | Object | Canonical single-trace endpoint payload |
| `Traces` | `List[Trace]` | Array | Canonical multi-trace endpoint payload |
| `Span` | Agenta-specific opentelemetry span | Object | Canonical single-span endpoint payload |
| `Spans` | `List[Span]` | Array | Canonical multi-span endpoint payload |
| `SpansTree` | `{ spans?: Dict[span_name, SpansNode \| List[SpansNode]] }` | Object | Canonical recursive spans tree |
| `SpansNode` | `Span + SpansTree` | Object | Canonical recursive spans node |

### 1.2 Legacy Types

| Name | Definition | Shape | Meaning |
|---|---|---|---|
| `OTelTraceTree` | `Dict[str, OTelSpansTree]` | Object map | Multi-trace payload keyed by `trace_id` |
| `OTelTraceTrees` | `List[OTelTraceTree]` | Array of maps | Legacy alias |
| `OTelFlatSpan` | Legacy alias of `Span` | Object | Single flat span |
| `OTelFlatSpans` | `List[OTelFlatSpan]` | Array | Flat span payload |
| `OTelSpansTree` | Alias of `SpansTree` | Object | Legacy trace tree name |
| `OTelNestedSpans` | Alias of `NestedSpans` | Object map | Legacy nested spans name |
| `NestedSpans` | Alias of `Dict[str, SpansNode \| List[SpansNode]]` | Object map | Legacy compatibility alias |

### 1.3 Gap

| Surface | Legacy | New | Gap |
|---|---|---|---|
| Naming in docs | `OTelFlatSpan/OTelFlatSpans` used externally | `Span/Spans` are canonical (`OTelFlat*` are compatibility aliases) | Continue replacing legacy names in external docs/examples |
| API transport | map-based traces appear on legacy routers | list-based traces on `/traces/*` and `/spans/*` | Keep map shape only on legacy `/tracing/*` and `/tracing/*` |
| Web typings | map-shaped `TracesResponse` in `web/oss/src/services/tracing/types/index.ts` | list-first target | Web types/helpers/schema migration is still pending |

---

## 2) JSON Shapes

### 2.1 New Shapes

New trace payload (`Trace`):

```json
{
  "count": 1,
  "trace": {
    "trace_id": "t1",
    "spans": {
      "root": { "trace_id": "t1", "span_id": "s1" }
    }
  }
}
```

New traces payload (`Traces`):

```json
{
  "count": 2,
  "traces": [
    {
      "trace_id": "t1",
      "spans": {
        "root": { "trace_id": "t1", "span_id": "s1" }
      }
    },
    {
      "trace_id": "t2",
      "spans": {
        "root": { "trace_id": "t2", "span_id": "s2" }
      }
    }
  ]
}
```

New span payload (`Span`):

```json
{
  "count": 1,
  "span": { "trace_id": "t1", "span_id": "s1", "parent_id": null }
}
```

New spans payload (`Spans`):

```json
{
  "count": 2,
  "spans": [
    { "trace_id": "t1", "span_id": "s1", "parent_id": null },
    { "trace_id": "t1", "span_id": "s2", "parent_id": "s1" }
  ]
}
```

### 2.2 Legacy Shapes

Legacy trace payload (`OTelTraceTree`):

```json
{
  "count": 2,
  "traces": {
    "t1": { "spans": { "root": { "trace_id": "t1", "span_id": "s1" } } },
    "t2": { "spans": { "root": { "trace_id": "t2", "span_id": "s2" } } }
  }
}
```

Legacy spans payload (`OTelFlatSpans`):

```json
{
  "count": 2,
  "spans": [
    { "trace_id": "t1", "span_id": "s1", "parent_id": null },
    { "trace_id": "t1", "span_id": "s2", "parent_id": "s1" }
  ]
}
```

### 2.3 Gap

| Surface | Legacy | New | Gap |
|---|---|---|---|
| Flat spans payload label | `OTelFlatSpans` | `Spans` | Old naming still appears in some sections/docs |
| Trace payload shape | map (`traces: {id: tree}`) | list (`traces: Trace[]`) | Legacy traces endpoint still emits map |

---

## 3) API Endpoint Contracts

### 3.1 New Endpoints

#### 3.1.1 Traces (`/traces/*`)

| Endpoint | Contract |
|---|---|
| `POST /traces/` | `TraceIdResponse` (request: `trace: Trace`) |
| `GET /traces/{trace_id}` | `TraceResponse` (`trace: Trace`) |
| `PUT /traces/{trace_id}` | `TraceIdResponse` (request: `trace: Trace`) |
| `DELETE /traces/{trace_id}` | `TraceIdResponse` |
| `GET /traces/?trace_ids=...` | `TracesResponse` (`traces: Traces`) |
| `POST /traces/query` | `TracesResponse` (`traces: Traces`) |
| `POST /traces/ingest` | **Deprecated.** Use OTLP (`POST /otlp/v1/traces`) for batch ingestion or `POST /traces/` for single create. |

#### 3.1.2 Spans (`/spans/*`)

| Endpoint | Contract |
|---|---|
| `GET /spans/{trace_id}/{span_id}` | `SpanResponse` (`span: Span`) |
| `GET /spans/?trace_ids=...&span_ids=...` | `SpansResponse` (`spans: Spans`) |
| `POST /spans/query` | `SpansResponse` (`spans: Spans`) |
| `POST /spans/analytics/query` | `AnalyticsResponse` |
| `POST /spans/sessions/query` | `SessionIdsResponse` |
| `POST /spans/users/query` | `UserIdsResponse` |

The only canonical ingestion paths are OTLP (`POST /otlp/v1/traces`) and per-trace create (`POST /traces/`). `POST /spans/ingest` is deprecated under the legacy `/tracing/spans/ingest`; there is no flat `/spans/ingest`.

### 3.2 Existing and Legacy Endpoint Groups

#### 3.2.1 OTLP (`/otlp/v1/*`)

| Endpoint | Contract |
|---|---|
| `GET /otlp/v1/traces` | `CollectStatusResponse` |
| `POST /otlp/v1/traces` | OTLP protobuf `ExportTraceServiceResponse` bytes |

#### 3.2.2 Tracing (`/tracing/*`) — fully deprecated

The entire `/tracing/*` mount is deprecated in favor of the flat `/spans/*` and `/traces/*` surfaces. Routes remain functional but are tagged `Deprecated` and excluded from SDK regeneration.

| Endpoint | Replacement |
|---|---|
| `POST /tracing/analytics/query` | `POST /spans/analytics/query` |
| `POST /tracing/sessions/query` | `POST /spans/sessions/query` |
| `POST /tracing/users/query` | `POST /spans/users/query` |
| `POST /tracing/spans/query` | `POST /spans/query` |
| `POST /tracing/spans/ingest` | OTLP (`POST /otlp/v1/traces`) or `POST /traces/` |
| `POST /tracing/spans/analytics` | `POST /spans/analytics/query` (legacy analytics shape, `OldAnalyticsResponse`, fixed metrics) |
| `POST /tracing/traces/` | `POST /traces/` |
| `GET /tracing/traces/{trace_id}` | `GET /traces/{trace_id}` |
| `PUT /tracing/traces/{trace_id}` | `PUT /traces/{trace_id}` |
| `DELETE /tracing/traces/{trace_id}` | `DELETE /traces/{trace_id}` |

### 3.3 Gap

| Surface | Legacy | New | Gap |
|---|---|---|---|
| Route families | `/tracing/*` mixes non-deprecated subset + legacy/deprecated subset, and `/tracing/*` remains deprecated alias | `/traces/*`, `/spans/*` deterministic semantics | Keep migration boundary explicit in docs and clients |
| Internal parser | `parse_spans_into_response` can emit map/list | new routers normalize shape | Still two-shape internals for legacy compatibility |

---

## 4) Query Revision Contracts

### 4.1 New Contracts

| Surface | New contract |
|---|---|
| `QueryRevisionData.trace_ids` | Keep as `Optional[List[str]]` for lightweight retrieval |
| `QueryRevisionData.traces` | `Optional[Traces]` |
| `_populate_traces(...)` | builds `List[Trace]` |

### 4.2 Legacy Contracts

| Surface | Legacy contract |
|---|---|
| `QueryRevisionData.trace_ids` | `Optional[List[str]]` |
| `QueryRevisionData.traces` | previously map-style in old flows |

### 4.3 Gap

| Surface | Legacy | New | Gap |
|---|---|---|---|
| Query revision hydration | mixed historical shapes | `Traces` list | Verify all downstream consumers treat it as list |

---

## 5) Internal Consumers

### 5.1 New Consumers

| Consumer | New pattern |
|---|---|
| Invocations | `TraceResponse.trace` and `TracesResponse.traces` |
| Annotations | `TraceResponse.trace` and `TracesResponse.traces` |
| Live evaluations | `Dict[str, Traces]`, derive ids from `trace.trace_id` |

### 5.2 Legacy Consumers

| Consumer | Legacy pattern |
|---|---|
| Invocations | map-first trace reads (`response.traces` map) |
| Annotations | map-first trace reads (`response.traces` map) |
| Live evaluations | per-step traces as map keyed by trace id |

### 5.3 Gap

| Surface | Legacy | New | Gap |
|---|---|---|---|
| `core/evaluations/tasks/legacy.py` | legacy map-like traversal | list-first target | Legacy task still needs migration decision |

---

## 6) Span Contracts

### 6.1 New Contracts

| Surface | New contract |
|---|---|
| Top-level `spans` naming | `Spans` (alias of `OTelFlatSpans`) |
| Single span payload | `span: Span` |
| Span routes | `/spans/*` deterministic span-focused contracts |

### 6.2 Legacy Contracts

| Surface | Legacy contract |
|---|---|
| Top-level `spans` naming | usually documented as `OTelFlatSpans` |
| Legacy query endpoint | `POST /tracing/spans/query` may return traces or spans |

### 6.3 Gap

| Surface | Legacy | New | Gap |
|---|---|---|---|
| Documentation wording | `OTelFlatSpans` wording still appears in places | `Spans` wording | Continue replacing legacy wording in remaining docs |
| Legacy span query behavior | polymorphic | deterministic routes | Keep legacy endpoint for compatibility only |

---

## 7) Web + SDK Surface Mapping

### 7.1 New Mapping

| Surface | New usage |
|---|---|
| SDK shared | `Trace`, `Traces` canonical |
| SDK tracing | `Span`, `Spans` aliases added |
| API tracing models | `Trace/Traces` and `Span/Spans` response/request models |

### 7.2 Legacy Mapping

| Surface | Legacy usage |
|---|---|
| `web/oss/src/services/tracing/types/index.ts` | `traces` as record map |
| `web/packages/agenta-entities/src/trace/core/schema.ts` | schema expects trace map |
| helpers | `Object.values(data.traces)` map-to-array conversion |

### 7.3 Gap

| Surface | Legacy | New | Gap |
|---|---|---|---|
| Web schema/types | map contracts | list contracts | Web migration not complete |
| SDK observability tests | some tests still read map (`traces.values()`) | list-first API | Test updates pending |

---

## 8) Migration Sequence

1. Keep `/tracing/*` stable for compatibility.
2. Move consumers to `/traces/*` and `/spans/*` contracts.
3. Migrate web types/helpers from trace map to trace list.
4. Migrate remaining legacy internal consumers (`evaluations/utils`, legacy tasks).
5. Treat `OTelTraceTree` as compatibility only; avoid new uses.

---

## 9) Practical Rules

1. Use `trace: Trace` for single trace payloads.
2. Use `traces: Traces` for multi-trace payloads.
3. Use `span: Span` for single span payloads.
4. Use `spans: Spans` for multi-span payloads.
5. Use `trace.spans: Dict[str, SpansNode \| List[SpansNode]]` for nested tree representation.
6. In `trace.spans`, each map key is a `span_name`; repeated names are represented as `List[SpansNode]` under the same key.
7. Restrict `OTelTraceTree` to legacy compatibility boundaries.

---

## 10) Endpoint Inventory

### 10.1 OTLP endpoints (`/otlp/v1/*`)

| Method | Path | Request type | Response type |
|---|---|---|---|
| `GET` | `/otlp/v1/traces` | none | `CollectStatusResponse` |
| `POST` | `/otlp/v1/traces` | OTLP protobuf stream (`application/x-protobuf`) | OTLP protobuf `ExportTraceServiceResponse` bytes (`application/x-protobuf`) |

### 10.2 Legacy `/tracing/*` mount (fully deprecated)

The entire mount is tagged `Deprecated` and excluded from SDK regeneration. Routes still respond. Replacements live under `/spans/*` and `/traces/*`.

| Method | Path | Request type | Response type | Replacement |
| --- | --- | --- | --- | --- |
| `POST` | `/tracing/spans/ingest` | `OTelTracingRequest` | `OTelLinksResponse` | OTLP `POST /otlp/v1/traces` or `POST /traces/` |
| `POST` | `/tracing/spans/query` | `TracingQuery` (params/body) | `OTelTracingResponse` | `POST /spans/query` |
| `POST` | `/tracing/spans/analytics` | `TracingQuery` | `OldAnalyticsResponse` | `POST /spans/analytics/query` (legacy fixed-metric shape replaced by spec-based) |
| `POST` | `/tracing/analytics/query` | `TracingQuery + List[MetricSpec]` | `AnalyticsResponse` | `POST /spans/analytics/query` |
| `POST` | `/tracing/traces/` | `OTelTracingRequest` | `OTelLinksResponse` | `POST /traces/` |
| `GET` | `/tracing/traces/{trace_id}` | path `trace_id` | `OTelTracingResponse` | `GET /traces/{trace_id}` |
| `PUT` | `/tracing/traces/{trace_id}` | `OTelTracingRequest` | `OTelLinksResponse` | `PUT /traces/{trace_id}` |
| `DELETE` | `/tracing/traces/{trace_id}` | path `trace_id` | `OTelLinksResponse` | `DELETE /traces/{trace_id}` |
| `POST` | `/tracing/sessions/query` | `SessionsQueryRequest` | `SessionIdsResponse` | `POST /spans/sessions/query` |
| `POST` | `/tracing/users/query` | `UsersQueryRequest` | `UserIdsResponse` | `POST /spans/users/query` |

### 10.3 Canonical traces endpoints (`/traces/*`)

| Method | Path | Request type | Response type | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/traces/` | `TraceRequest` | `TraceIdResponse` | Synchronous create |
| `GET` | `/traces/{trace_id}` | path `trace_id` | `TraceResponse` | |
| `PUT` | `/traces/{trace_id}` | `TraceRequest` | `TraceIdResponse` | |
| `DELETE` | `/traces/{trace_id}` | path `trace_id` | `TraceIdResponse` | |
| `GET` | `/traces/` | query `trace_id[]` and/or `trace_ids` | `TracesResponse` | |
| `POST` | `/traces/query` | `TracesQueryRequest` | `TracesResponse` | |
| `POST` | `/traces/ingest` | `TracesRequest` | `TraceIdsResponse` | **Deprecated.** Use OTLP or `POST /traces/`. |

### 10.4 Canonical spans endpoints (`/spans/*`)

| Method | Path | Request type | Response type |
| --- | --- | --- | --- |
| `GET` | `/spans/{trace_id}/{span_id}` | path `trace_id`, `span_id` | `SpanResponse` |
| `GET` | `/spans/` | query `trace_id[]` and/or `trace_ids` and/or `span_id[]` and/or `span_ids` | `SpansResponse` |
| `POST` | `/spans/query` | `SpansQueryRequest` | `SpansResponse` |
| `POST` | `/spans/analytics/query` | `TracingQuery + List[MetricSpec]` (params/body) | `AnalyticsResponse` |
| `POST` | `/spans/sessions/query` | `SessionsQueryRequest` | `SessionIdsResponse` |
| `POST` | `/spans/users/query` | `UsersQueryRequest` | `UserIdsResponse` |

There is no `/spans/ingest` and no `POST /spans/`. Span-level write endpoints were folded into trace-level operations and OTLP.

---

## 11) Appendix: Main Files Referenced

- `api/oss/src/apis/fastapi/tracing/models.py`
- `api/oss/src/apis/fastapi/tracing/router.py`
- `api/oss/src/apis/fastapi/tracing/utils.py`
- `api/oss/src/core/tracing/dtos.py`
- `api/oss/src/core/queries/dtos.py`
- `api/oss/src/core/queries/service.py`
- `api/oss/src/core/annotations/service.py`
- `api/oss/src/core/invocations/service.py`
- `api/oss/src/core/evaluations/tasks/live.py`
- `api/oss/src/core/evaluations/utils.py`
- `sdk/agenta/sdk/models/shared.py`
- `sdk/agenta/sdk/models/tracing.py`
- `web/oss/src/services/tracing/types/index.ts`
- `web/oss/src/services/tracing/lib/helpers.ts`
- `web/packages/agenta-entities/src/trace/core/schema.ts`
- `web/packages/agenta-entities/src/trace/api/helpers.ts`
