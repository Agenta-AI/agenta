# Agenta Mobile (`web/mobile`) conventions

The Agenta frontend app, served at `/m` (Next.js Pages Router, `basePath: "/m"`,
standalone output). `web/oss` (the old desktop app) is abandoned: do not edit
it, run it, or use it as a reference. This is the always-loaded instruction
layer for work under `web/mobile`. The general frontend conventions in `web/AGENTS.md` (Fern client,
state management, React practices) still apply EXCEPT where this file overrides
them — styling and import rules here are deliberately different. Design doc:
`docs/design/agenta-mobile/design.md`.

## Hard rules (lint-enforced — see `eslint.config.mjs`)

- **No antd. Ever.** No `antd`, `@ant-design/*`, `@ant-design/x`, and no direct
  Lexical imports (the composer uses `@agenta/ui/rich-chat-input`).
  No `@agenta/annotation-ui` either (it is built on antd); annotation state and helpers come
  from `@agenta/annotation`.
  UI comes from the shared shadcn kit in `@agenta/ui/ui`. Chat is built on `@agenta/chat`.
  Icons come from `@phosphor-icons/react` or `lucide-react`.
- **No app-layer imports.** Never import `@/oss/*`, `@agenta/oss`, or
  `@agenta/ee`. Data and state come from the `@agenta/*` packages only
  (`@agenta/entities`, `@agenta/shared`, `@agenta/chat`, the `*-ui` packages, ...).
- **One component per file**, exported with a name matching the file name.
- **No slab components.** Pages under `src/pages/` are thin route shells only;
  each feature is a folder of small single-purpose components.

## Structure and states

Load the `mobile-app-structure` skill before you create or move a file here. It
owns the folder layout, the `states/` convention, and the data-flow rules. In
short: every data-bearing component has designed loading, empty, and error
states as sibling components in its feature's `states/` folder.

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
- Colors come from `web/oss/src/styles/theme/palette.ts` through a generated
  token bridge. Load the `mobile-shadcn-conventions` skill before you change a
  color or the theme. It owns the token bridge and dark mode rules.

## shadcn registry workflow

Install or update registry components with `pnpm dlx shadcn@latest add <name>`
run from `web/mobile/`. Use `@agenta/ui/ui` first. The CLI creates
`src/components/ui/`, which does not exist today. Installed components are owned
code: adapt them, but keep diffs from upstream minimal and token-driven. Load the `mobile-shadcn-conventions` skill for the full workflow.

## Skills to load when working here

- `mobile-app-structure` — feature folders, `states/` convention, data-flow rules.
- `mobile-shadcn-conventions` — registry workflow, theming bridge, chat UI.
- `mobile-motion-patterns` — shared presets, when to animate, reduced motion.

Also use the plugin skills when relevant: `vercel:nextjs` (Pages Router
specifics), `vercel:shadcn`, `vercel:react-best-practices`.

## Commands (run from `web/`)

- Dev: `pnpm dev-mobile` (→ http://localhost:3000/m)
- Build: `pnpm build-mobile`
- Lint / types: `pnpm --filter @agenta/mobile lint` / `pnpm --filter @agenta/mobile types:check`
- Token bridge: `pnpm generate:tailwind-tokens`

## Speed budget

/m must never get slower. Three things count: the JavaScript users download, the `next dev`
cold compile time, and the `next build` time. The budget is in `scripts/speed/budget.json`.

- **Size check.** Run `pnpm --filter @agenta/mobile exec next build`, then
  `pnpm --filter @agenta/mobile speed:check`. It measures the first-load JavaScript (gzip) of
  every page: the `/_app` shell plus the chunks of the page. It fails when a page is more than
  3% or 5 KB (the larger value) over its baseline. CI runs it after the image build.
  Run it before you open a PR that touches a shared page, `_app`, a provider, or a shared package.
- **Timing check.** `pnpm --filter @agenta/mobile speed:timing`. It runs `next build` and a cold
  `next dev` three times, and compares the medians with the baseline (15% margin). It takes about
  15 minutes, is noisy, and runs locally only, never in CI. Run it on the dev box, one heavy command
  at a time, when a change adds a large dependency or many files to the shared graph.
- **Raise a budget only with Mahmoud's approval.** First find the cause and fix it: load the heavy
  part with `next/dynamic`, keep developer views out of `_app` and the providers, and do not import
  a barrel that pulls a view into a shared page. If he approves, run `speed:check --write`
  after a fresh build, review the diff of `budget.json`, and say why in the PR body.
  A new route has no budget until it is added the same way.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
