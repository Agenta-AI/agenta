# Collapse — migration guide

**antd `Collapse` → `@agenta/ui` `Accordion` (Radix `@radix-ui/react-accordion`,
`@agenta/ui/ui`)** · status: **✅ primitive built; call-sites not yet migrated** · no visual change.

> **Name mapping:** antd calls this widget **Collapse**; Radix's primitive is **Accordion** and
> the `@agenta/ui` export keeps the Radix name. Same widget — a stack of headers that expand to
> reveal content. The story lives under `antd/Data Display/Collapse`; the component file is
> `accordion.tsx`.

## TL;DR
A `@agenta/ui` `Accordion` over Radix (no `forwardRef`, `data-slot` on every part: `accordion`,
`accordion-item`, `accordion-header`, `accordion-trigger`, `accordion-content`). Reproduces antd's
bordered Collapse: a group with a 1px `colorBorder` border + `borderRadiusLG` (10px) radius, items
separated by a 1px `colorBorder` rule, each header with a `colorFillAlter` background, `colorTextHeading`
text, a start-positioned caret that rotates 90° when open, and a content panel with a top `colorBorder`
rule + 16px padding. `variant="ghost"` (antd `bordered={false}`) drops the border/bg/dividers. antd
`accordion` (single-open) → Radix `type="single"`; default multi-open → `type="multiple"`.

## Before
```tsx
import {Collapse} from "antd"

<Collapse
    defaultActiveKey={["1"]}
    items={[
        {key: "1", label: "Panel One", children: <PaneOne />},
        {key: "2", label: "Panel Two", children: <PaneTwo />},
    ]}
/>
```

## After
```tsx
import {Accordion, AccordionItem, AccordionTrigger, AccordionContent} from "@agenta/ui/ui"

<Accordion type="multiple" defaultValue={["1"]}>
    <AccordionItem value="1">
        <AccordionTrigger>Panel One</AccordionTrigger>
        <AccordionContent><PaneOne /></AccordionContent>
    </AccordionItem>
    <AccordionItem value="2">
        <AccordionTrigger>Panel Two</AccordionTrigger>
        <AccordionContent><PaneTwo /></AccordionContent>
    </AccordionItem>
</Accordion>
```
antd's flat `items` array becomes composed children: `label` → `AccordionTrigger`, `children` →
`AccordionContent`, keyed by the same `value`.

## Usage
- **One-open (antd `accordion`)**: `type="single" collapsible` (`collapsible` lets the open panel
  be closed again, matching antd). **Multi-open (antd default)**: `type="multiple"`.
- Open by default: `defaultValue` — a `string` for `type="single"`, a `string[]` for
  `type="multiple"` (mirrors antd `defaultActiveKey`). Controlled: `value` + `onValueChange`.
- Variant: `variant="bordered"` (default, antd default) or `variant="ghost"` (antd `bordered={false}`).
- Disable a panel: `disabled` on its `AccordionItem` (Radix prop).
- End state: import the parts from `@agenta/ui/ui`; never render antd `Collapse`.

## Prop mapping (antd → `@agenta/ui`)
| antd | `@agenta/ui` |
|---|---|
| `items={[{key, label}]}` | `<AccordionTrigger>label</AccordionTrigger>` inside `<AccordionItem value={key}>` |
| `items={[{key, children}]}` | `<AccordionContent>children</AccordionContent>` |
| `items={[{collapsible: "disabled"}]}` | `disabled` on `AccordionItem` |
| `accordion` (one open at a time) | `type="single"` (+ `collapsible`) |
| default (multi-open) | `type="multiple"` |
| `activeKey` | `value` |
| `defaultActiveKey` | `defaultValue` |
| `onChange` | `onValueChange` |
| `bordered` (default) | `variant="bordered"` (default) |
| `bordered={false}` (ghost) | `variant="ghost"` |
| `expandIconPosition="start"` (default) | caret at start (built in) |
| `expandIconPosition="end"` | — deferred |
| `collapsible="header" \| "icon"` | — deferred (whole header toggles) |
| `expandIcon` (custom) | — deferred (fixed `ChevronRight`) |
| `extra` (per-panel right content) | — deferred (compose later) |

## Infra added
**None.** No palette / generator / bridge / `controlScale` change. Every value maps to an existing
bridge token or the default Tailwind spacing/type scale (see mapping + the header-bg note below).

## antd → token mapping (ground truth: measured `getComputedStyle` on the app's antd theme)
| antd token / rule | value (this app, L / D) | class |
|---|---|---|
| group border `lineWidth`×`colorBorder` | 1px | `border border-solid border-colorBorder` |
| group radius `borderRadiusLG` | 10px | `rounded-control-lg` |
| item divider `colorBorder` | 1px | `border-0 border-b border-solid border-colorBorder last:border-b-0` |
| header bg `colorFillAlter` | `rgba(5,23,41,0.02)` L / `rgba(255,255,255,0.04)` D | `bg-fill-quaternary` (see note) |
| header text `colorTextHeading` | `#1c2c3d` L / `rgba(255,255,255,0.85)` D | `text-colorTextHeading` |
| header padding `paddingSM` × `padding` | 12px × 16px | `py-3 px-4` |
| caret colour ≈ `colorText` | `#1c2c3d` L / algo D | `text-colorText` (on the svg) |
| caret icon margin `marginSM` | 8px | `gap-2` |
| content top rule `colorBorder` | 1px | `border-0 border-t border-solid border-colorBorder` |
| content padding | bordered `padding` 16px / **ghost `paddingSM padding` = 12px×16px** | bordered `p-4` / ghost `py-3 px-4` (antd narrows the ghost body's vertical padding — variant-specific) |
| header focus ring (Radix, matched to antd control focus) | 4px `colorPrimaryBorder`, offset -3px | `focus-visible:outline-4 focus-visible:outline-offset-[-3px] focus-visible:outline-focus-ring` |

### Header-bg token gap (REPORTED)
antd's header background is **`colorFillAlter`** — measured `rgba(5,23,41,0.02)` (light) /
`rgba(255,255,255,0.04)` (dark). **There is no `--ag-colorFillAlter` bridge var.** However
`--ag-colorFillQuaternary` is defined with those EXACT values in both modes
(`theme-variables.css` L30 / L352), which is expected — in antd's seed `colorFillAlter` is derived
from `colorFillQuaternary`. So the header uses **`bg-fill-quaternary`** (→ `--ag-colorFillQuaternary`),
an exact per-mode match, not an approximation.
**Suggested follow-up for the orchestrator:** add a first-class `colorFillAlter` role to
`palette.ts` (value = `colorFillQuaternary`) so the semantic intent ("header/table subtle fill") is
named, and a `fill.alter` bridge token → then swap `bg-fill-quaternary` for `bg-fill-alter` here.
Not required for parity today.

## Gotchas
- **Header must be `items-start` (flex-start), NOT `items-center`, and 46px tall — matching antd's
  `fontHeight` mechanism.** A ~9% parity defect (bordered closed + panel-1-open, both themes) came from
  two linked differences: antd's `.ant-collapse-header` is `align-items: flex-start` and **46px** tall,
  while the trigger was `items-center` and **44px**. The 2px gap is antd's **`fontHeight` = 22px**
  (base 14px × `lineHeight` 1.5714, rounded) — antd sizes the expand-icon box AND the header content
  row to 22px regardless of the 12px header font, so height = `paddingSM` 12 + 22 + 12 = **46**. The
  12px label (line box 20px) sits at the top padding (flex-start); the caret lives in a 22px box that
  centers the 12px icon → svg center at 12 + 11 = **23px** from the header top. Reproduced on the
  trigger by (a) `items-start` and (b) wrapping `ChevronRight` in `<span className="flex h-[22px]
  shrink-0 items-center">` (22px = antd's fontHeight; no scale key exists — `h-5`=20/`h-6`=24 — so it's
  kept as arbitrary px with a comment). Measured antd vs agenta afterwards (deviceScaleFactor 2, both
  themes, all three rows): header height 46/46, align flex-start, label top-offset 0/0, svg top 17/17,
  svg center 23/23, svg left 16/16 — exact. Do NOT revert to `items-center` or `min-h` hacks; the
  22px caret box is antd's actual mechanism. Leave padding (12/16) and the chevron rotation untouched.
- **Radix `Accordion.Header` is an `<h3>` — reset its UA margin AND weight (`m-0 font-normal`).**
  This was the dominant parity bug (VRT ~30–53% across every bordered/ghost row). Under preflight-off
  the browser's UA stylesheet still applies to `<h3>`: a block margin (~1.4em top+bottom) and
  `font-weight: bold`. The margin renders as **white bands above and below the header fill** plus
  extra row height (the fill sits on the inner trigger `<button>`, not the `<h3>`); the bold leaks
  into the trigger text through the trigger's `font-[inherit]`. The `Accordion.Header` gets
  `className="flex m-0 font-normal"`. This is easy to misread as a *border* problem from the crop —
  it is not; it is the heading wrapper. Verify computed `margin` = 0 on `[data-slot=accordion-header]`.
- **The header trigger has NO border — and must say so with `border-0`.** antd's Collapse header
  carries no border (the dividers live on the items). The trigger is a `<button>`; under preflight-off
  the app's global default border-width (~1.5px) renders in `currentColor` (dark navy) on all four
  sides unless zeroed. The trigger base is `border-0` (NOT `border-solid`) — a `border-solid` with no
  explicit width/colour was a real (if smaller) bug that added a faint frame on every header. Verify
  computed `border-width` = 0 on `[data-slot=accordion-trigger]`.
- **Single-side borders (`border-b`, `border-t`) LEAK width on the other 3 sides** under preflight-off
  (the app ships a global default `border-width`). Every single-side rule here is prefixed with
  `border-0` to zero all sides first: the item divider (`border-0 border-b`) and the content top rule
  (`border-0 border-t`). See GOTCHAS §Native-element parity.
- **The trigger is a `<button>` → needs an explicit `bg-*`.** Preflight off means a bare `<button>`
  keeps the UA `background-color: buttonface` (`rgb(239,239,239)`) — subtle in light, loud in dark.
  `bordered` sets `bg-fill-quaternary`; `ghost` sets `bg-transparent`. Never leave it unset.
- **Open/close height motion needs config keyframes — Radix does NOT ship them.** antd animates the
  panel height on toggle; Radix only exposes `data-state` + the `--radix-accordion-content-height` var.
  Wiring: `accordion-down`/`accordion-up` keyframes (height 0↔var + opacity) + `animation` entries in
  `tailwind.config.ts` `theme.extend` (0.2s = antd `motionDurationMid`, `cubic-bezier(0.645,0.045,0.355,1)`
  = antd motionEaseInOut), applied on `AccordionContent` as
  `data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up` (with the required
  `overflow-hidden`). **Adding keyframes is a config change → HMR alone won't regen the CSS; Storybook
  needs a full rebuild** (else you see `animation-duration` applied but `animation-name: none` — the
  keyframe is missing). On initial mount of an already-open panel Radix suppresses the enter animation
  (computed `animation-name: none` is correct there) — the motion only runs on real toggle; verify by
  clicking, not on the static story. The VRT freezes animations, so static open/closed parity is unaffected.
- **Caret rotation keys off the TRIGGER's `data-state`, not the svg.** Radix stamps
  `data-state="open" | "closed"` on the trigger; the svg has none. The rotation is applied via the
  trigger class `[&[data-state=open]_[data-slot=accordion-caret]]:rotate-90` targeting the marked
  caret, so it can't accidentally rotate an svg inside the label.
- **`overflow-hidden` on the bordered Root** clips the first/last item's square corners to the
  group's 10px radius (otherwise the header bg bleeds past the rounded border).
- **Content padding lives on an INNER `<div>`, not on `AccordionContent`.** Radix animates the
  Content element's height via `--radix-accordion-content-height`; padding on the animating element
  fights the height math. The `border-t` sits on the Content (so it only shows when open); the 16px
  `p-4` is on the inner wrapper.
- **Variant is threaded via a small React context** (`AccordionContext`), because the per-variant
  skin differs on three separate Radix parts (Root border/radius, Trigger bg, Item divider, Content
  top rule) that don't share a className. Set once on `Accordion`, read by Item/Trigger/Content.
- **Ghost = no borders at all.** antd `bordered={false}` drops the group border, the item dividers,
  the content top rule, AND the header bg (transparent) — not just the outer frame.

## Deliberate deviations
- **Fixed `ChevronRight` caret at the start.** Custom `expandIcon`, `expandIconPosition="end"`,
  `collapsible="header"/"icon"`, and per-panel `extra` are deferred — compose/extend when a call-site
  needs them; do NOT add antd-shaped props speculatively (migration recipe hard rule).

## Verification (VRT first, computed-style as fallback)
`parity/vrt.mjs` is the primary gate (run by the orchestrator). Stories under
`title: "antd/Data Display/Collapse"`:
- `AntdVsAgenta` — three `.grid` rows: bordered with panel 1 open, bordered all-closed, and a ghost
  group with panel 1 open. Each cell renders the full group so border/radius/header-bg/dividers and
  the open content panel diff side by side.
  Story id: `antd-data-display-collapse--antd-vs-agenta`.
- `InteractionStates` — `pseudo-hover-all` / `pseudo-focus-visible-all` forced rows on the header.
  Story id: `antd-data-display-collapse--interaction-states`.

Confirm any forced hover/focus flag with `measureForcedStates()` — antd's header hover is
runtime-injected cssinjs, which the pseudo-states addon can't reliably force, so the pixel diff on
those rows is unreliable (parity README §"Forced interaction states on antd are pixel-unreliable").

**a11y — `landmark-unique`.** Radix `AccordionContent` gets `role="region"` auto-labelled by its
trigger — good a11y that antd's Collapse lacks; keep it, don't strip the role. But axe flags
non-unique landmarks when the SAME region names repeat across groups, so every group in the stories
uses DISTINCT panel labels (`generalPanels` / `accountPanels` / `workspacePanels` — Settings, Account,
Workspace sets), and the two `InteractionStates` rows use different sets from each other. Real
call-sites have distinct labels; this is a story fix, not a component change.

## For agents hitting conflicts
- Component: `web/packages/agenta-ui/src/components/ui/accordion.tsx`; export line
  `export {Accordion, AccordionItem, AccordionTrigger, AccordionContent} from "./accordion"` in that
  dir's `index.ts` (the orchestrator adds it — a parallel agent owns `index.ts`).
- Story: `web/storybook/stories/Collapse.stories.tsx`.
- No shared-infra edit — all colours are existing bridge tokens (`colorBorder`, `colorTextHeading`,
  `colorText`, `fill-quaternary`, `foreground`, `focus-ring`) and geometry is `rounded-control-lg`
  + `text-field-md` + default Tailwind spacing (`py-3`, `px-4`, `p-4`, `gap-2`) plus the caret's
  `h-[22px]` box (antd `fontHeight`; see §Gotchas header-height). The only reported gap is the
  missing `colorFillAlter` role (see §Header-bg token gap); a `fontHeight`/`h-fontHeight` scale key
  could name the 22px caret box but is not required for parity.
