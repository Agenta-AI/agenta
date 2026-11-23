---
name: ui-design-rules
description: Agenta's UI design rules for shape, buttons, tooltips, motion, view states, icons, alignment, touch and small screens. Use whenever you design or build UI, in Claude Design, in the app, or anywhere else, and before you call a UI change done.
---

# UI design rules

These rules define how Agenta screens look and behave. Apply them while you build, not
as a cleanup pass. If a case is not covered here, ask the user; do not invent a rule.

The full design system is `web/mobile/DESIGN.md`: principles, theme variables, patterns,
and every anti-pattern with its rule ID (`SHAPE-01`, `TOUCH-03`, ...). Read it before UI
work in `web/mobile`; this skill is the short version. If the two disagree, `DESIGN.md`
wins. Values live in `web/mobile/src/design/theme.config.ts`, and `/m/design-system` shows
each rule with a Do and an Avoid example.

Use the checklist at the end before you call a UI change done.

## 1. Shape

**Nothing is round** (`SHAPE-01`). No pills, no circles, no `rounded-full`, no 50% radius.
This includes buttons, avatars, Marks, badges, switches and status dots. A radius is at
most a quarter of the element's short side.

## 2. Primitives

**Use the shadcn primitives for base components.** Input, Button, DropdownMenu, Select,
Tooltip, Dialog, Sheet, and the like come from the shared kit: import from
`@agenta/ui/ui` (source in `web/packages/agenta-ui/src/components/ui/`). Do not hand-roll
a base component with a `<div>` and classes.

**Keep base primitives where the shadcn components live.** That folder is the only home
for base primitives. Do not add a new primitive, or a copy of an existing one, anywhere
else.

## 3. Buttons and actions

**One primary action per view** (`ACT-01`). Only one button uses the primary style. In
the kit, primary is `variant="default"`. Every other action uses a quieter variant:
`secondary`, `outline`, or `ghost`.

**Keep destructive actions quiet** (`ACT-03`). Use `variant="destructive-ghost"` on pages,
in toolbars and in menus. Solid `destructive` is only for the final confirm in a dialog.

**Never put two icons in one button** (`ICON-02`). One leading icon or one trailing icon,
not both.

**Space adjacent buttons 4px apart, 8px at most.** Use `gap-1` (4px) by default and never
more than `gap-2` (8px) for a group of buttons that sit together.

**Weight never changes with state** (`TYPE-05`). A button, tab, segment, menu item,
selected row or focused control stays at weight 500 (`text-label`) when it is active,
selected, current, open or focused. Show state with color or a fill (`bg-selected`,
`text-foreground`). Never `data-[state=active]:font-semibold`, never a 600 button. The
ratchet counts `weight-by-state`.

**Brand yellow only for New agent on Home** (`COLOR-02`). Publish, sign-in and billing use
the default primary.

## 4. Forms and tooltips

**Put a field's explanation in a "?" tooltip, not under the label.** When an input has a
label and an explanation, the label stays visible and the explanation goes into a
tooltip on a "?" icon next to the label. With the shared `Field`, pass the text as
`tooltip`, not as `description`.

**Point the tooltip away from the next action.** Choose the side so the open tooltip
does not cover the control the user is most likely to use next. Set the side
explicitly when the default covers something: `tooltipPlacement` on `Field` (default
`right`), or `side` on `TooltipContent`.

**Autofocus the input where it matters.** Example: a "New" button takes the user to a
view where they must type something, such as a name. Focus that input when the view
opens (`autoFocus` on the input).

## 5. Surfaces and hover

**Separate areas by tone, not by more borders** (`SURF-01`). When an area needs to stand
apart, give it a different surface (`bg-muted` on `bg-background`).

**One hover fill** (`HOVER-01`). Every hoverable row, menu item and ghost control uses
`hover:bg-accent`. Do not pick `muted`, `foreground/10` or a gray for one screen.

**A fill inside a hoverable row is translucent** (`HOVER-02`). Use `bg-secondary` for a
Mark or a chip inside a row, so it stays visible when the row is hovered.

**No shadow on hover** (`SURF-04`). Shadows are only for things that float.

**Data colors are for data only** (`COLOR-05`). `data-1` … `data-6` with `on-data` tell
categories and chart series apart: span types, file kinds, agent avatars, template tiles.
Never use them for hover, selection, status or a button. Badges keep the five status
variants (`BADGE-01`). `scrim`, `on-scrim` and `logo-ground` are for images, video and
third-party logos only.

## 6. Scroll areas

**Fade the edges of a scroll area in the directions it scrolls.** The top fade shows only
when the content is scrolled down, and the bottom fade only when there is more below.
Use the shared `useScrollFadeEdges` hook (`@agenta/ui/hooks`) with the `.ag-scroll-fade`
class (`axis: "x"` with `.ag-scroll-fade-x` for horizontal). Do not write your own
gradient, and do not use the older `web/mobile/src/lib/useScrollFade.ts` in new code.

## 7. Motion

**Animate a view swap** (`MOTION-01`). When a click swaps one view or component for
another, add a 120–200ms fade and slide.

**No bounce, no attention-seeking motion** (`MOTION-02`). No overshoot, no shaking. Live
activity is a spinning `CircleNotch`, or a 1.5s opacity pulse on a status dot. No ping, no
scaling, no spinning rings or gradients.

In `web/mobile`, use the shared presets in `src/lib/motion`; never hardcode a duration or
an easing. The `mobile-motion-patterns` skill has the presets and the reduced-motion
rules. Package code cannot import those `web/mobile` presets.

## 8. View states

**Design every state of a view.** Each view needs:

| State | Requirement |
| --- | --- |
| Empty | Says what is missing and offers the first action (`STATE-01`). |
| Loading | An exact skeleton of the loaded view (`STATE-02`). |
| Error | Says the cause, the effect and the fix (`STATE-03`). |

An exact skeleton has the same layout as the loaded content: same rows, heights, and
columns, so nothing shifts when the data arrives. Build it from `Skeleton`,
`SkeletonBlock`, or `SkeletonRows` in `@agenta/ui/ui`. In `web/mobile`, state components
go in the feature's `states/` folder (see the `mobile-app-structure` skill and the
states section of `web/mobile/AGENTS.md`).

For the empty state, use `EmptyState` from `@agenta/ui/ui` (`title`, `description`, and
the action as children). `Empty` (without `State`) is the bare layout wrapper; it has no `title` or
`description` props. Compose it with `EmptyHeader`, `EmptyTitle`, `EmptyDescription`, and
`EmptyContent` when you need a custom layout.

## 9. Icons

**Phosphor only** (`ICON-01`). Import icons from `@phosphor-icons/react`. No other icon
library.

**One icon per product term** (`ICON-05`). Agent, Skill, Session and the other terms each
have one icon. Take it from "Icon per term" in `DESIGN.md`.

**Center icons optically, not mathematically** (`ICON-03`). Some icons, such as a play
triangle or an arrow, look off-center when their box is centered by math. Move them 1px
so they look centered.

**Keep equal gaps between icons in a row.** Measure the gap from the visible icon edges,
not from the hit areas, so the gaps look equal.

## 10. Alignment

Pick one alignment line for a view and make the content below it follow that line. The
line aligns content, not boxes.

1. **Find the anchor.** The anchor is the first strong element of the view: usually the
   page title or the hero component (for example the composer).
2. **Draw the line.** Take a vertical line from the anchor.
3. **Align everything downstream to it.** Headings, inputs, tabs, list rows, and their
   text sit on that line.

The line usually runs along the anchor's left edge (`ALIGN-01`). The text and the first
icon or Mark of each element sit on it. A padded box (list row, input, group header, nav
item, segmented control) hangs outside the line by its own padding: a negative margin
equal to the padding. Outdents: list row 12px, group header 12px, input 8px, nav item 8px.
The kit does not apply outdents yet, so set the margin on the screen.

In the sidebar, the text of nav items, group labels and the workspace name sits on one
line. The nav icons sit on the center line of the workspace Mark (`ALIGN-02`). If they
followed its left edge, the Mark would look off.

See [references/alignment.md](references/alignment.md) for one bad and four good examples
from Agenta screens.

## 11. Rows, gaps and sizes

A Mark is the neutral icon or letter tile (`IconTile` from `@agenta/ui/ui`).

| What | Value | Rule |
| --- | --- | --- |
| Menu row (dropdown, context menu, select, combobox, command palette) | `MENU_ITEM`: 32px on every screen | `ROW-01` |
| List row | 28px tree and rail rows, 36px for one line, 48px for title + meta; the same on every screen; divider inside the height | `SPACE-02` |
| Control | 32px default, 28px below 640px (the kit does it); never larger on touch | `SIZE-03` |
| Popover width | `w-popover-sm` 240, `w-popover-md` 320, `w-popover-lg` 400 | |
| Icon to text | 4px in badges and `xs` buttons, 6px in other controls, 8px in rows | `GAP-01` |
| Mark to text | 8px for 16–24px Marks, 12px for 32–40px Marks | `GAP-02` |
| Mark size | 16 inline, in nav and in menus · 20 in pickers · 24 in list rows · 32 in headers and cards · 40 in empty states | `CONS-01` |

A popover with search has one layout (`MENU-02`): search on top, group headings,
`MENU_ITEM` rows, a divider, then the create or connect action as one more row. Build it
with `Command` from `@agenta/ui/ui`.

Use the kit menus; they already render `MENU_ITEM`. Import `MENU_ITEM` only for a custom
list that is not one of the kit menus.

## 12. Small screens and touch

**Small screens never get bigger UI** (`SIZE-03`). Below 640px the theme steps `control-md` to 28px and `control-lg` to 32px, and the kit primitives follow by themselves. Never add phone or touch sizes: no `phone ? "h-11"`, `pointer-coarse:` sizes, `max-md:` sizes, 44px rows or hidden tap boxes. Rows and text are the same size on every screen. Fields show 16px text on touch at the same height (`TOUCH-02`).

**Phone layout.** The header is one 44px bar: one leading button, one title, the kit's compact icon
buttons (`PHONE-02`). The leading button is the menu on top-level pages and Back on detail pages
(agent, automation, skill) and drill-ins, never both (`PHONE-03`). One item owns the bottom edge: the composer entry,
or one primary action, never a nav bar; main navigation is the sidebar drawer from the header menu (`PHONE-01`). The right column (Activity or the agent pane) is a `panel-side` column on wide
windows and a drill-in with Back on a phone, with the item named in its header
(`LAYOUT-04`, `PANE-01`). The composer entry is the Composer's own collapsed state, never a plain input
(`COMP-02`).

## Checklist

Before you call a UI change done, check each item:

- [ ] Nothing is round (§1).
- [ ] Base components come from `@agenta/ui/ui`; no new primitive outside it (§2).
- [ ] One primary button in the view; no button has two icons (§3).
- [ ] Adjacent buttons are 4px apart, 8px at most (§3).
- [ ] Field explanations sit in a "?" tooltip; tooltips do not cover the next action (§4).
- [ ] The input the user came to fill has focus (§4).
- [ ] Areas are separated by tone, not stacks of borders; hover is `bg-accent`, with no shadow (§5).
- [ ] Scroll areas fade at the edges that can scroll (§6).
- [ ] View swaps animate with a shared preset; nothing bounces or pulses (§7).
- [ ] Empty, exact skeleton, and error states exist (§8).
- [ ] Icons are Phosphor, one per product term, and look centered and evenly spaced (§9).
- [ ] Components follow one alignment line from the anchor (§10).
- [ ] Menu rows, list rows, gaps and Marks use the sizes for their place (§11).
- [ ] Nothing is loud: no weight above 600, 1px lines, no large saturated fills (`TYPE-04`, `LOUD-01`, `LOUD-06`).
- [ ] Colors come from theme variables, never raw values or antd names (`COLOR-01`).
- [ ] No phone or touch size patches: the same kit sizes on every screen, nothing bigger on a phone (`SIZE-03`, §12).
- [ ] On touch: 16px input text and no hover-only actions (`TOUCH-02`, `TOUCH-03`).
- [ ] No weight by state: tabs, segments, menu items and selected rows stay at 500 (`TYPE-05`).
- [ ] Data colors only for data (categories, charts, avatars), never UI state; badges use status tones (`COLOR-05`, `BADGE-01`).
- [ ] Content sits on the alignment line; padded boxes outdent by their padding (`ALIGN-01`).
- [ ] Phone: one 44px header with the menu on top-level pages and Back alone on detail pages, one item on the bottom edge, the right column as a drill-in (`PHONE-01`…`03`, `LAYOUT-04`).
