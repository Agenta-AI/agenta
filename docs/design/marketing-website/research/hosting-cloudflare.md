# Hosting the Agenta Marketing Site on Cloudflare

Researched: 2026-06-25

---

## Summary / Recommendation

- **Use Cloudflare Workers, not Cloudflare Pages.** Cloudflare has officially stated that all future investment, features, and optimizations go to Workers. Pages continues to work but receives no new features. The @astrojs/cloudflare adapter dropped Pages support in v12/v13 (Workers only now), making this a hard dependency if you choose Astro.
- **Astro is the right framework for this site.** The Cloudflare–Astro alignment is now structural: Cloudflare acquired Astro in January 2026 and the entire Astro team joined Cloudflare. Astro ships zero JS by default, embeds interactive React components as islands (client-side only where needed), has first-class MDX + Content Collections, and Astro 6's dev server runs on workerd so local dev matches production exactly. For a marketing site with MDX content and occasional interactive widgets, this is the natural fit.
- **Next.js on Cloudflare works, but carries real friction.** The @opennextjs/cloudflare adapter is mature and Cloudflare-endorsed, but Next.js assumes Node.js runtime semantics that Workers don't fully match. Worker size limits, ISR differences, Node middleware not yet supported, and no edge runtime mean a non-trivial compatibility surface. For a primarily content site, you're fighting Next.js defaults rather than leaning on its strengths.
- **Monorepo subdirectory is fully supported** via Workers Builds root directory + build watch paths. Per-PR preview URLs and GitHub check-run comments work out of the box.
- **For self-hosted fonts:** convert to woff2 via fonttools/pyftsubset (subset to Latin), serve with `Cache-Control: public, max-age=31536000, immutable`, use content-hashed filenames, add `<link rel="preload">` for 1–2 critical weights, and use `font-display: swap`. Cloudflare Fonts is irrelevant (it only rewrites Google Fonts; custom fonts are untouched).

---

## 1. Cloudflare Product Choice: Pages vs Workers

### Current Cloudflare guidance (as of 2025–2026)

Cloudflare's official documentation states:

> "Now that Workers supports both serving static assets and server-side rendering, you should start with Workers. Cloudflare Pages will continue to be supported, but, going forward, all of our investment, optimizations, and feature work will be dedicated to improving Workers."

Source: [Migrate from Pages to Workers — Cloudflare Workers docs](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)

**Pages is not deprecated**, but it is in maintenance mode. It still works, the git integration still works, and all existing Pages projects continue to run. The platform just won't get new features.

### Workers Static Assets

Workers Static Assets is the correct primitive for a git-connected marketing site. You configure a `wrangler.jsonc` that points `assets.directory` at your build output folder. The Worker serves static files for free (no per-request charge), and any SSR routes (e.g., a preview API endpoint) run in the same Worker.

Key configuration requirements:
- `compatibility_date`: must be set (recommend `2025-05-05` or later for full Node.js compat)
- `compatibility_flags: ["nodejs_compat"]` for any framework that needs Node APIs
- `.assetsignore` file to exclude `_worker.js`, `_routes.json` from public assets

### Git auto-deploy

Workers now has its own CI/CD system called **Workers Builds**, which mirrors what Pages has offered. It connects to GitHub or GitLab, triggers builds on push, generates preview URLs for non-production branches, and posts check run statuses to GitHub PRs.

Source: [GitHub integration — Cloudflare Workers docs](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)

---

## 2. Git Auto-Deploy + Monorepo

### Connecting a subdirectory

Both Cloudflare Pages and Cloudflare Workers Builds support monorepos via two settings:

**Root directory** — the path within the repo where `wrangler.jsonc` (Workers) or the build command runs. Set this to your marketing site subdirectory, e.g., `web/marketing/`. The build command executes from this path.

**Build watch paths** — controls which file changes trigger a build:
- Configure via Dashboard → Workers & Pages → your project → Settings → Build → Build watch paths
- Supports glob wildcards: `web/marketing/*` to include only the marketing subdir, plus `packages/shared/*` if the site imports a shared package
- Evaluation order: excludes are checked first, then includes. If any matching changed path satisfies an include, the build fires.
- **Caveat:** if a push contains 3,000+ changed files or 20+ commits, build watch paths are bypassed and a build always fires.

Source: [Build watch paths — Cloudflare Pages docs](https://developers.cloudflare.com/pages/configuration/build-watch-paths/)
Source: [Advanced setups — Cloudflare Workers docs](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/)

### Per-PR preview deployments

Cloudflare Pages generates a unique URL for every PR branch automatically: `<hash>.<project>.pages.dev`. The hash updates on each new commit to that branch. Preview URLs carry `X-Robots-Tag: noindex` by default (safe for SEO). GitHub gets a check run / commit status posted, and PR comments link to the preview URL.

Workers Builds also generates preview URLs per branch (announced July 2025): [Per-branch preview deployments for Cloudflare Workers](https://developers.cloudflare.com/changelog/post/2025-07-23-workers-preview-urls/)

### pnpm monorepo gotchas

- Cloudflare's build environment supports npm, pnpm, and Yarn workspaces, as well as Turborepo and Nx for task orchestration.
- **Dependency resolution issue:** pnpm's symlinking behavior can cause packages that are workspace-local to fail to resolve inside Cloudflare's build sandbox. The fix is to run `pnpm install --shamefully-hoist` or configure the build command to run from the repo root (e.g., `pnpm --filter marketing build`) rather than from the subdirectory.
- A community issue tracking Next.js + pnpm monorepo builds on Cloudflare: [GitHub issue #307](https://github.com/cloudflare/next-on-pages/issues/307)
- Build System V2 is required for monorepo support in Pages.
- Maximum 5 Pages projects per repository (can be raised by request).

Source: [Monorepos — Cloudflare Pages docs](https://developers.cloudflare.com/pages/configuration/monorepos/)
Source: [Deploying a pnpm Monorepo to Cloudflare Pages — Nx Blog](https://nx.dev/blog/pnpm-monorepo-cloudflare-pages)

---

## 3. Astro on Cloudflare

### Adapter and output modes

Install: `npx astro add cloudflare`

This installs `@astrojs/cloudflare` and sets `output: 'server'` in `astro.config.mjs`. Individual routes can opt out of SSR with `export const prerender = true` for purely static pages (hybrid mode). A fully static site does not need the adapter at all — just `astro build` and deploy the `dist/` folder.

**As of @astrojs/cloudflare v12/v13 (2025), the adapter no longer supports Cloudflare Pages. Workers only.** Existing Pages-based Astro projects must migrate to Workers.

### MDX + Content Collections

Astro's Content Collections provide type-safe, schema-validated MDX. Add `@astrojs/mdx` integration and define a collection in `src/content/config.ts`. Zod schemas catch frontmatter errors at build time. This is the standard approach for marketing site pages, blog posts, changelog entries, and comparison pages.

### React islands

Astro renders the page to static HTML by default. React (or Preact, Vue, Svelte, Solid) components are opted into client-side JS via directives:
- `<Widget client:load />` — hydrate immediately on page load
- `<Widget client:visible />` — hydrate when the component enters the viewport (good for below-the-fold interactive widgets)
- `<Widget client:idle />` — hydrate when the browser is idle

This is exactly the right model for a marketing site with a "live dashboard widget": the widget becomes an island with `client:visible`; the surrounding marketing copy ships zero JS.

Source: [Islands architecture — Astro Docs](https://docs.astro.build/en/concepts/islands/)
Source: [Astro — Cloudflare Workers docs](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/)

### Cloudflare acquisition (January 2026)

Cloudflare acquired Astro in January 2026. The framework remains MIT-licensed and open-source. Astro 6 (released late 2025/early 2026) moved the dev server into workerd (the same JavaScript runtime that runs in production Workers), so `astro dev` is now production-identical. This eliminates the class of "works locally, breaks on Cloudflare" bugs.

Key Astro 6 improvements relevant here:
- 5x faster Markdown/MDX builds, 40% lower memory
- `prerenderEnvironment: 'workerd'` is now the default (build-time rendering uses workerd too)
- Automatic CSP generation
- Live Content Collections for real-time data

Source: [Astro in 2026 — DEV Community](https://dev.to/polliog/astro-in-2026-why-its-beating-nextjs-for-content-sites-and-what-cloudflares-acquisition-means-6kl)
Source: [Astro Framework 2026 — alexbobes.com](https://alexbobes.com/programming/a-deep-dive-into-astro-build/)

### Known caveats

- **CommonJS incompatibility:** Dependencies must support ES modules. CommonJS-only packages require pre-compilation via Vite plugins. This is rarely a problem with modern packages, but occasionally surfaces with analytics or CMS SDKs.
- **Node.js APIs:** Workers support most Node.js built-ins via the `nodejs_compat` flag, but not all. The specific missing APIs are edge-case (e.g., some `node:crypto` subtleties). Check [Cloudflare's supported Node.js API list](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) before adding Node-heavy dependencies.
- **KV replication latency:** If you use Workers KV for sessions or config, changes propagate globally within 60 seconds (eventually consistent), not immediately.
- **`prerenderEnvironment: 'node'`:** Some pages with Node.js-only build-time dependencies (e.g., certain Markdown plugins) may need this fallback option to build correctly.

Source: [@astrojs/cloudflare — Astro Docs](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)

---

## 4. Next.js on Cloudflare

### Current state

**The @opennextjs/cloudflare adapter is the current recommended path.** The older `next-on-pages` adapter is effectively deprecated for App Router work. Cloudflare's own framework guide now points directly to OpenNext.

Next.js 16.2 introduced a stable Adapter API (built jointly with OpenNext, Netlify, Cloudflare, AWS Amplify, and Google Cloud), which standardizes multi-platform Next.js deployment going forward.

Source: [Cloudflare adapter for OpenNext — Cloudflare blog](https://blog.cloudflare.com/deploying-nextjs-apps-to-cloudflare-workers-with-the-opennext-adapter/)
Source: [Next.js across platforms — Next.js blog](https://nextjs.org/blog/nextjs-across-platforms)
Source: [opennext.js.org/cloudflare](https://opennext.js.org/cloudflare)

### What works

- App Router (fully supported)
- Pages Router
- Route Handlers and dynamic routes
- Server Actions
- SSG and SSR
- Partial Prerendering (PPR)
- Incremental Static Regeneration (ISR) — uses stale-while-revalidate patterns on Workers
- Image optimization (via Cloudflare Images binding)
- Turbopack builds
- Composable Caching (`'use cache'` — experimental)
- Response streaming

### What does NOT work or requires workarounds

| Issue | Detail |
|---|---|
| **Edge runtime** | `export const runtime = 'edge'` is not supported. Must remove it everywhere. Workers is the runtime; no separate edge API. |
| **Node Middleware (Next.js 15.2+)** | `middleware.ts` with Node.js APIs is not yet supported. Standard Middleware (Edge-compatible) works. |
| **Worker size limit** | Free: 3 MiB gzipped. Paid: 10 MiB gzipped. Complex apps with Sentry, i18n, or large auth libraries can hit this. Use the ESBuild Bundle Analyzer to inspect. |
| **DB connection reuse** | Cannot reuse DB clients across requests. Must create a fresh DB client per request. |
| **Windows development** | Not fully supported; use WSL, VM, or CI for building/deploying. |
| **Compatibility date** | Must set `compatibility_date: "2024-09-23"` or later (use `2025-05-05`+ for `FinalizationRegistry` support). |
| **`nodejs_compat` flag required** | Must be set in `wrangler.jsonc`. |

Source: [Troubleshooting — opennext.js.org](https://opennext.js.org/cloudflare/troubleshooting)
Source: [Next.js — Cloudflare Workers docs](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)

### Honest friction assessment

Next.js on Cloudflare is mature enough to ship production apps, and many teams do. But it requires continuous awareness of the Worker constraint surface. The ISR model is reimplemented (not identical to Vercel). Some npm packages embed Node-specific code that breaks in workerd. The 10 MiB bundle ceiling is a real constraint for large apps. For a site that is primarily MDX content with React widgets, these constraints add maintenance overhead without providing meaningful value over Astro.

---

## 5. Recommendation Inputs: Astro vs Next.js

### The case for Astro

| Factor | Astro | Next.js |
|---|---|---|
| Cloudflare alignment | Cloudflare **owns** Astro; adapter is the primary deployment target | Third-party adapter (OpenNext); good but not first-party |
| Zero-JS default | Yes — pages ship no JS unless you add an island | No — React runtime ships to every page |
| MDX + Content Collections | Native, type-safe, schema-validated | Supported via `@next/mdx` + manual setup; less integrated |
| Interactive React widgets | Islands (`client:visible`) — surgical hydration | Full React on every page; tree-shaking helps but baseline is heavier |
| Cloudflare Pages support | Workers only (Pages support dropped in adapter v12) | Works on both Pages and Workers |
| Dev/prod parity on Cloudflare | Astro 6 runs workerd locally — identical | Node.js locally, workerd in prod — some divergence possible |
| Build speed | 5x faster MD/MDX builds in Astro 6 | Slower for content-heavy sites |
| Learning curve for content editors | Familiar MDX + frontmatter pattern | Same MDX, but routed through Next.js file conventions |
| Course / tutorial section | Astro Content Collections handles this well | Works equally well |
| Interactive comparison pages | React island — works fine | Server Component + Client Component — equally fine |

### The case for Next.js

- If the team is deeply embedded in Next.js and React Server Components for the main app, sharing component patterns across the marketing site and the app can lower cognitive overhead.
- Next.js App Router handles complex data-fetching patterns (e.g., a course section with user progress) better than Astro's SSR if the course section grows into a full application.
- Next.js is more suitable if the marketing site is eventually expected to blur into the product (shared auth, user dashboards embedded in marketing pages).

### Lean

**Astro is the better choice for this site as described.** The constraints (MDX, marketing/blog content, interactive widgets via islands, fast iteration on copy) map directly to Astro's design goals. The Cloudflare acquisition removes the previous concern about long-term maintenance alignment. The main reason to pick Next.js over Astro here would be team familiarity or a future plan to deeply integrate the marketing site with the product app.

Source: [Astro in 2026 — DEV Community](https://dev.to/polliog/astro-in-2026-why-its-beating-nextjs-for-content-sites-and-what-cloudflares-acquisition-means-6kl)

---

## 6. Self-Hosting Licensed Fonts on Cloudflare

### Step 1: Convert .otf/.ttf to woff2

Use **fonttools** + **pyftsubset**:

```bash
pip install fonttools brotli
```

Convert a single weight:
```bash
pyftsubset GtAlpina-Regular.otf \
  --output-file=gt-alpina-regular.woff2 \
  --flavor=woff2 \
  --layout-features='*' \
  --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
```

The `--unicodes` range above is the standard Latin + Latin Extended subset used by Google Fonts. It covers English and most Western European languages. If the site needs other scripts, add their Unicode ranges.

Key flags:
- `--flavor=woff2` — output WOFF2 directly (requires brotli)
- `--layout-features='*'` — preserve kerning, ligatures, OpenType features; omitting this strips them
- `--no-hinting` — optional; strips TrueType hints, saves 10–30% more size. Safe for screen rendering on modern OSes.

For variable fonts (if GT Alpina or PP Mondwest have variable versions), pyftsubset handles them correctly: it strips unused glyphs while preserving variation axes.

Source: [fonttools subset documentation](https://fonttools.readthedocs.io/en/latest/subset/)
Source: [Web font optimization guide 2025 — font-converters.com](https://font-converters.com/guides/web-font-optimization#subsetting-strategies)
Source: [Optimizing Web Fonts — webcarbon.io 2026](https://webcarbon.io/news/2026/02/18/web-fonts-performance-emissions-woff2-variable-subsetting/)

### Step 2: Filename convention

Use content-hashed filenames (your build tool handles this) or version in the name:

```
gt-alpina-regular-v2.woff2
pp-mondwest-regular-v1.woff2
```

Never update a font file in-place at the same URL if it's cached with `immutable`. Instead, update the filename and the `@font-face` src to point to the new file.

### Step 3: @font-face CSS

```css
@font-face {
  font-family: 'GT Alpina';
  src: url('/fonts/gt-alpina-regular-v2.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'GT Alpina';
  src: url('/fonts/gt-alpina-bold-v2.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
```

`font-display: swap` shows fallback text immediately and swaps when the web font loads. For a marketing site where the headline font is part of the brand, consider `font-display: optional` (no swap flash) if the font loads within the first 100ms (likely from Cloudflare's CDN edge).

### Step 4: Preload critical fonts

Preload only the weights visible above the fold — typically 1–2 faces. In your `<head>`:

```html
<link
  rel="preload"
  href="/fonts/gt-alpina-regular-v2.woff2"
  as="font"
  type="font/woff2"
  crossorigin
/>
```

The `crossorigin` attribute is required even for same-origin fonts when using `<link rel="preload">`. Without it, the browser fetches the font twice.

Do not preload every weight — this blocks the critical path. Preload only what appears above the fold.

### Step 5: Cache-Control headers

Set on the `/fonts/*` path:

```
Cache-Control: public, max-age=31536000, immutable
```

In Cloudflare Workers (via wrangler.jsonc `headers` config or a `_headers` file):

```
/fonts/*
  Cache-Control: public, max-age=31536000, immutable
```

Or via a `_headers` file in your `dist/` folder (Cloudflare Pages / Workers Static Assets both respect this):

```
/fonts/*
  Cache-Control: public, max-age=31536000, immutable
```

Cloudflare's edge caches the file at all 300+ PoPs after the first request, serving it from the same PoP as the HTML. Subsequent requests return from cache with zero origin hit.

Source: [Font caching strategies — font-converters.com 2026](https://font-converters.com/performance/font-caching-strategies)
Source: [Self-hosting web fonts — DCHost.com](https://www.dchost.com/blog/en/self-hosting-web-fonts-moving-from-google-fonts-to-woff2-on-your-own-server/)

### Does Cloudflare Fonts help?

**No.** Cloudflare Fonts is a feature that rewrites Google Fonts `<link>` tags in your HTML to serve those fonts from your own domain instead of `fonts.googleapis.com`. It exclusively supports Google Fonts. It does not touch custom or licensed fonts, and it does not conflict with self-hosted fonts.

Source: [Cloudflare Fonts — Cloudflare Speed docs](https://developers.cloudflare.com/speed/optimization/content/fonts/)

Keep Cloudflare Fonts disabled (or simply don't enable it) for this site since you are not using Google Fonts.

### CORS note

If fonts are served from the same domain as your HTML (e.g., `agenta.ai/fonts/...`), no special CORS configuration is needed. If you later move fonts to a separate asset CDN subdomain (e.g., `assets.agenta.ai`), add:

```
Access-Control-Allow-Origin: https://agenta.ai
```

to the font responses.

---

## Source Index

- [Migrate from Pages to Workers — Cloudflare Workers docs](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)
- [Static Assets — Cloudflare Workers docs](https://developers.cloudflare.com/workers/static-assets/)
- [Monorepos — Cloudflare Pages docs](https://developers.cloudflare.com/pages/configuration/monorepos/)
- [Build watch paths — Cloudflare Pages docs](https://developers.cloudflare.com/pages/configuration/build-watch-paths/)
- [Advanced setups (monorepo) — Cloudflare Workers docs](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/)
- [GitHub integration — Cloudflare Workers docs](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)
- [Preview deployments — Cloudflare Pages docs](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
- [Per-branch preview deployments for Workers — Cloudflare changelog, July 2025](https://developers.cloudflare.com/changelog/post/2025-07-23-workers-preview-urls/)
- [Astro — Cloudflare Workers docs](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/)
- [Astro — Cloudflare Pages docs](https://developers.cloudflare.com/pages/framework-guides/deploy-an-astro-site/)
- [@astrojs/cloudflare — Astro Docs](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- [Islands architecture — Astro Docs](https://docs.astro.build/en/concepts/islands/)
- [Astro in 2026 — DEV Community (polliog)](https://dev.to/polliog/astro-in-2026-why-its-beating-nextjs-for-content-sites-and-what-cloudflares-acquisition-means-6kl)
- [Astro Framework 2026 — alexbobes.com](https://alexbobes.com/programming/a-deep-dive-into-astro-build/)
- [Next.js — Cloudflare Workers docs](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [@opennextjs/cloudflare — opennext.js.org](https://opennext.js.org/cloudflare)
- [Troubleshooting OpenNext on Cloudflare](https://opennext.js.org/cloudflare/troubleshooting)
- [Deploying Next.js apps to Cloudflare Workers with OpenNext — Cloudflare blog](https://blog.cloudflare.com/deploying-nextjs-apps-to-cloudflare-workers-with-the-opennext-adapter/)
- [Next.js across platforms — Next.js blog](https://nextjs.org/blog/nextjs-across-platforms)
- [Cloudflare Fonts — Cloudflare Speed docs](https://developers.cloudflare.com/speed/optimization/content/fonts/)
- [fonttools subset documentation](https://fonttools.readthedocs.io/en/latest/subset/)
- [Web font optimization guide 2025 — font-converters.com](https://font-converters.com/guides/web-font-optimization#subsetting-strategies)
- [Font caching strategies 2026 — font-converters.com](https://font-converters.com/performance/font-caching-strategies)
- [Self-hosting web fonts — DCHost.com](https://www.dchost.com/blog/en/self-hosting-web-fonts-moving-from-google-fonts-to-woff2-on-your-own-server/)
- [Optimizing web fonts for performance — webcarbon.io, Feb 2026](https://webcarbon.io/news/2026/02/18/web-fonts-performance-emissions-woff2-variable-subsetting/)
- [Deploying pnpm monorepo to Cloudflare Pages — Nx Blog](https://nx.dev/blog/pnpm-monorepo-cloudflare-pages)
