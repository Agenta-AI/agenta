# Decisions / inputs needed from Mahmoud

What I need from you to unblock work. Scan this anytime; answer here or in chat. I keep
statuses current. `OPEN` = waiting on you, `ANSWERED` = done.

## Auth / access I'm asking for (you offered to provide)

- **N1 — Cloudflare token + account ID** · `ANSWERED` (2026-06-27). Stored in
  `~/.agenta-marketing.env`, token verified via `wrangler whoami`. **Caveat:** the
  token is missing the **Workers Routes** scope (you couldn't find it), so attaching
  the custom domain `agenta.ai` will need a dashboard click or an updated token; R2 +
  deploy work without it. Original ask kept below for reference.
  Create a Cloudflare **Custom API
  token** (My Profile → API Tokens → Create → Custom Token) with EXACTLY these rows:
  - **Account Settings : Read** (your account)
  - **Workers Scripts : Edit** (your account)
  - **Workers R2 Storage : Edit** (your account)
  - **Workers Routes : Edit** (Zone → agenta.ai)
  Plus your **Account ID** (32-char hex in the dashboard right sidebar). With these I
  can create the R2 bucket, upload the licensed fonts, deploy via wrangler, and wire
  auto-deploy on push. The only thing only YOU can do is install the Cloudflare
  Workers GitHub App (enables PR-preview deploys) — optional, later.
  - **How to hand it over safely:** don't paste the token in chat. Put it in a
    600-mode file like `~/.cloudflare-agenta.env` (`CLOUDFLARE_API_TOKEN=...` +
    `CLOUDFLARE_ACCOUNT_ID=...`) and tell me the path, same as `~/.agenta-eu.env`.
- **N2 — Framer re-import** · `ANSWERED / DONE`. Project URL provided; clean re-import
  ran. 37 posts imported with true dates + correct authors + images. **FYI — 3 drafts
  were skipped** (they're unpublished in your Framer CMS, so we left them out to match
  live): `the-guide-for-building-reliable-llm-applications-for-product-and-ai-teams`,
  `product-teams-guide-llm-evaluation`, `iso-42001-llm-compliance`. They'll publish
  automatically on the next re-import once you mark them published in Framer.
  (Original instructions below.) In the Framer editor for the agenta.ai
  project: **Site Settings → General → Server API → Generate API Key**. Send me the
  key + the project URL (`framer.com/projects/<id>`). It's project-scoped and
  revocable. With it I re-import the blog cleanly (true HTML bodies, real publish
  dates, correct author/co-author refs, cover images) via the `framer-api` package —
  fixing the in-body links, the ~16 inferred dates, and attribution in one pass.
  (Fallback if you prefer no key: install the free "JSON Import & Export" Framer
  plugin, export the Posts + Authors collections, and send me the JSON files.)

- **N3 — Custom domain (dashboard step, only you can do it)** · `OPEN`. The test site
  is live at `https://agenta-website.mahmoud-637.workers.dev` (non-discoverable). To put
  it on a `*.agenta.ai` subdomain (e.g. `preview.agenta.ai`), in the Cloudflare
  dashboard: Workers & Pages → the `agenta-website` worker → Settings → Domains &
  Routes → add `preview.agenta.ai` as a custom domain. (Needs `agenta.ai` to be on
  Cloudflare DNS, and the token's missing Workers Routes scope is why I can't script
  it.) Tell me when it's added and I'll confirm it serves.

## Assets you / the design agent must provide

- **A1 — Licensed font binaries** (GT Alpina, PP Mondwest) · `OPEN`. We ship the TRIAL
  versions now (local + R2 + on the test deploy). **Must swap to licensed before any
  public / agenta.ai launch.** Send me the licensed woff2/otf and I'll upload to R2 +
  redeploy. (Your `branding-kit` R2 bucket has icons/logos but no fonts.)
- **A2 — Landing video(s)** as YouTube links · `OPEN`. Two slots (hero + "Monitor usage").
- **A3 — Real pricing numbers** · `OPEN`. You're reworking pricing.
- **A4 — Imprint legal fields** verbatim · `OPEN`. Managing director, Handelsregister no., USt-IdNr.

## Decisions / confirmations

- **Q1 — Terms/Privacy routing** · `PARTLY ANSWERED`. You said both footer **Privacy**
  links should match → done, both now go to the **docs** privacy page (termly removed
  from the footer). Still open: the standalone **`/privacy-policy` and `/terms` routes**
  currently 308-redirect to **termly** (matching live), and the footer **Terms** link
  goes to **docs**. Do you want those routes unified to **docs** too (so everything
  terms/privacy points at documentation)? Default if you don't answer: I'll unify them
  all to docs, since you've said docs twice.
- **Q2 — Commit timing** · `OPEN`. You said wait. Tell me when to put `website/` +
  docs on a GitButler lane.
- **Q3 — Analytics property** · `ANSWERED`. GA4 = `G-368ZWZSH5D` (marketing site's own).
  Being wired alongside PostHog.
- **Q4 — Site title + description wording** · `OPEN`. The title/description I pulled
  from Framer reflect the OLD positioning ("Prompt Management, Evaluation, and
  Observability for LLM apps"), but this site is the **agents pivot**. For now I'm
  using the agents-pivot title on the homepage + a general description as the
  site-wide default. Give me the exact site `<title>` + meta description you want for
  the pivot and I'll set them verbatim.

## Answered (for the record)

- Host = Cloudflare Workers, framework = Astro, static-first. · `ANSWERED`
- Author URLs = live's `/authors/<slug>/` (canonical SEO rule: match live, only add). · `ANSWERED`
- Pricing monthly/annual toggle kept; pricing itself deferred to you. · `ANSWERED`
- `/contact` + `/imprint` kept as-is. Light theme later. Video host = YouTube. · `ANSWERED`
- Fonts: licensed, gitignored, injected at build time from R2; video via YouTube not Stream. · `ANSWERED`
