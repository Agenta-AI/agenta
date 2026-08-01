# Alert (antd `Alert` → `@agenta/ui` `Alert`)

## TL;DR
Presentational `@agenta/ui` `Alert` (plain `<div>` + `cva`, no Radix) in `@agenta/ui/ui` that
pixel-matches antd `Alert` in light + dark. Same public API as antd (`type` / `message` /
`description` / `showIcon` / `closable` / `onClose` / `banner` / `icon`). bg/border/icon
colour flow through the `--ag-*` bridge; geometry from the control scale + Tailwind spacing.
Verified against the real antd v6.3.7 Alert (measured, not assumed).

## Before
antd `Alert`:
```tsx
import {Alert} from "antd"
<Alert type="error" message="Error title" description="…" showIcon closable />
<Alert type="warning" message="Banner" banner />
```

## After
```tsx
import {Alert} from "@agenta/ui/ui"
<Alert type="error" message="Error title" description="…" showIcon closable />
<Alert type="warning" message="Banner" banner />
```
`alert.tsx` — a `cva` `type` variant (bg + border per type) plus `hasDescription` (padding
20/24 + top-align vs 8/12 + center) and `banner` (no border, no radius). Icon colour is a
per-type record; default filled status icons come from `@phosphor-icons/react` (fill weight).
`data-slot` on the root (`alert`) and each sub-part (`alert-icon` / `alert-content` /
`alert-title` / `alert-description` / `alert-close`).

## Usage
- **Existing antd call-sites**: swap the import only — props map 1:1 (see Prop mapping).
- **New code**: use `@agenta/ui/ui` `Alert`. `type` defaults to `info`.
- **End state**: antd `Alert` replaced by this component everywhere.

## Prop mapping
| antd | `@agenta/ui` | notes |
|---|---|---|
| `type` (`success`/`info`/`warning`/`error`) | `type` | same; default `info` |
| `message` | `message` | ReactNode; not bold when alone, 14px when a description is present |
| `description` | `description` | ReactNode; below message in `colorText`, grows padding |
| `showIcon` | `showIcon` | leading filled status icon |
| `closable` | `closable` | trailing close `X` (`colorIcon` → hover `colorIconHover`) |
| `onClose` | `onClose` | close-button click handler |
| `banner` | `banner` | no border, no radius; **defaults `showIcon` to true** (antd parity) |
| `icon` | `icon` | overrides the default status icon |
| `action` | — | **deferred** (not built) |
| `afterClose` | — | **deferred** (no built-in dismiss animation; parent controls visibility) |

Note: antd's `closable` does not auto-remove the Alert here — it fires `onClose`; the parent
owns visibility (matching how most call-sites already gate rendering). antd's own collapse
motion (`afterClose`) is not reproduced.

## Infra added
None. All tokens already existed:
- bg/border: `bg-{success,info,warning,error}-bg` + `border-{…}-border` (`shadcnTokens`).
- icon colour: `text-colorSuccess` / `text-info` / `text-colorWarning` / `text-colorError`.
- message/description text: `text-colorTextHeading` (root) / `text-colorText` (description).
- close icon: `text-colorIcon` → `hover:text-colorIconHover`.
- geometry: `rounded-control-lg` (10px = app `borderRadiusLG`), `text-field-md` (12/20),
  `text-field-lg` + `leading-[1.6666666666666667]` (14px title with-description at antd's
  23.33px line-height), Tailwind spacing `px-3 py-2` / `px-6 py-5`.

## Gotchas
- **warning icon = `colorWarning`, not `colorWarningText`.** `text-warning` maps to
  `colorWarningText`, which diverges in dark (`#d89614` vs `#faad14`). antd's Alert icon uses
  `colorWarning` → use `text-colorWarning`. (Both happen to equal the same measured dark value
  here, but the token intent differs — do not "simplify" to `text-warning`.)
- **App antd `fontSize` = 12px, not the antd default 14.** So the default status icon is 12px
  (`size-3`) and the with-description icon is 20px (`size-5`) — measured, not the antd-default
  14/24. Pin the root to `text-field-md` so text never inherits the ancestor size.
- **With a description the title is 14px (`fontSizeLG`) and weight 400 — NOT bold.** antd v6
  does not bold it; only the size grows. (Reads as "bold" by eye because it's larger.)
- **`banner` auto-enables the icon.** antd: `showIcon` defaults to `true` in banner mode
  unless set. Reproduced via `iconVisible = showIcon ?? banner`.
- **Preflight is off** → `box-border` + `border-solid` required; `banner` uses `border-0`
  (its border-color is irrelevant since width is 0).

## Verification
Measured the real antd v6.3.7 Alert vs the agenta Alert in the `antd/Feedback/Alert`
`AntdVsAgenta` story (`getComputedStyle`, light + dark, transitions killed):
- radius 10px, border 1px, padding 8/12 (default) & 20/24 (description), icon 12px/20px,
  icon margins 8px/12px, close 12px `colorIcon`, title mb 8px — all match.
- bg/border/icon/close colours match exactly in **both** themes for all four types.
- Heights match exactly, single-line (38px) AND description mode (**113.33px** both, light
  + dark) after pinning the with-description title's line-height to antd's 23.33px via
  `leading-[1.6666666666666667]` (title line-height 23.3333px on both sides, measured).

The orchestrator runs the pixel VRT (`…feedback-alert--antd-vs-agenta`) as the gate.

## Deliberate deviations / token gaps
- **No 14px×1.6667 type ramp.** antd's with-description title is 14px / 23.33px line-height,
  but `text-field-lg` ships 14px / 22px (ratio 1.5714). Rather than eat the ~1.3px delta, the
  title carries an explicit line-height RATIO alongside the ramp:
  `text-field-lg leading-[1.6666666666666667]` — a ratio is not a raw pixel, needs no config
  edit, and reproduces antd's 23.33px line-height exactly (verified 113.33px root height,
  both themes). If a 14px×1.6667 ramp is ever added to `controlScale`, swap this for it.
- **Icon glyphs are phosphor fill-weight**, not antd's `@ant-design/icons` filled glyphs, to
  keep the migration moving off antd (consistent with the other `@agenta/ui/ui` components).
  Colour + size match; the glyph outline differs slightly (a VRT AA-level difference).

## For agents hitting conflicts
- The component is self-contained in `alert.tsx`; the only shared touch point is the single
  `index.ts` export line (after `checkbox`, before `cn`). If that export conflicts, keep both.
- Icon colour and default-icon maps are keyed by `type`; add a new type in three places
  (cva `type`, `alertIconColor`, `alertDefaultIcon`) if ever extended.
