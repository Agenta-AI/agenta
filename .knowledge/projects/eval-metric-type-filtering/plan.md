# Implementation Plan

## Phase 1: Frontend filtering using existing `stats.type` (immediate fix)

The backend already provides metric type in the stats response. The frontend just needs to read and filter on it.

### Changes

**File:** `web/oss/src/components/EvalRunDetails/components/views/OverviewView/hooks/useRunMetricData.ts`

**Location:** Inside `metricCatalog` useMemo (around line 228)

**Logic:**

1. Add helper function `isAggregatableMetric(stats: BasicStats | undefined): boolean`

2. Check `stats.type` first (authoritative when present):
   - Include: `numeric/continuous`, `numeric/discrete`, `binary`, `categorical/single`, `categorical/multiple`
   - Exclude: `string`, `json`

3. Fallback when `stats.type` is missing:
   - Include if `stats.mean` or `stats.median` or `stats.sum` exists (numeric)
   - Include if `stats.freq` is a non-empty array (boolean/categorical)
   - Exclude otherwise (count-only metrics)

4. Filter evaluator metrics in the catalog builder:
   ```typescript
   const stats = baseStatsMap[metric.fullKey]
   if (!isAggregatableMetric(stats)) {
       return null
   }
   ```

5. Filter out nulls before returning.

### Why this is safe

- Numeric metrics always have `mean`, `sum`, etc.
- Boolean metrics always have `freq` array with true/false entries
- Categorical metrics always have `freq` array with value entries
- String/text metrics have only `count`
- Invocation metrics (cost, latency) have numeric moments

### Testing

1. Run existing DeepEval evaluation
2. Open overview page
3. Verify `reason` metric is NOT shown in:
   - Summary table
   - Spider chart
   - Histogram comparison
4. Verify `score` and `success` metrics ARE shown
5. Check invocation metrics (cost, latency, tokens) still appear

## Phase 2: Persist metric type in run mapping column metadata (future enhancement)

This phase adds explicit type metadata to the API contract. Not required for the immediate fix since `stats.type` already works.

### API changes

**File:** `api/oss/src/core/evaluations/types.py`

Add optional field to `EvaluationRunDataMappingColumn`:

```python
class EvaluationRunDataMappingColumn(BaseModel):
    kind: str
    name: str
    metric_type: Optional[str] = None  # NEW
```

**File:** `api/oss/src/core/evaluations/service.py`

Populate `metric_type` in:
- `_make_evaluation_run_data()` when building annotation mappings
- `_update_run_mappings_from_inferred_metrics()` when adding inferred metrics

### Frontend changes

**File:** `web/oss/src/lib/evaluations/buildRunIndex.ts`

Read `m.column.metric_type` and propagate to column definitions.

**File:** `web/oss/src/components/EvalRunDetails/atoms/table/columns.ts`

Use column-level `metricType` as primary source, fall back to evaluator schema.

### Benefits

- Type metadata survives without re-fetching stats
- Cleaner data contract
- Works for runs where metrics refresh has not been triggered
