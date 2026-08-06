# Divider — migration guide

**antd `Divider` → `@agenta/ui` presentational `Divider`** (plain `<div>`, NO Radix,
`@agenta/ui/ui`) · status: **✅ primitive built; call-sites not yet migrated** · no visual change.

## TL;DR
A presentational `@agenta/ui` `Divider` (no `forwardRef`, `data-slot="divider"` on the root,
`role="separator"`). Reproduces antd's three shapes: full-width horizontal line, inline
vertical line, and the with-text horizontal layout (two `border-t` rails flanking a centered/
left/right label). Line colour = antd `colorSplit` (`border-colorSplit`); text colour =
`colorTextHeading` default / `colorText` when `plain`. Margins map antd's measured tokens to
the Tailwind spacing scale. `dashed` and `plain` supported; `size`/`orientationMargin`/rich
config deferred.

## Before
```tsx
import {Divider} from "antd"

<Divider />
<Divider dashed />
<Divider>Text</Divider>
<Divider orientation="left">Text</Divider>
<Divider plain>Text</Divider>
Left<Divider type="vertical" />Right
```

## After
```tsx
import {Divider} from "@agenta/ui/ui"

<Divider />
<Divider dashed />
<Divider>Text</Divider>
<Divider orientation="left">Text</Divider>
<Divider plain>Text</Divider>
Left<Divider type="vertical" />Right
```
Same JSX — the props are mirrored 1:1.

## Usage
- Horizontal line: `<Divider />` (add `dashed` for a dashed line).
- With text: pass `children`; `orientation="left" | "right" | "center"` positions the label
  (default `center`); `plain` gives lighter, normal-weight text.
- Vertical: `<Divider type="vertical" />` between two inline nodes.
- End state: import `Divider` from `@agenta/ui/ui`; never from `antd`.

## Prop mapping (antd → `@agenta/ui`)
| antd | `@agenta/ui` |
|---|---|
| `type="horizontal" \| "vertical"` (axis) | `type` (same) |
| `orientation="left" \| "right" \| "center"` (text position) | `orientation` (same) |
| `dashed` | `dashed` |
| `plain` | `plain` |
| `children` (text) | `children` |
| `orientationMargin` | — deferred (fixed 0.05 / 5-95 split; see Deliberate deviations) |
| `size="small" \| "middle"` | — deferred (default margins only) |
| `variant="dotted"` / `titlePlacement` (v6) | — deferred |

## Infra added
**None.** No palette / generator / bridge / `controlScale` change. Every value maps to an
existing token or the default Tailwind spacing/font scale (see mapping below).

## antd → token mapping (ground truth: `antd/es/divider/style/index.js` + app `antd-themeConfig.json`)
All values MEASURED from the app's antd theme config (this app overrides antd defaults:
`fontSize` 12, `fontSizeLG` 14, not antd's stock 14/16).
| antd token / rule | value (this app) | class |
|---|---|---|
| line colour `colorSplit` | `rgba(5,23,41,.06)` L / `rgba(253,253,253,.12)` D | `border-colorSplit` |
| line width `lineWidth` | `1px` | `border-t` / `border-l` (1px) |
| horizontal margin `marginLG` | `24px` | `my-6` |
| with-text margin `margin` | `16px` | `my-4` |
| vertical marginInline `marginXS` | `8px` | `mx-2` (+ `my-0`) |
| vertical height | `0.9em` | `h-[0.9em]` |
| vertical nudge `top` | `-0.06em` | `relative -top-[0.06em]` |
| with-text (default) colour `colorTextHeading` | `#1c2c3d` L / `rgba(255,255,255,.85)` D | `text-colorTextHeading` |
| with-text (default) weight | `500` | `font-medium` |
| with-text (default) size `fontSizeLG` | `14px` | `text-sm` |
| with-text `plain` colour `colorText` | `#1c2c3d` L / `rgba(255,255,255,.85)` D | `text-colorText` |
| with-text `plain` weight | `normal` | `font-normal` |
| with-text `plain` size `fontSize` | `12px` | `text-xs` |
| inner-text padding `textPaddingInline` | `1em` | `px-[1em]` |
| rail split `orientationMargin` | `0.05` → 5% / 95% (center 50/50) | `w-[5%]` / `w-[95%]` / `w-[50%]` |
| with-text line-height (all sizes) | `1.6667` (5/3): 14px→23.33px, 12px→20px | `leading-[1.6666666666666667]` |

## Gotchas
- **`border-0` first, then re-add ONE side — REQUIRED, and the cause of a real defect.** Preflight
  is off AND the app applies a global default `border-width` (~1.5px) to elements. `border-solid
  border-colorSplit` sets only style+colour, so every UNSET side kept the ~1.5px default: the plain
  horizontal line rendered `1px (top) + 1.5px (bottom) = 2.5–4px` tall instead of antd's 1px
  (invisible in a screenshot; caught by computed-style height). Fix: `border-0` to zero all four
  sides, then `border-t` (horizontal/rails) or `border-l` (vertical) to draw the one edge. Verified
  1px/1px/10.8×1 vs antd.
- **`border-solid` sets the style** (the `border`/`border-t` utilities only set width). `dashed`
  swaps to `border-dashed`.
- **With-text row height needs an explicit `leading-[..]` — and it must come AFTER the text-size
  class.** antd's inner-text line-height is 5/3 (1.6667) at every size (14px→23.33px, 12px→20px);
  Tailwind's `text-sm`/`text-xs` bundle a shorter line-height (20px/16px), so the row rendered
  ~3px short. `leading-[1.6666666666666667]` overrides it. IMPORTANT: putting the leading in the
  cva BASE (which cva emits *before* the variant's `text-sm`) let `cn`/tailwind-merge drop it
  (font-size/leading resolved as last-wins → `text-sm` won). Keep the leading in each `plain`
  variant string, after `text-sm`/`text-xs`.
- **`box-border`** matches antd's box model (border-box) under preflight-off.
- **With-text has a different DOM than the plain line.** antd zeroes the root's `borderBlockStart`
  for with-text and moves the line to the rails, so the `@agenta/ui` with-text root carries NO border —
  the two `<span>` rails do (`border-t border-colorSplit`). The plain/vertical line carries its
  border on the root.
- **Rails are flex children with percentage widths**, not `flex-1`. antd sets explicit rail
  widths (50/50 center, 5/95 left, 95/5 right) and lets flex-shrink accommodate the label — the
  5/95 basis is what produces the short-rail-on-the-side look. Reproduced with `w-[5%]`/`w-[95%]`.
- **`1em` text padding and `0.9em`/`-0.06em` are em units, not raw pixels** — kept as antd wrote
  them (relative to the divider's font-size), which the no-raw-pixels rule permits.
- **App font tokens differ from stock antd.** with-text default is 14px (`fontSizeLG`) and plain
  is 12px (`fontSize`) HERE; stock antd would be 16/14. Measured from `antd-themeConfig.json`.

## Deliberate deviations
- **`orientationMargin` deferred.** Fixed at antd's default 0.05 (5/95 rail split). Compose /
  extend later if a call-site needs a custom offset — do NOT add an antd-shaped prop speculatively.
- **`size` (small/middle) deferred.** Only the default margins are reproduced (`marginLG` /
  `margin` / `marginXS`). antd's `size` maps the vertical margin to `marginXS`/`margin`; add when a
  call-site needs it.
- **`variant="dotted"` and v6 `titlePlacement`/`vertical` aliases deferred** — `dashed` covers the
  used case; the v6 `orientation`-as-direction rename is intentionally NOT adopted (this API keeps
  `type` for the axis and `orientation` for text, per the migration brief and legacy call-sites).

## Verification (VRT first, computed-style as fallback)
`parity/vrt.mjs` is the primary gate (run by the orchestrator). Story `AntdVsAgenta`
(`title: "antd/Layout/Divider"`) rows: horizontal, horizontal dashed, with-text center,
with-text left, with-text plain, vertical (a vertical divider between two text spans). Each
cell is a fixed 220px slot so the full-width horizontal lines measure consistently.

Divider is non-interactive (no hover/focus/active states) and provably non-focusable (a
`<div>`/`<span>` with no `tabindex`), so there is no `InteractionStates` story. A thin 1px line
reads slightly high on the pixel VRT from AA (parity README noise-floor caveat) — expected.

Element GEOMETRY was computed-style verified vs antd in both themes (heights are the reliable
signal a screenshot hides): horizontal `1px`, dashed `1px`, with-text center/left `23.33px`,
with-text plain `20px`, vertical `10.8px × 1px` — all exact matches; line colour = `colorSplit`
(`rgba(5,23,41,.06)` L / `rgba(253,253,253,.12)` D) on both the plain line and the with-text rails.

## For agents hitting conflicts
- The component is `web/packages/agenta-ui/src/components/ui/divider.tsx`; the export line is
  `export {Divider, type DividerProps} from "./divider"` in that dir's `index.ts`, immediately
  after `export {Switch, type SwitchProps} from "./switch"`.
- No shared-infra edit was made — colours are existing bridge color keys (`colorSplit`,
  `colorTextHeading`, `colorText`) and geometry is the default Tailwind spacing/font scale.
