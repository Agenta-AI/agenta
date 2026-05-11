# Status

## Completed

All changes implemented and lint passes.

### Files Changed

| File | Change |
|------|--------|
| `web/oss/src/components/Playground/Components/PlaygroundHeader/RunEvaluationButton.tsx` | Renamed to "New Evaluation", Flask icon, added tooltip |
| `web/oss/src/components/PlaygroundRouter/index.tsx` | Updated loading shell: Flask icon, "New Evaluation" text |
| `web/oss/src/components/Playground/Components/PlaygroundHeader/index.tsx` | Moved RunEvaluationButton before EntityPicker, added tooltip to Evaluator picker |
| `web/packages/agenta-playground-ui/src/components/ExecutionHeader/index.tsx` | Dynamic "Run all" tooltip based on connected evaluators |
| `web/oss/src/components/Sidebar/hooks/useSidebarConfig/index.tsx` | Replaced ChartDonut with Flask for Evaluations sidebar items |
| `web/oss/src/components/Onboarding/tours/firstEvaluationTour.ts` | Updated tour text from "Run Evaluation" to "New Evaluation" |

### Tooltip Content

- **New Evaluation**: "Run your prompt against a full test set with evaluators. Results are saved to the Evaluations page."
- **Evaluator**: "Add evaluators to automatically score outputs in the playground."
- **Run All (no evaluators)**: "Run the prompt on all test cases. (Ctrl+Enter / Cmd+Enter)"
- **Run All (evaluators connected)**: "Run the prompt and evaluators on all test cases. (Ctrl+Enter / Cmd+Enter)"

### Button Order (playground header, right side)

1. Evaluator tags (if any connected)
2. **New Evaluation** button (moved left)
3. Evaluator picker dropdown
4. Testset dropdown
5. Compare button
