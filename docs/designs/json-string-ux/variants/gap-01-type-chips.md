# Gap 01 — Type chips (the shared visual vocabulary)

**Scope:** Frontend only.

**Anchor fixtures:** all (chips are a cross-cutting visual primitive)

## What's broken

`DrillInFieldHeader` (`web/oss/src/components/DrillInView/DrillInFieldHeader.tsx:209`) renders: the field name, an item count for objects/arrays (`[N properties]`), a view-mode `<Select>` (`Text` / `JSON` / `YAML` / `Markdown` / `Raw`), and action buttons (copy / drill-in / collapse / raw-toggle / markdown-toggle). **No type chip.** `detectDataType` (in `fieldUtils.ts:185`) drives widget selection internally but the result isn't surfaced as a chip — the view-mode dropdown is the closest thing today, but it indicates editing format not value shape. Testset table cells skip chips entirely; variables panel and span detail also miss them. The chip system is **proposed** here, not "inconsistently applied."

This is a small surface but it shows up everywhere — testset table, drill-in field headers, drill-in JSON tree, observability span detail, evaluation result rows, playground variables panel, autocomplete entries.

## Chip vocabulary

Single shared component `<TypeChip type="..." />`. Six concrete types + two special cases.

```text
[str]    grey         strings
[obj]    light blue   JSON objects
[arr]    light cyan   JSON arrays
[num]    grey         numbers (often hidden — see "When to show")
[bool]   grey         booleans (often hidden)
[null]   dimmed pill  literal null

[msgs]      light purple   message arrays (chat history)
[dotted-key] amber          literal dotted key, for the disambiguation in gap-05
```

## Three placement strategies

### Variant A — Always-on

Every value, every row, every surface gets a chip.

**Pros:** literal reading of the RFC ("show wherever testcase or trace values are edited or inspected"). Maximum signal. Consistent visual rhythm.
**Cons:** chip on every string (the most common case) is visual noise. Adds chrome the user mostly doesn't need.

### Variant B — Hover-only

Chip appears on row hover with a tooltip.

**Pros:** clean default state.
**Cons:** mobile-hostile. Discoverability problem — users may never hover and never learn the system.

### Variant C — Ambiguous-only (recommended)

Show chip when rendering doesn't disambiguate:

- Strings: no chip in compact rows (quotes are sufficient)
- Numbers: no chip (digits are obvious)
- Booleans: no chip (`true`/`false` keyword)
- Objects, arrays, null, messages, dotted-key: **always show chip**

In the drill-in field header (`DrillInFieldHeader`): always show chip regardless of type. The header is the place that pays the cost of consistency.

```text
Drill-in field header — always show:
▾ country         [str]
▾ profile         [obj]
▾ tags            [arr]
▾ "geo.region"    [dotted-key str]    ← combo chip for the gap-05 case

Table cells — only when ambiguous:
country  | profile          | active
────────────────────────────────────────
Tuvalu   | [obj] { 2 } …    | true
Spain    | "n/a"            | false   ← string with chip-less display, type self-evident
─        | [arr] [ 3 ] …    | —

Variables panel — always show:
{{country}}        [str] inputs
{{profile}}        [obj] inputs
{{$.geo.region}}   [str] inputs · path
```

**Pros:** clean for the common case (strings). Important types stay visible. Honest about which signal needs chrome.
**Cons:** requires "is rendering self-evident?" judgement call per surface. RFC's literal reading is "always-on" — needs Mahmoud's blessing.

## Recommendation

**Variant C.** Already the recommendation in the original `01-display-and-indicators.md` doc. The fixture sweep didn't reveal anything that changes the call — just confirms the chip is a cross-cutting need.

If Mahmoud insists on Variant A (always-on per RFC literal reading), the CSS cost is low and the chip styles already exist; it's a one-line `display:inline-flex` swap, not a re-architecture.

## Surface-by-surface rules

| Surface | Strings | Numbers | Booleans | Objects | Arrays | Null | Messages | Dotted-key |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Drill-in field header (`DrillInFieldHeader`) | always | always | always | always | always | always | always | always |
| Drill-in JSON view (`EntityDualViewEditor`) | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| **Testset table column header** | when ambiguous | never | never | always | always | n/a | always | always |
| Testset table cell (collapsed) | when row compact | never | never | always | always | always | always | always |
| Variables panel | always | always | always | always | always | always | always | always |
| Autocomplete entry | always | always | always | always | always | always | always | always |
| Observability span detail | when ambiguous | never | never | always | always | always | always | n/a |
| Eval result row | when ambiguous | never | never | always | always | always | always | n/a |

The drill-in field header is "always" because the header is the primary type-information surface for editing. The JSON view is "n/a" because the JSON tree itself is the type signal (braces, brackets, quotes, colors).

**Testset table column header is a new row.** Column headers benefit from chips because the column-grouping / expansion model (see `gap-02`) creates parent-child column relationships that aren't always obvious. A `[obj]` chip on the `geo` parent column header signals "this expands"; a `[dotted-key]` chip on a flat literal `geo.region` column signals "this is a literal dot key, not a path component." The `[mixed]` chip warns when a column's cells have heterogeneous types.

## The dotted-key chip

For the literal-dotted-key case from `gap-05`, the chip stacks with the type chip:

```text
"geo.region"  [dotted-key] [str]      ← literal dot key whose value is a string
"user.profile"  [dotted-key] [obj]    ← literal dot key whose value is an object (rare but possible)
```

Two chips, side by side. Tooltip on `[dotted-key]` reads: *"Literal key with dots in its name. Templates `{{geo.region}}` resolve this before nested traversal."*

## Implementation

Single shared `<TypeChip>` React component. All current chip-shaped UI in the codebase (e.g. Tag elements in the testset list) standardizes on this. Style follows the existing Antd-flavored monospace 10px pill pattern visible in current screenshots.

## Cross-references

- `gap-02` — table cells using object/array chips
- `gap-03` — drill-in property header chips
- `gap-04` — "not authored" chip stacks on top of the type chip
- `gap-05` — dotted-key chip definition
- `gap-06` — messages chip behavior
