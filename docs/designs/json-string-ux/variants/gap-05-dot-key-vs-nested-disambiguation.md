# Gap 05 — Dot-key vs nested path disambiguation

**Scope:** Frontend only. Backend correctly preserves both shapes.

**Anchor fixture:** `08-dot-key-collision.json`

**Audited 2026-05-04 against production.** The chip variants this gap proposes (`[dotted-key]`, `[⚠ collision]`, `[shadowed]`) are part of the gap-01 chip vocabulary. Production already has the column-grouping logic that shows literal vs nested as separate columns (via `groupColumns`). **What's unique to gap-05 is the collision detection logic — recognizing when both shapes exist on the same row — and the chip application driven by it.** Calling it out as its own gap because the runtime correctness story (literal-key-first templating) deserves its own conversation, not because the UI primitive is new.

## The two shapes are different things

A testcase can store the same conceptual key two ways and they mean different things at template-render time:

```json
// Literal dotted key (one flat property)
{ "geo.region": "Polynesia" }

// Nested object with a key
{ "geo": { "region": "Polynesia" } }
```

Both are valid JSON. The BE stores them faithfully. **Templates resolve them differently** under the RFC's literal-key-first rule for the `curly` format:

- `{{geo.region}}` returns the literal key first, falls back to nested traversal.
- `{{$.geo.region}}` JSONPath always traverses (ignores literal keys).

So the user's authoring choice matters. The UI doesn't currently mark which one templates resolve.

## What production already does

The column-grouping logic in `currentColumnsAtom` / `groupColumns` shows literal `"geo.region"` as one flat column and nested `geo` as another column that expands via `>` into `region` / `subregion` sub-columns. **Structural separation works today** — the user can see both shapes in the table.

What's missing is **labeling**:

- **Testset table:** `"geo.region"` and `geo > region` render as separate columns, with no chip indicating one is a literal-dot key and the other is a path traversal.
- **Drill-in Fields view:** the flat `geo.region` text input and the nested `geo` object editor sit side-by-side. The user can see them, but no marker says one is a literal key.
- **Drill-in JSON view:** faithful to storage (this part is fine). Reading braces tells the careful reader which is which.
- **Variables panel / autocomplete:** offers both as candidates without distinction. `{{geo.region}}` and `{{$.geo.region}}` insert and resolve differently — the user has no signal which they're picking.

## Relationship to gap-01

The chip variants this gap relies on (`[dotted-key]`, `[⚠ collision]`, `[shadowed]`) are all part of the gap-01 chip vocabulary. Whether gap-05 stays as its own gap or folds into gap-01 is a framing call: **the chips ARE gap-01, but the collision detection logic + the runtime correctness conversation are what gap-05 uniquely owns.** We've kept it separate because the runtime story (literal wins over nested at template time) deserves its own slot in the team conversation.

## What gap-05 actually proposes

1. **Detection logic.** When loading a row, walk the keys: any key containing a dot gets `[dotted-key]`; if its first segment is also a key with an object value, stack `[⚠ collision]` on both sides; if literal-first templating would shadow the nested traversal, also stack `[shadowed]` on the nested side.

2. **Chip application.** Surface those chips on the drill-in field row + the column header in the table. The chips themselves are gap-01 vocabulary.

3. **Variables panel hint** (gap-08-adjacent): when a user types `{{geo.region}}`, autocomplete shows both candidates with the chip distinguishing them.

## The Vanuatu case (the smoking gun)

Vanuatu's storage in fixture 08 is the collision:

```json
{
  "geo.region": "LITERAL_DOT_VALUE",
  "geo": {
    "region": "NESTED_PATH_VALUE",
    "subregion": "Melanesia"
  }
}
```

A user authoring `{{geo.region}}` for this row gets `"LITERAL_DOT_VALUE"` (literal-key-first wins). Most users will think they're getting the nested value because the table column says `geo.region` and shows the nested data nearby. The UI hides which one wins.

```text
Drill-in Fields view (with gap-05 chips applied):

┌────────────────────────────────────────────┐
│ "geo.region"  [dotted-key] [⚠ collision]   │
│ ┌────────────────────────────────────────┐ │
│ │ LITERAL_DOT_VALUE                      │ │
│ └────────────────────────────────────────┘ │
│                                            │
│ geo  [obj]  [⚠ collision]                  │
│ ┌────────────────────────────────────────┐ │
│ │ ▾ region   [str]  [shadowed]           │ │  ← literal-first wins
│ │   NESTED_PATH_VALUE                    │ │
│ │ ▾ subregion  [str]                     │ │
│ │   Melanesia                            │ │
│ └────────────────────────────────────────┘ │
└────────────────────────────────────────────┘
```

Variables panel:

```text
{{geo.region}}     [dotted-key]   inputs   "LITERAL_DOT_VALUE"
{{$.geo.region}}   [path]         inputs   "NESTED_PATH_VALUE"
```

Both are visible, both are insertable, both have type signals.

## Recommendation

Ship the chip vocabulary entries (gap-01) with a small detection function that walks the row's keys and applies them. Layer the `[⚠ collision]` chip when both shapes exist on the same row. The runtime behavior doesn't change — only the labeling.

The `[dotted-key]` chip extends the chip vocabulary defined in `gap-01-type-chips.md`. Same color/style system, stacks alongside the type chip.

## Naming the chip

- `[literal·dot]` — most accurate, a bit jargon-y.
- `[flat]` — short, but ambiguous.
- `[dotted-key]` — clearest, two words. **Ship this.**

Longer form `literal dotted key` appears in the hover tooltip.

## Implementation notes

The detection is trivial: a key contains `.` and is a top-level key on the testcase's `data`. No backend dependency. No schema change.

For the variables panel and autocomplete: both literal and JSONPath candidates already get computed by the existing typeahead source. The change is to label them distinctly, not to change resolution.

## Competitive validation (added 2026-05-04)

See [`../competitive-analysis.md`](../competitive-analysis.md) §5 + §13.

- **Braintrust** — solves the dot-key-vs-nested problem **implicitly via form structure**. The drill-in's right-rail form lists the literal `"a.b"` key as one input and the nested `a.b` path as a separate, indented input under `a`. Two visually distinct rows. No chip needed because the form shape does the disambiguation. **This gets ~70% of what our chip + warning achieves**, structurally.
- **Langfuse** — renders both shapes in one JSON blob with no marker. **Worst case** — same as gap-03's bailout. The user has to read the JSON carefully to spot the difference.
- **Playground side (gap-08 territory)** — Braintrust's variable validator catches both `{{a.b}}` flat-mustache and `{{$.a.b}}` JSONPath against the dataset schema. Same disambiguation, applied to authoring not editing. Reinforces that our `[dotted-key]` chip should also surface in the variables panel + autocomplete, not just on the testcase drill-in.

**Net:** Braintrust's form structure (gap-07) gets us 70% via shape; our chip + collision warning closes the remaining 30%. **Combined: form shape + chip + warning = best in class.** Neither tool ships both; we should.

## Cross-references

- `gap-01` — chip vocabulary that gap-05's chips live in
- `gap-04` — save-side filter prevents shadowing on save
- `gap-07` — schema-aware form does most of the disambiguation work structurally (Braintrust pattern)
- `gap-08` — variable validation needs the same dot-key disambiguation
