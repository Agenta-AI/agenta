# Gap 02 — Testset table cell preview format

**Scope:** Frontend only. Backend returns clean shapes.

**Anchor fixtures:** `03-arrays.json`, `05-mixed-per-column.json`, `06-deeply-nested.json`

**Audited 2026-05-04 against production.** Original framing ("table cells render objects/arrays poorly — no popover / no chip / no syntax highlighting") was wrong. Production already ships those primitives. The unique gap-02 contribution is the *preview format choice* plus chip vocabulary applied to cells.

## What production already does

`web/oss/src/components/TestcasesTableNew/components/TestcaseCellContent.tsx` delegates to the renderer pipeline in `@agenta/ui/cell-renderers`:

- `tryParseJson` + `extractChatMessages` for type detection.
- `JsonCellContent` (syntax-highlighted JSON inline), `ChatMessagesCellContent` (chat preview inline), `TextCellContent` (plain text).
- `CellContentPopover` — click-to-open popover with full content + Copy button.
- Em-dash placeholder for `null` / `undefined` / empty string and missing keys.
- `maxLines={10}` truncation on the inline preview.

It works. The visible problem at scale: a deeply-nested object renders as ~10 lines of multi-line JSON inside the cell — burns vertical space, reads slow, and tells the user nothing about *shape* until they parse the indented block themselves.

The **homogeneous-nested-object expansion** (click `>` on a `context` column to expand into `demographics + geo` sub-columns) is also already in production via `groupColumns`. The proposals below compose with that — they affect only the *collapsed* cell preview, before column expansion.

## What gap-02 actually proposes

A **dense preview format** plus chip vocabulary:

- **Line 1:** `[obj]` chip + `{ 4 props }` count.
- **Line 2:** comma-separated first 2-3 keys (or values for arrays).
- Cell stays ~2 lines tall regardless of nested depth.
- Hover/click popover (existing `CellContentPopover`) still shows the full structure.
- **Stringified-JSON:** distinct `[json-str]` chip, parse-on-detect affordance, popover shows the *parsed* structure (production today shows the raw escaped string).
- **Mixed columns:** `[mixed]` chip on the column header.
- **Dotted-key columns:** `[dotted-key]` chip; collision rows stack `[⚠ collision]`.

```text
outputs cell (object):
┌─────────────────────────────────────┐
│ [obj] { 2 }                         │
│ countryName, capital                │
└─────────────────────────────────────┘

neighbors cell (array of records):
┌─────────────────────────────────────┐
│ [arr] [ 3 records ]                 │
│ Marshall Islands, Tuvalu, Nauru     │
└─────────────────────────────────────┘

metadata cell (stringified-JSON):
┌─────────────────────────────────────┐
│ [json-str] { 3 }                    │
│ source, trace_id, latency_ms        │
└─────────────────────────────────────┘
```

The popover behind the cell parses the stringified JSON for display (production today renders the raw quoted string with backslash-escaped quotes — readable but slow).

## Relationship to other gaps

- **gap-01 (chip vocabulary)** — most of what's "missing" on cells today is the chip side, which is gap-01 applied to a different surface. The dense-format proposal here (count, sample keys, popover-on-parsed) is the cell-specific contribution. Both ship together on `/solutions-tables`.
- **gap-04 (shape preservation)** — em-dash for missing keys is already in production. gap-04 adds the conceptual `[not-authored]` marker on top of it.
- **gap-05 (dot-key disambiguation)** — `[dotted-key]` on column headers stacks with cell rendering.
- **gap-06 (messages renderer)** — `ChatMessagesCellContent` already provides messages preview in cells. The `[tool]` chip for tool-call columns is gap-06's contribution to the table surface.

## Empty / null / messages cases

| Cell value | How to render |
| --- | --- |
| `null` | dimmed `null` chip, no preview |
| `""` (empty string) | `""` literal in quotes |
| `[]` | `[arr] [ empty ]` |
| `{}` | `[obj] { empty }` |
| Missing key (column doesn't exist for this row) | `—` em-dash (production already does this) |
| `messages` array | `[msgs] [ N messages ]`, popover/drill-in opens chat cards (production via `ChatMessagesCellContent`) |
| `tool_calls` array | `[tool] [ N calls ]` chip, drill-in shows the tool-call card from gap-06 |
| Stringified-JSON | `[json-str]` chip, popover shows parsed structure |

## Implementation path

The dense preview can ship as either:

1. A new option inside `JsonCellContent` (e.g. `variant="summary"`) so the rest of the renderer pipeline doesn't change.
2. A new sibling renderer `SummaryCellContent` that `TestcaseCellContent` picks when the user toggles density.

Either way, the chip vocabulary integrates with the existing detection (`tryParseJson`, `extractChatMessages`) and existing popover (`CellContentPopover`). No backend changes. No data shape changes. No schema changes.

## Competitive validation (added 2026-05-04)

See [`../competitive-analysis.md`](../competitive-analysis.md) §2.

- **Braintrust** — renders cells as multi-line YAML preview with a row-height toggle (Compact / Comfortable / Tall) on the table toolbar. Direct precedent for our density toggle. No type chips on cells — relies on YAML's typographic conventions for shape.
- **Langfuse** — renders multi-line JSON inline with no density control. No chips. Same blind spot as us pre-fix.
- **Both** — share the stringified-JSON blind spot. They show the raw quoted string with escaped quotes, just like our production today. **Our parse-on-detect popover is the differentiator here.**

**Net:** the chip vocabulary + dense preview catches us up to Braintrust's typographic shape signals. The stringified-JSON parse-on-detect popover puts us past both.

## Cross-references

- `gap-01` — type chip styles used here
- `gap-04` — em-dash for missing keys is shared (production already has it)
- `gap-05` — `[dotted-key]` chip on column headers
- `gap-06` — `[tool]` chip + `ChatMessagesCellContent` carve-out
