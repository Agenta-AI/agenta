# Agenta Website — Design → Implementation Handoff

This folder is the **contract** between the design source-of-truth (HTML design
files in this project) and the production website (your real codebase). It is
written to be **self-sufficient**: an engineer or coding agent who was never in
the design conversation can implement or update the site from these documents
alone.

It is also written to be **re-read on every change**. When the design updates,
the relevant doc here updates with it. You diff the doc, implement the diff. The
HTML is never shipped as-is — it is the spec.

---

## TL;DR for the implementing agent

1. **The HTML files in this project are design references, not production code.**
   They are built as "Design Components" (`*.dc.html`) — a streaming-HTML
   prototyping format. Do **not** copy their runtime (`support.js`, `<x-dc>`,
   `<sc-for>`, `dc-import`). Recreate the *look, layout, copy, and behavior* in
   the target stack.
2. **Visual style is fully tokenized.** Every color, font, radius, and shadow
   comes from `_ds/agenta-brand-<id>/tokens/*.css`. Port those tokens verbatim
   into your stack (CSS variables, Tailwind theme, whatever). Never re-derive a
   hex by eye. See `TOKENS.md`.
3. **Content is separated from layout.** Pages render from data shaped exactly
   like the files in `../content/`. That shape **is** the CMS schema. See
   `CONTENT_MODEL.md`.
4. **Responsiveness is specified per page.** See `RESPONSIVE.md`.
5. Read the docs in this order: `TOKENS` → `SITEMAP` → `CONTENT_MODEL` →
   `COMPONENTS` → `RESPONSIVE`.

---

## Fidelity

**High-fidelity.** These mocks carry final colors, typography, spacing, copy,
and interaction intent. Recreate them pixel-faithfully using the token values in
`TOKENS.md`. Where a measurement isn't in a doc, read it off the source `.dc.html`
file named in `SITEMAP.md` (the markup is plain inline-styled HTML — every px is
literal).

---

## The repeatable workflow (why this folder exists)

```
        DESIGN TRACK (Anthropic/this project)         IMPLEMENTATION TRACK (your repo)
        ──────────────────────────────────────        ───────────────────────────────
  1.  Iterate on a page as  *.dc.html
  2.  Update the matching handoff/*.md  +  content/* sample
  3.  Hand this folder (or a diff) to the coding agent  ───────►  4. Read changed doc, implement delta
                                                                  5. Pull the SAME tokens, render from
                                                                     the SAME content shapes
  ◄──────────────────  6. Agent replies with questions / decisions (stack, CMS, gaps)
  7.  We fold that feedback back into the designs + docs
```

The two tracks stay in sync because they share two anchors that never drift:
**the token files** and **the content shapes**. Everything else is derived from
those.

---

## What's decided vs. what's open

**Decided (don't re-litigate):**
- Visual system — locked in `_ds/.../tokens/` and documented in `TOKENS.md`.
- Page inventory, content model, component inventory, responsive behavior — this folder.
- Copy and content structure — the `.dc.html` files + `../content/` samples.

**Open — for the implementing team to choose and report back:**
- **Framework / SSG.** Next.js, Astro, SvelteKit, etc. The design is stack-agnostic. Recommendation in `SITEMAP.md` but not a requirement.
- **CMS.** Headless (Sanity / Contentful / Payload) vs. git-based MDX (Contentlayer / Velite). `CONTENT_MODEL.md` gives the schema in a CMS-neutral form plus mapping notes for both styles.
- **Hosting / self-hosting** specifics.
- **Analytics, search, i18n, comment system** — not yet designed; flag if needed.

When you pick these, send the decisions back as a short note (see
"Feedback loop" below) so the designs can adapt (e.g. MDX vs. portable-text
changes how rich blog bodies are authored).

---

## Folder map

```
handoff/
  README.md          ← you are here
  TOKENS.md          ← colors, type, radii, shadows — the visual contract
  SITEMAP.md         ← every page, route, source file, purpose
  CONTENT_MODEL.md   ← CMS collections + field schemas (blog, pricing, globals)
  COMPONENTS.md      ← reusable UI components + props, mapped to the design system
  RESPONSIVE.md      ← breakpoints + per-page reflow behavior

../content/          ← REAL-shaped sample data = the CMS schema, by example
  site.json            global nav, footer, CTA band
  pricing.json         the entire pricing page as data
  authors/*.json       author records
  posts/*.md           blog posts (frontmatter = post schema; body = MDX)

../_ds/agenta-brand-<id>/   the bound design system (tokens, components, assets)
../assets/                  page-specific images already used by the mocks
../*.dc.html                the design source files themselves
```

---

## Feedback loop

This handoff is bidirectional. When the implementing agent has questions,
blockers, or decisions, write them as a short markdown note (stack chosen, CMS
chosen, anything ambiguous, anything missing). The user relays that note back
into the design conversation, and we update the designs + these docs in
response. Treat every doc here as **living** — versioned alongside the designs,
not a one-time export.
