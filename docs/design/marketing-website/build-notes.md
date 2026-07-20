# Build notes — marketing website slice 1 (dark landing)

First implementation slice. Goal: prove the Astro + Cloudflare static-first stack
works locally by scaffolding a standalone `website/` package and faithfully
porting the **dark landing page**. One page. Built 2026-06-26.

## What this slice is

- A standalone pnpm package at the repo top level: `website/`. It does not touch
  `web/` or `docs/` (no root workspace; each is independent).
- **Astro v6, `output: 'static'` (pure SSG).** No `@astrojs/cloudflare` adapter
  (that flips the project to Workers SSR and breaks the static build — avoided on
  purpose). Integrations added: `@astrojs/react` (islands) and `@astrojs/mdx`
  (future blog).
- The dark landing (`/`) ported section-by-section from
  `Agenta landing page pivot/Agenta Landing - Agents (Dark).dc.html`. The design
  component runtime (`support.js`, `<x-dc>`, `<sc-for>`, `dc-import`) was NOT
  copied — only the look/layout/copy/behavior were reproduced against the tokens.

## Verification (all green)

- `pnpm install` — clean (354 pkgs). Versions resolved: astro 6.4.8,
  @astrojs/react 5.0.7, @astrojs/mdx 5.0.6, react/react-dom 19.2.7. (Astro 7 and
  the v6→v7 integration majors exist now; we deliberately pinned the v6 line per
  the locked stack decision.)
- `pnpm build` — **passes**, `output: "static"`, 1 page built, no errors.
- `pnpm dev` — starts on **http://localhost:4321/**, returns HTTP 200 with the
  full page HTML (title + all sections server-rendered, including the React
  island's initial state). Server was stopped after the check.
- `find dist -type f | wc -l` → **19 files** (well under Cloudflare's 20k free /
  100k paid static-asset cap). Index HTML is 62 KB raw / ~9.7 KB gzipped.
- CTA destinations confirmed present and exact in the built HTML (see parity
  table below). External links (docs/status/socials) confirmed correct.

### Run it

```bash
cd website
pnpm install   # first time only
pnpm dev       # http://localhost:4321/   (Astro default port)
# or: pnpm build && pnpm preview
```

## File tree created

```
website/
  package.json            standalone pkg "website" 0.1.0 (pnpm@10.30.0)
  astro.config.mjs        output:'static'; react()+mdx(); NO cloudflare adapter (commented why)
  tsconfig.json           extends astro/tsconfigs/strict; react-jsx
  wrangler.jsonc          CF Workers Static Assets binding -> ./dist (deploy later, not now)
  .gitignore              dist/ .astro/ node_modules/ .wrangler/
  public/
    fonts/                6 self-hosted woff2 (TRIAL binaries — see TODO)
      GT-Alpina-Light.woff2, -Light-Italic, -Regular, -Regular-Italic, -Medium
      PPMondwest-Regular.woff2
    logos/                Agenta-logo-full-dark, -symbol-dark, -symbol-dark-accent, -symbol-light (svg)
    icons/                social-1..4.svg
  src/
    styles/
      tokens.css          @font-face + ALL design tokens ported verbatim (colors/typography/spacing/effects)
      global.css          resets, keyframes, scrollbars, responsive media queries (ported verbatim), mobile-menu toggle
    layouts/
      Base.astro          <head>: meta/OG, Google Fonts (Inter/Geist/Geist Mono), font preloads
    components/
      SiteNav.astro       nav + hamburger (vanilla-JS toggle island), correct CTA hrefs
      Hero.astro          announcement pill, headline + PP Mondwest chip, CTAs, video placeholder
      SectionTitle.astro  DS SectionTitle (badge/title/subtitle/dark/align/width) ported 1:1
      Badge.astro         DS Badge ported 1:1
      Button.astro        DS Button (keycap gradient+inset shadow) ported 1:1
      TemplateSection.astro  "Build" section wrapper -> SectionTitle + the island
      TemplateExplorer.tsx   REACT ISLAND (client:visible): 5 templates, skills/agents/tools accordions
      HarnessModels.astro    "Run anywhere" harness/model grid
      Environments.astro     hub-and-spoke diagram (Local/Daytona/E2B/Your own cloud)
      Collaborate.astro      Skills/Tools/Agents cards
      Integrations.astro     4-col integration grid
      Monitor.astro          observability split (video + checklist)
      CtaBand.astro          full-bleed YELLOW band (the one yellow moment), dark+outline buttons
      SiteFooter.astro       brand block + 4 link columns + bottom bar (content from site.json)
    pages/
      index.astro            composes the section stack inside the 1440 .ag-wrap frame
docs/design/marketing-website/build-notes.md   (this file)
```

## Faithful vs approximated vs stubbed

**Faithful (matches the design pixel-for-pixel / value-for-value):**
- All design tokens ported verbatim from
  `_ds/.../tokens/{colors,typography,spacing,effects}.css` into `src/styles/tokens.css`.
- Type roles enforced: GT Alpina = headings (`--text-display-*`, `--text-title`),
  Inter = body/labels, PP Mondwest = the single highlighted hero word + the collab
  card mono glyphs. Geist Mono = the explorer code blocks.
- Dark surfaces layered exactly as the design (#0A0A0B page base, #0E0D0F hero,
  #161518 feature, #0A090A environments, #100F11 nav/footer), 1px
  `rgba(255,255,255,0.07)` hairlines, square section panels.
- DS components (`Badge`, `SectionTitle`, `Button`) ported 1:1 from the bundled
  source (`_ds_bundle.js`), including keycap gradient + inset top-light shadows.
- The interactive **template explorer** is a real React island reproducing the
  design's TEMPLATES data, the use-case selector, and the Skills / Agents.md /
  Tools accordions (initial state: Code-review template, Skills open). This is the
  first proof that Astro islands hydrate in the new stack.
- Responsive: the design's media queries (`@media max-width:1100/860`, `min-width:861`)
  ported verbatim into `global.css`. Nav collapses to a hamburger < 861px; grids,
  diagram, split rows, CTA band, and footer reflow exactly as specced.
- One yellow moment per viewport: the hero primary CTA, then the yellow CTA band.

**Approximated (look matches; mechanism differs by design intent):**
- The mobile hamburger is a tiny vanilla-JS toggle in `SiteNav.astro` (toggles a
  `.is-open` class) instead of a React island — lighter, no hydration cost. The
  template explorer carries the "islands work" proof.
- Hover states (buttons, nav links, footer links) are CSS `:hover` rules in
  `global.css` rather than the DC's per-element hover hooks.
- Nav "Product / Resources / Community" render as dropdown affordances (chevron)
  but the dropdown panels themselves are not built (point at `#`).
- "Watch …" hero/monitor tiles are the design's static video PLACEHOLDERS (pulse +
  play button). The real landing video source is still undecided (see plan.md).

**Stubbed / not built this slice:**
- Only `/` exists. `/pricing`, `/blog`, `/blog/[slug]`, `/blog/author/[slug]` are
  not built; nav/footer links to them resolve to their intended routes and will
  404 until those pages ship (external links are all correct).
- No light-theme variant yet (design ships one; tokens are theme-ready via the
  `--dark-*` vars but the page hard-uses the dark palette for now).
- No analytics (PostHog), sitemap, robots, or real favicon/OG image wiring yet.

## CTA parity (matches the live site exactly)

| Element | Destination | Where |
|---|---|---|
| Book a demo | `https://cal.com/mahmoud-mabrouk-ogzgey/demo?duration=30` | nav, CTA band |
| Get started / Start building / Use template | `https://cloud.agenta.ai/` | nav, hero, explorer, CTA band |
| Read the docs / Docs | `https://docs.agenta.ai/` | hero, nav, footer |
| Talk to us | `https://cal.com/mahmoud-mabrouk-ogzgey/demo` | (reserved; not on this page) |

Nav: Pricing → `/pricing`, Docs → `https://docs.agenta.ai/`, Blog → `/blog`,
plus Product / Resources / Community dropdown placeholders. Footer links + socials
come from `Agenta landing page pivot/content/site.json` (inlined into
`SiteFooter.astro` to keep the package self-contained).

## TODOs (carry forward)

1. **LICENSED FONTS — replace the trial binaries.** `public/fonts/*.woff2` were
   converted from the TRIAL GT Alpina + PP Mondwest binaries in the design folder.
   We own the licensed fonts (see AGENTS.md); swap in the licensed files (same six
   filenames) before any public launch. The TODO is also flagged at the top of
   `src/styles/tokens.css`.
2. **woff2 subsetting.** GT-Alpina-Regular.woff2 is ~128 KB and
   PPMondwest-Regular.woff2 ~70 KB (full glyph sets). Subset to the Latin glyphs
   actually used (`pyftsubset --flavor=woff2 --unicodes=...`) when wiring the
   licensed binaries — cuts these to a few KB each.
3. **Image optimization.** No raster images yet (logos/icons are SVG; videos are
   placeholders). When the hero/monitor videos and any screenshots land, keep
   image variants reasonable to stay well under the Cloudflare file-count cap.
4. **Remaining pages.** `/pricing` (`pricing.json` + BillingToggle island),
   `/blog` (PostCard grid + CategoryFilter island), `/blog/[slug]` (MDX
   ArticleBody + InlineCTA), `/blog/author/[slug]`. Content collections + MDX are
   already enabled for these.
5. **Cloudflare deploy.** `wrangler.jsonc` has the Workers Static Assets binding
   (`./dist`, `html_handling: "drop-trailing-slash"`, `not_found_handling:
   "404-page"`). Deploy later via Cloudflare Workers Builds (git push → build →
   deploy, per-PR previews). Not deployed now.
6. **Light theme + analytics + SEO** (sitemap/robots/OG image, PostHog via the
   `alef.agenta.ai` proxy) — future slices.

---

# Pricing + layout slice (2026-06-26)

Second slice. Two goals: (1) extract the shared chrome (nav / CTA band / footer)
out of the landing into a reusable layout so every page shares it, and (2) build
the `/pricing` page from the design + `content/pricing.json`. The landing was
verified to still render identically after the refactor.

## Part 1 — shared chrome extracted

The landing already had the nav / footer / CTA as separate components
(`SiteNav` / `SiteFooter` / `CtaBand`), but `index.astro` composed them by hand
inside a 1440-wide frame. Formalized that into one layout:

- **`src/layouts/Site.astro`** (new) — the page layout. Wraps `Base.astro` (which
  still owns `<head>`: fonts, tokens, global CSS, meta/OG) and renders the chrome
  around the page body: `NavBar` → `<slot/>` → optional `CtaBand` → `Footer`,
  inside the same `.ag-wrap` 12px-gutter frame the landing used. Props:
  `title`, `description`, `showCta` (default `true`), and `cta` (per-page CTA-band
  copy/destinations). Forwards a named `head` slot to Base for per-page SEO.
- **`src/components/NavBar.astro`** — renamed from `SiteNav.astro` (`git mv`,
  markup unchanged).
- **`src/components/Footer.astro`** — renamed from `SiteFooter.astro` (`git mv`,
  markup unchanged).
- **`src/components/CtaBand.astro`** — parametrized: now takes
  `title` / `body` / `primaryLabel` / `primaryHref` / `secondaryLabel` /
  `secondaryHref`, **all defaulting to the existing landing copy + destinations**
  so the landing is unchanged; `/pricing` passes its own copy.
- **`src/layouts/Base.astro`** — added a `<slot name="head" />` (empty when unused)
  for per-page canonical / OG / structured data.
- **`src/pages/index.astro`** — refactored to `<Site>…</Site>` rendering only the
  page sections (Hero…Monitor); nav, CTA band, and footer now come from the layout.

**Landing renders identically — verified.** Tag-level diff of the built
`dist/index.html` vs the pre-refactor snapshot shows the visible DOM is unchanged.
The only deltas are non-visual: two added HTML comments, collapsed whitespace
inside the CTA `<h2>`/`<p>` text (now interpolated), and build-artifact filename
churn from adding a 2nd page/island — the shared CSS chunk kept the **same content
hash** (`QZU3vAdA`) but was renamed `index→SectionTitle`, and the TemplateExplorer
island JS rehashed. No styling or behavior change.

## Part 2 — `/pricing`

- **`src/pages/pricing.astro`** (new) — the whole page is data-driven from
  `Agenta landing page pivot/content/pricing.json`, imported directly (single
  source of truth — works in both `build` and `dev`, see note below).
  - **4 plan cards** (Hobby / Pro / Business / Enterprise) from `plans`.
    `popular: true` (Business) gets the yellow-tinted glow border + "Most popular"
    pill. Each card renders **both** the monthly and the annual price; CSS shows
    the active one.
  - **Comparison table** from `pricing.comparison` (groups → rows → cells). Cell
    `true` → yellow check, `false` → dash, string → literal value. 5-col grid
    (`1.4fr 1fr 1fr 1fr 1fr`); column-header prices also switch with the toggle.
  - **FAQ** from `pricing.faqs` as a native `<details>`/`<summary>` accordion
    (accessible, no JS; first item open; the `+` icon rotates to `×` on open).
  - **CTA band** reuses the shared `CtaBand` via the layout's `cta` prop
    ("Start free, scale when you're ready").
- **`src/components/BillingToggle.tsx`** (new) — the monthly/annual toggle as a
  small React island (`client:visible`). It does **not** re-render prices itself:
  the page server-renders both prices per plan/column and the island flips a
  `data-billing` attribute on `#pricing-root`; scoped CSS
  (`[data-billing="monthly"] .bill-annual { display:none }` and vice-versa) swaps
  them. Default is `monthly`, so the page is correct **before hydration / with JS
  off**. Accessibility: a 2-option `role="radiogroup"` with `aria-checked`, roving
  `tabindex`, and Arrow/Home/End keyboard support.

## Verification

- **`pnpm build` — clean, 2 pages** (`/index.html`, `/pricing/index.html`). This
  is the primary path and it passed (no blog-content fallback needed).
- Also ran the dev path as a cross-check: `pnpm dev`, `curl /` → **200** and
  `curl /pricing` → **200**, both with full content; no Vite FS-allow error on the
  cross-root `pricing.json` import. Dev server was stopped after (only the one we
  started; a separate pre-existing dev server from the concurrent blog work was
  left alone).
- Spot-checked the built `/pricing`: card prices render `$0/$0`, `$49/$39`,
  `$399/$319`, `Custom/Custom`; table headers `Free / $49/mo / $39/mo / $399/mo /
  $319/mo / Custom`; 6 FAQ `<details>` (first open); one `radiogroup`; CTA
  destinations correct (see below).

## Faithful vs approximated

**Faithful:** plan cards, the popular highlight + pill, the comparison table
(grid, grouped yellow titles, check/dash/literal cells), the FAQ rows, the hero
(pill + GT Alpina headline + PP Mondwest "team" chip), and the bottom CTA band are
ported value-for-value from `Agenta Pricing (Dark).dc.html` against the tokens.
Section surfaces layered as the design (`#0E0D0F` hero/compare, `#0A090A` cards,
`#161518` FAQ), square panels, hairline borders.

**Approximated (by design intent, per RESPONSIVE.md):**
- Responsive is expressed in **CSS media queries**, not the design's
  `window.innerWidth` JS breakpoints (RESPONSIVE.md says the JS approach is a
  prototyping convenience, not the contract). Cards 4→2 (<1000px)→1 (<680px);
  the comparison table keeps full-size columns and **scrolls horizontally**
  (`min-width:780px`); hero/section padding tightens <760px.
- Nav collapses to the hamburger at **860px** (the shared global rule the landing
  already uses) rather than the design's 920px — standardized across pages.
- FAQ accordion is native `<details>` (the design used JS open-state). The billing
  toggle is the one interactive island on this page.

## DESIGN-DECISION items to flag

1. **Monthly/annual toggle is NEW vs the live site.** The design has it; the live
   Framer site does not. Built per the brief. Annual shows `−20%` and the lower
   per-month prices.
2. **Placeholder prices.** Pro `$49`/`$39` and Business `$399`/`$319` (and the
   trace/seat/retention limits) are **design placeholders** from `pricing.json`,
   not real Agenta plan data. Kept as-is with an HTML comment in `pricing.astro`
   above the plan grid. Replace before launch; the data *shape* is the contract.
3. **Enterprise CTA wording.** The design and `pricing.json` label it **"Book a
   demo"**; the brief called it "Talk to us". Kept the design label "Book a demo"
   (faithful to the source) and pointed it at the demo call. Confirm the wording.
4. **CTA destinations override the JSON placeholder hrefs.** `pricing.json` carries
   placeholder hrefs (`/demo`, `cloud.agenta.ai` without trailing slash). Per the
   brief, paid/free plan CTAs → `https://cloud.agenta.ai/`, Enterprise + the CTA
   band's "Book a demo" → `https://cal.com/mahmoud-mabrouk-ogzgey/demo`. The
   page resolves hrefs in code, ignoring the JSON `href`.
5. **`pricing.json` consumed directly (single source of truth).** Imported from
   the design folder via a relative path; verified to work in both `build` and
   `dev`. This intentionally diverges from slice 1's "inline `site.json` to keep
   the package self-contained" choice — chose single-source here because the import
   is robust and the brief names that file as the source of truth. If the package
   must later be fully self-contained, copy it to `src/data/pricing.json` and
   re-point the import.
6. **Nav/footer content stays inlined** (site.json-*derived*) in `NavBar`/`Footer`,
   not re-sourced from `site.json` in this slice: `site.json` carries design
   placeholder hrefs (e.g. `secondaryCta`→`/demo`), and re-sourcing would change
   the live CTA destinations the landing deliberately hard-codes. Left as-is so the
   landing renders identically and keeps the correct live destinations.

---

# Legal/utility pages slice (2026-06-26)

Third slice. Goal: add the legal and utility pages required by the footer and by
German law (`/imprint`, `/terms`, `/privacy-policy`, `/contact`) and redirect the
two campaign-archive URLs (`/launch-week-1`, `/launch-week-2`) to `/blog`.

## Pages added

| Route | File | Notes |
|-------|------|-------|
| `/imprint` | `src/pages/imprint.astro` | German Impressum — verbatim legal content; also serves as the contact page |
| `/terms` | `src/pages/terms.astro` | Holding page with link to termly (decision pending, see below) |
| `/privacy-policy` | `src/pages/privacy-policy.astro` | Holding page with link to termly (decision pending, see below) |
| `/contact` | `src/pages/contact.astro` | Contact details from the Impressum + Book a demo CTA |
| `/launch-week-1` | `astro.config.mjs` redirect | `redirects` config → `/blog`; emits meta-refresh HTML (static) |
| `/launch-week-2` | `astro.config.mjs` redirect | `redirects` config → `/blog`; emits meta-refresh HTML (static) |

Launch-week pages: **redirected, not rebuilt**. The Astro `redirects` option emits
`<meta http-equiv="refresh">` pages in static mode. For a true 308 at the
Cloudflare edge, add the same pairs to `public/_redirects` or to wrangler.jsonc
routes before launch.

## Verification

`pnpm build` — **clean, 6 page(s) built** with all new routes:
`/contact/index.html`, `/imprint/index.html`, `/launch-week-1/index.html`,
`/launch-week-2/index.html`, `/privacy-policy/index.html`, `/terms/index.html`
(plus the existing `/index.html` and `/pricing/index.html`). No errors, no blog
content touched. Build time 1.42 s.

## Design / legal decisions to flag

### 1. Termly self-host vs redirect (REQUIRES LEGAL DECISION)

`/terms` and `/privacy-policy` currently show a holding page that links out to
termly.io. The live site sends HTTP 308 to termly directly so users never see this
page. Before launch, decide:

- **Option A — keep termly redirect:** Remove these pages; add a Workers-layer
  308 in `public/_redirects` or wrangler.jsonc routes. The termly dashboard stays
  the single source of truth; updates publish instantly without a deploy.
- **Option B — self-host the text:** Export both documents from the Termly
  dashboard, paste the text into these pages as long-form dark prose. Eliminates
  the external JS dependency. Requires a deploy to update policies.

Termly document IDs: Terms = `506861af-ea3d-41d2-b85a-561e15b0c7b7`;
Privacy = `ce8134b1-80c5-44b7-b3b2-01dba9765e59`.

### 2. Footer legal-links reconciliation (REQUIRES DESIGN DECISION)

The current `Footer.astro` has several mismatches with real routes:

| Footer link label | Footer href | Correct route | Status |
|---|---|---|---|
| "Privacy Policy" (Legal column) | `/privacy` | `/privacy-policy` | WRONG PATH — page is at `/privacy-policy`; footer will 404 |
| "Privacy policy" (bottom bar) | `/privacy` | `/privacy-policy` | Same problem |
| "Terms of services" | `/terms` | `/terms` | OK — page now exists |
| "DPA" | `/dpa` | no `/dpa` page exists | MISSING — live site serves DPA at `docs.agenta.ai/administration/security/dpa`, not at a top-level route; either add a redirect or update the footer link to point to docs |
| "Trust Center" | `/trust` | `https://trustcenter.agenta.ai` | WRONG — should be external link |
| "Imprint" | `/imprint` | `/imprint` | OK |
| "Contact" (Company column) | `/contact` | `/contact` | OK — page now exists |

**Immediate fix needed before launch:** Update `Footer.astro` to change `/privacy`
→ `/privacy-policy` in both the Legal column and the bottom bar. The DPA and Trust
Center links also need correction.

### 3. Duplicate privacy links in footer

The footer has "Privacy Policy" in the Legal column AND a bottom-bar "Privacy
policy" link — both currently point to `/privacy` (wrong path, see above).
Consolidate to one authoritative link in the Legal column and remove the bottom-bar
duplicate, OR point the bottom-bar link to the same `/privacy-policy` route.
The live Framer site has both; only one is needed.

### 4. Imprint — possibly missing required fields (REQUIRES LEGAL REVIEW)

The scraper captured: company name, address, phone, email, website. German law
(§ 5 TMG + § 2 DL-InfoV) also requires: managing director name(s), commercial
register entry (Handelsregister + Registernummer), and VAT identification number
(USt-IdNr.) if applicable. The live page may already have these fields but they
were not captured. Review the live https://agenta.ai/imprint before launch and add
any missing fields verbatim to `src/pages/imprint.astro`.

### 5. /contact vs /imprint dual-purpose

The live site has no `/contact` route — the footer "Contact" link points to
`/imprint`. This slice creates a proper `/contact` page (contact details + demo
CTA). The footer `Footer.astro` already links "Contact" → `/contact`, so the
footer wiring is correct once this slice ships. The `/imprint` page still exists
and stays as the Impressum. If the dual-purpose approach is preferred (imprint
doubles as contact, no separate /contact), remove `src/pages/contact.astro` and
update the footer link back to `/imprint`.

---

# Blog slice (2026-06-26)

Built the blog on top of the already-migrated content (37 posts, 3 authors,
images under `public/blog/<slug>/` and `public/authors/`). Reuses the shared
`Site` layout (NavBar / CtaBand / Footer) — no chrome was rebuilt. Ported from
the three blog DCs (`Agenta Blog`, `Agenta Blog Post`, `Agenta Author (Dark)`).

## Files added

- `src/content.config.ts` — `posts` (glob `*.mdx`) and `authors` (glob `*.json`)
  collections with Zod schemas.
- `src/lib/blog.ts` — shared helpers: `formatDate` (`MMM D, YYYY`),
  `categoryGradient` (the category→tint map), `byDateDesc`, `socialIcon`
  (platform→`/icons/social-*.svg`), `relatedPosts`.
- `src/components/PostCard.astro` — one component, four layouts (`featured` /
  `secondary` / `grid` / `related`). Shows the hero image when present, else the
  category-tinted gradient + faded Agenta symbol.
- `src/components/InlineCta.astro` — the in-article CTA card; copy from
  `site.json → inlineCta`.
- `src/components/CategoryFilter.tsx` — `client:visible` React island (tablist,
  roving tabindex, arrow-key nav).
- `src/pages/blog/index.astro` — featured section (rank-1 primary + ranks 2-3
  secondary) + category filter + full grid (date desc).
- `src/pages/blog/[slug].astro` — static paths from the posts collection; header,
  hero, byline, MDX body, "More from the blog" (4 related), CTA band.
- `src/pages/blog/author/[slug].astro` and `src/pages/blog/author/index.astro`.
- Blog CSS (prose, cards, filter, reflow) added to `src/styles/global.css`;
  Shiki theme + author redirects added to `astro.config.mjs`.

## Schema decisions

- **Strict where the migration is uniform, optional where it varies.** All 37
  posts carry the same 11 required keys, so `slug`/`title`/`description`/
  `category` (enum `Article`|`Engineering`)/`date` (`z.coerce.date()`)/`author`
  (`reference('authors')`) are required. `heroImage`/`ogImage`/`featuredRank`/
  `readingTime`/`tags` are optional (only the 3 featured posts have
  `featuredRank`; a future heroless post falls back to the gradient card).
  `featured` defaults to `false`. Both schemas use `.passthrough()` so any extra
  frontmatter never breaks the build.
- Images live under `/public` and are referenced by absolute path **string**
  (not Astro's `image()` helper), matching how the migration wrote them.
- The glob-loader entry id (filename without extension) is the URL slug and the
  author-reference key — they line up, so `author: mahmoud-mabrouk` resolves.

## MDX fixes (content was breaking the build — 6 edits, no content deleted)

The `.mdx` parser reads `<` and `{` as JSX. Six literals in prose broke or would
have mis-rendered; each was escaped, preserving the displayed text:

- `<5 prompts` → `&lt;5 prompts` in `git-vs-prompt-management-tools.mdx` and
  `prompt-versioning-guide.mdx` (table cells).
- `<1ms` → `&lt;1ms` (×2) in `top-llm-gateways.mdx`.
- `Vk∈{0,1}` → `Vk∈\{0,1\}` in
  `how-to-evaluate-rag-metrics-evals-and-best-practices.mdx`.
- `"The result is {the score}"` → `\{the score\}` in
  `llm-as-a-judge-guide-to-llm-evaluation-best-practices.mdx` (this one was
  invalid JS and hard-failed the build; the others would have silently
  mis-rendered). Future migrations should escape `<`/`{` in MDX prose.

## Code-block + font handling

- Syntax highlighting via Shiki (built into `@astrojs/mdx`), theme `github-dark`,
  `wrap: false` (`astro.config.mjs`). 14 posts have fenced blocks
  (python/bash/ts/json/yaml/js).
- `.ag-prose pre` gets padding, `border-radius:12px`, a hairline, and
  **`overflow-x:auto`** so long lines scroll horizontally instead of wrapping or
  overflowing the 720px prose column. `pre`/`pre code`/`pre span` are forced to
  `var(--font-mono)` (Geist Mono) with `!important` (overriding Shiki's inline
  font). Inline `code` uses a `:not(pre) > code` selector so the yellow Geist
  Mono chip never leaks into fenced blocks. Markdown tables get
  `display:block; overflow-x:auto` for the same no-overflow reason.
- Verified on `/blog/cicd-for-llm-prompts` (python + bash + a markdown table):
  built HTML shows `class="astro-code github-dark"` with a dark `#24292e`
  background; the dist CSS confirms `overflow-x:auto` + `var(--font-mono)!important`
  on `.ag-prose pre`.

## Author routing choice (FLAG FOR DESIGN)

Author pages live at **`/blog/author/[slug]`** per the DESIGN. The LIVE Framer
site used `/authors/[slug]` (and `/authors`). Redirects from the old paths to the
new ones were added in `astro.config.mjs` (`/authors` → `/blog/author`, plus one
per author). Confirm this is the intended canonical route before launch; if the
live `/authors` route must stay canonical for SEO, flip the page directory and
reverse the redirects.

## Verification

- `pnpm build` → **passes**, `output: "static"`, **48 pages** built (37 posts +
  `/blog` + 3 author pages + author index + the rest of the site). No errors
  after the 6 MDX escapes above.
- `pnpm dev` curl checks (server stopped after): `/blog` 200, `/blog/
  cicd-for-llm-prompts` 200 (code post), `/blog/author/mahmoud-mabrouk` 200,
  `/blog/author` 200, `/blog/author/ilyes-rezgui` 200 (empty-state),
  `/authors/mahmoud-mabrouk` 301 → `/blog/author/mahmoud-mabrouk`.
- Index: `#blog-grid[data-filter="All"]` with 40 server-rendered cards, 3 filter
  pills, rank-1 featured primary correct. Filtering is CSS-only off a
  `data-filter` attribute the island sets, so it works pre-hydration / with JS
  off (default "All" shows everything).

## DESIGN-DECISION items to flag (migration caveats — carried from
`research/blog-migration.md`)

1. **All 37 posts are attributed to `mahmoud-mabrouk`.** Framer renders bylines
   client-side, so the scrape couldn't recover real authors. Ilyes Rezgui and
   Nizar Karkar have author records + avatars + working `/blog/author/*` pages
   but **zero posts assigned** (their pages show the empty state). Someone with
   CMS knowledge must reassign the posts they actually wrote (likely some
   RAG/chunking/technical guides). Biggest item to fix.
2. **~16 dates are inferred, not authoritative.** A `2026-02-25` cluster came
   from crawl/last-modified timestamps; Launch-Week posts were sequenced by day
   order; several "top N" guides were dated from title/content cues. The blog
   sorts by `date` desc, so wrong dates change the ordering — cross-check against
   real publish dates.
3. **Internal body links are still absolute `agenta.ai` / `cloud.agenta.ai`
   URLs.** E.g. `https://agenta.ai/blog/prompt-versioning-guide` instead of the
   local `/blog/prompt-versioning-guide`. They work (they hit the live site) but
   should be rewritten to site-relative paths so in-site navigation stays on the
   new site. Not done here to avoid mass-editing content before routing is final.
4. `readingTime` is auto-computed (~238 wpm) and `<InlineCTA />` is auto-placed
   after the first H2 — both fine for launch, editorial may want to revisit.
5. **Byline placement differs from the DC.** The brief asked for an avatar byline
   (name/role/date/reading time, linked to the author page) directly under the
   title; the DC put a plain date·reading-time line at the top and a separate
   author bio card at the bottom. We implemented the brief's single top byline
   (with avatar) and did not add the bottom bio card. Flag if the bottom card is
   wanted.
6. **Author bio pages are simplified.** The Mahmoud DC has bespoke
   Background/Expertise/Notable-Work cards; the author JSON only carries a `bio`
   string + socials, so the page renders the bio paragraph + socials + that
   author's posts. The richer structured bio would need new author fields.

---

## QA fixes — 2026-06-26

Applied fixes for findings F1, F4, F2, and F3 from `research/qa-report.md`.
`pnpm build` passes (48 pages, no errors) after all four fixes.

### F1 — Blog category filter now works (MAJOR)

Root cause: PostCard rendered `display:flex` in the element's `style` attribute.
Inline styles override stylesheet rules regardless of specificity, so the filter
CSS (`#blog-grid[data-filter="..."] > ... { display:none }`) never applied.

Fix:
- `src/styles/global.css` — added a `.ag-card { display: flex; }` rule. The
  filter rule wins because `#blog-grid` (ID selector) has higher specificity than
  `.ag-card` (class selector).
- `src/components/PostCard.astro` — removed `display:flex` from the inline
  `style` attribute on both card variants (secondary and all others). The flex
  layout is now entirely controlled by the stylesheet.

### F4 — Footer broken links fixed (MAJOR)

All three dead routes in `src/components/Footer.astro` corrected:
- "Privacy Policy" (Legal column): `/privacy` → `/privacy-policy`
- "DPA": `/dpa` → `https://docs.agenta.ai/` (external; exact DPA URL TBD)
- "Trust Center": `/trust` → `https://trustcenter.agenta.ai` (external)
- "Privacy policy" (bottom bar): `/privacy` → `/privacy-policy`

### F2 — Mobile horizontal overflow on /imprint and /contact fixed (MINOR)

The two-column definition list (`grid-template-columns: 160px 1fr`) left only
~133 px for the value column. The word `(haftungsbeschränkt)` could not wrap,
pushing the page to ~418 px on a 390 px viewport.

Fix: added `overflow-wrap:anywhere` to every `<dd style="...">` element in both
`src/pages/imprint.astro` and `src/pages/contact.astro`.

### F3 — Explorer keyboard accessibility (MINOR, a11y)

Clickable `<div>` elements in `src/components/TemplateExplorer.tsx` were not
reachable by keyboard (no `role`, no `tabIndex`, no key handler).

Fix: added `role="button"`, `tabIndex={0}`, and an `onKeyDown` handler (fires
onClick on Enter or Space) to six elements:
- The five template-row divs in the left panel
- The Skills section header
- Each individual skill-item accordion header
- The Agents.md section header
- The Tools section header
- Each individual tool-item accordion header

## Live-map reconciliation (2026-06-27)

Reconciled the Astro build's URLs and links to match the LIVE agenta.ai site
exactly, so we never break the live URL map (SEO/canonical requirement: add, don't
break). Source of truth:
`research/live-url-link-map.md` + `research/framer-access-and-authors.md`.

### Routing move — authors now at `/authors/<slug>/`

- **Moved** author pages from `/blog/author/[slug]` → `src/pages/authors/[slug].astro`,
  and the authors index from `/blog/author` → `src/pages/authors/index.astro`.
  **Deleted** the old `src/pages/blog/author/` directory (it was our invention; it
  does not exist on the live site).
- **Removed** the `/authors/* → /blog/author/*` redirects from `astro.config.mjs`
  (they inverted the live URL). `/authors/<slug>` now SERVES the page.
- **Updated every internal author link** to `/authors/<slug>`: the post byline in
  `src/pages/blog/[slug].astro`, the author cards in the authors index, and the
  blog CSS comment header in `src/styles/global.css`.
- Verified: `/authors/ilyes-rezgui`, `/authors/nizar-karkar`, `/authors`,
  `/authors/mahmoud-mabrouk` all 200; old `/blog/author/*` now 404 (correct).

### Author trailing-slash note (DEPLOY / wrangler) — ACTION FLAG

Live canonical for author profiles uses a **trailing slash**
(`/authors/ilyes-rezgui/`) while every other page is no-slash canonical
(`/blog`, `/pricing`, `/authors` index). Astro's default directory build format
already emits `/authors/<slug>/index.html`, so the file is served at the slash
path. **However**, `wrangler.jsonc` currently sets
`"html_handling": "drop-trailing-slash"`, which canonicalizes ALL paths to
no-slash at the Cloudflare edge — that would force `/authors/<slug>/` →
`/authors/<slug>` (no slash), the OPPOSITE of the live canonical.

We deliberately did NOT change `html_handling` globally, because a single global
trailing-slash setting can only be "all slash" or "all no-slash" and flipping it
would break the no-slash convention of every other page. **The author
trailing-slash is therefore a deploy-config concern, not a framework one.** To
match live exactly at deploy time, override trailing-slash handling for the
`/authors/*` profile paths only (e.g. a Cloudflare redirect rule
`/authors/:slug` → `/authors/:slug/` 308, or a Workers route), leaving the global
`drop-trailing-slash` for everything else. Internal hrefs intentionally use the
no-slash form (`/authors/<slug>`); the live site 308s no-slash → slash, so this is
inbound-link-safe either way.

### Co-author support (content schema + rendering)

- Added optional `coAuthors: z.array(reference("authors"))` to the `posts` schema
  in `src/content.config.ts` (primary `author` stays; co-authors are the rest).
- Added helpers in `src/lib/blog.ts`: `authorRefs(post)` (primary first,
  de-duped), `isAuthorOf(post, id)` (primary OR co-author), and
  `authorPosts(id, all)` (every post an author contributed to, by date).
- The post byline (`src/pages/blog/[slug].astro`) now renders ALL contributors:
  stacked avatars + "Name & Name", each linking to `/authors/<slug>`.
- An author page (`src/pages/authors/[slug].astro`) and the index post-counts now
  include a post if the author is primary OR a co-author.

Author attribution applied (per `framer-access-and-authors.md`):

| Post | `author` | `coAuthors` | Live byline |
|------|----------|-------------|-------------|
| the-ultimate-guide-for-chunking-strategies | `ilyes-rezgui` | — | Ilyes (sole) |
| top-llm-gateways | `ilyes-rezgui` | — | Ilyes (sole) |
| top-10-techniques-to-improve-rag-applications | `mahmoud-mabrouk` | `[ilyes-rezgui]` | Mahmoud + Ilyes |
| how-to-evaluate-rag-metrics-evals-and-best-practices | `mahmoud-mabrouk` | `[nizar-karkar]` | Mahmoud + Nizar |

The other 33 posts stay sole-`mahmoud-mabrouk`. Verified counts:
Ilyes 3 posts, Nizar 1, Mahmoud 35 (33 sole + 2 co); both co-authored posts
appear on BOTH contributors' pages.

### Nav + footer link fixes (full list)

**NavBar** (`src/components/NavBar.astro`) — rewritten to match live:
- **Removed** the phantom "Product" dropdown (live nav has no Product item).
- **Docs** → `https://agenta.ai/docs` (was `docs.agenta.ai`).
- **Resources** dropdown (real hrefs): Tutorial →
  `…/docs/tutorials/cookbooks/capture-user-feedback`, Changelog →
  `…/docs/changelog/main`, Roadmap → `…/docs/roadmap`.
- **Community** dropdown (real hrefs): Github →
  `github.com/Agenta-AI/agenta/discussions`, Slack → **nav** token
  `zt-37pnbp5s6-mbBrPL863d_oLB61GSNFjw`, Youtube → `youtube.com/@agentaAI`,
  Linkedin → `linkedin.com/company/agenta-ai/`, X → `twitter.com/agenta_ai`.
- Dropdowns open on hover (desktop CSS) + click (touch/keyboard); mobile menu
  renders the items inline under a section label.

**Footer** (`src/components/Footer.astro`):
- **Product** column (5) → live docs URLs: Prompt Engineering
  `…/docs/prompt-engineering/quick-start`, Evaluation
  `…/docs/evaluation/evaluation-from-ui/quick-start`, Human annotation
  `…/docs/evaluation/human-evaluation/quick-start`, Deployment
  `…/docs/prompt-engineering/managing-prompts-programatically/deploy`,
  Observability `…/docs/observability/overview`. (No `/product/*` pages exist;
  those internal links were removed.)
- **Resources** → Docs `…/docs/`, Tutorial `…/docs/tutorials/cookbooks/capture-user-feedback`,
  Changelog `…/docs/changelog/main`, Roadmap `…/docs/roadmap`, Blog `/blog`,
  Status `status.agenta.ai/`.
- **Legal** → Imprint `/imprint`, Terms `…/docs/administration/security/terms-of-service`,
  Privacy `…/docs/administration/security/privacy-policy`, DPA
  `…/docs/administration/security/dpa`, Trust Center `trustcenter.agenta.ai/`.
  (Footer Legal points to DOCS, not to `/terms` or `/privacy-policy`.)
- **Contact** — KEPT at our `/contact` page (user override; live uses `/imprint`).
- **Social** — added the missing **YouTube** icon (new
  `public/icons/social-5.svg`, mapped in `lib/blog.ts`); Slack uses the **footer**
  token `zt-2yewk6o2b-DmhyA4h_lkKwecDtIsj1AQ` (DIFFERENT from the nav token);
  GitHub/LinkedIn/X normalized to the live hrefs.
- **Bottom-bar "Privacy policy"** → termly direct
  (`…policyUUID=ce8134b1-…`), matching the live duplicate bottom-bar link
  (bypasses the `/privacy-policy` redirect).

### Terms / Privacy — termly-vs-docs FLAG (confirm if needed)

The live site has TWO different destinations for the legal policies, and we
replicate both:
- **`/terms` and `/privacy-policy` standalone slugs** → 308-redirect to **termly**
  (exact UUIDs from the live redirect chain). Implemented via the `redirects`
  block in `astro.config.mjs` PLUS `public/_redirects` for a hard **308 at the
  Cloudflare edge** (Astro's static `redirects` alone only emits a client-side
  `<meta refresh>`; in `astro dev` it returns 301, the edge gives 308). The old
  holding pages `src/pages/terms.astro` and `src/pages/privacy-policy.astro` were
  deleted (a page file + a redirect for the same route conflict in Astro).
- **Footer Legal "Terms"/"Privacy" links** → **docs**
  (`…/docs/administration/security/...`), matching live.

**FLAG for the user:** live `/terms` and `/privacy-policy` go to **termly**, while
footer-legal points to **docs**. We mirrored the live split exactly. If you would
rather have `/terms` itself point to docs (instead of termly), change the two
entries in `astro.config.mjs` + `public/_redirects`.

### Verification

- `pnpm build` passes — 46 pages, 0 warnings/errors.
- Internal-link 404 sweep over `dist/`: every internal page href resolves to a
  built file (0 MISSING). Nav/footer external links match the map's exact hrefs.
- Dev-server spot-checks (running on :4321): `/authors/ilyes-rezgui` 200,
  `/authors/nizar-karkar` 200, `/authors` 200; co-authored
  `/blog/how-to-evaluate-rag-metrics-evals-and-best-practices` byline shows
  Mahmoud & Nizar; `/blog/top-llm-gateways` byline shows Ilyes; `/terms` and
  `/privacy-policy` redirect to the termly UUIDs.
- **Not touched** (per scope): pricing, the `/contact` and `/imprint` page bodies,
  the landing page content.
- **Unresolved links from the map:** none. Every nav/footer/byline link resolves
  to a real route or an intended external URL.

# SEO + analytics + 404 (2026-06-27)

Added the SEO foundation, PostHog analytics, and a custom 404 to the `website/`
package. Reused the existing shared chrome (`Site.astro` → `Base.astro` owns
`<head>`); no chrome was rebuilt. `pnpm build` passes.

## What landed

### 1. SEO foundation
- **`site`** was already `https://agenta.ai` in `astro.config.mjs`.
- **Per-page metadata** flows through the layout. `Base.astro` now computes a
  `<link rel="canonical">` from the current path + `site`, honouring the live
  trailing-slash map: author profile pages (`/authors/<slug>/`) keep the slash;
  the homepage stays `/`; everything else is stripped to no-slash. Each page
  already passes a real `<title>`/`description` (blog posts use post
  title+description; legal/utility pages set their own; the homepage uses the
  layout defaults).
- **OpenGraph + Twitter** tags live in `Base.astro`: `og:type` (prop, defaults
  `website`, blog posts pass `article`), `og:site_name`, `og:title`,
  `og:description`, `og:url` (= canonical), `og:image`, plus
  `twitter:card=summary_large_image`, `twitter:site=@agenta_ai`, title,
  description, image. `og:image` resolves to the page's hero/`ogImage` when
  present, else the designed default card.
  - **Default OG card:** copied the 1200×630 `og-default.png` from
    `Agenta landing page pivot/assets/blog/` to **`public/og/default.png`**
    (committable — Agenta's own marketing image, not licensed/proprietary).
- **Sitemap:** added **`@astrojs/sitemap`** to `astro.config.mjs`. A `serialize`
  hook rewrites Astro's default trailing-slash URLs to the live canonical form
  (author profiles keep the slash, all else no-slash), and a `filter` drops the
  redirect-only slugs (`/terms`, `/privacy-policy`, `/launch-week-1/2`) so they
  are not advertised as indexable. Output: `dist/sitemap-index.xml` +
  `dist/sitemap-0.xml` (45 canonical URLs).
- **robots.txt:** `public/robots.txt` — `Allow: /` for all agents +
  `Sitemap: https://agenta.ai/sitemap-index.xml`.
- **JSON-LD structured data:**
  - Blog posts (`blog/[slug].astro`) emit a schema.org **`Article`** (headline,
    description, image, `datePublished` from the post date, `author` list
    including co-authors with their `/authors/<slug>/` URLs, publisher = Agenta
    `Organization` with logo).
  - Homepage (`index.astro`) emits **`Organization`** (logo + `sameAs` social
    profiles from the live map) **+ `WebSite`**.
  - The 404 (`404.astro`) carries `<meta name="robots" content="noindex,
    follow">`.

### 2. Analytics — PostHog (decided tool)
- PostHog is wired in `Base.astro`, mirroring the docs site
  (`docs/docusaurus.config.ts`): the official snippet, `api_host:
  "https://alef.agenta.ai"` (our reverse proxy), `ui_host:
  "https://us.posthog.com"`, project key from **`PUBLIC_POSTHOG_KEY`**.
- **Off unless keyed.** When `PUBLIC_POSTHOG_KEY` is unset (local dev, forks, a
  keyless CI build) the snippet is omitted entirely — nothing phones home.
  Verified: 0 pages contain `posthog.init` with no key; all 47 pages contain it
  (with the placeholder key, never a hardcoded real key) when the var is set.
- **Google Analytics (GA4)** is a clearly-commented, env-gated **optional** in
  `Base.astro`, **off by default**, gated on **`PUBLIC_GA_ID`**. The `gtag`
  snippet only renders when that var is set.

### 3. Custom 404
- **`src/pages/404.astro`** uses the `Site` layout (nav + footer), an on-brand
  dark panel, a GT Alpina (`--text-display-xl`) heading, a short message, a
  yellow `404` chip, and three `Button`s back to **home / blog / docs**. CTA band
  suppressed (`showCta={false}`). Cloudflare already serves it via
  `wrangler.jsonc` `not_found_handling: "404-page"`. Built as `dist/404.html`.

## Env vars introduced (USER MUST SET for production)
- **`PUBLIC_POSTHOG_KEY`** — PostHog project API key (public, client-side).
  Required to turn analytics on in prod. Documented in the new **`.env.example`**.
- **`PUBLIC_GA_ID`** (optional) — GA4 measurement id (`G-XXXXXXXXXX`). Leave
  blank to keep GA off.

### Decision flags for the user
- **GA4 property id is NOT set.** The marketing site needs its **own** GA4
  property — do **not** reuse the docs' GTM container (`G-LTF78FZS33`). Create a
  property, then set `PUBLIC_GA_ID`. Until then GA stays off (PostHog is the
  primary, decided tool).
- **CI must inject `PUBLIC_POSTHOG_KEY`** at build time (it is read from the
  build env, not committed). Without it the production build ships with no
  analytics. `.env` is gitignored; only `.env.example` is committed.
- **OG image is the generic default card** for every non-post page (homepage,
  pricing, legal). Per-page bespoke OG cards can be added later by passing
  `ogImage` to `Site`/`Base`.

## Verification
- `pnpm build` passes — 47 pages, 0 errors. `find dist -type f | wc -l` = **145**
  (well under Cloudflare's 20k static-asset cap).
- Present in `dist/`: `sitemap-index.xml`, `sitemap-0.xml`, `robots.txt`,
  `404.html`, `og/default.png`.
- A blog post (`/blog/prompt-drift`) HTML contains: canonical (no slash),
  `og:type=article`, `og:image`→post hero, `twitter:card`, and a valid `Article`
  JSON-LD (`@type` parsed OK). Homepage carries valid `Organization` + `WebSite`
  JSON-LD and `og:type=website`. Pricing (no hero) falls back to the default OG
  card. Author profile canonical keeps its trailing slash.
- PostHog snippet present on all built pages **only** when `PUBLIC_POSTHOG_KEY`
  is set; the env-var placeholder is used, never a real key.
- **Files changed:** `astro.config.mjs` (sitemap), `src/layouts/Base.astro`
  (head/SEO/analytics), `src/layouts/Site.astro` (pass-through props),
  `src/pages/index.astro` (homepage JSON-LD), `src/pages/blog/[slug].astro`
  (Article JSON-LD + layout-driven OG), `src/pages/404.astro` (new),
  `public/robots.txt` (new), `public/og/default.png` (new), `.env.example`
  (new), `package.json` (+`@astrojs/sitemap`).

---

# Deploy + font infra scaffolding (2026-06-27)

Infrastructure to get from "builds locally" to "deployed on Cloudflare with licensed
fonts injected at build time." No deploy yet; no credentials required for this slice.
`pnpm build` passes with NO Cloudflare creds in env (146 dist files, 47 pages).

## Font fallback stacks

All six `@font-face` rules in `src/styles/tokens.css` already carried
`font-display: swap` from the original port. The CSS custom properties in `:root`
already define real fallback stacks:

| Variable | Licensed face | Fallback |
|---|---|---|
| `--font-display` | GT Alpina | `Georgia, "Times New Roman", serif` |
| `--font-bitmap` | PP Mondwest | `"Courier New", monospace` |
| `--font-sans` | Inter | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` |
| `--font-ui` | Geist | `"Inter", -apple-system, BlinkMacSystemFont, sans-serif` |
| `--font-mono` | Geist Mono | `ui-monospace, "SF Mono", Menlo, Consolas, monospace` |

The `@font-face` src declarations remain — they load the local woff2 when present
(local dev with the licensed files, or a build after `fetch-fonts.mjs` succeeds).
When the files are absent the browser falls through to the stack above. No visual
change when the fonts are present; graceful degradation when they are not.

## R2 font-fetch prebuild script

**`website/scripts/fetch-fonts.mjs`** (new):
- Downloads the six licensed woff2 files from the `agenta-website-fonts` R2 bucket
  into `public/fonts/` using `npx wrangler r2 object get`.
- Reads `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` from env. If either is
  absent, or if wrangler fails for any file, logs a warning and exits 0 — the build
  always continues.
- Skips files already present on disk (incremental-build friendly).

**`website/package.json`** changes:
- `"prebuild": "node scripts/fetch-fonts.mjs"` — npm/pnpm runs it automatically
  before every `pnpm build`, no manual step needed.
- `"wrangler": "^3.114.0"` added to `devDependencies` — used by the prebuild
  script and by `npx wrangler deploy`.

Verification: `pnpm build` with no env creds → prebuild prints the no-creds warning
and exits 0 → `astro build` runs, 47 pages built, 146 dist files. Vite warns about
the missing woff2 files (expected; they are served at runtime from `public/fonts/`
once present). No build errors.

## Cloudflare config changes

**`website/wrangler.jsonc`** — added:
- A comment on `html_handling: "drop-trailing-slash"` cross-referencing the
  trailing-slash caveat for `/authors/*` and `public/_redirects`.
- A commented-out `routes` block for the `agenta.ai` custom domain (uncomment when
  ready; requires `agenta.ai` to be on Cloudflare under the same account). The
  `custom_domain: true` variant handles DNS and TLS automatically.

**`website/public/_headers`** (new):
- `/_astro/*` → `Cache-Control: public, max-age=31536000, immutable`
  (hashed build assets; forever-cacheable).
- `/fonts/*` → `Cache-Control: public, max-age=31536000, immutable`
  (fonts are content-stable once deployed).
- `/og/*`, `/icons/*`, `/logos/*`, `/blog/*`, `/authors/*` → 1-week cache with
  stale-while-revalidate.
- `/*` catch-all → 60-second TTL, stale-while-revalidate 1 hour, plus
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy: strict-origin-when-cross-origin`.

## Trailing-slash approach for /authors/*

**Problem:** The live `agenta.ai` canonical for author profile pages is
`/authors/<slug>/` (trailing slash). `wrangler.jsonc` has
`html_handling: "drop-trailing-slash"`, which globally 308-redirects any
slash-suffixed path to no-slash — the opposite of what the live site does.

**Why `_redirects` cannot fix this without a loop:** A `_redirects` rule
`/authors/:slug → /authors/:slug/ 308` would add the slash, but `html_handling`
strips it again before serving, creating an infinite redirect. The two mechanisms
run at the same Workers asset layer with `html_handling` taking precedence.

**Implemented approach:** Documented in `public/_redirects` (detailed comment block)
and in `deploy-runbook.md` (Step 8). Two options:

1. **Workers Transform Rule (recommended, exact canonical match):** A Cloudflare
   Zone-level URL Rewrite rule (`^/authors/[^/]+$` → append `/`) rewrites the URL
   before the Worker asset handler sees it. No redirect loop; browser canonical
   is `/authors/<slug>/`. Requires a dashboard click by Mahmoud.

2. **Switch `html_handling` to `"auto-trailing-slash"`** (simpler alternative):
   Cloudflare reads the HTML to decide whether to add or drop a trailing slash,
   which naturally preserves the slash for directory-style pages. Lower risk of
   unintended side effects than the current global `drop-trailing-slash`.
   Test on a staging deploy before switching in production.

Until one of these is wired, author profile pages still load at `/authors/<slug>`,
just without the trailing slash canonical. No content gap — the correct HTML is
served either way.

## Deploy artifacts (drafts)

**`docs/design/marketing-website/deploy/deploy-website.yml`** (new draft):
- GitHub Actions workflow: trigger on push to `main` affecting `website/**`, plus
  manual `workflow_dispatch`.
- Steps: checkout → pnpm setup → install → fetch-fonts → build → wrangler deploy.
- Secrets consumed: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `PUBLIC_POSTHOG_KEY`.
- NOT in `.github/workflows/` yet (comment at top: "copy here when ready").

**`docs/design/marketing-website/deploy-runbook.md`** (new):
- Ordered checklist: create API token (exact 4-scope table) → create R2 bucket →
  upload licensed fonts → set GitHub secrets → enable GH Actions workflow → first
  manual deploy → add custom domain → wire author trailing-slash Transform Rule →
  optional Workers Builds for PR previews.

## What still needs the token (N1)

**One thing:** Mahmoud creates the Cloudflare API token with 4 scopes
(Account Settings:Read, Workers Scripts:Edit, Workers R2 Storage:Edit,
Workers Routes:Edit) and supplies the Account ID. Once those two values are in
the environment, everything else — bucket creation, font upload, first deploy,
custom domain — runs headlessly via wrangler.

# Framer Server API re-import (2026-06-27)

Goal: (A) re-import the blog cleanly from the Framer Server API, (B) extract
site-level settings. Outcome: **(A) blocked on the project URL; (B) done from the
live site.** No blog content was overwritten — the existing 37 posts / 3 authors
are untouched.

## What landed

- `website/scripts/import-framer.mjs` — the importer. Reads the key from
  `process.env.FRAMER_API_KEY` only (no secret in the file; safe to keep/commit).
  Has an `introspect` command (Step 1, no writes). Connect logic tries the key
  alone first, then reports exactly what's missing.
- `docs/design/marketing-website/research/framer-site-settings.md` — full Step-3
  extraction (title, description, og:image, icons, redirects, URL-param behavior).
- Downloaded Framer assets into `website/public/`: `favicon.png` (32×32),
  `apple-touch-icon.png` (180×180), `og/framer-default.png` (1280×720). The
  existing tuned `og/default.png` (1200×630) was NOT clobbered, and `Base.astro`
  was NOT rewired (extraction task only).

## Step 1 — connect: BLOCKED (need project URL)

`framer-api@0.1.17` `connect(projectUrlOrId, token?)` requires a project URL/ID
in addition to the key. The key alone fails:

```
[connect] failed via key-as-arg0: Invalid project URL or ID: fr_47t3...   (the key is a token, not a project id)
[connect] failed via key-as-token-no-project: FRAMER_PROJECT_URL environment variable is required
```

The project ID is not discoverable from the public site (Framer never ships it in
the HTML/bundles — only `framerusercontent.com` asset URLs and `data-framer-*`
attributes are public). So Steps 1 and 2 cannot run until the owner provides
`framer.com/projects/<id>` (set it as `FRAMER_PROJECT_URL`, then
`node scripts/import-framer.mjs introspect`). This was the documented STOP
condition, so nothing was clobbered.

## Step 2 — re-import: NOT RUN (depends on Step 1)

Blocked by the same missing project URL. The author-mapping verification
(`chunking → Ilyes`, `rag-metrics → Mahmoud + Nizar`) could not be checked against
the API. The current files already encode that mapping (chunking → `ilyes-rezgui`,
rag-metrics → `mahmoud-mabrouk` + co-author `nizar-karkar`), so they were left
as-is rather than guessed-at.

## Step 3 — site settings: DONE (from live HTML)

Parsed from the live `agenta.ai` `<head>` (raw HTML) + redirect probes. Highlights:

- **Title:** `Agenta - Prompt Management, Evaluation, and Observability for LLM apps`
- **Description:** "Agenta is an open-source platform for building robust LLM
  Application. It provides tools for prompt engineering, evaluation, debugging,
  and monitoring of complex LLM Apps."
- **og:image:** 1280×720 PNG (`framer-default.png`). Live site has NO `theme-color`.
- **Icons:** Framer ships PNG favicon (32×32) + apple-touch (180×180); no `.ico`/SVG.
- **URL params:** the live Framer site DOES preserve query/utm params across
  internal navigation (inline `data-preserve-internal-params` script that merges
  `location.search` into every same-origin link href, excluding `framer_variant`,
  skipped for bots). This is the persistence behavior to replicate next.
- **Redirects:** live `/privacy-policy` now 308s to the newer Termly
  `app.termly.io/document/privacy-policy/...` URL, while our `_redirects` still
  uses the older `policy-viewer/...` form — flagged for update. `/terms` matches.

Full table in `framer-site-settings.md`.

## Verification

- `pnpm build` → green. 47 pages, 149 `dist/` files. New favicon/apple-touch/
  framer-default OG assets present in `dist/`.
- Posts: 37 (unchanged). Authors: 3 (unchanged).
- Per-author (current content, NOT re-imported): mahmoud-mabrouk = 35 primary;
  ilyes-rezgui = 2 primary + 1 co-author; nizar-karkar = 1 co-author.

## Still needed from the owner

- The **Framer project URL/ID** (`framer.com/projects/<id>`). It unblocks Step 1
  (introspect + verify author mapping) and Step 2 (clean re-import), and lets
  `getProjectInfo()` / `getRedirects()` give authoritative site settings instead
  of the live-HTML inference above.

---

# Head items: GA4 + icons + OG + url-params + legal-route unify (2026-06-27)

Applied a batch of six `<head>` / redirect items to `src/layouts/Base.astro`,
`public/_redirects`, and `astro.config.mjs`. Source of truth for the extracted
values: `research/framer-site-settings.md`.

## 1. Google Analytics 4

- `Base.astro` — `gaId` now defaults to `"G-368ZWZSH5D"` via
  `import.meta.env.PUBLIC_GA_ID ?? "G-368ZWZSH5D"` (was `undefined` / gate-off).
  GA4 now loads on every page by default. Override or disable by setting
  `PUBLIC_GA_ID` to a different id or to `""` (empty string) in the env.
- `.env.example` — updated the `PUBLIC_GA_ID` entry from blank to `G-368ZWZSH5D`
  with a revised comment.
- The existing `gtag.js` snippet + `gtag("config", ...)` block was already wired;
  only the default value changed.

## 2. Favicon + apple-touch-icon

- `Base.astro` — replaced the SVG favicon link
  (`/logos/Agenta-symbol-dark-accent.svg`) with two `<link rel="icon">` entries
  for `/favicon.png` (generic + `sizes="32x32"`) and a
  `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`.
- Both files (`public/favicon.png`, `public/apple-touch-icon.png`) were already
  downloaded in the previous slice (framer-site-settings extraction).
- Verified in `dist/index.html`: `favicon.png` (×2) and `apple-touch-icon.png` (×1).

## 3. Site title + description defaults

- `Base.astro` — default `title` kept as `"Agenta — Build agents and AI
  automations that work"` (the agents-pivot wording already there).
- Default `description` updated from the old placeholder copy to the extracted
  Framer site description: `"Agenta is an open-source platform for building robust
  LLM Application. It provides tools for prompt engineering, evaluation, debugging,
  and monitoring of complex LLM Apps."` This matches the live site's default
  meta-description, covering pages that do not supply their own.
- Both fields carry a `// DECISIONS-NEEDED Q4` comment: the owner should lock
  pivot-specific wording and update them before launch.

## 4. Social preview (OG) default

- `og:image` + `twitter:image` already defaulted to `public/og/default.png`
  (1200×630, correct OG ratio + new branding). No code change needed.
- Added a comment in `Base.astro` noting that `public/og/framer-default.png`
  (1280×720, Framer original) is archived for comparison.
- Verified in `dist/index.html`: `og:image` is
  `https://agenta.ai/og/default.png` (absolute URL).

## 5. URL-parameter preservation

Added an inline `<script is:inline set:html={...}>` in `Base.astro` (after the
GA4 block) that replicates the Framer `data-preserve-internal-params` behavior:

- Runs on every page, dependency-free.
- Skips when `location.search` is empty, when `navigator.webdriver` is set, or
  when the UA matches `bot|google|yandex|ia_archiver|crawl|spider`.
- Deletes `framer_variant` from the source params before propagating.
- Uses `URL` to identify same-origin links (`a[href^="/"]`, `a[href^="./"]`,
  `a[href^="../"]`); leaves cross-origin links untouched.
- Merges params into each link's href: target's own params win on conflict;
  existing params are not duplicated.
- Applies on `DOMContentLoaded` (or immediately if the document is already loaded).
- Verified: 3 occurrences of `framer_variant`/`location.search` in `dist/index.html`.

## 6. /terms + /privacy-policy → docs (legal-route unify)

Owner decision: unify the standalone redirect slugs to the same docs URLs the
footer Legal links use, replacing the old termly.io destinations.

Changes:
- `public/_redirects` — updated `/terms` and `/privacy-policy` from termly URLs
  to `https://agenta.ai/docs/administration/security/terms-of-service` and
  `.../privacy-policy` (hard 308 at the Cloudflare edge).
- `astro.config.mjs` — updated the `redirects` block to the same docs URLs
  (meta-refresh fallback for the static output; both must stay in sync).
- The footer Legal column already pointed to these exact docs URLs
  (`src/components/Footer.astro`); `/terms` and `/privacy-policy` now
  agree.

Verified in `dist/_redirects`: both entries point to the docs URLs with `308`.

## Verification

- `pnpm build` — **clean, 47 pages, 149 `dist/` files**, 0 errors.
- `dist/index.html` spot-checks:
  - GA4 id `G-368ZWZSH5D` present (×2: `gtag/js` src + inline init).
  - `favicon.png` (×2) and `apple-touch-icon.png` (×1) in `<head>`.
  - `og:image` = `https://agenta.ai/og/default.png` (absolute URL).
  - URL-param script (`location.search`, `framer_variant`) present (×3).
- `dist/_redirects`: `/terms` and `/privacy-policy` → docs URLs with `308`.

## For the owner (DECISIONS-NEEDED)

- **Q4 — Site title wording:** current default is the agents-pivot line.
  Framer live title is "Agenta - Prompt Management, Evaluation, and
  Observability for LLM apps". Confirm which to keep (or provide final
  pivot copy). Update `title` default in `Base.astro`.
- **Q4 — Site description:** updated to the Framer copy as a neutral
  baseline. Replace with pivot-specific description once wording is locked.
- **Q4 — OG card:** `public/og/default.png` is the current default (1200×630).
  Swap to a pivot-specific card when the design supplies one; change the
  `ogImage` fallback in `Base.astro` or replace the file in-place.

## Framer clean re-import (executed) — 2026-06-27

Replaced the earlier hand-migrated blog (which carried an inferred
`2026-02-25` date cluster and a manually-patched author byline) with a clean
pull straight from the Framer Server API. The importer is
`website/scripts/import-framer.mjs` (`import` mode; `introspect` mode unchanged).
Credentials sourced from `~/.agenta-marketing.env` (`FRAMER_API_KEY` +
`FRAMER_PROJECT_URL`); the key never enters the repo.

### What the script does now

- Connects via `framer-api`, reads the **Blog** (40 items) and **Authors**
  (3 items) collections.
- **Draft filter:** uses the API's own `CollectionItem.draft` flag (the field
  is exposed on fetched items). Three items carry `draft: true` and are skipped;
  a lorem-description / `Placerholder`-tag fallback heuristic is also in place
  but was not needed (the flag caught all three).
- Wipes and rewrites `src/content/posts/`, `src/content/authors/`,
  `public/blog/`, and `public/authors/` so the result is a pure mirror.
- HTML → MDX converter (hand-rolled, no jsdom): h2–h6, ordered/unordered + nested
  lists, fenced code (`data-language` → md fence lang), blockquotes, inline
  code/bold/italic/links, images, and YouTube `<iframe>`s. Tables/figures are
  kept as **raw HTML** (MDX renders it) with the per-cell `<p dir="auto">`
  wrappers and `data-preset-tag`/`dir` attributes stripped. MDX-hostile chars
  (`<`, `{`, `}`) in prose are escaped exactly once via a placeholder-protect
  pass (code spans, links, and bold/italic markup are protected so they are
  never double-escaped; restore loops to handle a link whose text was bold).
- **Date** comes from the API `Date` field as true ISO (`YYYY-MM-DD`).
- **Authors** resolved from `Author` / `Author 2` / `Author 3` collection
  references (the ref value is the author slug); primary first, rest become
  `coAuthors`. A co-authored post lists on every contributor's `/authors/<slug>`
  page (existing `authorPosts` logic).
- **Images** (hero + in-body `framerusercontent.com`) downloaded to
  `public/blog/<slug>/` (`hero.<ext>`, `img-N.<ext>`); refs rewritten to
  `/blog/<slug>/...`; in-body `alt` preserved. Author avatars →
  `public/authors/<slug>.<ext>`.
- **Internal links:** `agenta.ai/blog|authors|pricing|launch-week-*` →
  site-relative; `agenta.ai/docs/...` kept **absolute**
  (`https://agenta.ai/docs/...`, the path-proxied docs app, matching the Footer
  Legal links); `docs.agenta.ai` + all other hosts untouched.
- **InlineCTA:** one `<InlineCTA />` per post, injected after the first H2 (or
  after the first block if a post has no H2). Verified exactly 1 per post ×37.

### Results

- **Posts imported: 37** (matches the live published set exactly).
- **Drafts skipped: 3** (all via the API `draft` flag):
  - `the-guide-for-building-reliable-llm-applications-for-product-and-ai-teams`
    (also the `Placerholder` tag + lorem description)
  - `product-teams-guide-llm-evaluation`
  - `iso-42001-llm-compliance`
- **Distinct CMS `Tag` values → category mapping** (the live blog filter pills
  are exactly Article / Engineering; the original granular Tag is preserved
  verbatim in each post's `tags[]` so no data is dropped):
  - `Article` (10) → **Article**
  - `Engineering` (5) → **Engineering**
  - `Product Updates` (12) + `Product Update` (4) → **Article**
  - `Essay` (1) → **Article**
  - `Company Updates` (1) → **Article**
  - `Comparison` (3) + `Comparisons` (1) → **Engineering** (technical "top N"
    deep-dives, per the blog-migration rationale)
  - `Placerholder` → draft, skipped
  - Net: 26 Article / 11 Engineering. The two-category enum in
    `content.config.ts` was **not** widened — every real tag maps cleanly into
    Article/Engineering, and the source tag is retained in `tags[]`.
- **Per-author counts (API attribution is authoritative — supersedes the earlier
  manual fix):**
  - Primary: `mahmoud-mabrouk` 35, `ilyes-rezgui` 2
  - Co-author: `ilyes-rezgui` 1 (on `top-10-techniques-to-improve-rag-applications`),
    `nizar-karkar` 1 (on `how-to-evaluate-rag-metrics-evals-and-best-practices`)
  - So Ilyes's `/authors/ilyes-rezgui` page lists 3 posts (2 primary + 1 co),
    Nizar's lists 1, Mahmoud's lists 35 — all verified in `dist/`.
- **True dates confirmed:** 0 posts carry the old inferred `2026-02-25`; dates
  now span 2024-01 → 2026-02 from the API `Date` field.

### Verification

- `pnpm build` — **clean, 47 pages, 192 `dist/` files**, 0 errors.
- 37 `dist/blog/<slug>/index.html` post pages + the blog index (37 cards).
- 3 `/authors/<slug>` pages; co-authored bylines render all authors
  (RAG-eval = Mahmoud + Nizar; top-10 = Mahmoud + Ilyes).
- Images resolve in `dist`; tables + code blocks + YouTube iframes render;
  table-cell HTML entities (`&lt;`, `&amp;`) display correctly.
- No null-byte / placeholder leakage, no stray `framerusercontent` URLs, no
  loose HTML entities in prose, no leftover `data-preset-tag`/`dir="auto"`.

### Notes / judgment calls

- The category mapping collapses the CMS's 8 granular tags into the site's two
  filter categories. If the design later wants the richer taxonomy surfaced
  (e.g. a "Product Updates" pill), widen the `category` enum and remap — the
  source tag is already preserved in `tags[]`, so no re-import is needed.
- `readingTime` is normalized from the messy `Read` field (`"10 mn"`,
  `"4 Mins Read"`, `"5mn"`, `"10 minutes"`) to `"<n> min read"`.
- Author avatars are now `.png` (the Framer source format); the old repo had
  `.jpg`. `content.config.ts` stores `avatar` as a plain string, so this is
  transparent.

---

# Branding-kit favicons (2026-06-27)

Replaced the single Framer-extracted `favicon.png` with the official Agenta
branding-kit favicon set from the `branding-kit` Cloudflare R2 bucket.

## Files added to `public/`

| File | Source (R2 key) | Size |
|------|-----------------|------|
| `favicon.ico` | `branding-kit-final/Favicon/favicon.ico` | 16 KB |
| `favicon-16x16.png` | `branding-kit-final/Favicon/favicon-16x16.png` | 553 B |
| `favicon-32x32.png` | `branding-kit-final/Favicon/favicon-32x32.png` | 1.2 KB |
| `apple-touch-icon.png` | `branding-kit-final/Favicon/apple-touch-icon.png` | 8.1 KB (overwrites the Framer 180×180) |
| `android-chrome-192x192.png` | `branding-kit-final/Favicon/android-chrome-192x192.png` | 9.1 KB |
| `android-chrome-512x512.png` | `branding-kit-final/Favicon/android-chrome-512x512.png` | 33 KB |
| `site.webmanifest` | `branding-kit-final/Favicon/site.webmanifest` | 263 B (then edited) |

All are Agenta's own brand assets (not licensed/proprietary) and may remain in
the repo per the `website/AGENTS.md` asset policy.

## Changes to `src/layouts/Base.astro`

Replaced the old three-line block (two `favicon.png` links + apple-touch-icon)
with the standard five-element set:

```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
```

The comment was updated to reference this notes section. `favicon.png` is
no longer referenced anywhere in the source.

## Changes to `public/site.webmanifest`

The downloaded manifest had blank `name`/`short_name` and `#ffffff`
background/theme colors. Updated:
- `name` → `"Agenta"`
- `short_name` → `"Agenta"`
- `theme_color` → `"#0A0A0B"` (matches the site's dark base color)
- `background_color` → `"#0A0A0B"`
- `start_url` → `"/"`
- `icons` array already pointed to the correct android-chrome paths.

## Verification

- `pnpm build` — **clean, 47 pages, 198 `dist/` files**, 0 errors.
- All 7 favicon files present in `dist/` (favicon.ico, favicon-16x16.png,
  favicon-32x32.png, apple-touch-icon.png, android-chrome-192x192.png,
  android-chrome-512x512.png, site.webmanifest).
- `dist/index.html` head contains all five `<link>` entries (favicon.ico,
  favicon-32x32.png, favicon-16x16.png, apple-touch-icon.png, and
  site.webmanifest).
- `favicon.png` is still present in `public/` (the old Framer copy) but is
  no longer referenced. Remove it when convenient.

## Logos + placeholder meta + noindex

Built 2026-06-27.

### Logos swapped from branding-kit R2 bucket

All logo files in `public/logos/` replaced with official SVGs from
`branding-kit-final/Logo/` in the `branding-kit` R2 bucket, keeping the exact
same filenames so no code references changed:

| File | R2 source | Size |
|---|---|---|
| `Agenta-logo-full-dark.svg` | `…/Logo/Full/Agenta-logo-full-dark.svg` | 6 272 bytes |
| `Agenta-logo-full-light.svg` | `…/Logo/Full/Agenta-logo-full-light.svg` | 6 278 bytes |
| `Agenta-symbol-dark.svg` | `…/Logo/Symbol/Agenta-symbol-dark.svg` | 599 bytes |
| `Agenta-symbol-light.svg` | `…/Logo/Symbol/Agenta-symbol-light.svg` | 601 bytes |
| `Agenta-symbol-dark-accent.svg` | `…/Logo/Symbol/Agenta-symbol-dark-accent.svg` | 600 bytes |

All five downloaded with `npx wrangler r2 object get … --file …`, confirmed
non-zero and valid (`<svg …>` root element). All five appear in `dist/logos/`
after build. The `Agenta-logo-full-light.svg` variant is now present even though
the initial slice only referenced the dark variant; it is now downloaded in case
any future component needs it.

Referenced-by component summary (unchanged after swap):
- `NavBar.astro`, `Footer.astro`, `src/pages/index.astro`, `src/pages/blog/[slug].astro` — `Agenta-logo-full-dark.svg`
- `CtaBand.astro` — `Agenta-symbol-light.svg`
- `Hero.astro`, `Monitor.astro`, `PostCard.astro` — `Agenta-symbol-dark.svg`
- `Environments.astro` — `Agenta-symbol-dark-accent.svg`

### Placeholder title + description with visible warning

The site default title and description already carried `DECISIONS-NEEDED Q4`
code comments in the frontmatter of `src/layouts/Base.astro`. Two additions:

1. HTML comments emitted into every built page, directly before `<title>` and
   `<meta name="description">`:
   ```html
   <!-- PLACEHOLDER copy — needs final pivot wording, see docs/design/marketing-website/DECISIONS-NEEDED.md Q4 -->
   ```
2. Build-time `console.warn` in `astro.config.mjs` (runs on every `pnpm build`):
   ```
   [website] PLACEHOLDER title/description still in use — finalize pivot copy (DECISIONS-NEEDED.md Q4)
   ```

Current values (both still placeholder):
- Title: `Agenta — Build agents and AI automations that work`
- Description: `Agenta is an open-source platform for building robust LLM Application. It provides tools for prompt engineering, evaluation, debugging, and monitoring of complex LLM Apps.`

### Noindex flag for test/preview deploys (`PUBLIC_NOINDEX`)

New `PUBLIC_NOINDEX` env var (documented in `.env.example`). When set to `"true"`:

- `src/layouts/Base.astro` emits `<meta name="robots" content="noindex, nofollow">` on
  every page, immediately after `<link rel="canonical">`.
- `src/pages/robots.txt.ts` (a new Astro endpoint) serves `User-agent: *\nDisallow: /`.
  The static `public/robots.txt` was removed so the endpoint takes precedence
  (Astro skips an endpoint when a same-named file exists in `public/`).

Default (unset or any value other than `"true"`) = normal production behavior:
no noindex tag, allow-all robots.txt with sitemap pointer.

### Verification

- `pnpm build` (default) — **clean, 47 pages, 199 `dist/` files** (one more than
  the previous build because `robots.txt` is now generated by an endpoint rather
  than copied from `public/`), 0 errors. Placeholder warning printed.
- All 5 official logo SVGs present in `dist/logos/`.
- `dist/index.html` contains the two `PLACEHOLDER` HTML comments; noindex meta
  absent.
- `dist/robots.txt` = allow-all + sitemap (default).
- `PUBLIC_NOINDEX=true pnpm build` — builds clean; `dist/index.html` contains
  `<meta name="robots" content="noindex, nofollow">`; `dist/robots.txt` =
  `User-agent: *\nDisallow: /`.

---

# Image optimization + alt text (2026-06-27)

Compressed all raster images to WebP, added lazy loading and decoding attributes
to every blog image, and filled in missing alt text across all 37 posts.

## 1. Image compression (WebP conversion)

**Script:** `website/scripts/optimize-images.mjs`
- Finds every `.png` / `.jpg` / `.jpeg` under `public/blog/` and `public/authors/`.
- Re-encodes to WebP at quality 80, caps max width at 1600px (no upscale).
- Writes `<name>.webp`, removes the original raster (1:1 swap, no file count increase).
- Skips `.svg` and `.gif` (already optimal / animated).
- Loads sharp from the pnpm virtual store at
  `node_modules/.pnpm/sharp@0.34.5/node_modules/sharp` (not hoisted by default).

**Results:**
- Images converted: 109 / 109 (106 blog + 3 author avatars)
- Payload before (raster only): **10.87 MB**
- Payload after (WebP): **4.22 MB**
- Saved: **6.65 MB (61.2%)**
- Notable wins: `open-source-llm-observability/hero.png` 1142 KB → 43 KB (−96%),
  `prompt-playground/hero.png` 1251 KB → 68 KB (−95%),
  `product-update-november-2024/hero.png` 491 KB → 23 KB (−95%).
- A handful of small diagrams (tiny PNG screenshots with flat colors) grew slightly
  under WebP — this is normal; WebP is lossless-competing with already-compressed
  PNGs. The overall savings are dominant.

**Content references rewritten:** All 37 `.mdx` posts (frontmatter `heroImage` /
`ogImage` and body `![]()` refs) and all 3 author `.json` files updated from
`.png`/`.jpg` to `.webp` by `scripts/optimize-images.mjs` (conversion manifest at
`scripts/image-manifest.json`).

## 2. Lazy loading, dimensions, and alt text

### Hero image (`src/pages/blog/[slug].astro`)
- Added `loading="eager"` + `fetchpriority="high"` (above-the-fold; LCP candidate).
- Added `decoding="async"`.
- Added explicit `width="968" height="544"` (16:9 aspect ratio, matches CSS
  `aspect-ratio:16/9`). This prevents layout shift even if the image loads slowly.
- `alt={title}` was already present (the post title is the correct description).

### Card images (`src/components/PostCard.astro`)
- Changed `alt=""` → `alt={title}` on both card variants (secondary and vertical).
  Cards show the post's hero image as a visual thumbnail; the title is the
  appropriate alt text.
- Added `decoding="async"` to both variants. `loading="lazy"` was already present.
- Decorative fallback (the faded Agenta symbol shown when there is no hero image)
  keeps `alt=""` — intentional, it is purely decorative.

### MDX body images (`src/components/BlogImage.astro` — new)
Custom Astro component wired as the MDX `img` renderer via
`<Content components={{ InlineCTA, img: BlogImage }} />` in `[slug].astro`.
Every markdown image in the post body now gets:
- `loading="lazy"` + `decoding="async"` automatically.
- `display:block; max-width:100%; height:auto; border-radius:8px; margin:0 auto` for
  consistent prose layout.
- The markdown `alt` text is preserved exactly; BlogImage passes it through.

### Author avatars
- `src/pages/authors/[slug].astro` — large avatar image: added `loading="eager"`,
  `fetchpriority="high"`, `decoding="async"` (above-the-fold, LCP candidate).
  `alt={name}` and explicit `width/height` were already present.
- `src/pages/authors/index.astro` — card avatars: added `loading="lazy"`,
  `decoding="async"`. `alt={author.data.name}` was already present.

### Alt text audit

| Category | Count | Status |
|---|---|---|
| Body images with author-written alt | 22 | Present and preserved |
| Body images imported with no alt (`![]()`) | 48 | **Filled in** based on nearest heading context |
| Hero images (`alt={title}`) | 37 | Correct (post title) |
| Card images (`alt={title}`) | All variants | Fixed (was `alt=""`) |
| Author avatars (`alt={name}`) | 3 | Already correct |
| Decorative SVG fallbacks (no-hero gradient cards) | — | `alt=""` intentional |

The 48 originally-empty body image alts were populated using the nearest heading
above each image (e.g. platform name for review posts, section title for guides).

## 3. Cloudflare file count

`find dist -type f | wc -l` = **199** after the full build. Well under the
Cloudflare free tier 20,000-file cap (paid: 100,000).

## Verification

- `pnpm build` passes — 47 pages, 0 errors, 199 dist files.
- Zero leftover `.png`/`.jpg` refs for `/blog/` paths in `dist/` (grep confirmed).
- Spot-check (`/blog/how-to-evaluate-rag-metrics-evals-and-best-practices`):
  hero uses `.webp` with `loading="eager"`, `fetchpriority="high"`, `decoding="async"`,
  explicit `width/height`; body images use `.webp` with `loading="lazy"`,
  `decoding="async"`, non-empty alt.
- Blog index (`/blog`): PostCard images carry `alt=<title>`, `loading="lazy"`,
  `decoding="async"`.
- JSON-LD `Article.image` in the built HTML already references `.webp` paths
  (the JSON-LD reads `heroImage` from frontmatter, which was rewritten above).

## Files changed

| File | Change |
|---|---|
| `website/scripts/optimize-images.mjs` | New — conversion script |
| `website/scripts/image-manifest.json` | New — per-image before/after report |
| `public/blog/**/*.webp` | 109 new WebP images (109 originals removed) |
| `public/authors/*.webp` | 3 converted author avatars |
| `src/content/posts/*.mdx` | 37 files — `.png`/`.jpg` → `.webp` + alt text fills |
| `src/content/authors/*.json` | 3 files — avatar paths → `.webp` |
| `src/components/BlogImage.astro` | New — MDX `img` renderer with lazy/decoding |
| `src/pages/blog/[slug].astro` | Import BlogImage; hero eager+fetchpriority+dimensions |
| `src/components/PostCard.astro` | alt={title} + decoding=async on card images |
| `src/pages/authors/[slug].astro` | Avatar: eager+fetchpriority+decoding |
| `src/pages/authors/index.astro` | Avatar cards: lazy+decoding |
