# Agenta Live Site: Definitive URL + Link Map

Captured: 2026-06-27  
Source: raw HTML fetch of `https://agenta.ai/`, sitemap.xml, curl redirect chains  
Method: raw HTML anchor extraction (not Jina/WebFetch rendering) to get exact hrefs before JS normalisation

---

## Canonical rules

| Rule | Value |
|------|-------|
| Apex vs www | Apex is canonical. `www.agenta.ai` → 308 → `https://agenta.ai/` |
| HTTP vs HTTPS | HTTPS only. HTTP upgrades automatically (Cloudflare). |
| Trailing slash — pages | **No trailing slash.** `/blog/`, `/pricing/`, `/authors/` all 308 → no-slash version. |
| Trailing slash — author profiles | **Trailing slash required.** `/authors/mahmoud-mabrouk` → 308 → `/authors/mahmoud-mabrouk/` |
| Blog post format | No trailing slash. `/blog/<slug>` is canonical; `/blog/<slug>/` 308 → `/blog/<slug>`. |
| Authors index | No trailing slash. `/authors` is canonical. |
| Docs subdomain | `docs.agenta.ai` → 301 → `https://agenta.ai/docs/` (docs are served on the main domain via a proxy worker). All footer/nav docs links use `https://agenta.ai/docs/...`. |

**Summary of trailing-slash policy:** trailing slash on author profile URLs only; all other paths are no-slash canonical.

---

## Full page table (sitemap + discovered pages)

| Live URL (canonical) | Type | Notes |
|---------------------|------|-------|
| `https://agenta.ai/` | page | Homepage |
| `https://agenta.ai/pricing` | page | |
| `https://agenta.ai/blog` | page | |
| `https://agenta.ai/authors` | page | Authors index |
| `https://agenta.ai/authors/mahmoud-mabrouk/` | page | Trailing slash canonical |
| `https://agenta.ai/authors/ilyes-rezgui/` | page | Trailing slash canonical |
| `https://agenta.ai/authors/nizar-karkar/` | page | Trailing slash canonical |
| `https://agenta.ai/launch-week-1` | page | Campaign archive; live page (no redirect on the Framer site) |
| `https://agenta.ai/launch-week-2` | page | Campaign archive; live page (no redirect on the Framer site) |
| `https://agenta.ai/imprint` | page | German Impressum; also serves as the "Contact" page |
| `https://agenta.ai/terms` | redirect | 308 → `https://app.termly.io/policy-viewer/policy.html?policyUUID=506861af-ea3d-41d2-b85a-561e15b0c7b7` |
| `https://agenta.ai/privacy-policy` | redirect | 308 → `https://app.termly.io/document/privacy-policy/ce8134b1-80c5-44b7-b3b2-01dba9765e59` → 301 → `https://app.termly.io/policy-viewer/policy.html?policyUUID=ce8134b1-80c5-44b7-b3b2-01dba9765e59` |
| `https://agenta.ai/blog/git-vs-prompt-management-tools` | blog post | |
| `https://agenta.ai/blog/cicd-for-llm-prompts` | blog post | |
| `https://agenta.ai/blog/prompt-drift` | blog post | |
| `https://agenta.ai/blog/prompt-management-for-non-engineers` | blog post | |
| `https://agenta.ai/blog/prompt-versioning-guide` | blog post | |
| `https://agenta.ai/blog/building-the-data-flywheel-how-to-use-production-data-to-improve-your-llm-application` | blog post | |
| `https://agenta.ai/blog/top-open-source-prompt-management-platforms` | blog post | |
| `https://agenta.ai/blog/launch-week-2-day-5-jinja2-prompt-templates` | blog post | |
| `https://agenta.ai/blog/commercial-open-source-is-hard-our-journey` | blog post | |
| `https://agenta.ai/blog/launch-week-2-day-4-open-sourcing-evaluation` | blog post | |
| `https://agenta.ai/blog/launch-week-2-day-3-evaluation-sdk` | blog post | |
| `https://agenta.ai/blog/launch-week-2-day-2-online-evaluation` | blog post | |
| `https://agenta.ai/blog/launch-week-2-day-1` | blog post | |
| `https://agenta.ai/blog/llm-as-a-judge-guide-to-llm-evaluation-best-practices` | blog post | |
| `https://agenta.ai/blog/top-llm-gateways` | blog post | |
| `https://agenta.ai/blog/top-llm-observability-platforms` | blog post | |
| `https://agenta.ai/blog/the-guide-to-structured-outputs-and-function-calling-with-llms` | blog post | |
| `https://agenta.ai/blog/the-ai-engineer-s-guide-to-llm-observability-with-opentelemetry` | blog post | |
| `https://agenta.ai/blog/the-ultimate-guide-for-chunking-strategies` | blog post | |
| `https://agenta.ai/blog/building-in-public-why-we-re-publishing-our-roadmap` | blog post | |
| `https://agenta.ai/blog/july-2025-product-updates` | blog post | |
| `https://agenta.ai/blog/humanloop-sunsetting-migration-and-alternative` | blog post | |
| `https://agenta.ai/blog/top-6-techniques-to-manage-context-length-in-llms` | blog post | |
| `https://agenta.ai/blog/top-10-techniques-to-improve-rag-applications` | blog post | |
| `https://agenta.ai/blog/how-to-evaluate-rag-metrics-evals-and-best-practices` | blog post | |
| `https://agenta.ai/blog/soc2-type2` | blog post | |
| `https://agenta.ai/blog/structured-outputs-playground` | blog post | |
| `https://agenta.ai/blog/introducing-prompt-registry` | blog post | |
| `https://agenta.ai/blog/introducing-custom-workflows` | blog post | |
| `https://agenta.ai/blog/introducing-ai-model-hub` | blog post | |
| `https://agenta.ai/blog/announcing-agenta-launch-week-1-april-15-19` | blog post | |
| `https://agenta.ai/blog/what-we-learned-building-a-prompt-management-system` | blog post | |
| `https://agenta.ai/blog/prompt-playground` | blog post | |
| `https://agenta.ai/blog/the-definitive-guide-to-prompt-management-systems` | blog post | |
| `https://agenta.ai/blog/agenta-achieves-soc2-type-i-certification` | blog post | |
| `https://agenta.ai/blog/product-update-november-2024` | blog post | |
| `https://agenta.ai/blog/open-source-llm-observability` | blog post | |

### Confirmed 404s (do not exist on agenta.ai)

`/contact`, `/security`, `/about`, `/features`, `/product`, `/changelog`, `/community`, `/open-source`, `/dpa`, `/tutorial`, `/roadmap` — all 404. These are only accessible via `agenta.ai/docs/...` paths.

---

## Redirect chains (full)

| URL | Chain | Final destination |
|-----|-------|-------------------|
| `https://www.agenta.ai/` | 308 | `https://agenta.ai/` |
| `https://agenta.ai/terms` | 308 | `https://app.termly.io/policy-viewer/policy.html?policyUUID=506861af-ea3d-41d2-b85a-561e15b0c7b7` |
| `https://agenta.ai/privacy-policy` | 308 → 301 | `https://app.termly.io/policy-viewer/policy.html?policyUUID=ce8134b1-80c5-44b7-b3b2-01dba9765e59` |
| `https://agenta.ai/launch-week-1` | — | 200 (live page; no redirect on live Framer site) |
| `https://agenta.ai/launch-week-2` | — | 200 (live page; no redirect on live Framer site) |
| `https://agenta.ai/blog/` | 308 | `https://agenta.ai/blog` |
| `https://agenta.ai/pricing/` | 308 | `https://agenta.ai/pricing` |
| `https://agenta.ai/authors/` | 308 | `https://agenta.ai/authors` |
| `https://agenta.ai/authors/mahmoud-mabrouk` | 308 | `https://agenta.ai/authors/mahmoud-mabrouk/` |
| `https://agenta.ai/blog/prompt-playground/` | 308 | `https://agenta.ai/blog/prompt-playground` |
| `https://docs.agenta.ai/` | 301 | `https://agenta.ai/docs/` |

**Terms of service redirect:** The live site redirects `/terms` directly to termly.io (not docs.agenta.ai). However the **footer "Terms of services" link** does NOT use `/terms` — it links directly to `https://agenta.ai/docs/administration/security/terms-of-service`. The `/terms` and `/privacy-policy` slugs exist as Framer redirect pages that bounce to termly.io and are NOT linked from the footer.

**Privacy policy footer link:** Links directly to `https://agenta.ai/docs/administration/security/privacy-policy` (not to `/privacy-policy` or termly.io). There is also a bottom-bar "Privacy policy" link to `/privacy-policy` (which redirects to termly.io). These are two different links with two different destinations.

---

## Link destinations table

### Nav bar

| Label | Exact href on live site | Notes |
|-------|------------------------|-------|
| Logo | `./` (= `https://agenta.ai/`) | |
| Pricing | `./pricing` | |
| Docs | `https://agenta.ai/docs` | NOT `docs.agenta.ai` |
| Blog | `./blog` | |
| Resources (dropdown label) | non-linking dropdown trigger | |
| Community (dropdown label) | non-linking dropdown trigger | |
| Book a demo | `https://cal.com/mahmoud-mabrouk-ogzgey/demo?duration=30` | |
| Get started | `https://cloud.agenta.ai/` | |

#### Resources dropdown items

| Label | Exact href |
|-------|-----------|
| Tutorial | `https://agenta.ai/docs/tutorials/cookbooks/capture-user-feedback` |
| Changelog | `https://agenta.ai/docs/changelog/main` |
| Roadmap | `https://agenta.ai/docs/roadmap` |

#### Community dropdown items

| Label | Exact href |
|-------|-----------|
| Github | `https://github.com/Agenta-AI/agenta/discussions` |
| Slack | `https://join.slack.com/t/agenta-hq/shared_invite/zt-37pnbp5s6-mbBrPL863d_oLB61GSNFjw` |
| Youtube | `https://www.youtube.com/@agentaAI` |
| Linkedin | `https://www.linkedin.com/company/agenta-ai/` |
| X / Twitter | `https://twitter.com/agenta_ai` |

Note: The nav has NO "Product" dropdown. Product links (Prompt Engineering, Evaluation, etc.) are footer-only.

---

### Footer columns

#### Product column (footer only — not in nav)

| Label | Exact href |
|-------|-----------|
| Prompt Engineering | `https://agenta.ai/docs/prompt-engineering/quick-start` |
| Evaluation | `https://agenta.ai/docs/evaluation/evaluation-from-ui/quick-start` |
| Human annotation | `https://agenta.ai/docs/evaluation/human-evaluation/quick-start` |
| Deployment | `https://agenta.ai/docs/prompt-engineering/managing-prompts-programatically/deploy` |
| Observability | `https://agenta.ai/docs/observability/overview` |

#### Company column

| Label | Exact href |
|-------|-----------|
| Home | `./` |
| Pricing | `./pricing` |
| Contact | `./imprint` |

#### Resources column

| Label | Exact href |
|-------|-----------|
| Docs | `https://agenta.ai/docs/` |
| Tutorial | `https://agenta.ai/docs/tutorials/cookbooks/capture-user-feedback` |
| Changelog | `https://agenta.ai/docs/changelog/main` |
| Roadmap | `https://agenta.ai/docs/roadmap` |
| Blog | `./blog` |
| Status | `https://status.agenta.ai/` |

#### Legal column

| Label | Exact href |
|-------|-----------|
| Imprint | `./imprint` |
| Terms of services | `https://agenta.ai/docs/administration/security/terms-of-service` |
| Privacy Policy | `https://agenta.ai/docs/administration/security/privacy-policy` |
| DPA | `https://agenta.ai/docs/administration/security/dpa` |
| Trust Center | `https://trustcenter.agenta.ai/` |
| Privacy Policy (duplicate, bottom bar) | `https://app.termly.io/policy-viewer/policy.html?policyUUID=ce8134b1-80c5-44b7-b3b2-01dba9765e59` |

The live site has TWO "Privacy Policy" links: one in the Legal column (→ docs) and one in the bottom copyright bar (→ termly.io directly, not via `/privacy-policy`). This is the duplicate noted in site-inventory.md.

#### Social icons (footer)

| Platform | Exact href |
|----------|-----------|
| GitHub | `https://github.com/agenta-ai/agenta` (lowercase) |
| Slack | `https://join.slack.com/t/agenta-hq/shared_invite/zt-2yewk6o2b-DmhyA4h_lkKwecDtIsj1AQ` |
| LinkedIn | `https://www.linkedin.com/company/agenta-ai/` |
| YouTube | `https://www.youtube.com/@agentaAI` |
| Twitter/X | `https://twitter.com/agenta_ai` |

---

## Key facts called out explicitly

### Real Slack URLs (there are TWO, different tokens)

| Location | Slack invite URL |
|----------|-----------------|
| Nav Community dropdown | `https://join.slack.com/t/agenta-hq/shared_invite/zt-37pnbp5s6-mbBrPL863d_oLB61GSNFjw` |
| Footer social icon | `https://join.slack.com/t/agenta-hq/shared_invite/zt-2yewk6o2b-DmhyA4h_lkKwecDtIsj1AQ` |

Both are real invite links (the community name is `agenta-hq`). The footer icon uses the older `zt-2yewk6o2b` token. Our build should use both tokens in the respective locations, or standardise on one (the newer `zt-37pnbp5s6` is more recent and appears in the nav Community section).

### Product link destinations (footer, not `/product/*`)

All Product column links go to `agenta.ai/docs/...` paths, not to any `/product/*` URL on agenta.ai. The `/product/prompt-engineering` path returns 404.

| Product item | Live destination |
|-------------|-----------------|
| Prompt Engineering | `https://agenta.ai/docs/prompt-engineering/quick-start` |
| Evaluation | `https://agenta.ai/docs/evaluation/evaluation-from-ui/quick-start` |
| Human annotation | `https://agenta.ai/docs/evaluation/human-evaluation/quick-start` |
| Deployment | `https://agenta.ai/docs/prompt-engineering/managing-prompts-programatically/deploy` |
| Observability | `https://agenta.ai/docs/observability/overview` |

### Where /terms and /privacy-policy redirect

- `/terms` → 308 → `https://app.termly.io/policy-viewer/policy.html?policyUUID=506861af-ea3d-41d2-b85a-561e15b0c7b7`
- `/privacy-policy` → 308 → 301 → `https://app.termly.io/policy-viewer/policy.html?policyUUID=ce8134b1-80c5-44b7-b3b2-01dba9765e59`

Neither is linked from the footer Legal column. The footer Legal column links directly to docs pages. The bottom-bar "Privacy policy" link goes to termly.io directly (bypassing the `/privacy-policy` redirect).

### Author URL format

- Author profiles: **trailing slash required** — `/authors/<slug>/` is canonical; no-slash version 308-redirects to slash version.
- Authors index: **no trailing slash** — `/authors` is canonical.

### Blog post URL format

- **No trailing slash.** `/blog/<slug>` is canonical.

---

## Delta vs our current build

Sources compared: `website/src/components/NavBar.astro`, `website/src/components/Footer.astro`, `website/astro.config.mjs`

### NavBar.astro deltas

| Our build | Live site | Fix needed |
|-----------|-----------|-----------|
| `Product` → `"#"` (dropdown placeholder) | No "Product" dropdown exists in nav at all | Remove the "Product" nav item entirely |
| `Resources` → `"#"` | Resources dropdown has Tutorial/Changelog/Roadmap as actual links | Implement Resources dropdown with real hrefs |
| `Community` → `"#"` | Community dropdown has Github/Slack/Youtube/Linkedin/X with real hrefs | Implement Community dropdown with real hrefs |
| No Docs link content defined beyond the label | Live: `Docs` links to `https://agenta.ai/docs` (not `docs.agenta.ai`) | Correct — our build already has `href: "https://docs.agenta.ai/"` which redirects there; but exact href should be `https://agenta.ai/docs` |

### Footer.astro deltas

| Our build | Live site | Fix needed |
|-----------|-----------|-----------|
| Product: `href: "/product/prompt-engineering"` | Live: `https://agenta.ai/docs/prompt-engineering/quick-start` | Fix all 5 Product links to `agenta.ai/docs/...` paths |
| Product: `href: "/product/evaluation"` | Live: `https://agenta.ai/docs/evaluation/evaluation-from-ui/quick-start` | Fix |
| Product: `href: "/product/human-annotation"` | Live: `https://agenta.ai/docs/evaluation/human-evaluation/quick-start` | Fix |
| Product: `href: "/product/deployment"` | Live: `https://agenta.ai/docs/prompt-engineering/managing-prompts-programatically/deploy` | Fix |
| Product: `href: "/product/observability"` | Live: `https://agenta.ai/docs/observability/overview` | Fix |
| Company: `href: "/contact"` | Live: `./imprint` | Fix — `/contact` 404s, must be `/imprint` |
| Resources: `href: "/tutorial"` | Live: `https://agenta.ai/docs/tutorials/cookbooks/capture-user-feedback` | Fix — `/tutorial` 404s |
| Resources: `href: "/changelog"` | Live: `https://agenta.ai/docs/changelog/main` | Fix — `/changelog` 404s |
| Resources: `href: "/roadmap"` | Live: `https://agenta.ai/docs/roadmap` | Fix — `/roadmap` 404s |
| Legal: `href: "/terms"` | Live: links directly to `https://agenta.ai/docs/administration/security/terms-of-service` | Fix — footer doesn't use `/terms`; links to docs directly |
| Legal: `href: "/privacy-policy"` | Live: links to `https://agenta.ai/docs/administration/security/privacy-policy` | Fix — footer doesn't use `/privacy-policy`; links to docs directly |
| Legal: DPA → `https://docs.agenta.ai/` | Live: `https://agenta.ai/docs/administration/security/dpa` | Fix — exact DPA path is known |
| Social: Slack → `https://join.slack.com/` (placeholder) | Live footer: `https://join.slack.com/t/agenta-hq/shared_invite/zt-2yewk6o2b-DmhyA4h_lkKwecDtIsj1AQ` | Fix with real token |
| Social: only 4 icons (X, LinkedIn, GitHub, Slack) | Live footer: 5 icons (X, LinkedIn, GitHub, Slack, YouTube) | Add YouTube: `https://www.youtube.com/@agentaAI` |
| Social: LinkedIn → `https://www.linkedin.com/company/agenta-ai` (no trailing slash) | Live: `https://www.linkedin.com/company/agenta-ai/` (trailing slash) | Minor — LinkedIn redirects either way |
| Bottom-bar Privacy policy → `/privacy-policy` | Live: `https://app.termly.io/policy-viewer/policy.html?policyUUID=ce8134b1-80c5-44b7-b3b2-01dba9765e59` | Live links directly to termly; our build links to `/privacy-policy` which would redirect there — functionally OK but not 1:1 |
| No Trust Center in social icons | Live: SOC2/Trust Center badge present | Low priority visual element |

### astro.config.mjs redirects delta

| Our build | Live site | Assessment |
|-----------|-----------|-----------|
| `/launch-week-1` → `/blog` | Live Framer site: `/launch-week-1` is a 200 real page (no redirect) | Our redirect loses the content; acceptable if we don't rebuild those pages |
| `/launch-week-2` → `/blog` | Live Framer site: `/launch-week-2` is a 200 real page (no redirect) | Same — acceptable redirect for archive content |
| `/authors` → `/blog/author` | Live: `/authors` is a 200 page at that exact path | Our redirect breaks the live URL; we should serve the authors index at `/authors` not redirect it |
| `/authors/mahmoud-mabrouk` → `/blog/author/mahmoud-mabrouk` | Live: author pages ARE at `/authors/<slug>/` (with trailing slash) | Our redirect maps the OLD path (no-slash) to our NEW path; but our new path is non-standard vs live. Author routing should stay at `/authors/<slug>/` |
| `/authors/ilyes-rezgui` → `/blog/author/ilyes-rezgui` | Same issue | Fix |
| `/authors/nizar-karkar` → `/blog/author/nizar-karkar` | Same issue | Fix |

**Author routing recommendation:** The live Framer site uses `/authors/<slug>/` (trailing slash canonical). Our build redirects these to `/blog/author/<slug>`. To preserve live URL compatibility, serve author pages at `/authors/<slug>/` (matching the live pattern) and drop the redirect. The `/blog/author/*` path is our invention and does not exist on the live site.

---

## Summary of priority fixes

1. **Product footer links** — all 5 point to `/product/*` (404). Fix to `agenta.ai/docs/...` paths.
2. **Slack invite URL** — `https://join.slack.com/` placeholder. Fix to `zt-2yewk6o2b` (footer social) and `zt-37pnbp5s6` (nav Community dropdown).
3. **Footer Company "Contact"** — points to `/contact` (404). Fix to `/imprint`.
4. **Footer Resources links** — Tutorial/Changelog/Roadmap all point to internal paths that 404. Fix to `agenta.ai/docs/...` paths.
5. **Footer Legal links** — Terms and Privacy link to `/terms` and `/privacy-policy` (which redirect to termly). Live footer links directly to `agenta.ai/docs/administration/security/...`. Fix.
6. **DPA link** — currently a fallback to `docs.agenta.ai`. Fix to `https://agenta.ai/docs/administration/security/dpa`.
7. **Author routing** — our build sends authors to `/blog/author/*`; live site uses `/authors/<slug>/`. Fix author pages to the live URL pattern.
8. **Missing YouTube social icon** — add `https://www.youtube.com/@agentaAI` to footer socials.
9. **Nav dropdowns** — Resources and Community dropdowns need real links; Product dropdown should be removed from nav (it's footer-only on the live site).
