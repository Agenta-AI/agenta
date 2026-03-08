# Align Built-in Code Evaluator Interface with SDK Evaluators

**Issue:** [#3591](https://github.com/Agenta-AI/agenta/issues/3591)
**Branch:** `feat/align-evaluator-interface`

## Summary

Migrate the built-in code evaluator from the legacy `(app_params, inputs, output, correct_answer)` signature to a new `(inputs, outputs, trace)` signature, aligned with what SDK `@ag.evaluator` receives via `WorkflowServiceRequestData`. Also update evaluator documentation to fill gaps around template variables, nesting, and data sources.

## Settled Interface

```python
# v1 (legacy, existing evaluators keep working)
def evaluate(app_params, inputs, output, correct_answer) -> float

# v2 (new default for new evaluators)
def evaluate(inputs, outputs, trace) -> float
```

## Workspace Files

| File | Description |
|------|-------------|
| [context.md](./context.md) | Problem statement, design decisions, rationale |
| [research.md](./research.md) | Codebase analysis: execution pipeline, data flow, template nesting, key files |
| [plan.md](./plan.md) | Implementation plan: 5 phases (SDK, API, Frontend, Docs, Examples) |
| [qa.md](./qa.md) | QA protocol: backward compatibility + new interface testing |
| [status.md](./status.md) | Living progress tracker |
