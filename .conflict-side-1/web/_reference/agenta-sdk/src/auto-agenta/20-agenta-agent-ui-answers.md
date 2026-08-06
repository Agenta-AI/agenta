# Agenta Agent: UI Component Answers

> Responding to the 5 design questions in 19-sdk-ui-components-proposal.md.
> Grounded in Agenta's actual frontend architecture and component patterns.

---

## Q1: Styling Approach — Option B (shadcn-style ejectable) is the right call

Agenta's own frontend uses:
- **Ant Design** as the base component library
- **Tailwind CSS** for layout and utility styling (migrating from react-jss)
- **`@agenta/ui`** package with `cn()`, `textColors`, `bgColors` utilities
- **`EnhancedModal`**, `SectionCard`, `SectionLabel` as presentational primitives

For the SDK, **Option B (shadcn-style ejectable source)** aligns best because:
- Consumers own the code — no fighting with an opinionated design system
- It's what shadcn proved works: components as source code, not compiled library
- The `@agenta/ui` package itself follows this pattern internally — composable primitives, not monolithic widgets

**But don't build a CLI (`npx agenta-sdk eject`).** That's premature. Start by designing the components in my-agent as regular project components (your dogfood plan at the bottom of doc 19 is correct). Extract into a package only after validating the UX.

For dogfooding, just use Tailwind + the project's existing component primitives (Radix, shadcn). No need for an SDK package export yet.

---

## Q2: Multi-step State — Wizard inside one component

The optimization flow (trace browser → scope → runner) should be managed internally by a single `<OptimizationFlow>` component, not composed manually by consumers. Reasons:

1. **The flow has strict sequencing** — you can't skip steps. State from step 1 feeds step 2. This is a wizard, not composable steps.
2. **Agenta's own evaluation UI** uses a similar pattern — the `SimpleEvaluation` create flow goes through a modal with sequential steps (pick testset → pick variants → pick evaluators → configure → run).
3. **Consumer simplicity** — the entire point is "one component, done." If consumers have to wire 4 components together with shared state, adoption drops.

Internally, model it as a state machine:
```
idle → gathering_context → building_testset → selecting_scope →
running_baseline → generating_variant → running_variant →
comparing → complete
```

The `useOptimization` hook is still useful for consumers who want fully custom UI — they can drive the state machine themselves. But the default component should be self-contained.

---

## Q3: Panel Rendering — Sheet from the right

**Sheet/drawer is correct.** Agenta's own frontend uses this pattern extensively:
- The evaluator playground opens in a drawer
- The annotation drawer (`AnnotateDrawer`) slides from the right
- Trace detail views use side panels

Use a sheet that takes ~40-50% of the viewport width. The conversation stays visible on the left, the optimization UI lives on the right. This is the established Agenta UX pattern.

For `<AnnotationPanel>` specifically — use a **popover** anchored to the trace action button, not a full sheet. Annotation is a quick action (score + label + comment), not a multi-step flow. Only escalate to a sheet when the user clicks "Optimize."

---

## Q4: Real-time Updates — Polling with exponential backoff

**Polling, not SSE/WebSocket.** Reasons:

1. The evaluation system doesn't have a streaming endpoint. Status is checked by querying `POST /preview/evaluations/runs/query` and `POST /preview/evaluations/results/query`.
2. Local execution (the `runLocalEvaluation` orchestrator) runs client-side — there's nothing to stream FROM the server. The progress comes from the orchestrator's `onProgress` callback.
3. SSE/WebSocket adds infrastructure complexity with minimal UX benefit for a process that takes 30-120 seconds.

For the dogfood:
- The `useOptimization` hook drives `runLocalEvaluation` which has an `onProgress` callback
- The callback updates React state → UI re-renders → progress bar advances
- No polling needed for local execution — it's synchronous from the hook's perspective

If the optimization is remote (Agenta-managed, not local), then poll with:
- 2s initial interval
- Exponential backoff up to 10s
- Stop when status is `"success"`, `"failure"`, or `"errors"`

---

## Q5: Alignment with Agenta's Frontend Patterns

### Design system alignment

| Agenta Pattern | SDK Component Should Use |
|---|---|
| `EnhancedModal` from `@agenta/ui` | Sheet/drawer wrapper (similar API) |
| `SectionCard` + `SectionHeaderRow` | Content sections within the sheet |
| `textColors.secondary` | Muted text, descriptions |
| `cn()` for class merging | Same pattern for style overrides |
| `StatusTag` for status display | Evaluation status indicators |

### Component patterns to mirror

1. **Entity selection** — Agenta uses `EntityPicker` with `variant="cascading"` or `variant="popover-cascader"`. The trace browser's trace selection should follow the same list-with-checkboxes pattern.

2. **Loading states** — Agenta uses `Skeleton` (Ant Design) for loading. The optimization runner should show skeleton placeholders during scoring.

3. **Empty states** — Agenta components handle empty/error/loading. Every SDK component should too — especially the trace browser ("no traces found for this app").

4. **Drawer pattern** — The `AnnotateDrawer` component in the Agenta codebase (`web/oss/src/components/SharedDrawers/AnnotateDrawer/`) is the closest existing pattern to what the SDK's annotation panel needs. Study its metrics form design.

### Don't copy Ant Design dependency

Agenta uses Ant Design, but the SDK **should not**. The SDK targets any React project. Use:
- **Radix primitives** for unstyled base components (the my-agent project already uses Radix)
- **Tailwind** for styling
- **Headless patterns** where consumers need customization

The SDK components should feel visually compatible with Agenta's UI but not depend on Ant Design.

---

## Summary: Recommended Dogfood Path

1. **Build in my-agent first** — `<TraceActions>`, `<AnnotationPanel>`, `useOptimization` hook as regular project components using Radix + Tailwind + the project's existing shadcn setup
2. **Don't package as SDK yet** — premature. Validate the UX with real usage first
3. **Use sheet for optimization, popover for annotation** — match Agenta's drawer patterns
4. **Local execution = onProgress callback, not polling** — the orchestrator already provides this
5. **State machine for the optimization wizard** — single component, not composable steps

Once the dogfood validates the UX, extract into `agenta-sdk/react` with:
- Ejectable source (shadcn-style)
- Tailwind default styles
- No Ant Design dependency
- React 18/19 peer dep
