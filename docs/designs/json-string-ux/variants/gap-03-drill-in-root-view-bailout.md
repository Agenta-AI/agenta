# Gap 03 — Drill-in root view auto-expand

**Scope:** Frontend only.

**Anchor fixtures:** `04-stringified-nested.json`, `06-deeply-nested.json`, `07-messages-and-tools.json`

**Audited 2026-05-04 against production.** The original framing ("bails to one giant code editor") was wrong — production bails to a `[json-object] [Drill In]` row that requires a click. The collapse/expand machinery already exists. **Auto-expand on first render is the new behavior gap-03 proposes; everything else is already wired.**

## What production already has

`DrillInContent` (`web/oss/src/components/DrillInView/DrillInContent.tsx`) already ships with:

- `collapsedFields` state — per-field collapse/expand controlled at runtime.
- `DrillInFieldHeader` — renders a caret button per field for collapse/expand after first render.
- `showFieldCollapse` prop — opt-in for the collapse UI.
- View-mode dropdown per field (`Text` / `JSON` / `YAML` / `Markdown` / `Raw`).
- `ChatMessageList` rendering (line 1284-1298) for any field where `dataType === "messages"` — renders unconditionally regardless of editability or depth. The comment in code says exactly that.

All of that works today. The user can collapse and re-expand individual fields after first render.

## What's actually missing

**Auto-expand on first render.** The default state today is "collapsed cards at the root." For testcases with nested `inputs` or `outputs`, the user sees:

```text
inputs   [json-object]   [Drill In]
outputs  [json-object]   [Drill In]
metadata [json-object]   [Drill In]
```

…instead of the second-level fields. They have to click `Drill In` (or the caret) to discover what's inside. Same for fixtures 04 (stringified-nested), 06 (deeply nested), 07 (messages + tool_calls).

Once the user drills in, the experience is good — type-driven widgets, chat cards for messages, etc. Until they drill in, structure is hidden behind a click.

## What gap-03 actually proposes

A new `autoExpand` prop on the drill-in component:

- When `autoExpand={true}`: the first level of every object/array renders inline as nested cards on first render.
- Deeper levels still drill in (we don't render a 5-level tree at once).
- The existing `collapsedFields` machinery still works — the user can collapse a card they don't care about.
- Schema-aware form (gap-07) is the higher ceiling: when a per-testset schema exists, render as a labelled form instead of detection-driven cards.

```text
inputs   [3 properties]                            [⎘] [</>] [Drill In ▸]
  ┌─────────────────────────────────────────┐
  │ ▾ country  [str]                        │
  │   Tuvalu                                │
  │                                         │
  │ ▾ correct_answer  [str]                 │
  │   The capital of Tuvalu is …            │
  │                                         │
  │ ▾ metadata  [json-str]   [drill-in ▸]   │  ← stringified-JSON detected
  │   source, trace_id, latency_ms          │  ← parsed preview, not raw escaped string
  └─────────────────────────────────────────┘
```

For `messages` arrays, auto-expand surfaces `ChatMessageList` at root without the drill-in click — production already renders messages-shaped fields with chat cards, just at the level the user is currently focused. Auto-expand brings that to root.

## Why it matters for other gaps

- **gap-06 (messages renderer)** — messages render at root without an extra click. Production already renders `ChatMessageList` for messages-shaped fields; auto-expand is what surfaces them at root.
- **gap-04 (shape preservation)** — the union of authored vs not-authored keys becomes visible at first render instead of being hidden behind a click.

## Three approaches

### Variant A — Auto-expand on first level (recommended)

When opening a testcase:

- For each top-level key, render a per-property card with the appropriate widget.
- If the value is an object/array, render the **first level of children inline** as nested cards.
- Drill-in unlocks deeper levels.
- The existing `</>` toggle (raw JSON) remains for the escape hatch.

**Pros:** structure visible immediately. Matches the drilled-in experience users find when they click `Drill In`. Fixtures 04, 06, 07 all benefit. Existing collapse machinery still works.
**Cons:** very large testcases (deep nesting, long arrays) get a tall scroll. Auto-expand stops at first-level inline; deeper nesting requires drill-in.

### Variant B — Smart default based on size

Threshold-based rule. If the object has ≤ N properties AND total depth ≤ 2, show as cards. Otherwise show as collapsed.

**Pros:** balances readability with scroll-pain.
**Cons:** users learn a non-obvious rule. "Why does this one show as cards but the bigger one doesn't?"

### Variant C — Always show as cards, paginate deep nesting

Always render top-level keys as cards. For object-typed values, show first level inline + "show more (5 of 12)" affordance.

**Pros:** consistent behavior, scales to large testcases.
**Cons:** more UI complexity. Pagination chrome adds clutter.

## Recommendation

**Variant A.** A boolean `autoExpand` prop on `DrillInContent`, defaulting to `true` for the surfaces that benefit (testcase drawer, playground execution item, "Add to Testset" preview). Keep `false` available for embedded contexts where the existing collapsed default is intentional.

The `</>` toggle (raw JSON) stays available for users who prefer it. The existing `collapsedFields` state machinery still handles per-field collapse after first render.

## What about really large objects

Fixture 06's `context` is 4-5 levels deep. With Variant A:

- Root: `inputs` card with `country`, `correct_answer`, `context [obj]` cards.
- `context` card shows `geo [obj]`, `demographics [obj]` as inline cards (level 1).
- Drilling into `context.geo` opens a focused view of that subtree.

The user always sees one level of structure with the option to drill. They never see a wall of JSON unless they explicitly open the `</>` toggle.

For arrays of records (fixture 03 `neighbors`), show first 3 records inline + "+ N more" affordance to drill in.

## Competitive validation (added 2026-05-04)

Both competitors give us evidence. See [`../competitive-analysis.md`](../competitive-analysis.md) §3.

- **Braintrust** — clicking a row opens a right-rail panel that auto-expands top-level keys into a labelled form (one input per column, type-aware widget per input), driven by the per-testset field schema. Validates Variant A direction *and* raises the ceiling: Braintrust's form is schema-grounded, ours is detection-grounded. The schema-grounded version is what gap-07 proposes — it subsumes gap-03's auto-expand + adds per-field types + per-field PATCH save (which incidentally sidesteps gap-04).
- **Langfuse** — opens a modal with three side-by-side JSON code editors (`Input` / `Expected` / `Metadata`). No auto-expand, no form, no chip. **The bailout we're explicitly avoiding.** Worth showing in the team call as the "what we don't want to become" reference.

**Net:** Braintrust validates the auto-expand direction *and* shows a ceiling we should aim at (gap-07 schema-aware form). Langfuse confirms what to avoid.

## Cross-references

- `gap-01` — type chips on the auto-expanded cards
- `gap-02` — table cell rendering uses the same shape preview semantics
- `gap-04` — auto-expand surfaces the union shape on first render
- `gap-06` — messages render at root once auto-expand lands
- `gap-07` — schema-aware form is the higher ceiling, replaces detection-driven cards when a schema exists
