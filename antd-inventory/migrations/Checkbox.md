# Checkbox — migration guide

**antd `Checkbox` → `@agenta/ui` `Checkbox`** (Radix `@radix-ui/react-checkbox`, `@agenta/ui/ui`) ·
status: **✅ primitive built; call-sites not yet migrated** · no visual change.

## TL;DR
A `@agenta/ui` `Checkbox` in current shadcn source style (no `forwardRef`, `data-slot` on Root **and** Indicator) re-skinned to
antd v6's Checkbox geometry via the shared `controlScale` (`size-control-check` = 16px,
`rounded-control-sm` = 6px) and coloured only through bridge tokens. Single size (antd has no
small checkbox). `indeterminate` is expressed through Radix's `checked="indeterminate"`. antd's
`Checkbox.Group` is out of scope (see Deliberate deviations).

## Before
```tsx
import {Checkbox} from "antd"

<Checkbox checked={on} onChange={(e) => setOn(e.target.checked)}>Label</Checkbox>
<Checkbox indeterminate />
<Checkbox defaultChecked disabled />
```

## After
```tsx
import {Checkbox} from "@agenta/ui/ui"

<label className="inline-flex items-center gap-2">
    <Checkbox checked={on} onCheckedChange={setOn} />
    <span>Label</span>
</label>
<Checkbox checked="indeterminate" />
<Checkbox defaultChecked disabled />
```

## Usage
- Controlled: `checked` + `onCheckedChange`. Uncontrolled: `defaultChecked`.
- `onCheckedChange` receives the Radix `CheckedState` (`boolean | "indeterminate"`), value-first
  and NOT a DOM event — antd's `onChange(e => e.target.checked)` becomes `onCheckedChange(next)`.
- Indeterminate is a `checked` value, not a separate `indeterminate` boolean: pass
  `checked="indeterminate"`.
- The box carries no label. antd's inline label (children) is composed with an outer `<label>`
  + `gap-2` (antd's label gap is 8px). Replicate at the call-site.
- End state: import `Checkbox` from `@agenta/ui/ui`; never from `antd`.

## Prop mapping (antd → `@agenta/ui`)
| antd | `@agenta/ui` |
|---|---|
| `checked` | `checked` |
| `defaultChecked` | `defaultChecked` |
| `indeterminate` | `checked="indeterminate"` (Radix `CheckedState`) |
| `onChange(e)` (`e.target.checked`) | `onCheckedChange(next)` (value-first, no event) |
| `disabled` | `disabled` |
| children (label) | compose with an outer `<label>` + `gap-2` |
| `Checkbox.Group` / `value` / `options` | — deferred (see Deliberate deviations) |

## Infra added
None to the shared layer. The `controlScale` keys `control-check` (16px) and `control-check-dash`
(7px) were added by the shared-infra owner beforehand and consumed here via `size-control-check`
(box) and `size-control-check-dash` (indeterminate square). No palette/generator/bridge change —
every colour maps to an existing token. The checkmark's own glyph dims (5.71×9.14) are small
literals (glyph metrics, like Switch's 2px track padding), not scale keys.

## antd → token mapping (ground truth: measured on the running Storybook, light + dark)
All values MEASURED via `getComputedStyle` on the real antd v6 Checkbox (`.ant-checkbox` +
`::after`) in both themes — not assumed.

| antd rule (v6) | measured value (light / dark) | class |
|---|---|---|
| box size | 16×16 | `size-control-check` |
| box radius `borderRadiusSM` | 6px (both) | `rounded-control-sm` |
| box border | 1px solid | `border border-solid` |
| unchecked bg `colorBgContainer` | `#ffffff` / `rgb(20,20,20)` | `bg-background` |
| unchecked border `colorBorder` | `#bdc7d1` / `#424242` | `border-border` |
| hover border `colorPrimary` | navy / olive | `enabled:hover:border-primary` |
| checked bg+border `colorPrimary` | `#1c2c3d` / `#d1d151` | `enabled:data-[state=checked]:bg-primary` + `…:border-primary` |
| checked mark `.ant-checkbox::after` (rotated-border check) | 5.71×9.14, `#ffffff` right+bottom 2px borders, rotate 45° translate(-50%,-50%), anchor 50%/25% | `<span>` `w-[5.71px] h-[9.14px] border-2 border-t-0 border-l-0 border-colorWhite [transform:rotate(45deg)_translate(-50%,-50%)] left-1/4 top-1/2` |
| **indeterminate box** | **stays white bg + `colorBorder` (NOT filled)** | (no state override — base skin) |
| **indeterminate mark `colorPrimary`** | **7×7 filled square, navy / olive, centred** | `<span>` `size-control-check-dash bg-primary left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2` |
| disabled bg `colorBgContainerDisabled` | `rgba(5,23,41,.04)` / `rgba(255,255,255,.08)` | `disabled:bg-colorBgContainerDisabled` |
| disabled border `colorBorder` | `#bdc7d1` / `#424242` | `disabled:border-border` |
| disabled+checked mark `colorTextDisabled` | `#bdc7d1` / `rgba(255,255,255,.25)` | `group-disabled:text-colorTextDisabled` |
| focus `genFocusStyle` | 4px solid `colorPrimaryBorder`, offset 1px, `:focus-visible` | `focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-1 focus-visible:outline-focus-ring` |

## Gotchas
- **antd v6 dropped `.ant-checkbox-inner`.** The styled box is now `.ant-checkbox` itself (the
  span), with a hidden `.ant-checkbox-input` inside and the mark drawn on `::after` — same class
  of rename as Select v6 (`.ant-select-selector` → `.ant-select`). A parity selector written for
  v5's `.ant-checkbox-inner` silently reads nothing. Measured on `.ant-checkbox` + its `::after`.
- **Indeterminate is a white box + a small primary square, NOT a filled-primary box.** This is
  the one place the build spec was wrong: measured, antd v6 indeterminate keeps the resting white
  box (`colorBgContainer` bg, `colorBorder` border) and draws a 7×7 `colorPrimary` square in the
  centre. So the box gets NO `data-[state=indeterminate]` colour override, and the mark is a
  `bg-primary` `<span>` sized `size-control-check-dash` (7px), NOT a lucide `Minus` bar. Only the
  CHECKED state fills the box primary.
- **The marks are CSS, not lucide glyphs — they reproduce antd's `.ant-checkbox::after` exactly.**
  A lucide `<Check>` renders a 12×12 square-ish tick; antd's is a tall-thin rotated-border check
  (5.71×9.14). Matched by building the same rotated-border `<span>` (2px white right+bottom
  borders, `[transform:rotate(45deg)_translate(-50%,-50%)]`, `box-border`, transform-origin
  centre). Both marks are absolutely positioned in the Root's padding box (Root is `relative`),
  anchored `left-1/4 top-1/2` (check) / `left-1/2 top-1/2` (square) — identical to antd's `::after`
  percentages against the 14px padding box. Measured: agenta check matrix
  `(0.707,0.707,-0.707,0.707,1.21258,-5.2453)` vs antd `(…,1.21258,-5.25082)` (sub-pixel); square
  visual rect 4.5/4.5 == antd 4.5/4.5.
- **Disabled must beat checked → gate the checked colour with `enabled:`.** antd disabled+checked
  keeps `colorBgContainerDisabled` (NOT primary). `disabled:` and `data-[state=checked]:` are
  equal-specificity, so string order alone won't guarantee the override. Writing the checked bg as
  `enabled:data-[state=checked]:bg-primary` makes the two states mutually exclusive; `disabled:`
  then always wins when disabled. Verified in both themes (disabled-checked reads the disabled bg,
  not primary).
- **The Radix Root is a native `<button>`** → needs the CONTROL_RESET (`box-border border-solid
  font-[inherit] p-0`) under preflight-off, same as Button/Switch. It also needs `relative` so the
  absolutely-positioned marks anchor to its padding box (antd's `::after` mechanism).
- **Mark show/hide via `group` + `group-data-[state=…]`.** Radix `Indicator` renders for BOTH
  checked and indeterminate; the Root carries `group`, and the check `<span>` / square `<span>`
  each gate on `group-data-[state=checked]` / `group-data-[state=indeterminate]` (`hidden` →
  `block`) so the right mark shows. Disabled+checked recolours the check via
  `group-disabled:border-colorTextDisabled`.
- **`colorTextDisabled` == `colorBorder` in LIGHT** (both `#bdc7d1`) but they DIVERGE in dark
  (`rgba(255,255,255,.25)` vs `#424242`). The disabled mark uses `colorTextDisabled`, the box
  border `colorBorder` — kept as separate tokens so dark stays correct.

## Deliberate deviations
- **None on the marks — both are exact.** (Earlier drafts used a lucide `<Check>` at 12px and an
  8px `control-dot` square; both were replaced with exact CSS reproductions of antd's `::after` —
  5.71×9.14 rotated-border check and a 7px `control-check-dash` square — verified by computed
  style, so there is no glyph/size deviation to declare.)
- **`Checkbox.Group` deferred.** antd's group (`options`/`value`/`onChange` over many boxes) is a
  composition, not a primitive. Do NOT add antd-shaped group props here — compose the bare box.

## Verification (VRT first, computed-style as fallback)
`parity/vrt.mjs` is the primary gate (run by the orchestrator). Stories:
- `AntdVsAgenta` — unchecked, checked, indeterminate, disabled-unchecked, disabled-checked,
  with-label (6 rows).
- `InteractionStates` — unchecked/checked × hover + focus-visible, indeterminate, disabled
  (unchecked & checked); forced statically via `pseudo-hover-all` / `pseudo-focus-visible-all`.

Computed-style ground truth (this migration): box geometry, all state colours, AND both marks
(check glyph size/transform, indeterminate square size/position) were measured to match antd 1:1
in BOTH themes (unchecked / checked / indeterminate / disabled-unchecked / disabled-checked). Note
at 16px the pixel-diff % is unreliable (a 1px shift flips a large fraction of the tiny canvas) —
verify the marks via computed style, not the VRT %. Confirm any forced antd `:hover`/`:focus-visible` VRT flag with
`measureForcedStates()` — the pseudo addon can't reliably force antd's runtime-injected CSS and a
1px border under a forced state antialiases (GOTCHAS §Interaction-state / parity README).

## For agents hitting conflicts
- The component is `web/packages/agenta-ui/src/components/ui/checkbox.tsx`; the export line is
  `export {Checkbox, type CheckboxProps} from "./checkbox"` in that dir's `index.ts`, immediately
  after the Switch export line.
- Geometry lives in `oss/tailwind.config.ts` `controlScale` (`control-check` 16 /
  `control-check-dash` 7) — retune there, never in the component. The check glyph's 5.71×9.14 are
  small literals in the component (glyph metrics). Colours are all existing bridge tokens/color
  keys; no palette edit was made.
