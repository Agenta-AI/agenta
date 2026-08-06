# Blog Migration Manifest

Migration of the entire Agenta blog from the live Framer site
(`https://agenta.ai/blog`) into git-based MDX for the new Astro site.

- **Source:** `https://agenta.ai/blog/*` (Framer-rendered), discovered via
  `https://agenta.ai/sitemap.xml`.
- **Fetched with:** Jina Reader (`https://r.jina.ai/...`) for body content;
  page `og:image` meta for hero images.
- **Target content:** `website/src/content/posts/<slug>.mdx`,
  `website/src/content/authors/<slug>.json`.
- **Target images:** `website/public/blog/<slug>/` and `website/public/authors/`.
- **Schema:** matches `Agenta landing page pivot/handoff/CONTENT_MODEL.md`
  (`post` and `author` collections) and the two sample posts.
- **Date migrated:** 2026-06-26.

## Totals

- **Posts migrated:** 37 (every `/blog/*` URL in the sitemap).
- **Authors:** 3.
- **Images downloaded:** 70 blog images (37 hero + 33 in-body) + 3 author avatars
  = **73 total**. ~8.1 MB under `public/blog/`, ~272 KB under `public/authors/`.
- **Categories found:** `Article` (19) and `Engineering` (18) — exactly the two
  in the design's taxonomy assumption. No third category exists on the live blog.

## Validation (all passing)

- Every post has all required frontmatter fields (`slug`, `title`, `description`,
  `category`, `date`, `author`, `heroImage`).
- Every hero image resolves to a file on disk; every in-body `/blog/...` image
  reference resolves on disk.
- No leftover `framerusercontent.com` or `r.jina.ai` URLs in any MDX body.
- Exactly one `<InlineCTA />` per post (placed after the first H2).
- All 3 author JSON files are valid JSON.
- Categories: 19 `Article`, 18 `Engineering`.
- Featured set (from the live blog index) flagged correctly:
  `the-definitive-guide-to-prompt-management-systems` (rank 1),
  `the-ai-engineer-s-guide-to-llm-observability-with-opentelemetry` (rank 2),
  `the-ultimate-guide-for-chunking-strategies` (rank 3).

## Category taxonomy (as found on the live blog)

Two categories only, matching the design assumption in `CONTENT_MODEL.md`:

- **`Article`** — guides, product announcements, launch-week recaps, company posts
  (building-in-public, commercial-open-source, SOC2, product updates).
- **`Engineering`** — technical deep-dives and "top N" comparison guides
  (prompt management/versioning/drift, observability, RAG, chunking, structured
  outputs, gateways, LLM-as-a-judge).

No `/blog/author/*` pages exist on the live site; author pages live at
`/authors/<slug>/` instead. Those three were used to build the author records.

## Authors

| slug | name | role | avatar | socials |
|---|---|---|---|---|
| mahmoud-mabrouk | Mahmoud Mabrouk | Co-Founder Agenta & LLM Engineering Expert | `/authors/mahmoud-mabrouk.jpg` (460×460) | linkedin, github |
| ilyes-rezgui | Ilyes Rezgui | AI Research & RAG Systems Expert | `/authors/ilyes-rezgui.jpg` (460×460) | linkedin |
| nizar-karkar | Nizar Karkar | AI & Data Engineer | `/authors/nizar-karkar.jpg` (800×800) | linkedin |

All three avatars were found on the live `agenta.ai/authors/<slug>/` pages and
downloaded from `framerusercontent.com`.

## Posts migrated (37)

| slug | title | date | category | author | images | featured |
|---|---|---|---|---|---|---|
| git-vs-prompt-management-tools | Git vs. Prompt Management Tools: Which Should You Use? | 2026-02-11 | Engineering | mahmoud-mabrouk | 1 | |
| cicd-for-llm-prompts | CI/CD for LLM Prompts: How to Build a Prompt Deployment Pipeline | 2026-02-11 | Engineering | mahmoud-mabrouk | 1 | |
| prompt-drift | Prompt Drift: What It Is and How to Detect It | 2026-02-11 | Engineering | mahmoud-mabrouk | 1 | |
| prompt-management-for-non-engineers | Prompt Management for Non-Engineers | 2026-02-11 | Engineering | mahmoud-mabrouk | 1 | |
| prompt-versioning-guide | Prompt Versioning: The Complete Guide | 2026-02-11 | Engineering | mahmoud-mabrouk | 1 | |
| building-the-data-flywheel-how-to-use-production-data-to-improve-your-llm-application | Building the Data Flywheel | 2025-12-19 | Article | mahmoud-mabrouk | 1 | |
| top-open-source-prompt-management-platforms | Top Open-Source Prompt Management Platforms: A Deep Dive | 2026-01-14 | Engineering | mahmoud-mabrouk | 4 | |
| launch-week-2-day-5-jinja2-prompt-templates | Launch Week #2 Day 5: Jinja2 Prompt Templates | 2025-11-28 | Article | mahmoud-mabrouk | 1 | |
| commercial-open-source-is-hard-our-journey | Commercial Open Source Is Hard: Our Journey | 2025-11-13 | Article | mahmoud-mabrouk | 1 | |
| launch-week-2-day-4-open-sourcing-evaluation | Launch Week #2 Day 4: Open Sourcing Evaluation | 2025-11-13 | Article | mahmoud-mabrouk | 1 | |
| launch-week-2-day-3-evaluation-sdk | Launch Week #2 Day 3: Evaluation SDK | 2025-11-12 | Article | mahmoud-mabrouk | 1 | |
| launch-week-2-day-2-online-evaluation | Launch Week #2 Day 2: Online Evaluation | 2025-11-11 | Article | mahmoud-mabrouk | 1 | |
| launch-week-2-day-1 | Launch Week #2 Day 1: New Evaluation Dashboard | 2025-11-10 | Article | mahmoud-mabrouk | 1 | |
| llm-as-a-judge-guide-to-llm-evaluation-best-practices | LLM as a Judge: Guide to LLM Evaluation & Best Practices | 2025-03-01 | Engineering | mahmoud-mabrouk | 1 | |
| top-llm-gateways | Top LLM Gateways 2025 | 2025-10-01 | Engineering | mahmoud-mabrouk | 1 | |
| top-llm-observability-platforms | Top LLM Observability Platforms 2025 | 2025-07-01 | Engineering | mahmoud-mabrouk | 1 | |
| the-guide-to-structured-outputs-and-function-calling-with-llms | The Guide to Structured Outputs and Function Calling with LLMs | 2025-09-10 | Engineering | mahmoud-mabrouk | 3 | |
| the-ai-engineer-s-guide-to-llm-observability-with-opentelemetry | The AI Engineer's Guide to LLM Observability with OpenTelemetry | 2026-02-25 | Engineering | mahmoud-mabrouk | 3 | rank 2 |
| the-ultimate-guide-for-chunking-strategies | The Ultimate Guide to RAG Chunking Strategies | 2025-08-15 | Engineering | mahmoud-mabrouk | 23 | rank 3 |
| building-in-public-why-we-re-publishing-our-roadmap | Building in Public: Why We're Publishing Our Roadmap | 2025-08-12 | Article | mahmoud-mabrouk | 1 | |
| july-2025-product-updates | July 2025 Product Updates | 2025-08-01 | Article | mahmoud-mabrouk | 1 | |
| humanloop-sunsetting-migration-and-alternative | Humanloop Sunsetting: Migration and Alternative | 2025-09-08 | Article | mahmoud-mabrouk | 1 | |
| top-6-techniques-to-manage-context-length-in-llms | Top 6 Techniques to Manage Context Length in LLMs | 2026-02-25 | Engineering | mahmoud-mabrouk | 1 | |
| top-10-techniques-to-improve-rag-applications | Top 10 Techniques to Improve RAG Applications | 2026-02-25 | Engineering | mahmoud-mabrouk | 1 | |
| how-to-evaluate-rag-metrics-evals-and-best-practices | How to Evaluate RAG: Metrics, Evals, and Best Practices | 2026-02-25 | Engineering | mahmoud-mabrouk | 1 | |
| soc2-type2 | Launch Week Day 5: SOC2 Type 2 Compliance | 2025-04-18 | Article | mahmoud-mabrouk | 1 | |
| structured-outputs-playground | Launch Week Day 4: Structured Output in the Playground | 2025-04-17 | Engineering | mahmoud-mabrouk | 1 | |
| introducing-prompt-registry | Launch Week Day 3: Prompt & Configuration Registry | 2025-04-16 | Article | mahmoud-mabrouk | 1 | |
| introducing-custom-workflows | Launch Week Day 2: Custom Workflows | 2025-04-15 | Article | mahmoud-mabrouk | 1 | |
| introducing-ai-model-hub | Launch Week Day 1: AI Model Hub | 2025-04-15 | Article | mahmoud-mabrouk | 1 | |
| announcing-agenta-launch-week-1-april-15-19 | Agenta Launch Week #1: April 15–19 | 2025-04-14 | Article | mahmoud-mabrouk | 1 | |
| what-we-learned-building-a-prompt-management-system | What We Learned Building a Prompt Management System | 2026-02-25 | Article | mahmoud-mabrouk | 1 | |
| prompt-playground | Introducing Prompt Playground 2.0: A New Prompt Engineering IDE | 2026-02-25 | Engineering | mahmoud-mabrouk | 1 | |
| the-definitive-guide-to-prompt-management-systems | The Definitive Guide to Prompt Management Systems | 2025-01-22 | Article | mahmoud-mabrouk | 1 | rank 1 |
| agenta-achieves-soc2-type-i-certification | Agenta Achieves SOC2 Type I Certification | 2024-01-15 | Article | mahmoud-mabrouk | 1 | |
| product-update-november-2024 | Product Update November 2024: LLM Observability and Prompt Management | 2024-11-26 | Article | mahmoud-mabrouk | 4 | |
| open-source-llm-observability | Introducing Open-Source LLM Observability with Agenta | 2024-11-13 | Engineering | mahmoud-mabrouk | 2 | |

(Image count includes the hero image. e.g. "4" = 1 hero + 3 in-body.)

## Needs manual cleanup / human decisions

1. **Author attribution — ALL posts default to `mahmoud-mabrouk`.** The live
   Framer pages render the byline client-side, so no author name appears in the
   fetched HTML/markdown. The two other authors (`ilyes-rezgui`, `nizar-karkar`)
   have author records and avatars but are **not yet assigned to any post**.
   Someone with CMS access should reassign the posts those two actually wrote
   (likely some of the RAG / chunking / technical guides). This is the single
   biggest item to verify.

2. **Inferred / uncertain publish dates.** Several posts had no explicit publish
   date in the fetched content; dates were inferred from the blog-index listing,
   title cues, launch-week sequencing, or the reader's `Last-Modified`/crawl
   timestamp. Cross-check these against CMS records:
   - `2026-02-25` cluster pulled from crawl/last-modified, not a true publish
     date: `the-ai-engineer-s-guide-to-llm-observability-with-opentelemetry`,
     `what-we-learned-building-a-prompt-management-system`, `prompt-playground`,
     `top-6-techniques-to-manage-context-length-in-llms`,
     `top-10-techniques-to-improve-rag-applications`,
     `how-to-evaluate-rag-metrics-evals-and-best-practices`.
   - Inferred from content/title cues: `top-llm-gateways` (2025-10-01),
     `top-llm-observability-platforms` (2025-07-01),
     `july-2025-product-updates` (2025-08-01), `launch-week-2-day-1` (2025-11-10),
     `top-open-source-prompt-management-platforms` (2026-01-14),
     `launch-week-2-day-5-jinja2-prompt-templates` (2025-11-28).
   - Launch Week #1 posts (`introducing-*`, `structured-outputs-playground`,
     `soc2-type2`, `announcing-*`) sequenced Apr 14–18 2025 by day order; the
     Framer HTML only exposed a generic last-publish timestamp.

3. **`readingTime`** was auto-computed from body word count (~238 wpm). Fine for
   launch, but not authoritative — recompute in code if the renderer prefers.

4. **`InlineCTA` placement** is auto-inserted after the first H2 on every post.
   Editorial review may want to move it on some posts.

5. **Promotional CTAs removed.** Inline signup blocks, "Book a demo", and
   "Get Started" promo blocks from the Framer bodies were stripped and replaced
   by the single `<InlineCTA />`. Inline contextual links to product/docs pages
   were preserved as-is.

6. **Internal links preserved as absolute `agenta.ai` / `cloud.agenta.ai` URLs.**
   Body links that point to docs (`agenta.ai/docs/...`), other blog posts
   (`agenta.ai/blog/...`), product pages, or the app (`cloud.agenta.ai`) were
   kept verbatim. Once the new site's routing is settled, decide whether to
   rewrite blog/product links to site-relative paths.

7. **Author socials are partial.** Only LinkedIn (and GitHub for Mahmoud) were
   confidently captured. Add Twitter/X, ResearchGate, etc. if desired — the
   `socials` array supports any `{ platform, url }`.

8. **`og-default` fallback image not staged.** `CONTENT_MODEL.md` references
   `assets/blog/og-default.png` as a fallback. Every post here has a real hero,
   so it was not needed, but the template author may want to add one for future
   posts without a hero.
