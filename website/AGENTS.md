# website/ — Agenta marketing site (Astro)

The Agenta marketing website (`agenta.ai`): Astro, static-first, deployed on
Cloudflare. Independent of `web/` (the app) and `docs/` (Docusaurus). Full project
context, decisions, and the design source live in
[docs/design/marketing-website/](../docs/design/marketing-website/) — read its
`AGENTS.md` first.

## Asset hosting — proprietary and large files (IMPORTANT)

**This repo is public / open source. Never commit proprietary, licensed, or large
binary assets.** We may be licensed to *use* an asset on our site but not to
*redistribute* its source binary, and a public repo redistributes everything in it,
forever, in history.

The rule: **proprietary/large assets live in the deployed output, never in git.**

- **Licensed fonts (GT Alpina, PP Mondwest).** Gitignored (see `.gitignore`:
  `public/fonts/GT-Alpina*`, `public/fonts/PPMondwest*`). They are injected at
  **build time** into `public/fonts/` by `scripts/fetch-fonts.mjs`, wired as the
  `prebuild` and `predev` npm scripts (runs before `astro build`/`astro dev`). They
  end up served **same-origin** from our site (best performance, no CORS) but never
  enter the repo. The script **never fails the build** — if no source is available
  it warns and exits 0, and the CSS falls back to system serif/mono.
  - **Resolution order** (`scripts/fetch-fonts.mjs`): (1) already in `public/fonts/`
    → skip; (2) a local directory — env `AGENTA_FONTS_DIR` (default
    `/home/mahmoud/code/agenta-fonts`) → copy from disk; (3) Cloudflare **R2** over
    the S3 API → download.
  - **R2 / CI env vars** (set these as CI secrets; never commit values):
    - `R2_S3_ENDPOINT` — e.g. `https://<accountid>.r2.cloudflarestorage.com`
    - `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — R2 S3 access keys
    - `R2_FONTS_BUCKET` — bucket name, default `agenta-brand-fonts` (private)
  - **Local-dir shortcut:** drop the six `.woff2` in `/home/mahmoud/code/agenta-fonts`
    (or point `AGENTA_FONTS_DIR` at them) and the prebuild copies them in without any
    R2 credentials. Files already in `public/fonts/` are left untouched.
  - Do not use Git LFS for these: on a public repo, LFS objects are still publicly
    downloadable, so LFS does not protect a licensed binary.
- **Open fonts (Inter, Geist).** Loaded from Google Fonts. Fine to reference; not
  gitignored.
- **Video.** Use **YouTube** embeds (the landing video, etc.). We deliberately do
  **not** use Cloudflare Stream — one media platform is simpler, and YouTube also
  gives reach/SEO/embeds for free. Revisit Stream only if we need private/unlisted
  delivery, DRM, or precise first-party analytics that YouTube can't provide.
- **Other large or proprietary media.** Put it in the R2 bucket and reference it by
  URL (e.g. `https://assets.agenta.ai/...`), with long-cache immutable headers.
- **Agenta's own marketing images** (logos, the migrated blog images) are not
  proprietary, so they may live in the repo. Move them to R2 only if we later want a
  leaner repo; that is an optimization, not a licensing requirement.

## Running locally

- `pnpm install` then `pnpm dev` → http://localhost:4321/ (localhost only).
- **Remote preview on the dev box:** bind to all interfaces —
  `pnpm exec astro dev --host 0.0.0.0 --port 4321` — then open
  `http://<box-ip>:4321/` (the box's port 4321 must be reachable).
- `pnpm build` produces the static `dist/`. Deploy target is Cloudflare Workers
  Static Assets (see `wrangler.jsonc`). `pnpm deploy:preview` deploys the shared
  team preview manually (needs the Cloudflare creds from `~/.agenta-marketing.env`).
  **`deploy:preview` sets `PUBLIC_NOINDEX=true` on the build** so the public
  `workers.dev` preview ships a `noindex` meta + disallow-all `robots.txt` and can
  never rank as duplicate content against production. Any hand-rolled preview build
  (`pnpm build && wrangler deploy`) must prefix `PUBLIC_NOINDEX=true` for the same
  reason. Only the production workflow (`16-website-production.yml`) leaves it unset.

## CI preview deploys

Every PR that touches `website/**` gets an automatically deployed preview, via
`.github/workflows/15-website-preview.yml`.

- **How:** the workflow builds the site and runs `wrangler versions upload
  --preview-alias pr-<number>` against the single `agenta-website-preview` worker.
  This publishes a new *version* with its own shareable preview URL and does **not**
  touch the worker's production deployment, so one worker serves every PR's preview
  (no per-PR worker sprawl, no cleanup job). The stable alias makes the URL
  deterministic per PR: `https://pr-<number>-agenta-website-preview.<subdomain>.workers.dev`.
- **Where the URL appears:** a single sticky PR comment (header `website-preview`)
  that updates in place on every push, so pushes never spam new comments.
- **Secrets (GitHub Actions, referenced by name — never commit values):**
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` for the deploy, and the four R2
  vars (`R2_S3_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and the
  non-secret `R2_FONTS_BUCKET`, set inline in the workflow) so the licensed fonts are
  fetched into the preview build. Without the R2 secrets the build still succeeds with
  fallback fonts (see the asset-hosting section above).
- **Fork PRs:** deployment is skipped for PRs from forks (the job guards on
  `head.repo.full_name == github.repository`), so secrets are never exposed to
  untrusted code. Fork PRs simply get no preview comment.

## CI production deploy

Every merge to `main` that touches `website/**` deploys production, via
`.github/workflows/16-website-production.yml` (also `workflow_dispatch`).

- **How:** builds with the same R2 font secrets, then runs `wrangler deploy
  --config wrangler.production.jsonc` — a real deploy (not `versions upload`) to the
  separate production worker `agenta-website` (`preview_urls: false`, no routes yet;
  the `agenta.ai` domain is attached in the Cloudflare dashboard).
- **Guard:** runs only on `Agenta-AI/agenta`; same secrets as the preview workflow.

- Static-first (`output: 'static'`); interactivity is browser-side React islands
  (`client:visible`), never SSR. This keeps us off the `workerd` ≠ Node edge cases.
- Content is MDX in `src/content/` (posts, authors) + JSON singletons; the shapes
  match `Agenta landing page pivot/handoff/CONTENT_MODEL.md`.
- Style against the ported design tokens in `src/styles/`. Never invent a hex.
- SEO: every page passes `title` + `description` (and `ogType`/`ogImage` for blog
  posts) through `Site` → `Base`, which emits the meta/OG/Twitter/canonical head. The
  sitemap is generated automatically (`@astrojs/sitemap`). Do not hand-write head meta
  per page.
- Shared chrome is `src/layouts/Site.astro` + `src/components/SiteNav|SiteFooter|CtaBand`.
  There is exactly one nav and one footer component; `SiteNav` takes `sticky` (set only
  by the landing page) to enable the scroll-pill behavior, and renders the identical
  static bar everywhere else. Reuse them; do not re-implement nav/footer per page.
