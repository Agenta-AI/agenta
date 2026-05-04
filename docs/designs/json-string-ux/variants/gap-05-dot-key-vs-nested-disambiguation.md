# Gap 05 — Dot-key-vs-nested disambiguation

**Scope:** Frontend only. Backend correctly preserves both shapes.

**Anchor fixture:** `08-dot-key-collision.json`

## The two shapes are different things

A testcase can store a key in two ways and they mean different things at template-render time:

```json
// Literal dotted key (one flat property)
{ "geo.region": "Polynesia" }

// Nested object with a key
{ "geo": { "region": "Polynesia" } }
```

Both are valid JSON. The BE stores them faithfully. **Templates resolve them differently** under the RFC's literal-key-first rule for `curly` format:

- `{{geo.region}}` returns the literal key first, falls back to nested traversal.
- `{{$.geo.region}}` JSONPath always traverses (ignores literal keys).

So the user's authoring choice matters. The UI doesn't currently mark the distinction.

## What we see in fixture 08 today

The column-grouping model already shows the two shapes as separate columns — the literal `"geo.region"` is a flat top-level column, and the nested `geo` expands via `>` into `region` / `subregion` sub-columns. **Both are visible side-by-side.** The structural separation works.

What's missing is **labeling**. The user can see two columns called `geo.region` (one flat, one expanded under `geo >`) but nothing tells them which one templates resolve. Same on the drill-in side:

- **Testset table:** `"geo.region"` and `geo > region` render as separate columns, with no chip indicating one is a literal-dot key and the other is a path traversal.
- **Drill-in Fields view:** the flat `geo.region` text input and the nested `geo` object editor sit side-by-side. The user can see them, but no marker says one is a literal key.
- **Drill-in JSON view:** faithful to storage (this part is fine). Reading braces tells the careful reader which is which.
- **Variables panel / autocomplete:** offers both as candidates without distinction. `{{geo.region}}` and `{{$.geo.region}}` insert and resolve differently — the user has no signal which they're picking.

## The Vanuatu case (the smoking gun)

Vanuatu's storage is the collision:

```json
{
  "geo.region": "LITERAL_DOT_VALUE",
  "geo": {
    "region": "NESTED_PATH_VALUE",
    "subregion": "Melanesia"
  }
}
```

A user authoring `{{geo.region}}` in a curly prompt for this row gets `"LITERAL_DOT_VALUE"` (literal-key-first wins). Most users will think they're getting the nested value because the table column says `geo.region` and shows the nested data nearby. The UI hides which one wins.

## Three ways to disambiguate

### Variant A — Path indicator on every dotted segment (recommended)

Render literal-dot-key columns and properties with a distinct visual marker:

```text
Testset table:
┌──────────────────────────────────┬─────────────────┐
│ "geo.region"  [literal key]      │ geo > region    │
├──────────────────────────────────┼─────────────────┤
│ Polynesia                        │ —               │  ← row 1: only literal
│ —                                │ Micronesia      │  ← row 2: only nested
│ Africa                           │ —               │  ← row 3: literal + nested.subregion only
│ LITERAL_DOT_VALUE                │ NESTED_PATH_VAL │  ← row 4: collision
└──────────────────────────────────┴─────────────────┘
```

Drill-in Fields view:

```text
┌────────────────────────────────────────────┐
│ "geo.region"  [literal·dot] [str]          │  ← quoted column header signals literal
│ ┌────────────────────────────────────────┐ │
│ │ LITERAL_DOT_VALUE                      │ │
│ └────────────────────────────────────────┘ │
│                                            │
│ geo  [obj]                                 │  ← no quotes signals normal object key
│ ┌────────────────────────────────────────┐ │
│ │ ▾ region   [str]                       │ │
│ │   NESTED_PATH_VALUE                    │ │
│ │ ▾ subregion  [str]                     │ │
│ │   Melanesia                            │ │
│ └────────────────────────────────────────┘ │
└────────────────────────────────────────────┘
```

Variables panel:

```text
{{geo.region}}     [literal·dot]   inputs   "LITERAL_DOT_VALUE"
{{$.geo.region}}   [path]          inputs   "NESTED_PATH_VALUE"
```

Both are visible, both are insertable, both have type signals.

**Pros:** explicit, doesn't change behavior, user makes informed choice. Each surface (table, drill-in, panel, autocomplete) uses the same `[literal·dot]` chip.
**Cons:** adds visual chrome to every dotted column.

### Variant B — Auto-warn on collision only

Detect when both forms exist for the same path and render a warning chip on the affected row:

```text
Vanuatu row in table:
┌──────────────────────────────────┬─────────────────────┐
│ geo.region                       │ geo > region        │
├──────────────────────────────────┼─────────────────────┤
│ LITERAL_DOT_VALUE  ⚠             │ NESTED_PATH_VALUE   │
│  └ shadows the nested value      │                     │
└──────────────────────────────────┴─────────────────────┘
```

**Pros:** quiet by default, only fires when there's actual ambiguity.
**Cons:** users learn the distinction only when they hit a collision. Still doesn't help the variables panel disambiguate the two insertion options.

### Variant C — Force one shape on the user (not recommended)

Auto-merge: pick one shape (always literal, or always nested) at display time. Hide the other.

**Pros:** simplest UI.
**Cons:** lossy, lies to the user about what's stored, breaks templates that depend on the other form. Rejected.

## Recommendation

**Variant A** for table + drill-in + variables panel. **Variant B** layered on top for the collision case, since collisions are rare but high-stakes.

The `[literal·dot]` chip extends the chip vocabulary defined in `gap-01-type-chips.md`. Same color/style system, stacks alongside the type chip.

## Naming the chip

Three candidates:

- `[literal·dot]` — most accurate, a bit jargon-y
- `[flat]` — short, but ambiguous
- `[dotted-key]` — clearest, two words

I'd ship `[dotted-key]` for the chip text. The longer form `literal dotted key` appears in the hover tooltip.

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

- `gap-01` — chip system this borrows from
- `gap-04` — shape preservation must hold; this gap depends on it
