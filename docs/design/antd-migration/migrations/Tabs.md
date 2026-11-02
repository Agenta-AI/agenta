# Tabs — migration guide

**antd `Tabs` (default LINE type) → `@agenta/ui` `Tabs` (Radix `@radix-ui/react-tabs`,
`@agenta/ui/ui`)** · status: **✅ primitive built; call-sites not yet migrated** · no visual change.

## TL;DR
A `@agenta/ui` `Tabs` over Radix (no `forwardRef`, `data-slot` on every part: `tabs`, `tabs-list`,
`tabs-trigger`, `tabs-content`). Reproduces antd's default LINE tabs: a horizontal `TabsList`
with a 1px `colorBorderSecondary` bottom rule, triggers coloured `colorText` (inactive) →
`colorPrimary` (active) with `colorPrimaryHover` on hover, and a 2px `colorPrimary` ink bar
under the active tab that overlaps the bottom rule. Geometry from antd's measured tokens
(12px vertical padding, 32px gutter, 12px type). antd `type="card"`/`"editable-card"`,
`tabPosition`, and editable affordances are deferred.

## Before
```tsx
import {Tabs} from "antd"

<Tabs
    activeKey={active}
    onChange={setActive}
    items={[
        {key: "1", label: "One", children: <PaneOne />},
        {key: "2", label: "Two", children: <PaneTwo />},
        {key: "3", label: "Three", disabled: true, children: <PaneThree />},
    ]}
/>
```

## After
```tsx
import {Tabs, TabsList, TabsTrigger, TabsContent} from "@agenta/ui/ui"

<Tabs value={active} onValueChange={setActive}>
    <TabsList>
        <TabsTrigger value="1">One</TabsTrigger>
        <TabsTrigger value="2">Two</TabsTrigger>
        <TabsTrigger value="3" disabled>Three</TabsTrigger>
    </TabsList>
    <TabsContent value="1"><PaneOne /></TabsContent>
    <TabsContent value="2"><PaneTwo /></TabsContent>
    <TabsContent value="3"><PaneThree /></TabsContent>
</Tabs>
```
antd's flat `items` array becomes composed children: label → `TabsTrigger`, children →
`TabsContent` keyed by the same `value`.

## Usage
- Controlled: `value` + `onValueChange`. Uncontrolled: `defaultValue`.
- Disable a tab: `disabled` on its `TabsTrigger`.
- The active tab shows the 2px ink bar automatically (Radix `data-state="active"`).
- End state: import the parts from `@agenta/ui/ui`; never render antd `Tabs`.

## Prop mapping (antd → `@agenta/ui`)
| antd | `@agenta/ui` |
|---|---|
| `items={[{key, label}]}` | `<TabsTrigger value={key}>label</TabsTrigger>` |
| `items={[{key, children}]}` | `<TabsContent value={key}>children</TabsContent>` |
| `items={[{disabled}]}` | `disabled` on `TabsTrigger` |
| `activeKey` | `value` |
| `defaultActiveKey` | `defaultValue` |
| `onChange` | `onValueChange` |
| `type="card" \| "editable-card"` | — deferred (line type only) |
| `tabPosition="top" \| "left" \| ...` | — deferred (top/horizontal only) |
| `size="small" \| "large"` | — deferred (default padding/type only) |
| `tabBarExtraContent` / `addIcon` / `onEdit` | — deferred (compose later) |
| `animated` (sliding ink bar) | — not reproduced (static underline; see Deviations) |

## Infra added
**None.** No palette / generator / bridge / `controlScale` change. Every value maps to an
existing bridge token or the default Tailwind spacing/type scale (see mapping below).

## antd → token mapping (ground truth: `antd/es/tabs/style/index.js` `prepareComponentToken` + app `antd-themeConfig.json`)
All MEASURED from the app's antd theme (this app overrides antd defaults: `fontSize` 12,
`lineWidthBold` 2, `paddingSM` 12, `colorPrimary` = `#1c2c3d` in light).
| antd token / rule | value (this app) | class |
|---|---|---|
| bar bottom rule `lineWidth`×`colorBorderSecondary` | 1px `#eaeff5` L / dark | `border-b border-colorBorderSecondary` |
| ink bar thickness `lineWidthBold` | 2px | `border-b-2` (active trigger) |
| ink bar colour `inkBarColor` = `colorPrimary` | `#1c2c3d` L / algo D | `border-primary` |
| item colour (inactive) `itemColor` = `colorText` | `#1c2c3d` L | `text-foreground` |
| item colour (active) `itemSelectedColor` = `colorPrimary` | `#1c2c3d` L / algo D | `data-[state=active]:text-primary` |
| item hover `itemHoverColor` = `colorPrimaryHover` | `#394857` L / olive D | `data-[state=inactive]:hover:text-btn-primary-hover` |
| item pressed `itemActiveColor` = `colorPrimaryActive` | `#051729` L | `data-[state=inactive]:active:text-btn-primary-active` |
| item disabled `itemDisabledColor` = `colorTextDisabled` | `#bdc7d1` L | `disabled:text-disabled disabled:cursor-not-allowed` |
| item padding `horizontalItemPadding` = `paddingSM px 0` | 12px 0 | `py-3 px-0` |
| item gutter (MEASURED: non-first tab `margin-left`) | **24px** | `gap-6` on the list |
| nav margin-bottom `horizontalMargin` = `0 0 margin 0` | 16px | `mb-4` on the list |
| item font `titleFontSize` = `fontSize` | 12px | `text-field-md` |
| item icon margin `marginSM` | 8px | `gap-2` |
| tab focus `genFocusOutline(token, -3)` (`lineWidthFocus` solid `colorPrimaryBorder`, offset **-3**) | 4px `#d6dee6` L / olive D, inset 3px | `focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-[-3px] focus-visible:outline-focus-ring` |

## Gotchas
- **Ink bar overlaps the bar rule via `-mb-px`.** The active trigger's 2px `border-primary`
  bottom border and the list's 1px `border-colorBorderSecondary` rule are adjacent boxes;
  pulling the trigger down 1px (`-mb-px`) makes the ink bar cover the rule instead of stacking
  a 2px + 1px double line — antd's `.ant-tabs-ink-bar` is absolutely positioned at the nav
  bottom, on top of the `::before` rule.
- **Transparent 2px rail at rest.** Every trigger carries `border-b-2 border-transparent` so
  activating a tab does not shift its height (only the colour changes). `border-0` precedes it
  so the app's global default border-width (preflight off) doesn't leak on the other 3 sides.
- **List uses `border-0` before `border-b`** for the same reason (the single-side border leak,
  see GOTCHAS §Native-element parity / Divider) — otherwise a full box draws around the bar.
- **Hover/pressed scoped to inactive tabs via `data-[state=inactive]:`.** Radix stamps
  `data-state="active" | "inactive"` on every trigger; gating hover to `inactive` keeps the
  active tab at `colorPrimary` instead of flipping to `colorPrimaryHover`, matching antd where
  the selected tab keeps its selected colour.
- **Gutter is 24px, MEASURED — not the source's `horizontalItemGutter: 32`.** antd v6.3.7 in
  this theme renders `margin-left: 24px` on non-first tabs (first tab 0). The start-edge distance
  between consecutive tabs = tab width + 24. `gap-6` on the list reproduces it exactly (verified
  agenta gaps 71.59/72.13 == antd). Do NOT trust the `prepareComponentToken` literal here.
- **Tab focus offset is `-3px` (INSET), unlike Button's `+1px`.** antd v6 draws the focus ring on
  the outer `.ant-tabs-tab` via `genFocusOutline(token, -3)` (and sets the inner btn `outline:none`).
  Tabs have 0 horizontal padding, so the inset ring hugs the text. `outline-offset-[-3px]` is an
  antd-exact literal (same pattern as select.tsx's `shadow-[0_0_0_2px_…]`); there is no controlScale
  key for it — see Verification. Verified agenta reads 4px solid `#d6dee6` offset -3px.
- **antd's tab focus can't be forced in the story (harness artifact).** The pseudo-states addon
  can't add antd's `.ant-tabs-tab-focus` JS class, so the antd tab renders `outline: none` in the
  `InteractionStates` focus row while agenta shows its ring → the VRT reads that row elevated (~15%).
  This is the documented "antd forced states are pixel-unreliable" caveat, NOT a defect — the agenta
  outline was matched to antd's SOURCE spec by computed-style instead (4px/#d6dee6/-3px).
- **In light, `colorPrimary` == `colorText` == `#1c2c3d`**, so active and inactive text are the
  SAME colour in light — only the ink bar distinguishes them. They DIVERGE in dark (algorithm
  flip), which is why the tokens are `text-foreground` vs `text-primary`, not one hardcoded value.
- **Triggers are `<button>`s** → `box-border border-solid font-[inherit] px-0` reset (preflight
  off; UA font/padding otherwise leak — width is the tell).
- **`bg-transparent` on the trigger is REQUIRED.** Preflight is off, so a bare `<button>` keeps
  the UA `background-color: buttonface` (`rgb(239,239,239)`) — subtle in light (~8% VRT) but LOUD
  in dark (44–65%, the light-gray block against the dark page). antd's LINE tab is fully
  transparent. Every Button variant sets an explicit bg so it never hits this; Tabs must too.
  There is NO `bg-muted`/pill on the list or trigger — the gray was pure UA leak, fixed by the
  explicit `bg-transparent` reset (verified list + all triggers = `rgba(0,0,0,0)` both themes).

## Deliberate deviations
- **Sliding ink-bar animation not reproduced.** antd animates the ink bar sliding between tabs
  (`animated.inkBar`). Ours is a static per-trigger underline that matches antd at REST; the
  motion is a flourish, not a layout/colour property, and is out of scope for pixel parity.
- **Line type only.** `type="card"`/`"editable-card"`, `tabPosition` (left/right/bottom), `size`,
  and editable/extra-content affordances are deferred — compose or extend when a call-site needs
  them; do NOT add antd-shaped props speculatively (migration recipe hard rule).

## Verification (VRT first, computed-style as fallback)
`parity/vrt.mjs` is the primary gate (run by the orchestrator). Stories under
`title: "antd/Data Display/Tabs"`:
- `AntdVsAgenta` — three `.grid` rows: tab 1 active (default), tab 2 active, a disabled tab.
  Each cell renders the tab bar (list + triggers) plus a small content area so the ink bar and
  active/inactive/disabled colours diff side by side.
- `InteractionStates` — `pseudo-*-all` forced rows: tab hover (inactive → colorPrimaryHover),
  tab active (selected + ink bar), tab focus-visible, tab disabled.

Confirm the forced hover AND focus with `measureForcedStates()` — antd's tab hover/focus are
runtime-injected cssinjs (focus also needs antd's `.ant-tabs-tab-focus` JS class), which the
pseudo-states addon can't force, so the pixel diff on those rows is unreliable (parity README
§"Forced interaction states on antd are pixel-unreliable"). The focus row reads ~15% because
antd renders no outline in the story; agenta's outline was matched to antd's SOURCE spec by
computed-style (4px solid `colorPrimaryBorder` `#d6dee6`, offset `-3px`).

**Geometry gap (reported):** `outline-offset: -3px` has no `controlScale` key and no standard
Tailwind negative-offset-3 utility (scale is -0/1/2/4/8). Used the antd-exact arbitrary
`outline-offset-[-3px]` (consistent with select.tsx's arbitrary `shadow-[0_0_0_2px_…]`) rather
than the closest standard `-outline-offset-2`/`-4`, since parity to antd's measured -3px wins.
No config edit was made.

## For agents hitting conflicts
- Component: `web/packages/agenta-ui/src/components/ui/tabs.tsx`; export line
  `export {Tabs, TabsList, TabsTrigger, TabsContent} from "./tabs"` in that dir's `index.ts`,
  immediately after `export {Divider, type DividerProps} from "./divider"`.
- No shared-infra edit — all colours are existing bridge tokens (`colorBorderSecondary`,
  `foreground`, `primary`, `btn-primary-hover`, `btn-primary-active`, `disabled`, `focus-ring`)
  and geometry is `text-field-md` + default Tailwind spacing.
