# Marketing website — design notes

Lean context for the Agenta marketing website (`agenta.ai`), rebuilt off Framer as a
git-based Astro site in this monorepo (dark "Agents" positioning pivot).

**The operating manual is [`website/AGENTS.md`](../../../website/AGENTS.md)** — how to
build, run, deploy, the CI preview, fonts, asset-hosting rules, and page/chrome
conventions live there. Read it first. This folder only holds the durable *why* and the
two reference files the site's code points at.

## Locked decisions

- **Framework: Astro. Host: Cloudflare Workers (Static Assets). Static-first (SSG).**
  Interactive bits are browser-side React islands, never SSR — this keeps the build off
  the `workerd` ≠ Node edge cases. Do not add `@astrojs/cloudflare` (it silently flips
  the project to Workers SSR). Rationale in `plan.md`.
- **Two separate surfaces:** marketing at `agenta.ai`, the product app at
  `cloud.agenta.ai`.
- **Content is MDX** (posts, authors) + JSON singletons, git-authored so the user and
  agents both read and edit it. Shapes match
  `Agenta landing page pivot/handoff/CONTENT_MODEL.md` (design source-of-truth, repo
  root, git-excluded).
- **Core CTAs match the live site 1:1** (book-a-demo cal.com link, get-started →
  cloud.agenta.ai). The pivot changes visual treatment and some copy, not the flows.
- **Fonts (GT Alpina, PP Mondwest) are licensed and self-hosted**, injected at build
  time, never committed. Details in `website/AGENTS.md`.
- **Analytics: PostHog**, reusing the existing proxy.

## What's here

- `plan.md` — the original build proposal and the framework/static-first rationale the
  site's `astro.config.mjs` points at. Historical; the decisions above are current.
- `research/live-url-link-map.md` — **the redirect/link parity source of truth.** The
  site's `_redirects`, `SiteNav`, `SiteFooter`, and author pages are built against it;
  keep it in sync when URLs change.
- `research/blog-migration.md` — how the 37 blog posts + 3 authors were migrated; the
  content-collection schemas in `src/content.config.ts` reference it.

Earlier research (competitive analysis, Framer-era captures, Cloudflare/deploy
investigations), QA reports/screenshots, and the round-by-round build log were removed
from the repo during PR curation; they carried local-only reference value, not
future-work value. They live outside git in `docs/design/marketing-website-local/`.

## Design source-of-truth

The high-fidelity design components, the handoff contract (tokens, sitemap, content
model, components, responsive), and sample content live in the repo-root
`Agenta landing page pivot/` folder (git-excluded). That is the design track; this folder
is the implementation-planning track.
