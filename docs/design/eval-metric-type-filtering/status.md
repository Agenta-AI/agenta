# Status

## Current state

Phase 2 implementation complete. Both overview views and outer evaluation runs table now filter string metrics.

## Progress

- [x] Root cause identified: frontend not reading `stats.type` from metrics response
- [x] Verified backend provides type info in stats (`numeric/continuous`, `binary`, `string`)
- [x] Confirmed frontend preserves `type` field through normalization
- [x] Planning documents created
- [x] **Phase 1**: Implement `isAggregatableMetric()` helper in overview page
- [x] **Phase 1**: Add filtering in `metricCatalog` builder
- [x] **Phase 2**: Update `outputTypesMap` cache from cell stats in outer table
- [x] Run lint/format (passed)
- [ ] Test on deployed instance
- [ ] Create PR

## Implementation summary

### Phase 1: Overview Views (useRunMetricData.ts)

Added to `useRunMetricData.ts`:

1. Constants `AGGREGATABLE_METRIC_TYPES` and `NON_AGGREGATABLE_METRIC_TYPES`
2. Helper function `isAggregatableMetric(stats)` that:
   - Reads `stats.type` from backend (authoritative)
   - Falls back to shape heuristics (has mean/median/freq vs count-only)
3. Filter in `metricCatalog` builder to exclude non-aggregatable evaluator metrics

### Phase 2: Outer Evaluation Runs Table (RunMetricCell)

The outer table already had filtering via `isMetricHidden()` checking `outputTypesMap`, but this cache was only populated from evaluator schema (which SDK-based evaluators like DeepEval don't have).

Added to `RunMetricCell/index.tsx`:

1. Import `outputTypesMap` utilities from `evaluatorOutputTypes.ts`
2. New `useEffect` that:
   - Reads `stats.type` from the metrics API response when cell data loads
   - Updates the `outputTypesMap` cache with the type info
   - Uses a ref to prevent duplicate updates for the same metric
3. This allows the existing column filtering (`isMetricHidden()`) to work correctly once the first row loads

**Data flow**:
```
Cell fetches stats → stats includes type: "string" → update outputTypesMap → 
trigger re-render of columns → isMetricHidden returns true → column hidden
```

## Blockers

None.

## Decisions

1. Filter at catalog level for overview, cache-based for outer table.
2. Use `stats.type` as primary signal, fallback to shape heuristics for legacy data.
3. Main table (inside eval run details) is unaffected (correctly renders all metrics as cells).
4. Outer table columns are dynamically filtered after first row data loads.
