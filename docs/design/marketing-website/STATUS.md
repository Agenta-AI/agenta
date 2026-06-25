# Status — Marketing website pivot

Plain-language status. The assistant updates this. The user reads it.

## Where we are

**Phase: proposal ready, awaiting one decision.** Research is done (four threads,
all in `./research/`). The build proposal is in `./plan.md`.

## What the research found

1. **Repo is ready** — `web/` and `docs/` are independent pnpm packages, no root
   `package.json`. A new `website/` package disturbs nothing. Docs auto-deploy on
   **Vercel**. No marketing blog exists in the repo yet (only the changelog).
   PostHog is already wired (proxy `alef.agenta.ai`) and reusable.
2. **Hosting** — Cloudflare *Pages* is end-of-life; the live path is Cloudflare
   *Workers*. Both Workers and Vercel give PR previews. Astro deploys to either;
   the host can change later without a rewrite. Fonts: convert to woff2, self-host.
3. **Live site** — captured all CTAs (demo = a cal.com link, get-started =
   cloud.agenta.ai). The live site has **no video** today (static hero), so a
   landing video is new. No author pages or pricing toggle live today.
4. **Gumloop** — the page types to grow into: `/vs/competitor`, `/use-cases`,
   `/customers`, templates, academy. Competitors lack these = open SEO ground. A
   live embedded dashboard would be a differentiator (Gumloop doesn't embed live UI).

## Recommendation

**Astro, on Vercel for now** (portable to Cloudflare later). Astro fits MDX +
content + occasional interactive React widgets + future SEO pages best. Vercel
reuses the pipeline the docs already use and gives previews; since Astro is
host-portable, this is not a lock-in.

## Next

- User picks framework + host (see `plan.md` → Open decisions).
- Then scaffold the `website/` package and port the first page.
- Write the message for the design person once we settle the open items.

## Decisions locked

- Git-based, same repo, auto-deploy + PR previews. MDX content. PostHog analytics
  (reuse existing proxy). Fonts are licensed and self-hosted. Blog/author keep
  their current behavior with a dark restyle. Core flows (demo, get-started) stay
  1:1 with the live site.
