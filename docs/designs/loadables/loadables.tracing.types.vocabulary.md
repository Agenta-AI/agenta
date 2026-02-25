# Loadables / Trace + Span Type Vocabulary And Usage Map

Status: draft for alignment  

---

## 1) Shared Vocabulary

### 1.1 Legacy

| Name | Definition | Shape | Meaning |
|---|---|---|---|
| `OTelTraceTree` | `Dict[str, OTelSpansTree]` | Object map | Multi-trace payload keyed by `trace_id` |
| `OTelTraceTrees` | `List[OTelTraceTree]` | Array of maps | Legacy alias |
| `OTelFlatSpan` | Flat span record | Object | Single flat span |
| `OTelFlatSpans` | `List[OTelFlatSpan]` | Array | Flat span payload |

### 1.2 New

| Name | Definition | Shape | Meaning |
|---|---|---|---|
| `Trace` | `TraceID(trace_id) + OTelSpansTree(spans)` | Object | Canonical single trace payload |
| `Traces` | `List[Trace]` | Array | Canonical multi-trace payload |
| `Span` | Alias of `OTelFlatSpan` | Object | Canonical single span payload |
| `Spans` | Alias of `OTelFlatSpans` | Array | Canonical multi-span payload |
| `OTelSpansTree` | `{ spans?: OTelNestedSpans }` | Object | Trace tree body |
| `OTelNestedSpans` | `Dict[str, OTelSpan \| List[OTelSpan]]` | Object map | Nested children inside one trace |

### 1.3 Gap

| Surface | Legacy | New | Gap |
|---|---|---|---|
| Naming in docs | `OTelFlatSpans` used as external name | `Spans` used as external name (alias in code) | Update all external docs/examples to prefer `Span/Spans` |
| API transport | map-based traces appear on legacy routes | list-based traces on `/preview/traces/*` | Keep map only on legacy `/preview/tracing/*` |
| Web typings | map assumptions in some packages | list-first target | Migration still pending in web helpers/schema |

---

## 2) JSON Shapes

### 2.1 Legacy

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

### 2.2 New

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

### 2.3 Gap

| Surface | Legacy | New | Gap |
|---|---|---|---|
| Flat spans payload label | `OTelFlatSpans` | `Spans` | Old naming still appears in some sections/docs |
| Trace payload shape | map (`traces: {id: tree}`) | list (`traces: Trace[]`) | Legacy traces endpoint still emits map |

---

## 3) API Endpoint Contracts

### 3.1 Legacy endpoints (`/preview/tracing/*`)

| Endpoint | Legacy contract |
|---|---|
| `POST /preview/tracing/spans/query` | `OTelTracingResponse` (polymorphic: `spans` or `traces`) |
| `GET /preview/tracing/traces/{trace_id}` | `OTelTracingResponse.traces` map |
| `POST /preview/tracing/traces/` | `OTelLinksResponse` |
| `PUT /preview/tracing/traces/{trace_id}` | `OTelLinksResponse` |

### 3.2 New trace endpoints (`/preview/traces/*`)

| Endpoint | New contract |
|---|---|
| `POST /preview/traces/query` | `TracesResponse` (`traces: Traces`) |
| `GET /preview/traces?trace_ids=...` | `TracesResponse` (`traces: Traces`) |
| `GET /preview/traces/{trace_id}` | `TraceResponse` (`trace: Trace`) |
| `POST /preview/traces/ingest` | `TraceIdsResponse` (request: `traces: Traces`) |
| `POST /preview/traces/` | `TraceIdResponse` (request: `trace: Trace`) |

### 3.3 New span endpoints (`/preview/spans/*`)

| Endpoint | New contract |
|---|---|
| `POST /preview/spans/query` | `SpansResponse` (`spans: Spans`) |
| `GET /preview/spans?span_ids=...` | `SpansResponse` (`spans: Spans`) |
| `GET /preview/spans/{span_id}` | `SpanResponse` (`span: Span`); optional `?trace_id=` for disambiguation, otherwise `409` when ambiguous |
| `POST /preview/spans/ingest` | `SpanIdsResponse` (request: `spans: Spans`) |
| `POST /preview/spans/` | `SpanIdResponse` (request: `span: Span`) |

### 3.4 Gap

| Surface | Legacy | New | Gap |
|---|---|---|---|
| Route families | `/preview/tracing/*` mixed semantics | `/preview/traces/*`, `/preview/spans/*` deterministic semantics | Keep migration boundary explicit in docs and clients |
| Internal parser | `parse_spans_into_response` can emit map/list | new routers normalize shape | Still two-shape internals for legacy compatibility |

---

## 4) Query Revision Contracts

### 4.1 Legacy

| Surface | Legacy contract |
|---|---|
| `QueryRevisionData.trace_ids` | `Optional[List[str]]` |
| `QueryRevisionData.traces` | previously map-style in old flows |

### 4.2 New

| Surface | New contract |
|---|---|
| `QueryRevisionData.trace_ids` | Keep as `Optional[List[str]]` for lightweight retrieval |
| `QueryRevisionData.traces` | `Optional[Traces]` |
| `_populate_traces(...)` | builds `List[Trace]` |

### 4.3 Gap

| Surface | Legacy | New | Gap |
|---|---|---|---|
| Query revision hydration | mixed historical shapes | `Traces` list | Verify all downstream consumers treat it as list |

---

## 5) Internal Consumers

### 5.1 Legacy

| Consumer | Legacy pattern |
|---|---|
| Invocations | map-first trace reads (`response.traces` map) |
| Annotations | map-first trace reads (`response.traces` map) |
| Live evaluations | per-step traces as map keyed by trace id |

### 5.2 New

| Consumer | New pattern |
|---|---|
| Invocations | `TraceResponse.trace` and `TracesResponse.traces` |
| Annotations | `TraceResponse.trace` and `TracesResponse.traces` |
| Live evaluations | `Dict[str, Traces]`, derive ids from `trace.trace_id` |

### 5.3 Gap

| Surface | Legacy | New | Gap |
|---|---|---|---|
| `core/evaluations/utils.fetch_trace` | still reads `response.traces.values()` | target is `TraceResponse.trace` | Not migrated yet |
| `core/evaluations/tasks/legacy.py` | legacy map-like traversal | list-first target | Legacy task still needs migration decision |

---

## 6) Span Contracts

### 6.1 Legacy

| Surface | Legacy contract |
|---|---|
| Top-level `spans` naming | usually documented as `OTelFlatSpans` |
| Legacy query endpoint | `POST /preview/tracing/spans/query` may return traces or spans |

### 6.2 New

| Surface | New contract |
|---|---|
| Top-level `spans` naming | `Spans` (alias of `OTelFlatSpans`) |
| Single span payload | `span: Span` |
| Span routes | `/preview/spans/*` deterministic span-focused contracts |

### 6.3 Gap

| Surface | Legacy | New | Gap |
|---|---|---|---|
| Documentation wording | `OTelFlatSpans` wording still appears in places | `Spans` wording | Continue replacing legacy wording in remaining docs |
| Legacy span query behavior | polymorphic | deterministic routes | Keep legacy endpoint for compatibility only |

---

## 7) Web + SDK Surface Mapping

### 7.1 Legacy

| Surface | Legacy usage |
|---|---|
| `web/oss/src/services/tracing/types/index.ts` | `traces` as record map |
| `web/packages/agenta-entities/src/trace/core/schema.ts` | schema expects trace map |
| helpers | `Object.values(data.traces)` map-to-array conversion |

### 7.2 New

| Surface | New usage |
|---|---|
| SDK shared | `Trace`, `Traces` canonical |
| SDK tracing | `Span`, `Spans` aliases added |
| API tracing models | `Trace/Traces` and `Span/Spans` response/request models |

### 7.3 Gap

| Surface | Legacy | New | Gap |
|---|---|---|---|
| Web schema/types | map contracts | list contracts | Web migration not complete |
| SDK observability tests | some tests still read map (`traces.values()`) | list-first API | Test updates pending |

---

## 8) Migration Sequence

1. Keep `/preview/tracing/*` stable for compatibility.
2. Move consumers to `/preview/traces/*` and `/preview/spans/*` contracts.
3. Migrate web types/helpers from trace map to trace list.
4. Migrate remaining legacy internal consumers (`evaluations/utils`, legacy tasks).
5. Treat `OTelTraceTree` as compatibility only; avoid new uses.

---

## 9) Practical Rules

1. Use `trace: Trace` for single trace payloads.
2. Use `traces: Traces` for multi-trace payloads.
3. Use `span: Span` for single span payloads.
4. Use `spans: Spans` for multi-span payloads.
5. Use `trace.spans: OTelNestedSpans` only for nested tree representation.
6. Restrict `OTelTraceTree` to legacy compatibility boundaries.

---

## 10) Endpoint Inventory

### 10.1 OTLP endpoints (`/otlp/v1/*`)

| Method | Path | Request type | Response type |
|---|---|---|---|
| `GET` | `/otlp/v1/traces` | none | `CollectStatusResponse` |
| `POST` | `/otlp/v1/traces` | OTLP protobuf stream (`application/x-protobuf`) | OTLP protobuf `ExportTraceServiceResponse` bytes (`application/x-protobuf`) |

### 10.2 Legacy tracing endpoints (`/preview/tracing/*`)

Same router is also mounted at `/tracing/*`.

| Method | Path | Request type | Response type |
|---|---|---|---|
| `POST` | `/preview/tracing/spans/ingest` | `OTelTracingRequest` | `OTelLinksResponse` |
| `POST` | `/preview/tracing/spans/query` | `TracingQuery` (params/body) | `OTelTracingResponse` |
| `POST` | `/preview/tracing/spans/analytics` | `TracingQuery` | `OldAnalyticsResponse` |
| `POST` | `/preview/tracing/analytics/query` | `TracingQuery + List[MetricSpec]` | `AnalyticsResponse` |
| `POST` | `/preview/tracing/traces/` | `OTelTracingRequest` | `OTelLinksResponse` |
| `GET` | `/preview/tracing/traces/{trace_id}` | path `trace_id` | `OTelTracingResponse` |
| `PUT` | `/preview/tracing/traces/{trace_id}` | `OTelTracingRequest` | `OTelLinksResponse` |
| `DELETE` | `/preview/tracing/traces/{trace_id}` | path `trace_id` | `OTelLinksResponse` |
| `POST` | `/preview/tracing/sessions/query` | `SessionsQueryRequest` | `SessionIdsResponse` |
| `POST` | `/preview/tracing/users/query` | `UsersQueryRequest` | `UserIdsResponse` |

### 10.3 New traces endpoints (`/preview/traces/*`)

| Method | Path | Request type | Response type |
|---|---|---|---|
| `GET` | `/preview/traces/` | query `trace_id[]` and/or `trace_ids` | `TracesResponse` |
| `POST` | `/preview/traces/query` | `TracesQueryRequest` | `TracesResponse` |
| `POST` | `/preview/traces/ingest` | `TracesRequest` | `TraceIdsResponse` |
| `GET` | `/preview/traces/{trace_id}` | path `trace_id` | `TraceResponse` |
| `POST` | `/preview/traces/` | `TraceRequest` | `TraceIdResponse` |

### 10.4 New spans endpoints (`/preview/spans/*`)

| Method | Path | Request type | Response type |
|---|---|---|---|
| `GET` | `/preview/spans/` | query `span_id[]` and/or `span_ids` (optional trace filters: `trace_id[]`/`trace_ids`) | `SpansResponse` |
| `POST` | `/preview/spans/query` | `SpansQueryRequest` | `SpansResponse` |
| `POST` | `/preview/spans/ingest` | `SpansRequest` | `SpanIdsResponse` |
| `GET` | `/preview/spans/{span_id}` | path `span_id`; optional `?trace_id=` for disambiguation | `SpanResponse` (`409` when ambiguous) |
| `POST` | `/preview/spans/` | `SpanRequest` | `SpanIdResponse` |

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
