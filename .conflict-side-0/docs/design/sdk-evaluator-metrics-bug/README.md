# SDK Evaluator Metrics Bug

## Summary

SDK custom evaluators defined with `@ag.evaluator` show evaluator columns, but their
results are empty. LLM judge evaluators work. The root cause is missing
`schemas.outputs` in evaluator revisions created by the SDK. Metrics aggregation needs
that schema to extract `score` and `success`.

## What is fixed now

- Backend metrics refresh can infer missing evaluator schemas from trace data.
- Run mappings are repaired so the scenario drill in table can render evaluator outputs.
- UI drill in panel can render outputs even when evaluator schemas or slugs are missing.

## What is planned

- SDK first scenario deferral to create evaluator revisions with schemas up front.

## How to read this folder

Start here and move in order:

1. `context.md` for symptoms and evidence
2. `research.md` for the SDK and backend flow analysis
3. `backend-fix.md` for the metrics refresh and run mapping updates
4. `ui-fix.md` for scenario drill in behavior and UI fallbacks
5. `plan.md` for the SDK long term fix
6. `status.md` for current progress

### Communication drafts

`slack-message.md` and `message-to-colleague.md` are drafts for internal updates.

## Repro guidance

Use your local environment. Do not store tokens or API keys in this repo.
