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
| A one-off hex in a component | Use the closest semantic token: `bg-colorBgElevated`, `bg-zinc-1` | `bg-[#f5f7fa]`, new `--ag-c-*` vars |
| A JS inline style (`dom.style.x` / `style={{}}`) | Use a CSS var string: `style={{color: "var(--ag-colorText)"}}` | `style={{color: "#1c2c3d"}}` |
| A link | Nothing — antd's `colorLink` token is themed globally | Per-component blue overrides |
| Elevation on a floating panel | A **border** (`dark:border dark:border-colorBorder`) | Rely on a black `shadow-*` (invisible on dark) |
| A bare/pre-auth page | Rely on the global dark `<body>` + theme-aware layout | A hardcoded `bg-white` page wrapper |

**The invariant:** light mode is byte-for-byte unchanged. Every CSS variable's
`:root` (light) value equals the original hardcoded value; **only the `.dark`
block differs.** Keep it that way — see [Preserving light mode](#preserving-light-mode).

---

## Source of truth: `palette.ts`

All theme colors are defined in one file — **`web/oss/src/styles/theme/palette.ts`**.
It holds ~40 semantic **roles** (surface / text / border / fill / accent / semantic /
scales / feature families), each a `{ light, dark }` pair with an explicit value. This is
the only file you edit to change a color.

A generator, **`web/scripts/generate-tailwind-tokens.ts`** (run via
`pnpm generate:tailwind-tokens`), turns `palette.ts` into every downstream artifact:

- `theme-variables.css` — the `--ag-*` CSS-variable layer (layer 2 below).
- `theme/antd-overrides.generated.ts` — the antd `DARK_TOKEN_OVERRIDES` + `darkComponents`
  that `ThemeContextProvider` imports (layer 1 below).
- The `--ag-c-*` compatibility shim (layer 3), each legacy token **aliased to a role** so
  editing a role propagates to legacy component classes.

`theme/legacy-shim.ts` is a frozen, one-time extraction of the legacy `--ag-c-*` tokens; it
is generator **input**, not something you edit. `theme-variables.css` and
`antd-overrides.generated.ts` are generator **output** — never hand-edit them; edit
`palette.ts` and regenerate. The generator has a built-in parity harness proving the output
is lossless, so a plain regen (no palette change) is a no-op.

> antd's `darkAlgorithm` still derives most of antd's internal token set; `palette.ts` owns
> its **inputs** (the seed + the ~16 overrides) plus everything the algorithm can't reach
> (the role-inverted scales, the shim, the feature surfaces). A handful of antd **seed**
> tokens (`colorPrimary`/`colorSuccess`/`colorWarning`/`colorError`) are transformed by the
> algorithm, so their CSS var carries the *derived* output while the *seed* feeds the
> override — the generator handles this split.

## The three layers

Theming is **generated from `palette.ts`** into three coordinated layers. A component
becomes theme-aware by using any of them; most use the first two without any
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
  brand primary (`#f2f25c`, the logo yellow), success/warning/error, the link colors, the
  overlay/drawer shadows, elevated surface, and placeholder text.
- Applies dark **component** overrides (`darkComponents`, e.g. `Button.primaryColor`).

  Both `DARK_TOKEN_OVERRIDES` and `darkComponents` are **imported from the generated
  `styles/theme/antd-overrides.generated.ts`** (produced from `palette.ts`); they are no
  longer hand-written here.

It also toggles the `.dark` class on `<html>` (drives layer 2) and sets
`document.documentElement.style.colorScheme`.

### 2. Tailwind CSS-variable layer

`web/oss/src/styles/theme-variables.css` (**generated** from `palette.ts`) defines two
blocks:

- `:root { --ag-*: <light value> }` — light values, **identical to the previous
  hardcoded values**.
- `.dark { --ag-*: <dark value> }` — dark values (explicit hex/rgba, or a `var(--ant-*)`
  reference for tokens still derived by the algorithm).

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
| Legacy shim hex vars | `--ag-c-F5F7FA`, `--ag-c-1C2C3D` | One per hardcoded hex the codemod found; light = the hex, dark = aliased to a role (frozen in `legacy-shim.ts`) |
| Reference-tag tones | `--ag-ref-app-bg`, `--ag-ref-variant-text` | Entity reference chips |
| Env-tag tones | `--ag-env-production-bg` | Deployment environment pills |
| Misc named | `--ag-sidebar-bg`, `--ag-app-variant-label` | Component-specific surfaces |

### 3. Legacy hex shim variables

A one-shot codemod rewrote ~165 files' arbitrary `bg-[#hex]` / `bg-white` into
`bg-[var(--ag-c-HEX)]`. Each hex got a `--ag-c-<UPPERHEX>` variable (light = the exact hex,
lossless). These ~90 tokens are now **frozen in `theme/legacy-shim.ts`**, and the generator
re-emits them with their **dark value aliased to the nearest role** — so editing a role
(e.g. `surface.elevated`) moves every legacy token that maps to it.

This is a compatibility layer for existing markup, not the pattern for new code. **New
components should use semantic tokens** (`bg-colorBgContainer`, `text-colorText`,
`var(--ag-color*)`), not `--ag-c-*`. Don't add new `--ag-c-*` vars; add a role to
`palette.ts` instead.

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

### Changing or adding a theme color

Everything goes through `palette.ts` — you don't hand-edit CSS or the tailwind config.

**To change an existing color** (the common case, e.g. tuning the dark theme): open
`palette.ts`, find the role, edit its `light` and/or `dark` value, then:

```bash
cd web && pnpm generate:tailwind-tokens   # regenerates theme-variables.css + overrides
```

Commit the regenerated files alongside `palette.ts`. Every consumer — antd components,
Tailwind classes, `var(--ag-*)` refs, JSS, and the legacy `--ag-c-*` classes that alias the
role — moves coherently.

**To add a new role** that Tailwind classes consume: add it to the appropriate group in
`palette.ts`, add the emit mapping in `generate-tailwind-tokens.ts` (the `CORE` / feature
lists), and — if it's a new antd-semantic name — add the tailwind mapping in
`tailwind.config.ts`. Regenerate. But first: prefer an **existing** role
(`surface.elevated`, `fill.secondary`, `zinc-1`, …) — only add one when nothing fits.

**A hardcoded hex in a component** should become a semantic token, not a new literal. Map it
to the closest existing role (`bg-colorBgElevated`, `text-colorTextSecondary`, …). The
legacy `--ag-c-*` shim still resolves for existing markup, but don't add new `--ag-c-*` vars.

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

The guarantee is that **light is unchanged**. To keep it that way:

- Each role's `light` value in `palette.ts` must equal the original hardcoded value, byte
  for byte (e.g. `fill.secondary.light = "rgba(5, 23, 41, 0.06)"` matches the literal it
  replaced). The generator's parity harness verifies the generated output against a frozen
  baseline (0 light + 0 dark mismatches) — a lossless regen changes nothing.
- When you replace a literal with a token, verify the role's light value is identical. If
  none matches exactly, add a dedicated role rather than approximating.
- For a **dark-only** change, edit only the role's `dark` value in `palette.ts` and leave
  its `light` value untouched.

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
| **`web/oss/src/styles/theme/palette.ts`** | **Source of truth** — semantic roles with `{light, dark}` values. Edit this to change any color. |
| `web/scripts/generate-tailwind-tokens.ts` | Generator: `palette.ts` → CSS vars + antd overrides + shim (`pnpm generate:tailwind-tokens`); parity harness |
| `web/oss/src/styles/theme/legacy-shim.ts` | Frozen legacy `--ag-c-*` tokens (generator **input**) |
| `web/oss/src/styles/theme/antd-overrides.generated.ts` | **Generated** — antd `DARK_TOKEN_OVERRIDES` + `darkComponents`, imported by the provider |
| `web/oss/src/styles/theme-variables.css` | **Generated** — `:root` (light) + `.dark` `--ag-*` variable definitions |
| `web/oss/src/components/Layout/ThemeContextProvider.tsx` | Theme state, antd `ConfigProvider`, imports the generated overrides, `stripColors`/`stripComponentColors`, `.dark` class toggle |
| `web/oss/tailwind.config.ts` | Maps color scales/tokens → `var(--ag-*)`; `darkMode: "selector"` |
| `web/oss/src/pages/_document.tsx` | Pre-paint FOUC script (must mirror the provider's default) |
| `web/oss/src/styles/globals.css` | Global `.dark body` background for bare routes |
| `web/oss/src/components/Layout/Layout.tsx` | Bare-route (`isAuthRoute`) vs app-layout branching; theme-aware `classes.layout` |
| `web/oss/src/components/Layout/assets/ThemeSwitcher.tsx` | Light / System / Dark toggle |
| `web/oss/src/styles/tokens/antd-themeConfig.json` | antd token + per-component overrides (applied to both themes) |
