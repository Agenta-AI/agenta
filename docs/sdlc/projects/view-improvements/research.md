# Research: View Improvements

## Executive Summary

The codebase has **two mature rendering systems** that are already solving the problem — they just aren't wired up everywhere:

1. **`@agenta/ui/cell-renderers`** — Smart cell content with auto-detection, chat message rendering, popovers with copy. Used by eval table and testset table. **Not used by observability table.**

2. **`DrillInView` system** — Hierarchical data navigation with type-specific field rendering, breadcrumbs, raw mode toggle. Used by testcase edit drawer and add-to-testset. **Not used by trace span overview.**

The highest-impact change is **swapping `TruncatedTooltipTag` for `SmartCellContent`** in the observability table — a straightforward change that immediately brings observability up to parity with eval/testset tables.

---

## Component Inventory

### Cell Renderers (`@agenta/ui/cell-renderers`)

**Package location:** `web/packages/agenta-ui/src/CellRenderers/`

| Component | Purpose | Features |
|-----------|---------|----------|
| `SmartCellContent` | Auto-detecting cell renderer | Detects: empty → chat messages → JSON → text. Wraps in popover. Uses row height context. |
| `ChatMessagesCellContent` | Lightweight chat message display | Role coloring, tool calls, truncation, "+N more" indicator. Plain HTML (no editor overhead). |
| `JsonCellContent` | JSON with syntax highlighting | Purple code styling, line/char truncation. |
| `TextCellContent` | Plain text | Line/char truncation. |
| `CellContentPopover` | Hover popover wrapper | Shows full content on hover (500ms delay), includes copy button. Max 500x400px. |

**Utilities:** `tryParseJson`, `extractChatMessages`, `normalizeValue`, `safeJsonStringify`, `truncateContent`

**Current usage:**
- ✅ Eval table (`InputCell`, `InvocationCell`)
- ✅ Testset table (`TestcaseCellContent`)
- ✅ `InfiniteVirtualTable` (`buildEntityColumns`)
- ❌ **Observability table** — uses `TruncatedTooltipTag` instead

### Editor System (`SharedEditor` / `SimpleSharedEditor`)

**OSS location:** `web/oss/src/components/Playground/Components/SharedEditor/`  
**OSS location:** `web/oss/src/components/EditorViews/SimpleSharedEditor/`

| Component | View Switching | Used By |
|-----------|---------------|---------|
| `SharedEditor` | None — single mode based on `codeOnly` prop | Playground inputs/outputs, prompt messages |
| `SimpleSharedEditor` | Full dropdown: Text/Markdown/JSON/YAML/HTML | Playground FocusDrawer (expanded view) |
| `AccordionTreePanel` | JSON/YAML radio + markdown toggle | Trace drawer overview |

**Gap:** Playground inline output (`GenerationResponsePanel`) uses `SharedEditor` with no view switching. The expanded drawer has it; the inline view doesn't.

### DrillIn System

**Package location:** `web/packages/agenta-entity-ui/src/DrillInView/`  
**OSS location:** `web/oss/src/components/DrillInView/`

| Component | Purpose |
|-----------|---------|
| `MoleculeDrillInView` | Package-level, molecule-first drill-in |
| `EntityDrillInView` | OSS generic entity wrapper |
| `EntityDualViewEditor` | Fields/JSON toggle with Segmented control |
| `TraceSpanDrillInView` | Trace span wrapper (read-only) |
| `TestcaseDrillInView` | Testcase wrapper |
| `DrillInContent` | Core rendering engine |
| `DrillInFieldHeader` | Per-field controls (collapse, copy, raw mode, markdown) |

**Field Renderers:** `TextField`, `MessagesField`, `BooleanField`, `NumberField`, `JsonArrayField`, `JsonObjectField`, `RawModeDisplay`

**Current usage:**
- ✅ Testcase edit drawer → `EntityDualViewEditor`
- ✅ Add-to-testset data preview → `EntityDualViewEditor`
- ❌ **Trace span overview** — uses `AccordionTreePanel` instead
- ❌ Playground config — uses `SchemaPropertyRenderer` (different system)

### Chat Message Components

**Package location:** `web/packages/agenta-ui/src/ChatMessage/`  
**OSS location (legacy):** `web/oss/src/components/ChatMessageEditor/`

| Component | Purpose | Used By |
|-----------|---------|---------|
| `ChatMessageEditor` (package) | Single message editor with role selector | DrillIn field renderers, playground |
| `ChatMessageList` (package) | List of messages with add/remove | DrillIn for message arrays |
| `ChatMessagesCellContent` (cell renderer) | Lightweight read-only display | Table cells |
| `ChatMessageEditor` (OSS legacy) | Duplicate implementation | Legacy flows |

**Gap:** Trace span overview renders messages via `AccordionTreePanel` (code blocks), not `ChatMessageList`.

---

## Surface Analysis

### 1. Observability Table (Critical Gap)

**Location:** `web/oss/src/components/pages/observability/`

**Current implementation:**
```tsx
// getObservabilityColumns.tsx line 77-91
render: (_, record) => {
    const inputs = getTraceInputs(record)
    const {data: sanitizedInputs} = sanitizeDataWithBlobUrls(inputs)
    return (
        <TruncatedTooltipTag
            children={inputs ? getStringOrJson(sanitizedInputs) : ""}
        />
    )
}
```

**Problems:**
- `TruncatedTooltipTag` serializes everything to flat strings via `getStringOrJson()`
- No chat message detection
- No role coloring
- No copy button
- Tooltip shows same serialized string in `<pre>` tag

**Fix:** Replace with `SmartCellContent`:
```tsx
import {SmartCellContent} from "@agenta/ui/cell-renderers"

render: (_, record) => {
    const inputs = getTraceInputs(record)
    const {data: sanitizedInputs} = sanitizeDataWithBlobUrls(inputs)
    return <SmartCellContent value={sanitizedInputs} maxLines={4} />
}
```

**Considerations:**
- `SmartCellContent` tries to read `RowHeightContext` (IVT feature) but has fallback
- Pass `maxLines` explicitly since observability uses regular Ant Design Table
- No infrastructure changes needed

### 2. Trace Span Overview

**Location:** `web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceContent/components/OverviewTabItem/`

**Current implementation:**
- Uses `AccordionTreePanel` for all data
- Chat messages → separate `AccordionTreePanel` per role (code view)
- JSON → Lexical editor with JSON/YAML toggle
- Strings → Lexical editor with markdown toggle

**Problems:**
- Chat messages appear as code blocks, not role-colored bubbles
- No smart type detection — must know data shape in advance
- Missing "rendered table view" for JSON

**Options:**
1. **Minimal:** Replace message rendering with `ChatMessageList` from `@agenta/ui/chat-message`
2. **Full:** Wire `TraceSpanDrillInView` into the overview tab (already exists, just not used)
3. **New:** Build Braintrust-style rendered table view for JSON

### 3. Playground Output

**Location:** `web/oss/src/components/Playground/Components/PlaygroundGenerations/assets/GenerationCompletionRow/GenerationResponsePanel.tsx`

**Current implementation:**
```tsx
<SharedEditor
    initialValue={displayValue}
    editorType="borderless"
    state="filled"
    readOnly
    editorProps={{codeOnly: isJSON}}
    disabled
/>
```

**Problem:** No view mode switching. Always shows raw text or JSON code.

**Gap:** Expanded drawer (`FocusDrawerContent`) uses `SimpleSharedEditor` with full format dropdown. Inline view has nothing.

**Options:**
1. Add a simple JSON/Text toggle button to inline output
2. Use `SimpleSharedEditor` for inline output (but it's heavier)
3. Add tab buttons (JSON | Rendered) like Braintrust

### 4. Testset Table (Already Good)

**Location:** `web/oss/src/components/TestcasesTableNew/`

**Current implementation:** Uses `TestcaseCellContent` which delegates to `SmartCellContent` pattern (imports utilities from `@agenta/ui/cell-renderers`).

**Status:** ✅ Already good. Has chat detection, JSON formatting, popovers with copy.

### 5. Eval Table (Already Good)

**Location:** `web/oss/src/components/EvalRunDetails/components/TableCells/`

**Current implementation:** `InputCell` and `InvocationCell` use `ChatMessagesCellContent`, `JsonCellContent`, `TextCellContent` from `@agenta/ui/cell-renderers`.

**Status:** ✅ Already good. Proper smart detection and rendering.

---

## Component Duplication Map

| Concern | Implementations | Consolidation Target |
|---------|----------------|---------------------|
| Chat message editing | `@agenta/ui/chat-message`, OSS `ChatMessageEditor/` | Package version |
| Cell content popover | `@agenta/ui/CellRenderers/CellContentPopover`, `EvalRunDetails/.../CellContentPopover`, `TruncatedTooltipTag` | Package version |
| Chat message detection | `CellRenderers/utils.ts`, `EvalRunDetails/utils/chatMessages.ts`, `TestcaseEditDrawer/fieldUtils.ts` | Shared utility |
| Copy to clipboard | Package `@agenta/ui/utils/copyToClipboard`, OSS `lib/helpers/copyToClipboard` | Package version |
| Drill-in content | Package `agenta-entity-ui/DrillInView/`, OSS `components/DrillInView/` | Package version |
| SharedEditor | Package `@agenta/ui/SharedEditor`, OSS `Playground/Components/SharedEditor/` | Package version |

---

## Key Gaps Summary

| Gap | Impact | Effort | Fix |
|-----|--------|--------|-----|
| Observability table cells | Critical — most common complaint | Low | Swap `TruncatedTooltipTag` → `SmartCellContent` |
| Trace span chat messages | High — messages unreadable | Medium | Use `ChatMessageList` in `OverviewTabItem` |
| Playground inline output toggle | Medium — users expand drawer | Low | Add simple toggle or use `SimpleSharedEditor` |
| Rendered JSON table view | Medium — competitive gap | High | New component, Braintrust reference |
| Global view preferences | Low — nice to have | Medium | New preference system |

---

## Technical Constraints

### Performance

- Observability can have 1000+ rows
- `SmartCellContent` is already designed for this (truncation, lazy popovers)
- `ChatMessagesCellContent` uses plain HTML, not editor components

### Context Dependencies

- `SmartCellContent` reads `RowHeightContext` but has fallback
- `DrillInView` requires entity molecule pattern
- `SimpleSharedEditor` requires `EditorProvider` context

### Package Architecture

- Cell renderers: `@agenta/ui/cell-renderers` (subpath export)
- Drill-in: `@agenta/entity-ui/DrillInView`
- Chat messages: `@agenta/ui/chat-message`
- Always prefer package imports over OSS duplicates

---

## Files Reference

### Cell Renderers
- `web/packages/agenta-ui/src/CellRenderers/SmartCellContent.tsx`
- `web/packages/agenta-ui/src/CellRenderers/ChatMessagesCellContent.tsx`
- `web/packages/agenta-ui/src/CellRenderers/CellContentPopover.tsx`

### Observability (needs fix)
- `web/oss/src/components/pages/observability/assets/getObservabilityColumns.tsx`
- `web/oss/src/components/TruncatedTooltipTag/index.tsx`

### Trace Drawer
- `web/oss/src/components/SharedDrawers/TraceDrawer/components/TraceContent/components/OverviewTabItem/`
- `web/oss/src/components/SharedDrawers/TraceDrawer/components/AccordionTreePanel.tsx`

### Playground
- `web/oss/src/components/Playground/Components/SharedEditor/index.tsx`
- `web/oss/src/components/EditorViews/SimpleSharedEditor/index.tsx`
- `web/oss/src/components/Playground/Components/PlaygroundGenerations/assets/GenerationCompletionRow/GenerationResponsePanel.tsx`

### DrillIn
- `web/packages/agenta-entity-ui/src/DrillInView/`
- `web/oss/src/components/DrillInView/TraceSpanDrillInView.tsx`
