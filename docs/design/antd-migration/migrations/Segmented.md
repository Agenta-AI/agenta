# Segmented — migration guide

**antd `Segmented` → `@agenta/ui` `Segmented` (custom cva, NO Radix, `@agenta/ui/ui`)** ·
status: **✅ primitive built; call-sites not yet migrated** · no visual change.

## TL;DR
A custom `@agenta/ui` `Segmented` — a `role="radiogroup"` of `<button role="radio">` options on
a rounded track, with ONE absolutely-positioned **sliding thumb** behind the active option that
animates its `transform`/`width` to the active item's measured box (antd's `motionDurationMid`
ease). shadcn source conventions (no `forwardRef`; `data-slot` on `segmented` / `segmented-item`
/ `segmented-thumb`). Reproduces antd's `Segmented` geometry/colour from MEASURED tokens: track
bg `colorBgLayout`, thumb bg `colorBgElevated` + `boxShadowTertiary`, inactive text
`colorTextLabel` → active/hover `colorText`. Three sizes (sm/default/lg), `block`, `disabled`,
per-option `disabled`. No Radix (antd's Segmented is a single-select pill group, not a menu).

## Before
```tsx
import {Segmented} from "antd"

<Segmented
    value={view}
    onChange={setView}
    size="middle"
    options={[
        {label: "Grid", value: "grid", icon: <SquaresFour />},
        {label: "List", value: "list", icon: <ListBullets />},
        {label: "Table", value: "table", disabled: true},
    ]}
/>
```

## After
```tsx
import {Segmented} from "@agenta/ui/ui"

<Segmented
    value={view}
    onChange={setView}
    size="default"
    options={[
        {label: "Grid", value: "grid", icon: <SquaresFour />},
        {label: "List", value: "list", icon: <ListBullets />},
        {label: "Table", value: "table", disabled: true},
    ]}
/>
```
The `options` shape is unchanged (`string[]` or `{label, value, icon, disabled}[]`). Only the
`size` vocabulary changes: antd `small|middle|large` → `sm|default|lg`.

## Usage
- Controlled: `value` + `onChange(value)`. Uncontrolled: `defaultValue` (defaults to the first
  option when omitted).
- `size="sm" | "default" | "lg"`; `block` for full-width (options flex-grow equally); `disabled`
  for the whole control; `disabled` on an option to disable just that one.
- Icon-only options: pass `icon` and set `"aria-label"` on the option (screen-reader name).
- Keyboard: `ArrowLeft/Up` / `ArrowRight/Down` move + select the previous/next enabled option
  (wrapping); `Home`/`End` jump to first/last; roving `tabIndex` (only the active option is in
  the tab order, like a native radiogroup).
- End state: import from `@agenta/ui/ui`; never render antd `Segmented`.

## Prop mapping (antd → `@agenta/ui`)
| antd | `@agenta/ui` |
|---|---|
| `options` (`string[]` / `{label,value,icon,disabled}[]`) | `options` — identical |
| `value` | `value` |
| `defaultValue` | `defaultValue` |
| `onChange={(v) => …}` | `onChange={(v) => …}` (value only; antd also passes value) |
| `size="small"` | `size="sm"` |
| `size="middle"` (default) | `size="default"` |
| `size="large"` | `size="lg"` |
| `block` | `block` |
| `disabled` | `disabled` |
| option `disabled` | option `disabled` |
| icon-only option | option `icon` + `"aria-label"` |
| `name` (radio form name) | — deferred (not a form control today) |

## Infra added
**None.** No palette / generator / bridge / `controlScale` change. Every value maps to an
existing bridge token, `controlScale` key, or default Tailwind scale (see mapping below).

## antd → token mapping (ground truth: `getComputedStyle` in Storybook, light + dark)
MEASURED from the app's antd `Segmented` (this app overrides antd defaults — `fontSize` 12,
`controlHeight` 28, `colorBgLayout` = `#fff` L / `#000` D). Every property below verified equal
antd vs agenta across all three sizes, both themes.
| antd token / rule | value (this app) | class |
|---|---|---|
| `trackBg` = `colorBgLayout` | `#fff` L / `#000` D (blends into page) | `bg-colorBgLayout` |
| `trackPadding` | 2px | `p-0.5` |
| track radius = `borderRadius{SM,,LG}` | 6 / 8 / 10 px | `rounded-control-sm` / `rounded-control` / `rounded-control-lg` |
| track height = `controlHeight{SM,,LG}` | 24 / 28 / 34 px | `h-control-sm` / `h-control` / `h-control-lg` |
| item height (track − 2×pad) | 20 / 24 / 30 px | `h-full` (fills the track inner box) |
| item h-padding = `controlPaddingHorizontal{SM,} − lineWidth` | 7 / 11 / 11 px | `px-input-sm` / `px-input` / `px-input-lg` |
| item radius = `borderRadius{XS,SM,}` | 4 / 6 / 8 px | `rounded` / `rounded-control-sm` / `rounded-control` |
| item font = `fontSize` (sm/def), `fontSizeLG` (lg) | 12 / 12 / 14 px, lh 20 | `text-field-md` (sm/def) / `text-field-lg` (lg) |
| `itemColor` (inactive) = `colorTextLabel` | `#586673` L / `rgba(255,255,255,.65)` D | `text-colorTextLabel` |
| `itemSelectedColor` / `itemHoverColor` = `colorText` | `#1c2c3d` L / `rgba(255,255,255,.85)` D | `data-[state=active]:text-colorText`, `…hover:text-colorText` |
| `itemHoverBg` = `colorFillSecondary` | `rgba(5,23,41,.06)` L / `rgba(255,255,255,.12)` D | `…hover:bg-colorFillSecondary` |
| `itemActiveBg` (pressed) = `colorFill` | `rgba(5,23,41,.15)` L / `rgba(255,255,255,.18)` D | `…active:bg-colorFill` |
| thumb bg `itemSelectedBg` = `colorBgElevated` | `#fff` L / `#242424` D | `bg-colorBgElevated` |
| thumb shadow = `boxShadowTertiary` | theme-flipping (dark adds a 1px white ring) | `shadow-tertiary` |
| disabled text = `colorTextDisabled` | `#bdc7d1` L / `rgba(255,255,255,.25)` D | `disabled:text-colorTextDisabled` |
| focus ring = `colorPrimaryBorder` (4px) | `#d6dee6` L / algo D | `focus-visible:outline-4 …outline-focus-ring` |

## How the sliding thumb works
One `[data-slot=segmented-thumb]` div renders behind the options (`z-0`; items are `z-10`). A
`useLayoutEffect` measures the active item's `offsetLeft/Top/Width/Height` (relative to the
`position:relative` track) and stores it; the thumb is placed with `left-0` + inline
`transform: translateX(left)` + `top`/`width`/`height`. On selection change it re-measures and
the CSS transition (`transition-[transform,width] duration-200 ease-[cubic-bezier(0.645,0.045,0.355,1)]`
= antd `motionDurationMid` + `motionEaseInOut`) animates the pill to the new box. A `ResizeObserver`
on the track re-measures for `block`/full-width and font-load reflows. The transition class is
gated behind a `requestAnimationFrame` flag (`readyRef`) so the thumb appears in place on first
paint and only *slides* on subsequent changes. **No tailwind.config keyframe needed** — a plain
CSS transition on transform/width is sufficient.

## Gotchas
- **`left-0` on the thumb is REQUIRED.** An absolutely-positioned element with `left:auto` uses
  its *static* position; adding `translateX(offsetLeft)` on top double-offsets it. `left-0` pins
  the origin to the track's padding box so `translateX(offsetLeft)` lands exactly on the item.
- **`border-0` on the track (and thumb), not `border-solid`.** Preflight is off, so the app's
  global default border-width (~1.5px) leaks on all sides of any bordered element. antd's track
  has no border; the phantom border shrank the track's content box (`clientHeight` 25 vs 28) so
  `h-full` items resolved to 21px instead of 24. `border-0` zeroes it. (See GOTCHAS §single-side
  border / native-button.)
- **antd's large font lives on the item LABEL (14px), not the item (12px).** Measuring
  `.ant-segmented-item-selected` reports `fontSize:12px` at `size="large"`, but the visible text
  renders at 14px on the inner `.ant-segmented-item-label`. Our button IS the label, so `lg` uses
  `text-field-lg` (14px). sm/default stay 12px (antd does not bump them).
- **Icon centering (the known trap).** antd centres the label by `line-height`, so a bare inline
  `<svg>` sits on the text baseline and reads a few px LOW. We centre the item *content* with
  flexbox (`items-center justify-center` + `[&_svg]:block`) — the fix is on the label box, not the
  icon. Measured `deltaY:0` between the item mid-Y and the icon mid-Y. (See
  `reference_antd_segmented_icon_centering`.)
- **Track bg blends into the page in light** (`colorBgLayout` = `#fff`); the thumb is
  distinguished only by its shadow. This is antd's actual rendering — preserved verbatim.
- **No item separators.** antd v6 in this theme draws NO divider between adjacent items (the item
  `::after` is a transparent hover overlay; `::before` content is `none`). Do not add separators.
- **`bg-transparent` + `border-0` on the item `<button>`.** Preflight off → a bare `<button>`
  leaks the UA `buttonface` fill (loud in dark) and a phantom border.

## Verification
Ground truth: `getComputedStyle` in the running Storybook (`antd/Data Entry/Segmented`), light +
dark, transitions killed before reads. All equal antd vs agenta:
- **Geometry** (sm/default/lg): track height 24/28/34, radius 6/8/10; item width (`Daily`)
  42/50/55, item height 20/24/30, radius 4/6/8, h-padding 7/11/11, font 12/12/14 — all exact.
- **Thumb** covers the active item's box exactly (bounding-rect Δ ≤ 0.3px sub-pixel), bg
  `#fff` L / `#242424` D, shadow layers identical (Tailwind prepends invisible ring placeholders).
- **Dark**: track `#000`, text `.85`/`.65`, thumb `#242424` + white-ring shadow — matched.
- **Interaction** (`InteractionStates` story, `storybook-addon-pseudo-states`): hover → `colorText`
  + `colorFillSecondary`; active/pressed → `colorText` + `colorFill`; disabled → `colorTextDisabled`;
  focus-visible → 4px `colorPrimaryBorder` ring. antd's hover/active *bg* is runtime-injected
  cssinjs the pseudo addon can't force, so those were confirmed against antd's `Segmented` token
  config (`itemHoverBg`/`itemActiveBg`), per GOTCHAS.
- **Behaviour**: click and Arrow/Home/End change selection and slide the thumb (verified live);
  `aria-checked`/roving `tabIndex` update.
- **A11y**: root `role="radiogroup"`; options `role="radio"` with `aria-checked`, accessible name
  (label or `aria-label`), roving tabindex; icon-only options carry `aria-label`. Structurally
  axe-clean.
- Gates: `pnpm --filter @agenta/ui exec tsc --noEmit` clean; `eslint --fix` clean.
- **Not run** (out of scope for this task): the pixel VRT (`parity/vrt.mjs`). When migrating
  call-sites, run the VRT in both themes and classify every flagged row per the recipe.

## Deliberate deviations
- **`size` vocabulary** is `sm|default|lg` (the @agenta/ui convention, matching Button/Input), not
  antd's `small|middle|large` — no antd-shaped props kept alive (recipe hard rule). Map at the
  call-site.
- **`onChange` receives the value only.** antd's signature is `(value) => void` already; unchanged.
- **`name` (radio form-name) not implemented** — deferred; add if a form call-site needs it.

## For agents hitting conflicts
- The component is `web/packages/agenta-ui/src/components/ui/segmented.tsx`; the parity story is
  `web/storybook/stories/Segmented.stories.tsx` (imported via a RELATIVE path because Segmented is
  not yet exported from the `@agenta/ui/ui` barrel `index.ts`). To make it importable as
  `@agenta/ui/ui`, add `export {Segmented, type SegmentedProps, type SegmentedOption} from "./segmented"`
  to `index.ts` and switch the story import.
- Three cva blocks: `segmentedTrackVariants`, `segmentedItemVariants`, `segmentedThumbVariants`.
  Geometry lives in the `size` variants; keep the track/item/thumb size keys in lock-step (radii
  4/6/8, heights, padding — see the token table).
- The thumb is measured, not CSS-positioned — if you change item padding/height/gap, the thumb
  follows automatically via `useLayoutEffect` + `ResizeObserver`; do not hardcode thumb geometry.
