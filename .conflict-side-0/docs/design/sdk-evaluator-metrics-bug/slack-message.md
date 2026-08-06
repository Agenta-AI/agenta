Hi,

Quick update on the SDK evaluator metrics issue. Custom evaluators show columns but no
results. LLM judge evaluators work.

Root cause. SDK evaluator revisions are created without `schemas.outputs`, so metrics
aggregation cannot extract `score` or `success`.

Current fix. We infer schema from trace data during metrics refresh and repair run
mappings so the scenario drill in table can render outputs. This avoids mutating
evaluator revisions.

Open question. Do you recall any prior SDK work to infer output schema or to propagate
schema from the evaluator? We are considering a first scenario deferral in the SDK.

Details are in `docs/design/sdk-evaluator-metrics-bug/`.
