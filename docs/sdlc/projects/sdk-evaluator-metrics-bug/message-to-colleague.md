# Message to Colleague

Hi,

I tracked the SDK evaluator metrics issue. Custom evaluators defined with `@ag.evaluator`
show columns in the UI but no results. LLM judge evaluators work.

## Root cause

SDK evaluator revisions are created without `schemas.outputs`. Without that schema, the
backend cannot determine which output fields to aggregate. It only aggregates default
metrics like duration, costs, and tokens.

## Current fix

We now infer schemas from traces during metrics refresh and repair run mappings so the
scenario drill in table can render `score` and `success`. This does not mutate the
evaluator revision.

## Question

Do you recall any prior SDK work to infer or propagate evaluator output schemas? I could
not find it in git history. We are considering a first scenario deferral in the SDK so
revisions are created with schemas from the first outputs.

## References

Details are in `docs/design/sdk-evaluator-metrics-bug/`, especially `research.md` and
`plan.md`.

Thanks.
