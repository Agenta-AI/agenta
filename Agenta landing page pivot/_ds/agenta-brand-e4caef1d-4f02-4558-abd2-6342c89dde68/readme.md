# Agenta Design System

**Agenta** (agenta.ai) is an open-source **LLMOps platform**: prompt management, evaluation, and observability for teams building LLM applications. The tagline: *"The open-source LLMOps platform — Build reliable LLM apps together with integrated prompt management, evaluation, and observability."*

Agenta's audience is mixed-discipline AI teams — PMs, domain experts, and developers — and the brand deliberately bridges those worlds: a warm, literary serif (GT Alpina) meets a nerdy bitmap face (PP Mondwest) over an ultra-restrained warm-monochrome canvas with a single electric-yellow accent.

## Sources

- **Figma**: "Agenta - Branding and Website.fig" (attached to this project) — pages: Brand-guidelines (33 slides, Nov 2025 "Identity v3.0"), Website (homepage, pricing, blog, web-app recreation, button/nav states), Logo, LinkedIn-Carousels, Cover.
- **Uploads**: full GT Alpina trial family + PP Mondwest OTFs, and the complete logo set (full lockup + symbol, light/dark/dark-accent, SVG + PNG).
- Live product references inside the Figma: web-app screens (Observability, Playground, Evaluation).

## Surfaces represented

1. **Marketing website** (`ui_kits/website/`) — 1440px desktop. Off-white framed sections, serif headlines, yellow CTAs.
2. **Product web app** (`ui_kits/web_app/`) — the LLMOps console. Geist UI font, ring-shadow cards, 220px sidebar.
3. **Slides** (`slides/`) — brand-guideline deck styles (black title slide, dark section dividers, white content slides).

---

## CONTENT FUNDAMENTALS

**Voice**: confident, plain-spoken engineer-to-engineer. Short declarative claims; no hype adjectives. Benefit first, mechanism second.

- Headlines are **sentence case**, short, and often verb-led: *"Ship reliable agents faster with Agenta"*, *"Iterate your prompts with the whole team"*, *"Replace guesswork with evidence"*, *"Debug your AI systems and gather user feedback"*.
- Subcopy is one or two plain sentences naming the three pillars: *"Build reliable LLM apps together with integrated prompt management, evaluation, and observability."*
- "You/your" addresses the reader; "we" is rare (reserved for company statements).
- Problem-framing is honest and specific: *"LLMs are unpredictable by nature. Building reliable products requires quick iteration and feedback, but most teams don't have the right process."*
- Collaboration is a recurring theme: *"Bring PMs, experts, and devs into one workflow"*, *"Your single source of truth for the whole team"*.
- Buttons: 2–3 words, verb-first — "Get started", "Start Building", "Read the docs", "Book a demo".
- Eyebrow badges above section titles: single word or short noun phrase — "Problem", "Solution", "Pricing", "Centralize".
- **No emoji.** No exclamation points. Numbers and metadata are set plainly (dates as "Dec 2, 2024").
- Product nouns: Playground, Test sets, Evaluations, Traces, Deployments, Observability, Registry.

## VISUAL FOUNDATIONS

**Color** — warm monochrome + one accent:
- Page canvas `#F6F5F3`; white `#FFFFFF` section panels sit on it inside a 12px gutter, separated by 1px `#E5E5E3` hairlines. The whole site reads as a thin-ruled grid of paper panels.
- Text: warm black `#242424` headings; gray `#676770` body; `rgba(2,1,17,0.6)` for muted center-column subcopy.
- **Agenta yellow `#F2F25C`** is the only loud color: primary buttons (gradient to `#E7E712`), the full-bleed CTA band, selected states, logo accent. Use sparingly — one yellow moment per viewport.
- Dark feature sections: near-black `#1E1C1D` (and `#343434`) with `rgba(229,229,227,0.1)` hairlines and white type.
- Terracotta `#D97757` appears only as a data/chart accent.
- App surfaces: `#FCFBFA` chrome, white cards, `#EFEFEF` dividers.

**Type** — four families, strict roles:
- **GT Alpina Light (300)** for all display headlines: 68/72 hero, 48/52 sections. Regular (400) at 20px for card/FAQ titles. Serif = trust, domain expertise.
- **PP Mondwest** (bitmap serif) for ONE highlighted word inside a headline — set in a soft gradient chip (`#F4F2F0→#E9E5E2`, radius 10, white inner top-light). It signals the dev/expert partnership. Never use it for body copy.
- **Inter** for website body (16/24), labels (14 Medium), badges (12 Medium, +3% tracking).
- **Geist** for everything inside the product app (14 Medium default); **Geist Mono** for code and trace data.

**Surfaces & borders**: square-cornered website sections with 1px hairlines (no radius, no drop shadow). Rounded corners live on interactive elements: 8px buttons, 10px app chips/inputs, 12px pill-tab containers, 18px+ badge pills.

**Shadows**: two systems.
- *Website buttons/badges*: glossy inset top-light (`inset 0 2px 6.4px rgba(255,255,255,.8)`) over a vertical gradient — a subtle "key cap" look. Outline buttons use a 1px `#F0EFED` ring + white inset.
- *App*: flat tinted rings — `0 0 0 1px rgba(63,70,75,.1), 0 1px 3px rgba(63,70,75,.1)` on every card, chip, and input. No large blurs anywhere.
- Showcase screenshots get a "mat + frame": `0 0 0 6px #F6F4F2, 0 0 0 7px #E7E5E3`.

**Layout**: 1440 design width; 12px page gutter frame; 1416px panels; 1072px content column; 677px centered prose column. Section rhythm: badge eyebrow → serif title → muted subcopy → content. Generous vertical padding (112–128px).

**Imagery**: real product UI recreations (not abstract illustration). Faded grayscale product mockups as card art on tinted backgrounds (dark red `#5E0908`, dark blue `#113955`, light blue `#B8E1FF`, black) for blog cards. No photography, no 3D, no stock.

**Motion**: restrained. Hover = slight darkening or underline; no bounces, no parallax. Things appear with simple fades.

## ICONOGRAPHY

- The product uses a **1.5px-stroke rounded line icon set** (16px in app chrome, 24px on website accents) — copied SVGs live in `assets/icons/` (search, plus, filter, calendar, arrows, more-horizontal…). Match: 1.5px stroke, round joins, square terminals.
- Nearest CDN substitute if you need more glyphs: **Lucide** at `stroke-width: 1.5` (flag any substitution).
- Social/footer icons are filled monochrome `#676770` on `#F6F5F3` square chips (32px, no radius): `assets/icons/social-1..4.svg`.
- **No emoji, no unicode-as-icon.** Checkmarks in pricing tables are drawn check icons.
- Logos: `assets/logos/` — full lockup (`Agenta-logo-full-*`) and the brushy "A" symbol (`Agenta-symbol-*`). Naming = target background: `-light` is the BLACK mark for light backgrounds, `-dark` is the WHITE mark for dark backgrounds, `-dark-accent` is the YELLOW mark for dark backgrounds. Nav logo height ≈ 23px.

## INDEX

| Path | What |
|---|---|
| `styles.css` | Global CSS entry (imports all tokens + fonts) |
| `tokens/` | colors, typography, effects, spacing, fonts |
| `assets/logos/`, `assets/icons/`, `assets/fonts/` | brand assets |
| `components/buttons/` | Button, Badge |
| `components/marketing/` | NavBar, SectionTitle, HighlightChip, FAQItem, Footer |
| `components/app/` | AppSidebar, AppButton, ToolbarChip, PillTabs, SearchField |
| `guidelines/` | foundation specimen cards (Design System tab) |
| `ui_kits/website/` | homepage recreation |
| `ui_kits/web_app/` | Observability console recreation |
| `slides/` | brand deck slide samples |
| `SKILL.md` | agent skill entry point |

## Caveats

- GT Alpina and PP Mondwest binaries are **trial/demo fonts** — license before production use.
- The Figma's "GT Alpina Trial" maps to the GT Alpina **Standard** width here; Fine/Condensed/Extended cuts are in `uploads/` if needed.
- Inter, Geist, Geist Mono load from Google Fonts CDN (no binaries shipped).
