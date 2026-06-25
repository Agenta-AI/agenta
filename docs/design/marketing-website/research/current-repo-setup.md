# Current Repo Setup — Research for Marketing Website

> Findings as of 2026-06-25. Cite exact paths so implementers can verify.

---

## Summary / key facts

- **Docs deploy via Vercel** (inferred from `docs/vercel.json` + no CI deploy step). No GitHub Actions workflow deploys the docs — Vercel's GitHub integration handles it automatically on push to `main`. The docs site is at `https://agenta.ai/docs/`.
- **The marketing blog does not exist yet in the repo.** The only blog in the codebase is the Docusaurus changelog at `https://agenta.ai/docs/changelog`. The marketing blog is designed in `Agenta landing page pivot/` (design-only, not yet implemented), with a `featured: true / featuredRank` frontmatter field defined in the content model.
- **No "featured post" logic in the existing Docusaurus changelog.** The `featured` field is used only in the handoff content model for the new marketing site.
- **Analytics:** The Docusaurus docs use three tools: Google Tag Manager (`G-LTF78FZS33`), PostHog (`POSTHOG_API_KEY` env var, proxied through `https://alef.agenta.ai`), and Hotjar (site ID `3547614`). The Next.js web app uses PostHog only (`NEXT_PUBLIC_POSTHOG_API_KEY`).
- **Monorepo layout:** No root `package.json` / pnpm workspace at repo root. `web/` uses pnpm workspaces; `docs/` is a standalone pnpm package. The two surfaces are fully independent with separate `package.json` + lockfiles. Adding a third surface (marketing site) requires no changes to either.
- **Brand fonts:** GT Alpina and PP Mondwest are vendored as OTF/TTF binaries in `Agenta landing page pivot/_ds/.../assets/fonts/`. Inter, Geist, and Geist Mono load from Google Fonts CDN. None of these fonts are in `web/` or `docs/` — they live only in the design-system folder for the new marketing site.

---

## 1. Docs deploy

### Host

The docs deploy to **Vercel**. Evidence:
- `docs/vercel.json` exists and configures URL rewrites (`:path*` strip `/docs/` prefix) — Vercel reads this file automatically.
- `docs/docusaurus.config.ts:14–17` sets `url: "https://agenta.ai"` and `baseUrl: "/docs/"`.
- No GitHub Actions workflow builds or deploys the docs. The entire CI workflow list (`00-releases.yml`, `10-checks.yml` through `45-railway-cleanup.yml`) contains no Docusaurus build step. The Vercel GitHub integration fires on push/PR to `main` and deploys automatically.

### Trigger

- **Production:** push to `main` → Vercel builds and deploys.
- **Preview:** Vercel creates a preview URL for every PR (Vercel's built-in behavior).
- **API docs refresh:** `.github/workflows/33-update-api-docs.yml` runs daily at 06:00 UTC and on merged `release/*` PRs. It regenerates Docusaurus API reference from the live OpenAPI spec and opens a PR — it does not deploy directly.

### Build command

`pnpm build` in the `docs/` directory runs `docusaurus build`. The `docs/package.json:8` entry is `"build": "docusaurus build"`.

### Cloudflare migration difficulty

Low to moderate. The docs are a standard static Docusaurus build with no Vercel-specific features (no Edge Functions, no ISR, no API Routes). The `vercel.json` rewrites (`/docs/:path*` → `/:path*`) would need to be reproduced in a Cloudflare Pages `_redirects` or `wrangler.toml` `[redirects]` block. PostHog proxying (`https://alef.agenta.ai`) is a separate reverse-proxy concern, not a Vercel dependency. A Cloudflare Pages project for the marketing site can be fully independent of the Vercel docs deploy.

---

## 2. Blog today

### Docusaurus changelog (existing)

The "blog" in the repo is the **changelog**, not a marketing blog.

- Plugin: `@docusaurus/plugin-content-blog` v3.10.1 (`docs/package.json:32`).
- Config: `docs/docusaurus.config.ts:55–79` mounts it at `routeBasePath: "/changelog"` with `blogTitle: "Changelog"`.
- Content: `docs/blog/entries/` — 93 `.mdx` files at time of writing. Example entry (`docs/blog/entries/dark-mode.mdx`): frontmatter has `title`, `slug`, `date`, `tags`, `description` only. No `author` field.
- Authors: no `authors.yml` exists in `docs/blog/`. The changelog entries carry no bylines.
- Listing: `docs/blog/slug-list.json` contains a plain array of slug strings (used elsewhere in the site).

### Marketing blog (design-only, not yet in repo as code)

The marketing blog exists only as design assets and a content model in `Agenta landing page pivot/`. It is **not yet implemented** anywhere in the repo as a deployable surface.

Design source: `Agenta landing page pivot/Agenta Blog (Dark).dc.html` and `Agenta Blog Post (Dark).dc.html`.

Content model: `Agenta landing page pivot/handoff/CONTENT_MODEL.md`.

Sample posts:
- `Agenta landing page pivot/content/posts/prompt-drift-what-it-is-and-how-to-detect-it.md`
- `Agenta landing page pivot/content/posts/the-definitive-guide-to-prompt-management-systems.md`

Post frontmatter fields:
```
slug, title, description, category (enum: Engineering | Article),
date, readingTime, heroImage, ogImage, author (ref slug),
featured (bool), featuredRank (int), tags (string[])
```

Author schema: `Agenta landing page pivot/content/authors/mahmoud-mabrouk.json`
```json
{
  "slug": "mahmoud-mabrouk",
  "name": "Mahmoud Mabrouk",
  "role": "Co-Founder Agenta & LLM Engineering Expert",
  "avatar": "assets/blog/author-mahmoud.png",
  "ogImage": "assets/blog/author-mahmoud-og.png",
  "bio": "...",
  "socials": [{ "platform": "github", "url": "...", "icon": "..." }]
}
```

There is currently one author in the content model. Author pages live at `/blog/author/[slug]`.

---

## 3. Featured posts

### In the current Docusaurus changelog

No featured-post mechanism exists. Grep for "featured" across `docs/` returns only node_modules hits and a reference in an unrelated gateway doc. The changelog blog plugin does not use a featured flag.

### In the marketing blog content model

The content model (`Agenta landing page pivot/handoff/CONTENT_MODEL.md`) defines:

- `featured: bool` — marks a post as appearing in the blog index's featured row.
- `featuredRank: int` — determines position: rank 1 = large primary card, ranks 2–3 = secondary stack.

Sample: `content/posts/the-definitive-guide-to-prompt-management-systems.md` has `featured: true` and `featuredRank: 1`.

The design shows a blog index with one large featured card + two secondary cards. Implementation is left to the engineering team — the content model notes: "Either this flag (+ an order) or an editorial 'featured' list in `site.json`."

This is a design contract, not working code.

---

## 4. Analytics

### Docusaurus docs site

Three tools are wired:

**Google Tag Manager / GA4**
- `docs/docusaurus.config.ts:32–35` injects `https://www.googletagmanager.com/gtag/js?id=G-LTF78FZS33` as an async script.
- The measurement ID `G-LTF78FZS33` is hardcoded (not an env var).

**PostHog**
- Plugin: `posthog-docusaurus` v2.0.1 (`docs/package.json:46`).
- Config: `docs/docusaurus.config.ts:336–345`.
- API key env var: `POSTHOG_API_KEY` (set at Vercel build time; falls back to `"dummy"` in dev).
- Proxy host: `https://alef.agenta.ai` (reverse proxy, not direct PostHog).
- UI host: `https://us.posthog.com`.
- Disabled in development (`enableInDevelopment: false`).

**Hotjar**
- `docs/docusaurus.config.ts:37–40` injects `/docs/hotjar.js` as an async script.
- `docs/static/hotjar.js` contains the Hotjar snippet with site ID `3547614` hardcoded.

### Next.js web app

**PostHog only** (no GA, no Hotjar).
- Provider: `web/oss/src/lib/helpers/analytics/AgPosthogProvider.tsx`.
- Env var: `NEXT_PUBLIC_POSTHOG_API_KEY` (runtime-injected via `/__env.js`).
- Same proxy host: `https://alef.agenta.ai`; UI host `https://us.posthog.com`.
- Key files:
  - `web/oss/src/lib/helpers/analytics/AgPosthogProvider.tsx` — init + pageview capture
  - `web/oss/src/lib/helpers/dynamicEnv.ts:5` — exposes the env var to the client
  - `web/oss/src/lib/helpers/analytics/hooks/usePostHogAg.ts` — hook used site-wide

### For the marketing site

Plan to wire the same PostHog project (same `alef.agenta.ai` proxy) and same GA4 property (`G-LTF78FZS33`). The marketing site will need its own `POSTHOG_API_KEY` env var at build time (or a shared one — ask Mahmoud). Hotjar is optional; include if conversion funnel tracking is needed.

---

## 5. Monorepo layout

```
agenta/
  web/          — Next.js app (pnpm workspace: oss, ee, packages/*)
  docs/         — Docusaurus site (standalone pnpm package)
  api/          — FastAPI backend
  services/     — agent service + sandbox images
  sdk/, sdks/   — Python SDK
  hosting/      — docker-compose / Railway / Helm
  Agenta landing page pivot/  — design source for marketing site (not a deployable)
```

**Root level:** no `package.json` or `pnpm-workspace.yaml` at the repo root. The two JS surfaces (`web/` and `docs/`) are independent.

**`web/`:** pnpm workspace with `package.json` at `web/package.json`. Workspaces: `ee`, `oss`, `tests`, `variants-state`, `packages/*`. Built and deployed via Railway (CI: `42-railway-build.yml`, `43-railway-deploy.yml`). Node 22.

**`docs/`:** standalone pnpm package with its own `package.json` and `pnpm-lock.yaml`. Deployed via Vercel GitHub integration. Node 22.

**Adding a third surface (marketing site):** create a new top-level directory (e.g., `marketing/`) with its own `package.json` and lockfile. Wire a separate Vercel or Cloudflare Pages project to that subdirectory. No changes to `web/` or `docs/` are needed. The monorepo has no root-level build graph that would need updating.

One thing to check: the root `.gitignore` contains `.*` which ignores nested `.gitignore` files (known gotcha in this repo). Add any marketing-site-specific ignore rules to the root `.gitignore` explicitly.

---

## 6. Fonts

### Brand font sources

GT Alpina and PP Mondwest are **vendored as OTF/TTF binaries** in the design-system folder:

```
Agenta landing page pivot/
  _ds/agenta-brand-e4caef1d-4f02-4558-abd2-6342c89dde68/
    assets/fonts/
      GT-Alpina-Standard-Light.otf
      GT-Alpina-Standard-Light-Italic.otf
      GT-Alpina-Standard-Medium.otf
      GT-Alpina-Standard-Regular-Italic.otf
      GT-Alpina-Standard-Regular.ttf
      PPMondwest-Regular.otf
```

These are **trial/demo licenses.** The design system readme explicitly notes: "GT Alpina and PP Mondwest binaries are trial/demo fonts — license before production use."

### How fonts are declared

`Agenta landing page pivot/_ds/.../tokens/fonts.css` declares all four families:

- `@font-face` blocks for **GT Alpina** (weights 300, 400, 500; both normal and italic variants) pointing to the local OTF/TTF files.
- `@font-face` block for **PP Mondwest** (weight 400, regular) pointing to the local OTF file.
- A single `@import` from Google Fonts CDN for **Inter** (14–32px optical range, 400–700), **Geist** (400–700), and **Geist Mono** (400–600).

### Where fonts are used in `web/` and `docs/`

**`docs/src/css/custom.css:1–2`** imports Inter and IBM Plex Mono from Google Fonts CDN. No GT Alpina, no PP Mondwest, no Geist.

**`web/oss/src/`** has no font imports in CSS files. The Ant Design theme config (`antd-themeConfig.json`) sets no explicit `fontFamily`. The app relies on the browser default stack with overrides in AntD's default token. No GT Alpina, no PP Mondwest, no Geist (Geist appears only in the Next.js compiled `font-data.json` as a `next/font` Google Fonts candidate — it is not actually used by the app today).

### Summary for marketing site

| Font | Binaries vendored in repo? | CDN available? | License status |
|---|---|---|---|
| GT Alpina | Yes — `Agenta landing page pivot/_ds/.../assets/fonts/` | No (commercial) | Trial only — must license |
| PP Mondwest | Yes — same folder | No (commercial) | Trial only — must license |
| Inter | No binaries | Google Fonts | Free (SIL OFL) |
| Geist | No binaries | Google Fonts | Free (SIL OFL) |
| Geist Mono | No binaries | Google Fonts | Free (SIL OFL) |

The marketing site implementation should copy the font binaries from the design-system folder (after licensing) and reproduce the `@font-face` declarations from `tokens/fonts.css`.
