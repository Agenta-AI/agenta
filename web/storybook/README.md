# @agenta/storybook

Storybook for the `@agenta/*` packages and the `/m` app screens.

Stories render the real components behind the `/m` app's providers (jotai with the shared
default store, TanStack Query, the `@agenta/ui` message outlet) and the `/m` app's real
stylesheet (`web/mobile/src/styles/globals.css`, Tailwind v4). What you see in a story is
what `/m` renders.

## Run

From `web/`:

```bash
pnpm install
```

```bash
pnpm --filter @agenta/storybook storybook
```

It opens on http://localhost:6006. Use the **Theme** toolbar to switch light and dark. It
sets the `.dark` class on `<html>`, as the `/m` app does.

If the dev server runs out of memory, give it a bigger heap:

```bash
NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @agenta/storybook storybook
```

## Layout

- `.storybook/main.ts`: framework, Tailwind v4 PostCSS wiring, and the `@` alias to
  `web/mobile/src` for stories that render `/m` screens.
- `.storybook/decorators/AgentaProviders.tsx`: the styling-relevant subset of the `/m`
  provider tree, and the light/dark switch.
- `.storybook/decorators/withAgentaData.tsx`: seeds atoms and the query cache when a story
  sets `parameters.agenta`.
- `.storybook/preview.tsx`: the global decorator and the theme toolbar.
- `.storybook/styles.css`: imports the `/m` stylesheet and adds Storybook's own sources.
- `stories/`: the stories. Stories that live next to a component in `web/packages/*/src`
  are picked up too.
- `fixtures/`: shared story data.
