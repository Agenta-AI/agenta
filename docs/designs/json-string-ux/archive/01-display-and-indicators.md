# Type Display & Indicators

**Where types appear:** every value display surface — table cells, drawer fields, JSON tree views, observability spans, eval result rows.

**Goal:** the user can answer "is this a string or an object?" in under 200ms without clicking.

## Recommended approach: three layered signals

### 1. Implicit cue — rendering style

| Type | How it renders |
|---|---|
| string | Quoted, single line: `"Comoros"` |
| object | Code block with braces visible: `{ ... }` |
| array | Code block with brackets visible: `[ ... ]` |
| number | No quotes, monospace: `42` |
| boolean | No quotes, colored keyword: `true` / `false` |
| null | No quotes, dimmed: `null` |
| messages | Tagged pill: `[3 messages ▸]` |

Rendering carries 70% of the type information. Most surfaces need nothing more.

### 2. Explicit type chip (when ambiguous or compact)

Render a small grey chip for ambiguous cases:
- Table cells with row-height restriction
- Variable panel rows
- Drawer property header (always)

```
┌─────────────────────────────────────┐
│ profile  [obj]  { name: "Ada", … }  │
│ name     [str]  "Ada"               │
│ age             42                  │  ← number self-evident, no chip
│ active          true                │  ← boolean self-evident, no chip
│ tags     [arr]  [ "x", "y", … ]     │
│ session  [msgs] [3 messages ▸]      │
└─────────────────────────────────────┘
```

Chip styles:

```
[obj]  light blue,  monospace,  text-[10px]
[arr]  light cyan
[str]  light grey   (only shown when ambiguous, e.g. compact rows)
[num]  hidden       (number rendering is self-evident)
[bool] hidden
[null] dimmed pill
[msgs] light purple
```

### 3. Hover enrichment

On hover over the chip:

```
profile [obj]
        ▼ on hover
        ┌───────────────────────────┐
        │ Object · 3 properties     │
        │ name, tags, lastLogin     │
        │                           │
        │ Click to convert          │
        └───────────────────────────┘
```

## Per-surface rules

| Surface | Rendering | Chip | Hover |
|---|---|---|---|
| Playground variable panel | inline | always | yes |
| Testcase drawer (Fields view) | inline per property | always next to property name | yes |
| Testcase drawer (JSON view) | full JSON tree | n/a (tree shows types) | n/a |
| Testset table cell | truncated value | when ambiguous OR row is compact | yes |
| Testset row drawer | inline per property | always | yes |
| Observability span detail | full JSON tree | n/a | n/a |
| Observability inline display | truncated value | when ambiguous | yes |
| Eval result row | truncated value | when ambiguous | yes |

## Today's behavior (from screenshots)

- **Drawer Fields view:** object values render as code-block widget with monospace JSON. No chip. Type implied by widget choice.
- **Drawer JSON view:** full document, no annotations.
- **Testset table:** object cells render as plain truncated strings. No chip, no rendering distinction. **This is the gap.**

## What changes

1. Single `<TypeChip>` component used everywhere. Single source of truth.
2. Table cell renderer: detect type from value; render with chip + truncated preview.
3. Drawer JSON view: keep as-is (tree already shows structure).
4. Drawer Fields view: keep widget-style rendering, add chip next to property name.

## Open question for team

Should chips be visible **always**, **on hover**, or **only when ambiguous**? See `07-decisions.md` § 5. Mahmoud's RFC says *"show the field type wherever testcase or trace values are edited or inspected"* — that wording leans toward always-on. Worth confirming.
