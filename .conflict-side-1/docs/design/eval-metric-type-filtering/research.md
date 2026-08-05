# Research

## Backend metric type inference

The backend infers metric types in `api/oss/src/core/evaluations/service.py` during `_refresh_metrics()`.

### Type inference flow

1. For evaluators with explicit schemas, types come from `get_metrics_keys_from_schema()` in `api/oss/src/core/evaluations/utils.py:87`.

2. For evaluators without schemas (like SDK-based DeepEval), the backend infers schema from trace outputs via `_infer_evaluator_schema_from_traces()` at line 1141.

3. Types are passed to the tracing analytics service as `MetricSpec(type=..., path=...)`.

4. The analytics service returns stats with a `type` field embedded in each metric object.

### Type values

From `api/oss/src/core/evaluations/utils.py:87`:

| JSON Schema type | Metric type value |
|------------------|-------------------|
| `object` (no properties) | `json` |
| `array` of enum strings | `categorical/multiple` |
| `boolean` | `binary` |
| `string` with enum | `categorical/single` |
| `string` without enum | `string` |
| `number` | `numeric/continuous` |
| `integer` | `numeric/discrete` |

## Metrics query response structure

Example from live run `019c9fe5-9721-73a1-bef4-20a224cd2e7e`:

```json
{
    "evaluator-b2e52e604c6a": {
        "attributes.ag.data.outputs.score": {
            "type": "numeric/continuous",
            "count": 5,
            "mean": 1.0,
            "max": 1.0,
            "min": 1.0,
            "sum": 5.0,
            "range": 0.0,
            "pcts": {...},
            "hist": {...}
        },
        "attributes.ag.data.outputs.success": {
            "type": "binary",
            "count": 5,
            "freq": [
                {"value": true, "count": 5, "density": 1.0},
                {"value": false, "count": 0, "density": 0.0}
            ],
            "uniq": [true, false]
        },
        "attributes.ag.data.outputs.reason": {
            "type": "string",
            "count": 5
        }
    }
}
```

Key observation: string metrics have only `type` and `count`. No `mean`, `freq`, or other aggregation fields.

## Frontend data flow

1. `previewRunMetricStatsLoadableFamily` fetches metrics via `POST /evaluations/metrics/query`.

2. `normalizeStatValue()` in `runMetrics.ts` processes the response. The `type` field is preserved (not in `STAT_KEYS_TO_DROP`).

3. `useRunMetricData.ts` builds `metricCatalog` from evaluator steps and stats. Currently does not read `stats.type`.

4. Overview components consume `metricCatalog` and render all metrics regardless of type.

## Existing partial filters

Some downstream components already filter on `metricType`:

- `BaseRunMetricsSection.tsx:90`: Filters `metricType === "string"` for histogram eligibility
- `MetadataSummaryTable.tsx:488`: Similar string filter

These are insufficient because `metricType` comes from evaluator schema, which is often empty. The `stats.type` field is more reliable.

## Main table behavior

The main results table (`EvalRunDetails/atoms/table/columns.ts`) uses a different code path. It falls back to `METRIC_TYPE_FALLBACK = "string"` when schema is missing, which is safe because string metrics render correctly as text cells. The main table does not need filtering.

## Aggregation eligibility logic

A metric should be included in aggregation views if:

1. **Explicit type check**: `stats.type` is one of:
   - `numeric/continuous`
   - `numeric/discrete`
   - `binary`
   - `categorical/single`
   - `categorical/multiple`

2. **Fallback for missing type**: Stats object has:
   - Numeric moments (`mean`, `median`, `sum`, `max`), OR
   - Frequency distribution (`freq` array with valid entries)

A metric should be excluded if:

1. `stats.type === "string"` or `stats.type === "json"`
2. Stats has only `count` (no numeric moments, no frequency)

This logic correctly handles:
- `score` (type=numeric, has mean) -> included
- `success` (type=binary, has freq) -> included  
- `reason` (type=string, only count) -> excluded
- categorical metrics (type=categorical, has freq) -> included
- invocation cost/latency (no type, but has mean) -> included via fallback
