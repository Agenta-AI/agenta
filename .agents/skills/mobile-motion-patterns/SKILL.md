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

`presets.ts` exports many presets. Read its doc comments for the full list.
The ones screens use most:

- **`crossfade`** and **`crossfadeTransition`**: the reply reveal
  (`features/chat/AnswerReveal.tsx`), the composer overlays
  (`features/chat/Composer.tsx`), and `features/marketplace/`. For skeleton to
  content swaps, skeleton and content must occupy identical geometry so the
  fade causes zero layout shift.
- **`stepSlide`**, **`fadeUp`**, **`expand`**, **`pop`**: onboarding steps and
  rows (`features/onboarding/`). `fadeUp` is also used by
  `features/app/BootLoaderScreen.tsx` and `features/chat/BrowserPreviewSlot.tsx`.
- **`overlayFade`**: `features/app/PostAuthLoader.tsx`. **`tipSwap`** and
  **`breathe`**: `features/app/BootLoaderScreen.tsx`.
- **`digitPop`**: `components/AnimatedNumber.tsx`. **`countUpMs`**:
  `features/wallet/WalletCard.tsx`.
- **`sharedAxisPush`** and **`sheetSlideUp`** exist, but no screen uses them yet.

Reach for these before adding a new preset. Screen navigation has no transition
today. Sheets and drawers (`Sheet` from `@agenta/ui/ui`) animate with their own
Tailwind `animate-in`/`slide-in-*` classes, not with `motion`.

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
