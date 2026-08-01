# Component migration guides

One guide per migrated component (antd → `@agenta/ui/ui`). Each records
**how it was, how it is now, and how to use it** — so an agent (or human) can pick up
a component later, resolve a merge conflict, or extend it **without re-deriving the
context**, and so the migration recipe stays consistent across components.

## Index
| Component | From → To | Tactic | Status | Guide |
|---|---|---|---|---|
| DraftTag | antd `Tag` → `Badge` (`draft`) | facade | ✅ | [DraftTag.md](DraftTag.md) |
| SyncStateTag | antd `Tag` (preset) → `Badge` (`blue`/`green`) | facade | ✅ | [SyncStateTag.md](SyncStateTag.md) |
| StatusTag | antd `Tag` (semantic) → `Badge` (existing variants) | facade | ✅ | [StatusTag.md](StatusTag.md) |
| SourceIndicator | antd `Tag` (preset) → `Badge` | facade | ✅ | [SourceIndicator.md](SourceIndicator.md) |
| MappingStatusTag | antd `Tag` (preset) → `Badge` | facade | ✅ | [MappingStatusTag.md](MappingStatusTag.md) |
| VersionBadge / TypeChip | (already antd-free) | — | ✅ n/a | — |
| **Badge family** | **complete** | | ✅ | |
| Button | antd `Button` → `@agenta/ui` `Button` (+ `LoadingButton`) | prop translation | ✅ | [Button.md](Button.md) |
| Input | antd `Input`/`TextArea`/`Search`/`Password` → `@agenta/ui` `Input` + composed | prop translation | ✅ | [Input.md](Input.md) |
| Select | antd `Select` → `@agenta/ui` `Select` (Radix) | composition | ✅ primitive / ⬜ call-sites | [Select.md](Select.md) |
| Combobox | antd `Select showSearch` → searchable select (Popover + trigger input) | composition | ✅ built + 2 call-sites | [Combobox.md](Combobox.md) |
| Tooltip | antd `Tooltip` → `@agenta/ui` `Tooltip` (Radix) | composition | ✅ primitive / ⬜ call-sites | [Tooltip.md](Tooltip.md) |
| Switch | antd `Switch` → `@agenta/ui` `Switch` (Radix) | prop translation | ✅ primitive / ⬜ call-sites | [Switch.md](Switch.md) |
| Radio | antd `Radio.Group` → `@agenta/ui` `RadioGroup` (Radix) | composition | ✅ primitive / ⬜ call-sites | [Radio.md](Radio.md) |
| Checkbox | antd `Checkbox` → `@agenta/ui` `Checkbox` (Radix) | prop translation | ✅ primitive / ⬜ call-sites | [Checkbox.md](Checkbox.md) |
| Alert | antd `Alert` → `@agenta/ui` `Alert` (cva, no Radix) | composition | ✅ primitive / ⬜ call-sites | [Alert.md](Alert.md) |
| Divider | antd `Divider` → `@agenta/ui` `Divider` (cva, no Radix) | prop translation | ✅ primitive / ⬜ call-sites | [Divider.md](Divider.md) |
| DropdownMenu | antd `Dropdown` → `@agenta/ui` `DropdownMenu` (Radix) | composition | ✅ primitive / ⬜ call-sites | [Dropdown.md](Dropdown.md) |
| Tabs | antd `Tabs` (line) → `@agenta/ui` `Tabs` (Radix) | composition | ✅ primitive / ⬜ call-sites | [Tabs.md](Tabs.md) |
| Collapse | antd `Collapse` → `@agenta/ui` `Accordion` (Radix) | composition | ✅ primitive / ⬜ call-sites | [Collapse.md](Collapse.md) |
| Skeleton | antd `Skeleton` → `@agenta/ui` `Skeleton` (cva, no Radix) | composition | ✅ primitive / ⬜ call-sites | [Skeleton.md](Skeleton.md) |
| Dialog | antd `Modal` → `@agenta/ui` `Dialog` (Radix) | composition | ✅ primitive / ⬜ call-sites | [Dialog.md](Dialog.md) |
| AlertDialog | antd `Modal.confirm`-style → `@agenta/ui` `AlertDialog` (Radix) | composition | ✅ primitive / ⬜ call-sites | [Dialog.md](Dialog.md) |
| Sheet | antd `Drawer` → `@agenta/ui` `Sheet` (Radix Dialog, `side`) | composition | ✅ primitive / ⬜ call-sites | [Sheet.md](Sheet.md) |
| Spinner | antd `Spin` → `@agenta/ui` `Spinner` (cva, no Radix) | prop translation | ✅ primitive / ⬜ call-sites | [Spinner.md](Spinner.md) |
| Progress | antd `Progress` (line) → `@agenta/ui` `Progress` (cva, no Radix) | prop translation | ✅ primitive / ⬜ call-sites | [Progress.md](Progress.md) |
| Segmented | antd `Segmented` → `@agenta/ui` `Segmented` (cva, no Radix; sliding thumb) | prop translation | ✅ primitive / ⬜ call-sites | [Segmented.md](Segmented.md) |
| Avatar | antd `Avatar` → `@agenta/ui` `Avatar` (Radix) + `AvatarBox` | composition | ✅ primitive / ⬜ call-sites | [Avatar.md](Avatar.md) |

**Before you start:** read [../GOTCHAS.md](../GOTCHAS.md) — the symptom→cause→fix reference of
traps hit building the harness, bridge, and first component — and
[../../web/storybook/parity/README.md](../../web/storybook/parity/README.md) for the two gates
(VRT first, `measure.js` fallback). Saves hours.

## The recipe (every component follows this)
1. **Measure the current rendering** in Storybook (`getComputedStyle`, light + dark) — ground truth, not the source files (the `--ag-c-*` shim can surprise you).
2. **Add the variant(s)** the component needs to the `@agenta/ui` component, backed by the palette-derived `--ag-*` layer (add a palette family + generator rows + bridge token if no existing token fits — see DraftTag.md §Infra).
3. **Verify parity** in a comparison story with BOTH gates (see
   [`web/storybook/parity/README.md`](../../web/storybook/parity/README.md)):
   - **Pixel VRT first** — `pnpm --filter @agenta/storybook vrt` (self-baselining, antd-half vs
     agenta-half, light+dark). It is the catch-all: border/radius/shadow/width/colour/icon at
     once, no per-component tuning. Classify every flagged row (real defect / ~1–2% AA noise /
     `not reproduced` structural). It found the 8px dropdown width, the wrong Combobox arrow, and
     the Select selected-check that hand-picked measurements missed.
   - **Computed-style `measure.js`** for exact token values and for forced `:hover`/`:focus`
     (the pixel diff is unreliable on antd's runtime-injected hover — use `measureForcedStates()`).
   Cover **all variants × light + dark × every interaction state.** For anything with an overlay
   (Select/Combobox/Dialog/Tooltip/Menu) the closed trigger is NOT enough — add a forced-OPEN
   `[data-open-compare]` story so the VRT diffs the open panel. No move forward without full alignment.
4. **Prove EVERY interaction state** (interactive components) — not just hover/focus. Enumerate
   the full CSS-state set that applies: `:hover`, **`:active` (pressed)**, `:focus` /
   `:focus-visible` / **`:focus-within`** (the last for composed affix wrappers — a `focus:` on
   the wrapper span never fires; use `focus-within:`), `:disabled`, `[aria-invalid]`, `:read-only`,
   and for list options the **selected** (`[data-state=checked]`) state and its combination with
   **highlighted** — selected ≠ focused. Verify each with an `InteractionStates` story (forced
   statically via `storybook-addon-pseudo-states` `pseudo-*-all` wrappers — use
   `pseudo-active-all` / `pseudo-focus-within-all`, not just hover/focus) in BOTH themes: run the
   **VRT first**, then confirm any antd forced-state flag with `measureForcedStates()` (antd
   forced states are pixel-unreliable — bordered variants read high from 1px-border AA). A focus
   affordance deliberately removed is an acceptable regression ONLY if explicit and proven
   (e.g. disabled → not focusable).
   Non-interactive components must be **proven non-focusable**. For overlay/panel components,
   add a forced-OPEN `[data-open-compare]` story (`defaultOpen`/`open` + inline portal
   `container`) so the VRT diffs the open panel. See GOTCHAS §Interaction-state / §Stateful.
5. **Facade the component** over the `@agenta/ui` one (keep its public API; render the `@agenta/ui` one internally). Check its consumers' props first (`grep '<Component'`) so the facade doesn't drop a used prop.
6. **Document + reconcile.** Add/update the guide + [../STATUS.md](../STATUS.md), then run the
   **consistency scrub** (GOTCHAS §Definition of done): reconcile the rolling docs, don't just
   append — grep the old approach's terms and delete anything a later rework made stale. A
   component is not complete until this pass is done.

**Hard rules for the component itself:** current shadcn source style (no `forwardRef`,
`data-slot` on the root); no raw pixels or hex (geometry from `controlScale`, colour from
the `shadcnTokens` bridge); no antd-shaped extension props — compose instead; and register
any new type ramp in `cn`'s `extendTailwindMerge` (GOTCHAS §"The scale + `cn`").

## Guide format
`## TL;DR` · `## Before` (old code) · `## After` (new code) · `## Usage` (existing +
new-code guidance + end-state) · `## Prop mapping` · `## Infra added` (palette/generator/
bridge/variant) · `## Gotchas` · `## Verification` (VRT-first; computed-style for tokens/forced
states) · `## Deliberate deviations` (if any) · `## For agents hitting conflicts`.

## Migration principle (hard rule)
**No visual change.** Preserve the current rendering EXACTLY, warts included. Where the
current rendering is a clear artifact (e.g. a legacy-shim quirk), preserve it and **flag
it as a candidate cleanup** — do not silently "fix" it. Cleanups are separate, explicit,
deliberate visual changes.
