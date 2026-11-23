---
name: mobile-shadcn-conventions
description: How the Agenta mobile app (web/mobile) installs and extends shadcn/ui registry components, themes them via the palette token bridge, and builds chat UI on @agenta/chat. Use when adding UI components under web/mobile, changing theme colors, editing components.json or globals.css, or building chat UI.
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
  semantic tokens so upstream refreshes stay cheap.
- The CLI adds any peer deps (e.g. `@radix-ui/react-slot`) to
  `web/mobile/package.json` — commit the manifest and `web/pnpm-lock.yaml`
  changes together with the component.
- Never copy component source from the shadcn website by hand; the CLI resolves
  the Tailwind v4 variant correctly.
- Installing a shadcn component that references a NEW token (e.g. `chart-*`)
  requires adding it to `src/design/theme.config.ts` (a color, or a
  `colorAliases` entry) and running `pnpm generate:theme` first — Tailwind v4
  silently generates nothing for unmapped tokens.

## Theming — the token bridge

- Theme variables (`--background`, `--primary`, ...) are NOT hand-maintained.
  `src/design/theme.config.ts` holds every value; `pnpm generate:theme` writes
  `src/design/theme.css` (`:root` + `.dark`) and `src/design/theme.tailwind.css`
  (the `@theme inline` mapping, with shadcn slot names from `colorAliases`).
  `globals.css` imports both. `palette.ts` no longer feeds `/m`.
- To change a color: edit `theme.config.ts`, run
  `pnpm --filter @agenta/mobile generate:theme`, and commit the regenerated files.
- Never edit the generated files directly; never introduce raw hex values in
  components — if a needed role is missing, add it to `theme.config.ts`.
- Old antd-era names still resolve through the legacy block in `globals.css`;
  do not add new uses (`pnpm design:ratchet`).
- Dark mode is the `.dark` class on `<html>` (`@custom-variant dark` in
  `globals.css`), set pre-paint by the `_document.tsx` init script from the
  shared `agenta-theme` localStorage key. Both themes must be checked for every
  new surface.

## Extending components

- Wrap, don't fork: feature-specific variants live in `src/features/*` as thin
  wrappers over `components/ui/*` primitives (cva variants where appropriate).
- Use the `cn` util from `@/lib/utils` for all class merging.

## Chat UI

- There are no Vercel AI Elements in the app and no `src/components/ai-elements/`.
  Chat lives in `src/features/chat/` (`ChatScreen`, `Composer`,
  `LiveConversation`, `TranscriptTurns`, ...), built on `@agenta/chat`
  (`state`, `model`, `hooks`, `components`, ... subpaths) and the Lexical-based
  `@agenta/ui/rich-chat-input`. Markdown streams through `streamdown`.
- Behavior comes from `@agenta/chat` hooks — never re-implement orchestration
  inside a rendered component.
- Icons: `@phosphor-icons/react` only (`ICON-01` in `web/mobile/DESIGN.md`). `lucide-react` is
  removed and lint-banned; when a shadcn registry component arrives with lucide icons, swap them.
