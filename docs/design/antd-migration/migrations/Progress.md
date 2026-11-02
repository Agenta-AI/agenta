# Progress (antd `Progress` → `@agenta/ui/ui`)

## TL;DR
antd `Progress` (LINE variant) is ported as a presentational cva component (plain `div`s, no
Radix): an outer track (antd's `-rail`) with a rounded fill (antd's `-track`) whose width is a
percent-driven inline style, plus a trailing info label. Colour resolves through the
palette-derived `--ag-*` bridge so it flips light↔dark; geometry is Tailwind spacing, never raw
pixels. The determinate width animates with a CSS `transition-[width]` (antd `motionDurationSlow`
0.3s / `motionEaseInOutCirc`), NOT a config keyframe. `type="circle"`/`"dashboard"` are deferred.
All 13 parity rows MATCH antd v6.3.7 in light + dark.

## Before
antd `<Progress percent={x} />` etc., styled by antd's cssinjs — `-rail` background
`remainingColor` (`colorFillSecondary`), `-track` background `defaultColor` (`colorInfo`) or
`colorSuccess`/`colorError` by status, `-indicator` text at `colorText`/`colorSuccess`/`colorError`.

## After
`@agenta/ui/ui` `Progress`. cva variants:
- track `size` — `default` 8px (`h-2`) / `small` 6px (`h-1.5`).
- bar `status` — `normal`/`active` = `bg-info` (colorInfo), `success` = `bg-success`,
  `exception` = `bg-error`.
- text `status` (colour) × `size` (font 12px default / 10px small).

`data-slot`: `progress` (root) · `progress-body` · `progress-track` (outer) · `progress-bar`
(fill) · `progress-text` (info).

## Usage
```tsx
import {Progress} from "@agenta/ui/ui"   // once exported from the ui barrel (see below)

<Progress percent={60} />                                  // 60% + "60%" label
<Progress percent={40} size="small" showInfo={false} />    // thin bar, no label
<Progress percent={100} status="success" />                // green fill + check icon
<Progress percent={70} status="exception" />               // red fill + close icon
<Progress percent={65} strokeColor="var(--ag-colorPrimary)" trailColor="var(--ag-colorFill)" />
```

## Prop mapping (antd line `<Progress>` → ours)
| antd | ours | notes |
|---|---|---|
| `percent` | `percent` | clamped 0–100 |
| `size` (`"default"`\|`"small"`) | `size` | line thickness 8/6px + info font 12/10px |
| `status` (`normal`/`active`/`success`/`exception`) | `status` | unset → auto `success` at percent ≥ 100 (antd) |
| `showInfo` | `showInfo` | default `true` |
| `strokeColor` (string) | `strokeColor` | inline `background` on the bar |
| `trailColor`/`railColor` | `trailColor` | inline `backgroundColor` on the track |
| `format` | `format` | custom info renderer; defaults to `${percent}%` |
| `type="circle"`/`"dashboard"`, numeric `size`, `strokeWidth`, `steps`, `gradient strokeColor` | — | **deferred** (see below) |

## Infra added
None. Reuses existing bridge tokens (`bg-fill-secondary`, `bg-info`, `bg-success`, `bg-error`,
`text-foreground`/`text-success`/`text-error`), Tailwind default spacing (`h-2`/`h-1.5`,
`gap-2`, `rounded-full`), and antd's own status glyphs `CheckCircleFilled`/`CloseCircleFilled`
from `@ant-design/icons` (already a dependency; imported the same way elsewhere in the codebase).
No palette / generator / tailwind.config change.

## antd → token mappings (measured from antd v6.3.7 `progress/style/index.js` + `Line.js`, verified live)
- Line height: `size === 'small' ? 6 : 8` → **`h-1.5` / `h-2`** (measured 6.00 / 8.00px).
- Track (rail) bg = `remainingColor` = **`colorFillSecondary`** → `bg-fill-secondary`.
- Radius = `lineBorderRadius: 100` → **`rounded-full`** (renders identically to 100px on a
  6–8px bar); the bar inherits it (`rounded-[inherit]`).
- Bar (track) bg = `defaultColor` = **`colorInfo`** (NOT colorPrimary) → `bg-info`; status
  `success` = `colorSuccess` (`bg-success`), `exception` = `colorError` (`bg-error`).
- Info (`-indicator`): colour = `colorText` / `colorSuccess` / `colorError`
  (`text-foreground`/`text-success`/`text-error`); font = `fontSize` 12px default /
  `fontSizeSM` 10px small; `line-height: 1` → `leading-none`. Body `gap` = `marginXS` 8px → `gap-2`.
- Status icons: antd swaps the `%` label for `CheckCircleFilled` (success) / `CloseCircleFilled`
  (exception) on the line variant. We render **antd's own `@ant-design/icons` glyphs** for exact
  parity; their `1em` svg + shared `.anticon` box mean the icon size (12px default / 10px small,
  from the span font) AND the info-area height (12.5 / 10.75px) match antd exactly — measured
  identical, which keeps the bar vertically centred at the same y.
- Bar width = `${percent}%` inline style (content-driven, exactly as antd does — not a token).

## Deliberate deviations
- **Bar default colour is `colorInfo`, not `colorPrimary`.** The original task brief said
  colorPrimary, but antd's source uses `defaultColor: token.colorInfo`, and the two DIVERGE in
  dark (info = blue `#1668dc`, primary = brand yellow `#f2f25c`). Matching antd's rendered value
  (the migration hard rule) means `bg-info`. Confirmed identical to antd in both themes by the
  live measurement.
- **Status icons use `@ant-design/icons` (`CheckCircleFilled`/`CloseCircleFilled`), not
  phosphor.** The first pass used phosphor `CheckCircle`/`XCircle weight="fill"` (matching the
  Alert port), but the VRT flagged the success/exception rows ~24%: the phosphor glyph differs in
  shape AND its inline svg made the info span ~1.5px taller than antd (14 vs 12.5px), which
  misaligned the whole crop (an outline around the bar, not a real bar shift — `barTop` Δ was
  0.00). antd's own glyphs eliminate both: exact SVG paths + antd's `.anticon` box → info height
  and icon box match to the sub-pixel. This deliberately keeps a small `@ant-design/icons`
  dependency for pixel-exact parity; swap to a phosphor/lucide equivalent later only as an
  explicit visual change if fully shedding `@ant-design/icons`.

## Gotchas
- `box-border` required on every part (preflight OFF app-wide).
- The width animation is a **CSS transition** (`transition-[width] duration-300
  ease-[cubic-bezier(0.78,0.14,0.15,0.86)]` = antd `motionDurationSlow`/`motionEaseInOutCirc`),
  NOT a keyframe — do not add a config keyframe/token for it.
- **`size="small"` shrinks the info font to 10px** (`fontSizeSM`), and the icon with it. Missing
  this makes the small-size bar pixel width diverge too: a wider (12px) label steals width from
  the flex-auto rail, so the bar's px width drifts (caught by the live measurement: 66 vs 67.8).
- Info font uses `text-[10px]` (arbitrary length) for small so tailwind-merge classifies it as
  font-size, not a colour token.

## Accessibility
Root carries `role="progressbar"` + `aria-valuenow`/`aria-valuemin={0}`/`aria-valuemax={100}`
(matches antd exactly). The `%`/icon is visible text/icon, no extra label needed.

## Verification
Cover LINE only. Story `antd/Feedback/Progress` → `AntdVsAgenta` renders 13 rows: percent values
× status (normal/success/exception + auto-success) × size (default/small) × showInfo on/off +
strokeColor/trailColor. A live `getComputedStyle` sweep (antd `.ant-progress-*` vs agenta
`[data-slot]`, transitions frozen, light + dark) reports **13/13 MATCH** across trackH, trackBg,
barBg, barW, infoColor, infoFont, infoLH, and gap. For the success/exception (icon) rows a
dedicated geometry sweep confirms infoRect (incl. height 12.5 / 10.75px), iconRect, barTop, and
barH are **byte-identical** to antd in both themes — so the VRT icon rows sit at the AA floor like
the normal rows (the earlier ~24% was the phosphor glyph + a 1.5px info-height misalignment, both
now gone). Non-interactive → prove non-focusable (no tabindex; `role=progressbar` is not in the
tab order).

## Deferred pieces
`type="circle"` and `type="dashboard"` (SVG ring, `strokeWidth`/`gapDegree`/`gapPosition`),
numeric pixel `size`, `steps`, and gradient `strokeColor` objects are not ported. One call-site
uses `type="circle"` (`web/packages/agenta-ui/src/components/selection/LoadAllButton.tsx`) — keep
it on antd until the circle variant is built (SVG `<circle>` with `stroke-dasharray`, text in the
centre). The four LINE call-sites (Onboarding WidgetSection, PromptImageUpload, SessionHeader,
and the LoadAllButton line usage) are covered by this component's props.

## For agents hitting conflicts
Single source of truth for geometry/colour is antd's `progress/style/index.js`
(`prepareComponentToken` + `genLineStyle` + `genSmallLine`) and `progress/Line.js` (heights,
percent width, rail/track split). Re-derive any changed value there; keep colour on the `--ag-*`
bridge tokens and geometry on Tailwind spacing — never hardcode hex, and never move the width
animation into the config.
