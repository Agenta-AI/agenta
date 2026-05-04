# Gap docs — JSON ↔ String UX

Six focused gap docs, each with a prose argument (`.md`) and a visual mockup (`.html`). Two more candidate gaps (07, 08) are surfaced in [`../competitive-analysis.md`](../competitive-analysis.md) — schema-aware Edit form and playground variable validation. Those don't have HTML mockups yet; they're written up in the analysis doc.

**Backend is correct.** Verified against `backend-response data/`. Every gap below is a frontend issue.

**Competitive context (added 2026-05-04):** see [`../competitive-analysis.md`](../competitive-analysis.md). 50 screenshots of Braintrust + Langfuse running our 8 fixtures. Validates gap-03 / gap-05 / gap-06 directions, identifies a near-zero-cost stop-gap (full-row JSON popover), and surfaces two new candidate gaps. Reading the analysis is recommended before the team call — it changes the priority order.

**Interactive mockup app (added 2026-05-04):** the static `.html` mockups in this folder are now superseded by an interactive Next.js app at [`../../../web/apps/design-mockups/`](../../../web/apps/design-mockups/). Run `pnpm --filter design-mockups dev` (port 3030) and open the **solution** pages — they mount production components alongside the proposal so the diff is visible:

| Solution route | What it shows |
| --- | --- |
| `/solutions-drill-in` | Production drawer (`DrillInContent`) on the left vs `ProposedDrillIn` on the right, with a fixture toolbar to switch between fixtures 02-08. Use this for gap-01, gap-03, gap-04, gap-05, gap-06. |
| `/solutions-playground` | Three-way compare grid per fixture (Today = production-style hand-mock, Embedded = full drill-in, Compact = click-to-edit row). Use this for the playground side of gap-01, gap-03, gap-06. |
| `/solutions-tables` | Production `groupColumns` + `TestcaseCellContent` on the left vs `ProposedTableCell` (chip-and-shape) on the right, both in real antd `<Table>`s with stub rows simulating the entity layer. Use this for gap-02. |

The **concept** pages (`/gap-NN-*` in the mockup app) document **what production already does** vs **what each gap actually proposes**. Several gap framings shifted as a result of that audit — see "Production audit (2026-05-04)" below.

The HTML mockups all share `shared.css` so chip styles, surface containers, drill-in mockups, and the variables panel stay visually consistent across views. Open `index.html` for the full landing page, or any `gap-XX.html` directly for a specific gap.

## Production audit (2026-05-04)

Mounting the real production components alongside `ProposedDrillIn` / `ProposedTableCell` surfaced capabilities the gap docs originally claimed were missing. Each affected gap has been rescoped — the prose `.md` files below reflect the new framing.

- **gap-02 (table cells).** Production already has `CellContentPopover` (full-row popover on click), `JsonCellContent` (syntax-highlighted JSON in cells), and em-dash for missing keys. **Unique gap-02 contribution = the dense two-line cell format (chip + count + first-keys preview)** plus the chip vocabulary applied to mixed/array/collapsed-object cells. Most of gap-02 is gap-01 chip vocabulary applied to the table surface.
- **gap-03 (drill-in root view).** Production already has per-field collapse: `collapsedFields` state, `DrillInFieldHeader` caret button, `showFieldCollapse` prop, and `ChatMessageList` renders `dataType === "messages"` unconditionally at any depth (`DrillInContent.tsx:1284-1298`). **Unique gap-03 contribution = auto-expand-on-first-render** (a new `autoExpand` prop). Existing collapse machinery still works after auto-expand lands.
- **gap-05 (dot-key disambiguation).** The chip variants (`[dotted-key]`, `[⚠ collision]`, `[shadowed]`) are part of gap-01 chip vocabulary. The structural separation between literal `"geo.region"` and nested `geo > region` is already visible via `groupColumns`. **Unique gap-05 contribution = collision detection logic + the runtime-correctness conversation (literal-key-first templating).** Most of gap-05 is gap-01 vocabulary applied with a small detection function.
- **gap-06 (messages renderer).** Production already renders messages-shaped arrays via `ChatMessageList` at any depth, has `ToolMessageHeader` for `role: "tool"`, and `extractDisplayTextFromMessage` formats assistant `tool_calls` as inline text. **Unique gap-06 contribution = the dedicated tool-call card** (function name as heading, arguments JSON pretty-printed) and the `[tool]` chip in table cells. Root-level rendering falls out of gap-03 auto-expand, not gap-06.

**Subset relationships:** gap-02, gap-05, and gap-06 all rely heavily on gap-01 chip vocabulary. They stay as their own gaps because each owns a non-trivial design surface that doesn't fit cleanly under gap-01 alone (cell format, collision detection, tool-call card), but the chip work is shared.

## Existing capabilities (don't break these)

The proposals compose with what already works. Specifically:

- **Testset table column expansion.** Homogeneous nested object columns expand into sub-column groups (`context > demographics + geo > coordinates + region + subregion`). Drilling to leaf scalars works well.
- **Drill-in component.** Nested objects render as per-property cards with type-driven widgets after one click. Lives in `DrillInContent`; consumed by drawers, "Add to Testset" preview, playground execution item, annotation UI.
- **Detection logic.** `detectDataType` (in `fieldUtils.ts:185`) recognizes string / object / array / number / boolean / null / messages — including stringified-JSON-as-string.
- **Round-trip preservation.** Storage shape is preserved through edits via `textModeToStorageValue`.
- **Faithful JSON view.** The drill-in's JSON view (`EntityDualViewEditor`'s "JSON" mode) renders the user's stored format exactly.

The gap proposals affect only the cases these don't cover.

## Reading order

The order below tells the story: vocabulary first, then where it's applied, then correctness, then polish.

| Gap | Mockup (html) | Prose (md) | What it does |
| --- | --- | --- | --- |
| **01** Type chips | [`gap-01-type-chips.html`](gap-01-type-chips.html) | [`gap-01-type-chips.md`](gap-01-type-chips.md) | Visual vocabulary used everywhere — read first. |
| **02** Table cells | [`gap-02-table-cells.html`](gap-02-table-cells.html) | [`gap-02-table-object-array-cells.md`](gap-02-table-object-array-cells.md) | Apply chips to collapsed cells, arrays, mixed-type columns. |
| **03** Drill-in root view | [`gap-03-drill-in-root-view.html`](gap-03-drill-in-root-view.html) | [`gap-03-drill-in-root-view-bailout.md`](gap-03-drill-in-root-view-bailout.md) | Auto-expand top-level keys in `DrillInContent`. Drawer + playground inherit the fix. |
| **04** Shape preservation | [`gap-04-shape-preservation.html`](gap-04-shape-preservation.html) | [`gap-04-fe-shape-preservation.md`](gap-04-fe-shape-preservation.md) | **Correctness.** Mark union-projected fields visually distinct. |
| **05** Dot-key disambiguation | [`gap-05-dot-key-disambiguation.html`](gap-05-dot-key-disambiguation.html) | [`gap-05-dot-key-vs-nested-disambiguation.md`](gap-05-dot-key-vs-nested-disambiguation.md) | **Correctness.** Literal-key-first behavior must be visible. |
| **06** Messages renderer | [`gap-06-messages-renderer.html`](gap-06-messages-renderer.html) | [`gap-06-messages-renderer-coverage.md`](gap-06-messages-renderer-coverage.md) | Polish — wire `ChatMessageEditor` everywhere. |

**For the team call:** open the **interactive mockup app** (preferred — `pnpm --filter design-mockups dev` then `/solutions-*`). The HTML files are still here but the live app is more useful because it mounts production components next to the proposals. Reference the `.md` docs for the full prose argument.

## Sequencing for the team conversation

**Round 0 — schema-as-entity decision (new, drives everything else):**

- Decide whether to invest in a per-testset field schema entity. Adopting Braintrust's pattern reuses one investment across the drill-in form (gap-07), playground variable validation (gap-08), variable autocomplete, and edit-time correctness checks. Staying schema-less (Langfuse pattern) keeps complexity low but caps the ceiling for gap-03 / gap-04 / gap-05. See `../competitive-analysis.md` Sections 4 + 13.

**Round 1 — agree on the vocabulary:**

- Walk through `gap-01`. Decide chip visibility default (always-on / hover / ambiguous-only) and the chip catalog.

**Round 2 — apply it to the surfaces:**

- `gap-02`. Pick the table cell rendering variant (chip + count + keys is the recommendation).
- `gap-03`. Auto-expand vs threshold vs always-cards for the drill-in root view (lands in `DrillInContent`).

**Round 3 — correctness:**

- `gap-04`. Render-only vs save-side fix for the union projection.
- `gap-05`. Decide on the `[dotted-key]` + collision-warning chips.

**Round 4 — polish:**

- `gap-06`. Lift `ChatMessageEditor` auto-detection out of `DrillInContent` so `BeautifiedJsonView` + `JsonEditorWithLocalState` render messages consistently.

**Round 5 — schema-derived surfaces (only if Round 0 says yes):**

- **gap-07** (schema-aware Edit form). Full Braintrust-style form with per-field types, or thinner "auto-expand top-level keys" affordance from gap-03 with no schema entity. See competitive analysis Sections 4 and 13.
- **gap-08** (playground variable validation). Banner on dataset-attach + per-variable tooltip when references don't resolve in the attached testset. Inherits the schema entity. See competitive analysis Section 13.

## Cross-fixture index

Which fixture exposes which gap most clearly:

| Fixture | Gaps it exposes |
| --- | --- |
| `01-flat-strings.json` | baseline — none |
| `02-nested-native.json` | gap-03 (drill-in root) — minor |
| `03-arrays.json` | **gap-02** (table cells) |
| `04-stringified-nested.json` | **gap-03** (drill-in root) — clear bailout to code editor; **gap-08** — Braintrust's variable validator false-warns on stringified-JSON columns |
| `05-mixed-per-column.json` | **gap-02** (em-dash for non-string), **gap-04** (union projection surfaces here) |
| `06-deeply-nested.json` | **gap-02**, **gap-03** — both at scale; **gap-08** — playground row-detail popover stop-gap is most useful here |
| `07-messages-and-tools.json` | **gap-06** (messages + tool_calls) |
| `08-dot-key-collision.json` | **gap-04** (the smoking gun for projection), **gap-05** (the disambiguation case); **gap-08** — both `{{a.b}}` flat-mustache and `{{$.a.b}}` JSONPath need the same validator |

## Cross-cutting consistency

All gap docs share the same UI vocabulary:

- Type chip styles defined in `gap-01`. Every other doc references them.
- Shape-preservation principle from `gap-04` constrains the rendering approaches in `gap-02` and `gap-03`.
- The `[dotted-key]` chip from `gap-05` stacks with the type chip from `gap-01`.

## Component map — anchor proposals to these

Drawers aren't a separate thing. They're surfaces that wrap a drill-in component. Proposals should land on the underlying drill-in (and the testset table cell renderer for the view-only side), not on drawer chrome.

| Component (file:line) | Mode | Consumed by | Anchor for |
| --- | --- | --- | --- |
| `DrillInContent` ([DrillInView/DrillInContent.tsx:178](../../../web/oss/src/components/DrillInView/DrillInContent.tsx)) | read or edit | The workhorse. Detects type, picks widget, renders ChatMessageEditor for messages, owns breadcrumb + raw toggle + column-mapping popover. Wrapped by every other drill-in. | gap-01, gap-03, gap-04, gap-05, gap-06 |
| `DrillInFieldHeader` ([DrillInView/DrillInFieldHeader.tsx:209](../../../web/oss/src/components/DrillInView/DrillInFieldHeader.tsx)) | read or edit | Per-field row inside `DrillInContent`. Renders field name + item count + view-mode `<Select>` (`Text`/`JSON`/`YAML`/`Markdown`/`Raw`) + action buttons. **No type chip today** — that's what gap-01 proposes adding alongside the existing chrome. | gap-01 (chip surface) |
| `EntityDualViewEditor` ([DrillInView/EntityDualViewEditor.tsx:71](../../../web/oss/src/components/DrillInView/EntityDualViewEditor.tsx)) | edit | Adds the Fields ↔ JSON toggle on top of `EntityDrillInView`. Used by testcase drawer, "Add to Testset" preview. | gap-03, gap-04 (the JSON view `?? ""` projection lives at line 144–155) |
| `TestcaseDrillInView` / `TraceSpanDrillInView` | read or edit | Thin specializers over `EntityDrillInView`. `TraceSpanDrillInView` has two render paths (`rootScope="span"` vs `"attributes"`) — see drift below. | gap-06 (drift), gap-04 (per-entity) |
| Testset table cell renderer | read | **Not** a drill-in. The view-only entry point. Clicking opens the drill-in via the drawer surface. | gap-02 |
| Playground execution item | edit | The other editable surface besides the testcase drawer. Should consume the same drill-in for testcase inputs. | gap-03, gap-04, gap-06 (verify shared component path) |

**Why this matters:** the gaps below are about behaviors the drill-in either lacks or implements inconsistently across its three specializers. Fix in `DrillInContent` + `DrillInFieldHeader` and the change propagates to every consumer.

## Drill-in component drift (note before fixing)

Behaviors diverge across the drill-in family today. Worth surfacing in the team call so the fixes don't accidentally bake the drift in further.

1. **Two render paths in `TraceSpanDrillInView`** (`DrillInView/TraceSpanDrillInView.tsx:472–697`). `rootScope="span"` uses `BeautifiedJsonView` (envelope-unwrapped, no drill navigation). `rootScope="attributes"` uses the standard field-drill path. Same trace looks different depending on which surface opened it. Trace drawer picks beautified; "Add to Testset" picks attributes. Touches `gap-06`.
2. **Stringified-JSON auto-parsing diverges by `valueMode`**. Testcase (`valueMode="string"`) auto-parses stringified JSON at the column level (`DrillInContent.tsx:354–388`). Trace span (`valueMode="native"`) auto-parses only when rendering messages (`DrillInContent.tsx:429–465`). The same payload reads differently depending on the entity type — testcase drills into nested keys, trace shows a raw string. Touches `gap-04`.
3. **ChatMessageEditor auto-detection lives only in `DrillInContent`** (`line 1284`, `isChatMessageObject` check). `BeautifiedJsonView` unwraps message envelopes but doesn't render the editor — just cleaned JSON. `JsonEditorWithLocalState` shows raw JSON, no message detection. Result: the same message object renders three different ways depending on which view caught it. Touches `gap-06`.
4. **Two parallel `DrillInContent` implementations.** The drill-in lives in three tiers, with the OSS copy 2× the size of the package copy and architecturally different:
   - **Tier 1 — `@agenta/ui/drill-in`** (`web/packages/agenta-ui/src/drill-in/`). Entity-independent, dependency-injected framework. `core/DrillInContent.tsx` is **798 lines**. Renderers (`FieldRenderer`, `SchemaRenderer`) come in via props. Default field renderer is a simple JSON `<pre>`. Adds schema awareness (`getSchemaAtPath`, `getFieldViewModeOptions`, `getDefaultFieldViewMode`) and controlled-mode path (`currentPath`) — features the OSS copy lacks.
   - **Tier 2 — `@agenta/entity-ui/drill-in`** (`web/packages/agenta-entity-ui/src/DrillInView/`). Molecule-first wrappers + 14 schema-aware controls (`NumberSliderControl`, `GroupedChoiceControl`, `ToolSelectorPopover`, etc.). Exports `MoleculeDrillInView`, `useDrillIn`, `DrillInSlots` (slot-based composition), `DrillInClassNames` (themeable styling), and adapters (`createMoleculeDrillInAdapter`, etc.). Re-exports Tier 1 for convenience.
   - **Tier 3 — OSS** (`web/oss/src/components/DrillInView/`). The 1581-line `DrillInContent` we've been anchoring on. Imports `ChatMessageEditor` / `SharedEditor` / `EditorProvider` directly — no DI. Adds three OSS-only props (`toolbarContent`, `hideRootBreadcrumb`, `renderExternalControls`) that **are wired into the render path but have no external callers in the OSS codebase** — declared but unused. Plus `EntityDrillInView`, `EntityDualViewEditor`, `TestcaseDrillInView`, `TraceSpanDrillInView`, `BeautifiedJsonView` — all OSS-specific.

   **Most likely history:** OSS came first (monolithic, app-specific), Tier 1 was extracted later as a DI framework, Tier 2 added the molecule-first paradigm. OSS hasn't migrated to the package version because its rendering pipeline is fixed (no DI hooks); a port is non-trivial. Touches every gap — picking which tier to land a fix in is a real architectural decision.

**Recommendation before fixing any gap:**

1. Agree on whether the OSS or the package `DrillInContent` is canonical. Our read: the package version is the future (DI, slot-based, schema-aware), but the OSS version is what's shipping today, used by 6+ surfaces (`TestcaseEditDrawer`, `AnnotationTestcaseContent`, `DataPreviewEditor`, `TraceContent`, `OverviewTabItem`, `PlaygroundTestcaseEditor`). Migrating those is a separate project.
2. For the chip-system fix (`gap-01`): land it as a slot override on `DrillInSlots.fieldHeader` (`FieldHeaderSlotProps` in Tier 2) *and* in OSS's `DrillInFieldHeader.tsx:209`. Slot path is the future-proof one; OSS path is what users see today.
3. Agree on whether `BeautifiedJsonView` + `JsonEditorWithLocalState` should delegate to `DrillInContent` for type-detection-driven rendering, or stay as alternative renderers. Without that decision, every fix below ships into one path and silently leaves the other two stale.

*Detail of OSS-only / package-only props is in the design-mockups app — see the new `/molecule-drill-in` page for a side-by-side mount.*

## Out of scope

- Backend changes (BE is correct)
- Mustache template format (RFC WP-B3, separate)
- LLM-as-a-judge unification (RFC WP-B1/B2, separate)
- Storage-format conversion (RFC says preserve; fully implemented today, no UI affordance needed for v1)
