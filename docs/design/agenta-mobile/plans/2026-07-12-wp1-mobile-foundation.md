# Agenta Mobile — WP1 Foundation Implementation Plan

> **EXECUTED 2026-07-18 — all 6 phases complete and dual-reviewed** on branch
> `feat/agenta-mobile-wave-1` (commits `1aa915fa`…`40cdf3c1`; see
> [../README.md](../README.md) for the commit/review table). Deviations from this plan as
> written: viewport meta lives in `_app` (Next warns against `_document` placement); Phase 2
> shipped a placeholder `globals.css` so the app compiled pre-Phase-3; the token bridge gained a
> `--check` drift-guard mode chained into mobile `lint` and web `generate:tailwind-tokens`
> (review finding); the role map's dark `accent` is `scales.zinc[2].dark` and dark
> `destructive-foreground` is `componentsDark.Button.primaryColor` (review findings — NOT the
> values written below); eslint additionally bans `lexical`/`@lexical/*` and enforces
> `react-hooks/rules-of-hooks` (plan gaps found in review); the shadcn CLI emits the
> consolidated `radix-ui` dep. Phase 6's image build remains unverified (needs a gh CI run).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal**
Stand up the foundation for the Agenta mobile web app per `docs/design/agenta-mobile/design.md` (WP1 row): (1) the skill/instruction infrastructure first, so every subsequent implementation session works to the same standard; (2) a `web/mobile` Next.js 15.5 Pages Router app mounted at `basePath: "/m"` with standalone output and a proof-of-life page; (3) the greenfield design-system foundation — Tailwind v4 + shadcn/ui CSS variables bridged from the workspace palette source of truth, plus a `motion` presets module; (4) lint tooling that hard-bans `antd`, `@ant-design/*`, and app-layer imports; (5) dev deployment wiring — a `web-mobile` compose service behind Traefik `PathPrefix(/m)` with the `__env.js` runtime-config mechanism. **No auth (WP2), no product pages (WP4), no device gate (WP5).**

**Architecture**
- `web/mobile` is a new pnpm workspace member `@agenta/mobile`, sibling of `oss`/`ee`, built with its own turbo task graph (no package deps in WP1 — it consumes `@agenta/*` packages starting WP2+). It is edition-agnostic: one app serves OSS and EE.
- Mounting is path-based: the app is built with `basePath: "/m"`; Traefik routes `` PathPrefix(`/m`) `` to it (auto-wins over the web catch-all `` PathPrefix(`/`) `` by rule length; no stripprefix).
- Theming: `web/oss/src/styles/theme/palette.ts` stays the single source of truth. A small generator (`web/mobile/scripts/generate-shadcn-tokens.ts`, modeled on `web/scripts/generate-tailwind-tokens.ts`) maps palette roles → shadcn CSS variables for `:root` and `.dark`, emitting a committed `theme.generated.css`. Dark mode uses the same `agenta-theme` localStorage key + pre-paint init script as the desktop `_document`, so the theme follows the user across `/m` and the desktop app.
- Runtime config: `web/entrypoint.sh` (shared by dev and gh images) gains a guarded block that mirrors the generated `__env.js` into `mobile/public/`, served at `/m/__env.js` (basePath applies to public assets).
- Instruction layering follows the repo model (root `AGENTS.md` → nested `web/mobile/AGENTS.md` + `CLAUDE.md` symlink → skills in `.agents/skills/` symlinked into `.claude/skills/`).

**Tech Stack**
Next.js `15.5.18` (workspace pin, enforced by the `next@<15.5.18 → >=15.5.18` pnpm override in `web/package.json`), React `^19`, TypeScript `^5.9`, Tailwind CSS v4 (`@tailwindcss/postcss`, CSS-first config — the latest toolchain shadcn supports), shadcn/ui (registry workflow, `new-york` style, CSS variables), `motion` `^12` (same major as OSS), ESLint 9 flat config + Prettier (repo `web/.prettierrc` applies by upward resolution — no new prettier config), pnpm `11.1.2` + turbo `2.8.20`, Docker Compose + Traefik v2.

**Conventions for all commit steps:** run `git branch --show-current` first — if it prints `gitbutler/workspace`, this repo is in GitButler workspace mode and you must use `but branch new <lane>` / `but commit <lane> -m "..."` per root `AGENTS.md`; the commands below assume plain git on a feature branch (e.g. `mobile/wp1-foundation`). Never include Claude/Anthropic/Co-Authored-By lines in commit messages. All commands run from the repo root unless a `cd` is shown. Before every commit step that touches frontend files, run `cd web && pnpm lint-fix` (the repo-wide convention in `web/AGENTS.md`) — a package-local ESLint run is not a substitute, because the format check in CI runs over the whole `web` tree.

---

## Phase 1 — Skill and instruction infrastructure

### Task 1.1 — Create `web/mobile/AGENTS.md`

- [ ] Create the directory and file `web/mobile/AGENTS.md` with exactly this content:

````markdown
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
````

### Task 1.2 — Symlink `web/mobile/CLAUDE.md`

- [ ] Create the symlink (same pattern as `web/CLAUDE.md → AGENTS.md`):
  ```bash
  ln -s AGENTS.md web/mobile/CLAUDE.md
  ```
- [ ] Verify: `ls -la web/mobile/CLAUDE.md` → shows `CLAUDE.md -> AGENTS.md`.

### Task 1.3 — Create skill `mobile-app-structure`

- [ ] Create `.agents/skills/mobile-app-structure/SKILL.md` with exactly this content (frontmatter format matches `.agents/skills/agenta-package-practices/SKILL.md`):

````markdown
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
````

### Task 1.4 — Create skill `mobile-shadcn-conventions`

- [ ] Create `.agents/skills/mobile-shadcn-conventions/SKILL.md` with exactly this content:

````markdown
---
name: mobile-shadcn-conventions
description: How the Agenta mobile app (web/mobile) installs and extends shadcn/ui registry components, themes them via the palette token bridge, and uses Vercel AI Elements. Use when adding UI components under web/mobile, changing theme colors, editing components.json or globals.css, or building chat UI with AI Elements.
---

# Mobile shadcn conventions

`web/mobile` uses shadcn/ui on Tailwind v4 with CSS variables. No antd, ever.

## Installing registry components

- Always install via the CLI from `web/mobile/`:
  `pnpm dlx shadcn@latest add <component>` (e.g. `button`, `sheet`, `dialog`,
  `command`, `skeleton`, `input`).
- Components land in `src/components/ui/` (aliases in `components.json`). They
  are owned code: you may adapt them, but keep diffs minimal and expressed in
  semantic tokens so upstream refreshes stay cheap.
- The CLI adds any peer deps (e.g. `@radix-ui/react-slot`) to
  `web/mobile/package.json` — commit the manifest and `web/pnpm-lock.yaml`
  changes together with the component.
- Never copy component source from the shadcn website by hand; the CLI resolves
  the Tailwind v4 variant correctly.

## Theming — the token bridge

- shadcn variables (`--background`, `--primary`, ...) are NOT hand-maintained.
  They are generated into `src/styles/theme.generated.css` from
  `web/oss/src/styles/theme/palette.ts` by `scripts/generate-shadcn-tokens.ts`.
- To change a color: edit `palette.ts` (if the design-system value is wrong) or
  the ROLE MAP in the script (if the mapping is wrong), then run
  `pnpm --filter @agenta/mobile generate:tokens` and commit the regenerated CSS.
- Never edit `theme.generated.css` directly; never introduce raw hex values in
  components — if a needed role is missing, extend the bridge.
- Dark mode is the `.dark` class on `<html>` (`@custom-variant dark` in
  `globals.css`), set pre-paint by the `_document.tsx` init script from the
  shared `agenta-theme` localStorage key. Both themes must be checked for every
  new surface.

## Extending components

- Wrap, don't fork: feature-specific variants live in `src/features/*` as thin
  wrappers over `components/ui/*` primitives (cva variants where appropriate).
- Use the `cn` util from `@/lib/utils` for all class merging.

## Vercel AI Elements (chat render layer, WP3b+)

- AI Elements are shadcn registry components; install them the same way
  (`pnpm dlx shadcn@latest add <ai-elements registry item>`), landing in
  `src/components/ui/` / `src/components/ai-elements/` per the registry config.
- They are the base of the chat skin (Conversation, Message, Response,
  Reasoning, Tool, PromptInput); behavior comes from `@agenta/chat` hooks —
  never re-implement orchestration inside a rendered component.
````

### Task 1.5 — Create skill `mobile-motion-patterns`

- [ ] Create `.agents/skills/mobile-motion-patterns/SKILL.md` with exactly this content:

````markdown
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
````

### Task 1.6 — Symlink skills into `.claude/skills/` and commit

- [ ] Create the three symlinks (same relative-target pattern as the existing `agenta-package-practices` symlink):
  ```bash
  ln -s ../../.agents/skills/mobile-app-structure .claude/skills/mobile-app-structure
  ln -s ../../.agents/skills/mobile-shadcn-conventions .claude/skills/mobile-shadcn-conventions
  ln -s ../../.agents/skills/mobile-motion-patterns .claude/skills/mobile-motion-patterns
  ```
- [ ] Verify: `ls -la .claude/skills/ | grep mobile` → three lines, each `... -> ../../.agents/skills/mobile-...`.
- [ ] Verify frontmatter parses: `head -4 .agents/skills/mobile-app-structure/SKILL.md` → shows `---`, `name: mobile-app-structure`, `description: ...`.
- [ ] Commit:
  ```bash
  git add web/mobile/AGENTS.md web/mobile/CLAUDE.md .agents/skills/mobile-* .claude/skills/mobile-*
  git commit -m "docs(mobile): add agent instructions and skills for the mobile app"
  ```

---

## Phase 2 — `web/mobile` app scaffold and workspace wiring

### Task 2.1 — Add `mobile` to the pnpm workspace

- [ ] Edit `web/pnpm-workspace.yaml`: in the `packages:` list, add `- 'mobile'` after `- 'ee'`:
  ```yaml
  packages:
    - 'oss'
    - 'ee'
    - 'mobile'
    - 'tests'
    - 'packages/*'
  ```

### Task 2.2 — Wire `web/package.json` (workspaces + turbo filter scripts)

- [ ] In `web/package.json`, add `"mobile"` to the `workspaces` array (after `"ee"`):
  ```json
  "workspaces": ["ee", "oss", "mobile", "tests", "variants-state", "packages/*"],
  ```
- [ ] In the same file's `scripts`, add (next to `build-oss`/`dev-oss`):
  ```json
  "build-mobile": "turbo run build --filter=@agenta/mobile",
  "dev-mobile": "turbo run dev --filter=@agenta/mobile",
  ```

### Task 2.3 — Add turbo tasks for `@agenta/mobile`

- [ ] In `web/turbo.json`, add these three task entries inside `"tasks"` (place after `"@agenta/ee#build"`; the generic `dev` task already covers `pnpm dev-mobile`):
  ```json
  "@agenta/mobile#build": {
      "inputs": [
          "src/**",
          "public/**",
          "next.config.ts",
          "postcss.config.mjs",
          "$TURBO_DEFAULT$",
          "!tests/**",
          "!**/*.md"
      ],
      "outputs": [".next/**", "!.next/cache/**"],
      "env": ["NODE_ENV", "NEXT_PUBLIC_*"]
  },
  "@agenta/mobile#lint": {
      "inputs": ["src/**/*.ts", "src/**/*.tsx", "eslint.config.*"],
      "outputs": []
  },
  "@agenta/mobile#types:check": {
      "inputs": ["src/**", "next.config.ts", "tsconfig.json"],
      "outputs": []
  },
  ```
  Note: no `dependsOn` — WP1 mobile has zero `@agenta/*` package deps; add them when WP2+ introduces package imports.

### Task 2.4 — Create `web/mobile/package.json`

- [ ] Create `web/mobile/package.json` with exactly this content (Next pinned to the workspace `15.5.18`; `lucide-react`/`motion`/`typescript`/`@types/*` match `web/oss/package.json` versions so pnpm dedupes; the `build` script mirrors `@agenta/oss`'s standalone copy step — with `outputFileTracingRoot: ".."` the standalone server lands at `.next/standalone/mobile/server.js`):
  ```json
  {
      "name": "@agenta/mobile",
      "version": "0.1.0",
      "private": true,
      "engines": {
          "node": "24.x"
      },
      "scripts": {
          "dev": "next dev --turbopack",
          "build": "next build && cp -r public/. .next/standalone/mobile/public && cp -r .next/static .next/standalone/mobile/.next",
          "start": "next start",
          "lint": "eslint src",
          "lint:fix": "eslint src --fix",
          "format": "prettier --check .",
          "format-fix": "prettier --write .",
          "types:check": "tsc",
          "generate:tokens": "tsx scripts/generate-shadcn-tokens.ts"
      },
      "dependencies": {
          "class-variance-authority": "^0.7.1",
          "clsx": "^2.1.1",
          "lucide-react": "^0.479.0",
          "motion": "^12.0.0",
          "next": "15.5.18",
          "react": "^19.0.0",
          "react-dom": "^19.0.0",
          "tailwind-merge": "^3.3.1"
      },
      "devDependencies": {
          "@eslint/js": "^9.39.4",
          "@tailwindcss/postcss": "^4.1.0",
          "@types/node": "^20.19.20",
          "@types/react": "^19.0.10",
          "@types/react-dom": "^19.0.4",
          "eslint": "^9.39.4",
          "eslint-config-prettier": "^10.1.8",
          "eslint-plugin-import": "^2.32.0",
          "eslint-plugin-prettier": "^5.5.6",
          "prettier": "^3.7.4",
          "tailwindcss": "^4.1.0",
          "tsx": "^4.22.4",
          "tw-animate-css": "^1.4.0",
          "typescript": "^5.9.3",
          "typescript-eslint": "^8.61.0"
      }
  }
  ```

### Task 2.5 — Create `tsconfig.json`, `next-env.d.ts`, `.gitignore`

- [ ] Create `web/mobile/tsconfig.json` (mirrors `web/oss/tsconfig.json` conventions; the `@/*` path is what `components.json` aliases and the shadcn CLI resolve against):
  ```json
  {
      "compilerOptions": {
          "target": "esnext",
          "lib": ["dom", "dom.iterable", "esnext"],
          "allowJs": true,
          "skipLibCheck": true,
          "strict": true,
          "forceConsistentCasingInFileNames": true,
          "noEmit": true,
          "esModuleInterop": true,
          "module": "esnext",
          "moduleResolution": "bundler",
          "resolveJsonModule": true,
          "isolatedModules": true,
          "jsx": "preserve",
          "incremental": true,
          "baseUrl": ".",
          "paths": {
              "@/*": ["src/*"]
          }
      },
      "include": ["next-env.d.ts", "**/*.d.ts", "**/*.ts", "**/*.tsx"],
      "exclude": ["node_modules"]
  }
  ```
- [ ] Create `web/mobile/next-env.d.ts` (Next regenerates this; committing it keeps `tsc` green before first dev run):
  ```ts
  /// <reference types="next" />
  /// <reference types="next/image-types/global" />

  // NOTE: This file should not be edited
  // see https://nextjs.org/docs/pages/api-reference/config/typescript for more information.
  ```
- [ ] Create `web/mobile/.gitignore`:
  ```gitignore
  .next/
  .turbo/
  tsconfig.tsbuildinfo
  # runtime config written by web/entrypoint.sh (dev mounts this dir from the host)
  public/__env.js
  ```

### Task 2.6 — Create `next.config.ts` and `postcss.config.mjs`

- [ ] Create `web/mobile/next.config.ts`:
  ```ts
  import path from "path"

  import type {NextConfig} from "next"

  const isDevelopment = process.env.NODE_ENV === "development"

  const nextConfig: NextConfig = {
      // Path mount: Traefik routes PathPrefix(`/m`) here with NO stripprefix —
      // the app itself owns the prefix (assets, links, and routes all under /m).
      basePath: "/m",
      output: "standalone",
      reactStrictMode: true,
      pageExtensions: ["ts", "tsx"],
      productionBrowserSourceMaps: true,
      // Workspace root, so standalone output nests as .next/standalone/mobile/
      // (same pattern as web/oss).
      outputFileTracingRoot: path.resolve(__dirname, ".."),
      // Same policy as web/oss: lint/type gates run as dedicated turbo tasks,
      // not inside `next build`.
      eslint: {
          ignoreDuringBuilds: true,
      },
      typescript: {
          ignoreBuildErrors: true,
      },
      async headers() {
          return [
              {
                  // `__env.js` is per-deployment RUNTIME config (regenerated on each
                  // container start by web/entrypoint.sh), not an immutable build
                  // asset — force it uncacheable. `source` is basePath-relative,
                  // so this matches /m/__env.js. Mirrors web/oss/next.config.ts.
                  source: "/__env.js",
                  headers: [{key: "Cache-Control", value: "no-store, must-revalidate"}],
              },
          ]
      },
      ...(isDevelopment
          ? {
                turbopack: {
                    root: path.resolve(__dirname, ".."),
                },
            }
          : {}),
  }

  export default nextConfig
  ```
- [ ] Create `web/mobile/postcss.config.mjs` (Tailwind v4 uses its own PostCSS plugin; no autoprefixer needed):
  ```js
  /** @type {import('postcss-load-config').Config} */
  const config = {
      plugins: {
          "@tailwindcss/postcss": {},
      },
  }

  export default config
  ```

### Task 2.7 — Create `_document.tsx`, `_app.tsx`, proof-of-life index page, and `public/`

- [ ] Create `web/mobile/src/pages/_document.tsx` (theme init script is byte-identical to `web/oss/src/pages/_document.tsx` so the theme choice is shared across apps; the `__env.js` script src must carry the basePath explicitly — `next/script` does not auto-prefix):
  ```tsx
  import {Html, Head, Main, NextScript} from "next/document"
  import Script from "next/script"

  // Runs synchronously before paint to apply the persisted theme, preventing a
  // flash of the wrong theme on load. Same localStorage key as the desktop app
  // ("agenta-theme", JSON-encoded by usehooks-ts, default "system") so the
  // user's theme follows them between /m and the desktop app.
  const themeInitScript = `(function(){try{var r=localStorage.getItem('agenta-theme');var m=r?(r.charAt(0)==='"'?JSON.parse(r):r):'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}}catch(e){}})();`

  export default function Document() {
      return (
          <Html lang="en" className="antialiased">
              <Head>
                  <script dangerouslySetInnerHTML={{__html: themeInitScript}} />
              </Head>
              <body>
                  <Main />
                  <NextScript />
                  {/* Runtime config written by web/entrypoint.sh on container start.
                      basePath is NOT auto-applied to next/script src, hence "/m". */}
                  <Script src="/m/__env.js" strategy="beforeInteractive" />
              </body>
          </Html>
      )
  }
  ```
- [ ] Create `web/mobile/src/pages/_app.tsx`. **Note a deliberate deviation from the WP1 brief:** the brief says "viewport meta in `_document`", but Next.js Pages Router explicitly warns against viewport meta in `_document`'s `<Head>` (dev warning + `@next/next/no-document-viewport-meta`); the documented location is `_app` via `next/head` — the requirement (the mobile app ships a viewport meta; the desktop app ships none) is met either way:
  ```tsx
  import type {AppProps} from "next/app"
  import Head from "next/head"

  import "@/styles/globals.css"

  // Deliberately minimal: no provider fleet (the desktop _app's ~10 providers
  // are the reason this app exists as a separate bundle). Providers are added
  // per concern when a feature needs them (auth/session first, in WP2).
  export default function App({Component, pageProps}: AppProps) {
      return (
          <>
              <Head>
                  <meta
                      name="viewport"
                      content="width=device-width, initial-scale=1, viewport-fit=cover"
                  />
              </Head>
              <Component {...pageProps} />
          </>
      )
  }
  ```
- [ ] Create `web/mobile/src/pages/index.tsx`:
  ```tsx
  import Head from "next/head"

  // Placeholder route shell: proves the scaffold end to end (basePath, Tailwind
  // v4, palette-bridged tokens, dark mode). Replaced in WP2 by context
  // resolution (last-used workspace/project) + redirect to the sessions list.
  export default function Home() {
      return (
          <>
              <Head>
                  <title>Agenta Mobile</title>
              </Head>
              <main className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-background p-6 text-foreground">
                  <h1 className="text-2xl font-semibold">Agenta Mobile</h1>
                  <p className="text-muted-foreground text-sm">
                      Foundation scaffold is alive under <code>/m</code>.
                  </p>
              </main>
          </>
      )
  }
  ```
- [ ] Create `web/mobile/public/.gitkeep` (empty file — the dir must exist for the `build` copy step and the entrypoint `__env.js` mirror).

### Task 2.8 — Install and verify workspace resolution

- [ ] Run:
  ```bash
  cd web && pnpm install
  ```
  Expected: exits 0; output includes the workspace scan picking up the new project; `git status` shows `web/pnpm-lock.yaml` modified with a new `mobile:` importer block (`git diff web/pnpm-lock.yaml | grep -A2 "mobile:"`).
- [ ] Verify the filter resolves:
  ```bash
  cd web && pnpm --filter @agenta/mobile exec node -e "console.log('mobile ok')"
  ```
  Expected output: `mobile ok`.

### Task 2.9 — Commit the scaffold

- [ ] ```bash
  git add web/pnpm-workspace.yaml web/package.json web/turbo.json web/pnpm-lock.yaml web/mobile
  git commit -m "feat(mobile): scaffold @agenta/mobile Next.js app mounted at /m"
  ```

---

## Phase 3 — Design-system foundation (shadcn + token bridge + motion)

### Task 3.1 — Create `components.json`

- [ ] Create `web/mobile/components.json` (Tailwind v4 style: `tailwind.config` is empty; `rsc` false — Pages Router):
  ```json
  {
      "$schema": "https://ui.shadcn.com/schema.json",
      "style": "new-york",
      "rsc": false,
      "tsx": true,
      "tailwind": {
          "config": "",
          "css": "src/styles/globals.css",
          "baseColor": "neutral",
          "cssVariables": true,
          "prefix": ""
      },
      "iconLibrary": "lucide",
      "aliases": {
          "components": "@/components",
          "utils": "@/lib/utils",
          "ui": "@/components/ui",
          "lib": "@/lib",
          "hooks": "@/hooks"
      }
  }
  ```

### Task 3.2 — Create the `cn` util

- [ ] Create `web/mobile/src/lib/utils.ts`:
  ```ts
  import {clsx, type ClassValue} from "clsx"
  import {twMerge} from "tailwind-merge"

  export function cn(...inputs: ClassValue[]) {
      return twMerge(clsx(inputs))
  }
  ```

### Task 3.3 — Create `globals.css` (Tailwind v4, CSS-first)

- [ ] Create `web/mobile/src/styles/globals.css`:
  ```css
  @import "tailwindcss";
  @import "tw-animate-css";

  /* Palette-derived shadcn variables (light + dark), GENERATED from
     web/oss/src/styles/theme/palette.ts — do not edit by hand.
     Regenerate: pnpm --filter @agenta/mobile generate:tokens */
  @import "./theme.generated.css";

  /* Class-based dark mode: .dark is set on <html> pre-paint by _document.tsx. */
  @custom-variant dark (&:is(.dark *));

  :root {
      --radius: 0.625rem;
  }

  @theme inline {
      --color-background: var(--background);
      --color-foreground: var(--foreground);
      --color-card: var(--card);
      --color-card-foreground: var(--card-foreground);
      --color-popover: var(--popover);
      --color-popover-foreground: var(--popover-foreground);
      --color-primary: var(--primary);
      --color-primary-foreground: var(--primary-foreground);
      --color-secondary: var(--secondary);
      --color-secondary-foreground: var(--secondary-foreground);
      --color-muted: var(--muted);
      --color-muted-foreground: var(--muted-foreground);
      --color-accent: var(--accent);
      --color-accent-foreground: var(--accent-foreground);
      --color-destructive: var(--destructive);
      --color-destructive-foreground: var(--destructive-foreground);
      --color-border: var(--border);
      --color-input: var(--input);
      --color-ring: var(--ring);
      --radius-sm: calc(var(--radius) - 4px);
      --radius-md: calc(var(--radius) - 2px);
      --radius-lg: var(--radius);
      --radius-xl: calc(var(--radius) + 4px);
  }

  @layer base {
      * {
          @apply border-border outline-ring/50;
      }
      body {
          @apply bg-background text-foreground;
      }
  }
  ```

### Task 3.4 — Create the token-bridge generator

- [ ] Create `web/mobile/scripts/generate-shadcn-tokens.ts` (same source-of-truth discipline as `web/scripts/generate-tailwind-tokens.ts`: `palette.ts` is the only color input; `palette.ts` itself is a pure-data module with no imports, so a relative import from a sibling workspace is safe under `tsx`):
  ```ts
  /**
   * generate-shadcn-tokens.ts — bridge the workspace theme source of truth
   * (web/oss/src/styles/theme/palette.ts) into shadcn/ui CSS variables for the
   * mobile app, light + dark.
   *
   * Follows the pattern of web/scripts/generate-tailwind-tokens.ts: palette.ts
   * is the ONLY color input; this file only chooses which palette role feeds
   * which shadcn variable. The output (src/styles/theme.generated.css) is
   * committed and must never be edited by hand — change palette.ts or the ROLE
   * MAP below and rerun.
   *
   * Run (from web/mobile): pnpm generate:tokens
   */
  import {writeFileSync} from "fs"
  import {dirname, resolve} from "path"
  import {fileURLToPath} from "url"

  import {palette, type ColorValue} from "../../oss/src/styles/theme/palette"

  const HERE = dirname(fileURLToPath(import.meta.url)) // web/mobile/scripts
  const OUT = resolve(HERE, "../src/styles/theme.generated.css")

  /** Palette values are plain color strings except antd() shadow refs (never used here). */
  const color = (v: ColorValue): string => {
      if (typeof v !== "string") {
          throw new Error(`Palette value is an antd() ref, not a color: ${JSON.stringify(v)}`)
      }
      return v
  }

  const p = palette

  // ROLE MAP — which palette role feeds which shadcn variable. The single place
  // to retune the bridge. Values are [light, dark].
  const VARS: Record<string, [string, string]> = {
      background: [color(p.surface.base.light), color(p.surface.base.dark)],
      foreground: [color(p.text.primary.light), color(p.text.primary.dark)],
      card: [color(p.surface.container.light), color(p.surface.container.dark)],
      "card-foreground": [color(p.text.primary.light), color(p.text.primary.dark)],
      popover: [color(p.surface.elevated.light), color(p.surface.elevated.dark)],
      "popover-foreground": [color(p.text.primary.light), color(p.text.primary.dark)],
      primary: [color(p.accent.primary.light), color(p.accent.primary.dark)],
      // Light primary is brand navy → white text; dark primary is brand yellow →
      // dark text (mirrors componentsDark.Button.primaryColor in palette.ts).
      "primary-foreground": [color(p.surface.white.light), p.componentsDark.Button.primaryColor],
      secondary: [color(p.scales.zinc[1].light), color(p.scales.zinc[1].dark)],
      "secondary-foreground": [color(p.text.primary.light), color(p.text.primary.dark)],
      muted: [color(p.scales.zinc[1].light), color(p.scales.zinc[1].dark)],
      "muted-foreground": [color(p.text.secondary.light), color(p.text.secondary.dark)],
      accent: [
          color(p.surface.controlItemBgActive.light),
          // Review delta: the palette's dark controlItemBgActive reads olive against the
          // mobile surface; zinc[2] is the neutral the dark theme actually wants.
          color(p.scales.zinc[2].dark),
      ],
      "accent-foreground": [color(p.text.primary.light), color(p.text.primary.dark)],
      destructive: [color(p.semantic.error.light), color(p.semantic.error.dark)],
      // Review delta: pure white on the dark destructive fill was too hot; the antd dark
      // button primary colour is the value the rest of the dark theme uses.
      "destructive-foreground": [color(p.surface.white.light), p.componentsDark.Button.primaryColor],
      border: [color(p.border.secondary.light), color(p.border.secondary.dark)],
      input: [color(p.border.default.light), color(p.border.default.dark)],
      ring: [color(p.accent.primary.light), color(p.accent.primary.dark)],
  }

  const block = (selector: string, side: 0 | 1) =>
      `${selector} {\n${Object.entries(VARS)
          .map(([name, pair]) => `    --${name}: ${pair[side]};`)
          .join("\n")}\n}\n`

  const css = `/* GENERATED by scripts/generate-shadcn-tokens.ts — DO NOT EDIT.
   * Source of truth: web/oss/src/styles/theme/palette.ts
   * Regenerate: pnpm --filter @agenta/mobile generate:tokens
   */
  ${block(":root", 0)}
  ${block(".dark", 1)}`

  writeFileSync(OUT, css)
  console.log(`wrote ${OUT}`)
  ```

### Task 3.5 — Run the bridge and verify output

- [ ] Run:
  ```bash
  cd web && pnpm --filter @agenta/mobile generate:tokens
  ```
  Expected output: `wrote /…/web/mobile/src/styles/theme.generated.css`.
- [ ] Verify content: `grep -E -- "--primary:|--destructive:" web/mobile/src/styles/theme.generated.css` → shows `--primary: #1c2c3d;` (in `:root`), `--primary: #f2f25c;` (in `.dark`), `--destructive: #d61010;` / `--destructive: #ff4d4f;` — matching `palette.ts` `accent.primary` and `semantic.error`.

### Task 3.6 — Create the motion presets module

- [ ] Create `web/mobile/src/lib/motion/presets.ts`:
  ```ts
  /**
   * Shared motion presets — the ONLY place transition values live in this app.
   * Components consume presets via useMotionPresets() (reduced-motion aware);
   * they never define their own durations, easings, or springs.
   * See the mobile-motion-patterns skill for usage rules.
   */
  import {useReducedMotion} from "motion/react"
  import type {Transition, Variants} from "motion/react"

  /** Spring for screen-level shared-axis pushes (list → chat). */
  export const pushTransition: Transition = {
      type: "spring",
      stiffness: 380,
      damping: 38,
      mass: 1,
  }

  /** Spring for bottom/side sheets (project drawer). */
  export const sheetTransition: Transition = {
      type: "spring",
      stiffness: 300,
      damping: 32,
      mass: 0.9,
  }

  /** Tween for skeleton → content crossfades (no layout jump). */
  export const crossfadeTransition: Transition = {
      duration: 0.18,
      ease: "easeOut",
  }

  /**
   * Shared-axis horizontal push. `custom` is the direction: +1 forward
   * (list → chat), -1 back. Use inside <AnimatePresence custom={direction}>.
   */
  export const sharedAxisPush: Variants = {
      initial: (direction: number) => ({x: `${direction * 30}%`, opacity: 0}),
      animate: {x: 0, opacity: 1, transition: pushTransition},
      exit: (direction: number) => ({
          x: `${direction * -30}%`,
          opacity: 0,
          transition: pushTransition,
      }),
  }

  /** Spring-based sheet slide-up (project drawer, bottom sheets). */
  export const sheetSlideUp: Variants = {
      initial: {y: "100%"},
      animate: {y: 0, transition: sheetTransition},
      exit: {y: "100%", transition: sheetTransition},
  }

  /** Crossfade for skeleton → content swaps (geometry must match). */
  export const crossfade: Variants = {
      initial: {opacity: 0},
      animate: {opacity: 1, transition: crossfadeTransition},
      exit: {opacity: 0, transition: crossfadeTransition},
  }

  /** Instant variants used when the user prefers reduced motion. */
  const instant: Variants = {
      initial: {opacity: 0},
      animate: {opacity: 1, transition: {duration: 0}},
      exit: {opacity: 0, transition: {duration: 0}},
  }

  export interface MotionPresets {
      reduced: boolean
      sharedAxisPush: Variants
      sheetSlideUp: Variants
      crossfade: Variants
  }

  /**
   * Reduced-motion-aware presets. ALWAYS consume presets through this hook in
   * components; import the raw variants above only in tests.
   */
  export function useMotionPresets(): MotionPresets {
      const reduced = useReducedMotion() ?? false
      return reduced
          ? {reduced, sharedAxisPush: instant, sheetSlideUp: instant, crossfade: instant}
          : {reduced, sharedAxisPush, sheetSlideUp, crossfade}
  }
  ```

### Task 3.7 — Proof-of-life verification (dev server)

- [ ] Run the dev server (ensure the OSS app is not already occupying port 3000):
  ```bash
  cd web && pnpm --filter @agenta/mobile dev
  ```
  Expected output includes: `▲ Next.js 15.5.18 (Turbopack)` and `✓ Ready in …`.
- [ ] In a second shell:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/m        # → 200
  curl -s http://localhost:3000/m | grep -o "Agenta Mobile" | head -1     # → Agenta Mobile
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/         # → 404 (basePath owns /m only)
  ```
- [ ] Open http://localhost:3000/m in a browser, toggle OS dark mode (or run `localStorage.setItem('agenta-theme','"dark"')` + reload): background flips `#ffffff` → `#000000`, text stays legible (tokens from the bridge). Stop the dev server.

### Task 3.8 — Verify the shadcn registry workflow

- [ ] From `web/mobile`, install two starter components via the CLI (this is the canonical workflow the `mobile-shadcn-conventions` skill documents; the CLI will also add `@radix-ui/react-slot` to `package.json` — expected):
  ```bash
  cd web/mobile && pnpm dlx shadcn@latest add button skeleton
  ```
  Expected: CLI reports it found `components.json`, and creates `src/components/ui/button.tsx` and `src/components/ui/skeleton.tsx`.
- [ ] Verify (still inside `web/mobile` from the previous step): `ls src/components/ui/` → `button.tsx  skeleton.tsx`; `git diff package.json` shows the added radix dep; `git diff ../pnpm-lock.yaml` shows the lockfile updated.

### Task 3.9 — Commit the design-system foundation

- [ ] ```bash
  git add web/mobile web/pnpm-lock.yaml
  git commit -m "feat(mobile): add shadcn foundation, palette token bridge, and motion presets"
  ```

---

## Phase 4 — Lint and tooling

### Task 4.1 — Create the ESLint flat config with import bans

- [ ] Create `web/mobile/eslint.config.mjs` (mirrors the mechanism of `web/packages/eslint.config.mjs` — flat config, tseslint + import-order + prettier, package-strict `no-explicit-any` — minus the Lexical/Next compat layers, plus the mobile hard bans):
  ```js
  /**
   * ESLint config for @agenta/mobile.
   *
   * Mirrors web/packages/eslint.config.mjs (flat config: tseslint + import
   * order + prettier, strict no-explicit-any) and adds the mobile hard bans:
   * no antd, no @ant-design/*, no app-layer imports (@/oss/*, @agenta/oss,
   * @agenta/ee). See web/mobile/AGENTS.md.
   */
  import eslint from "@eslint/js"
  import importPlugin from "eslint-plugin-import"
  import eslintPluginPrettier from "eslint-plugin-prettier/recommended"
  import tseslint from "typescript-eslint"

  const includePrettierRule = process.env.DISABLE_PRETTIER !== "true"

  const config = [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      {
          plugins: {
              import: importPlugin,
          },
          rules: {
              "no-restricted-imports": [
                  "error",
                  {
                      patterns: [
                          {
                              group: ["antd", "antd/*"],
                              message:
                                  "antd is banned in web/mobile. Use shadcn/ui components (src/components/ui) instead.",
                          },
                          {
                              group: ["@ant-design/*"],
                              message:
                                  "@ant-design/* is banned in web/mobile. Use shadcn/ui + lucide-react instead.",
                          },
                          {
                              group: [
                                  "@/oss/*",
                                  "@agenta/oss",
                                  "@agenta/oss/*",
                                  "@agenta/ee",
                                  "@agenta/ee/*",
                              ],
                              message:
                                  "web/mobile never imports app-layer code. Consume @agenta/* packages only.",
                          },
                      ],
                  },
              ],
              "@typescript-eslint/no-explicit-any": "error",
              "@typescript-eslint/no-empty-object-type": "off",
              "@typescript-eslint/ban-ts-comment": "off",
              "@typescript-eslint/no-unused-vars": [
                  "error",
                  {
                      vars: "all",
                      args: "none",
                      caughtErrors: "none",
                      ignoreRestSiblings: true,
                      destructuredArrayIgnorePattern: "none",
                      varsIgnorePattern: "^_|^_.*",
                  },
              ],
              "import/order": [
                  "error",
                  {
                      alphabetize: {
                          order: "asc",
                          caseInsensitive: true,
                      },
                      "newlines-between": "always",
                      groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
                      pathGroupsExcludedImportTypes: ["react"],
                      pathGroups: [
                          {
                              pattern: "react",
                              group: "builtin",
                              position: "before",
                          },
                          {
                              pattern: "@/**",
                              group: "internal",
                          },
                      ],
                  },
              ],
              ...(includePrettierRule
                  ? {
                        "prettier/prettier": [
                            "error",
                            {
                                printWidth: 100,
                                tabWidth: 4,
                                useTabs: false,
                                semi: false,
                                bracketSpacing: false,
                            },
                        ],
                    }
                  : {}),
          },
      },
      ...(includePrettierRule ? [eslintPluginPrettier] : []),
      {
          ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
      },
  ]

  export default config
  ```
  Note: Prettier formatting inherits `web/.prettierrc` (config resolution walks up) — do not create a mobile prettier config.

### Task 4.2 — Lint passes clean

- [ ] ```bash
  cd web && pnpm --filter @agenta/mobile lint
  ```
  Expected: exit 0, no errors (the shadcn-generated `button.tsx`/`skeleton.tsx` may need a one-time `pnpm --filter @agenta/mobile lint:fix` for import order/prettier — run it and re-lint if so).

### Task 4.3 — Import-ban canary (deliberate failure)

- [ ] Temporarily add to the top of `web/mobile/src/pages/index.tsx`:
  ```ts
  import {Button} from "antd"
  ```
- [ ] Run `cd web && pnpm --filter @agenta/mobile lint`. Expected: **exit 1** with:
  ```
  error  'antd' import is restricted from being used by a pattern.
  antd is banned in web/mobile. Use shadcn/ui components (src/components/ui) instead.  no-restricted-imports
  ```
- [ ] Repeat once with `import x from "@/oss/lib/helpers"` — expected failure citing the app-layer ban.
- [ ] Remove the canary imports; re-run lint → exit 0.

### Task 4.4 — Types check and production build

- [ ] ```bash
  cd web && pnpm --filter @agenta/mobile types:check
  ```
  Expected: exit 0.
- [ ] ```bash
  cd web && pnpm build-mobile
  ```
  Expected: turbo runs `@agenta/mobile#build`, `next build` succeeds (`✓ Compiled successfully`, route table shows `/` under basePath), and the standalone output exists:
  ```bash
  test -f web/mobile/.next/standalone/mobile/server.js && echo standalone-ok   # → standalone-ok
  test -f web/mobile/.next/standalone/mobile/public/.gitkeep && echo public-ok # → public-ok
  ```

### Task 4.5 — Commit lint/tooling

- [ ] ```bash
  git add web/mobile/eslint.config.mjs web/mobile/src
  git commit -m "feat(mobile): add eslint config with antd and app-layer import bans"
  ```

---

## Phase 5 — Deployment wiring (dev compose, Traefik, `__env.js`)

### Task 5.1 — Extend `web/entrypoint.sh` to mirror `__env.js` for mobile

- [ ] In `web/entrypoint.sh`, insert this block between the `cat > "${ENTRYPOINT_DIR}/${AGENTA_LICENSE}/public/__env.js" <<EOF … EOF` heredoc and the final `cat … >&2` line:
  ```sh
  # Mirror the runtime config into the mobile app's public dir (served at
  # /m/__env.js — the mobile app is built with basePath /m). The mobile app is
  # edition-agnostic: one file, same content for oss and ee. Guarded so images
  # without the mobile app (current gh images) are unaffected.
  if [ -d "${ENTRYPOINT_DIR}/mobile" ]; then
    mkdir -p "${ENTRYPOINT_DIR}/mobile/public"
    cp "${ENTRYPOINT_DIR}/${AGENTA_LICENSE}/public/__env.js" "${ENTRYPOINT_DIR}/mobile/public/__env.js"
  fi
  ```
- [ ] Verify shell syntax: `sh -n web/entrypoint.sh` → no output, exit 0.

### Task 5.2 — Add mobile to the OSS dev web image (`web/oss/docker/Dockerfile.dev`)

- [ ] After the line `COPY oss/package.json ./oss/yarn.lock* ./oss/package-lock.json* ./oss/pnpm-lock.yaml* ./oss/.npmrc* ./oss/`, add:
  ```dockerfile
  COPY mobile/package.json ./mobile/
  ```
- [ ] In the `RUN groupadd … mkdir -p /app/.turbo /app/oss/.next/cache …` line, extend the `mkdir -p` to include `/app/mobile/.next/cache`:
  ```dockerfile
      mkdir -p /app/.turbo /app/oss/.next/cache /app/mobile/.next/cache && \
  ```
- [ ] After the existing OSS source copies (the block ending with `COPY --chown=agenta:agenta oss/tailwind.config.ts ./oss/tailwind.config.ts`), add:
  ```dockerfile
  COPY --chown=agenta:agenta mobile/src ./mobile/src
  COPY --chown=agenta:agenta mobile/public ./mobile/public
  COPY --chown=agenta:agenta mobile/tsconfig.json mobile/next-env.d.ts mobile/next.config.ts mobile/postcss.config.mjs mobile/components.json ./mobile/
  ```

### Task 5.3 — Add mobile to the EE dev web image (`web/ee/docker/Dockerfile.dev`)

- [ ] Apply the same three edits to `web/ee/docker/Dockerfile.dev` (it has the same shape): `COPY mobile/package.json ./mobile/` after the `oss/package.json` copy line; `/app/mobile/.next/cache` added to its `mkdir -p`; the same three `COPY --chown=agenta:agenta mobile/...` lines after its app-source copy block.

### Task 5.4 — Add the `web-mobile` service to the OSS dev compose

- [ ] In `hosting/docker-compose/oss/docker-compose.dev.yml`, add this service directly after the `web` service (matches its style; **no stripprefix** — the app owns `/m` via basePath; the `/m` rule out-scores the web catch-all `` PathPrefix(`/`) `` by rule length, exactly like the `services` router):
  ```yaml
      web-mobile:
          # === ACTIVATION =========================================== #
          profiles:
              - with-web
          # === IMAGE ================================================ #
          image: agenta-oss-dev-web:latest
          # === EXECUTION ============================================ #
          command: sh -c "pnpm dev-mobile"
          # === STORAGE ============================================== #
          volumes:
              - ../../../web/mobile/src:/app/mobile/src
              - ../../../web/mobile/public:/app/mobile/public
              - nextjs-mobile-cache:/app/mobile/.next/cache
              - turbo-mobile-cache:/app/.turbo
          # === CONFIGURATION ======================================== #
          env_file:
              - ${ENV_FILE:-./.env.oss.dev}
          environment:
              DOCKER_NETWORK_MODE: ${DOCKER_NETWORK_MODE:-bridge}
              WATCHPACK_POLLING: "true"
          # === NETWORK ============================================== #
          networks:
              - agenta-network
          # === LABELS =============================================== #
          # PathPrefix(`/m`) auto-wins over the web catch-all PathPrefix(`/`)
          # by rule length; no stripprefix — the app is built with basePath /m.
          labels:
              - "traefik.http.routers.agenta-web-mobile.rule=PathPrefix(`/m`)"
              - "traefik.http.routers.agenta-web-mobile.entrypoints=web"
              - "traefik.http.services.agenta-web-mobile.loadbalancer.server.port=3000"
          # === LIFECYCLE ============================================ #
          restart: always
  ```
- [ ] In the same file's top-level `volumes:` block, add:
  ```yaml
      nextjs-mobile-cache:
      turbo-mobile-cache:
  ```

### Task 5.5 — Add the `web-mobile` service to the EE dev compose

- [ ] In `hosting/docker-compose/ee/docker-compose.dev.yml`, add the same service after its `web` service with exactly two differences: `image: agenta-ee-dev-web:latest` and `env_file: - ${ENV_FILE:-./.env.ee.dev}`. Add the same two named volumes to that file's `volumes:` block.

### Task 5.6 — Validate compose configs

- [ ] ```bash
  docker compose -f hosting/docker-compose/oss/docker-compose.dev.yml --profile with-web config --quiet && echo oss-compose-ok
  docker compose -f hosting/docker-compose/ee/docker-compose.dev.yml --profile with-web config --quiet && echo ee-compose-ok
  ```
  Expected: `oss-compose-ok` and `ee-compose-ok` (exit 0, no schema errors).
- [ ] Confirm the router rule survived variable interpolation:
  ```bash
  docker compose -f hosting/docker-compose/oss/docker-compose.dev.yml --profile with-web config | grep "agenta-web-mobile.rule"
  ```
  Expected: `` traefik.http.routers.agenta-web-mobile.rule: PathPrefix(`/m`) ``.
- [ ] Optional full-stack smoke (requires Docker running; rebuild picks up the Dockerfile.dev changes): start the OSS dev stack with the `with-web` profile per `hosting/AGENTS.md`, then `curl -s -o /dev/null -w "%{http_code}\n" http://localhost/m` → `200`, and `curl -s http://localhost/m/__env.js | head -1` → `window.__env = {` (proves the entrypoint mirror).

### Task 5.7 — Commit deployment wiring

- [ ] ```bash
  git add web/entrypoint.sh web/oss/docker/Dockerfile.dev web/ee/docker/Dockerfile.dev hosting/docker-compose/oss/docker-compose.dev.yml hosting/docker-compose/ee/docker-compose.dev.yml
  git commit -m "feat(mobile): wire web-mobile dev compose service behind Traefik /m"
  ```

---

## Phase 6 — Production image (follow-up task; verification deferred)

### Task 6.1 — Add `web/mobile/docker/Dockerfile.gh`

Mirrors `web/oss/docker/Dockerfile.gh` (base → builder via `run-turbo-build.sh` → slim runner). The runner reuses `web/entrypoint.sh` unchanged: it writes `/app/oss/public/__env.js` (harmless in this image) and the Task 5.1 guard mirrors it into `/app/mobile/public/__env.js`, which is what the app serves at `/m/__env.js`.

- [ ] Create `web/mobile/docker/Dockerfile.gh` (build context is `web/`, like the oss one):
  ```dockerfile
  # syntax=docker/dockerfile:1.20
  FROM node:24-slim AS base

  WORKDIR /app

  ENV NEXT_TELEMETRY_DISABLED=1 \
      TURBO_TELEMETRY_DISABLED=1 \
      PNPM_HOME="/pnpm" \
      PATH="/pnpm:$PATH"

  RUN npm install -g corepack@0.31.0 && \
      corepack enable

  COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
  COPY patches/ ./patches/

  RUN PNPM_VERSION=$(node -p "require('./package.json').packageManager.split('@')[1]") && \
      corepack prepare "pnpm@${PNPM_VERSION}" --activate


  FROM base AS builder

  ENV NODE_OPTIONS="--max_old_space_size=4096"
  ENV TURBO_CACHE_DIR="/app/.turbo"

  COPY docker/run-turbo-build.sh /usr/local/bin/run-turbo-build.sh

  RUN chmod +x /usr/local/bin/run-turbo-build.sh

  # Manifests first (change less often than source). @agenta/mobile has no
  # workspace package deps in WP1; add packages/*/package.json copies here when
  # WP2+ introduces @agenta/* imports.
  COPY mobile/package.json ./mobile/package.json

  RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
      pnpm fetch --frozen-lockfile

  RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
      pnpm install --frozen-lockfile --offline

  COPY mobile/ ./mobile/

  RUN --mount=type=cache,id=turbo-mobile,target=/app/.turbo \
      --mount=type=cache,id=nextjs-mobile,target=/app/mobile/.next/cache \
      --mount=type=secret,id=turbo_team,required=false \
      --mount=type=secret,id=turbo_token,required=false \
      /usr/local/bin/run-turbo-build.sh @agenta/mobile


  FROM node:24-slim AS runner

  ARG BUILD_DATE
  ARG VCS_REF
  ARG VERSION=0.0.0

  WORKDIR /app

  ENV NEXT_TELEMETRY_DISABLED=1 \
      NODE_ENV=production

  RUN groupadd --gid 10001 agenta && \
      useradd --uid 10001 --gid 10001 --shell /bin/false --create-home agenta

  COPY --chown=agenta:agenta --from=builder /app/mobile/.next/standalone /app
  COPY --chown=agenta:agenta --from=builder /app/mobile/.next/static /app/mobile/.next/static
  COPY --chown=agenta:agenta --from=builder /app/mobile/public /app/mobile/public
  COPY --chown=agenta:agenta ./entrypoint.sh /app/entrypoint.sh

  USER 10001

  LABEL org.opencontainers.image.title="agenta-web-mobile" \
      org.opencontainers.image.description="Agenta Mobile Web GH runtime image" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

  ENTRYPOINT ["/app/entrypoint.sh"]
  CMD ["node", "mobile/server.js"]
  EXPOSE 3000
  ```
- [ ] **Verification is deferred:** building this image requires a gh CI build (or a local `docker build -f mobile/docker/Dockerfile.gh web/` with BuildKit + network); the gh workflow additions and the prod/ssl compose service (`Host()` + certresolver labels like the existing web service) are a follow-up once WP1 lands. Mark this task done on file creation + review only.
- [ ] Commit:
  ```bash
  git add web/mobile/docker/Dockerfile.gh
  git commit -m "feat(mobile): add production gh Dockerfile for web-mobile (build wiring follows)"
  ```

---

## Not in this plan

- **Auth (WP2):** no SuperTokens init, no `/m/auth` pages, no context resolution/redirects, no project drawer.
- **Product pages (WP4):** no sessions list, no chat screen, no `@agenta/entities` wiring.
- **Headless chat core / mobile chat skin (WP3a/WP3b):** no `@agenta/chat` package, no AI Elements installation beyond documenting the workflow.
- **Device gate (WP5):** no `middleware.ts`, no UA detection, no opt-out cookies, no `NoMobilePageWrapper` retirement.
- **Prod-image verification and rollout:** gh workflow job for the mobile image, prod/ssl compose variants (`Host()` + certresolver labels), and image-size evaluation of "own Dockerfile vs second server.js in the web image" — deferred until a gh build exists (Task 6.1 creates the Dockerfile only).
- **CI typecheck/lint jobs** for `@agenta/mobile` in the GitHub workflows (the local turbo tasks exist; wiring them into CI is a small follow-up alongside the gh image work).
- **Next 16 pilot** on `web/mobile` (explicit follow-up track in the design doc).
