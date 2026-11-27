---
name: mobile-shadcn-conventions
description: How the Agenta mobile app (web/mobile) installs and extends shadcn/ui registry components and builds chat UI on @agenta/chat. Use when adding a registry component under web/mobile, editing components.json, or building chat UI. For colors, sizes and design rules, read web/DESIGN.md instead.
---

# Mobile shadcn conventions

`web/mobile` uses shadcn/ui on Tailwind v4 with CSS variables. No antd, ever.

## Installing registry components

- Prefer the shared primitive first: if `@agenta/ui/ui` already exports it
  (`Button`, `Input`, `Select`, `Dialog`, `Sheet`, `DropdownMenu`, ...), import it
  from there. Do not install a local copy of a component the kit already has —
  `button` in particular lives ONLY in `@agenta/ui` (Nova preset on the shared
  `control-*` scale), so there is one button.
- Use `Input`, `SkeletonBlock` and `Sheet` from `@agenta/ui/ui`. A local
  `src/components/ui/sheet.tsx` still backs `ChannelsPanelSheet` only; do not import it
  anywhere else, and do not add other local duplicates of kit components.
- Otherwise install via the CLI from `web/mobile/`:
  `pnpm dlx shadcn@latest add <component>`.
- Components land in `src/components/ui/` (aliases in `components.json`). They
  are owned code: you may adapt them, but keep diffs minimal and expressed in
  theme variables so upstream refreshes stay cheap.
- The CLI adds any peer deps (e.g. `@radix-ui/react-slot`) to
  `web/mobile/package.json` — commit the manifest and `web/pnpm-lock.yaml`
  changes together with the component.
- Never copy component source from the shadcn website by hand; the CLI resolves
  the Tailwind v4 variant correctly.
- Installing a shadcn component that references a new theme variable (e.g. `chart-*`)
  requires adding it to `web/packages/agenta-ui/src/foundation/design/theme.config.ts` (a color, or a
  `colorAliases` entry) and running `pnpm --filter @agenta/ui generate:theme` first — Tailwind v4
  silently generates nothing for an unmapped name.

## Theme and design rules

Not here. Values and rules live in `web/packages/agenta-ui/src/foundation/design/` (`theme.config.ts`, `rules.json`),
and the principles and the layout in `web/DESIGN.md`.

## Extending components

- Wrap, don't fork: feature-specific variants live in `src/features/*` as thin
  wrappers over `components/ui/*` primitives (cva variants where appropriate).
- Use the `cn` util from `@/lib/utils` for all class merging.

## Chat UI

- There are no Vercel AI Elements in the app and no `src/components/ai-elements/`.
  Chat lives in `src/features/chat/` (`ChatScreen`, `Composer`,
  `LiveConversation`, `TranscriptTurns`, ...), built on `@agenta/chat`
  (`state`, `model`, `hooks`, `components`, ... subpaths) and the Lexical-based
  `@agenta/editor/rich-chat-input`. Markdown streams through `streamdown`.
- Behavior comes from `@agenta/chat` hooks — never re-implement orchestration
  inside a rendered component.
- A registry component that arrives with `lucide-react` icons gets Phosphor icons instead (`ICON-01`).
