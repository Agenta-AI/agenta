# Context

## Motivation

Improve clarity and consistency of evaluation-related buttons in the playground by:
- Renaming "Run Evaluation" to "New Evaluation" to better convey the action
- Using the Flask icon (from Phosphor) consistently for evaluation-related UI elements
- Adding descriptive tooltips to help users understand what each button does
- Reordering buttons so "New Evaluation" appears before the evaluator picker

## Goals

1. Rename the playground "Run Evaluation" button to "New Evaluation"
2. Replace the Play icon with Flask icon on that button
3. Use the Flask icon for Evaluations entries in the sidebar (replacing ChartDonut)
4. Add tooltips to: New Evaluation, Evaluator picker, and Run All buttons
5. Make the Run All tooltip dynamic based on whether evaluators are connected
6. Move the New Evaluation button to the left of the Evaluator dropdown

## Non-Goals

- Changing the evaluations page empty state CTA (remains "Run Evaluation")
- Changing the Evaluators sidebar icon (remains Gauge)
- Changing the EvaluationRunsCreateButton on the evaluations table page
