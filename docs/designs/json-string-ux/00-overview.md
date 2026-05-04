# JSON ↔ String UX — Overview

**Context:** RFC "Prompt Variables, JSON Values, and LLM Runtime Unification" (Mahmoud, 2026-04-30). WP-F1 requires a JSON ↔ string switching pattern that lives consistently across four surfaces.

**Mahmoud's ask:** "the RFC proposes a solution on how the frontend should behave but does not describe the UX. Would love if you can propose some thoughts before jumping into implementation."

**Competitive context (added 2026-05-04):** see [`competitive-analysis.md`](competitive-analysis.md) — 50 screenshots of Braintrust + Langfuse running our 8 fixtures. Surfaced two new candidate gaps (07, 08 below) and reordered priorities by leverage. Schema-as-entity is Braintrust's moat and the highest-leverage move on the table.

**Core principle (from RFC):** *Native JSON stays native until template rendering.* Type travels with the value. The user's choice is preserved through save / load / invocation.

## Four surfaces

| Surface | Editability | Why it's tricky |
| --- | --- | --- |
| Playground variable panel + testcase editor | Full edit | Authoring entry point. Type discovery must be obvious. |
| Testset table + drawer | Full edit, bulk | Cells are narrow. Same column has mixed types across rows. |
| Observability / trace views | Read-only + drill-in | Value types come from runtime, not user. |
| Evaluation result views | Read-only + drill-in | Mix of testcase data + computed scores. |

## What we already have

The team's existing design philosophy: **the storage format is the user's; display/edit is JSON-like.** This is largely already implemented.

| Capability | Status | Code |
| --- | --- | --- |
| Detect data type from value | Done | `detectDataType` in `web/oss/src/components/TestcasesTableNew/components/TestcaseEditDrawer/fieldUtils.ts:185` |
| Round-trip preservation: storage format unchanged on edit | Done | `textModeToStorageValue` in same file:255 |
| Widget selection by detected type (object → code editor, string → text input) | Done | `DrillInContent` Fields view (consumed by the testcase drawer + others) |
| Nested traversal through stringified JSON (`inputs.prompt` works whether `inputs` is object or JSON-encoded string) | Done | `testcaseCellAtomFamily` in `web/packages/agenta-entities/src/testcase/state/store.ts:660-672` |
| Mutation through stringified JSON with format preservation | Done | `deleteColumnFromTestcasesAtom` + `isJsonString` flag, store.ts:919-960 |
| Faithful JSON view (renders the user's stored format as-is) | Done | `EntityDualViewEditor` JSON mode |
| **Testset table column expansion**: homogeneous nested object columns expand into sub-column groups (`context > demographics + geo > coordinates + region + subregion`). Drilling to leaf scalars works | Done | testset table column-grouping logic |
| **Drill-in component**: nested objects render as per-property cards with type-driven widgets after one click | Done | `DrillInContent` workhorse (wrapped by `EntityDrillInView`, `TestcaseDrillInView`, `TraceSpanDrillInView`); surfaced via `EntityDualViewEditor` in drawers / "Add to Testset" preview / playground |

**Important reframe:** screenshot 7's escaped quotes (`"outputs": "{\"countryName\":...}"`) are not a bug. They show the user's stored format faithfully. The Fields view detects this as `json-object` and presents an object editor; the JSON view shows raw storage. Both are correct. This typically happens when a testset is created from traces or imported from JSON files where nested values are already stringified — the team's design intentionally preserves that.

## What's actually new for the RFC

After reviewing 8 fixtures and their backend responses, the gaps split into 6 focused frontend concerns. **Backend is correct — the BE preserves the user's authored shape exactly.** All gaps are FE-side.

**Important framing:** the gaps are about the *cases the existing capabilities don't cover*, not about replacing what works. Column expansion already handles homogeneous nested objects in the table. The drill-in already handles nested editing. The proposals below compose with both, addressing only the leftover cases (mixed-type columns, arrays, collapsed leaf-object previews, root-level Fields default, type chips, messages renderer at root, dot-key disambiguation labels).

See [`variants/index.html`](variants/index.html) (or [`variants/README.md`](variants/README.md)) for the gap docs. Order: vocabulary → surfaces → correctness → polish.

| # | Gap | Anchor fixture(s) |
| --- | --- | --- |
| 01 | Type chips — visible type indicators (the shared visual vocabulary used by every other gap) | all |
| 02 | Testset table cells render objects/arrays as raw multiline JSON or `—` | `03`, `05`, `06` |
| 03 | Drill-in root view bails to one giant code editor instead of cards | `04`, `06`, `07` |
| 04 | **Correctness:** union projection. The drill-in JSON view materializes empty fallbacks for keys not actually authored on this row. Under literal-key-first templating, these can silently shadow nested values if the runtime gets the projected shape. | `02`, `08` |
| 05 | **Correctness:** literal `"geo.region"` vs nested `geo.region` need visual disambiguation | `08` |
| 06 | ChatMessageEditor only kicks in after Drill In; tool_calls never get rich view | `07` |
| **07** | **Surfaced 2026-05-04 by competitive analysis.** Schema-aware Edit form on the testcase drill-in. Per-testset field schema becomes a first-class entity; drill-in renders as a labelled form with type-aware inputs per column when a schema exists; falls back to existing detection-driven view otherwise. **Cross-cutting**: addresses gap-03 + chunks of gap-04 / gap-05 / gap-01 in one investment. | all |
| **08** | **Surfaced 2026-05-04 by competitive analysis.** Playground variable validation. (a) Banner on dataset-attach naming the canonical references (`{{(input)}}`, `{{(expected)}}`, `{{(metadata)}}`). (b) Per-variable tooltip when a referenced path doesn't exist in the attached testset's schema, with a `Remove variable` quick-action. Edit-time check, not runtime. **Inherits the schema entity from gap-07.** | `04`, `06`, `08` |

Plus the runtime concern (RFC WP-F2):

**WP-F2** — Native JSON in playground request body. Playground execution still stringifies object/array values before invoking runtime. Separate from the 6 gaps above; RFC's central transport fix.

Existing capabilities (`detectDataType`, round-trip preservation, transparent stringified-JSON traversal, ChatMessageEditor) are intact and don't need rework — they just need to be wired everywhere they should be.

## What this doc set covers

The active gap docs live in [`variants/`](variants/) (open `index.html` for the landing page). The earlier all-surfaces draft is preserved in [`archive/`](archive/) for reference only — the gap docs supersede it.

| File | Topic |
| --- | --- |
| [`variants/index.html`](variants/index.html) | Landing page · component map · drift findings · reading order |
| [`variants/gap-01-type-chips.html`](variants/gap-01-type-chips.html) | Type chips — the shared visual vocabulary |
| [`variants/gap-02-table-cells.html`](variants/gap-02-table-cells.html) | Testset table cells (the view-only entry point) |
| [`variants/gap-03-drill-in-root-view.html`](variants/gap-03-drill-in-root-view.html) | Drill-in root view (`DrillInContent` auto-expand) |
| [`variants/gap-04-shape-preservation.html`](variants/gap-04-shape-preservation.html) | Union projection — render-only or save-side fix |
| [`variants/gap-05-dot-key-disambiguation.html`](variants/gap-05-dot-key-disambiguation.html) | Literal `"geo.region"` vs nested path |
| [`variants/gap-06-messages-renderer.html`](variants/gap-06-messages-renderer.html) | Lift `ChatMessageEditor` auto-detection out of `DrillInContent` |
| [`competitive-analysis.md`](competitive-analysis.md) | Braintrust + Langfuse audit (50 screenshots, our 8 fixtures). Surfaces gap-07 and gap-08 and revises the priority order. |

## Decisions block implementation

Detail in each gap doc's "Recommendation" section. Open questions for the team call:

0. **Schema-as-entity** — adopt Braintrust's pattern (per-testset field schema, reused in drill-in form, validation, playground variable resolution) or stay schema-less (Langfuse pattern, JSON-as-opaque). **This decision drives gap-07 and gap-08** and shapes the ceiling for gap-03 / gap-04 / gap-05. New as of 2026-05-04 competitive analysis.
1. Chip visibility default (always-on / hover / ambiguous-only) — gap-01.
2. Table cell renderer — chip + count + keys vs mini JSON tree vs single-line JSON — gap-02.
3. Drill-in root view — auto-expand vs threshold vs always-cards — gap-03.
4. Union projection — render-only marker vs save-side filter vs both — gap-04.
5. Dot-key disambiguation — `[dotted-key]` chip everywhere vs collision-only warn — gap-05.
6. Messages renderer — lift `ChatMessageEditor` detection into a shared renderer that `BeautifiedJsonView` + `JsonEditorWithLocalState` delegate to, or accept divergence — gap-06.
7. **Schema-aware Edit form scope** (gap-07) — full Braintrust-style form with per-field types and per-field PATCH save, or thinner "auto-expand top-level keys" affordance from gap-03 with no schema entity. The full form is the higher ceiling; the thinner option is the cheaper first delivery.
8. **Playground variable validation surface** (gap-08) — inline banner only, banner + tooltip, or banner + tooltip + autocomplete from schema. Each step adds complexity; the banner alone is high-leverage and cheap.

## What this doc set does NOT cover

- Backend schema changes for cell-level type metadata (RFC-level decision)
- Mustache vs Curly format choice (RFC WP-B3, separate decision)
- Provider/model unification (RFC WP-B1, separate)
- Variable autocomplete deep nesting (out of v1 scope per RFC)
