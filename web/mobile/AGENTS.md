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
  UI comes from the shared shadcn kit in `@agenta/ui/ui`. Chat is built on `@agenta/chat`.
  Icons come from `@phosphor-icons/react` or `lucide-react`.
- **No app-layer imports.** Never import `@/oss/*`, `@agenta/oss`, or
  `@agenta/ee`. Data and state come from the `@agenta/*` packages only
  (`@agenta/entities`, `@agenta/shared`, `@agenta/chat`, the `*-ui` packages, ...).
- **One component per file**, exported with a name matching the file name.
- **No slab components.** Pages under `src/pages/` are thin route shells only;
  each feature is a folder of small single-purpose components.

## Structure

```text
web/mobile/src/
  pages/                # thin route shells only (Pages Router)
  features/<feature>/   # SessionListScreen.tsx, SessionRowMenu.tsx, ... one component per file
    states/             # SessionsNoMatch.tsx, SessionsPageSkeleton.tsx — designed sibling states
  components/           # app-wide shells (ScreenScaffold, PageTitle, ContentRail, ...)
    ui/                 # local shadcn registry components (installed, then owned)
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
  (committed, never hand-edited). `web/oss/src/styles/theme/` (`palette.ts`,
  `controlScale.ts`) is the one part of `web/oss` still in use. To change a color: edit `palette.ts` or the
  role map in the script, then run `pnpm --filter @agenta/mobile generate:tokens`.
- Dark mode is class-based (`.dark` on `<html>`), keyed off the
  `agenta-theme` localStorage value.

## shadcn registry workflow

Install or update registry components with `pnpm dlx shadcn@latest add <name>`
run from `web/mobile/`. Installed components live in `src/components/ui/` and
are owned code — adapt them, but keep diffs from upstream minimal and
token-driven. Load the `mobile-shadcn-conventions` skill for the full workflow.

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
- Token bridge: `pnpm --filter @agenta/mobile generate:tokens`

## Speed budget and the pre-commit gate

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
- **Gate.** From the repository root, before you commit:
  `web/mobile/scripts/gate.sh <base-ref>`. It checks the diff for banned imports (antd,
  Lexical, app-layer), suppressions, changed dependency files, `web/oss`/`web/ee` edits, deleted
  tests, and antd added to a file under `web/mobile/src` or `web/packages` (one level of
  re-exports is followed). Then it runs types, lint, and the unit tests.
