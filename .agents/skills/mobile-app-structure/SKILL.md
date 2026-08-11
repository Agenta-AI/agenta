---
name: mobile-app-structure
description: Feature-folder layout, states/ convention, and data-flow rules for the Agenta mobile app (web/mobile). Use when creating or moving files under web/mobile, deciding where a component lives, adding a new feature or screen, or wiring data into mobile components.
---

# Mobile app structure

The source of truth for how code is organized in `web/mobile`. Load it before
creating any file there.

## Layout

```text
web/mobile/
  src/
    pages/                    # Pages Router route shells ONLY — no logic, no layout JSX
    features/
      <feature>/              # e.g. sessions/, chat/, auth/, project-drawer/
        <Component>.tsx       # one component per file, named export = file name
        states/               # designed states for this feature
          <X>Skeleton.tsx     # mirrors the final layout geometry (no shift on swap)
          <X>Empty.tsx        # designed empty state with a call to action
          <X>Error.tsx        # error + retry affordance; preserves user input
    components/ui/            # shadcn registry components (see mobile-shadcn-conventions)
    lib/                      # cn util, motion presets, api glue, context resolution
    styles/                   # globals.css, theme.generated.css (generated)
  scripts/                    # generate-shadcn-tokens.ts (token bridge)
```

## Rules

- **Pages are thin shells.** A page file resolves route params and renders one
  feature screen component. Anything else belongs in `features/`.
- **One component per file.** No secondary exported components; small private
  helpers inside a file are fine if they never leave it.
- **Every data-bearing component has designed states.** Before writing the
  happy path, create the `states/` siblings (skeleton, empty, error). A screen
  is not done if any of its states is a browser default or an unstyled string.
- **Data flow:** components get data via hooks from `@agenta/*` packages
  (`@agenta/entities`, `@agenta/shared`, later `@agenta/chat`) or thin fetchers
  in `lib/`. NEVER import `@/oss/*`, `@agenta/oss`, `@agenta/ee` — the mobile
  app has zero app-layer imports (lint enforces this).
- **No provider fleet.** `_app.tsx` stays minimal; add a provider only when a
  concrete feature needs it, scoped as narrowly as possible.

## Adding a new feature (checklist)

1. Create `src/features/<feature>/` with the screen component.
2. Create `states/` siblings for every data-bearing component.
3. Add the route shell in `src/pages/` that renders the screen.
4. Use `useMotionPresets()` for any transitions (see mobile-motion-patterns).
5. `pnpm --filter @agenta/mobile lint && pnpm --filter @agenta/mobile types:check`.
