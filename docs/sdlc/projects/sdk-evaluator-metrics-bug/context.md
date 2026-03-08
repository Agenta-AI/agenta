# Context: SDK Evaluator Metrics Bug

## Problem Statement

When running evaluations via the SDK using builtin evaluators (e.g., `exact_match`, `case_insensitive_match`), the evaluation results show:
- Columns for evaluators are displayed correctly
- **But the actual results (score, success) are empty**
- Duration metrics work correctly
- LLM-as-judge evaluators work correctly (show score and success)

## Symptoms

From the user's metrics query response:

```json
// LLM evaluator (works) - has score and success
"evaluator-2c6d6225a26f": {
    "attributes.ag.data.outputs.score": {...},
    "attributes.ag.data.outputs.success": {...},
    "attributes.ag.metrics.duration.cumulative": {...}
}

// SDK evaluator (broken) - only has duration
"evaluator-81da58da7523": {
    "attributes.ag.metrics.duration.cumulative": {...},
    "attributes.ag": {"type": "json", "count": 1}
}
```

## Trace Data Evidence

The SDK evaluator traces DO contain the correct output data:
```json
"attributes": {
    "ag": {
        "data": {
            "outputs": {
                "score": 1,
                "success": true
            }
        }
    }
}
```

This proves the SDK is storing data correctly, but the metrics aggregation is not finding it.

## Goals

1. Understand why SDK evaluator outputs are not being aggregated into metrics
2. Determine if the bug is in the SDK (not sending schemas) or backend (wrong path lookup)
3. Fix the root cause
4. Ensure all evaluator types work consistently

## Non-Goals

- Changing the evaluator output format
- Modifying the trace storage structure
- Large scale UI refactors
