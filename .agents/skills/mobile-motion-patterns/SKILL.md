---
name: mobile-motion-patterns
description: Motion design rules for the Agenta mobile app (web/mobile) — the shared presets in src/lib/motion, when to animate, and reduced-motion requirements. Use when adding any animation or transition under web/mobile, animating navigation, sheets, skeletons, or list/chat surfaces.
---

# Mobile motion patterns

JS-driven animation in `web/mobile` uses the `motion` package through the shared
presets module `src/lib/motion/presets.ts`. Components never define their own
durations, easings, or springs.

## The presets

Consume via the hook (reduced-motion aware — this is mandatory):

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

In use today:

- **`crossfade`** — the only preset components consume. Used for the reply
  reveal (`features/chat/AnswerReveal.tsx`) and the composer's picker and
  recording overlays (`features/chat/Composer.tsx`). For skeleton → content
  swaps, skeleton and content must occupy identical geometry so the fade causes
  zero layout shift.

Defined but not used by any screen yet:

- **`sharedAxisPush`** — horizontal parent → child push. `custom={1}` forward,
  `custom={-1}` back, inside `<AnimatePresence custom={direction} initial={false}>`.
- **`sheetSlideUp`** — spring-based slide-up for a custom bottom sheet.
- The raw `pushTransition` / `sheetTransition` / `crossfadeTransition` values
  and the `reduced` flag.

Reach for these before adding a new preset. Screen navigation has no transition
today, and sheets and drawers (`Sheet` from `@agenta/ui/ui` or the local
`src/components/ui/sheet.tsx`) animate with their own Tailwind
`animate-in`/`slide-in-*` classes, not with `motion`.

## Rules

- **Animate navigation, containment, and state swaps — not decoration.** No
  attention-seeking motion, no animating properties that trigger layout
  (animate `transform`/`opacity` only).
- **Reduced motion is not optional.** `useMotionPresets()` returns instant
  variants and zero-duration transitions when `prefers-reduced-motion` is set.
  Any animation built outside the presets module must justify itself in review
  AND handle reduced motion itself. CSS keyframe animations need a
  `@media (prefers-reduced-motion: reduce)` override in `globals.css` (see
  `.animate-composer-ring`). Prefer extending the presets module.
- **Message entrance/streaming**: subtle — the reply fades in on `crossfade`;
  text streaming is never per-character animated.
- New shared patterns go INTO `presets.ts` (one exported preset + doc comment,
  plus its reduced variant in `useMotionPresets`), not into a component file.
