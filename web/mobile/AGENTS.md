# Agenta Mobile (`web/mobile`) conventions

Greenfield mobile web app served at `/m` (Next.js Pages Router, `basePath: "/m"`,
standalone output). This is the always-loaded instruction layer for work under
`web/mobile`. The general frontend conventions in `web/AGENTS.md` (Fern client,
state management, React practices) still apply EXCEPT where this file overrides
them — styling and import rules here are deliberately different. Design doc:
`docs/design/agenta-mobile/design.md`.

## Hard rules (lint-enforced — see `eslint.config.mjs`)

- **No antd. Ever.** No `antd`, `@ant-design/*`, `@ant-design/x`, no Lexical.
  UI comes from shadcn/ui components in `src/components/ui/` and (for chat,
  WP3b+) Vercel AI Elements. Icons come from `lucide-react`.
- **No app-layer imports.** Never import `@/oss/*`, `@agenta/oss`, or
  `@agenta/ee`. Data and state come from the `@agenta/*` packages only
  (`@agenta/entities`, `@agenta/shared`, `@agenta/chat` when it exists).
- **One component per file**, exported with a name matching the file name.
- **No slab components.** Pages under `src/pages/` are thin route shells only;
  each feature is a folder of small single-purpose components.

## Structure

```text
web/mobile/src/
  pages/                # thin route shells only (Pages Router)
  features/<feature>/   # SessionCard.tsx, SessionSearchBar.tsx, ... one component per file
    states/             # Skeleton.tsx, Empty.tsx, Error.tsx — designed sibling states
  components/ui/        # shadcn registry components (installed, then owned)
  lib/                  # motion presets, cn util, api glue — no JSX except tiny helpers
  styles/               # globals.css + theme.generated.css (generated, committed)
```

## States are designed, not defaulted

Every screen and every data-bearing component defines loading, empty, error
(and partial, where relevant) states as first-class sibling components in the
feature's `states/` folder. Skeletons mirror the final layout geometry so
content replaces them without shift. Errors carry a retry affordance and never
lose entered state (a failed send never loses the draft).

## Motion

All animation uses the `motion` package through the shared presets in
`src/lib/motion/presets.ts`, consumed via `useMotionPresets()` (reduced-motion
aware). Never hardcode durations, easings, or springs in components. Load the
`mobile-motion-patterns` skill before writing any animation code.

## Styling and theming

- Tailwind v4, CSS-first config in `src/styles/globals.css`. No
  `tailwind.config.*` file exists on purpose.
- Style exclusively with the semantic tokens (`bg-background`,
  `text-muted-foreground`, `border-border`, ...). Never hardcode hex/rgb values
  in components.
- The color source of truth is `web/oss/src/styles/theme/palette.ts`, bridged
  by `scripts/generate-shadcn-tokens.ts` into `src/styles/theme.generated.css`
  (committed, never hand-edited). To change a color: edit `palette.ts` or the
  role map in the script, then run `pnpm --filter @agenta/mobile generate:tokens`.
- Dark mode is class-based (`.dark` on `<html>`), keyed off the same
  `agenta-theme` localStorage value as the desktop app.

## shadcn registry workflow

Install or update registry components with `pnpm dlx shadcn@latest add <name>`
run from `web/mobile/`. Installed components live in `src/components/ui/` and
are owned code — adapt them, but keep diffs from upstream minimal and
token-driven. Load the `mobile-shadcn-conventions` skill for the full workflow.

## Skills to load when working here

- `mobile-app-structure` — feature folders, `states/` convention, data-flow rules.
- `mobile-shadcn-conventions` — registry workflow, theming bridge, AI Elements.
- `mobile-motion-patterns` — shared presets, when to animate, reduced motion.

Also use the plugin skills when relevant: `vercel:nextjs` (Pages Router
specifics), `vercel:shadcn`, `vercel:react-best-practices`.

## Commands (run from `web/`)

- Dev: `pnpm dev-mobile` (→ http://localhost:3000/m)
- Build: `pnpm build-mobile`
- Lint / types: `pnpm --filter @agenta/mobile lint` / `pnpm --filter @agenta/mobile types:check`
- Token bridge: `pnpm --filter @agenta/mobile generate:tokens`
