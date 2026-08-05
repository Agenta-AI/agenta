# Plan: View Improvements

## Execution Phases

### Phase 1: Quick Wins (Est. 1-2 days)

**Goal:** Bring observability table up to parity with eval/testset tables.

#### 1.1 Replace `TruncatedTooltipTag` with `SmartCellContent` in Observability

**Files to modify:**
- `web/oss/src/components/pages/observability/assets/getObservabilityColumns.tsx`

**Changes:**
```tsx
// Before (line 77-91)
import TruncatedTooltipTag from "@/oss/components/TruncatedTooltipTag"
// ...
render: (_, record) => {
    const inputs = getTraceInputs(record)
    const {data: sanitizedInputs} = sanitizeDataWithBlobUrls(inputs)
    return (
        <TruncatedTooltipTag
            children={inputs ? getStringOrJson(sanitizedInputs) : ""}
        />
    )
}

// After
import {SmartCellContent} from "@agenta/ui/cell-renderers"
// ...
render: (_, record) => {
    const inputs = getTraceInputs(record)
    const {data: sanitizedInputs} = sanitizeDataWithBlobUrls(inputs)
    return <SmartCellContent value={sanitizedInputs} maxLines={4} />
}
```

**Do the same for:**
- Inputs column
- Outputs column
- Sessions table first input / last output

**Testing:**
- Verify chat messages render with role colors
- Verify JSON renders with proper formatting
- Verify popover appears on hover with copy button
- Verify performance with 100+ rows

#### 1.2 Apply to Sessions Table

**File:** `web/oss/src/components/pages/observability/components/SessionsTable/assets/getSessionColumns.tsx`

Same pattern as observability table.

---

### Phase 2: Span View Improvements (Est. 2-3 days)

**Goal:** Make trace span detail view render chat messages properly.

#### 2.1 Replace `AccordionTreePanel` Message Rendering with `ChatMessageList`

**Files to modify:**
- `web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceContent/components/OverviewTabItem/index.tsx`

**Current behavior:**
- Chat messages → separate `AccordionTreePanel` per role → code view
- JSON → Lexical editor

**Target behavior:**
- Chat messages → `ChatMessageList` from `@agenta/ui/chat-message`
- Non-message JSON → keep `AccordionTreePanel` with JSON/YAML toggle

**Approach:**
1. Detect chat messages using same `extractChatMessages` utility
2. When detected, render `ChatMessageList` instead of accordion
3. Add read-only mode to `ChatMessageList` if needed

#### 2.2 Add "Rendered" Option to Span View Toggle

**Current:** JSON/YAML radio toggle  
**Target:** JSON/YAML/Rendered tabs

For "Rendered" mode:
- Use DrillIn-style field rendering
- Show key-value pairs with type coloring
- Support expand/collapse for nested objects

**Option A:** Wire `TraceSpanDrillInView` into overview tab  
**Option B:** Build simpler rendered view component

Recommend **Option B** initially — lighter weight, focused on read-only display.

---

### Phase 3: Playground Output Toggle (Est. 1-2 days)

**Goal:** Add view mode switching to playground inline output.

#### 3.1 Add Toggle to `GenerationResponsePanel`

**File:** `web/oss/src/components/Playground/Components/PlaygroundGenerations/assets/GenerationCompletionRow/GenerationResponsePanel.tsx`

**Options:**

**Option A: Simple tabs**
```tsx
<div className="flex gap-2 mb-1">
    <Button size="small" onClick={() => setMode("raw")}>Raw</Button>
    <Button size="small" onClick={() => setMode("formatted")}>Formatted</Button>
</div>
```

**Option B: Use `SimpleSharedEditor`**
- Full format dropdown (Text/Markdown/JSON/YAML)
- More features but heavier

**Option C: Inline format indicator**
- Show detected format as a tag (e.g., "JSON" tag)
- Click to expand to formatted view

Recommend **Option A** initially — simple, discoverable.

#### 3.2 Persist Preference

Store in localStorage: `agenta:playground:output-view-mode`

---

### Phase 4: Component Consolidation (Est. 2-3 days)

**Goal:** Reduce duplication, prepare for future features.

#### 4.1 Consolidate Chat Message Detection

**Current locations:**
- `web/packages/agenta-ui/src/CellRenderers/utils.ts` → `extractChatMessages`
- `web/oss/src/components/EvalRunDetails/utils/chatMessages.ts` → `extractMessageArray`
- `web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer/fieldUtils.ts` → `isMessagesArray`

**Target:** Single shared utility in `@agenta/shared/utils` or `@agenta/ui/cell-renderers`

#### 4.2 Consolidate Copy Utilities

**Current:**
- `web/packages/agenta-ui/src/utils/copyToClipboard.ts`
- `web/oss/src/lib/helpers/copyToClipboard.ts`

**Target:** Single export from `@agenta/ui`, deprecate OSS version.

#### 4.3 Remove Legacy Chat Message Editor

**Current:** `web/oss/src/components/ChatMessageEditor/` duplicates package version

**Action:** Update imports to use `@agenta/ui/chat-message`, then delete OSS version.

---

### Phase 5: JSON Table View (Est. 3-5 days) [Stretch]

**Goal:** Braintrust/Langfuse-style rendered table view for JSON.

#### 5.1 Design Component

**Name:** `JsonTableView` or `PrettyJsonView`

**Props:**
```typescript
interface JsonTableViewProps {
    value: unknown
    maxVisibleRows?: number  // default 20, for auto-expansion
    defaultExpanded?: boolean | string[]  // paths to expand
    onCopy?: (value: unknown, path: string[]) => void
}
```

**Features:**
- Two columns: Path (35%) | Value (65%)
- Level-based indentation
- Type-colored values
- Expand/collapse per row
- Lazy child generation
- Smart auto-expansion (~20 visible rows)
- Copy button on hover

#### 5.2 Reference Implementation

Study Competitor A's `PrettyJsonView.tsx` (1347 lines) for:
- `transformJsonToTableData()` — JSON to row conversion
- `findOptimalExpansionLevel()` — Smart expansion
- `ValueCell` — Type-colored rendering
- Lazy loading pattern

#### 5.3 Integration Points

- Trace drawer "Rendered" mode
- Eval drawer JSON values
- Testset cell expanded view
- Add-to-testset data preview

---

## Success Metrics

### Phase 1
- [ ] Observability table shows chat messages with role colors
- [ ] Popover appears on hover with full content and copy button
- [ ] No performance regression with 100+ rows

### Phase 2
- [ ] Trace span overview shows messages as styled bubbles
- [ ] JSON toggle includes "Rendered" option
- [ ] User can see data structure without parsing JSON mentally

### Phase 3
- [ ] Playground output has visible toggle
- [ ] Preference persists across sessions
- [ ] JSON output can be viewed as formatted/raw

### Phase 4
- [ ] Single chat detection utility shared across codebase
- [ ] No duplicate implementations for copy/detection/rendering

### Phase 5
- [ ] JSON table view component exists in `@agenta/ui`
- [ ] Integrated into at least one surface (trace drawer)
- [ ] Supports large payloads without hanging

---

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Performance regression in observability | High | Low | `SmartCellContent` already optimized; test with large datasets |
| Breaking change to trace drawer | Medium | Medium | Incremental changes; keep old view behind toggle |
| Package dependency issues | Low | Low | Follow existing import patterns |
| Scope creep into evaluator/playground refactors | Medium | High | Stick to viewing components only; tag out-of-scope items |

---

## Dependencies

- No backend changes required
- No SDK changes required (SDK parameters-in-inputs is separate issue)
- Design input needed for:
  - Playground output toggle UX
  - JSON table view column layout
  - Rendered view component styling

---

## Open Questions

1. **JSON table view priority** — Is this a must-have for this sprint or future work?
2. **Global view preferences** — Should we implement now or defer?
3. **Performance threshold** — At what payload size should we consider Web Worker parsing?
4. **Testset view changes** — Any specific issues beyond what we have?

---

## Timeline Estimate

| Phase | Effort | Dependency |
|-------|--------|------------|
| Phase 1: Quick Wins | 1-2 days | None |
| Phase 2: Span View | 2-3 days | Phase 1 |
| Phase 3: Playground Toggle | 1-2 days | None (parallel) |
| Phase 4: Consolidation | 2-3 days | Phases 1-3 |
| Phase 5: JSON Table | 3-5 days | Optional/stretch |

**Total:** 6-10 days for must-haves (Phases 1-3), 9-15 days including consolidation (Phase 4)
