# Tooltip — migration guide

**antd `<Tooltip>` → `@agenta/ui` `Tooltip`** (Radix `@radix-ui/react-tooltip`, `@agenta/ui/ui`) ·
status: **✅ primitive built / ⬜ call-sites** · no visual change.

## TL;DR
A `@agenta/ui` Tooltip over Radix (current shadcn source style), re-skinned to antd's overlay chrome: `colorBgSpotlight`
background, white text (`colorTextLightSolid`), `borderRadius` 8px (`rounded-control`), 6px×8px
padding, and the antd overlay shadow (`shadow-overlay`). Portaled content, so it carries
`font-portal` (else it renders in serif under preflight-off) and an explicit shadow. Exports
`Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`.

## Before
```tsx
import {Tooltip} from "antd"

<Tooltip title="Tooltip text" placement="top">
    <span>Hover me</span>
</Tooltip>
```

## After
```tsx
import {Tooltip, TooltipTrigger, TooltipContent, TooltipProvider} from "@agenta/ui/ui"

<TooltipProvider>
    <Tooltip>
        <TooltipTrigger asChild>
            <span>Hover me</span>
        </TooltipTrigger>
        <TooltipContent side="top">Tooltip text</TooltipContent>
    </Tooltip>
</TooltipProvider>
```

## Usage
- Wrap a subtree (or the app) once in `<TooltipProvider>`; individual `<Tooltip>`s share it.
  `delayDuration` defaults to 0 (antd shows immediately) but is overridable on the provider.
- `TooltipTrigger` should use `asChild` to wrap the real trigger element, so no extra DOM node
  is added.
- `TooltipContent` accepts `side`/`align`/`sideOffset` (Radix) and an extra `container` prop
  passed to the Portal — pass an element to render inline (inside a modal/scroll container or a
  forced-open parity story); defaults to `document.body`.
- The Arrow is rendered inside `TooltipContent` (same fill as bg), no extra wiring needed.

## Prop mapping
| antd | `@agenta/ui` |
|---|---|
| `title` | children of `TooltipContent` |
| `placement` (`top`/`bottom`/`left`/`right` + `*Left`/`*Right`) | `side` + `align` on `TooltipContent` |
| `open` / `defaultOpen` | `open` / `defaultOpen` on `Tooltip` (Root) |
| `getPopupContainer` | `container` on `TooltipContent` |
| `mouseEnterDelay` | `delayDuration` on `TooltipProvider` (seconds→ms) |
| `color` | not mapped — fixed to antd's `colorBgSpotlight` (no visual change) |

## Infra added
None. Reuses existing bridge classes only:
- bg `bg-colorBgSpotlight` (`--ag-colorBgSpotlight`, theme-flipping: rgba(5,23,41,0.9) light /
  #424242 dark), text `text-colorTextLightSolid` (`--ag-colorTextLightSolid`, white both themes),
  arrow `fill-colorBgSpotlight` — all from the `antdTailwind` color map in `oss/tailwind.config.ts`.
- geometry from `controlScale`: `rounded-control` (8px), `text-field-md` (12px); padding
  `px-2 py-1.5` (8px×6px). Overlay chrome `shadow-overlay` + `font-portal`. `z-50 box-border`.
- The one arbitrary value is `max-w-[250px]` — a soft width cap (antd's default tooltip max),
  not a themeable control dim.

## Gotchas
- **Portaled content renders in SERIF and with no shadow unless set.** Radix portals into
  `<body>`, outside the app font scope, and preflight is off → Times + no shadow. `TooltipContent`
  carries `font-portal` (a nested-`var()` fontFamily key — a comma list of `var()`s dies wholesale
  when the first is unset) and `shadow-overlay`. See GOTCHAS §Portaled content.
- **`box-border`** on the content root — preflight-off defaults to content-box.
- **Arrow fill must equal the bg.** `fill-colorBgSpotlight` (Radix renders the arrow as an SVG
  triangle; `fill-*` colours it, not `bg-*`).
- **`delayDuration` default is 0** to match antd's immediate show; override on the provider if a
  hover delay is wanted.
- **Trigger states are the consumer's element** (via `asChild`) — the tooltip itself is a
  non-interactive overlay, so there is no hover/focus skin to match on the content.

## Verification (VRT first)
`parity/vrt.mjs` is the primary gate; `measure.js` (`measureOverlayParity()`) is the fallback for
exact token values. Stories (`antd/Data Display/Tooltip`):
- **`OpenState`** (KEY, `data-open-compare`) — antd `<Tooltip open getPopupContainer>` vs agenta
  `<Tooltip open>` + `TooltipContent container`, rendered inline side by side with NO hover so the
  VRT pixel-diffs the open overlay (`.ant-tooltip-inner` vs `[data-slot=tooltip-content]`).
- **`AntdVsAgenta`** — short text + long text (wraps at max-width) via the `.grid` Row pattern.

Font-size was set to `text-field-md` (12px, app base); correct against the VRT if antd's
`.ant-tooltip-inner` measures otherwise.

## For agents hitting conflicts
The component mirrors `popover.tsx`/`select.tsx` structurally (portaled Radix, `container` prop,
`font-portal` + `shadow-overlay` + `data-slot`, no `forwardRef`). Keep those invariants. The
only antd-specific choices are the `colorBgSpotlight` bg + white text + arrow fill; everything
else is the shared control scale.
