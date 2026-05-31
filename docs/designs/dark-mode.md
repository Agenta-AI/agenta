# Dark / Light mode architecture

How theming works in `web/oss` (and `web/ee`, which inherits it), and how to add
or adjust theme-aware styling without re-introducing the bugs we've already fixed.

Related: [`jss-to-tailwind-migration.md`](./jss-to-tailwind-migration.md) (the
ongoing CSS-in-JS → Tailwind cleanup, which is what makes most components
theme-aware "for free").

---

## TL;DR for contributors

When you add or touch styling, ask: **"what makes this flip in dark mode?"**

| You're writing… | Do this | Don't |
|---|---|---|
| A Tailwind color class | Use a theme-aware scale/token: `bg-zinc-1`, `text-colorTextSecondary`, `border-colorBorder` | `bg-white`, `bg-[#f5f7fa]`, `text-[#1c2c3d]` |
| A one-off hex in a component | Route through a codemod var: `bg-[var(--ag-c-F5F7FA)]` | `bg-[#f5f7fa]` |
| A JS inline style (`dom.style.x` / `style={{}}`) | Use a CSS var string: `style={{color: "var(--ag-colorText)"}}` | `style={{color: "#1c2c3d"}}` |
| A link | Nothing — antd's `colorLink` token is themed globally | Per-component blue overrides |
| Elevation on a floating panel | A **border** (`dark:border dark:border-colorBorder`) | Rely on a black `shadow-*` (invisible on dark) |
| A bare/pre-auth page | Rely on the global dark `<body>` + theme-aware layout | A hardcoded `bg-white` page wrapper |

**The invariant:** light mode is byte-for-byte unchanged. Every CSS variable's
`:root` (light) value equals the original hardcoded value; **only the `.dark`
block differs.** Keep it that way — see [Preserving light mode](#preserving-light-mode).

---

## The three layers

Theming is delivered by three coordinated layers. A component becomes
theme-aware by using any of them; most use the first two without any
`dark:`-specific code.

### 1. antd via `ConfigProvider`

`web/oss/src/components/Layout/ThemeContextProvider.tsx` is the single source of
truth for the active theme. It:

- Picks `theme.darkAlgorithm` (dark) or `theme.defaultAlgorithm` (light).
- Enables antd **CSS-variable mode** (`cssVar: {key: "agenta"}`) in both modes, so
  antd emits global `--ant-*` design-token variables under the `.agenta` class on
  `<html>`. Our own variables alias these (see layer 2), which is what lets
  Tailwind/CSS resolve antd's computed dark values.
- Applies a small set of dark **color** overrides (`DARK_TOKEN_OVERRIDES`):
  brand primary (`#f2f25c`, the logo yellow), success/warning/error, and the
  link colors (`colorLink`/`colorLinkHover`/`colorLinkActive`).
- Applies dark **component** overrides (`darkComponents`, e.g. `Button.primaryColor`).

It also toggles the `.dark` class on `<html>` (drives layer 2) and sets
`document.documentElement.style.colorScheme`.

### 2. Tailwind CSS-variable layer

`web/oss/src/styles/theme-variables.css` defines two blocks:

- `:root { --ag-*: <light value> }` — light values, **identical to the previous
  hardcoded values**.
- `.dark { --ag-*: <dark value> }` — dark values, usually referencing antd's
  computed `var(--ant-*)` tokens.

`web/oss/tailwind.config.ts` points the color scales and antd semantic-token
names at those variables (`const v = (name) => \`var(--ag-${name})\``), with
`darkMode: "selector"`. So a class like `bg-zinc-1`, `text-colorTextSecondary`,
or `border-colorBorder` flips automatically under `.dark` — **no per-component
`dark:` variant needed.**

Variable families in `theme-variables.css`:

| Family | Example | Purpose |
|---|---|---|
| antd semantic tokens | `--ag-colorText`, `--ag-colorBgContainer`, `--ag-colorBorder` | The main palette; dark = `var(--ant-color-*)` |
| `zinc` ramp | `--ag-zinc-1` … `--ag-zinc-10` | Brand monochrome; role-inverted in dark |
| `gray` / `ag-gray` ramps | `--ag-gray-500`, `--ag-aggray-200` | Tailwind gray + Untitled-UI gray; role-inverted |
| Codemod hex vars | `--ag-c-F5F7FA`, `--ag-c-1C2C3D` | One per hardcoded hex found in the codebase |
| Reference-tag tones | `--ag-ref-app-bg`, `--ag-ref-variant-text` | Entity reference chips |
| Env-tag tones | `--ag-env-production-bg` | Deployment environment pills |
| Misc named | `--ag-sidebar-bg`, `--ag-app-variant-label` | Component-specific surfaces |

### 3. Hex codemod variables

A one-shot codemod rewrote ~165 files' arbitrary `bg-[#hex]` / `bg-white` into
`bg-[var(--ag-c-HEX)]`. Each hex got a `--ag-c-<UPPERHEX>` variable (light = the
exact hex, lossless; dark = a luminance/role-computed value). When you need a
literal hex in a component, **reuse or add one of these** instead of inlining it.

---

## Theme selection & persistence

- **Default is `System`** — new visitors follow their OS `prefers-color-scheme`.
  Set in two places that **must agree** (or you get a flash):
  - `ThemeContextProvider` → `useLocalStorage("agenta-theme", ThemeMode.System)`.
  - The pre-paint FOUC script in `web/oss/src/pages/_document.tsx` → empty
    storage falls back to `'system'`, then reads `matchMedia`.
- The FOUC script runs synchronously before paint and sets `.dark` + `colorScheme`
  so there's no flash of the wrong theme.
- The toggle UI is `ThemeSwitcher` (Light / System / Dark) in the sidebar user
  dropdown. An explicit choice persists to `localStorage["agenta-theme"]` and
  wins over the OS preference.

---

## How to implement future adjustments

### Adding a theme-aware color (used via Tailwind classes)

Most common case. Add a variable + a config entry:

1. `theme-variables.css`:
   ```css
   :root { --ag-myThing: #f5f7fa; }      /* light = exact intended light value */
   .dark { --ag-myThing: var(--ant-color-bg-elevated); }  /* dark = adapted */
   ```
2. `tailwind.config.ts` (inside `themeAwareColors`): `myThing: v("myThing")`.
3. Use it: `className="bg-myThing"`.

Prefer an **existing** semantic token (`colorBgElevated`, `colorFillSecondary`,
`zinc-1`, …) over inventing a new variable. Only add a variable when nothing fits.

### Routing a hardcoded hex in a component

Use the codemod var if it exists (`grep --ag-c-<HEX> theme-variables.css`):
```tsx
className="bg-[var(--ag-c-F5F7FA)]"
```
If the hex has no var yet, add one to the codemod blocks (`:root` light = exact
hex, `.dark` = adapted) following the existing entries.

### Colors set via JavaScript (the codemod's blind spot)

The codemod and Tailwind layer **cannot reach** colors set in JS:
`dom.style.backgroundColor = "#fff"` or `style={{color: "#1c2c3d"}}`. These stay
light in dark mode. Fix by passing a CSS-var string:
```ts
dom.style.backgroundColor = "var(--ag-c-E2E8F0)"   // not "#e2e8f0"
style={{color: "var(--ag-colorText)"}}              // not "#1c2c3d"
```
(See `Editor/plugins/token/TokenNode.tsx` and `DynamicCodeBlock/CodeBlock.tsx`
for real examples.)

### Links

Don't style links per-component. antd's `colorLink` / `colorLinkHover` /
`colorLinkActive` are themed globally in `DARK_TOKEN_OVERRIDES` (light keeps the
navy primary; dark uses a tuned blue). If a specific link should be *de-emphasised*
(e.g. footer icons, a "Skip" affordance), use a neutral text token
(`text-colorTextSecondary hover:text-colorText`) — not a hardcoded color.

### Elevation on dark surfaces

Black `shadow-*` is invisible on a dark background. Floating panels (popovers,
custom cards, the onboarding widget) must get a **border** in dark to read as
raised:
```tsx
className="... shadow-[...] dark:border dark:border-solid dark:border-colorBorder"
```
Keep the shadow for light; add the border for dark.

### antd per-component token overrides (sizing, radii, line-heights)

`antd-themeConfig.json` ships per-component structural overrides (e.g.
`Tag.fontSizeSM: 12`). These must be applied in **both** themes or components
silently resize in dark. `ThemeContextProvider` handles this via
`stripComponentColors(antdTokens.components)` — it spreads the structural
overrides into the dark token while stripping their colors so `darkAlgorithm`
still owns color. If you add component overrides to `antd-themeConfig.json`, they
flow to both modes automatically; don't special-case them in `darkComponents`
unless they're colors.

### Bare / pre-auth pages (auth, callback, get-started, post-signup, workspaces)

These render outside the main app `Layout` (matched by `isAuthRoute` in
`Layout.tsx`). They get a dark backdrop two ways, both already in place:

- A global `\.dark body { background-color: var(--ag-colorBgContainer) }` rule in
  `globals.css` (covers any bare route).
- The bare-route branch of `Layout.tsx` wraps children in a theme-aware
  `classes.layout` (dark `#141414` / light `#fff`).

If you add a new bare page, render adaptive components (antd + `--ag-*` classes)
and you're done. Watch for **light image assets**: the auth page needed a
theme-aware logo swap (`Agenta-logo-full-dark-accent.png`) and a dark-tuned
shadow, because images don't adapt. Product-screenshot showcase imagery can stay
light by design.

---

## Recurring bug classes (what to look for in review)

Every dark-mode bug we've hit falls into one of these. They're the review
checklist:

1. **Hardcoded hex in JS** — `dom.style.*` / `style={{}}` with a literal color.
   Route through `var(--ag-*)`.
2. **antd `type="link"` / anchors going blue** — fixed globally via `colorLink`;
   don't re-introduce per-component blue.
3. **Semantic-token misuse** — using a semantic token for a non-semantic purpose,
   e.g. `colorInfoBg` (blue in antd) as a neutral grey surface. The project treats
   `colorInfoBg` as neutral (`#f5f7fa ≈ zinc-1`); its dark value is mapped to
   `bg-elevated`, not antd's blue. Prefer a neutral token for neutral surfaces.
4. **Missing per-component token overrides in dark** — caused components to resize
   in dark; fixed by `stripComponentColors`. Don't drop the component overrides
   from the dark `ConfigProvider`.
5. **Shadow-only elevation** — black shadows vanish on dark; add a border.
6. **Light image assets** on bare pages — swap to a dark variant or accept they're
   intentional light showcase art.

---

## Preserving light mode

The branch's guarantee is that **light is unchanged**. To keep it that way:

- A variable's `:root` value must equal the original hardcoded value, byte for
  byte (e.g. `--ag-colorFillSecondary: rgba(5, 23, 41, 0.06)` matches the literal
  it replaced).
- When you replace a literal with a token, verify the token's light value is
  identical. If no token matches exactly, add a dedicated variable rather than
  approximating with a near-match semantic token.
- Dark-only changes belong in the `.dark` block (CSS) or `DARK_TOKEN_OVERRIDES` /
  `dark:` variants (TS/JSX) — never alter the `:root` / light path for a
  dark-only fix.

---

## Known blind spots / residuals

- **Charts, code/editor syntax themes** were approximated; some still need
  per-feature dark palettes. Code blocks use Shiki — the theme must be set on the
  Lexical `CodeNode` (`$createCodeNode(language, themeName)`), not just loaded into
  the registry (see `DynamicCodeBlock/CodeBlock.tsx`).
- **Forked components.** Some components exist in both `@agenta/ui` (the package)
  and a forked copy under `web/oss/src/components`. A fix in one does **not** reach
  the other — search both. (`SkeletonLine` was deduped to the package; the rest of
  the OSS `InfiniteVirtualTable` fork still mirrors the package.)
- **Intentionally-light glyphs** (empty-state icons, some folder icons) should stay
  light on dark — don't route them through `var()` (would invert to invisible).

---

## Verifying changes

- **Toolchain:** `web/` needs Node ≥ 22.13 (use Node 24). On older Node, `pnpm`
  exits with a version error that can mask a failed `tsc`/`lint` run as a clean
  pass. Run with Node 24 explicitly.
- **Type check:** from `web/oss`, `pnpm exec tsc --noEmit`. There is a known
  pre-existing baseline of `src/`-scoped errors; a change should not increase it.
- **Lint / format:** `pnpm lint-fix` in `web/`. The pre-commit hook runs
  `prettier --write` + `turbo lint` for `web/`.
- **Package builds:** if you touch `@agenta/*`, `pnpm turbo run build --filter=@agenta/<pkg>`.
- **Visual QA is the real test.** Dark-mode correctness is visual — toggle the
  theme (and the OS preference, since the default is System) and check the screen.

---

## Key files

| File | Role |
|---|---|
| `web/oss/src/components/Layout/ThemeContextProvider.tsx` | Theme state, antd `ConfigProvider`, `DARK_TOKEN_OVERRIDES`, `stripColors`/`stripComponentColors`, `.dark` class toggle |
| `web/oss/src/styles/theme-variables.css` | `:root` (light) + `.dark` variable definitions |
| `web/oss/tailwind.config.ts` | Maps color scales/tokens → `var(--ag-*)`; `darkMode: "selector"` |
| `web/oss/src/pages/_document.tsx` | Pre-paint FOUC script (must mirror the provider's default) |
| `web/oss/src/styles/globals.css` | Global `.dark body` background for bare routes |
| `web/oss/src/components/Layout/Layout.tsx` | Bare-route (`isAuthRoute`) vs app-layout branching; theme-aware `classes.layout` |
| `web/oss/src/components/Layout/assets/ThemeSwitcher.tsx` | Light / System / Dark toggle |
| `web/oss/src/styles/tokens/antd-themeConfig.json` | antd token + per-component overrides (applied to both themes) |
