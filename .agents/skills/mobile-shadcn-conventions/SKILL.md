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
