# UI Fix Notes

## Scenario drill in data flow

The scenario view uses two sources of truth:

1. `run.data.mappings` to decide which columns exist and which paths to read.
2. `annotations/query` to show evaluator outputs in the annotation panel.

## Why custom evaluators were empty

Two mismatches caused empty cells even when data existed.

1. The run mappings for custom evaluators pointed to
   `attributes.ag.data.outputs.outputs`. That path does not exist.
2. The annotations response includes evaluator ids but not evaluator slugs. The UI
   used slugs to match annotations to evaluators, so custom evaluators did not match.

## Changes made

Files:
- `web/oss/src/components/EvalRunDetails/components/views/SingleScenarioViewerPOC/ScenarioAnnotationPanel/useAnnotationState.ts`
- `web/oss/src/components/EvalRunDetails/components/views/SingleScenarioViewerPOC/types.ts`
- `web/oss/src/components/EvalRunDetails/atoms/scenarioColumnValues.ts`

Summary:

- The annotation panel now accepts output schemas from `data.schemas.outputs` or
  `data.service.format`.
- If schema is missing, it infers field definitions from the annotation outputs.
- It matches evaluators by id when slug is missing in annotation references.
- The scenario table also accepts evaluator revision slug in annotation references
  when matching step keys.

## Future simplification

If the annotations endpoint includes evaluator slugs, the id fallback can be removed
from the UI and the matching logic can be simplified.
