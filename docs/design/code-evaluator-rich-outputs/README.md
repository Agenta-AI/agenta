# Rich Outputs for Code Evaluators

**Status:** Implemented (interface version "3"), verified on the dev stack, in review as [PR #4626](https://github.com/Agenta-AI/agenta/pull/4626)
**Related workspace:** [align-evaluator-interface](../align-evaluator-interface/README.md) (settled the v2 signature, kept `-> float`)

## Summary

Code evaluators in the playground can only return a float. Returning a dict fails with
`Error during code execution: Result is not a float after conversion: <class 'dict'>`.

The goal is to let code evaluators return dicts (multiple metrics or feedback per
evaluator), and to make the same evaluator runnable from the SDK, locally or remotely,
without changes.

The surprising finding: almost the entire pipeline already supports dict outputs.
Other evaluators (LLM-as-a-judge with a JSON schema, multi-field JSON match) return
dicts today, and the metrics and UI layers handle them. The float restriction lives in
exactly one layer: the sandbox runners, plus a pinned output schema in the catalog.

## Workspace Files

| File | Description |
|------|-------------|
| [context.md](./context.md) | Why this work exists, goals, non-goals |
| [research.md](./research.md) | How code evaluators flow through frontend, backend, and SDK; where float is enforced; what already supports dicts |
| [plan.md](./plan.md) | Possible directions with a recommendation, and a draft phase plan |
| [status.md](./status.md) | Living progress tracker |
