---
name: mobile-motion-patterns
description: Motion design rules for the Agenta mobile app (web/mobile) — the shared presets in src/lib/motion, when to animate, and reduced-motion requirements. Use when adding any animation or transition under web/mobile, animating navigation, sheets, skeletons, or list/chat surfaces.
---

# Mobile motion patterns

All animation in `web/mobile` uses the `motion` package through the shared
presets module `src/lib/motion/presets.ts`. Components never define their own
durations, easings, or springs.

## The presets

Consume via the hook (reduced-motion aware — this is mandatory):

```tsx
import {useMotionPresets} from "@/lib/motion/presets"

const {sharedAxisPush, sheetSlideUp, crossfade, reduced} = useMotionPresets()
```

- **`sharedAxisPush`** — list → chat navigation (and any parent → child screen
  push). Forward uses `custom={1}`, back uses `custom={-1}`; the back
  gesture/button reverses the same preset. Wrap sibling screens in
  `<AnimatePresence custom={direction} initial={false}>`.
- **`sheetSlideUp`** — spring-based bottom sheets (project drawer). Pair with a
  `crossfade` scrim.
- **`crossfade`** — skeleton → content swaps. Skeleton and content must occupy
  identical geometry so the fade causes zero layout shift.

## Rules

- **Animate navigation, containment, and state swaps — not decoration.** No
  attention-seeking motion, no animating properties that trigger layout
  (animate `transform`/`opacity` only).
- **Reduced motion is not optional.** `useMotionPresets()` returns instant
  variants when `prefers-reduced-motion` is set; any animation built outside
  the presets module must justify itself in review AND handle reduced motion
  itself (prefer extending the presets module instead).
- **Message entrance/streaming** (WP3b+): subtle and consistent with the
  playground's feel — entrance is a small fade/rise on the preset tokens; text
  streaming is never per-character animated.
- New shared patterns go INTO `presets.ts` (one exported preset + doc comment),
  not into a component file.
