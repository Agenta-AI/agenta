# Spinner (antd `Spin` → `@agenta/ui/ui`)

## TL;DR
antd `Spin`'s default indicator is ported as a presentational cva component (plain `span`s,
no Radix — no Radix equivalent exists). It reproduces antd v6's rotating 4-dot square:
four `currentColor` dots pinned to the corners of a square, the group held at 45° (so they
read as a diamond) and spun continuously with the built-in Tailwind `animate-spin` keyframe.
`size` (small/default/large) + `tip` map 1:1. No visual change vs antd. The wrap-children
mask mode is deferred.

## Before
antd `<Spin>` / `<Spin size="small">` / `<Spin tip="Loading…">`, rendered as
`span.ant-spin-dot-holder > span.ant-spin-dot.ant-spin-dot-spin > 4× i.ant-spin-dot-item`
(the `Looper` indicator), styled by antd's cssinjs (`spin/style/index.js`).

## After
`@agenta/ui/ui` `Spinner`. DOM: `span[data-slot=spinner]` (the `ant-spin-section` flex
column) → `span[data-slot=spinner-indicator]` (holder, static 45°) →
`span[data-slot=spinner-rotor]` (`animate-spin`) → 4× `span[data-slot=spinner-dot]`, plus
an optional `div[data-slot=spinner-tip]`. cva `size` variant controls the holder box.

## Usage
```tsx
// Not yet exported from the `@agenta/ui/ui` barrel (index.ts was out of scope for the
// build); add `export {Spinner, spinnerVariants, type SpinnerProps} from "./spinner"` to
// web/packages/agenta-ui/src/components/ui/index.ts when wiring the first call-site.
import {Spinner} from "@agenta/ui/ui"

<Spinner />                        // default (20px) indicator
<Spinner size="small" />           // 14px
<Spinner size="large" />           // 28px
<Spinner tip="Loading…" />         // indicator + label below
<Spinner aria-label="Fetching results" />
```

## Prop mapping (antd `<Spin size tip>` → ours)
| antd | ours | notes |
|---|---|---|
| `size` `"small"\|"default"\|"large"` | `size` (same) | holder 14/20/28px |
| `tip` / `description` | `tip` | label under the indicator; `ReactNode` |
| `indicator` (custom node) | — | not ported; default indicator only |
| `spinning` | — | standalone component is always shown; caller conditionally renders it |
| `children` / `fullscreen` / `percent` | — | wrap-children mask + fullscreen + progress deferred |
| — | `aria-label` | new: accessible name (default `"Loading"`), see §Accessibility |

## Infra added
**None.** Reuses `bg-current` + `text-colorPrimary` (the `colorPrimary` Tailwind colour
from `antdTailwind` in `oss/tailwind.config.ts`), Tailwind's built-in spacing scale for the
holder (`size-3.5`/`size-5`/`size-7`) and dots (`size-1.5` + arbitrary `size-[9px]`/
`size-[13px]`), and the built-in `animate-spin` keyframe (no new keyframe needed).

## antd → geometry mappings (MEASURED in Storybook against the app theme, not stock antd)
The app theme overrides antd's seed tokens: `controlHeight=28`, `controlHeightLG=40`,
base `fontSize=12` (antd stock is 32/40/14). So the source formulae resolve to:
- Holder (`--ant-spin-dot-holder-size`): small `controlHeightLG*0.35`=**14** (`size-3.5`),
  default `controlHeightLG/2`=**20** (`size-5`), large `controlHeight`=**28** (`size-7`).
- Dot item (`(holderSize - marginXXS/2)/2`, `marginXXS`=4): small **6** (`size-1.5`),
  default **9** (`size-[9px]`), large **13** (`size-[13px]`). Each `scale(0.75)` (`scale-75`),
  `opacity 0.3` (`opacity-30`), `border-radius:100%` (`rounded-[100%]`), `currentColor`.
- Dots at the 4 corners: `top/left`, `top/right`, `bottom/right`, `bottom/left` (`inset` 0).
- Colour: antd `ant-spin-section` `color:colorPrimary`, dots + tip use `currentColor`. Ours:
  root `text-colorPrimary`, dots `bg-current`, tip inherits — light `#1c2c3d`, dark
  `rgb(209,209,81)`, both verified equal to antd.
- Layout: `inline-flex` column, `items-center`, `gap:paddingSM`=12px (`gap-3`).
- Tip = `ant-spin-description`: `fontSize`=12px + `line-height:1` → `text-xs leading-none`.
- Rotation: antd spins `.ant-spin-dot-spin` 45°→405° (`antRotate`) at **1.2s linear infinite**.
  We put the static 45° on the holder and drive `animate-spin` (0°→360°, linear) on a nested
  rotor, overriding the duration with `[animation-duration:1.2s]`. Verified computed
  `animation-duration:1.2s` / `animation-timing-function:linear` equal to antd.

## Accessibility (a small, deliberate win over antd)
antd's `Spin` root sets only `aria-live="polite"` + `aria-busy`. Ours adds `role="status"`
and an `aria-label` (default `"Loading"`, overridable), so screen readers announce a named
busy status. Still non-interactive: no `tabindex`, not focusable.

## Gotchas
- `box-border` required (preflight OFF app-wide).
- **Combining `rotate-45` and `animate-spin` on ONE element loses the 45° base** — the
  animation's `transform` keyframe overrides the static rotate during playback (and at the
  frozen VRT frame). Split it: static 45° on the holder, `animate-spin` on a nested rotor.
  The 45° is what turns the corner-dots into antd's recognisable diamond, so it must survive.
- The holder's `rotate-45` inflates its `getBoundingClientRect` to `holder*√2` (28.28 for the
  20px default), but CSS transforms don't affect the LAYOUT box — flow still reserves the
  untransformed 20px, so the `gap-3` to the tip stays 12px. antd's rotating dots have the same
  visual overhang; layout is unaffected in both.
- Dot `getBoundingClientRect` reads `base*0.75*√2` (e.g. default 9→9.55) because it includes
  both the `scale(0.75)` and the parent 45° rotation — that is the number to compare, and it
  matches antd exactly. Do not expect the raw px.
- antd dot radius is `100%`, not `9999px`; use `rounded-[100%]` (`rounded-full` reports
  `9999px` and would flag a computed-style diff, though it renders identically on a square).

## Verification
VRT first: `pnpm --filter @agenta/storybook vrt antd-feedback-spinner--antd-vs-agenta`
(light + dark). The indicator rotates — the VRT freezes it (`.finish()`), so residual
rotation **phase** between the two frozen frames is expected animation-phase noise, not a
defect; a static (angle-0) match is the contract. Computed-style parity confirmed in both
themes for all three sizes: holder 14/20/28, dot bounding 6.36/9.55/13.79 (=base 6/9/13),
radius `100%`, dot + tip colour, `gap` 12px, tip 12px/`line-height:1`, `animation-duration`
1.2s linear. Small controls have an elevated pixel-noise floor (GOTCHAS §control floor), so
geometry was verified via `getComputedStyle`, not pixel %. Non-interactive → proven
non-focusable.

## Deferred pieces
- **Wrap-children mask mode** (`<Spin spinning><Content/></Spin>` — the blur/overlay over
  wrapped content, `ant-spin-container` + `::after` mask + `ant-spin-nested-loading`). This
  is a composition (mask + positioned indicator) over the standalone indicator built here;
  add it when a call-site needs it.
- **Custom `indicator`, `fullscreen`, `percent` (progress ring)** — not ported.

## Deliberate deviations
- **Dot sizes `size-[9px]`/`size-[13px]` are arbitrary px**, not `controlScale` keys — the
  values (9, 13) aren't on any existing scale and config edits were out of scope. They match
  antd exactly. A future cleanup could add a `spin-dot-*` scale family to `controlScale`.
- **`role="status"` + `aria-label`** added (antd omits them) — an intentional a11y
  improvement, not a visual change.
- **Rotation keyframe differs** (`spin` 0→360 vs antd `antRotate` 45→405) but both are 360°
  linear at 1.2s; only the phase offset differs, absorbed by the holder's static 45°.

## For agents hitting conflicts
Geometry's source of truth is antd's `spin/style/index.js` (`prepareComponentToken` +
`genIndicatorStyle`/`genSizeStyle`), BUT resolve the tokens against the APP theme
(`controlHeight=28`, `controlHeightLG=40`, `fontSize=12`), not antd's seed — re-measure in
Storybook (`getComputedStyle`) rather than trusting the stock numbers. Keep colour on
`colorPrimary`/`currentColor` and rotation on `animate-spin` + `[animation-duration:1.2s]`;
never hardcode hex.
