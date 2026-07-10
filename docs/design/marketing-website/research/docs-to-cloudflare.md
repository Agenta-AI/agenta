# Moving the Docusaurus Docs Site from Vercel to Cloudflare

Researched: 2026-06-26

---

## Summary / Verdict

**Yes, fully feasible. Low effort — probably half a day of setup, half a day of DNS cutover.** Docusaurus is a fully static SSG: `docusaurus build` produces a plain `build/` directory with no server-side logic. Cloudflare Workers with Static Assets hosts this natively. The existing `vercel.json` has exactly one rewrite rule and a `trailingSlash: false` flag; both translate directly to Cloudflare config with no ambiguity.

The main migration checklist:

1. Add `wrangler.toml` to `docs/`.
2. Add `docs/static/_redirects` with one line.
3. Set `html_handling = "drop-trailing-slash"` and `not_found_handling = "404-page"` in the `[assets]` block.
4. Connect Workers Builds to the repo, root directory = `docs/`, build watch paths = `docs/**`.
5. Enable non-production branch builds for per-PR previews.
6. Verify on the `*.workers.dev` preview URL.
7. Add the custom domain in the Cloudflare dashboard and flip DNS.

---

## 1. Feasibility: Docusaurus as a Static Site on Cloudflare

Docusaurus is a fully static site generator. `docusaurus build` produces an `build/` directory of HTML, CSS, JS, and image files — no Node.js process runs at request time. Cloudflare Workers with Static Assets is purpose-built for exactly this: a `[assets]` block in `wrangler.toml` points at the output directory and Cloudflare serves it from all 300+ edge PoPs.

**Cloudflare product to use: Workers with Static Assets (not Cloudflare Pages).** Cloudflare Pages is in maintenance mode as of early 2026. New features, optimizations, and all future investment go to Workers. Pages continues to run but does not get new capabilities. The official guidance states:

> "Now that Workers supports both serving static assets and server-side rendering, you should start with Workers. Cloudflare Pages will continue to be supported, but, going forward, all of our investment, optimizations, and feature work will be dedicated to improving Workers."

For a static Docusaurus site, no Worker code is needed at all — just the `[assets]` block. Worker code (a `main` field) is optional and only needed for custom server-side logic.

**Cloudflare also ships an official Docusaurus framework guide** (see link below) confirming this path.

Sources:
- [Workers Static Assets — Cloudflare Workers docs](https://developers.cloudflare.com/workers/static-assets/)
- [Migrate from Pages to Workers — Cloudflare Workers docs](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)
- [Docusaurus on Cloudflare Workers — Cloudflare Workers docs](https://developers.cloudflare.com/workers/frameworks/framework-guides/docusaurus/)

---

## 2. Git Auto-Deploy: Monorepo Subdirectory Setup

Workers Builds is Cloudflare's git-connected CI/CD system for Workers. It mirrors what Vercel does: builds on push, preview URLs per branch, GitHub check-run status posted to PRs.

### Connecting the `docs/` subdirectory

Workers Builds supports monorepos via two settings, both configured in the dashboard at Workers & Pages → your project → Settings → Build:

**Root directory:** Set to `docs/`. All build commands run from this path. `wrangler.toml` is resolved relative to it.

**Build watch paths:** Controls which file changes trigger a build. Default is everything. Set include to `docs/**` so that pushes that only touch `api/` or `web/` do not kick off a docs build. You can also add `packages/ui/**` or similar shared dependencies if the docs site imports them.

Evaluation order: excludes are checked first, then includes. If a push hits 3,000+ changed files or 20+ commits, watch paths are bypassed and a build always fires (a minor monorepo edge case).

### Build command and output directory

Build command (run from `docs/`):
```
pnpm build
```
or equivalently `npx docusaurus build`. Output directory (relative to root directory): `build`.

### Per-PR preview deployments

Preview URLs are **not automatic by default** in Workers Builds. You must explicitly enable "non-production branch builds" in Settings → Build. Once enabled, commits to non-production branches trigger a preview deploy via `npx wrangler versions upload` (creates a versioned preview without promoting it to production). Each branch gets a stable preview URL. Vercel does this automatically; on Workers you need one manual toggle.

Sources:
- [Build watch paths — Cloudflare Workers docs](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/)
- [Advanced setups (monorepo) — Cloudflare Workers docs](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/)
- [Build configuration — Cloudflare Workers docs](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)

---

## 3. Rewrites/Redirects Parity

### What `docs/vercel.json` currently defines

```json
{
  "rewrites": [
    { "source": "/docs/:path*", "destination": "/:path*" }
  ],
  "trailingSlash": false
}
```

**Rule 1 — `/docs/:path*` → `/:path*`:** A proxy rewrite. Requests to `/docs/getting-started` are answered with the content of `/getting-started`, with no URL change visible to the browser. This strips a `/docs/` prefix from incoming URLs, likely to support old links or an embed context where the prefix is added upstream.

**Rule 2 — `trailingSlash: false`:** Canonical URLs have no trailing slash. `/getting-started/` redirects to `/getting-started`.

### How to reproduce on Cloudflare

**The proxy rewrite → `_redirects` file (status 200)**

Create `docs/static/_redirects`. Docusaurus copies everything from `docs/static/` into the root of `build/` at build time. Cloudflare Workers reads `_redirects` from the static assets root.

```
/docs/* /:splat 200
```

Status `200` is Cloudflare's proxy mode: the browser stays at `/docs/getting-started` but the response body is served from `/getting-started`. This is equivalent to the Vercel rewrite behavior.

**Syntax notes:**

- `*` is a greedy splat (matches zero or more characters including `/`).
- `:splat` in the destination references the matched value.
- Only one splat per rule. Named placeholders (`:name`) can also be used; they match a single path segment (stops at `/`).
- Proxy with status 200 **only supports relative URLs** — you cannot proxy to an external domain. Here `/:splat` is relative, so this works.
- Chaining does not work: if `/docs/*` proxies to `/:splat`, a request cannot then cascade through a second 200-proxy rule that matches `/:splat`. A single hop only. This is fine here since there's one rule.

**`_redirects` hard limits:**
- 2,000 static redirects + 100 dynamic redirects = 2,100 combined maximum.
- 1,000-character limit per line.
- The docs site currently has 1 rule, so this is nowhere near the limit.

**The trailing-slash flag → `wrangler.toml` `html_handling`**

Set in the `[assets]` block:

```toml
[assets]
directory = "./build"
html_handling = "drop-trailing-slash"
not_found_handling = "404-page"
```

`html_handling` options:
- `"auto-trailing-slash"` (default) — files like `foo.html` served without trailing slash; index files (`foo/index.html`) served with trailing slash.
- `"drop-trailing-slash"` — removes trailing slashes from all HTML requests. Matches Vercel's `trailingSlash: false`.
- `"force-trailing-slash"` — adds trailing slashes everywhere.

`not_found_handling = "404-page"` serves `build/404.html` (which Docusaurus generates) on any unmatched path with a proper `404 Not Found` status. Without this setting, Cloudflare returns a generic error.

**When you would need a Worker instead of `_redirects`**

`_redirects` cannot:
- Proxy to an external domain (e.g., proxy `/api/*` to `https://api.agenta.ai`). Would require a Worker script.
- Conditionally rewrite based on request headers, cookies, or query parameters.
- Set response headers on proxied responses (use `_headers` for static assets).

The current `vercel.json` requires none of these, so `_redirects` is sufficient.

**`_headers` file (optional, for cache/CORS)**

Place `docs/static/_headers` alongside `_redirects`. Example adding a long cache on static assets:

```
/assets/*
  Cache-Control: public, max-age=31536000, immutable

/*.js
  Cache-Control: public, max-age=31536000, immutable

/*.css
  Cache-Control: public, max-age=31536000, immutable
```

Limits: 100 header rules, 2,000 characters per line.

Sources:
- [Redirects (Workers Static Assets) — Cloudflare Workers docs](https://developers.cloudflare.com/workers/static-assets/redirects/)
- [Headers (Workers Static Assets) — Cloudflare Workers docs](https://developers.cloudflare.com/workers/static-assets/headers/)
- [Static Site Generation / html_handling — Cloudflare Workers docs](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/)

---

## 4. Gotchas

**Trailing slashes and the dot-in-URL bug.** Cloudflare Workers has a known issue where URLs containing a dot without a trailing slash return a 404 (e.g., `/api/v1.0`). This is because Cloudflare's asset router treats dots as file extensions and expects a real file. Setting `html_handling = "drop-trailing-slash"` and ensuring `not_found_handling = "404-page"` mitigates most cases, but versioned URL paths like `/cli/0.6.0` can still misbehave. If the docs site has version-number URL segments, test these explicitly on the preview URL before cutover.

**`_redirects` and `_headers` must be in `build/`.** Place them in `docs/static/` (not `docs/` root). Docusaurus copies `docs/static/` contents verbatim into `build/` during build. Files placed directly in `docs/` are not automatically included.

**`not_found_handling` must be set explicitly.** Pages auto-detected SPA vs. standard site. Workers does not. Without `not_found_handling = "404-page"`, unmatched URLs return a Cloudflare-generic error, not Docusaurus's custom 404 page. Set it in `wrangler.toml`.

**Build memory on large Docusaurus sites.** Docusaurus builds can be memory-intensive on sites with many pages (MDX parsing, image optimization, search index generation). The default Cloudflare Workers Builds environment may need a higher memory budget. Add this as a build environment variable if the build OOMs:

```
NODE_OPTIONS=--max-old-space-size=4096
```

**Custom domain requires Cloudflare nameservers.** Cloudflare Workers can only serve custom domains for zones that use Cloudflare DNS (full zone, not CNAME/partial zone). Vercel works with external DNS via CNAME records. If `docs.agenta.ai` is on Cloudflare DNS (likely, given `alef.agenta.ai` routes PostHog through a Cloudflare Worker), adding a custom domain to the Workers project is a single dashboard action. If it is not, a DNS migration to Cloudflare is a prerequisite.

**PostHog proxy at `alef.agenta.ai`.** The PostHog reverse proxy is a separate Cloudflare Worker — it is not part of the Docusaurus deployment and is unaffected by this migration. The Docusaurus site's PostHog initialization points `api_host` at `alef.agenta.ai`; that routing continues to work regardless of where the docs site is hosted.

**Per-PR previews need manual setup.** Unlike Vercel (which enables per-PR previews by default), Workers Builds requires you to explicitly turn on "non-production branch builds" in the dashboard. Do this during setup or preview URLs will not appear on PRs.

**Vercel-specific features.** Vercel's Edge Network, Analytics, Speed Insights, and Web Vitals integrations are Vercel-only. Cloudflare's equivalents are Workers Analytics Engine, Cloudflare Web Analytics (lightweight, privacy-first, zero JS), and Real User Monitoring via the Cloudflare dashboard. If the docs site uses Vercel Analytics today, it will need to be removed or replaced.

Sources:
- [SSG / 404 handling — Cloudflare Workers docs](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/)
- [Dot-in-URL 404 bug — cloudflare/workers-sdk issue #2779](https://github.com/cloudflare/workers-sdk/issues/2779)
- [PostHog Cloudflare reverse proxy — PostHog docs](https://posthog.com/docs/advanced/proxy/cloudflare)
- [Docusaurus deployment — Docusaurus docs](https://docusaurus.io/docs/deployment)

---

## 5. Effort Estimate

This is a small migration. Docusaurus produces a fully static output with no server-side logic; Cloudflare Workers handles it natively with minimal config. The `vercel.json` has one rewrite and one flag, both with direct Cloudflare equivalents.

**Setup (~2–4 hours):** Add `wrangler.toml` to `docs/`, add `docs/static/_redirects` (one line), connect Workers Builds in the dashboard with root directory `docs/` and build watch paths `docs/**`, enable non-production branch builds, verify the preview URL renders correctly including the `/docs/*` proxy rule and 404 behavior.

**Cutover (~1–2 hours):** Add the custom domain in the Cloudflare Workers dashboard, verify SSL provisioning, update the DNS record for `docs.agenta.ai` to point at the Workers route, confirm the live domain resolves, and delete the Vercel project (or leave it idle). If `docs.agenta.ai` is already on Cloudflare DNS, the cutover is a single dashboard action with near-instant propagation. If it is on external DNS, also update the DNS provider, which adds TTL wait time (typically 5–30 minutes with a pre-lowered TTL).

Total: roughly half a day end to end, with no code changes to the Docusaurus site itself.

---

## Full Config Reference

`docs/wrangler.toml`:

```toml
name = "agenta-docs"
compatibility_date = "2026-06-26"

[assets]
directory = "./build"
html_handling = "drop-trailing-slash"
not_found_handling = "404-page"
```

`docs/static/_redirects`:

```
/docs/* /:splat 200
```

Workers Builds settings (dashboard):
- Root directory: `docs`
- Build command: `pnpm build`
- Output directory: `build`
- Build watch paths include: `docs/**`
- Non-production branch builds: enabled
