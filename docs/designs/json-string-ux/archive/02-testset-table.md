# Testset Table — Cell Rendering & Drill-In

**Today:** `eval_eval_2` testset shows columns `inputs.correct_answer`, `inputs.country`, `outputs`. Each cell renders the value as plain truncated text. Object cells lose their structure visually.

**Note on existing capability:** `detectDataType` (`web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer/fieldUtils.ts:185`) already classifies a cell value into `string | json-object | json-array | messages | number | boolean | null` — including the case where the storage is a stringified JSON. The drawer Fields view consumes this. The **table cell renderer doesn't**, which is why screenshots show object cells flattened to truncated strings. The fix is to consume existing detection, not to build new detection.

**Goal:** a glance at the row tells the user the type and rough shape; the drawer is for editing.

## Wireframe — proposed cell rendering

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ☐  inputs                                                  outputs      │
│    ──────────────────────────────────────────────────────  ────────────  │
│    correct_answer            country                                    │
├─────────────────────────────────────────────────────────────────────────┤
│ ☐  "The capital of Tuv…"     "Tuvalu"                      "The capi…"  │  all strings
├─────────────────────────────────────────────────────────────────────────┤
│ ☐  "The capital of Kir…"     "Kiribati"                    [obj] { 2 }  │  object
│                                                            countryName,  │
│                                                            capital        │
├─────────────────────────────────────────────────────────────────────────┤
│ ☐  "What is the…"            "Spain"                       [arr] [ 5 ]  │  array
│                                                            "Madrid",     │
│                                                            "Barcelona"…  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Cell anatomy by type

**String cells:**
- Quoted, truncated with ellipsis at column width
- No chip (string is the default; clutter avoided)
- Hover shows full value tooltip

**Object cells:**
- Chip `[obj]` followed by property count `{ N }`
- Below: 2-3 shallow keys, comma-separated, dimmed
- Multi-line OK if row height is tall; single-line truncated otherwise
- Hover shows full inline JSON preview

**Array cells:**
- Chip `[arr]` followed by element count `[ N ]`
- Below: 2-3 first elements, comma-separated, dimmed

**Empty / null:**
- `null` rendered dimmed
- `""` rendered as `""` literal
- Missing column for this row: dash `—`

### Click behavior

- **Click cell value:** opens drawer for the row, focuses the property
- **Click chip:** opens drawer for the row, focuses the property in JSON edit mode
- **Right-click cell:** convert / copy / delete column for this cell

## Inline edit?

**Recommendation: do NOT support inline JSON editing in the table.** Force the drawer.

Rationale:
- Cell width is too narrow for nested edits
- Multi-property objects need form layout, which needs vertical space
- Type conversion needs validation feedback that doesn't fit in a cell

Inline edit IS supported for:
- Strings (existing pattern)
- Numbers (existing pattern)
- Booleans (toggle)

For everything else, click → drawer opens with focus on that field.

## Column header

Today: column shows raw key name (`correct_answer`, `country`, `outputs`).

Proposed:

```
correct_answer [str]      country [str]      outputs [mixed ⚠]
```

`[mixed]` chip warns the column has different types across rows. Click chip → opens column-conversion modal (bulk operation).

## Bulk operations (Sprint 2 nicety)

When the user has the column header selected:
- "Convert all to string"
- "Convert all to JSON"
- "Validate JSON in column"

Not v1. Mention in `07-decisions.md` § 8.

## Mixed-type evidence (already supported)

From the screenshots: same testset has rows where `outputs` is a string (`"The capital of Tuvalu is Funafuti."`) and rows where `outputs` is an object (`{"countryName": "Kiribati", "capital": "South Tarawa"}`). The existing detection (`detectDataType`) handles this per-cell — no schema change needed. The renderer just needs to use it.

## Open questions for team

1. **Column header chip behavior:** dominant type, "mixed" warning, or off entirely? See `07-decisions.md` § 8.
2. **Hover preview depth:** inline tooltip with full JSON, or modal trigger? Decide based on tooltip render quality and content length.
