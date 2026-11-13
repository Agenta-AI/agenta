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
- Use `Input`, `SkeletonBlock` and `Sheet` from `@agenta/ui/ui`. The app has no
  local copies of kit components today, and `src/components/ui/` does not exist.
  Do not add local duplicates of kit components.
- Otherwise install via the CLI from `web/mobile/`:
  `pnpm dlx shadcn@latest add <component>`.
- The CLI creates `src/components/ui/` for the new component (the `ui` alias in
  `components.json`). Installed components are owned code: you may adapt them,
  but keep diffs minimal and expressed in semantic tokens so upstream refreshes
  stay cheap.
- The CLI adds any peer deps (e.g. `@radix-ui/react-slot`) to
  `web/mobile/package.json` — commit the manifest and `web/pnpm-lock.yaml`
  changes together with the component.
- Never copy component source from the shadcn website by hand; the CLI resolves
  the Tailwind v4 variant correctly.
- Installing a shadcn component that references a NEW token (e.g. `bg-sidebar`,
  `chart-*`) requires extending VARS in `scripts/generate-shadcn-tokens.ts` +
  the `@theme inline` map in `globals.css` first — Tailwind v4 silently
  generates nothing for unmapped tokens.

## Theming — the token bridge

- shadcn variables (`--background`, `--primary`, ...) are NOT hand-maintained.
  They are generated into `src/styles/theme.generated.css` from
  `web/oss/src/styles/theme/palette.ts` by `scripts/generate-shadcn-tokens.ts`.
  The script also reads `controlScale.ts` from the same folder. That theme
  folder is the one part of `web/oss` still in use: edit it for color changes,
  but touch nothing else in `web/oss`.
- To change a color: edit `palette.ts` (if the design-system value is wrong) or
  the ROLE MAP in the script (if the mapping is wrong), then run
  `pnpm generate:tailwind-tokens` in `web/` and commit the regenerated files.
  That script also runs the mobile token bridge.
- Never edit `theme.generated.css` directly; never introduce raw hex values in
  components — if a needed role is missing, extend the bridge.
- Dark mode is the `.dark` class on `<html>` (`@custom-variant dark` in
  `globals.css`), set pre-paint by the `_document.tsx` init script from the
  shared `agenta-theme` localStorage key. Both themes must be checked for every
  new surface.

## Extending components

- Wrap, do not fork: feature-specific variants live in `src/features/*` as thin
  wrappers over the `@agenta/ui/ui` primitives (cva variants where appropriate).
- Use the `cn` util from `@/lib/utils` for all class merging.

## Chat UI

- There are no Vercel AI Elements in the app and no `src/components/ai-elements/`.
  Chat lives in `src/features/chat/` (`ChatScreen`, `Composer`,
  `LiveConversation`, `TranscriptTurns`, ...), built on `@agenta/chat`
  (`state`, `model`, `hooks`, `components`, ... subpaths) and the Lexical-based
  `@agenta/ui/rich-chat-input`. Markdown streams through `streamdown`.
- Behavior comes from `@agenta/chat` hooks — never re-implement orchestration
  inside a rendered component.
- Icons: both `@phosphor-icons/react` (most files) and `lucide-react` (older
  files and shadcn registry output) are in use. Match the surrounding feature.
