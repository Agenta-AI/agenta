# website/ — Agenta marketing site (Astro)

The Agenta marketing website (`agenta.ai`): Astro, static-first, deployed on
Cloudflare. Independent of `web/` (the app) and `docs/` (Docusaurus). Full project
context, decisions, and the design source live in
[docs/design/marketing-website/](../docs/design/marketing-website/) — read its
`AGENTS.md` and `STATUS.md` first.

## Asset hosting — proprietary and large files (IMPORTANT)

**This repo is public / open source. Never commit proprietary, licensed, or large
binary assets.** We may be licensed to *use* an asset on our site but not to
*redistribute* its source binary, and a public repo redistributes everything in it,
forever, in history.

The rule: **proprietary/large assets live in the deployed output, never in git.**

- **Licensed fonts (GT Alpina, PP Mondwest).** Gitignored (see `.gitignore`). They
  are injected at **build time** from private storage (a Cloudflare **R2** bucket)
  by a prebuild step that pulls them into `public/fonts/` using an R2 API token kept
  as a CI secret, just before `astro build`. They end up served **same-origin** from
  our site (best performance, no CORS) but never enter the repo.
  - Local dev: keep the licensed `.woff2` in `public/fonts/` (gitignored, so they
    stay local). If they are absent (e.g. a contributor without the token), the CSS
    falls back to a system serif/mono so the site still builds and runs.
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
  Static Assets (see `wrangler.jsonc`); deploy is not wired yet.

## Conventions

- Static-first (`output: 'static'`); interactivity is browser-side React islands
  (`client:visible`), never SSR. This keeps us off the `workerd` ≠ Node edge cases.
- Content is MDX in `src/content/` (posts, authors) + JSON singletons; the shapes
  match `Agenta landing page pivot/handoff/CONTENT_MODEL.md`.
- Style against the ported design tokens in `src/styles/`. Never invent a hex.
- Shared chrome is `src/layouts/Site.astro` + `src/components/NavBar|Footer|CtaBand`.
  Reuse them; do not re-implement nav/footer per page.
