# Sheet — migration guide

**antd `Drawer` → `@agenta/ui` `Sheet` (Radix `@radix-ui/react-dialog`, side variant,
`@agenta/ui/ui`)** · status: **✅ primitive built; call-sites not yet migrated** · no visual
change (close X matches antd Drawer's top-left placement).

> **Name mapping:** antd calls this widget **Drawer**; a Drawer is a **Dialog that slides in
> from a screen edge**, so the `@agenta/ui` primitive is a Radix Dialog (same primitive as
> `Dialog`/Modal) with a cva `side` variant. The story lives under `antd/Feedback/Sheet`; the
> component file is `sheet.tsx`. Overlay chrome is **self-contained** in `sheet.tsx` — it does
> NOT import from `dialog.tsx` (built in parallel).

## TL;DR
A `@agenta/ui` `Sheet` over Radix Dialog (no `forwardRef`, `data-slot` on every part: `sheet`,
`sheet-trigger`, `sheet-portal`, `sheet-overlay`, `sheet-content`, `sheet-close`, `sheet-title`,
`sheet-description`, `sheet-header`, `sheet-footer`). Reproduces antd's Drawer: a borderless
panel (`colorBgContainer`) pinned to a screen edge via a cva `side` prop
(`right` default | `left` | `top` | `bottom`), default 378px on the cross axis, with the
directional `boxShadowDrawer*` shadow casting toward the viewport, a `colorBgMask` overlay, a
header/footer with a 1px `colorSplit` rule, and a 14px/600 `colorTextHeading` title. `side`
drives three things together: fixed positioning to the edge, the matching directional shadow,
and the slide animation.

## Before
```tsx
import {Drawer} from "antd"

<Drawer
    open={open}
    onClose={() => setOpen(false)}
    placement="right"
    title="Filters"
    footer={<Button onClick={apply}>Apply</Button>}
>
    <FilterForm />
</Drawer>
```

## After
```tsx
import {
    Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@agenta/ui/ui"

<Sheet open={open} onOpenChange={setOpen}>
    {/* optional: <SheetTrigger asChild><Button>Open</Button></SheetTrigger> */}
    <SheetContent side="right">
        <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-auto px-6 py-6">
            <FilterForm />
        </div>
        <SheetFooter>
            <Button onClick={apply}>Apply</Button>
        </SheetFooter>
    </SheetContent>
</Sheet>
```
antd's flat `title`/`footer`/children props become composed children. `SheetContent` renders
the Portal + Overlay + Content; `SheetHeader` is the antd header row (it renders the close X at
the START, before the title, matching antd Drawer), and `SheetHeader`/`SheetFooter` carry the
`colorSplit` rules and antd's paddings. The scrollable body is your own `div` between them
(antd's `.ant-drawer-body`, 24px padding).

## Usage
- **Placement**: `side="right"` (default) | `"left"` | `"top"` | `"bottom"` (antd `placement`).
- **Open/close**: `open` + `onOpenChange` on `Sheet` (Radix). antd `onClose` → `onOpenChange(false)`.
  Uncontrolled: `defaultOpen`, or drive from a `SheetTrigger`.
- **Size**: default 378px on the cross axis (antd's default). Override per call-site with
  `className="w-[480px]"` (right/left) or `className="h-[60vh]"` (top/bottom) on `SheetContent`.
- **Close X**: rendered by `SheetHeader` at the start of the header row (antd's placement); on
  by default, `<SheetHeader showCloseButton={false}>` hides it (antd `closable={false}`).
- **Title is required** for a11y (Radix Dialog). If a call-site has no visible title, keep a
  `SheetTitle` and hide it (`className="sr-only"`) or pass `aria-label` on `SheetContent`.
- **Inline render** (inside a scroll container, or a forced-open parity story): pass
  `container={el}` to `SheetContent` (antd `getContainer`).
- End state: import the parts from `@agenta/ui/ui`; never render antd `Drawer`.

## Prop mapping (antd → `@agenta/ui`)
| antd | `@agenta/ui` |
|---|---|
| `<Drawer open onClose>` | `<Sheet open onOpenChange>` |
| `placement="right\|left\|top\|bottom"` | `<SheetContent side="right\|left\|top\|bottom">` |
| `title` | `<SheetHeader><SheetTitle>…</SheetTitle></SheetHeader>` |
| `footer` | `<SheetFooter>…</SheetFooter>` |
| children (body) | a `div` between header/footer (`flex-1 overflow-auto px-6 py-6`) |
| `closable` (default true) | `showCloseButton` (default true) on `SheetHeader` |
| `getContainer` | `container` (on `SheetContent`) |
| `width` (right/left) | `className="w-[…]"` on `SheetContent` |
| `height` (top/bottom) | `className="h-[…]"` on `SheetContent` |
| `mask` (default true) | always rendered (`SheetOverlay`); Radix has no maskless mode |
| `maskClosable` | Radix closes on overlay click by default; guard with `onInteractOutside`/`onPointerDownOutside` |
| `extra`, `loading`, `push`, nested drawers | — deferred (compose later; no antd-shaped props) |

## Infra added
**None.** No palette / generator / bridge / `controlScale` change. Every value maps to an
existing bridge token or the default Tailwind scale. The keyframes and directional shadows the
`side` variant needs were **pre-provisioned** in `oss/tailwind.config.ts` before this work:
`animate-sheet-{in,out}-{right,left,top,bottom}`, `animate-overlay-{in,out}`, and
`shadow-drawer-{right,left,top,bottom}` (antd `boxShadowDrawer*`, theme-invariant literals).
The component only applies those classes.

## antd → token mapping (ground truth: measured `getComputedStyle` on the app's antd theme, L / D)
| antd token / rule | value (L / D) | class |
|---|---|---|
| panel bg `colorBgContainer` | `#fff` L / **`#141414`** D | `bg-colorBgContainer` |
| panel text `colorText` | `#1c2c3d` L / `rgba(255,255,255,0.88)` D | `text-colorText` |
| panel border | **none** (borderWidth 0 every edge) | `border-0` (shadow-only separation) |
| panel radius | 0 (flush) | — (no radius) |
| panel width (right/left) | 378px | `w-[378px] max-w-full` |
| panel height (top/bottom) | 378px | `h-[378px] max-h-full` |
| panel shadow `boxShadowDrawer{Right,Left,Top,Bottom}` | directional literal | `shadow-drawer-{side}` |
| mask `colorBgMask` | `rgba(5,23,41,0.45)` L / `rgba(0,0,0,0.45)` D | `bg-colorBgMask` |
| header padding | 16px × 24px | `py-4 px-6` |
| header bottom rule `colorSplit` | `rgba(5,23,41,0.06)` L / `rgba(253,253,253,0.12)` D | `border-0 border-b border-solid border-colorSplit` |
| footer padding | 8px × 16px | `py-2 px-4` |
| footer top rule `colorSplit` | as above | `border-0 border-t border-solid border-colorSplit` |
| title `fontSize`/`lineHeight`/`fontWeight` | 14px / 22px / 600 | `text-field-lg font-semibold` |
| title colour `colorTextHeading` | `#1c2c3d` L / `rgba(255,255,255,0.85)` D | `text-colorTextHeading` |
| body padding `paddingLG` | 24px | `px-6 py-6` (in the story's body div) |
| body text | `field-md` (12px) | `text-field-md text-colorText` |
| close colour `colorIcon` | `rgb(117,131,145)` | `text-colorIcon` (+ `hover:text-colorIconHover`) |
| font (portaled to `<body>`) | Inter | `font-portal` |

## Gotchas
- **antd Drawer panel is BORDERLESS — do not draw a border edge.** Measured `borderWidth: 0`
  on every edge; the directional `boxShadowDrawer*` shadow alone casts the separation toward the
  viewport. An early draft drew a `border-l border-colorSplit` (the spec's "which edge is drawn"
  guidance) — that was WRONG against the measured antd. The cva base is `border-0` (zeroes the
  app's global default border-width under preflight-off so no stray `currentColor` rule leaks),
  and each `side` adds only positioning + the shadow + the slide animation.
- **`shadow-none` in the cva base silently killed the drawer shadow.** tailwind-merge does not
  recognise the custom `shadow-drawer-*` key as the same group as `shadow-none`, so both classes
  survived and CSS source-order let `shadow-none` win (computed `box-shadow: none`). Fix: remove
  `shadow-none` from the base entirely; each `side` sets its own `shadow-drawer-{side}`. (Same
  class of bug as the `text-*` font-size/colour collision in GOTCHAS §"The scale + `cn`".)
- **Drawer panel bg is `colorBgContainer`, NOT `colorBgElevated`.** They are identical white in
  light, but diverge in dark: `colorBgContainer` = `#141414`, `colorBgElevated` = `#242424`.
  antd Modal uses elevated (so `dialog.tsx` is right to use `bg-colorBgElevated`); antd **Drawer**
  uses container. This is invisible in light and only the dark measurement catches it — exactly
  the per-mode antd inconsistency GOTCHAS §"Token layer & parity" warns about.
- **Drawer title is 14px, not 16px.** antd Modal's title is `fontSizeLG` (16px, `text-base` in
  `dialog.tsx`); antd Drawer's title measured **14px / line-height 22px** → `text-field-lg`
  (14px, lh 22 in `controlScale`). Do not copy the Modal title size.
- **Single-side borders leak the other 3 sides under preflight-off.** The header bottom rule and
  footer top rule are each `border-0` first, THEN the single edge (`border-b` / `border-t`) — same
  as Accordion's item divider (GOTCHAS §Native-element parity).
- **The close X lives in `SheetHeader`, at the START of the header row (before the title).**
  antd Drawer's DOM is `.ant-drawer-header` > `.ant-drawer-header-title` = `[close][title]` — the
  close is the first flex child, 22px box, 14px icon, `colorIcon`, with `marginInlineEnd` 8px (=
  the header `gap-2`). `SheetHeader` reproduces this (renders `SheetPrimitive.Close` first, then
  its children) rather than the top-right absolute close `dialog.tsx` uses — because Sheet must
  match antd **Drawer**, whose close is top-left (antd Modal's is top-right; antd is internally
  inconsistent, and each `@agenta/ui` component matches its own antd source). Measured: close at
  x=24/y=16 in the header, title at x=54 — identical on both halves. The close `<button>` needs
  the native-control resets (preflight off): `bg-transparent` (else UA `buttonface` leaks — loud
  in dark), `p-0`, `border-0`, `font-[inherit]`, `box-border`.
- **`SheetTitle` (and `SheetDescription`) need `m-0`.** Radix `Dialog.Title` renders an `<h2>`
  (Description a `<p>`); preflight-off leaves the UA `margin-block` (~0.83em × the 14px font ≈
  11.6px each side = 23px). Inside the flex header row that margin inflates the row height 55px →
  78px and **cascades the whole body down 23px** (the "vertical offset" the VRT flagged). `m-0`
  on `SheetTitle` restores the 55px header so the body top matches antd's `.ant-drawer-body`
  exactly. Same trap as Accordion's `<h3>` header (GOTCHAS §Component authoring). Verify computed
  header height = 55 and `margin` = 0 on `[data-slot=sheet-title]`.
- **`font-portal` on the content.** Radix Dialog portals into `<body>`, outside the app font
  scope; preflight off → serif without it (GOTCHAS §"Portaled content").
- **Overlay self-contained.** `SheetOverlay` is defined in `sheet.tsx` (`fixed inset-0 z-40`
  `bg-colorBgMask` + `animate-overlay-{in,out}`), NOT imported from `dialog.tsx`, so the two
  components can be built/merged independently.
- **Inline render needs a containing block.** `SheetContent` is `position: fixed`, so in the
  forced-open story the portal `container` box is a fixed-descendant containing block
  (`[transform:translateZ(0)]`, from `dialog.tsx`'s pattern) — otherwise the panel pins to the
  viewport edge instead of the box edge, and both columns collapse onto each other.

## Deliberate deviations
- **Close X is top-LEFT, matching antd Drawer exactly** (no visual deviation). This intentionally
  **diverges from `Dialog`'s top-right close** — but `Dialog` (Modal) also matches *its* antd
  source (antd Modal close = right), and antd is internally inconsistent (Modal-right /
  Drawer-left). Each `@agenta/ui` component mirrors its own antd source rather than a forced
  family convention, so Sheet's close is top-left and Dialog's is top-right — both correct.
- **Deferred antd features** (no antd-shaped props added speculatively): `extra`, `loading`,
  `push` (stacked-drawer push-back), nested drawers, `maskClosable`/`keyboard` toggles. Compose
  or extend when a call-site needs them (migration recipe hard rule).

## Verification (VRT first, computed-style as fallback)
`parity/vrt.mjs` is the primary gate (run by the orchestrator). Stories under
`title: "antd/Feedback/Sheet"`:
- **`OpenState`** — the gate. antd `Drawer` (`open` + `getContainer={() => c}`) vs agenta `Sheet`
  (`open` + `container={c}`), both `side="right"`, forced open INLINE in a
  `[transform:translateZ(0)]` box inside `[data-open-compare]`, so the VRT pixel-diffs the open
  panel. Story id: `antd-feedback-sheet--open-state`.
- **`Sides`** — the four `side` variants (agenta), each forced open in a square box.
  Story id: `antd-feedback-sheet--sides`.
- **`AntdVsAgenta`** — real trigger-driven Drawer vs Sheet (click to open), portaled to the
  viewport. Story id: `antd-feedback-sheet--antd-vs-agenta`.

Computed-style parity measured against antd (`getComputedStyle`, light + dark) — all MATCH:
- **Light**: width 378 · panel bg `#fff` · borderless (0px) · shadow = `boxShadowDrawerRight` ·
  header height 55 + 16×24 padding + 1px `rgba(5,23,41,0.06)` rule · **body top 55 (= antd,
  no offset)** · footer 8×16 + rule + Cancel button border `1px solid rgb(189,199,209)` (=
  antd default button) · title 14/22/600 `#1c2c3d` · body 24px `field-md` · mask
  `rgba(5,23,41,0.45)` · **close at header x=24/y=16, title at x=54 (= antd exactly)** · font Inter.
- **Dark**: panel bg `#141414` (= `colorBgContainer`, ≠ elevated `#242424`) · header height 55 ·
  header/footer rule `rgba(253,253,253,0.12)` · title `rgba(255,255,255,0.85)` · close
  `rgba(255,255,255,0.45)` · mask `rgba(0,0,0,0.45)`.

**a11y** — Radix Dialog requires a `Title`; every story includes a `SheetTitle`. Radix also
warns (console only, not an axe failure) when there is no `Description`/`aria-describedby`;
call-sites without body prose should pass `aria-describedby={undefined}` or add a `SheetDescription`.

## For agents hitting conflicts
- Component: `web/packages/agenta-ui/src/components/ui/sheet.tsx`.
- **Barrel export (orchestrator owns `index.ts`, which currently has uncommitted parallel edits —
  do not touch it):** add to `web/packages/agenta-ui/src/components/ui/index.ts`:
  ```ts
  export {
      Sheet, SheetTrigger, SheetPortal, SheetOverlay, SheetContent, SheetClose,
      SheetTitle, SheetDescription, SheetHeader, SheetFooter, sheetVariants,
  } from "./sheet"
  ```
  Until this line lands, `Sheet.stories.tsx` (which imports from `@agenta/ui/ui`) cannot resolve
  the Sheet exports in the live Storybook.
- Story: `web/storybook/stories/Sheet.stories.tsx`.
- No shared-infra edit — all colours are existing bridge/antd-semantic tokens (`colorBgContainer`,
  `colorText`, `colorSplit`, `colorBgMask`, `colorTextHeading`, `colorIcon`, `fill-quaternary`,
  `focus-ring`), geometry is `w-[378px]`/`h-[378px]` (antd's JS default literal, like
  `dialog.tsx`'s `max-w-[520px]`) + `text-field-lg`/`text-field-md` + default Tailwind spacing,
  and the keyframes/shadows (`animate-sheet-*`, `animate-overlay-*`, `shadow-drawer-*`) were
  pre-provisioned in `tailwind.config.ts`.
