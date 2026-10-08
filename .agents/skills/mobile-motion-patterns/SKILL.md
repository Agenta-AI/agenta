---
name: mobile-motion-patterns
description: Motion design rules for the Agenta mobile app (web/mobile) and the @agenta/ui kit — the CSS motion tokens in @agenta/ui/motion.css, the JS presets in src/lib/motion, route transitions, when to animate, and reduced-motion requirements. Use when adding any animation or transition under web/mobile or web/packages, animating navigation, sheets, overlays, skeletons, or list/chat surfaces.
---

# Mobile motion patterns

Motion has one feel everywhere: Apple-style. Things arrive fast and settle softly (a long
ease-out tail, no overshoot) and leave quicker than they came. No antd values or names.

There are two layers, and they share the same curves and durations:

1. **CSS (default).** `@agenta/ui/motion.css` — tokens, kit animations, route transitions.
   Zero JavaScript, runs on the compositor. Use it for anything CSS can express.
2. **JS (`motion`).** `web/mobile/src/lib/motion/presets.ts` via `useMotionPresets()`. Use it
   only for presence/exit of React trees, layout animations, or springs that must carry
   velocity through an interruption.

## CSS tokens (`@agenta/ui/motion.css`)

The tokens use Tailwind v4's own names, so components use stock utilities:

| Token | Utility | Value | Use |
|---|---|---|---|
| `--ease-out` | `ease-out` | `cubic-bezier(0.32, 0.72, 0, 1)` | Enters and moves |
| `--ease-in` | `ease-in` | `cubic-bezier(0.32, 0, 0.67, 0)` | Exits only |
| `--ease-in-out` | `ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | Slides in place (thumb, fill, pane width) |
| `--transition-duration-instant` | `duration-instant` | 100ms | Press feedback |
| `--transition-duration-fast` | `duration-fast` | 160ms | Hover, popovers, menus, tooltips, every exit |
| `--transition-duration-base` | `duration-base` | 240ms | Dialogs, route changes, in-place slides |
| `--transition-duration-slow` | `duration-slow` | 380ms | Sheets and drawers |

A bare `transition` / `transition-colors` uses `duration-fast` + `ease-out` by default.
In plain CSS or inline styles, read the variables: `var(--ease-in-out)`,
`var(--transition-duration-base)`.

```tsx
<div className="transition-[opacity,transform] duration-base ease-out" />
```

Never write a raw `cubic-bezier(...)`, `duration-200`, or `300ms` in a component.

### Named animations and overlays

- Kit Sheet / Dialog / Accordion use `animate-sheet-in-*`, `animate-dialog-in`,
  `animate-overlay-in`, `animate-accordion-*` — all defined in `motion.css`.
- Portalled Radix surfaces (popover, dropdown/context menu, select, tooltip) add the
  `ag-overlay-motion` class: a fade + scale from 96% out of the trigger.
- Buttons scale to 97% on press (`Button` in `@agenta/ui/ui`).

### Route transitions

`useRouteTransition()` (mounted once in `_app.tsx`) starts a native View Transition on every
path change. `AppShell`'s `<main>` carries `ag-screen-transition`: the screen fades in and
rises 6px over the old one; the nav rail holds still. Query-only/shallow changes, reduced
motion, and browsers without the API skip it. Do not add a second element with
`ag-screen-transition` on the same page.

## JS presets (`useMotionPresets()`)

```tsx
import {AnimatePresence, motion} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"

const presets = useMotionPresets()

<AnimatePresence initial={false}>
    {open ? (
        <motion.div key="panel" variants={presets.crossfade} initial="initial" animate="animate" exit="exit" />
    ) : null}
</AnimatePresence>
```

- **`crossfade`** — reply reveal, composer overlays, skeleton → content swaps (geometry must
  match so the fade causes zero layout shift).
- **`sharedAxisPush`**, **`sheetSlideUp`** — defined, not yet used by a screen.
- Springs are `{type: "spring", visualDuration, bounce: 0}`; tweens use `easeOut`, the JS
  mirror of `--ease-out`. Change the CSS and JS values together.

## Rules

- **Animate navigation, containment, and state swaps — not decoration.** No attention-seeking
  motion. Animate `transform`/`opacity` only; height/width only where content must reflow.
- **Reduced motion is not optional.** The CSS tokens collapse to 1ms under
  `prefers-reduced-motion` (1ms, not 0, so Radix still gets `animationend`), so anything timed
  off them is covered. `useMotionPresets()` returns instant variants. A looping CSS animation
  needs its own `@media (prefers-reduced-motion: reduce)` override (see `.animate-composer-ring`).
- **Message entrance/streaming**: subtle — the reply fades in on `crossfade`; text streaming is
  never per-character animated.
- New shared CSS motion goes INTO `motion.css`; new JS presets go INTO `presets.ts` (with a
  reduced variant in `useMotionPresets`). Never into a component file.
- Storybook and `web/oss` use Tailwind v3 and do not load `motion.css`; motion there is
  degraded on purpose. Do not add fallbacks for them.
