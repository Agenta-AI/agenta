# Docs redesign — implementation plan

Design source: [Agenta docs redesign](https://claude.ai/artifact/Jr8AeNPQHZ3jAkPXrcMtQf)
(three artboards: docs page, changelog, roadmap; light theme only — dark is derived here).

## What the design changes

| Area | Today | Design |
| --- | --- | --- |
| Header | Two rows (56px logo/search/CTAs + 48px section links), 6.5rem tall, centred at 95%/1550px | One 60px row, full-bleed: logo + wordmark + bordered version pill · search (260px, right-aligned, `⌘K` chip) · GitHub / Slack / theme icon buttons (32px) · "Book a demo" text link · black "Get started" (32px, radius 10) |
| Section nav | Second header row | Top of the left sidebar: an icon rail (Docs, Reference, Roadmap, Changelog, Self-host, Enterprise), 32px rows, radius 8, active fill; a full-bleed divider; then the page sidebar |
| Sidebar | 300px, no border, groups at 14px, 25px group gap | 272px, `border-right`, padding `20px 24px 48px 32px`; group label 12px/600; links 28px rows at 13px, radius 8, active fill + weight 500; 20px between groups |
| Content column | ~1030px, h1 32px, body 16px/1.6 | max-width 720px, padding `40px 56px 64px`; breadcrumb 13px; h1 30/38 600 −0.02em; lead 17/28 secondary; body 15/26; h2 20/28 600 with 44px top gap |
| TOC | 14px links, default indent | 240px aside; "On this page" 12px/600; links 13px, 5px vertical, nested indent 14px, active weight 500 |
| Media | Inline `height="400/500"` iframes, bare `<Stream>`, mixed radii | One frame for every video / image: 16:9, radius 10, 1px border, elevated background, optional caption strip below (`border`, radius bottom 10) |
| Pagination | Two stock cards | "Next" card: 12px label + 14px/500 title + arrow, radius 10, padding `14px 18px` |
| Changelog list | Centred title, 9rem meta column, pill version, `Read more →` | Left-aligned title + description (max 720); rows of 152px meta (13px date, mono 11px version chip) + body (h2 20px, media frame, 15/26 summary, "Read more" with underline + arrow); 40px between rows; sidebar lists **Releases** |
| Roadmap | Heavy h2 with accent underline, 12px-radius cards with hover lift, coloured label chips, `8/22/2026` dates | Section h2 20px with count in mono; flat cards (radius 10, `18px 20px`), title 15/600, date `22 August 2026` 13px, **neutral** category pill; sidebar rail carries Status / Category jump links |
| Palette | Warm greys (`#f7f4f2 …`) mapped onto Infima primary | Neutral greys: bg `#ffffff`, elevated `#f6f5f3`, active `#f0efed`, border `#e5e5e3`, border-strong `#d7d7d7`, text `#242424` / `#676770` / `#848b8c` |

Dark palette (derived; not in the artifact): bg `#141413`, elevated `#1c1c1b`, active
`#262625`, border `#2a2a29`, border-strong `#3a3a38`, text `#f5f5f4` / `#a3a3a0` / `#7a7a77`.
Brand yellow stays on the logo only.

## What is wrong with the current CSS

`docs/src/css/custom.css` (1852 lines, 258 `!important`) carries:

- Invalid values that silently do nothing: `text-decoration-color: --`, `rgba((--grey90), 0.05)`,
  `border: 1px solid --borderdefault`, `background-color: var(--background-color)` (undefined).
- `:global(...)` in a plain stylesheet (3 rules) — only valid in CSS modules, so the navbar
  padding rules never apply.
- 13 selectors bound to hashed module class names (`cardContainer_fWXF`, `title_kItE`,
  `generatedIndexPage_DMd5`, `tocCollapsibleButtonExpanded_MG3E`, `list_eTzJ`, …) that break
  on every Docusaurus upgrade.
- `--ifm-link-color` and `--ifm-heading-color` set twice in `:root` with different values.
- Layout width hacks (`.main-wrapper` at 95% / 1550px) that the full-bleed design removes.
- Everything for the two-row navbar (`.two-row-navbar`, `--ifm-navbar-height: 6.5rem`).

## Plan

Order matters: tokens first so every later step reads the new variables.

### 1. Tokens and base typography — `src/css/custom.css` → split

Split the single file into imports that map onto the site's regions, and delete what the
design retires:

```
src/css/custom.css        ← @imports only (+ tailwind directives)
src/css/tokens.css        ← :root light, [data-theme=dark], Infima mappings
src/css/typography.css    ← fonts, headings, body, links, inline code
src/css/navbar.css        ← single-row header, CTAs, DocSearch button
src/css/sidebar.css       ← rail + doc sidebar + TOC
src/css/content.css       ← article column, admonitions, cards, pagination, details
src/css/media.css         ← the one media frame + Stream skeleton
src/css/search.css        ← DocSearch modal + /search page (moved, unchanged)
src/css/changelog.css     ← list + entry page
src/css/api.css           ← OpenAPI sidebar method badges (moved, unchanged)
```

Tokens: replace the warm `--greyNN` scale and the `--bg*/--content*/--border*` aliases with
the design's neutral scale under the same alias names (`--bgdefault`, `--bgelevated1`,
`--bgelevated2`, `--contentprimary/secondary/tertiary`, `--borderlight/default/dark`), so
the swizzled components keep working. Add `--radius-md: 8px`, `--radius-lg: 10px`. Set
`--ifm-navbar-height: 60px`, `--doc-sidebar-width: 272px`, heading sizes (30/20/17/15),
`--ifm-font-size-base: 15px`, `--ifm-line-height-base: 1.73`.

Fix the invalid rules, drop the hashed selectors (replace with `[class*="cardContainer"]`
style attribute selectors that already exist beside them), keep the Prism token colours and
DocSearch modal work as they are.

Fonts: keep Inter + IBM Plex Mono (decision below).

### 2. Single-row header — `src/theme/Navbar/Content/index.tsx` + `styles.module.css`

- Render one row: `[toggle] [logo] [version pill]  …  [search] [GitHub] [Slack] [theme] [Book a demo] [Get started]`.
- Stop rendering `left` items on desktop; they move to the rail (step 3). Keep passing them
  to the mobile `PrimaryMenu` — it already reads `themeConfig.navbar.items` directly, so
  nothing changes there.
- Search sits right of centre at 260px (`DocSearch-Button` restyled: elevated bg, border,
  radius 10, placeholder 13px, `⌘K` chip bordered).
- Remove the `two-row-navbar` class and every rule keyed on it. `navbar__inner` becomes
  full-bleed with `padding: 0 32px`.
- GitHub / Slack become 32px icon buttons (`navbar.css`); the theme toggle matches.
- Version pill: 22px, `border: 1px solid var(--borderdark)`, radius 6, 12px text, chevron.

### 3. Section rail — new `src/components/SectionRail/`

One component, three mounts:

```tsx
<SectionRail />   // renders themeConfig.navbar.items with position === "left"
```

It reuses `<NavbarItem>` for each item so active-state resolution (`type: "doc"` uses the
docs plugin's active context; plain `to:` links use `isNavLink`) and the `NavIcon` icons
come for free. The rail only adds a wrapper class; `sidebar.css` styles
`.sectionRail .navbar__link` as 32px rows.

Mounts:

- `src/theme/DocSidebar/Desktop/Content/index.tsx` (swizzle, wrap): rail + divider above
  `DocSidebarItems`.
- `src/theme/BlogSidebar/Desktop/index.tsx` (swizzle, eject): rail + divider + "Releases"
  list. Set `blogSidebarCount: "ALL"` and `blogSidebarTitle: "Releases"` in the config.
  Sidebar items carry `title/permalink/date` only, so each row shows the title and the
  date (`22 Aug 2026`), no version chip.
- `src/pages/roadmap.tsx`: wrap in a new `src/components/SidebarShell/` (sidebar column +
  main column with the same widths as `DocRoot/Layout`) so the roadmap and changelog share
  the docs frame. The roadmap's rail is followed by its own **Status** and **Category** jump
  links (anchors to the section headings; categories scroll to the first matching card).

Mobile (< 997px): the rail is hidden; the hamburger `PrimaryMenu` already lists the same
items with icons.

### 4. Blog layout — `src/theme/BlogLayout/index.tsx` (swizzle, eject)

Replace the `container / row / col--3 / col--7` grid with the same sidebar + main structure
`DocRoot/Layout` uses, so the changelog list and entry pages sit in the docs frame (sidebar
272px flush left, content padded `40px 56px`). Drop the `.blog-post-page .col` overrides in
CSS that fought the grid.

### 5. Changelog list and entry — `BlogListPage`, `BlogPostItem`, `changelog.css`

- `BlogListPage/styles.module.css`: header left-aligned, h1 30px, description 17px secondary,
  max-width 720.
- `BlogPostItem/styles.module.css`: grid `152px minmax(0,1fr)`, gap 32px, row padding
  `40px 0`, `border-top` between rows; date 13px secondary; version chip mono 11px with
  border and radius 5; title 20/28; summary 15/26; "Read more" 14px with a bottom border and
  an inline arrow SVG (replace the `→` character).
- Entry page: title 30px, date 13px secondary, media in the shared frame, body max-width 720.

### 6. Media frame — `media.css` + `src/components/Video.tsx`

One rule set for every embed in `.theme-doc-markdown` and `.blog-wrapper`:

```css
iframe[src*="youtube"], iframe[src*="cloudflarestream"], div:has(> iframe[src*="cloudflarestream"]) {
  width: 100%; height: auto !important; aspect-ratio: 16 / 9;
  border: 1px solid var(--borderlight); border-radius: var(--radius-lg);
  background: var(--bgelevated1);
}
```

`height: auto !important` neutralises the 36 entries that hardcode `height="400|500"`, so no
content edits are needed. The `<div style="display:flex …">` wrappers collapse to a plain
block via `.markdown div:has(> iframe) { display: block }`. Images get the same border and
radius. The Stream skeleton (`streamSkeleton.ts`) is unchanged; its radius follows the token.

Add `<Video src caption>` to `MDXComponents` for new pages: a `<figure>` with the frame and
the caption strip from the design. Existing pages are not migrated.

### 7. Doc page column — `content.css`, `sidebar.css`

- `.theme-doc-markdown` max-width 720; first h1 no extra top padding (the 40px comes from
  the main padding).
- Breadcrumbs stay off (`breadcrumbs: false`); the design's `Docs / Getting started` row is
  not adopted.
- TOC: 240px column, 13px links, `padding: 5px 0`, nested `padding-left: 14px`.
- Pagination: keep the stock component; restyle to the "Next" card (label 12px, title
  14px/500, arrow via `::after`).
- Admonitions and doc cards: radius 10, `border: 1px solid var(--borderlight)`, no tint in
  light; keep the existing per-type border colours.

### 8. Roadmap — `src/pages/roadmap.tsx`, `roadmap.module.css`, `src/data/roadmap.ts`

- Wrap in `SidebarShell` (step 3).
- Section header: h2 20/28 600, `border-bottom`, count on the right in mono 11px.
  Rename "In progress" → "Building next" to match the design.
- Cards: flat (no hover lift/shadow), radius 10, `18px 20px`; title 15/600; date formatted
  `22 August 2026` (reuse the `Intl.DateTimeFormat("en-GB")` from `BlogPostItem`); labels
  rendered neutral (`variant="neutral"` — the prop already exists). The `color` field in
  `roadmap.ts` stays but is unused by the page.
- Keep the "Feature Requests" section and its CTA (not in the design; restyled only).

### 9. Verification

- Run `pnpm build` in `docs/` (broken-link / anchor checks are `throw`).
- Screenshot light + dark at 1440 and 390 for: a docs page with video, `/changelog`, an
  entry page, `/roadmap`, `/reference/api-guide/overview`, a `/1.0/` versioned page.

## Not doing

- Migrating the 101 changelog entries to `<Video>`; CSS covers them.
- Rewriting the DocSearch modal or the `/search` page (moved into `search.css` as-is).
- Touching the mobile hamburger sidebar beyond what the token change gives it.
- Changing the Prism syntax colours.
- Versioned 1.0 docs content; only the frame changes.

## Decisions (settled)

1. **Font.** Keep Inter + IBM Plex Mono; the artifact's system stack is not adopted.
2. **Roadmap chips.** Neutral, as designed.
3. **Changelog sidebar.** Title + date per row; no version chip (not available on sidebar items).
4. **Breadcrumbs.** Stay off.
