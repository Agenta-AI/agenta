# Gap 03 — Drill-in root view bails to one giant code editor

**Scope:** Frontend only.

**Anchor fixtures:** `04-stringified-nested.json`, `06-deeply-nested.json`, `07-messages-and-tools.json`

## What's broken

Open Testcase 1 of fixture 04 in the drill-in Fields view. Instead of seeing per-property cards (the experience for fixture 02), the user sees:

```text
inputs  [3 properties]                              [⎘] [</>] [Drill In ▸]
┌───────────────────────────────────────────────────────────────────┐
│ {                                                                  │
│   "country": "Tuvalu",                                             │
│   "correct_answer": "The capital of Tuvalu is Funafuti.",          │
│   "metadata": "{\"source\":\"trace\",\"trace_id\":\"abc123\",..."  │
│ }                                                                  │
└───────────────────────────────────────────────────────────────────┘

outputs  [3 properties]                             [⎘] [</>] [Drill In ▸]
┌───────────────────────────────────────────────────────────────────┐
│ { ... }                                                            │
└───────────────────────────────────────────────────────────────────┘
```

The root `inputs` and `outputs` containers render as **one big code editor each**, not per-property cards. The user has to click `Drill In` to get the structured editor with detection-driven widgets.

Same pattern in fixture 06 (deeply nested) and fixture 07 (messages + tool_calls). Once you drill in, the experience is good. Until you drill in, it's a wall of JSON.

## Why this happens (probably)

The Fields view has a "show as cards" mode and a "show as code editor" mode per property. For object-typed properties, the current default appears to be: render one card whose body is a code editor with the whole object's JSON.

For trivial cases (fixture 02 `{country, correct_answer}`) this is fine — drill-in is one extra click for a small object. For non-trivial cases (4 levels deep, messages array, etc.), it forces a click before any structure is visible.

## What the user expects

When a user opens a testcase, they want to see the structure. Per-property cards with type-driven widgets (using the chip vocabulary from `gap-01-type-chips.md`) should be the default for objects with non-trivial content. The full-JSON code editor is the escape hatch (toggleable via `</>`), not the default.

## Three approaches

### Variant A — Auto-expand on first level (recommended)

When opening a testcase:

- For each top-level key in `data`, render a per-property card with the appropriate widget.
- If the value is an object/array, render the **first level of children inline** as nested cards (with their own widgets). Drill-in unlocks deeper levels.
- The `</>` toggle remains for users who want raw JSON.

```text
inputs  [3 properties]                              [⎘] [</>] [Drill In ▸]
  ┌─────────────────────────────────────────┐
  │ ▾ country  [str]                        │
  │   ┌─────────────────────────────────┐   │
  │   │ Tuvalu                          │   │
  │   └─────────────────────────────────┘   │
  │                                         │
  │ ▾ correct_answer  [str]                 │
  │   ┌─────────────────────────────────┐   │
  │   │ The capital of Tuvalu is …      │   │
  │   └─────────────────────────────────┘   │
  │                                         │
  │ ▾ metadata  [obj]   [drill-in ▸]        │  ← stringified-JSON detected as object
  │   ┌─────────────────────────────────┐   │
  │   │ source: "trace"                 │   │
  │   │ trace_id: "abc123"              │   │
  │   │ latency_ms: 420                 │   │
  │   └─────────────────────────────────┘   │
  └─────────────────────────────────────────┘
```

**Pros:** structure visible immediately. Matches the drilled-in experience users find when they click `Drill In`. Fixtures 04, 06, 07 all benefit.
**Cons:** very large testcases (deep nesting, long arrays) get a tall scroll. The auto-expand stops at first-level inline; deeper nesting requires drill-in.

### Variant B — Smart default based on size

Threshold-based rule:

- If the object has ≤ N (say 3) properties AND total depth ≤ 2, show as cards.
- Otherwise show as code editor.
- User can toggle either way via `</>`.

**Pros:** balances readability with scroll-pain.
**Cons:** users learn a non-obvious rule. Edge cases are surprising ("why does this one show as cards but the bigger one doesn't?").

### Variant C — Always show as cards, paginate deep nesting

- Always render top-level keys as cards.
- For object-typed values, show first level inline (same as A) but with a "show more (5 of 12)" affordance for objects with many keys.
- Same for arrays.

**Pros:** consistent behavior, scales to large testcases.
**Cons:** more UI complexity. The pagination chrome adds clutter.

## Recommendation

**Variant A.** Auto-expand top-level objects to first-level cards. Use existing `Drill In` for deeper nesting. The `</>` toggle stays available for users who prefer raw JSON.

The current "code editor by default" choice optimizes for the wrong case. Users typically want to see structure first and edit raw second, not the other way around. The drill-in experience is what people expect at root.

## What about really large objects?

Fixture 06's `context` is 4-5 levels deep. With Variant A:

- Root: `inputs` card with `country`, `correct_answer`, `context [obj]` cards
- `context` card shows `geo [obj]`, `demographics [obj]` as inline cards (level 1)
- Drilling into `context.geo` opens a focused view of that subtree

The user always sees one level of structure with the option to drill. They never see a wall of JSON unless they explicitly open the `</>` toggle.

For arrays of records (fixture 03 `neighbors`), show first 3 records inline + "+ N more" affordance to drill in.

## Competitive validation (added 2026-05-04)

Both competitors give us evidence on this gap. See [`../competitive-analysis.md`](../competitive-analysis.md) §3 for the full audit.

- **Braintrust** — clicking a row in the dataset opens a right-rail panel that **auto-expands top-level keys into a labelled form** (one input per column, type-aware widget per input), driven by the per-testset field schema. **This validates Variant A** (auto-expand to cards) but raises the ceiling: Braintrust's form is schema-grounded, ours is detection-grounded. The schema-grounded version is what gap-07 proposes — it subsumes this gap's auto-expand + adds per-field types + per-field PATCH save (which incidentally sidesteps gap-04).
- **Langfuse** — opens a **modal with three side-by-side JSON code editors** (`Input` / `Expected` / `Metadata`). No auto-expand, no form, no chip. **This is the gap-03 worst case** — the bailout we're trying to avoid. Worth showing in the team call as the "what we don't want to become" reference.
- **Stop-gap from Braintrust we should ship while gap-07 is being built**: a click-to-expand pretty-JSON popover (Braintrust's "Mode 3" — see analysis Section 13). Near-zero-cost — opens a modal showing the full row data nicely indented. Not a substitute for the form, but covers "let me see the whole thing without editing" until the form lands.

**Net:** Braintrust validates the auto-expand direction *and* shows a ceiling we should aim at (schema-aware form, see gap-07). Langfuse confirms what to avoid.

## Cross-references

- `gap-01` — type chips on each property header
- `gap-02` — table cell rendering uses the same shape preview semantics
- `gap-04` — render-time projection ("not authored" indicator) lives at the same surface
- `gap-06` — `messages` carve-out at root (don't show as code editor; use ChatMessageEditor)
