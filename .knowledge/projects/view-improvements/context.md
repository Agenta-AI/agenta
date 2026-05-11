# Context: View Improvements

## Background

During internal dogfooding of Agenta (using it to build the "refine prompt" AI feature), significant friction was encountered around data readability. The core feedback: while the platform is technically functional, the experience of viewing and understanding data — especially in traces and observability — is poor enough to feel "unusable" despite working correctly.

This matches customer feedback patterns where users struggle to understand what happened in their traces, even when the data is correctly captured and stored.

## Motivation

### User Pain Points

1. **Observability table is "the worst"**
   - Chat messages appear as raw JSON strings in grey tags
   - No role coloring, no structure, just serialized text
   - Tooltips show the same raw JSON, providing no additional value
   - No copy button on hover

2. **Inconsistency creates confusion**
   - The eval table renders chat messages beautifully with role colors
   - The testset table uses smart detection and popovers
   - The observability table uses neither — same data, worse experience
   - Users expect consistency; the gap is jarring

3. **View mode switching is fragmented**
   - Playground inline output: no switcher (raw only)
   - Playground expanded drawer: full format dropdown
   - Trace drawer: JSON/YAML toggle + markdown toggle
   - Eval drawer: code view only, no toggle
   - No global "show all as X" preference

4. **Missing "rendered view" for JSON**
   - Competitors (Braintrust, Langfuse) show JSON as readable tables
   - Key-value layout with type coloring, expand/collapse
   - We only have raw code view or serialized strings

### Business Impact

- **First impressions:** New users evaluating Agenta see the observability table first. Poor rendering creates a negative first impression.
- **Dogfooding friction:** Internal teams struggle to debug their own AI features, slowing development.
- **Support burden:** Users ask "why does my trace look like gibberish?" when it's a rendering issue, not a data issue.

## Goals

### Primary Goals

1. **Consistent rendering across surfaces**  
   Chat messages, JSON, and text should look the same whether viewed in observability, eval, testset, or playground.

2. **Smart content detection everywhere**  
   Auto-detect chat messages, JSON, markdown and render appropriately. Don't require users to know the data type.

3. **View mode flexibility**  
   Let users switch between raw/rendered/JSON/text views where it makes sense. Persist preferences.

4. **Copy everywhere**  
   Every data display should have a copy button on hover/click.

### Stretch Goals

- **Rendered table view for JSON** (Braintrust-style key-value table)
- **Global view preferences** ("always show prompts as markdown")
- **Drill-in from any surface** (click JSON property to navigate into it)

## Non-Goals

### Explicitly Out of Scope

1. **SDK changes**  
   The issue where parameters appear in inputs (SDK sends them together) is a backend/SDK problem. This project focuses on frontend rendering.

2. **Add-to-testset flow**  
   While related (uses data preview), the flow issues are tracked separately. This project only covers the viewing/rendering components.

3. **Playground comparison mode**  
   Running single cells, hiding inputs panel, showing diffs — these are separate playground improvements.

4. **Evaluator playground migration**  
   The evaluator playground needs a separate design. This project covers viewing components that will be reused there, but not the evaluator UX itself.

5. **New feature surfaces**  
   This is about improving existing surfaces, not building new ones (like annotation queues).

## Success Criteria

### Must Have
- Observability table inputs/outputs use smart cell rendering with chat detection
- Observability tooltips show structured content with copy button
- At least one surface has view mode switching (e.g., playground output)

### Should Have
- Span detail view uses proper chat message components (not code blocks)
- Component consolidation reduces duplication
- All surfaces have copy-on-hover for data values

### Could Have
- Rendered JSON table view (Braintrust-style)
- Persisted view mode preferences
- Global view mode toggle

## Constraints

1. **Performance**  
   Observability can have thousands of rows. Cell renderers must be lightweight. The current `SmartCellContent` already handles this with truncation and lazy popovers.

2. **Existing entity system**  
   The drill-in system (`@agenta/entity-ui`) and molecule pattern are already in use. New components should integrate with these patterns, not create parallel systems.

3. **Two-layer architecture**  
   Components live in packages (`@agenta/ui`, `@agenta/entity-ui`) or OSS layer. Prefer package-level components for reusability; use OSS layer for composition.

4. **No big-bang refactors**  
   Changes should be incremental. Each surface can be improved independently without requiring all surfaces to change at once.
