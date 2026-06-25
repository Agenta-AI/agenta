# Design Tokens — the visual contract

Every visual value in the Agenta site comes from these token files. **Port them
verbatim into your stack** (CSS custom properties, a Tailwind theme `extend`, a
`theme.ts`, design-token JSON — whatever your codebase uses). Never sample a
color off a screenshot; never round a radius by eye. If a value isn't here, it
is in the source CSS named below.

## Source of truth (copy these files)

```
_ds/agenta-brand-<id>/tokens/colors.css       colors + gradients
_ds/agenta-brand-<id>/tokens/typography.css   font families + type scale
_ds/agenta-brand-<id>/tokens/effects.css      radii + shadows
_ds/agenta-brand-<id>/tokens/spacing.css      spacing scale + layout widths
_ds/agenta-brand-<id>/tokens/fonts.css        @font-face / font loading
_ds/agenta-brand-<id>/styles.css              entry that imports all of the above
```

`<id>` is `e4caef1d-4f02-4558-abd2-6342c89dde68`. The values below are reproduced
for convenience but the CSS files are authoritative.

---

## Colors

### Ink (warm-black text scale)
| Token | Hex | Use |
|---|---|---|
| `--ink-900` | `#242424` | primary text, dark buttons |
| `--ink-700` | `#343434` | dark surface mid |
| `--ink-600` | `#676770` | secondary body text (web) |
| `--ink-500` | `#848B8C` | tertiary text (app) |
| `--ink-450` | `#595F61` | app secondary text |
| `--ink-300` | `#A3A19F` | disabled / faint labels |

### Paper (warm-white surface scale)
| Token | Hex | Use |
|---|---|---|
| `--paper-0` | `#FFFFFF` | cards, section panels |
| `--paper-50` | `#FCFBFA` | app background |
| `--paper-100` | `#F6F5F3` | page background (light) |
| `--paper-150` | `#F0EFED` | soft hairline / chip border |
| `--paper-200` | `#E5E5E3` | hairline border |

### Brand accents
| Token | Hex | Use |
|---|---|---|
| `--yellow-400` | `#F2F25C` | **the** accent — primary buttons, CTA band, selected/active |
| `--yellow-500` | `#E7E712` | yellow gradient bottom stop |
| `--terracotta-500` | `#D97757` | charts / data only |

> Rule: **one yellow moment per viewport.** Yellow is for the single primary
> action, the CTA band, and active/selected state — never decoration.

### Dark surfaces
| Token | Hex |
|---|---|
| `--carbon-900` | `#1E1C1D` |
| `--carbon-800` | `#242220` |
| `--carbon-700` | `#3C3A38` |

### The dark-theme site palette (these pages)
The current site (Landing/Pricing/Blog) is the **dark** treatment. It uses a few
literal near-blacks layered to separate sections, plus white-on-dark text alphas.
These are intentional and consistent across pages — treat them as dark-theme tokens:

| Purpose | Value |
|---|---|
| Page base / deepest | `#0A0A0B` |
| Section A (hero, article body) | `#0E0D0F` |
| Section B (cards bg) | `#0A090A` |
| Nav / footer chrome | `#100F11` |
| FAQ section | `#161518` |
| Hairline on dark | `rgba(255,255,255,0.07)` |
| Primary heading on dark | `#F7F6F4` |
| Body text on dark | `rgba(255,255,255,0.60)` |
| Muted text on dark | `rgba(255,255,255,0.45)` |
| Card fill on dark | `rgba(255,255,255,0.02–0.025)` |
| Card inset border | `inset 0 0 0 1px rgba(255,255,255,0.07–0.08)` |

> Recommend formalizing these as `--dark-bg-0/1/2`, `--dark-chrome`,
> `--dark-hairline`, `--text-on-dark-*` in your theme so the two themes
> (light marketing vs. dark marketing) are switchable.

### Gradients (defined tokens)
| Token | Value |
|---|---|
| `--grad-btn-primary` | `linear-gradient(180deg, #F2F25C 0%, #E7E712 100%)` |
| `--grad-btn-dark` | `linear-gradient(180deg, #4D4D4D 0%, #222222 100%)` |
| `--grad-btn-outline` | `linear-gradient(180deg, rgba(246,245,243,0.4) 0%, rgba(229,229,227,0.4) 100%)` |
| `--grad-chip` | `linear-gradient(180deg, #F4F2F0 0%, #E9E5E2 100%)` |

### Semantic aliases (use these in components, not raw hexes)
`--text-heading` = ink-900 · `--text-body` = ink-600 · `--text-muted` =
`rgba(2,1,17,0.6)` · `--text-on-yellow` = ink-900 · `--surface-cta` = yellow-400
· `--border-default` = paper-200 · `--accent-primary` = yellow-400. Full list in
`colors.css`.

---

## Typography

Four families, **strict roles** — do not mix them up:

| Family | Token | Role |
|---|---|---|
| **GT Alpina** (light serif) | `--font-display` | ALL display headlines + card/FAQ titles. Weight 300 for large, 400 for ≤22px. |
| **PP Mondwest** (bitmap serif) | `--font-bitmap` | exactly ONE highlighted word inside a headline, set in a chip. Never body. |
| **Inter** | `--font-sans` | website body, labels, badges |
| **Geist** | `--font-ui` | product app UI only (not marketing) |
| **Geist Mono** | `--font-mono` | code, traces, inline `<code>` |

### Web type scale
| Token | Value | Use |
|---|---|---|
| `--text-display-xl` | `300 68px/72px` GT Alpina | hero |
| `--text-display-lg` | `300 48px/52px` GT Alpina | section titles |
| `--text-display-md` | `300 32px/38px` GT Alpina | sub-section / CTA titles |
| `--text-title` | `400 20px/24px` GT Alpina | card / FAQ titles |
| `--text-body-md` | `400 16px/24px` Inter | body |
| `--text-body-sm` | `400 14px/20px` Inter | small body |
| `--text-label` | `500 14px/20px` Inter | buttons, nav |
| `--text-caption` | `500 12px/18px` Inter, +3% tracking | badges, eyebrows |

> Article body in the blog post intentionally runs larger: `400 18px/1.75 Inter`
> for paragraphs, GT Alpina for h2/h3. See `Agenta Blog Post (Dark).dc.html`.

**Font licensing caveat:** GT Alpina and PP Mondwest binaries shipped here are
**trial/demo** fonts. License them before production. Inter, Geist, Geist Mono
are open / Google Fonts.

---

## Radii

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | `8px` | buttons, badges (rect), app frames |
| `--radius-md` | `10px` | app chips, inputs |
| `--radius-lg` | `12px` | pill-tab containers, blog cards |
| `--radius-xl` | `16px` | large showcase frames |
| `--radius-pill` | `999px` | badge pills, category pills |

> **Marketing section panels are square (radius 0)** with a 1px hairline —
> this is deliberate. Rounding lives only on interactive elements and cards.
> On the dark site the section "panels" use the `rgba(255,255,255,0.07)` hairline
> instead of the light `--paper-200`.

---

## Shadows

| Token | Value | Use |
|---|---|---|
| `--shadow-ring` | `0 0 0 1px rgba(63,70,75,.1), 0 1px 3px rgba(63,70,75,.1)` | app cards/chips/inputs |
| `--shadow-btn-primary` | `inset 0 2px 6.4px rgba(255,255,255,.8)` | glossy top-light on yellow buttons |
| `--shadow-btn-dark` | `inset 0 2px 6.4px rgba(255,255,255,.3)` | dark buttons |
| `--shadow-btn-outline` | `0 0 0 1px var(--paper-150), inset 0 2px 6px #FFF` | outline buttons |
| `--shadow-badge` | `0 0 0 1px var(--paper-150), inset 0 2px .4px #FFF` | badges |
| `--shadow-frame` | double-offset ring | matted screenshot frames |

> The "keycap" button look = vertical gradient fill + inset top-light shadow.
> Reproduce both together or buttons look flat. No large/blurry drop shadows
> anywhere in this brand.

---

## Spacing & layout

From `spacing.css`. Design width **1440px**; 12px outer page gutter; content
column **1072px**; centered prose column **677px**; section vertical padding
**112–128px** (tighter on the dark pages: ~72–112px). Use the spacing scale in
`spacing.css` rather than arbitrary px.

## Iconography

1.5px-stroke rounded line icons, round joins (16px in app, 24px on web). Drawn
SVGs live in `assets/icons/`. Nearest substitute if you need more glyphs:
**Lucide at `stroke-width:1.5`** (flag any substitution). **No emoji, no
unicode-as-icon.** Pricing checkmarks are drawn SVG checks, not "✓".
