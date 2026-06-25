# Marketing website — project context

Durable context for any agent working on the Agenta marketing website pivot. Read
this first. It captures the brief, the decisions, and the open questions so we do
not re-derive them each session.

## What this project is

We are rebuilding the **Agenta marketing website** (`agenta.ai`) as a pivot:
- New visual direction: **dark mode** (the "Agents" positioning pivot).
- Move **off Framer** and onto a **git-based** site in **this monorepo**, so we
  iterate on the website the same fast way we iterate on the docs.
- The marketing site lives at `agenta.ai`; the product app stays at
  `cloud.agenta.ai`. These are separate surfaces.

The **design source-of-truth** already exists in the repo root folder
`Agenta landing page pivot/`:
- `*.dc.html` — high-fidelity Design Components (landing, pricing, blog, blog
  post, author), dark treatment + one light landing variant.
- `handoff/*.md` — the design→implementation contract (TOKENS, SITEMAP,
  CONTENT_MODEL, COMPONENTS, RESPONSIVE).
- `content/*` — real-shaped sample data that defines the CMS schema by example.
- `_ds/agenta-brand-<id>/` — the bound Agenta Brand design system (tokens, fonts,
  assets).

That folder is the **design track**. This folder (`docs/design/marketing-website/`)
is the **implementation planning + accumulated knowledge** track. We do not put
implementation knowledge in the design folder and we do not edit the design folder
to record engineering decisions.

## Working style (from the user)

- **Act as the orchestrator. Do not do the heavy work in the main thread.** Spin
  subagents for research and implementation. Use Sonnet subagents for bounded or
  mechanical tasks; reserve stronger models for synthesis.
- **Accumulate knowledge here, not in the session.** Every research finding,
  decision, and open question goes into a file in this folder so the next session
  starts warm. Keep `STATUS.md` as the plain-language status for the user.
- Sequence: **research first, then propose.** Only after we finish do we hand the
  user a short message to forward to the design person.

## Decisions made by the user

### Hosting and deploy — DECIDED
- **Framework: Astro. Host: Cloudflare Workers. Keep the site static-first (SSG).**
  Locked 2026-06-26.
  - Rationale: Astro fits MDX + blog + occasional embedded React widgets + future
    programmatic-SEO pages. Cloudflare Workers gives git deploy + per-PR previews,
    a generous free/bandwidth tier, and first-class Astro support (CF acquired
    Astro, Jan 2026; Astro 6 dev server runs on the same workerd runtime).
  - **Static-first is deliberate.** The one real Cloudflare downside vs Vercel is
    that server code runs on `workerd` (not full Node), so a Node-only server dep
    needs the `nodejs_compat` flag. Keeping the marketing site SSG sidesteps this
    entirely; interactive bits are browser-side React islands, not SSR. Other
    Vercel-only niceties we are forgoing (runtime image optimization, ISR, polished
    preview-comment UX) are not needed for a content site. See
    `research/hosting-cloudflare.md` and `research/astro-cloudflare-validation.md`.
  - Cloudflare **Pages is in maintenance mode**; use **Workers** (Workers Builds).
  - **Future: move the docs (Docusaurus) off Vercel to Cloudflare too.** The user
    wants to consolidate off Vercel. Docusaurus is a fully static build, so this is
    even simpler than the Astro site. Feasibility + how to reproduce the
    `docs/vercel.json` rewrites on Cloudflare: see `research/docs-to-cloudflare.md`.
    Not in scope for the first build, but the direction is set.
- **Git-based, same GitHub repo, auto-deploy on every change.** The goal is to
  iterate on the website as fast as we iterate on the docs: push a change, the
  site updates. Per-PR preview deploys are desirable.
- **Git-based authoring is a hard requirement.** It is one of the main reasons for
  moving off Framer.

### Content and CMS
- **Body format: MDX (or MDX-like).** It must be easily editable, human-readable,
  and readable + editable by both the user and coding agents. No portable-text /
  proprietary CMS that hides content behind an app.
- **Blog post + author pages stay functionally the same.** They are in a CMS today
  and will not change except CSS / visual treatment for the dark pivot. Both pages
  already exist.
- **Featured-post mechanism: unknown — check what Agenta does today** before
  designing one.
- **Pricing numbers are placeholders** in the design `content/pricing.json`; real
  plan data comes from the user before launch. The shape is the contract.

### Parity with the current live site
- The current site (`agenta.ai`) is live in **Framer**. (The earlier "Gentlet.ai"
  reference was a transcription wobble for agenta.ai; there is no separate site to
  mirror. Resolved 2026-06-25.) For CTA destinations and core flows, **match the
  current live site 1:1 as much as possible**.
- The pivot changes the **visual** (going dark) and **some content**. The **core
  stuff is unchanged**: the demo flow, "Book a demo", "Get started", etc. point to
  the same places.
- **OG images already exist** as blocks; not a gap.
- **Open content piece:** the **landing-page video**. Format is undecided (YouTube
  embed or self-hosted / other). This is the one genuinely-new content slot.

### Fonts (resolved on the legal side)
- We **own the rights** to the brand fonts (GT Alpina, PP Mondwest). The
  trial/demo binaries currently sitting in the design folder are leftover from when
  the user started a trial. Treat the fonts as **licensed and self-hostable**.
- Open question is **technical, not legal**: best practices for self-hosting
  licensed fonts on Cloudflare (woff2 subsetting, preload, cache headers,
  Cloudflare Fonts vs. self-host).

### Analytics
- **PostHog** is the analytics tool. Google Analytics may also be used for checks.
- For docs and analytics conventions, **mirror what `agenta.ai` / the current docs
  do** — the user expects it to be "exactly the same," reusing the existing setup.

## Aspirations / future scope (plan the IA to scale into these)

- **Interactive "gimmicks."** The user wants marketing pages that can embed live
  interactive bits, e.g. a working **dashboard** on a page, like modern dev-tool
  marketing sites. The stack must support embedding real React/interactive
  components in content.
- **Videos** throughout, and eventually a **learning / course** experience
  (resources, go course-by-course).
- **Competitor / future page archetypes.** Think ~6 months ahead. Likely future
  pages, modeled on tools like **Gumloop**: comparison-vs-competitor pages (with
  screenshots), lessons / learning / academy, resources, templates, customer
  stories. The content model and IA should not have to be re-architected to add
  these.

## Open questions to resolve

1. **Framework / SSG**: Astro vs Next.js (App Router) on Cloudflare, given
   git-based + MDX + embeddable interactive components + future scale. To be
   recommended after research, not asked.
2. **Cloudflare deploy topology**: Pages vs Workers, monorepo subdirectory build,
   per-PR previews, custom domain wiring.
3. **"Gentlet.ai"** reference — what is it, and do we mirror it too?
4. **Featured-post mechanism** in the current Agenta blog.
5. **Landing video** source/format.
6. Coexistence with the existing `web/` app and `docs/` Docusaurus in the same
   repo: where the marketing site code lives and how its build/deploy stays
   independent.

## Pointers

- Design source-of-truth: `../../../Agenta landing page pivot/` (repo root).
- Handoff contract: `Agenta landing page pivot/handoff/`.
- Sample content / schema: `Agenta landing page pivot/content/`.
- Research outputs: `./research/`.
- Plain-language status for the user: `./STATUS.md`.
