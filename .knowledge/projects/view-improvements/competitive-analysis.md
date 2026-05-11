# Competitive Analysis: Data Rendering

This document analyzes how competitors render JSON, chat messages, and structured data in their observability and prompt management UIs. Names are anonymized as Competitor A (primarily observability-focused) and Competitor B (primarily prompt/eval-focused).

---

## Competitor A: Full-Featured JSON Viewing

### Overview

Competitor A has **three view modes** for JSON in trace/span detail panels:
1. **"Pretty" (table)** — Renders JSON as a two-column expandable table
2. **"JSON" (legacy)** — Traditional collapsible tree view
3. **"JSON-beta"** — High-performance virtualized viewer for large payloads

A top-level router selects the renderer based on user preference stored in localStorage.

### Libraries Used

| Library | Role |
|---------|------|
| `@tanstack/react-table` | Powers the "pretty" table view. Column definitions, row expansion, virtualized row model. |
| `react18-json-view` | Renders legacy JSON tree with syntax highlighting, collapsible nodes, dark mode. |
| `@tanstack/react-virtual` | Virtualizes the advanced viewer for large payloads (10K+ nodes). |
| `lossless-json` | Parses JSON without losing numeric precision. |

### Architecture

```
IOPreview (router)
  ├── ViewModeToggle          — tabs: "Formatted" | "JSON", plus Beta toggle
  │
  ├── "pretty"    → IOPreviewPretty   → PrettyJsonView (table mode)
  ├── "json"      → IOPreviewJSONSimple → react18-json-view
  └── "json-beta" → MultiSectionJsonViewer → AdvancedJsonViewer
```

The entry point `IOPreview` receives raw JSON and delegates to renderers. It's consumed by trace detail, observation detail, and preview components.

### The Table View ("Pretty" Mode) — Key Innovation

This is **the most relevant pattern** for Agenta. Here's how it works:

#### 1. Parsing Pipeline

Raw JSON goes through `deepParseJson()`:
- Recursively parses stringified-JSON-inside-JSON (common with LLM providers who double-serialize)
- Handles Python dict syntax (`True`/`False`/`None`, single quotes)
- For payloads over 100KB, parsing happens in a **Web Worker** to keep UI responsive

#### 2. Format Detection

Before rendering the table, two checks run:
- `isChatMLFormat()` — Detects arrays of `{role, content}` objects → renders chat bubbles
- `isMarkdownContent()` — Detects markdown strings → renders markdown view

#### 3. JSON-to-Table Conversion

The `transformJsonToTableData()` function converts arbitrary JSON into rows:

```typescript
interface JsonTableRow {
  id: string;              // e.g., "metadata-settings-theme"
  key: string;             // property name
  value: unknown;          // actual value
  type: "string" | "number" | "boolean" | "object" | "array" | "null";
  hasChildren: boolean;    // true for objects/arrays with entries
  level: number;           // nesting depth
  subRows?: JsonTableRow[];
  rawChildData?: unknown;  // for lazy loading
}
```

**Lazy loading strategy:** Top-level rows store children as `rawChildData` and generate child rows on demand when expanded.

#### 4. Smart Auto-Expansion

`findOptimalExpansionLevel()` calculates how many levels to expand by default:
- Does a breadth-first walk of the row tree
- Stops at the deepest level where visible rows stay under 20 (100 for root objects)
- Cap of 10 levels deep
- Result: Small objects expand fully; large objects show only top-level keys

#### 5. Table Rendering

Two columns using `@tanstack/react-table`:

| Column | Width | Content |
|--------|-------|---------|
| Path | 35% | Key name with level-based indentation (level × 16px + 8px), expand/collapse chevron |
| Value | 65% | Type-colored value via `ValueCell` |

#### 6. Type-Aware Value Rendering

`ValueCell` applies coloring by type:
- **Strings:** Green, wrapped in quotes, URL auto-linking for strings < 1500 chars
- **Numbers:** Blue
- **Booleans:** Orange
- **null/undefined:** Gray italic
- **Arrays:** Preview like `["item1", "item2", ...3 more]`
- **Objects:** "N items"
- **Long strings (> 2000 chars):** Truncated with "...expand (N more characters)" link

Each cell has a **copy button on hover**.

#### 7. Expansion State Management

Three layers:
1. **External state** — Parent can supply and control expansion
2. **Smart defaults** — Computed by `findOptimalExpansionLevel()` when no external state
3. **Internal state** — Tracks user interactions, takes over from defaults

### View Mode Toggle

- Two tabs: "Formatted" and "JSON"
- Preference persists in localStorage (`jsonViewPreference`)
- When "JSON" is selected, a Beta toggle appears for the advanced viewer
- Only the active view is rendered (not hidden with CSS) — saves DOM cost but loses scroll/expansion state on toggle

### Key Takeaways for Agenta

1. **Table view is powerful** — JSON as a key-value table is more readable than code view
2. **Smart expansion** — Auto-expand just enough levels to show ~20 rows
3. **Lazy child generation** — Don't generate all rows upfront; do it on expand
4. **Format detection first** — Check for chat messages, markdown before table rendering
5. **Worker-based parsing** — Offload large JSON parsing to Web Worker
6. **Type coloring** — Consistent color scheme by data type
7. **Copy on every cell** — Hover to reveal copy button

---

## Competitor B: Unified Data Editor/Viewer

### Overview

Competitor B takes a different approach: a **unified `DataTextEditor`** component that handles multiple modes for viewing AND editing data. It's used across trace inspection, function metadata editing, and configuration.

### Modes

The component supports these modes via a dropdown:

| Mode | Purpose |
|------|---------|
| `text` | Plain text editing (CodeMirror) |
| `json` | JSON with syntax highlighting and linting |
| `yaml` | YAML editing |
| `schema-builder` | Visual JSON Schema builder |
| `form` | Auto-generated form from JSON Schema |
| `rich` / `tree` | Structured visual rendering |
| `llm` / `llm-raw` | LLM message-specific views |
| `html` | HTML preview (Sandpack viewer) |

### Architecture

```
DataTextEditor (unified component)
  ├── CodeMirror (text/json/yaml modes)
  │     └── Extensions: folding, line numbers, linting, search, themes
  │
  ├── Rich/Tree View (object/array visualization)
  │     └── Recursive expandable/collapsible nodes
  │
  ├── SchemaFormGenerator (form mode)
  │     └── Auto-generates inputs from JSON Schema
  │
  └── SchemaBuilder (visual schema authoring)
```

### Rich/Tree Views

For the tree/rich rendering (similar to Competitor A's table view):

- Keeps parsed in-memory value derived from raw text
- `tree` mode: Classic recursive renderer with expand/collapse per path
- `rich` mode: Typed visual renderer using componentized rendering for known data shapes (tables, cards, chips, links)
- Both modes read from the same canonical parsed value — switching stays in sync

### Form Mode (Schema-Driven Inputs)

When a JSON Schema is available:
- `SchemaFormGenerator` walks the schema
- Auto-creates field components based on type:
  - `string`/`number`/`boolean` → matching input controls
  - `enum` → select/radio
  - Nested `properties` → nested form groups
  - `array` → repeatable item controls
- Validation via AJV-like schema validator
- Field changes update an object model, then serialize back to text

### Key Insight: One Central Data State

The component maintains **one central "data state"** with multiple projections:
- Text projection (CodeMirror content)
- Tree/Rich projection (visual structured render)
- Form projection (schema-driven controls)

Mode switching doesn't create separate data stores — it re-renders the same value through different presenters. Parse/validation logic is centralized.

### Data Actions

- Copy value
- Collapse/expand all folds
- Line selection syncing
- Search/filter in rich/tree modes
- "Create monitor chart from field" action

### Key Takeaways for Agenta

1. **Unified component** — One editor for all data modes, not separate components
2. **Mode dropdown** — Let users pick how they want to see data
3. **Tree + Form views** — Same data, different presentations (visual tree vs generated form)
4. **Schema awareness** — When schema available, generate proper form controls
5. **Action bar** — Copy, fold all, search built into the component

---

## Feature Comparison Matrix

| Feature | Competitor A | Competitor B | Agenta (Current) | Agenta (Target) |
|---------|-------------|--------------|------------------|-----------------|
| **View mode toggle** | ✅ Formatted/JSON tabs | ✅ Mode dropdown | ⚠️ Fragmented (different per surface) | ✅ Consistent toggle |
| **JSON table view** | ✅ Two-column table | ✅ Tree/rich modes | ❌ Code view only | ✅ Table or tree view |
| **Chat message detection** | ✅ ChatML format check | ✅ LLM mode | ⚠️ Some surfaces only | ✅ All surfaces |
| **Smart auto-expansion** | ✅ ~20 visible rows | ❓ Unknown | ❌ Fully collapsed | ✅ Smart expansion |
| **Lazy child loading** | ✅ On expand | ❓ Unknown | ❌ N/A | ✅ For large data |
| **Type coloring** | ✅ Full scheme | ✅ In tree mode | ⚠️ In code view only | ✅ Consistent |
| **Copy per cell/field** | ✅ Hover button | ✅ Copy action | ⚠️ Missing in observability | ✅ All surfaces |
| **Large payload handling** | ✅ Web Worker + virtualization | ❓ Unknown | ❌ Can hang on large traces | ⚠️ Investigate |
| **Markdown detection** | ✅ Auto-detect | ✅ Mode switch | ⚠️ Manual toggle | ✅ Auto-detect + toggle |
| **Schema-driven forms** | ❌ Not for viewing | ✅ Form mode | ⚠️ Playground config only | ⚠️ Future consideration |

---

## Recommendations for Agenta

### Immediate (This Sprint)

1. **Adopt smart cell rendering everywhere**
   - Already have `SmartCellContent` — just wire it into observability
   - Already have chat detection — it works in eval/testset tables

2. **Add view mode toggle to key surfaces**
   - Playground output: simple JSON/Text tabs
   - Trace drawer: already has JSON/YAML, extend to include "Rendered" option

### Near-Term

3. **Build a table view for JSON**
   - Reference: Competitor A's `PrettyJsonView`
   - Two columns: Path (with indentation) | Value (type-colored)
   - Smart auto-expansion to ~20 visible rows
   - Lazy child generation on expand

4. **Unify view mode persistence**
   - Store preference in localStorage like Competitor A
   - Consider global vs per-component preferences

### Future Consideration

5. **Web Worker parsing for large payloads**
   - Competitor A offloads parsing for > 100KB payloads
   - Could help with large trace data

6. **Schema-driven forms**
   - Competitor B's form mode is interesting
   - Agenta's playground config already uses schema-driven rendering
   - Could extend to data preview/editing contexts

---

## Files Referenced (Competitor A)

| File | Purpose |
|------|---------|
| `IOPreview.tsx` | Top-level router for view mode |
| `IOPreviewPretty.tsx` | ChatML/Markdown detection, delegates to PrettyJsonView |
| `PrettyJsonView.tsx` | Table view implementation (1347 lines) |
| `jsonExpansionUtils.ts` | JSON to table row conversion |
| `ValueCell.tsx` | Type-colored cell rendering |
| `CodeJsonViewer.tsx` | Legacy tree view wrapper |
| `AdvancedJsonViewer/` | High-performance virtualized viewer |
| `json.ts` | `deepParseJson()` utility |
| `json-parser.worker.ts` | Web Worker for off-thread parsing |
| `ViewModeToggle.tsx` | Tab UI for mode switching |
