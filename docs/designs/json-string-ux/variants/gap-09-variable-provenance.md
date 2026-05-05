# Gap 09 — Variable provenance + usage state in the playground execution item

**Scope:** Frontend only.

**Anchor surface:** playground execution item (kitchen-sink Vanuatu fixture)

**Surfaced 2026-05-05.** Each variable in the playground execution item has a 2-axis state: *authoring* (on the testcase, or a draft from prompt typing not yet synced) × *usage* (referenced by every prompt, by some prompts in a chain, or by none). Today's playground renders all variables identically. The proposed Variable map collapses unused variables, marks drafts with a dashed border, and shows chain scope per row.

## What's broken today

The playground execution item's inputs panel shows every column on the testcase identically, regardless of whether any prompt template references it. That has three concrete failure modes:

1. **Unused columns crowd the panel.** A 12-column testset where only 3 columns are referenced by prompts shows 12 inputs in the panel. The 9 unused columns bury the active ones.
2. **Draft variables disappear into the void.** When a user types `{{iso_code}}` into a prompt and the testcase doesn't have `iso_code`, the playground silently substitutes empty string at run time. There's no UI showing "you've referenced a variable that isn't on this row."
3. **Chain configs hide per-prompt scope.** In multi-prompt chains, prompt 1 might reference `{{geo}}` while prompt 3 references `{{languages}}`. The user has to read every prompt template to figure out which variable lands where.

Gap-08 catches case 2 partially — it warns at edit-time on the *prompt* surface when a referenced path doesn't resolve in the attached testset's schema. It doesn't surface cases 1 or 3 at all, and the warning lives on the prompt rather than the execution item.

## The four states

Each variable in the execution item resolves to one of four states:

| State | Authored on testcase? | Used by ≥1 prompt? | Chain scope |
| --- | --- | --- | --- |
| `used` | yes | yes (every prompt) | n/a |
| `chain` | yes | yes (some prompts) | partial |
| `draft` | no | yes (≥1 prompt references it) | any |
| `unused` | yes | no | n/a |

Rendering treatment per state:

- **`used`** — default rendering. No extra chip. Type chip + name + value preview as today.
- **`chain`** — same as `used` plus a `[chain]` chip whose `label` is overridden to `prompt 1, 3 of 4` so the user sees the scope without reading every template. Total prompt count comes from the chain config.
- **`draft`** — dashed pink border around the row + `[draft]` chip + inline italic hint *"not on testcase yet · syncs on save"*. Distinct visually because draft state has runtime correctness implications: the variable doesn't exist on this row and will substitute empty unless the user syncs.
- **`unused`** — collapsed under a "Show N unused variables" toggle by default. When expanded, rendered with reduced opacity + `[unused]` chip. The toggle is sticky per execution item (or per-user) so power users can pin it open.

## Why this is its own gap

It composes with three other gaps but doesn't fold cleanly into any of them:

- **gap-04 (union projection)** is the same shape at the testcase level — "this row doesn't author every column the testset has." Gap-04 lives on the testcase drill-in. Gap-09 lives on the playground execution item and adds the prompt-usage axis.
- **gap-07 (schema-aware form)** raises gap-09's ceiling: with a per-testset schema, "draft" disambiguates without inference (the schema is the source of truth for what's on the testcase). Without gap-07, draft state is best-effort and may mis-classify legitimate optional columns.
- **gap-08 (playground variable validation)** is the symmetric edit-time check on the *prompt* surface. Gap-08 warns when a `{{x}}` reference doesn't resolve. Gap-09 surfaces the same condition on the *execution item* + adds the inverse direction (authored-but-unused) + chain-scope visibility.

## Visual budget

The playground execution item is already busy. Default settings keep noise low:

- Unused variables collapsed behind a toggle. Default closed.
- Chain badges only when scope is partial. A variable used by every prompt in the chain gets no badge (degenerate `1, 2, 3, 4 of 4` is just `used`).
- Draft border + chip only on draft rows. The other three states reuse standard chrome.
- Type chips (gap-01) still ride on every row, but the variable-state chips (`unused` / `draft` / `chain`) carry the gap-09 vocabulary in muted neutral colors so they don't compete with the type chip.

The "Show unused" toggle gives power users full visibility on demand without paying the visual cost by default.

## Detection

Three inputs the UI needs:

1. **Testcase data keys** — already available (`testcase.data` keys).
2. **Prompt template variable references** — parse `{{name}}` / `{{$.path}}` from the prompt body. Production likely has this for syntax highlighting; if not, a simple regex matches the gap-08 detection. For dotted paths, use the gap-05 disambiguation rules.
3. **Chain prompt index** — comes from the chain config (which prompts in what order). Each prompt's variable references map to a position in `[1..N]`.

The four states fall out of joining these three sets:

- Variable on testcase + referenced by all prompts → `used`
- Variable on testcase + referenced by *some* prompts → `chain`
- Variable referenced by ≥1 prompt + NOT on testcase → `draft`
- Variable on testcase + NOT referenced by any prompt → `unused`

No backend dependency. No schema entity required (gap-07 raises the floor of correctness but isn't a blocker).

## Recommendation

Ship the Variable map section above the existing inputs body in the playground execution item. Default behavior: unused variables collapsed, chain badges visible on partial-scope variables, draft border on referenced-but-not-authored rows. Add a "Sync drafts to testset" affordance on the draft row (or on the variable map header when ≥1 draft exists) to close the loop on case 2 above without forcing a manual save.

When gap-07's schema entity ships, swap the inferred `draft` detection for the schema-driven version so optional columns aren't false-positive `draft`.

## Cross-references

- `gap-04` — union projection (same shape at the testcase level)
- `gap-07` — schema entity raises gap-09's correctness ceiling
- `gap-08` — symmetric edit-time check on the prompt surface
- `gap-01` — chip vocabulary (`[unused]`, `[draft]`, `[chain]` are gap-09 additions to the gap-01 catalog)
