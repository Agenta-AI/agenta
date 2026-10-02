# Implementation gotchas — antd → `@agenta/ui` migration

Traps hit while building the **harness + token bridge + first `@agenta/ui` component (Badge)**.
Each cost real debugging time. Read before implementing a new component or touching the harness.
Format: **symptom → cause → fix**.

---

## Harness / Storybook

**Every render fails: "Invalid hook call … more than one copy of React" / `Cannot read properties of null (reading 'useMemo')` in `HeadManagerProvider`.**
→ The `.storybook/main.ts` webpack alias forced `react`/`react-dom` to a single copy, forking React away from Storybook/Next's own instance.
→ **Do NOT alias `react`/`react-dom`.** Alias ONLY the antd family for single-instance (`antd`, `@ant-design/icons`, `rc-util`) — they keep theme/cssinjs state in module scope and genuinely need deduping; antd imports the (already single) React fine.

**Story stuck on "preparing", `#storybook-root` empty, no console error, static build swallows the error.**
→ Static Storybook builds hide render errors; you can't debug parity there.
→ Run `storybook dev` (webpack) to get the real console error, or add a React error boundary in `preview.tsx` that writes `err.stack` to the DOM.

**Wrong theme (renders dark when you asked light); `localStorage['agenta-theme']` looks set.**
→ `usehooks-ts` `useLocalStorage` JSON-parses its value; a raw string `"light"` throws on parse → falls back to `System` → device theme.
→ Write `JSON.stringify(theme)`. (The decorator keys `ThemeContextProvider` on theme to remount on toggle.)

**`next/font/google` — do you need a stub?**
→ Initially looked like `Inter()` throws at module load in transpiled `@agenta/oss`.
→ **No stub needed.** `@storybook/nextjs` transforms `next/font` even inside transpiled workspace packages (the bundle carries the real `@font-face`). Don't alias it.

**Slow iteration / constant rebuilds.**
→ Cold start is ~40s (webpack rebuilds antd + lexical + oss).
→ **Restart ONLY for:** `.storybook/main.ts`, `tailwind.config.ts`, new deps, new package exports. **HMR handles:** story files, component files, `theme-variables.css`. Keep one server running.

**"There's no toolbar."**
→ `iframe.html?id=…` is the bare component. The Theme toolbar + sidebar live in the **manager UI at the root URL** (`localhost:6006/?path=/story/…`). `iframe.html` is just what the manager embeds.

---

## Tailwind / styling (preflight is OFF in this app)

**Geometry is ~2px short; a transparent border seems to take 0px.**
→ Preflight is OFF, so the `border` utility sets `border-width:1px` but `border-style` defaults to `none` → the border occupies 0px. antd sets `border-style: solid`.
→ Add **`border-solid`** whenever you use `border` (even transparent).

**Native `<button>` is ~1px too tall / has stray vertical padding.**
→ Preflight OFF means the browser's UA `<button>` padding isn't reset; `px-*` only sets horizontal, so UA vertical padding leaks.
→ Add **`py-0`** to any `<button>`-based component (the `@agenta/ui` Button does).

**Height metric differs (22.4 vs 24.4) but it looks identical.**
→ antd elements are `border-box` (height includes border); a plain `<span>` is `content-box` (height excludes it). Same visual height, different reported number.
→ Add **`box-border`** to match antd's box model (and the codebase convention under preflight-off).

**Don't OVERRIDE `borderRadius` in the shared config — extend it under a namespace.**
→ Overriding `theme.borderRadius` changes **every `rounded-*` in the whole app**.
→ But arbitrary literals in components (`rounded-[6px]`) are also wrong: they scatter the
  control geometry across files. Add ADDITIVE namespaced keys instead — `controlScale`
  gives `rounded-control{,-sm,-lg,-round}`, so nothing existing changes and there is still
  exactly one place to retune. Same pattern as the pre-existing `tremor-*` keys.

**Nested color tokens.** `{DEFAULT, bg, border}` generates `bg-x` (DEFAULT), `bg-x-bg`, `text-x`, `border-x-border`. Use this shape for semantic families (success/warning/error/info/draft).

**Adding bridge tokens or scale keys is a `tailwind.config.ts` change → needs a Storybook restart.** Front-load the complete token set (`shadcnTokens`) and scale (`controlScale`) so component work stays pure-HMR.

---

## Token layer & parity (the crux)

**Match antd's EXACT rendered value PER MODE.** antd is internally inconsistent across light/dark:
- Colorless Tag bg: translucent `rgba(5,23,41,0.02)` in light, but **opaque `#272727`** in dark (a flatten of `colorFillTertiary` over the container, *pinned*). A translucent `--ag` var can't match a pinned opaque → store an explicit palette role per mode (`fill.chip`).
- `colorInfo` text: **navy `#1c2c3d`** in light, **blue `#1668dc`** in dark (same token, algorithm-flipped). Not `colorText`.
- Tag semantic **text** uses non-obvious tokens: `warning` text = `colorWarningText` (not `colorWarning`); `success`/`error` text = the base color. Verify each variant's actual token, don't guess.

**Measure GROUND TRUTH in the browser (`getComputedStyle`), not the generated CSS.** The legacy `--ag-c-*` shim maps hexes to roles in surprising ways — e.g. `--ag-c-FFFBE6 → colorBgElevated` in dark, so a "gold" chip renders neutral-gray in dark. Reading `theme-variables.css` alone would mislead you.

**`--ag-*` (palette layer) ≠ `--ant-*` (antd runtime) everywhere.** The `--ag` layer was INCOMPLETE (no `colorSuccessBg`/`colorErrorBg`) and DIVERGENT (`info` was `#1677ff` vs antd `#1c2c3d`; an orphan `--ag-status-*` palette with 0 consumers). Verify parity against antd's rendered value, then reconcile the `--ag` layer (add missing roles, fix divergences).

**Completing `--ag-*` is SAFE — it never touches antd.** `generate-tailwind-tokens.ts` writes `theme-variables.css` + `antd-overrides.generated.ts` but NOT `antd-themeConfig.json` (antd's config). After any regen, confirm **`git diff antd-overrides.generated.ts` is empty** → antd rendering is unchanged.

**`pnpm generate:tailwind-tokens` writes the LIVE file** (`GEN_WRITE=1`), not a scratch dir. Always `git diff theme-variables.css` after to confirm the delta is only your intended vars.

**`getComputedStyle` returns `rgb()` for opaque, `rgba()` for translucent.** Useful signal — an opaque readout means antd declared a solid color (not a composited translucent).

---

## Component authoring (`@agenta/ui`)

- **`cn` needs `tailwind-merge`** so a consumer's `className` override wins (conflicting utilities deduped, last kept). The legacy `@agenta/ui/styles` `cn` is `clsx`-only — the `@agenta/ui` layer has its own `cn` in `@agenta/ui/ui`.
- **`class-variance-authority` (`cva`)** for variants. Both deps are on `@agenta/ui`.
- `@agenta/ui` components consume the shared bridge tokens (`bg-success-bg`, `text-foreground`, `bg-chip`) — **never raw `--ant-*`**, and prefer named tokens over raw `--ag-*` arbitraries.

---

## The scale + `cn` (read before adding a control primitive)

- **`text-*` is shared between font-size and text-colour utilities**, and tailwind-merge
  does not know your custom `fontSize` keys. Add `control: ["12px", …]` to the theme, write
  `text-control` in a cva `size` variant, and tailwind-merge classifies it as a *colour* —
  silently dropping the variant's `text-foreground` and rendering every control in UA
  black. Type-checking cannot see this; the parity gate caught it.
  **Fix:** register every custom ramp in `cn`'s `extendTailwindMerge` `font-size` group
  (`components/ui/utils.ts`) and name ramps so they can't collide with a colour token
  (`text-btn-md`, `text-field-sm` — never `text-input`, since `input` is a colour).
- **The same trap applies to every GEOMETRY key, and it fails silently the other way.**
  `px-btn`, `h-control`, `rounded-control` are bare words, so unregistered tailwind-merge
  cannot classify them either — but instead of misclassifying it just KEEPS both classes,
  and stylesheet order (not the caller) picks the winner. `<Button className="px-2">`
  emitted `px-btn px-2` and rendered at 15px, so the override looked applied in the source
  and did nothing in the DOM. It made SimpleDropdownSelect 14px wider than the antd trigger
  it replaced (51% parity diff). **Fix:** every `controlScale` key is registered in
  `components/ui/utils.ts` under its utility group (`p`/`px`/`py`, `h`/`min-h`, `w`, `size`,
  `rounded`). Mirror any new key there, or overrides of it are cosmetic.
- **A `disabled:`-modified class is its own tailwind-merge group.** `border-transparent` in
  a variant does NOT override the base's `disabled:border-border` — the modifiers differ, so
  both survive. Chrome-less variants must restate the disabled case explicitly
  (`ghost`/`link` needed `disabled:border-transparent`, or they grew a 1px box when disabled).
- **Every component family has its own size ramp — measure, never assume.** antd's small
  *button* is 12px; its small *input* is 10px; its small *Select* keeps the DEFAULT height
  and 12px type and only tightens padding. Three components, three ramps. Reuse the scale's
  keys, but re-derive which key each size maps to.
- **No raw pixels or hex in a component.** Geometry comes from `controlScale` in
  `oss/tailwind.config.ts`, colour from the `shadcnTokens` bridge. This is what keeps the
  Tailwind v4 move a config change instead of a component rewrite.
- **A `leading-*` override must sit AFTER the `text-*` it fights, and in the SAME cva group.**
  A Tailwind `text-sm`/`text-xs`/`text-field-*` utility bundles its own line-height; a separate
  `leading-[…]` only wins if tailwind-merge sees it last. cva emits the BASE array before the
  variant string, so `leading-[…]` placed in the cva base is dropped by a variant's `text-sm`
  (last-wins). Put the `leading-[…]` in the same variant string, after the font-size (bit the
  Divider with-text line-height until moved). antd's control text is line-height 5/3 (1.6667)
  at every size — Tailwind's `text-sm`/`text-xs` bundle a shorter one, so this recurs.

## Portaled content (dropdowns/popovers/menus)

- **Portaled content renders in SERIF.** Radix Popover/Select portal into `<body>`, which is
  OUTSIDE the app's font scope (`--font-inter` sits on an in-tree `<main>` wrapper, and antd's
  Inter is only on `.ant-app`). Preflight is off, so `<body>` has no font → Times. antd's own
  dropdowns dodge this because antd bakes the resolved font into its cssinjs. Fix: apply
  `font-portal` (a Tailwind `fontFamily` key) to every portaled root — `PopoverContent`,
  `SelectContent`, and any future menu.
- **A comma-list of `var()`s is a landmine.** `font-family: var(--font-inter), var(--ant-font-family)`
  is **invalid-at-computed-value-time** when `--font-inter` is unset — CSS kills the WHOLE
  property (→ inherited serif), it does NOT fall through to the next entry. The fallback must be
  NESTED inside the var: `var(--font-inter, var(--ant-font-family, sans-serif))`. This bit an
  hour: the rule looked right and `--ant-font-family` resolved to Inter, yet the text stayed serif.
- **The panel chrome is antd's overlay, not a bordered shadcn panel.** `.ant-select-dropdown`
  (and antd popovers) are **borderless** (`border-style: none`), radius **borderRadiusLG = 10px**
  (`rounded-control-lg`), with the overlay shadow **boxShadowSecondary** — bridged as the
  `shadow-overlay` Tailwind token (`--ag-boxShadowSecondary`, theme-flipping; added to the
  palette `shadow.overlay` + generator CORE + bridge). Stock shadcn ships a 1px border + 8px
  radius + `shadow-lg` (which renders transparent under preflight-off) — all three are wrong for
  antd. `PopoverContent` and `SelectContent` carry the corrected chrome.
- **A popper panel pinned to the trigger width needs `box-border` AND an explicit width.**
  Preflight is off → default `box-sizing: content-box`, so `w-[var(--radix-*-trigger-width)]` +
  `p-1` renders the panel **8px wider** than the trigger (and than antd, which matches dropdown
  to trigger width). Fix: `box-border` on the content. For Select specifically the width isn't
  set explicitly by default — it comes from the Viewport's `min-w-[trigger-width]`, so the panel
  is 8px too wide until you put `w-[var(--radix-select-trigger-width)]` on the Content (popper)
  and drop the Viewport's `min-w` (which otherwise re-adds the padding). The Combobox popover was
  already correct because it sets an explicit `w-[var(--radix-popover-trigger-width)]`.
- **The closed-trigger gate can't see the panel; the pixel VRT can.** `measure.js` measures the
  closed control, so a serif dropdown once shipped past "6/6 MATCH". Coverage now: a forced-OPEN
  story (`defaultOpen`/`open` + inline `container`, marked `[data-open-compare]`) renders the panel
  inline, and **`parity/vrt.mjs` pixel-diffs the open antd overlay against the agenta one** — this
  is how the 8px width bug and the wrong Combobox arrow were caught. `measureOverlayParity()`
  still exists for a precise computed-style read of one list item.
- **Dropdown-item STATE colours are their own tokens.** antd's selected option is
  `controlItemBgActive` (a cool bluish `#f5f7fa` light / olive dark), NOT the neutral
  `bg-accent`; the hovered/active option is `controlItemBgHover` (= `bg-muted`). The selected
  row keeps its active bg even when highlighted — gate it with `:not([data-state=checked])`
  (or a per-item conditional) so hover doesn't override it. And a keyboard combobox must
  initialise its active index to the SELECTED row on open, not row 0 — antd highlights the
  selection, not the first item.
- **Dropdown-item geometry is its own thing.** antd's option row is NOT the trigger's padding:
  min-height 28px, 4px×12px padding, radius 6px, selected weight 600. And it must be `box-border`
  or `min-h` + padding double up (28 + 8 = 36) under preflight-off.
- **antd v6's selected option shows NO check icon** — the `.ant-select-item-option-state` span
  is empty (width 0); v6 dropped the default check v5 had. So "match antd v6" = no check; there
  is nothing to align a check to. We nonetheless KEEP shadcn's `Check` `ItemIndicator` as a
  **deliberate, documented affordance** (restores the v5 behaviour) — an explicit opt-in
  deviation, not an oversight. Consequence: the Select `OpenState` VRT reads ~5% in dark (the
  bright check on the selected row); that pair is opted out of the pixel gate with its reason.
  This was the "try the proper fix first, else document as an edge case" path: proper match
  (no check) verified impossible-with-a-check, so it is a declared edge case.

## Searchable select (Combobox)

- **Match antd's interaction, not the shadcn recipe.** The stock shadcn "Combobox" (Popover +
  cmdk) puts a search box INSIDE the dropdown. antd's `showSearch` types in the TRIGGER and the
  dropdown shows only options. Under "no visual change" the antd interaction wins — build a
  searchable select (trigger input + filtered list), not a command palette. Screenshot the OPEN
  state against antd, not just the closed trigger; the parity gate only measures the trigger.
- **A `div` trigger can't use `disabled:` / `:disabled` variants.** They only fire on real form
  controls (button/input). A combobox whose trigger is a div (because it hosts the search input)
  must apply the disabled bg/text/border skin explicitly, or a disabled control renders enabled.
- **Rich (ReactNode) labels in a text trigger need an overlay.** An `<input>` shows only a
  string; render the selected label as an absolutely-positioned overlay and hide it while the
  query is non-empty — the antd approach.
- **The closed arrow is a single down chevron, not an up/down caret.** antd Select's closed
  arrow is `ChevronDown` (matches the Select trigger). The stock shadcn combobox uses
  `CaretUpDown` (⇅) — wrong under "no visual change". Use lucide `ChevronDown`, same as Select.

## antd v6 DOM (parity selectors)

- **antd v6 renamed Select's internals.** `.ant-select-selector` (v5) no longer exists; the
  bordered box is `.ant-select` itself, with `.ant-select-content` inside. A parity selector
  written for v5 silently falls through to whatever `firstElementChild` happens to be — the
  readout looked like a total mismatch (16.7px tall, no border, 10px font) and was really the
  row's label `<span>`. **When every property disagrees at once, suspect the selector before
  the component.**
- **The styled box is not always the same element in both libraries.** antd puts the
  placeholder colour on an inner `.ant-select-placeholder`; ours is on `[data-slot=select-value]`.
  Compare those separately rather than expecting the root colours to match.

## Native-element parity (the deltas that survive a "looks right" eyeball)

- **`font-[inherit]` on every native control.** Preflight is OFF, so a bare `<button>`/`<input>`
  keeps the UA font (Arial) instead of the app's Inter. Every colour/height/padding can match
  while the element is still 2–3px wider. Width is the tell.
- **A native `<button>` leaks the UA `background-color: buttonface` (`rgb(239,239,239)`).**
  Preflight off → any `<button>` with no explicit bg renders a light-gray fill. Subtle in light
  (~8%), LOUD in dark (a gray block on the dark page, 40–65%). Every button-based control needs an
  explicit `bg-*` (or `bg-transparent`) — Button variants all set one; it bit Tabs (Radix
  `TabsTrigger` is a `<button>`, needed `bg-transparent` for antd's transparent line tabs).
- **`leading-normal`** — antd leaves `line-height: normal` on Button; a Tailwind text-size
  utility ships its own line-height and diverges.
- **Icon-only buttons need `p-0` + an explicit text size.** Without a text class the svg
  em-scales off the UA 13.33px font, not the app's 12px.
- **An icon-only antd Button is `.ant-btn-icon-only`: a SQUARE with `padding: 0`.** Mapping
  its `size="small"` to our `size="sm"` keeps the 24px height but adds `px-btn-sm`, so the
  button renders 30px wide instead of 24px. Icon-only call sites map to `icon`/`icon-sm`,
  never `sm`/`default` (bit CollapseToggleButton, 29%).
- **ACCEPTED DEVIATION — antd's icon sits 0.75px above true centre.** antd wraps a button
  icon in `<span class="ant-btn-icon">`, whose inline text box is 15.5px tall around a 14px
  svg; flex-centring that box lands the glyph at 4.25px in a 24px button where true centre is
  5px. We centre the bare svg, i.e. correctly. The residue is a permanent ~1–5% on any
  icon-in-button pair (highest on icon-only crops, where the glyph is the only ink) and is
  NOT a bug to chase — matching it would mean deliberately mis-centring our icons.
- **Don't size lucide icons with the `size` prop** when matching antd — it leaves the svg
  em-scaled (17.9px observed for `size={14}`). Use a `size-3` / `size-3.5` class.
- **`loading` is not `disabled`.** antd's loading button keeps its variant colours, so
  `disabled={disabled || loading}` (the common shadcn snippet) applies the whole disabled skin
  and fails parity. Use `aria-busy` + `pointer-events-none` — and note `pointer-events-none`
  alone is NOT enough: Enter/Space on a focused button dispatch a click, so a busy submit
  button stays keyboard-activatable without a click guard. Lives in `LoadingButton`
  (button-composed.tsx), not in Button — stock shadcn's Button has no `loading` prop.
- **Autosize textarea arithmetic:** with `box-sizing: border-box`, `scrollHeight` covers
  content+padding but *not* borders, and a `minRows` clamp must be
  `rows × line-height + padding + borders`. Naive `rows × lh` was 18px short of antd.
  Also render `rows={1}` while autosizing, or the textarea's default `rows` flashes first.
- **A zero-width border reads as a mismatch that isn't one.** `border-0` (ours) vs
  `border-style: none` (antd) report different `borderColor`/`borderStyle` while rendering
  identically. Skip colour/style comparison when computed width is 0.
- **A single-side border (`border-t`/`border-l`) LEAKS width on the other 3 sides.** The app
  ships a global default `border-width` (~1.5px) on elements (preflight off), so `border-solid
  border-<color>` + only `border-t` still renders ~1.5px borders on bottom/left/right — a thin
  rule ends up several px tall (bit the Divider: 1px line rendered 4px). Fix: `border-0` to zero
  all sides, THEN add only the drawn edge (`border-t`/`border-l`). Always reset before a
  single-side border.

## Harness

- **KILL CSS TRANSITIONS BEFORE MEASURING, or dark mode reports a whole phantom column of
  failures.** Our components carry `transition-colors`. An automated/background browser tab
  does not advance animations, so on theme switch every transitioning element sits at
  `currentTime: 0, playState: "running"` **forever** and `getComputedStyle` returns the
  *start* (light) value. Everything else looks right — `documentElement` has `.dark`, the
  element's own `--ag-*` resolves dark, the only matching rule is the correct `var(--ag-…)`
  one — so it reads exactly like a broken token bridge. Confirm with
  `el.getAnimations()`; `el.style.transition = "none"` makes the true value appear instantly.
  **Gate every sweep:**
  ```js
  const kill = document.createElement("style")
  kill.textContent = "*,*::before,*::after{transition:none !important;animation:none !important}"
  document.head.append(kill)
  document.querySelectorAll("*").forEach((el) => el.getAnimations?.().forEach((a) => a.finish()))
  ```
- **A freshly-created probe element is NOT a valid gate for this** (it has no prior value, so
  it never transitions and always reads correctly — it will happily "pass" while every real
  element is stuck). A probe is still the right tool to tell "token bridge broken" from
  "this element is mid-transition": clone the suspect's exact `className` onto a new node — if
  the clone is right and the original is wrong, it's the transition, not the tokens.
- **The preview bundle takes minutes on a cold start** and Storybook serves a script-less
  `iframe.html` until it finishes — an empty `#storybook-root` means "still compiling", not
  "story broken". Don't pipe the dev-server through `tail`; it buffers and hides the progress.
- **A parity story's antd half must be the component we ACTUALLY replaced — check
  `git show <migration-commit>^:<path>` before writing it, don't reconstruct it from the
  name.** Guessing costs more than it saves: SimpleDropdownSelect's antd half was written as
  a bordered 150px `<Select>`, but the original was a `<Dropdown>` + borderless text `Button`,
  so the pair reported 51% for a component that was already correct. Same class of error with
  icons — CollapseToggleButton and CopyButton both carried Phosphor icons BEFORE the
  migration, and substituting `UpOutlined`/`CopyOutlined` in the antd half compared two
  different glyphs (and antd renders inline `anticon` at the button's 12px font-size vs our
  14px, adding a bogus 2px width delta on top).
  **A wrong baseline is worse than no baseline:** it reports a large diff no component change
  can close, and the real deltas hide underneath it. Both of those stories had genuine bugs
  (a 30px-wide icon-only button, a border on disabled ghost) buried under the glyph noise.

## Call-site migration (antd API → shadcn API)

- **Never regex-rewrite JSX tags with a DOTALL `<Tag[^>]*>` pattern.** It swallows nested JSX
  (`icon={<X className="..."/>}`) and injects props into the *inner* element, or emits a
  duplicate `className`. Use a brace/quote-aware scanner that stops at the tag's own `>`, and
  re-read every touched tag afterwards.
- **A wrapper's own prop types leak antd.** Components that re-expose `size?: "small"|"middle"|"large"`
  or `type?: ButtonProps["type"]` keep the antd vocabulary alive even after the import swap.
  Retype the *wrapper's* prop to `ButtonProps["size"]` / `ButtonProps["variant"]`; don't map
  values at the JSX boundary.
- **Watch for collateral renames.** A blanket `size="small"` → `size="sm"` or
  `variant="borderless"` → `variant="ghost"` also hits antd components in the same file
  (`<Spin size="small">`, `<Select size="middle">`, `<InputNumber variant="borderless">`).
  Rename tag-scoped, then re-run tsc — the antd components will complain.
- **Dynamic boolean props with no shadcn equivalent** (`danger={isCancel}`) become conditional
  variants: `variant={isCancel ? "destructive-outline" : "outline"}`.
- **`cva`'s `VariantProps` types every key as `T | null | undefined`.** Indexing a
  `Record<Variant, string>` with it fails ("Type 'null' cannot be used as an index type") —
  default the value before indexing.
- **antd refs aren't DOM refs.** `InputRef.input` / `.focus()` indirection disappears; ours *is*
  the `HTMLInputElement`.
- **"This file only uses `Input.TextArea`" still counts as antd.** Grep for the namespace
  members (`Input.Search`, `Input.Password`, `Input.TextArea`), not just bare `<Input`.

## Stateful components: verify EVERY state, not the resting one (learned the hard way, 5×)

The Combobox was reworked five times. **Every** miss was the same shape: the parity gate
measures the *closed/resting trigger*, so anything in another state sailed past "N/N MATCH"
and the user caught it by screenshot. Font (serif dropdown), item geometry (28 vs 36px),
selected colour (gray vs `controlItemBgActive`), highlight-on-open (first row vs selected
row), the whole search-in-dropdown-vs-trigger interaction — none were visible to a
resting-state diff. So for any component with an overlay or interaction states
(Select, Combobox, Dialog, Tooltip, DropdownMenu, Popover, Menu):

- **Enumerate the states and measure each one against antd** — don't stop at the trigger:
  `open` · each option's `selected` / `hover-active` / `disabled` · `focus` · `loading` ·
  `error` · empty. Use `measureOverlayParity()` for the portaled panel; the trigger-only
  `measureParity()` cannot see it.
- **Screenshot each state next to antd and actually look.** The automated diff is necessary,
  not sufficient — it only checks the properties you thought to list, on the elements you can
  reach. Three real bugs here were found by eye, not by the gate.
- **Match antd's INTERACTION, not the shadcn canonical recipe** when they differ. shadcn's
  Combobox is a command palette (search box in the dropdown); antd's `showSearch` types in
  the trigger. Under "no visual change," antd's interaction wins. Same trap will exist for
  Tooltip (hover-delay/placement), DropdownMenu, Dialog (mask/animation).
- **State colours are distinct antd tokens**, not the neutral shadcn ones: selected =
  `controlItemBgActive`, hover/active = `controlItemBgHover`. And a selected+highlighted row
  must keep its selected colour (`:not([data-state=checked])` on the hover rule).
- **Interaction-state bugs the forced-state gate caught (all invisible to resting/light-only
  checks):** a focus glow on `filled` inputs antd doesn't have; error inputs turning their
  border primary on focus instead of staying red (needs `!` to beat `focus:border-primary`);
  the focus-ring token = `colorInfoBorder` which equals `colorPrimaryBorder` in LIGHT but
  DIVERGES in dark (olive vs navy — needed its own token); the ghost/text hover bg wrong in
  dark only (0.12 vs 0.08). Lesson: a hover/focus token "matching in light" proves nothing
  about dark, and setting a state from a token is a hypothesis until the forced state is
  measured in BOTH themes.

## Interaction-state parity is REQUIRED (hover / focus / active / disabled)

Not optional, not "looks fine." **Every interactive component must match antd 100% in every
state**, proven — not just the resting one. **Consider the FULL set of CSS states, not just
hover/focus:** `:hover`, `:active` (pressed — a distinct state, easy to forget), `:focus` /
`:focus-visible` / `:focus-within` (the last is how a composed affix WRAPPER shows focus — a
`focus:` on the wrapper span never fires; use `focus-within:`, which also matches a bare focused
input), `:disabled`, `[aria-invalid]`, `:read-only`, and for list options the **selected**
(`[data-state=checked]`/`[aria-selected]`) state and its combination with **highlighted/active**
(`[data-highlighted]`) — selected ≠ focused. Enumerate them per component and prove each.

- **Verify states with the VRT first (`InteractionStates` story), computed-style as fallback.**
  The forced-state stories feed the pixel VRT; when it flags an antd forced state, confirm with
  `measureForcedStates()` (antd forced states are pixel-unreliable — see below).
- **Render states STATICALLY with `storybook-addon-pseudo-states` — don't drive them live.**
  A `pseudo-hover-all` / `pseudo-active-all` / `pseudo-focus-visible-all` / `pseudo-focus-all` /
  `pseudo-focus-within-all` wrapper forces that pseudo-class on the control (antd AND agenta
  identically), so the state renders with NO cursor, NO keyboard, NO OS-window-focus dependency.
  This is the method — an `InteractionStates` story per component. (Use `pseudo-focus-within-all`,
  not `pseudo-focus-all`, for anything gated on `:focus-within` — e.g. affix inputs — or the glow
  won't fire in the story.) (Driving focus live via real click/Tab — `measureFocusParity()` —
  works but is flaky and slow: `:focus`/`:focus-visible` need the OS window focused, so
  programmatic `.focus()` and synthetic events do NOT engage them. Keep it only as a fallback.)
  (Driving focus live via real click/Tab — `measureFocusParity()` — works but is flaky and
  slow: `:focus`/`:focus-visible` need the OS window focused, so programmatic `.focus()` and
  synthetic events do NOT engage them. Keep it only as a fallback.)
- **antd's Select focus is a JS class (`.ant-select-focused`), not CSS `:focus`** — the
  pseudo addon won't trigger it. Force that class on the antd node in the story to compare.
- **The pseudo addon can't reliably force antd's runtime-injected `:hover` either.** antd's
  hover rules live in cssinjs injected after the addon rewrites stylesheets, so a
  `pseudo-hover-all` antd Select sometimes shows its RESTING border while agenta shows hover
  → a ~7% pixel diff that FLAPS by theme across storybook restarts. That is a harness artifact,
  not a component bug: **verify hover/focus colours with the computed-style read
  (`measureForcedStates()` / direct `getComputedStyle`), not the pixel VRT.** (Confirmed the
  Combobox hover border = `#e8e47e` = antd `colorPrimaryHover` this way.)
- **Overlay/panel components need a forced-OPEN story that renders the panel STATICALLY.**
  A component that opens a new view state (dropdown, popover, menu, dialog) must not be
  compared only by driving it open — add an `OpenState` story that renders the panel already
  open, INLINE (via a portal `container`) so the antd and agenta panels sit side by side and
  `getComputedStyle`/screenshots compare them without interaction. Force-open with the native
  controlled prop: Radix `defaultOpen`/`open`, antd `open`; render inline with a portal
  container (Radix `container`, antd `getPopupContainer`) — both are real production features
  (rendering inside modals/scroll containers), not story-only shims.
- **Kill transitions before reading a forced state**, or a mid-transition colour reads as a
  false mismatch (bit the dark hover check).
- **The one allowed deviation: a focus affordance deliberately REMOVED as a regression** —
  e.g. a disabled control that is no longer focusable, or dropping antd's focus ring where the
  design doesn't want it. That is acceptable ONLY when it is explicit and **proven** (show the
  element is not focusable / has no ring, and note it in the guide). "I didn't check" is not a
  removed-focus-state; it's an unverified one.
- **Non-interactive components carry the inverse obligation.** A Badge/Tag is a `<span>` — it
  must be **provably non-focusable** (no `tabindex`, `document.activeElement` never lands on
  it, no focus ring). Assert it with evidence; don't say "it's just a span."

## Definition of done (a component is NOT complete until all of this)

Append-only doc updates accumulate contradictions — the Combobox guide ended up listing cmdk
gotchas two reworks after cmdk was removed. So completion includes a reconciliation pass, not
just new bullets:

1. Every variant × every interaction state (resting, hover, focus, active, disabled, and
   open/selected/empty for overlays) proven vs antd, light + dark, via the parity gate.
2. **Run the pixel VRT (`pnpm --filter @agenta/storybook vrt`) in both themes and classify
   EVERY flagged row** — real defect (fix it) vs AA noise floor (~1–2% on text-bearing controls,
   cross-checked with `measure.js`) vs intentional structural diff (labelled `not reproduced`).
   The VRT is the catch-all that finds what a hand-picked property list misses; don't skip it.
3. Any deliberate regression (removed focus, dropped feature) is explicit + proven + noted.
4. **Consistency scrub of the rolling knowledge docs** (this file, STATUS.md, the component
   guide): reconcile — don't append. Delete notes made stale by a later rework, fix
   architecture descriptions that changed, remove dead references. Grep the component's old
   approach (e.g. `cmdk`, an old prop name) and confirm no stale mention survives.
5. tsc clean, lint clean (package config), stories updated to exercise the proven states.

Only after 1–5 does the component count as migrated and the next target begins.

## Process

- **The pixel VRT is the FIRST-LINE gate, not the computed-style script.** Run
  `pnpm --filter @agenta/storybook vrt` (self-baselining, antd-half vs agenta-half, light+dark)
  as the default parity check for every component — it catches border/radius/shadow/width/
  colour/icon/geometry at once with no per-component tuning. Reach for `measure.js`
  (`getComputedStyle` diff) only as the FALLBACK, for the two things pixels handle badly:
  (a) exact token values, and (b) **resolving a VRT flag on an antd forced `:hover`/`:active`/
  `:focus`** — the pseudo-states addon can't reliably force antd's runtime-injected CSS, and a
  1px border under a forced state pixel-diffs heavily from sub-pixel AA even when the tokens are
  identical (bordered variants read ~8–11% while the same forced state on a borderless variant
  reads <1% — the tell that it is AA, not a defect; confirm with computed-style).
- **Do NOT hand-write one-off `getComputedStyle` probes.** That is the habit the VRT replaced.
  Use the VRT; drop to `measure.js`/`measureForcedStates()` only for (a)/(b) above.
- **Verify BEFORE facading.** Once a preset is a facade over the `@agenta/ui` component, the comparison story is trivially equal — the antd-parity proof must be captured on the pre-facade rendering.
- **Check consumer props before facading** (`grep '<Component'`) so the facade doesn't drop a prop someone passes.
