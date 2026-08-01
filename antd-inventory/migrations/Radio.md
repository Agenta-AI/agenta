# Radio — migration guide

**antd `Radio` / `Radio.Group` → `@agenta/ui` `RadioGroup` + `RadioGroupItem`** (Radix
`@radix-ui/react-radio-group`, `@agenta/ui/ui`) · status: **✅ primitive built; call-sites not
yet migrated** · no visual change.

## TL;DR
A `@agenta/ui` `RadioGroup`/`RadioGroupItem` in current shadcn source style (no `forwardRef`, `data-slot` on the Group,
Item **and** Indicator) re-skinned to antd v6's Radio geometry via the shared `controlScale`
(`size-control-check` 16px circle, `size-control-dot` 8px dot) and coloured only through bridge
tokens. **Single size** — antd has no small radio. antd's `Radio.Button` (segmented pill group)
is out of scope (see Deliberate deviations).

**Key finding — antd v6 checked look is NOT v5.** antd v6 renders a checked radio as a
**filled `colorPrimary` circle with a WHITE center dot** (measured), not the v5 white circle
with a colored ring + colored dot. The component matches v6.

## Before
```tsx
import {Radio} from "antd"

<Radio.Group value={v} onChange={(e) => setV(e.target.value)} options={[
    {label: "A", value: "a"},
    {label: "B", value: "b"},
]} />

<Radio value="a" disabled>A</Radio>
```

## After
```tsx
import {RadioGroup, RadioGroupItem} from "@agenta/ui/ui"

<RadioGroup value={v} onValueChange={setV}>
    <label className="flex items-center gap-2"><RadioGroupItem value="a" /> A</label>
    <label className="flex items-center gap-2"><RadioGroupItem value="b" /> B</label>
</RadioGroup>

<RadioGroupItem value="a" disabled />
```

## Usage
- Controlled: `value` + `onValueChange(value)` on the `RadioGroup`. Uncontrolled: `defaultValue`.
- Each option is a `RadioGroupItem value="…"`; render its label beside it (antd's `options`
  auto-rendered labels — Radix does not, so wrap item+text in a `<label>`).
- `disabled` on the group disables all; `disabled` on an item disables one (antd parity).
- End state: import from `@agenta/ui/ui`; never from `antd`.

## Prop mapping (antd → `@agenta/ui`)
| antd | `@agenta/ui` |
|---|---|
| `Radio.Group value` | `RadioGroup value` |
| `Radio.Group onChange(e)` (`e.target.value`) | `RadioGroup onValueChange(value)` (value-first, no event) |
| `Radio.Group defaultValue` | `RadioGroup defaultValue` |
| `Radio.Group options={[{label,value}]}` | map to `RadioGroupItem` children + labels |
| `Radio.Group disabled` | `RadioGroup disabled` |
| `<Radio value>` | `<RadioGroupItem value>` |
| `<Radio disabled>` | `<RadioGroupItem disabled>` |
| `Radio.Button` (segmented) | — deferred → Segmented (see Deliberate deviations) |

## Infra added
None. The `controlScale` keys were added by the shared-infra owner beforehand and consumed
here: circle `size-control-check` (16px), dot `size-control-dot` (8px). **8px dot confirmed
correct** by measuring antd's `::after` (see Verification) — no config change needed. Every
colour maps to an existing bridge token; no palette/generator/bridge change.

## antd → token mapping (ground truth: measured `getComputedStyle` on antd v6 in Storybook, light + dark)
| antd rule (measured) | value (light / dark) | class |
|---|---|---|
| circle size | 16×16 | `size-control-check` |
| circle radius | 50% | `rounded-full` |
| circle border | 1px solid `colorBorder` `#bdc7d1` / `#424242` | `border border-solid border-border` |
| circle bg (resting) | `colorBgContainer` `#fff` / `#141414` | `bg-background` |
| hover border (enabled) | `colorPrimary` | `enabled:hover:border-primary` |
| **checked circle bg** | **`colorPrimary` `#1c2c3d` / `#d1d151` (FILLED)** | `enabled:data-[state=checked]:bg-primary` |
| checked circle border | `colorPrimary` | `enabled:data-[state=checked]:border-primary` |
| **checked dot** | 8×8, **white `#fff`** (`colorTextLightSolid`, both themes) | Indicator `size-control-dot bg-primary-foreground` |
| focus | 4px solid `colorPrimaryBorder` `#d6dee6`, offset 1px, `:focus-visible` | `focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-1 focus-visible:outline-focus-ring` |
| disabled bg | `colorBgContainerDisabled` `rgba(5,23,41,.04)` | `disabled:bg-colorBgContainerDisabled` |
| disabled border (even when checked) | `colorBorder` `#bdc7d1` (NOT primary) | `disabled:border-colorBorder` |
| disabled+checked dot | `colorTextDisabled` `#bdc7d1` | Indicator `…:disabled_&]:bg-colorTextDisabled` |
| disabled cursor | not-allowed | `disabled:cursor-not-allowed` |

## Gotchas
- **antd v6 dropped `.ant-radio-inner`.** The visible circle is now drawn on `.ant-radio` (the
  span) and the dot is its `::after` pseudo-element. A v5 parity selector (`.ant-radio-inner`)
  finds nothing (same class as the Select v6 rename — GOTCHAS §antd v6 DOM). Measure `.ant-radio`
  + its `::after`.
- **Checked = filled circle + white dot, not a ring.** The biggest trap: v6's checked radio
  fills the whole circle with `colorPrimary` and puts a WHITE dot in the center. A v5-style
  implementation (white circle, colored dot) is visibly wrong.
- **Checked is gated on `enabled:`, so disabled cleanly wins.** antd's disabled+checked radio is
  NOT filled primary — it reverts to the disabled bg/border (grey), with a grey dot. Scoping the
  checked fill/border to `enabled:data-[state=checked]:…` means `disabled:` overrides apply with
  no `!important` / specificity fight (same pattern as Switch's `enabled:hover:`).
- **The dot colour flips via the Indicator, not the circle.** The dot is white
  (`primary-foreground` = `colorTextLightSolid`, white in both themes) when enabled+checked, and
  `colorTextDisabled` when the item is disabled — expressed as an arbitrary variant on the
  Indicator: `[[data-slot=radio-group-item]:disabled_&]:bg-colorTextDisabled` (Radix Item is a
  `<button>` that carries the `disabled` attribute; the Indicator is its descendant).
- **`box-border` + `border-solid` required** (preflight off): `border` alone sets width but
  `border-style` defaults to `none` (0px), and the 16px circle must be border-box.
- **No dot in the unchecked state** — Radix only mounts the Indicator when checked, matching antd
  (whose `::after` is `scale(0)` when unchecked). No scale animation needed for static parity.
- **Hover is gated on `enabled:`** — a disabled radio must not pick up the primary hover border.

## Deliberate deviations
- **`Radio.Button` (segmented pill group) deferred.** antd's `Radio.Button` renders a connected
  button-bar (segmented control), a different component entirely. It maps to a future
  **Segmented** primitive, NOT this radio. Do NOT add an antd-shaped `optionType="button"` /
  `buttonStyle` prop here.
- **`options` auto-render deferred.** antd's `Radio.Group options={[…]}` auto-renders labels;
  Radix takes children. Callers map options to `RadioGroupItem` + labels (a mechanical wrap).

## Verification (VRT first, computed-style as fallback)
`parity/vrt.mjs` is the primary gate (run by the orchestrator). Stories:
- `AntdVsAgenta` — group (2nd selected), disabled group, single unchecked, single checked,
  single disabled+checked (5 rows).
- `InteractionStates` — unchecked/checked × hover, focus-visible, disabled (forced statically via
  `pseudo-hover-all` / `pseudo-focus-visible-all`).

antd v6 ground truth was captured with `getComputedStyle` on `.ant-radio` + its `::after`
(light + dark) — the circle geometry/colours and the **8px white dot** are measured, not
assumed. Confirm forced antd `:hover`/`:focus-visible` colours with `measureForcedStates()` if
the VRT flags them — the pseudo addon can't reliably force antd's runtime-injected CSS (a
forced `pseudo-hover-all` antd radio showed its RESTING border in-story; antd's real hover
border is `colorPrimary`, which the agenta side sets via `enabled:hover:border-primary`).

## For agents hitting conflicts
- The component is `web/packages/agenta-ui/src/components/ui/radio-group.tsx`; the export line is
  `export {RadioGroup, RadioGroupItem, type RadioGroupProps} from "./radio-group"` in that dir's
  `index.ts`, immediately after the Tooltip export.
- Geometry lives in `oss/tailwind.config.ts` `controlScale` (`control-check` 16 / `control-dot`
  8) — retune there, never in the component. Colours are all existing bridge tokens; no palette
  edit was made.
