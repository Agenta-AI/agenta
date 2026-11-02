# Switch — migration guide

**antd `Switch` → `@agenta/ui` `Switch`** (Radix `@radix-ui/react-switch`, `@agenta/ui/ui`) ·
status: **✅ primitive built; call-sites not yet migrated** · no visual change.

## TL;DR
A `@agenta/ui` `Switch` in current shadcn source style (no `forwardRef`, `data-slot` on Root **and** Thumb) re-skinned to
antd's Switch geometry via the shared `controlScale` (`h-switch`/`w-switch`/`size-switch-thumb`)
and coloured only through bridge tokens. `size: sm | default` (default = antd middle, 22×44;
sm = antd small, 16×28). antd's `loading` and rich labels are out of scope (see Deliberate
deviations).

## Before
```tsx
import {Switch} from "antd"

<Switch checked={on} onChange={setOn} />
<Switch size="small" defaultChecked disabled />
```

## After
```tsx
import {Switch} from "@agenta/ui/ui"

<Switch checked={on} onCheckedChange={setOn} />
<Switch size="sm" defaultChecked disabled />
```

## Usage
- Controlled: `checked` + `onCheckedChange`. Uncontrolled: `defaultChecked`.
- `size="sm"` for antd `size="small"`; omit for the default (antd middle).
- End state: import `Switch` from `@agenta/ui/ui`; never from `antd`.

## Prop mapping (antd → `@agenta/ui`)
| antd | `@agenta/ui` |
|---|---|
| `checked` | `checked` |
| `defaultChecked` | `defaultChecked` |
| `onChange(checked)` | `onCheckedChange(checked)` (value-first, no event) |
| `disabled` | `disabled` |
| `size="small"` / `"default"` | `size="sm"` / `"default"` |
| `loading` | — deferred (see Deliberate deviations) |
| `checkedChildren` / `unCheckedChildren` | — deferred (rich labels; compose if needed) |

## Infra added
None to the shared layer. The `controlScale` switch keys (`h-switch` 22 / `h-switch-sm` 16 /
`h-switch-thumb`·`w-switch-thumb` 18 / small 12; `w-switch` 44 / `w-switch-sm` 28) were added by
the shared-infra owner beforehand and consumed here via `size-switch-thumb` + the `theme()` calc
for thumb travel. No palette/generator/bridge change — every colour maps to an existing token.

## antd → token mapping (ground truth: `antd/es/switch/style/index.js` + app `antd-themeConfig.json`)
| antd token / rule | value | class |
|---|---|---|
| track unchecked `colorTextQuaternary` | `#bdc7d1` L / `rgba(255,255,255,.25)` D | `data-[state=unchecked]:bg-colorTextQuaternary` |
| track unchecked hover `colorTextTertiary` | `#758391` | `enabled:hover:data-[state=unchecked]:bg-colorTextTertiary` |
| track checked `switchColor`=`colorPrimary` | theme primary | `data-[state=checked]:bg-primary` |
| track checked hover `colorPrimaryHover` | `#394857` | `enabled:hover:data-[state=checked]:bg-btn-primary-hover` |
| handle `handleBg`=`colorWhite` | `#ffffff` (both themes) | `bg-white` |
| handle `handleShadow` | `0 2px 4px 0 rgba(0,35,11,.2)` | `shadow-[0_2px_4px_0_rgba(0,35,11,0.2)]` (literal — no token) |
| focus `genFocusStyle` | `outline: lineWidthFocus(4) solid colorPrimaryBorder(#d6dee6); offset 1px` | `focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-1 focus-visible:outline-focus-ring` |
| disabled `switchDisabledOpacity`=`opacityLoading` | `0.65` | `disabled:opacity-[0.65] disabled:cursor-not-allowed` |
| `trackPadding` | `2px` (fixed) | `p-[2px]` |

## Gotchas
- **Disabled opacity is 0.65, not 0.4.** antd `switchDisabledOpacity = opacityLoading = 0.65`
  (verified in `theme/util/alias.js`; the app does not override it). Measured/read from source,
  not assumed — the initial spec guess of 0.4 was wrong.
- **Focus is an outline, like Button — not a box-shadow like Select.** antd Switch uses the
  shared `genFocusStyle` mixin: `outline: lineWidthFocus solid colorPrimaryBorder`. The app sets
  `lineWidthFocus: 4` (default would be `lineWidth*3 = 3`), so it is a 4px outline, offset 1px,
  `:focus-visible` only — identical to Button, using the `focus-ring` (`colorPrimaryBorder`)
  token. Do NOT reach for the `controlOutline` glow that Select uses.
- **Thumb travel can't use the stock `translate-x-[calc(100%-2px)]` idiom.** That idiom only
  works when the track inner width minus thumb equals thumb minus the border/padding — a
  coincidence of shadcn's own dims. antd's 44/18 (and 28/12) don't satisfy it, so the thumb is
  derived from the size tokens: `translate-x-[calc(theme(width.switch)-theme(width.switch-thumb)-4px)]`
  (travel = trackWidth − thumb − 2×trackPadding → 22px default / 12px sm). `theme()` inside the
  arbitrary calc keeps geometry retunable in `controlScale` — no raw travel literal.
- **box-border is required.** antd Switch is `border-box`; `w-switch`(44) is the border-box and
  `p-[2px]` sits inside it. Without `box-border` (preflight off → content-box) the track renders
  4px too wide and the thumb travel is off.
- **Hover is gated on `enabled:`.** antd's hover rule is `&:hover:not(.disabled)`; a disabled
  switch must not pick up the hover colour.
- **antd removes the handle shadow when disabled** (`* { box-shadow: none }`). Mirrored with
  `disabled:[&_[data-slot=switch-thumb]]:shadow-none` (on top of the 0.65 dim).
- **Press-stretch reproduced token-purely.** antd grows the handle 30% on `:active`
  (`switchHandleActiveInset: -30%`) toward the press-opposite side. Radix has no `::before`, so
  the thumb itself is widened, keyed on the ROOT's `:active` applied to the thumb (antd's
  mechanism — `.ant-switch:not(-disabled):active .ant-switch-handle::before`), NOT the thumb's
  own `:active` (a descendant is not `:active` when its ancestor button is pressed). unchecked
  grows right (anchor left, translate stays 0); checked grows left (anchor right, so the travel
  is shortened by `0.3×thumb`). All via `theme()` calc on the `switch-thumb` scale — `×1.3`/`×0.3`
  encode the `-30%` constant; no raw travel literal. The `active:` override beats the resting
  translate/width by specificity (idiomatic state override, like Button's hover/active).

## Deliberate deviations
- **`loading` deferred.** antd's `loading` renders a spinner inside the handle and blocks
  toggling. Not part of this primitive (stock shadcn Switch has none). Compose later if a
  call-site needs it — do NOT add an antd-shaped `loading` prop here.
- **Rich labels (`checkedChildren`/`unCheckedChildren`) deferred** — same rationale; compose.

(The press handle-stretch was initially deferred but is now reproduced token-purely — see the
Gotcha above.)

## Verification (VRT first, computed-style as fallback)
`parity/vrt.mjs` is the primary gate (run by the orchestrator). Stories:
- `AntdVsAgenta` — unchecked, checked, small unchecked, small checked, disabled unchecked,
  disabled checked (6 rows).
- `InteractionStates` — checked/unchecked × hover, active, focus-visible, disabled (forced
  statically via `pseudo-hover-all` / `pseudo-active-all` / `pseudo-focus-visible-all`).

Confirm forced antd `:hover`/`:focus-visible` colours with `measureForcedStates()` if the VRT
flags them — the pseudo addon can't reliably force antd's runtime-injected CSS, and the handle
shadow / 1px-scale AA make a borderless-vs-antd forced-state pixel diff unreliable (GOTCHAS
§Interaction-state / parity README). The handle shadow is an arbitrary literal (no `--ag` token
exists for `handleShadow`) — see Token gaps in the agent report.

## For agents hitting conflicts
- The component is `web/packages/agenta-ui/src/components/ui/switch.tsx`; the export line is
  `export {Switch, type SwitchProps} from "./switch"` in that dir's `index.ts`, immediately
  after the Combobox export block.
- Geometry lives in `oss/tailwind.config.ts` `controlScale` (switch keys) — retune there, never
  in the component. Colours are all existing bridge tokens/color keys; no palette edit was made.
