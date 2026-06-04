# Dark mode — designer handoff

A practical brief for a designer (or a designer's agent) picking up the dark-mode
polish. It tells you **what to deliver**, **the exact dials you own**, and **the
one rule you must not break**. For the underlying mechanics, see the companion
engineering doc: [`dark-mode.md`](./dark-mode.md).

---

## The one rule: light mode is frozen

Light mode is the established, signed-off baseline. **Every dark-mode change must
leave light mode byte-for-byte identical.** In practice that means changes land in
exactly one of these places:

- the `.dark { … }` block of `web/oss/src/styles/theme-variables.css`, or
- the `DARK_TOKEN_OVERRIDES` / `darkComponents` objects in
  `web/oss/src/components/Layout/ThemeContextProvider.tsx`, or
- a `dark:`-prefixed Tailwind class on a single component (e.g. `dark:bg-[…]`).

If a change touches a light value, it's out of scope. This is non-negotiable for
review — it's what lets us ship dark without re-QA'ing the whole product in light.

---

## What to deliver

We don't need a Figma redraw of every screen. We need a **token specification** —
the dark values for our semantic roles — plus a prioritized polish list. Concretely:

### 1. A dark palette spec (the core deliverable)

Fill in / refine the values for each semantic role below. Deliver as a table
(Figma, Notion, or a comment) — engineering maps each row to a single variable.

| Role | What it's used for | Current dark value |
|---|---|---|
| **Page / canvas** (`colorBgContainer`) | app background, full-height panels, drawer bodies | `#141414` |
| **Elevated surface** (`colorBgElevated`) | popovers, dropdowns, modals, tooltips | `#242424` |
| **Recessed well** (`gray-50`) | input wells, JSON/code blocks | `#1a1a1a` |
| **Raised band** (the section-header bands) | drill-in toolbars, output headers | base + ~6% white overlay |
| **Hairline border** | dividers, card edges | `rgba(255,255,255,0.08)` |
| **Border (stronger)** (`gray-200/300`) | input borders, table grid | `#2a2a2a` / `#383838` |
| **Primary text** | body copy, titles | ~`rgba(255,255,255,0.85)` |
| **Secondary / muted text** | labels, captions, section headers | tertiary/secondary token |
| **Placeholder text** | empty inputs | `rgba(255,255,255,0.38)` |
| **Brand accent / primary** (`colorPrimary`) | primary buttons, active states | `#f2f25c` (brand yellow) |
| **Link** (`colorLink`) | text links, link-style buttons | `#58a6ff` |
| **Success / Warning / Error** | status | `#52c41a` / `#faad14` / `#ff4d4f` |
| **Overlay elevation** (shadow) | the floating "edge" of popovers/modals | 1px light ring + soft drop |

For each row, the deliverable is just: **"this role should be `<value>` in dark."**
Engineering changes one variable per row; nothing else moves.

> ⚠️ The accent is **brand yellow `#f2f25c`** in dark (the navy light-primary is
> invisible on dark). Buttons on yellow use dark text. If you want a different
> dark accent, that's a single token — but check button/label contrast.

### 2. An elevation ladder

Dark UIs read by **luminance steps**, not borders. Define the lightness ordering
so surfaces never collapse into each other:

```
canvas #141414  <  recessed well #1a1a1a  <  (drawer/page chrome)  <  elevated #242424  <  popover/modal
```

Tell us the target step values; we wire them. (This is exactly the class of bug
we've been fixing — e.g. a header band that was the same shade as the drawer
behind it.)

### 3. A prioritized polish list

Screenshots of anything that still reads wrong in dark, each tagged
**P1 (broken/illegible) / P2 (off) / P3 (nice-to-have)**, with the expected look.
Start from the punch-list below.

---

## The control panel — the only files you touch

You almost never touch component files. ~95% of dark lives in two places:

### A. `web/oss/src/styles/theme-variables.css` → the `.dark { … }` block
The CSS-variable layer. Surfaces, text, borders, scales, and the hex-codemod
variables (`--ag-c-XXXXXX`) all get their **dark** values here. Light values live
in the `:root { … }` block above and are off-limits.

### B. `web/oss/src/components/Layout/ThemeContextProvider.tsx`
The antd dials. Current dark overrides (this is the live list):

```
colorPrimary:          #f2f25c     // brand yellow accent
colorSuccess/Warning/Error: #52c41a / #faad14 / #ff4d4f
colorLink:             #58a6ff     (hover #79b8ff, active #3b8eea)
colorBgElevated:       #242424     // popovers/modals/dropdowns
colorTextPlaceholder:  rgba(255,255,255,0.38)
boxShadow*:            1px light ring + soft drops   // dark elevation
Button.primaryColor:   #141414     // dark text on yellow buttons
Button.defaultBg:      transparent // outlined default buttons (+ subtle hover/active)
Drawer.colorBgElevated:#141414     // drawers use canvas, not elevated
```

Change a value here → it propagates everywhere that token is used. That's the
leverage: tune one dial, fix a whole class of components.

---

## How to preview (no build needed for most changes)

1. Run the web app (`pnpm dev` in `web/`), open it, and toggle the theme
   (sun/monitor/moon switch, top-right — "monitor" = follow system).
2. Editing values in the `.dark` block or `DARK_TOKEN_OVERRIDES` hot-reloads.
3. Sanity check: flip to **light** and confirm it's unchanged.

The fastest loop for "what shade is this actually?" is the browser inspector on
the element — read the computed `background-color`. Don't eyeball screenshots for
luminance; measure.

---

## Punch-list (known dark areas to review)

These are either freshly fixed (verify they match your intent) or still open:

- **Surface hierarchy in drawers** — drill-in headers vs drawer body vs content
  wells. Confirm the elevation ladder reads cleanly.
- **Tinted chips/tags** — evaluator-type tags, "Kind" chips, status tags. We've
  given them dark tints; confirm the hues/contrast are on-brand.
- **Info callouts** — green "new testcase" banner, blue "edited" badge, etc.
- **Charts** — metric/frequency chart tooltips, spider/bar/histogram colors.
- **Third-party: Crisp chat** — the chat *window* is a Crisp iframe we can't
  restyle; its dark mode is a **Crisp dashboard** setting (Settings → Chatbox →
  Appearance), and it follows the visitor's **system** scheme, not our toggle.
  Only the launcher **accent** is code-controlled. (See the `TODO(dark-mode)` in
  `web/ee/src/components/Scripts/assets/CloudScripts.tsx`.)
- **Residuals** listed in [`dark-mode.md`](./dark-mode.md) → "Known blind spots".

---

## Conventions to hand to the agent (so changes pass review)

- **Never change a light value.** Dark-only: `.dark` block, dark token override,
  or `dark:` class. (Reviewers will reject anything that moves light.)
- **Don't restyle per-component when a token will do.** If many components share a
  symptom, fix the token, not each call site.
- **Avoid hardcoded hex in components.** Route through a `--ag-*` variable (light =
  exact current value, dark = your adapted value) so it's themeable and light stays
  frozen.
- **Watch the var-backed scales.** `gray`, `zinc-1..10`, `ag-gray`, `neutral`,
  `slate` adapt automatically. Raw Tailwind hues (`green-50`, `sky-100`,
  `zinc-50..950`, `bg-white`, hardcoded `#fff`) **do not** — they need a `dark:`
  variant or a var.
- **Opacity modifiers don't work on `var()`-backed colors** in Tailwind v3 (e.g.
  `bg-neutral-200/80` breaks). Use a solid var class, or put the alpha in the
  variable value.
- **Elevation on dark = a light ring, not a black shadow.** Black drop-shadows are
  invisible on dark; lead with a 1px `rgba(255,255,255,…)` hairline.
- **Verify:** light unchanged + dark legible, then `pnpm lint-fix` (web) and, for
  package changes, `pnpm turbo run build --filter=@agenta/<pkg>`.

---

## Pointers

- Architecture & mechanics: [`docs/designs/dark-mode.md`](./dark-mode.md)
- Token values (dark): `web/oss/src/styles/theme-variables.css` (`.dark` block)
- antd dials: `web/oss/src/components/Layout/ThemeContextProvider.tsx`
- Tailwind var-backed scales: `web/oss/tailwind.config.ts`
- Theme toggle / persistence: `ThemeContextProvider.tsx` (`useAppTheme`)
