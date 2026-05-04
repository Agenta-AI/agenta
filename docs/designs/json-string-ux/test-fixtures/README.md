# Test Fixtures — JSON ↔ String UX Exploration

Eight testset JSON files covering the structural patterns the UX needs to handle. Same country/capital theme so screenshots feel consistent across views.

## The fixtures

| File | What it exercises | Why it matters |
|---|---|---|
| `01-flat-strings.json` | Top-level string keys only — no nesting anywhere | Baseline. Should look identical in Fields and JSON view. |
| `02-nested-native.json` | Native nested objects under `inputs` and `outputs` | The "ideal" shape. Tests that drawer Fields view drills in cleanly. |
| `03-arrays.json` | Arrays of primitives + arrays of records | Tests how arrays render in cells and how the drawer handles "array of objects" (e.g. `neighbors`). |
| `04-stringified-nested.json` | All nested values stored as JSON-encoded strings | The trace-import / legacy-upload pattern. Tests that `detectDataType` recognizes inner JSON and the Fields view drills in transparently. |
| `05-mixed-per-column.json` | Same column has different types across rows: string / object / stringified-JSON / array / null / number | The hardest case. Tests that the table cell renderer handles per-cell type and the column header signals "mixed." |
| `06-deeply-nested.json` | 4-5 level deep nesting (`context.demographics.population.by_atoll.Funafuti`) | Stresses drill-in UX, tree expansion, JSON view scroll behavior. |
| `07-messages-and-tools.json` | Chat messages + tool_calls, with `messages` as a typed list | Tests messages-type rendering vs generic JSON. Includes legacy stringified `tool_calls.arguments`. |
| `08-dot-key-collision.json` | Literal dotted keys (`"geo.region": "..."`) coexisting with nested objects (`geo: { region: "..." }`) — including direct collisions on the same first segment | Tests the literal-key-first vs nested-traversal contract from the RFC. Row 4 has BOTH `"geo.region"` and `geo: { region }` with different values to surface which one wins. Row 5 stresses three-level dotted keys (`"user.profile.name"`) plus a parallel nested `user.profile` tree. |

## How to use this

1. **Upload each file as a separate testset** in Agenta (4 testcases each ≈ enough variety).
2. **Take screenshots from these views per testset:**
   - Testset table page (full page)
   - Testset table page (column header expanded if applicable)
   - Testcase drawer — Fields view (one example testcase)
   - Testcase drawer — JSON view (same testcase)
   - Testcase drawer — Fields view with one nested object expanded / drilled-in
   - Workflow Revision drawer "Generations" panel showing this testcase as Inputs/Outputs
   - Optional: testset row drawer for a row with a "weird" type (e.g. row 1 vs row 2 in `05-mixed-per-column`)
3. **Drop the screenshots back into chat** with a label per file (e.g. "fixture 04 — testset table" / "fixture 04 — drawer Fields").
4. **I'll then run /design-shotgun per fixture-view pair** and produce a dedicated alternative discovery doc per case at `docs/designs/json-string-ux/variants/<fixture>-<view>.md`.

## Why seven separate files instead of one big one

- Each fixture isolates one structural concern. Easier to reason about UX choices when only one variable changes.
- Same theme (countries/capitals) keeps the visual feel consistent so cross-fixture comparisons aren't muddied by content differences.
- Lets the team flip between fixtures in the call without re-loading mental context.

## Recommended upload order

Start in this order to build visual context progressively:

1. `01-flat-strings.json` — establishes the baseline
2. `02-nested-native.json` — adds first level of nesting
3. `04-stringified-nested.json` — show the legacy/trace-import case (most likely to drive UX decisions)
4. `05-mixed-per-column.json` — the per-cell-type evidence
5. `03-arrays.json` — array-specific concerns
6. `06-deeply-nested.json` — drill-in stress test
7. `07-messages-and-tools.json` — messages-type carve-out
8. `08-dot-key-collision.json` — literal dotted keys vs nested-path semantics

## Notes on fixture 08 (dot-key collision)

The five rows are designed to expose specific UX questions:

| Row | What it has | What we want to see |
| --- | --- | --- |
| 1 (Tuvalu) | `"geo.region"` literal dot key, no nested `geo` | Does the Fields view show this as a flat property `geo.region` or try to render under a synthesized `geo` group? |
| 2 (Kiribati) | Pure nested `geo: { region, subregion }`, no literal dot keys | Control row — should render as a nested object. |
| 3 (Comoros) | Both `"geo.region"` literal AND `geo: { subregion }` — disjoint sub-keys | Are they shown as siblings? As one merged group? Distinct visual indicator that one is literal? |
| 4 (Vanuatu) | `"geo.region": "LITERAL_DOT_VALUE"` AND `geo: { region: "NESTED_PATH_VALUE" }` — direct collision | The literal-key-first rule says template `{{geo.region}}` should resolve to `"LITERAL_DOT_VALUE"`. Does the UI surface that the literal key shadows the nested path? |
| 5 (Nauru) | Three-level dot keys (`"user.profile.name"`, `"user.profile.role"`) + parallel nested `user.profile.{name,preferences.theme}` | Stresses depth and combination. Does the UI handle three-segment literal keys? Does it visually disambiguate from the nested tree? |

The same questions apply to template authoring:

- `{{geo.region}}` in a curly prompt — does the editor's typeahead show both candidates?
- `{{$.geo.region}}` JSONPath — does it always resolve via traversal (ignore literal key)?
- Does the variables panel make the difference visible?

## Note on file format

These are arrays of testcase objects matching the shape the testset uploader currently accepts. If the upload format requires wrapping (e.g. `{"testcases": [...]}` or CSV), let me know and I'll convert each.
