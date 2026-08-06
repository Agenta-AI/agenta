# Context

## Problem

Text metrics like `reason` (string explanations from evaluators) are showing up in evaluation aggregation views where they do not belong:

1. **Overview summary table**: Shows aggregated stats for `reason` alongside `score` and `success`
2. **Spider chart**: Attempts to plot `reason` as a numeric dimension
3. **Histogram comparison**: Tries to render distribution charts for text values

These views should only aggregate numeric and boolean metrics. Text fields have no meaningful average, median, or distribution.

## Why it happens

SDK-based evaluators (like DeepEval) return outputs with multiple fields:

```python
{
    "score": 0.95,        # numeric - should aggregate
    "success": True,      # boolean - should aggregate  
    "reason": "The answer is factually correct because..."  # string - should NOT aggregate
}
```

The evaluator schema metadata (`outputs.properties`) comes back empty for these evaluators because they are defined at runtime, not registered with explicit schemas. The frontend cannot determine metric types from schema alone.

However, the backend DOES infer metric types during metrics refresh. Each stat object includes a `type` field:

```json
{
    "score": {"type": "numeric/continuous", "mean": 0.95, "count": 5, ...},
    "success": {"type": "binary", "freq": [...], "count": 5},
    "reason": {"type": "string", "count": 5}
}
```

The frontend preserves this field but never reads it for filtering decisions.

## Goals

1. Exclude text metrics from aggregation views (overview table, spider chart, histograms)
2. Keep text metrics visible in the main results table (they render fine as text cells)
3. Correctly include categorical and boolean metrics that have frequency distributions
4. Handle legacy runs where type metadata may be missing

## Non-goals

- Changing the main results table behavior (it correctly shows all metrics)
- Modifying the backend API contract (the data is already there)
- Fixing evaluator schema registration (separate concern)
