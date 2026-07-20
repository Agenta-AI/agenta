# Proposal — Agenta marketing website rebuild

Synthesized from the four research files in `./research/`. This is a proposal, not
a locked plan. Decisions still needed are at the bottom.

## The shape of the work

Move `agenta.ai` off Framer into this monorepo as a git-based, MDX-authored,
auto-deployed site with the dark redesign. Reuse what the repo already has (the
docs pipeline, the PostHog setup, the design tokens + content shapes). Keep the
core flows (demo, get-started) byte-identical to the live site. Build the
information architecture so future SEO pages (comparison, use-cases, academy) and
interactive widgets (a live dashboard) drop in without a re-architecture.

## Key facts the research established

- **Repo is ready for a third surface.** There is no root `package.json`; `web/`
  (Next app) and `docs/` (Docusaurus) are independent pnpm packages. A new
  top-level `website/` package disturbs neither. (`research/current-repo-setup.md`)
- **The docs already auto-deploy on Vercel** via GitHub integration (no GH Action,
  build = `docusaurus build`). A parallel marketing pipeline is low-effort.
- **There is no marketing blog in the repo today.** The only in-repo blog is the
  Docusaurus changelog. The marketing blog lives in Framer at `agenta.ai/blog`.
  So the blog is a genuine new build, guided by the design's `content/` shapes.
- **Analytics already exist to reuse:** docs use PostHog (`POSTHOG_API_KEY`,
  proxied via `alef.agenta.ai`) + GTM (`G-LTF78FZS33`) + Hotjar; the web app uses
  PostHog (`NEXT_PUBLIC_POSTHOG_API_KEY`, same proxy). Mirror the PostHog proxy.
- **Cloudflare Pages is in maintenance mode**; the live Cloudflare path is Workers
  (Workers Builds = git deploy + PR previews). Both Cloudflare Workers and Vercel
  give per-PR preview environments. (`research/hosting-cloudflare.md`)
- **The current live site has no video.** The hero is a static product SVG. A
  landing video would be a *new* element, not a port. (`research/current-live-site.md`)
- **Gumloop embeds no live product UI** on its marketing pages. An embedded live
  Agenta dashboard would be a real differentiator. Direct competitors (Langfuse,
  Braintrust) also lack `/vs`, use-case, and template pages — open SEO ground.
  (`research/competitive-gumloop.md`)

## Recommendation: framework + host

**Astro, deployed on Vercel for now (host-portable to Cloudflare later).**

Why Astro:
- Native MDX + content collections map 1:1 to the design's `content/` shapes
  (post / author / pricing / site). Git-based authoring that the user and an agent
  can both read and edit.
- Ships near-zero JS by default (good for a marketing/SEO site), with **islands**
  to embed real interactive React components exactly where needed — the live
  dashboard gimmick, a pricing toggle, the blog filter.
- Excellent fit for the future programmatic-SEO pages (one template + a data
  collection → many `/vs/*`, `/use-cases/*`, `/customers/*` pages).
- The design handoff itself leaned Astro.

Why Vercel for now (not Cloudflare yet):
- The user relaxed the no-Vercel stance; Vercel has the preview environments they
  want, and the docs already run on it, so the team knows the pipeline.
- Astro builds to static output, so it deploys equally well to Vercel today and to
  Cloudflare Workers later. Choosing Vercel now does not lock us in. If Cloudflare
  Workers proves "as good," migrating an Astro static build is a small job.

When this flips:
- **Next.js instead of Astro** only if we decide the marketing site and the
  product app (`cloud.agenta.ai`) should become one codebase sharing auth and live
  user dashboards. The user described them as separate surfaces, so Astro wins now.
- **Cloudflare instead of Vercel** whenever we want to consolidate on Cloudflare;
  Astro + Cloudflare Workers is first-class (CF acquired Astro, Jan 2026).

## Repo layout

```
website/                         new top-level pnpm package (Astro)
  src/
    content/                     post, author, pricing, site (+ future collections)
    components/                  ported from the .dc.html design components
    pages/                       /, /pricing, /blog, /blog/[slug], /blog/author/[slug]
    styles/tokens.css            ported verbatim from _ds/.../tokens
  public/fonts/                  self-hosted licensed woff2
  astro.config.mjs
  package.json
```

Content authoring stays git-based: a blog post is one `src/content/posts/<slug>.mdx`
in the shape already defined by `Agenta landing page pivot/handoff/CONTENT_MODEL.md`.

## Content model (now, plus room to grow)

Build now (from the design): `post`, `author`, `pricing` (singleton),
`site` (globals). MDX bodies, with an `<InlineCta />` component.

Leave room for (do not build yet, but name the routes so the IA scales):
- `comparison` → `/vs/[competitor]` (competitor, positioning, feature rows, FAQ).
- `useCase` → `/use-cases/[slug]` (workflow tabs, before/after, templates).
- `customer` → `/customers/[slug]` (challenge / solution / outcome + metrics).
- `course` → `/learn/[course]/[lesson]` (course → lesson hierarchy).
- `template` → `/templates` gallery.

These are the Gumloop archetypes the direct competitors don't have. Sequencing
them is a later call; the point now is to not paint the content model into a
corner.

## Parity to preserve 1:1 (from the live site)

| Element | Destination |
|---|---|
| Book a demo | `https://cal.com/mahmoud-mabrouk-ogzgey/demo?duration=30` |
| Get started / Start building | `https://cloud.agenta.ai/` |
| Talk to us (Enterprise) | `https://cal.com/mahmoud-mabrouk-ogzgey/demo` |
| Read the docs | `https://docs.agenta.ai/` |
| Nav | Pricing · Docs · Blog · Resources (Tutorial/Changelog/Roadmap) · Community (GitHub/Slack/YouTube/LinkedIn/X) |
| Pricing plans | Hobby (free) · Pro ($49) · Business ($399) · Enterprise (custom) |

## Divergences: design vs. current live site (route through the design person)

- **Author pages**: design adds `/blog/author/[slug]`; live site has none. (Adding
  is intended by the design.)
- **Pricing annual toggle**: design has a monthly/annual toggle; live site has no
  toggle. Confirm whether to ship it.
- **Landing video**: design implies a video slot; live site has only a static
  hero. This is new content — confirm source (YouTube embed vs self-hosted).
- **Blog featured + category filter**: design adds both; live site has neither, and
  there is no existing "featured" mechanism in the repo to copy. New behavior.

## Fonts

Replace the trial binaries with the licensed GT Alpina + PP Mondwest we own.
Convert `.otf`/`.ttf` → subset woff2 (`pyftsubset --flavor=woff2`), self-host under
`public/fonts/`, serve `Cache-Control: public, max-age=31536000, immutable`,
preload the 1-2 critical weights, `font-display: swap`. Inter / Geist from Google
Fonts as today. (Cloudflare Fonts is irrelevant — it only touches Google Fonts.)

## Analytics

Reuse the existing PostHog project via the `alef.agenta.ai` proxy. Mirror the docs
setup. Add GTM/GA only if we want parity with docs measurement.

## Decisions (resolved)

1. **Framework + host: Astro + Cloudflare Workers, static-first.** Locked
   2026-06-26. (Earlier Vercel was on the table; the user chose Cloudflare after
   confirming there is no feature downside for a static content site, and wants to
   move the docs off Vercel to Cloudflare later too.)
2. **"Gentlet.ai": resolved** — a transcription wobble for agenta.ai. No separate
   site. Mirror only agenta.ai.

## Still to route through the design person (not build blockers)

- The three design-vs-live divergences above: pricing monthly/annual toggle (design
  has it, live doesn't), the new landing video (live has none; confirm source),
  blog featured + category filter (new behavior). Scaffolding can start without
  these.
