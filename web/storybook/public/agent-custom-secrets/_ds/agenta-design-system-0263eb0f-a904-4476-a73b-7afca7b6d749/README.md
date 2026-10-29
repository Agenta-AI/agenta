# Agenta Design System

A design system for **Agenta** — an open-source LLMOps platform that helps developers build reliable AI agents through prompt management, evaluation, and observability.

## What is Agenta?

Agenta is a developer tool (LLMOps platform) with three core capabilities:

1. **Prompt Management** — playground, versioning, deployment of prompts
2. **Evaluation** — auto, human, SDK, and online evaluations of LLM outputs against test sets
3. **Observability** — tracing, sessions, and LLM telemetry (OpenTelemetry-based)

As of v0.112.0 the app is agent-centric: **Agents** and **Sessions** are first-class nav surfaces alongside Prompts, Test sets, Evaluators, Evaluations, Annotation Queues, Observability, plus the Home dashboard (requests / latency / cost / tokens).

The product targets *developers* building LLM apps. The tone is technical, pragmatic, and understated — no marketing gloss.

## Sources this system was built from

- **Codebase (primary):** `github.com/Agenta-AI/agenta` @ `release/v0.112.0` (PR #5827 — the 2026-08 **warm brand recolor** + dark theme)
  - `web/oss/src/styles/theme/palette.ts` — **the** source of truth for all color tokens, light + dark
  - `web/oss/src/components/Sidebar/hooks/useSidebarConfig/index.tsx` — nav structure (Agents before Sessions)
  - `web/oss/package.json` — stack: Next.js, **Ant Design 6**, **Tailwind 3**, Tremor, Lucide, Phosphor icons, Inter font
- **Screenshots (supplementary):** 5 pre-recolor app screenshots in `uploads/` (layout/density reference only — colors are outdated there)
- **Brand assets:** `assets/agenta-logo-full-light.png` and dark variant

## Stack

- **UI framework:** Ant Design 6 (light tokens overridden by the palette; dark via darkAlgorithm + overrides)
- **Utility CSS:** Tailwind 3 (preflight disabled)
- **Charts:** Tremor / Recharts
- **Icons:** Phosphor + Lucide + Ant Design icons (mixed)
- **Font:** Inter (`--font-inter` / Next font)
- **State:** Jotai + Redux Toolkit + SWR + TanStack Query

## File index

| File | Purpose |
|---|---|
| `colors_and_type.css` | All color & type tokens as CSS variables (`--fg1`, `--brand`, `--hero-bg`, `--tag-*`, `--chart-*`) + a `[data-theme="dark"]` block + semantic classes. Import this everywhere. |
| `assets/` | Logos (light/dark), favicon |
| `preview/` | Design System preview cards (one per concept, ~700px wide) |
| `components/` | Compiled React primitives exposed on `window.AgentaDesignSystem_0263eb` |
| `ui_kits/web/` | The Agenta web app UI kit — React components recreating the real product surfaces |
| `SKILL.md` | Cross-compatible skill manifest |
| `github.md` | Source-repo sync record |

---

## Content fundamentals

Agenta's copy is **terse, technical, and second-person**. It reads like good developer documentation, not marketing.

### Voice & tone
- **Direct and informative.** Feature cards state the *action* then the *outcome*. Ex: "Create a prompt — Start with a prompt and test it in the playground." No adjectives, no hype.
- **Second person ("you/your").** "What do you want to do?", "Send traces from your AI app to debug and improve reliability."
- **Imperative headings for tasks.** "Create a prompt", "Run an evaluation", "Set up tracing".
- **Plain-English status words.** "Pending", "0 out of 3", "No output yet", "No filters applied". Never cute, never emoji-driven.

### Casing
- **Sentence case** for all UI: page titles, buttons, menu items. (Title Case appears *only* on primary CTAs with multiple words.)
- **Nav items in sentence case:** Home, Prompts, Agents, Sessions, Test sets, Evaluators, Evaluations, Annotation Queues, Observability.
- Product name is always **"Agenta"** (capital A, never ALLCAPS).

### Number & unit formatting
- Currency as `$0.001541`, `$0.00` — not abbreviated.
- Tokens as `8,357` with comma separators; averages as `146.61`.
- Latency in milliseconds: `0.83ms`, `4ms`.
- Time ranges: "Last 1 month", "Last 3 months", "25 Mar", "1 Apr".
- Percentages keep two-decimals when small: `0.07%`.

### Emoji & symbols
- **No emoji.** Ever.
- **No decorative unicode.** `—` (em dash) is the "no value" placeholder in table cells.

---

## Visual foundations

### Color — the warm recolor (v0.112.0)
- **Light mode is a warm paper/ink ramp.** Page ground `#f6f5f3`, white cards, ink text `#242424`. The old navy `#1c2c3d` system is retired.
- **Primary (`colorPrimary`) is warm ink `#242424`** — primary buttons are ink with white text; hover `#413f3f`, active `#1e1c1d`.
- **Brand yellow `#f2f25c` is a FILL only** — never text, icon, or link in light mode. It marks the single **hero ("keycap") action** per screen (Commit-class buttons): flat yellow fill, ink text, hover `#e7e712`.
- **Links are olive `#5e5e08`** — the only text-safe yellow-family step. Hover steps to ink.
- **Focus is a lime ring:** `rgba(217,217,44,0.35)` glow + `#413f3f` border on focused controls.
- **Neutrals are the warm zinc ladder** `#f6f5f3 → #1e1c1d` (see `--zinc-1..10`). Not gray, not navy.
- **Text hierarchy:** `#242424` (fg1) → `#676770` (fg2) → `#848b8c` (fg3, also resting icons) → `#a3a19f` (fg4, disabled/placeholder).
- **Semantic colors are deep and muted:** success `#2e7d3a`, warning `#8a6400`, error `#5e0908` (body text; `#d94c4a` is border/large-text only), info deep blue `#113955`.
- **One categorical set for ALL tags/badges/chips — six slots** (blue, neutral, amber, olive, red, green; see `--tag-*`). The Ant 10-step hue ramps are gone. Thirteen legacy tag names map onto six slots — some are deliberately indistinguishable. **Agent is pinned to the blue slot** (`#e5f1f9` / `#113955`).
- **Reference tags are the one outlined tag family** (border = slot text at 22% alpha); every other tag is a flat fill.
- **Chart series are fixed-order** (`--chart-1..5`: terracotta, sky, lime, deep blue, gray) — assigned by position, cycled, never picked per item.
- **No gradients.** Flat fills only. No glassmorphism.

### Dark mode
Ships with v0.112.0. Core inversions (all in the `[data-theme="dark"]` block of `colors_and_type.css`):
- Surfaces: container `#141414`, elevated `#242424`, layout black; rail `#101010`.
- **Brand yellow becomes the primary** (`#f2f25c`, dark text `#141414` on it); hero action is `#d1d151`.
- Links are light blue `#8ccfff` (olive fails on dark).
- Text is white at alpha steps (0.85 / 0.65 / 0.45 / 0.25).
- Nav selection is an olive pill `#3e3d1a` with `#d1d151` text.

### Typography
- **Inter** across the entire UI. Monospace is JetBrains Mono / Menlo for code (`--bg-muted` background).
- **Sizes are small and information-dense.** 14px body, 12px labels, 13px inline code. Page H1 ~30px.
- **Weight range is narrow:** 400 regular, 500 medium (selected states), 600 semibold headings. No 700 in chrome.
- **Tight tracking,** tabular numbers on metrics.

### Layout & shell
- **Fixed left sidebar** (236px expanded, 80px collapsed) — now a **warm rail** (`#f6f5f3`) beside white content; all frame lines share `#e5e5e3`.
- **Selected nav row is a WHITE pill** with a hairline border on the warm rail (light). Resting nav icons are grey (`#848b8c`).
- **Project switcher is borderless at rest.**
- Nav order: Home, Prompts, **Agents, Sessions**, Test sets, Evaluators, Evaluations, Annotation Queues, Observability.
- **Main content is white**, ~24px padding; breadcrumb strip in tertiary text; version badge top-right.
- The **breadcrumb + title + filter bar + table** pattern recurs across list pages.

### Backgrounds
- White cards on the `#f6f5f3` ground; `#fbfaf8` (paper) for tinted panels, section headers, table headers — "one step off the plain card without going grey."
- Overlay masks use `rgba(36, 36, 36, 0.45)`.

### Borders, radii, shadows
- **Default radius 6px** (4px small, 8px cards, 2px XS).
- **Borders are 1px solid.** Controls `#d7d7d7`; cards/sections `#e5e5e3` (strong hairline); row dividers `#f0efed` (soft hairline).
- **Shadows are minimal:** card `--shadow-card` (three soft ≤4px drops), dropdowns `--shadow-dropdown`, modals `--shadow-modal`. No inner or colored shadows in light mode.

### Hover / press / focus
- **Hover on rows:** `rgba(36,36,36,0.04)`; press `rgba(36,36,36,0.15)`. Never a scale transform.
- **Primary button:** `#242424` → hover `#413f3f` → active `#1e1c1d`.
- **Focus:** lime glow `rgba(217,217,44,0.35)` + darker border. No thick focus rings.

### Scrollbars
- **Slim and trackless** (6px, transparent track), thumb `rgba(36,36,36,0.22)` → hover `0.38`, scroll-aware fading in the real app.

### Motion
- **Minimal.** `transition: opacity 0.3s ease` for hover-revealed actions; 300ms for sidebar collapse. No bounces, scales, or parallax.

### Iconography
- **Mixed icon system:** `@ant-design/icons` (table chrome), `@phosphor-icons/react` (sidebar nav), `lucide-react` (newer components).
- **Style:** outlined, 1.5–2px stroke, 16–20px. Resting state is grey `#848b8c`; active/selected steps to ink.
- **No emoji. No hand-drawn SVGs.**

---

## Iconography CDN

- Lucide: `https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/<name>.svg`
- Phosphor: `https://unpkg.com/@phosphor-icons/core@2.1.1/assets/regular/<name>.svg`
- Sidebar Phosphor mapping: House (Home), GridFour (Prompts), Robot (Agents), ChatsCircle (Sessions), TestTube (Test sets), SwatchBook (Evaluators), ChartBar (Evaluations), Queue (Annotation Queues), ChartLineUp (Observability), Gear (Settings).
- Table rows use Ant icons: `SettingOutlined`, `MoreOutlined`, `FilterOutlined`, `SearchOutlined`, `ExportOutlined`.

## Fonts

**Inter** via Google Fonts CDN (mirrors Next's runtime font loading):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

## Components

Compiled React components on `window.AgentaDesignSystem_0263eb`:

- **Button** — `variant`: primary (ink), hero (yellow keycap), default, text, danger; `size="sm"`, `disabled`
- **Tag** — `slot`: one of the six categorical slots (blue, neutral, amber, olive, red, green); `outlined` for reference tags

## What's in `ui_kits/`

- `ui_kits/web/` — the Agenta web app: sidebar shell (warm rail, Agents/Sessions), breadcrumb, Home dashboard, Evaluations table, Observability table, Annotation Queues, and core primitives (`.btn` incl. `.btn.hero`, `.input`, `.tag`, `.card`, `.tbl`). Open `ui_kits/web/index.html` for the interactive prototype.

No marketing website UI kit. If you need a landing page, ask the user for marketing brand guidelines.
