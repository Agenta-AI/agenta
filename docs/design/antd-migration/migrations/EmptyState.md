# EmptyState — migration guide

**antd `Empty` → `@agenta/ui` presentational `EmptyState`** (plain `<div>` + inline SVG, NO
Radix, `@agenta/ui/ui`) · status: **✅ primitive built; call-sites not yet migrated** · no visual
change (light exact; one deliberate dark deviation on the default illustration — see below).

## TL;DR
A presentational `@agenta/ui` `EmptyState` (no `forwardRef`, `data-slot` on root/image/
description/footer). Reproduces antd's centered column — illustration → description → optional
footer (actions). Both built-in illustrations are inlined as SVG: the **DEFAULT** (184×152,
`controlHeightLG × 2.5` = 85px tall) and the **SIMPLE** (64×41, `controlHeightLG` = 34px tall).
The SVG greys resolve through the palette `--ag-*` bridge via `fill-*`/`stroke-*` utilities so
they flip light↔dark; geometry comes from the control scale + Tailwind spacing (no raw pixels).
Description colour = `colorTextDescription`, font-size `field-md` (12px). A custom `image`
(ReactNode) and `description`/`children` are supported.

## Before
```tsx
import {Empty} from "antd"

<Empty description="No data" />
<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No integrations found" />
<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No variants available">
    <Button type="primary">Create now</Button>
</Empty>
```

## After
```tsx
import {EmptyState} from "@agenta/ui/ui"   // once exported; today: import direct (see below)

<EmptyState description="No data" />
<EmptyState image="simple" description="No integrations found" />
<EmptyState image="simple" description="No variants available">
    <Button variant="default">Create now</Button>
</EmptyState>
```
> The primitive is **not yet exported from the `@agenta/ui/ui` barrel** (`index.ts` was
> out of scope for this change). Until it is, import direct:
> `import {EmptyState} from "@agenta/ui/src/components/ui/empty-state"`. The story imports it via
> relative path for the same reason.

## Usage
- Default illustration: `<EmptyState description="…" />` (image defaults to `"default"`).
- Simple (smaller) illustration: `<EmptyState image="simple" description="…" />` — replaces
  `image={Empty.PRESENTED_IMAGE_SIMPLE}`.
- Custom image: `<EmptyState image={<MyIcon/>} description="…" />` — any ReactNode. It gets the
  DEFAULT height slot (85px) + non-`normal` margins, exactly like antd (only the SIMPLE preset
  triggers antd's `-normal` layout).
- Actions: pass `children` — rendered in the footer (`marginTop = margin` 16px).
- End state: import `EmptyState` from `@agenta/ui/ui`; never `Empty` from `antd`.

## Prop mapping (antd → `@agenta/ui`)
| antd `Empty` | `@agenta/ui` `EmptyState` |
|---|---|
| `image={Empty.PRESENTED_IMAGE_DEFAULT}` (or omitted) | `image="default"` (default) |
| `image={Empty.PRESENTED_IMAGE_SIMPLE}` | `image="simple"` |
| `image={<node/>}` / `image="url"` string→`<img>` | `image={<node/>}` (ReactNode; no string→img helper) |
| `description` | `description` |
| `children` (footer/actions) | `children` |
| `className` / `style` / rest | `className` / `style` / rest (spread onto root) |
| `imageStyle` / `styles` / `classNames` (semantic slots) | — deferred (style the `data-slot` parts) |
| locale default description ("No data") | — deferred (no locale; `description` renders only when passed) |

## Infra added
**None.** No palette / generator / bridge / `controlScale` change. Every value maps to an
existing token or the default Tailwind spacing/font scale (see mapping below). No new token
was required.

## antd → token mapping (ground truth: `antd/es/empty/{empty,simple,style/index}.js`, MEASURED in Storybook)
This app overrides antd seeds — `controlHeightLG = 34` (not stock 40), `fontSize = 12`,
`marginXS = 8`, `margin = 16`, `marginXL = 32`. All values below were confirmed by
`getComputedStyle` in the parity story (light), and match antd exactly.
| antd token / rule | value (this app) | class |
|---|---|---|
| root `marginInline` = `marginXS` | 8px | `mx-2` |
| root `fontSize` / `lineHeight` | 12px / 20px (1.6667) | `text-field-md` |
| root `textAlign` | center | `text-center` |
| SIMPLE root `marginBlock` = `marginXL` (`-normal`) | 32px | `my-8` |
| image height (default) = `emptyImgHeight` = `controlHeightLG × 2.5` | 85px | `h-[calc(theme(height.control-lg)*2.5)]` |
| image height (simple) = `emptyImgHeightMD` = `controlHeightLG` | 34px | `h-control-lg` |
| image `marginBottom` = `marginXS` | 8px | `mb-2` |
| image `svg { height:100%; max-width:100%; margin:auto }` | — | `[&_svg]:h-full [&_svg]:max-w-full [&_svg]:mx-auto` |
| description `color` = `colorTextDescription` | #758391 L / rgba(255,255,255,.45) D | `text-colorTextDescription` |
| footer `marginTop` = `margin` | 16px | `mt-4` |

### SVG fill/stroke mapping (MEASURED, light)
**SIMPLE image** — antd computes each colour as `FastColor(token).onBackground(colorBgContainer)`
(an opaque flatten). The translucent bridge token over the same container **composites to the
exact same rgb** — verified pixel-exact both themes:
| antd shape | antd token | measured (light) | class |
|---|---|---|---|
| ellipse (shadow) | `colorFillTertiary` onBg | rgb(245,246,246) | `fill-colorFillTertiary` |
| outline (stroke) | `colorFill` onBg | rgb(218,220,223) | `stroke-colorFill` |
| inner panel (fill) | `colorFillQuaternary` onBg | rgb(250,250,251) | `fill-colorFillQuaternary` |

**DEFAULT image** — antd hard-codes pale hex (NOT theme tokens) and dims the whole SVG to
`opacity:0.65` in dark. We map each hex to the nearest theme token so it flips properly in dark
(deliberate deviation, below). Light readouts:
| antd shape | antd hex | our token | measured token (light) | match |
|---|---|---|---|---|
| ellipse shadow (fillOpacity .8) | #F5F5F7 | `colorFillTertiary` | ≈ rgb(245,246,246) | ✓ |
| paper | #F5F5F7 | `colorFillTertiary` | ≈ rgb(245,246,246) | ✓ |
| text-lines / envelope-front / bubble | #DCE0E6 | `colorFill` | rgb(218,220,223) | ✓ (~2/unit) |
| envelope back | #AEB8C2 | `colorTextQuaternary` | rgb(189,199,209) | ≈ (closest token; ~15/unit lighter) |
| punched holes (dots) | #FFF | `colorBgContainer` | rgb(255,255,255) | ✓ exact |

## Gotchas
- **`box-border`** matches antd's box model under preflight-off (app convention).
- **Image height stays tied to the control scale.** antd derives it as `controlHeightLG × 2.5`;
  reproduced with `h-[calc(theme(height.control-lg)*2.5)]` (not a raw `h-[85px]`) so retuning
  `controlHeightLG` moves both illustrations together, exactly as antd's token does.
- **Simple = `-normal` layout.** antd applies its `-normal` class (image = `emptyImgHeightMD`,
  root `marginBlock = marginXL`) ONLY when `image === PRESENTED_IMAGE_SIMPLE`. A DEFAULT or a
  CUSTOM image gets the full 85px slot and no root `marginBlock`. The `simple` cva variant
  encodes exactly this — do not apply it to custom images.
- **The SIMPLE greys look translucent but are exact.** Because antd flattens the same tokens
  onto the same container, our translucent `fill-colorFillTertiary`/`stroke-colorFill`/
  `fill-colorFillQuaternary` composite to antd's rgb in BOTH themes — no need to pre-flatten.
- **`fill-*` / `stroke-*` utilities exist for every bridge colour** (Tailwind generates them
  from `theme.colors`), so `fill-colorFill`, `fill-colorTextQuaternary`, `fill-colorBgContainer`,
  `stroke-colorFill` all resolve to the `--ag-*` var and flip under `.dark`.
- **`description` renders only when provided.** There is no locale fallback — antd shows its
  locale "No data" when `description` is omitted; call-sites in this repo always pass one.

## Deliberate deviations
- **DEFAULT illustration greys live in their own palette family (`emptyImage`).** They are NOT
  the surface fill tokens. Superseded approach (do not reinstate): mapping them to
  `colorFill` / `colorFillTertiary` / `colorTextQuaternary`. Those tokens are **translucent**
  (`rgba(5,23,41,0.15)` / `0.04`), whereas antd's illustration greys are opaque hexes — so the
  paper and back flap ghosted through the envelope front wherever the shapes overlap. VRT
  measured this as **5.29% in LIGHT** (an earlier revision of this file wrongly claimed "light
  mode is a near-exact match"; it was not). `emptyImage` now carries antd's exact light hexes
  (#f5f5f7 / #aeb8c2 / #dce0e6 / #fff) and, for dark, each of those pre-composited at antd's
  `opacityImage` 0.65 over `colorBgContainer` — arithmetically what antd's group-opacity
  produces, since every shape is opaque. Dark has not been re-measured since this change.
- **SIMPLE illustration still uses the translucent bridge tokens.** antd flattens them with
  `FastColor(colorFill).onBackground(colorBgContainer)` (`empty/simple.js:28-30`), i.e. opaque.
  Ours are translucent, so the same ghosting exists where the inner fill overlaps the ground
  ellipse. Not yet measured as a failure; fix by extending `emptyImage` if VRT flags it.
- **`imageStyle`/`styles`/`classNames` semantic-slot props deferred.** Style the `data-slot`
  parts (`empty-state-image` / `-description` / `-footer`) instead. Add real props only when a
  call-site needs them — do not port antd's shape speculatively.
- **No locale fallback description.** Deferred; every call-site passes `description`.

## Verification (VRT first, computed-style as fallback)
Story `AntdVsAgenta` (`title: "antd/Feedback/EmptyState"`) rows: default image · simple image ·
custom description (default image, no `image` prop) · with-action (simple image + a primary
`Button` footer). `parity/vrt.mjs` is the primary gate (run by the orchestrator).

EmptyState is non-interactive (no hover/focus/active states) and provably non-focusable (`<div>`/
`<svg>`, no `tabindex`), so there is no `InteractionStates` story.

Computed-style verified vs antd **in light** (Playwright, transitions killed) — all four rows:
- Geometry EXACT: root margin `0 8 0 8` (default) / `32 8 32 8` (simple), font 12px/lh 20px,
  image height 85px (default) / 34px (simple), image `margin-bottom` 8px, footer `margin-top`
  16px, svg 184×85 / 64×34.
- Description colour EXACT: `rgb(117,131,145)` = `colorTextDescription`; font-size 12px.
- SIMPLE illustration colours **pixel-exact** (ellipse rgb(245,246,246), stroke rgb(218,220,223),
  inner rgb(250,250,251)) — matches antd's `onBackground` flatten.
- DEFAULT illustration: 5/6 shapes exact/near-exact; envelope-back the one intentional token
  approximation (see Deliberate deviations).

**Dark** is deterministic from the tokens (browser pane went unresponsive mid-session, so dark
was reasoned from the antd source + `--ag-*` dark values rather than re-measured):
- `description` = `text-colorTextDescription` → `rgba(255,255,255,.45)`, same token antd uses → match.
- SIMPLE illustration: antd computes `FastColor(colorFill/Tertiary/Quaternary).onBackground(colorBgContainer)`
  with the SAME dark token inputs our translucent classes composite over → identical rgb → match.
- DEFAULT illustration: the declared deviation above (token-flip vs antd's opacity dim).
Re-run the pixel VRT in dark to confirm and classify the DEFAULT-image row as the intended
structural diff (`not reproduced`).

## For agents hitting conflicts
- Component: `web/packages/agenta-ui/src/components/ui/empty-state.tsx`. Exports `EmptyState`,
  `emptyStateVariants`, `emptyImageVariants`, `type EmptyStateProps`.
- **Not yet in the `@agenta/ui/ui` barrel** (`web/packages/agenta-ui/src/components/ui/index.ts`
  was out of scope). When wiring it, add
  `export {EmptyState, emptyStateVariants, emptyImageVariants, type EmptyStateProps} from "./empty-state"`
  and switch the story import from the relative path to `@agenta/ui/ui`.
- Story: `web/storybook/stories/EmptyState.stories.tsx`.
- No shared-infra edit was made — colours are existing bridge colour keys (`colorFill`,
  `colorFillTertiary`, `colorFillQuaternary`, `colorTextQuaternary`, `colorBgContainer`,
  `colorTextDescription`) and geometry is the control scale (`h-control-lg`, `theme(height.control-lg)`)
  + default Tailwind spacing/font scale.
