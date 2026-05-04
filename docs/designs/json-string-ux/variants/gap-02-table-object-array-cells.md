# Gap 02 — Testset table cells render objects/arrays poorly

**Scope:** Frontend only. Backend returns clean shapes.

**Anchor fixtures:** `03-arrays.json`, `05-mixed-per-column.json`, `06-deeply-nested.json`

## What already works (don't break)

The testset table has a strong existing feature: **homogeneous nested object columns are expandable into sub-column groups**. Click `>` on `context` and it expands into `demographics` + `geo`. Click `>` on `geo` and it expands into `coordinates` + `region` + `subregion`. Drilling down to leaves works well.

The proposed variants below **compose with this expansion model**, not replace it. They affect only the *collapsed* cell preview — what the user sees before clicking `>`. After expansion, leaf scalar columns render as today.

## What's still broken

Three cases the existing column-expansion model doesn't solve:

1. **Heterogeneous-type columns** (fixture 05). Same column has strings in some rows and objects/arrays/null in others. Object/array/null rows render `—` em-dash. Expansion can't help — the column isn't a homogeneous structure to expand into.
2. **Arrays** (fixture 03 `languages`, `neighbors`). Arrays render as raw multi-line JSON inside the cell, eating ~3-5 lines of vertical space. Expansion would need to invent a row-per-element table-in-cell, which doesn't fit the grid model.
3. **Collapsed leaf-object cells** (fixture 06 `context` before clicking `>`). The pre-expansion preview is raw JSON cropped at column width. A chip + key list would replace that without touching the expansion affordance.

The detection logic exists (`detectDataType` in `fieldUtils.ts:185`) and the drill-in (`DrillInContent`) uses it correctly. The table cell renderer just doesn't apply it to these three cases.

## Three rendering directions

All three apply only to the *collapsed* cell preview. Column expansion behavior is unchanged.

### Variant A — Chip + count + first keys (recommended)

```text
outputs cell:
┌─────────────────────────────────────┐
│ [obj] { 2 }                         │
│ countryName, capital                │
└─────────────────────────────────────┘

neighbors cell:
┌─────────────────────────────────────┐
│ [arr] [ 3 records ]                 │
│ Marshall Islands, Tuvalu, Nauru     │
└─────────────────────────────────────┘
```

- Two compact lines per cell. Predictable height.
- Type chip + count + sample keys/values give immediate shape sense.
- Click cell → opens the drill-in (hosted in the testcase drawer) at that field.

**Tradeoffs:** rows become two-line for non-string cells. Mixed columns vary in row height (mitigated by row-height setting that already exists).

### Variant B — Mini JSON tree

```text
outputs cell:
{
  countryName: "Kiribati",
  capital: "South…"
}
```

- Most faithful to JSON.
- Four to six lines per object cell.
- Syntax highlighting differentiates from string cells without a chip.

**Tradeoffs:** big vertical footprint. Tables become hard to scan.

### Variant C — Single-line inline JSON, syntax-highlighted

```text
outputs cell:
{ countryName: "Kiribati", capital: "South Tar…" }
```

- Same row height as string cells.
- Compact. Scannable.
- Type signal is purely visual (color, braces).

**Tradeoffs:** no chip means screen readers miss the type signal; truncation hides nested structure entirely.

## Recommendation

**Variant A.** Two-line cell with chip + shape preview. Uses the chip system from `gap-01-type-chips.md`. Predictable height, clear type signal, drill-in is a click away.

For arrays of records (fixture 03 `neighbors`): show first 2-3 element values comma-separated. For arrays of primitives: show first 3-5 values. For objects: show first 2-3 keys.

## Empty/null/messages cases

| Cell value | How to render |
| --- | --- |
| `null` | dimmed `null` chip, no preview |
| `""` (empty string) | `""` literal in quotes |
| `[]` | `[arr] [ empty ]` |
| `{}` | `[obj] { empty }` |
| Missing key (column doesn't exist for this row) | `—` em-dash, dimmed (this is the only legitimate em-dash use) |
| `messages` array | `[msgs] [ N messages ]` chip, drill-in opens ChatMessageEditor (see `gap-06`) |

## Implementation

The single change is in the testset table cell renderer. It already receives the raw value. Wire `detectDataType(value)` through and render per the table above. No backend changes. No data shape changes. No schema changes.

## Cross-references

- `gap-01` — type chip styles used here
- `gap-04` — empty-cell rendering must not pollute storage on save
- `gap-06` — `messages` carve-out
