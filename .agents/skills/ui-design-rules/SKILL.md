---
name: ui-design-rules
description: Agenta's UI design rules for shape, buttons, tooltips, motion, view states, icons, and alignment. Use whenever you design or build UI, in Claude Design, in the app, or anywhere else, and before you call a UI change done.
---

# UI design rules

These rules define how Agenta screens look and behave. Apply them while you build, not
as a cleanup pass. If a case is not covered here, ask the user; do not invent a rule.

Use the checklist at the end before you call a UI change done.

## 1. Shape

**Never make a component fully rounded.** Fully rounded (pill or circle) is not Agenta's
design language. This includes buttons and avatars.

Fully rounded includes `rounded-full` and `rounded-control-round` (50%).

## 2. Primitives

**Use the shadcn primitives for base components.** Input, Button, DropdownMenu, Select,
Tooltip, Dialog, Sheet, and the like come from the shared kit: import from
`@agenta/ui/ui` (source in `web/packages/agenta-ui/src/components/ui/`). Do not hand-roll
a base component with a `<div>` and classes.

**Keep base primitives where the shadcn components live.** That folder is the only home
for base primitives. Do not add a new primitive, or a copy of an existing one, anywhere
else.

## 3. Buttons and actions

**One primary action per view.** Only one button uses the primary style. In the kit,
primary is `variant="default"`. Every other
action uses a quieter variant: `secondary`, `outline`, or `ghost`.

**Never put two icons in one button.** One leading icon or one trailing icon, not both.

**Space adjacent buttons 4px apart, 8px at most.** Use `gap-1` (4px) by default and never
more than `gap-2` (8px) for a group of buttons that sit together.

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

**Do not use borders aggressively.** When an area needs to stand apart, put it on a
block with a different background color instead of adding more borders.

**No shadow on hover.** A hover effect must not add or grow a shadow on any component.

## 6. Scroll areas

**Fade the edges of a scroll area in the directions it scrolls.** The top fade shows only
when the content is scrolled down, and the bottom fade only when there is more below.
Use the shared `useScrollFadeEdges` hook (`@agenta/ui/hooks`) with the `.ag-scroll-fade`
class (`axis: "x"` with `.ag-scroll-fade-x` for horizontal); do not write your own gradient. (`web/mobile/src/lib/useScrollFade.ts`
is an older, separate gradient-mask hook, not the shared one.)

## 7. Motion

**Animate a component swap.** When a click swaps one view or component for another, add
a subtle transition between them.

**Apply smooth motion where it helps the end user, and keep it cheap to apply.** In
`web/mobile`, reuse the shared presets in `src/lib/motion`; the `mobile-motion-patterns`
skill has the presets and the reduced-motion rules. Package code cannot import those
`web/mobile` presets.

## 8. View states

**Design every state of a view.** Each view needs:

| State | Requirement |
| --- | --- |
| Empty | Tells the user what to do next. |
| Loading | An exact skeleton of the loaded view. |
| Error | An error state. |

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

**Center icons optically, not mathematically.** Some icons, such as a play triangle or
an arrow, look off-center when their box is centered by math. Move them 1px so they look
centered.

**Keep equal gaps between icons in a row.** Measure the gap from the visible icon edges,
not from the hit areas, so the gaps look equal.

## 10. Alignment

Pick one alignment line for a view and make the components below it follow that line.

1. **Find the anchor.** The anchor is the first strong element of the view: usually the
   page title or the hero component (for example the composer).
2. **Draw the line.** Take a vertical line from the anchor.
3. **Align everything downstream to it.** Headings, inputs, tabs, list rows, and their
   text sit on that line.

The line usually runs along the anchor's left edge. In the sidebar, it runs through the
center of the workspace avatar instead: the nav icons sit on the avatar's center line.
If they followed its left edge, the avatar would look off.

See [references/alignment.md](references/alignment.md) for one bad and four good examples
from Agenta screens.

## Checklist

Before you call a UI change done, check each item:

- [ ] No component is fully rounded (§1).
- [ ] Base components come from `@agenta/ui/ui`; no new primitive outside it (§2).
- [ ] One primary button in the view; no button has two icons (§3).
- [ ] Adjacent buttons are 4px apart, 8px at most (§3).
- [ ] Field explanations sit in a "?" tooltip; tooltips do not cover the next action (§4).
- [ ] The input the user came to fill has focus (§4).
- [ ] Areas are separated by color blocks, not stacks of borders; no hover shadows (§5).
- [ ] Scroll areas fade at the edges that can scroll (§6).
- [ ] Component swaps animate; motion is smooth and cheap (§7).
- [ ] Empty, exact skeleton, and error states exist (§8).
- [ ] Icons look centered and evenly spaced (§9).
- [ ] Components follow one alignment line from the anchor (§10).
