# @agenta/storybook

Storybook workbench for the **antd → @agenta/ui** migration.

It renders the **real** `@agenta/*` components behind the **real** app providers
(`ThemeContextProvider` → antd `ConfigProvider` + theme, antd `App`, jotai,
TanStack Query) and the real `globals.css`. So what you see in a story is exactly
what the app renders — no hand-derived token math. As we build @agenta/ui replacements,
we drop them into the same stories and compare side by side until they match.

## Run

From `web/`:

```bash
pnpm install
```

```bash
pnpm --filter @agenta/storybook storybook
```

Opens on http://localhost:6006. Use the **Theme** toolbar (top bar) to flip
light/dark — it drives the real `ThemeContextProvider`.

> Run it with a bigger heap — the default OOM-crashes under the VRT/HMR load:
> `NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @agenta/storybook storybook`.

## Parity checks (how a component is proven to match antd)

Two gates, detailed in [`parity/README.md`](parity/README.md):

1. **VRT — the first-line, default gate.** A self-baselining pixel diff (antd-half vs
   agenta-half of each side-by-side story, light + dark):

   ```bash
   pnpm --filter @agenta/storybook vrt          # all stories
   pnpm --filter @agenta/storybook vrt <id>     # one story
   ```

   No golden files (antd IS the baseline), no per-component tuning — it catches border/
   radius/shadow/width/colour/icon/geometry at once and writes diff PNGs to
   `parity/__vrt__/<story>/`. Every component needs an `AntdVsAgenta`, an `InteractionStates`
   (forced hover/active/focus via `storybook-addon-pseudo-states`), and — for overlays — a
   forced-open `[data-open-compare]` story so the panel is diffed too.
2. **`parity/measure.js` — the fallback.** A computed-style diff, for the two things pixels
   handle badly: exact token values, and confirming a VRT flag on an **antd forced state**
   (the pseudo addon can't reliably force antd's runtime CSS, and a 1px border under a forced
   state antialiases along its whole perimeter — bordered variants read ~8–11% while the same
   forced state on a borderless variant reads <1%; that split = AA, not a defect).

Do NOT hand-write one-off `getComputedStyle` probes — that is the habit the VRT replaced.

## Phase 0 — provider/CSS wiring sanity check (one-time)

Before trusting any comparison, confirm the providers/CSS pipeline reproduce the app.
Open **antd/General/Button → UsedInApp**, then in the browser console:

```js
const b = document.querySelector('.ant-btn')            // a middle button
getComputedStyle(b).height          // expect 28px
getComputedStyle(b).borderRadius    // expect 8px
getComputedStyle(b).fontSize        // expect 12px
const p = document.querySelector('.ant-btn-primary')
getComputedStyle(p).backgroundColor // expect rgb(28, 44, 61)  == #1c2c3d
document.querySelector('.ant-btn-sm') && getComputedStyle(document.querySelector('.ant-btn-sm')).height // expect 24px
```

If those match the theme target, the wiring is correct and we scale to the rest of
`@agenta/ui`. If not (e.g. 32px height / blue primary), antd's theme isn't reaching
the render — check the provider decorator and the `@layer` ordering in `styles.css`.

## Layout

- `.storybook/main.ts` — framework + single-instance aliases (react/antd/rc-util/jotai
  resolved from `web/oss` so there's exactly one copy).
- `.storybook/decorators/AgentaProviders.tsx` — the trimmed real provider tree.
- `.storybook/preview.tsx` — global decorator + light/dark toolbar.
- `.storybook/styles.css` — imports the app `globals.css`.
- `stories/` — side-by-side antd-vs-agenta comparison stories (`AntdVsAgenta`,
  `InteractionStates`, `OpenState`).
- `parity/` — the two gates: `vrt.mjs` (pixel VRT, primary) + `measure.js` (computed-style,
  fallback); see `parity/README.md`. `parity/__vrt__/` (diff output) is gitignored.
