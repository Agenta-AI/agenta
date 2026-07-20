# Marketing website — task board (orchestrator)

Owner: assistant. I update this each round. Task-level detail; `STATUS.md` is the
plain-language summary, `DECISIONS-NEEDED.md` is what I need from Mahmoud.

Legend: `[ ]` todo · `[~]` in progress (subagent) · `[x]` done · `[!]` blocked

## Done (this round, cont.)
- [x] **Clean Framer re-import** — project URL provided; ran via `framer-api`. **37
  posts** (matches live), **3 drafts correctly skipped** via the API draft flag
  (`the-guide-for-building-reliable-llm-applications...`, `product-teams-guide-llm-evaluation`,
  `iso-42001-llm-compliance`). True dates (no inferred cluster), authoritative
  author/co-author attribution (Mahmoud 35, Ilyes 2+1co, Nizar 1co), 107 images
  re-downloaded, internal links site-relative. Tags mapped to Article(26)/Engineering(11),
  original tag kept in `tags[]`. Build green.
- [x] **Branding-kit favicon set wired** — favicon.ico + 16/32 + apple-touch +
  android-chrome 192/512 + site.webmanifest (from the `branding-kit` R2 bucket),
  replacing the single Framer PNG. Manifest fixed for the dark site.

## Done (this round, cont.)
- [x] **Official logos swapped** in from the `branding-kit` R2 bucket (same filenames).
- [x] **Image optimization + alt text** — 109 images → WebP (≤1600px), **6.65 MB saved
  (61%)**; lazy-load + decoding + width/height + alt everywhere (BlogImage MDX
  component, hero eager/high-priority, cards alt=title). 199 dist files.
- [x] **Placeholder title/description** with build-time warning (`DECISIONS Q4`).
- [x] **`PUBLIC_NOINDEX` flag** (meta robots + disallow robots.txt) for the test deploy.
- [x] **TEST DEPLOY LIVE** → https://agenta-website.mahmoud-637.workers.dev (noindex,
  analytics off, fonts from R2). Verified all routes 200 from the public internet.

## Next / open
- [ ] **Licensed fonts (A1)** — still pending from Mahmoud. TRIAL woff2 are in
  `public/fonts/` + R2 + on the test deploy; MUST swap before any public/agenta.ai launch.
- [ ] **Custom domain `preview.agenta.ai`** — needs Mahmoud's Cloudflare dashboard step
  (token lacks Workers Routes); see DECISIONS N3.
- [ ] **Final pivot title/description copy** (Q4) — placeholders live now.
- [ ] **Commit** — still held per Mahmoud (Q2); CI workflow lands with it.
- [ ] **Commit-time font exclusion** — the trial fonts are tracked in the GitButler
  workspace commit; exclude `website/public/fonts/*` when we create the website lane
  (do it via `but`, NOT raw `git rm` — that deleted them from disk last time). Root
  `.gitignore` now lists them.

## Done (this round)
- [x] **Secrets stored + verified** — Cloudflare token (`wrangler whoami` OK), R2 S3
  keys, Framer key → `~/.agenta-marketing.env` (600); recorded in memory.
- [x] **Head items applied** — GA4 `G-368ZWZSH5D`, favicon + apple-touch-icon,
  default title/description (from Framer), OG/social default, **URL-param preservation
  script** (replicates Framer), and `/terms` + `/privacy-policy` routes → **docs**.
- [x] **Framer site settings extracted** (title/desc/favicon/og/url-param) →
  `research/framer-site-settings.md`.
- [x] **R2 live** — bucket `agenta-website-fonts` created, 6 fonts uploaded +
  round-trip verified. Pipeline validated.
- [x] **Fonts restored** after a GitButler-triggered deletion (re-converted from the
  design OTF/TTF); dev preview renders real fonts again.
- [x] **Deploy/font infra scaffolding (Group C)** — fallback CSS, R2 fetch script,
  `_headers`, runbook, CI draft.

## Todo
- [ ] **Clean Framer re-import (blocked on N2 key)** — re-import the 37 posts + authors via the Framer **Server API** (`framer-api`): true bodies, real dates, correct authors/co-authors, cover images. This SUPERSEDES the scrape and is the right home for ↓.
- [ ] **Folded into the re-import** (do them on the clean import, not twice): in-body link rewrite (absolute `agenta.ai` → site-relative), the ~16 inferred dates (re-import carries true dates), **image optimization** (import into `src/assets` + Astro `<Image>` per CF best practice — `public/` images aren't optimized), and **alt text** (else a re-import overwrites it).

## Done (this round)
- [x] **SEO foundation** — canonical, OG/Twitter, `@astrojs/sitemap` (45 URLs), robots.txt, JSON-LD (Article + Organization + WebSite), `site` set. Build green, 47 pages / 145 files.
- [x] **Analytics (PostHog)** — wired via `alef.agenta.ai` proxy, env-gated `PUBLIC_POSTHOG_KEY`; GA4 optional via `PUBLIC_GA_ID` (needs own marketing property — Q3).
- [x] **Custom dark 404 page** (`src/pages/404.astro`, noindex).
- [x] **F1 / C1 investigations** → exact auth asks recorded in DECISIONS N1 (CF token scopes) + N2 (Framer Server API key).

## Blocked on Mahmoud / design (see DECISIONS-NEEDED.md)
- [!] Licensed font binaries (A1) · landing videos (A2) · real prices (A3) · imprint legal fields (A4).
- [!] No-DC page designs (imprint/contact/terms/privacy/authors) → design agent.
- [!] Commit to a GitButler lane — Mahmoud said wait (Q2).

## Done
- [x] Stack decided (Astro v6 + Cloudflare Workers, static-first) + validated low-risk.
- [x] All pages built: landing, pricing, blog index/post/author, legal; 37 posts + 73 images migrated.
- [x] QA pass + 4 code-bug fixes (filter, footer links, mobile overflow, a11y).
- [x] Links matched to live URL map; author routing → `/authors/`; attribution + co-authors fixed.
- [x] Licensed fonts gitignored + untracked; `website/AGENTS.md` (+ CLAUDE.md) asset policy.
- [x] claude.design investigated → it's the `baoyu-design` skill, no API; file handoff is the path.
- [x] Remote dev preview bound to `0.0.0.0` → http://144.76.237.122:4321/.
