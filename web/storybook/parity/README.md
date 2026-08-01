# Parity gate

Looks are not the whole contract — an @agenta/ui component must also keep the a11y + keyboard +
focus behaviour Radix provides. Three checks back every migrated component:

- **`a11y.mjs`** — `pnpm --filter @agenta/storybook a11y`. Runs **axe-core** against the @agenta/ui
  half of each story (roles / names / states / structure), auditing overlays in their NATURAL
  (click-to-open, Radix-managed) state — NOT the forced-open VRT stories (forcing an overlay open
  inline leaves an inert wrapper that trips `aria-hidden-focus`, an artifact). All 12 components
  pass. The 8 Radix-backed ones (button/input/select/combobox-trigger… no — see next line) get
  this for free from Radix; the **Combobox is the ONE hand-rolled control** (no Radix searchable
  select exists) so its WAI-ARIA combobox pattern — `aria-activedescendant`, per-option ids,
  Up/Down/Home/End, skip-disabled — is implemented and TESTED by hand. Add an `aria-label` to any
  bare control in a story (real usage labels them) or axe flags `button-name`/`label`.

Then two visual checks back every "N/N MATCH" claim:

- **`vrt.mjs`** — a **self-baselining pixel diff** (Playwright + pixelmatch). It screenshots
  the antd subject and the agenta subject of each side-by-side story and diffs them. antd IS
  the baseline (no golden files). Structure-agnostic: it catches border/radius/shadow/width/
  colour/font differences at once, without per-component tuning. Use it as the **first pass** —
  it finds what a hand-picked computed-style list misses (it is how the 8px dropdown-width bug,
  the wrong Combobox arrow, and the Select selected-check were all found). Run it, look at the
  worst rows and their diff PNGs, fix what is real.
- **`measure.js`** — a **computed-style diff** for the cases pixels handle badly: exact token
  values, and **forced states** (`:hover` / `:active` / `:focus` / `:focus-within`) — the
  pseudo-states addon can't reliably force antd's runtime-injected CSS-in-JS, so the pixel diff
  on an antd forced state is unreliable; confirm the colours with `measureForcedStates()` instead.

## VRT (pixel diff) — the first pass

```
pnpm --filter @agenta/storybook storybook   # must be running on :6006
pnpm --filter @agenta/storybook vrt         # all default stories, light + dark
pnpm --filter @agenta/storybook vrt antd-data-entry-combobox--open-state   # one story
```

Output: a sorted worst-first list of pairs over the flag threshold (0.5%), plus `antd`/
`agenta`/`diff` PNGs written under `parity/__vrt__/<story>/` for every flagged row. Read the
diff PNG (red = differing pixels) and the two crops to classify each flag.

**Noise floor.** Text-bearing controls sit at ~1–2% from font/1px-border anti-aliasing even
at perfect parity — that is not a bug (cross-check with `measure.js` if unsure). It scales with
how much text a subject holds: a multi-label bar (e.g. a 3-tab Tabs nav) accumulates ~5–7% of
pure label AA even when every tab width / gutter / ink bar measures exact — verify geometry with
computed-style, then treat the residual as floor. Real defects
show as solid blocks: a filled edge strip (width/size delta), a coloured region (wrong bg/
border token), or a present/absent glyph (an icon one side renders and the other doesn't).

**Tiny (≤16px) controls have an elevated noise floor — confirm with computed-style.** For a
16px checkbox/radio (32px at dpr 2) a 1px sub-pixel offset flips a large fraction of the crop,
so identical-looking controls can read 3-7% at rest and much higher under a forced state (a
matching `checked·hover` checkbox measured 70%). Do NOT chase these with pixel tuning — verify
the box + glyph with `getComputedStyle` (size/bg/border/fill) and treat the residual % as noise.
Also: the VRT `SUBJECT` must list the VISIBLE box (`.ant-radio`/`.ant-checkbox`, DOM-ancestors
of the hidden `<input>`) or it compares antd's hidden input against the agenta box — a false ~25%.

**A size mismatch reads honestly in both themes (opaque-gray pad).** When the two subjects differ
in size, the smaller crop is padded to match. That pad is OPAQUE mid-gray, not transparent —
pixelmatch blends transparent toward white, which would make a size gap falsely MATCH a light page
and falsely EXPLODE against a dark page (a 4px-vs-1px divider read 0% light / 87% dark until this
was fixed). A genuine size difference now shows in BOTH themes; if a row is high in dark only,
suspect a real element-size delta (measure `getComputedStyle().height/width`).

**Forced interaction states on antd are pixel-unreliable — confirm with `measure.js`.** The
pseudo-states addon rewrites antd's cssinjs imperfectly, and a **1px border under a forced
state antialiases along its whole perimeter**, so a *bordered* variant (outline/dashed) can
read 8–11% on forced `:hover`/`:active` while the *same* forced state on a borderless variant
(primary/ghost) reads <1% — that split is the signature of border AA, not a defect. When the
VRT flags an antd forced state, verify the tokens with `measureForcedStates()`; matching
computed values + a borderless-variant sanity check = AA, ship it.

**How it pairs subjects** (generic over the two story layouts, so no per-component script):
- `.grid` rows `[label | antd-cell | agenta-cell]` → the control in each cell (`SUBJECT`
  lists the wrappers, e.g. `.ant-input-affix-wrapper` / `[data-slot=input-affix]`, BEFORE
  `input`, so a composed control's outer wrapper is compared, not its bare inner `<input>`).
- `[data-open-compare]` → the antd overlay (`.ant-select-dropdown`) vs the agenta overlay
  (`[data-slot=popover-content|select-content]`). A forced-open story must carry this marker.

**Declaring an intentional diff (two mechanisms).** A pair that *should* differ from antd is
declared, not silently hidden:
- `.grid` rows — put `not reproduced` in the row label (e.g. antd `Input.Search`'s trailing
  button, the loading spinner glyph). The pair is skipped entirely.
- `[data-open-compare]` overlays — put `data-vrt-expected="reason"` on the container (e.g. the
  Select selected-check antd v6 lacks). The pair is still measured but reported under a separate
  **"expected/ungated"** bucket with its reason — visible, not a failure, and a regression
  elsewhere in the panel would still push the ratio up.

---

`measure.js` diffs computed styles between the antd column and the
agenta column of a comparison story.

## Run it

1. `pnpm --filter @agenta/storybook storybook` (wait for the preview build — a cold start
   takes minutes and serves a script-less `iframe.html` until it finishes).
2. Open a comparison story's iframe directly, once per theme:
   - `http://localhost:6006/iframe.html?id=antd-general-button--antd-vs-agenta&viewMode=story&globals=theme:light`
   - same with `globals=theme:dark`
3. Paste `measure.js` into the console, then run `measureParity()` (or `measureForcedStates()`
   / `measureOverlayParity()` for states/panels).

`mismatches` must be empty in **both** themes. This is the FALLBACK path — the VRT above is the
default gate; drop here only for exact tokens or to confirm an antd forced-state flag.

## Story ids

The VRT's canonical list lives in `vrt.mjs` (`DEFAULT_STORIES`). Per component there are up to
three: `…--antd-vs-agenta` (variants), `…--interaction-states` (forced hover/active/focus), and
`…--open-state` (forced-open overlay, for Select/Combobox). e.g.
`antd-general-button--interaction-states`, `antd-data-entry-select--open-state`.

## The one trap that matters

Our components use `transition-colors`. **A background or automated browser tab does not
advance CSS animations**, so after a theme switch every transitioning element sits at
`currentTime: 0, playState: "running"` indefinitely and `getComputedStyle` returns the
*pre-switch* value. Dark mode then reports a full column of failures that do not exist —
and it looks exactly like a broken token bridge, because everything else checks out
(`documentElement` has `.dark`, the element's `--ag-*` resolves dark, the only matching
rule is the correct `var(--ag-…)` one).

`measureParity()` calls `killTransitions()` first, which is why it is correct and a naive
`getComputedStyle` diff is not.

Note a freshly-created probe element is **not** a valid gate for this — it has no prior
value, never transitions, and will read correctly while every real element is stuck. To
tell "tokens broken" from "stuck transition", clone the suspect element's exact
`className` onto a new node: if the clone is right and the original is wrong, it is the
transition.
