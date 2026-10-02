# Breadcrumb — migration guide

**antd `Breadcrumb` → `@agenta/ui` presentational `Breadcrumb` parts** (`nav > ol > li`,
NO Radix primitive — only `Slot` for `asChild`, like Button; `@agenta/ui/ui`) · status:
**✅ primitive built; call-sites not yet migrated** · no visual change.

## TL;DR
A composable, presentational `@agenta/ui` Breadcrumb following the canonical shadcn
`nav > ol > li` pattern (no `forwardRef`, `data-slot` on every part). Seven parts:
`Breadcrumb` (nav, `aria-label="breadcrumb"`), `BreadcrumbList` (ol), `BreadcrumbItem` (li),
`BreadcrumbLink` (a, `asChild`), `BreadcrumbPage` (current crumb, `aria-current="page"`),
`BreadcrumbSeparator` (li, default `/` or custom child, `aria-hidden`), `BreadcrumbEllipsis`.
Colours map antd's Breadcrumb tokens: link/item/separator = `colorTextDescription`,
current + link-hover = `colorText`; separator `marginXS` 8px each side; font 12px /
line-height 1.6667 (`text-field-md`). All via existing semantic tokens — no new infra.

## Before
```tsx
import {Breadcrumb} from "antd"

<Breadcrumb
  items={[
    {title: <a href="/home">Home</a>},
    {title: <a href="/apps">Apps</a>},
    {title: "Details"},
  ]}
/>
<Breadcrumb separator=">" items={[...]} />
```

## After
```tsx
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink,
  BreadcrumbPage, BreadcrumbSeparator, BreadcrumbEllipsis,
} from "@agenta/ui/ui"   // NOTE: not exported from ./ui yet — see "For agents"

<Breadcrumb>
  <BreadcrumbList>
    <BreadcrumbItem><BreadcrumbLink href="/home">Home</BreadcrumbLink></BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbLink href="/apps">Apps</BreadcrumbLink></BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbPage>Details</BreadcrumbPage></BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>
```
antd is **data-driven** (`items` array); the `@agenta/ui` version is **composed** (explicit
parts, shadcn convention). A call-site's `items.map` becomes a `.map` that emits
`<BreadcrumbItem>` + `<BreadcrumbSeparator>` per entry, `<BreadcrumbPage>` for the last.

## Usage
- Every crumb sits in a `<BreadcrumbItem>`. Interior crumbs use `<BreadcrumbLink>` (an `<a>`,
  or `asChild` to wrap `next/link` — `<BreadcrumbLink asChild><Link href=…>…</Link></BreadcrumbLink>`).
  The current/last crumb uses `<BreadcrumbPage>`.
- Put a `<BreadcrumbSeparator />` between items (default glyph `/`; pass a child for a custom
  one, e.g. `<BreadcrumbSeparator><ChevronRight/></BreadcrumbSeparator>` — antd `separator=">"`).
- Collapse middle crumbs with `<BreadcrumbEllipsis />` inside its own `<BreadcrumbItem>`.
- A leading icon goes inside the link/page; `BreadcrumbItem` is `inline-flex gap-1` for it.
- End state: import the parts from `@agenta/ui/ui`; never `Breadcrumb` from `antd`.

## Prop / structure mapping (antd → `@agenta/ui`)
| antd | `@agenta/ui` |
|---|---|
| `items={[{title}]}` | children: `<BreadcrumbItem>` per entry |
| item `{title: <a href>…}` | `<BreadcrumbLink href>…</BreadcrumbLink>` |
| item `{title}` on the last entry | `<BreadcrumbPage>…</BreadcrumbPage>` |
| item `{href}` | `href` on `<BreadcrumbLink>` (or `asChild` + `<Link>`) |
| `separator` (default `/`) | `<BreadcrumbSeparator>` (default `/`; child overrides) |
| item `{menu}` (dropdown crumb) | — deferred; compose with `DropdownMenu` (see deviations) |
| `params` / `itemRender` (data-render hooks) | — n/a; render explicitly in JSX |

## Infra added
**None.** No palette / generator / bridge / `controlScale` change. Every value maps to an
existing semantic color token or the default Tailwind scale (see mapping below).

## antd → token mapping (ground truth: `antd-themeConfig.json` → `Breadcrumb`, confirmed in `theme-variables.css`)
The app overrides antd's stock Breadcrumb tokens; these are the app's actual values.
| antd token / rule | value (this app) | class |
|---|---|---|
| `itemColor` / `linkColor` / `separatorColor` = `colorTextDescription` | `#758391` L / `rgba(255,255,255,.45)` D | `text-colorTextDescription` |
| `lastItemColor` / `linkHoverColor` = `colorText` | `#1c2c3d` L / `rgba(255,255,255,.85)` D | current `text-colorText`; link `hover:text-colorText` |
| `fontSize` | `12px` | `text-field-md` |
| `lineHeight` | `1.6667` (5/3) → 20px | `text-field-md` (bundles 1.6667) |
| `fontHeight` (row/`a` height) | `22px` | `inline-block h-[22px]` on link/page/separator |
| `separatorMargin` = `marginXS` | `8px` each side | `mx-2` on the separator |
| `fontSizeIcon` (icon separator) | `12px` | `[&>svg]:size-3` |
| `borderRadiusSM` (anchor hover-bg radius) | `6px` | not used — see deviations |
| `colorBgTextHover` (anchor hover bg) | `rgba(5,23,41,.06)` L | **not reproduced** — see deviations |

## Gotchas
- **The row MUST be 22px (`fontHeight`), not the 20px line-height — this was a real ~9% VRT
  defect.** antd sets `a { display:inline-block; height:fontHeight(22px) }`, which makes every
  crumb row 22px (the 20px line-height text top-aligns, 2px empty below). A naïve breadcrumb
  collapses to the 20px line-height. The pixel VRT (`vrt.mjs`) crops each half by its bounding
  rect, pads the shorter to `max(height)` at top-left with transparent (blended toward white),
  then diffs — so a 20-vs-22 mismatch leaves a 2px band (2/22 ≈ **9.1%**, matching the reported
  9%) that reads wrong in both themes (loud in dark: transparent-white vs the dark page). The
  glyphs themselves were already pixel-identical (measured top 2 / bottom 17 / centerY 9.5).
  Fix: `inline-block h-[22px]` on `BreadcrumbLink`/`BreadcrumbPage`/`BreadcrumbSeparator`
  (top-aligned, NOT `items-center` — centering a 22px item is a no-op but centering the shorter
  ellipsis shifts it down; see next bullet).
- **The ellipsis icon is top-aligned (icon top 2 / centerY 8), not centred.** antd renders an
  icon crumb top-aligned in the 22px row, so its 12px icon sits at top 2 (centerY 8 — 1.5px
  ABOVE the text centerY 9.5). A size-4 (16px) ellipsis left to the list's `items-center`
  renders 3px too low (centerY 11). Fix: `h-[22px] items-start [&>svg]:mt-0.5` (2px = the
  size-4→size-3 inset) so the icon lands at top 2 / centerY 8 — measured-equal to antd.
- **No `border-solid`/`box-border`/`font-[inherit]` needed.** Breadcrumb has no borders and
  uses no native form controls (`<nav>/<ol>/<li>/<a>/<span>` inherit the app font fine under
  preflight-off — only `<button>/<input>` leak the UA font). So the usual control-reset kit
  does not apply here.
- **`<ol>` needs an explicit reset.** Preflight is off, so `BreadcrumbList` sets
  `m-0 p-0 list-none` to drop the UA list margin/padding/markers.
- **Separator spacing lives on the separator, not the list.** `BreadcrumbList` has no
  inter-item gap; `BreadcrumbSeparator` carries `mx-2` (= `separatorMargin` 8px each side),
  exactly antd's model. Do not add a list `gap-*` on top or spacing doubles.
- **`text-field-md` already carries antd's 1.6667 line-height** (registered in the control
  scale) — no separate `leading-[…]` needed, unlike Divider's with-text row.
- **`asChild` uses `Slot`**, same as Button — this is the ONLY Radix import (`@radix-ui/react-slot`);
  there is no Radix Breadcrumb primitive. Use `asChild` to wrap `next/link` at call-sites.

## Deliberate deviations
- **Anchor hover background (`colorBgTextHover`) not reproduced.** antd paints a hover bg
  (`rgba(5,23,41,.06)` light, radius `borderRadiusSM`, padding `paddingXXS`) **only on
  `a.ant-breadcrumb-link`** — i.e. items whose `title` is a real anchor. The two call-sites
  differ, and an earlier version of this note got that wrong by claiming neither passes one:
  - `Layout/assets/Breadcrumbs.tsx` **does** render a `<Link>` (a real `<a>`) when
    `item.href` is set, so antd's `-item a` rules **do** apply there — the call-site then
    neutralises them itself with `!p-0 !h-auto hover:!bg-transparent`.
  - `selection/Breadcrumb.tsx` passes a plain `<span>`, so antd renders a non-anchor crumb
    and the rules never apply.

  So the hover pill is suppressed in production either way, but by the call-site in one case
  and by markup in the other. We drop antd's `padding: 0 4px` / `margin-inline: -4px` pair
  (they cancel to zero) and the hover pill — the pill is the one real deviation.
  `BreadcrumbLink` still matches antd's hover **text** colour (`hover:text-colorText` =
  `linkHoverColor`). Candidate follow-up if a future call-site wants the pill: `bg-*` +
  `rounded-control-sm px-1` on `BreadcrumbLink` (`colorBgTextHover` has no `--ag-` var; the
  same-valued `colorFillSecondary` is the substitute used elsewhere).
- **`BreadcrumbEllipsis` is a shadcn-only affordance (a `MoreHorizontal` icon) — antd has NO
  ellipsis primitive** (`{title:"..."}` is just literal text a consumer typed; neither real
  call-site uses one). So there is no antd rendering to "match". The parity story therefore
  renders `<BreadcrumbEllipsis/>` on BOTH halves (antd accepts any ReactNode title), which
  proves the part renders identically whether wrapped by antd's crumb or the agenta list, and
  sidesteps the antd literal-"..." vs icon mismatch. Measured icon-equal (top 2 / centerY 8 /
  12×12) after the alignment fix above.
- **`menu` (dropdown crumb) deferred.** antd's `items[].menu` renders a dropdown-triggering
  crumb. Compose with the migrated `DropdownMenu` at the call-site rather than baking an
  antd-shaped `menu` prop into the primitive.
- **`itemRender` / `params` deferred** — data-render hooks with no place in a composed API;
  render crumbs explicitly in JSX.

## Verification (VRT first, computed-style as fallback)
Story `Breadcrumb.stories.tsx` (`title: "antd/Navigation/Breadcrumb"`) — `AntdVsAgenta`
rows: links+current, two crumbs, custom separator `>`, ellipsis (collapsed); plus an
`InteractionStates` story forcing link `:hover` (`pseudo-hover-all`) with "antd"/"agenta"
captions. Feed these to `parity/vrt.mjs` (light + dark) as the primary gate and confirm the
hover row's colour with `measureForcedStates()` (antd's link hover is runtime cssinjs the
pseudo addon can't always force — README caveat).

**LIVE-MEASURED vs antd (Playwright from `web/storybook`, deviceScaleFactor 2,
`document.fonts.ready`, transitions killed, light + dark).** Every value below is antd's
rendered `getComputedStyle`/`getBoundingClientRect`, matched exactly by the agenta half:

| property | antd = agenta (light) | antd = agenta (dark) |
|---|---|---|
| link colour | `rgb(117,131,145)` | `rgba(255,255,255,.45)` |
| current (last) colour | `rgb(28,44,61)` | `rgba(255,255,255,.85)` |
| separator colour | `rgb(117,131,145)` | `rgba(255,255,255,.45)` |
| font-size / line-height / weight | `12px` / `20px` / `400` | same |
| text-decoration | `none` | `none` |
| separator margin-left/right | `8px` / `8px` | same |
| **row (nav) height** | **`22px`** | **`22px`** |
| glyph top / bottom / centerY | `2` / `17` / `9.5` | same |
| ellipsis icon top / centerY / size | `2` / `8` / `12×12` | same |

**The ~9% VRT diff was the row-height mismatch, now fixed** (agenta was 20px, antd 22px — the
2px band = 2/22 ≈ 9.1%; see Gotchas for the `vrt.mjs` crop/pad mechanism). The colours,
font, decoration, and separator margins were already pixel-identical (the token config
matched the rendered values 1:1). The ellipsis row's extra delta was the icon 3px too low,
also fixed. The `link·hover ~37%` row is the known forced-hover artifact (antd's hover is
runtime cssinjs the pseudo addon can't force) — verify hover colour with `getComputedStyle`
(`linkHoverColor` = `colorText`), not the pixel VRT.

**a11y — axe clean (0 violations, both themes)** on the agenta cells (audited exactly as
`parity/a11y.mjs` scopes them: each grid row's `children[2]`). The one flag was
`landmark-unique`: the story renders several `nav` landmarks all named "breadcrumb". Fixed in
the **story** (not the component default) by giving each `<Breadcrumb>` instance a distinct
`aria-label` ("Breadcrumb: links and current", "…: two crumbs", "…: custom separator",
"…: collapsed", "…: hover state"). The component keeps `aria-label="breadcrumb"` as its
default (one breadcrumb per real page, so no collision in production) and spreads `{...props}`
last so a passed `aria-label` overrides it.

a11y (keep axe clean): `nav[aria-label="breadcrumb"]`; the current crumb is
`aria-current="page"` (+ `role="link" aria-disabled`); separators and ellipsis are
`aria-hidden` / `role="presentation"`. Non-interactive parts (`ol/li/span`) carry no
`tabindex`; only `BreadcrumbLink` (a real `<a>`, or the `asChild` target) is focusable.

## For agents hitting conflicts
- Component: `web/packages/agenta-ui/src/components/ui/breadcrumb.tsx`. Story:
  `web/storybook/stories/Breadcrumb.stories.tsx`.
- **Not yet exported from the barrel.** When wiring exports, add to
  `web/packages/agenta-ui/src/components/ui/index.ts`:
  `export {Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator, BreadcrumbEllipsis} from "./breadcrumb"`.
  Until then, the story imports the file by relative path (barrel was off-limits for this change).
- No shared-infra edit was made — colours are existing bridge keys (`colorTextDescription`,
  `colorText`), geometry is the default Tailwind scale + `text-field-md` from `controlScale`.
- Call-sites to migrate later: `web/oss/src/components/Layout/assets/Breadcrumbs.tsx`
  (data-driven `items`, `next/link` crumbs, dropdown `menu` crumbs) and
  `web/packages/agenta-ui/src/components/selection/Breadcrumb.tsx` (`onNavigate` span crumbs,
  home icon). Both pass non-href `title` nodes — the omitted anchor hover-bg is irrelevant there.
```
