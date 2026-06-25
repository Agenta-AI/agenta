# Sitemap — pages, routes, source files

Each row is a page in the design. **Source file** is the `.dc.html` to read for
exact markup/measurements. **Route** is the suggested production URL. **Data**
names the content shape it renders from (see `CONTENT_MODEL.md`).

| Page | Suggested route | Source `.dc.html` | Renders from |
|---|---|---|---|
| Landing (Agents, dark) | `/` | `Agenta Landing - Agents (Dark).dc.html` | `site.json` + page-local copy |
| Landing (Agents, light) | `/` (light variant) | `Agenta Landing - Agents.dc.html` | same |
| Pricing | `/pricing` | `Agenta Pricing (Dark).dc.html` | `pricing.json` + `site.json` |
| Blog index | `/blog` | `Agenta Blog (Dark).dc.html` | `posts/*` + `site.json` |
| Blog post | `/blog/[slug]` | `Agenta Blog Post (Dark).dc.html` | `posts/<slug>.md` + `authors/*` |
| Author page | `/blog/author/[slug]` | `Agenta Author - Mahmoud (Dark).dc.html` | `authors/<slug>.json` + that author's `posts/*` |

> All five page files above exist in the project and are cross-linked via the
> nav (logo → home, Pricing → /pricing, Blog → /blog) plus in-page links
> (post cards → post, byline → author). The **light** landing variant uses the
> design-system `NavBar` component, whose links are internal to that component.

## Theme note

The current site is the **dark** marketing treatment. A **light** landing
variant also exists (`Agenta Landing - Agents.dc.html`). Build the production
site theme-aware from the start (a `data-theme` attribute or CSS class switching
the dark-surface tokens in `TOKENS.md`), rather than hard-coding `#0A0A0B`.

## Shared chrome (every page)

- **NavBar** — logo (links `/`), center links (Product/Pricing/Docs/Resources/
  Community — varies slightly per page), right side `Book a demo` (outline) +
  `Get started` (yellow). Collapses to a hamburger + slide-down menu on mobile.
  Active link is yellow. See `COMPONENTS.md → NavBar`.
- **CTA band** — full-bleed yellow (`--surface-cta`) section near the page
  bottom: GT Alpina heading, body, `Start building` (dark) + `Read the docs`
  (outline), faded Agenta symbol on the right (hidden on mobile). Copy in
  `site.json → ctaBand`.
- **Footer** — dark `#100F11`, brand blurb + 4 social chips on the left, 4 link
  columns on the right, bottom bar with copyright + privacy. Columns in
  `site.json → footer`.

## Suggested framework (open decision)

For a content/marketing site with a blog + pricing and a desire to self-host,
either:
- **Astro** — content-collections map 1:1 to the `content/` folder; ships near-zero
  JS; ideal for mostly-static marketing. Interactive bits (pricing toggle, nav
  menu, blog filter) as islands.
- **Next.js (App Router)** — if you want one framework for marketing + the app
  console, or richer server features. MDX via `@next/mdx` or Contentlayer.

Both are fine. This is the implementing team's call — report it back so we tailor
`CONTENT_MODEL.md` authoring guidance (MDX vs. portable text).
