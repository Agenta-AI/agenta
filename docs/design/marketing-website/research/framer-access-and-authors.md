# Framer Access and Author Attribution Research

Date: 2026-06-27

---

## Task 1 — Programmatic access to the Framer blog

### RSS / Atom feed

All common feed paths return HTTP 404:

| URL | Status |
|-----|--------|
| `https://agenta.ai/rss` | 404 |
| `https://agenta.ai/rss.xml` | 404 |
| `https://agenta.ai/feed` | 404 |
| `https://agenta.ai/feed.xml` | 404 |
| `https://agenta.ai/blog/rss.xml` | 404 |
| `https://agenta.ai/blog/feed` | 404 |

Framer does not generate RSS feeds natively. Third-party plugins (Feedify, Comminova RSS) can add one, but none is installed on `agenta.ai` today.

### Framer search index JSON (the best programmatic path)

Each published Framer site exposes a search index at a stable URL embedded in the page source:

```
https://framerusercontent.com/sites/7LpPYxrZctXUOPy5xCI2KE/searchIndex-xCNLKtecCBer.json
```

This JSON file contains structured entries for every page — all 37 blog posts, the three author pages, and static pages. Each post entry carries `title`, `description`, `url`, and flattened heading/paragraph text. Author pages carry `h3` headings for the posts attributed to that author.

**Limitations of the search index:**
- No `author` field per post entry (author names appear as paragraph text, not a typed field).
- No publication date per post (date appears in paragraph text, not a typed field).
- The URL is derived from the page source and will change on the next Framer publish if the site is republished with different assets. It should be re-extracted from the live HTML rather than hardcoded.
- No post body content beyond headings and paragraph excerpts.

### Framer handover data (`<script type="framer/handover">`)

Each page also embeds a large opaque binary-ish blob in a `<script type="framer/handover">` tag. It contains CMS relation queries in Framer's internal AST format (obfuscated collection IDs like `SX0aSs9Fy`). This is not a public API — the schema is undocumented and the field names are hashed. Not usable without Framer internals.

### Framer CMS export / API

There is no public CMS read API for a published Framer site. The editor-side API (used in Framer plugins) is not accessible from outside the Framer app. The `framer.com/help/articles/porting-your-data-from-framer/` page confirms export is only available through the editor.

### Verdict

**Best programmatic path: the search index JSON.** It is the only machine-readable structured endpoint that lists all posts with title, description, and author attribution (via the author page entries). Use `curl` to fetch the page source, extract the `searchIndex-*.json` URL, and fetch it — this gives you author-to-post mapping without scraping rendered HTML.

For post bodies, the only reliable path remains fetching each post's raw HTML and extracting the author byline via the `href="../authors/<slug>/"` link pattern in the page source (no JS execution needed — the byline is server-rendered in the static HTML).

The search index is better than the current approach (scraping rendered HTML via Jina) because it is a single JSON fetch for the full post list. It is not better than a native RSS feed would be, but no feed exists.

---

## Task 2 — Definitive per-post author attribution

### Method

Author attribution was determined from two sources, cross-checked against each other:

1. **Framer search index JSON** — the `h3` list on each author page entry lists that author's posts.
2. **Raw post HTML** — each post's static HTML contains `href="../authors/<slug>/"` links in the byline section. Posts with multiple authors show multiple links.

The search index at `/authors/ilyes-rezgui/` lists three posts in its `h3` array. The search index at `/authors/nizar-karkar/` lists one post. These match the byline links found in the raw HTML.

### Author pages confirm

| Author | Posts listed on their page |
|--------|---------------------------|
| Ilyes Rezgui | Top LLM Gateways 2025 · The Ultimate Guide to RAG Chunking Strategies · Top 10 Techniques to Improve RAG Applications |
| Nizar Karkar | How to Evaluate RAG: Metrics, Evals, and Best Practices |
| Mahmoud Mabrouk | All remaining posts (33 sole-authored) + co-author on the Nizar and two Ilyes posts above |

### Co-authorship note

Two posts show Mahmoud as the first-listed co-author alongside a guest author. The MDX schema uses `author: reference("authors")` — a single reference. The table below recommends the guest author as the correct value for these posts (matching the Framer attribution and the author page listings), since that is the attribution the reader sees.

- `top-10-techniques-to-improve-rag-applications`: byline shows Mahmoud Mabrouk + Ilyes Rezgui. Ilyes's author page lists this post. Recommend `ilyes-rezgui`.
- `how-to-evaluate-rag-metrics-evals-and-best-practices`: byline shows Mahmoud Mabrouk + Nizar Karkar. Nizar's author page lists this post. Recommend `nizar-karkar`.

If you later want to support multiple authors, the schema change is `author: reference("authors")` → `authors: z.array(reference("authors"))`.

### Full post attribution table

| Post slug | Current `author` | Live site author(s) | Correct `author` |
|-----------|-----------------|---------------------|-----------------|
| agenta-achieves-soc2-type-i-certification | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| announcing-agenta-launch-week-1-april-15-19 | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| building-in-public-why-we-re-publishing-our-roadmap | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| building-the-data-flywheel-how-to-use-production-data-to-improve-your-llm-application | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| cicd-for-llm-prompts | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| commercial-open-source-is-hard-our-journey | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| git-vs-prompt-management-tools | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| **how-to-evaluate-rag-metrics-evals-and-best-practices** | **mahmoud-mabrouk** | Mahmoud Mabrouk + **Nizar Karkar** | **nizar-karkar** |
| humanloop-sunsetting-migration-and-alternative | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| introducing-ai-model-hub | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| introducing-custom-workflows | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| introducing-prompt-registry | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| july-2025-product-updates | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| launch-week-2-day-1 | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| launch-week-2-day-2-online-evaluation | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| launch-week-2-day-3-evaluation-sdk | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| launch-week-2-day-4-open-sourcing-evaluation | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| launch-week-2-day-5-jinja2-prompt-templates | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| llm-as-a-judge-guide-to-llm-evaluation-best-practices | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| open-source-llm-observability | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| product-update-november-2024 | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| prompt-drift | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| prompt-management-for-non-engineers | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| prompt-playground | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| prompt-versioning-guide | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| soc2-type2 | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| structured-outputs-playground | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| the-ai-engineer-s-guide-to-llm-observability-with-opentelemetry | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| the-definitive-guide-to-prompt-management-systems | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| the-guide-to-structured-outputs-and-function-calling-with-llms | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| **the-ultimate-guide-for-chunking-strategies** | **mahmoud-mabrouk** | **Ilyes Rezgui** (sole) | **ilyes-rezgui** |
| **top-10-techniques-to-improve-rag-applications** | **mahmoud-mabrouk** | Mahmoud Mabrouk + **Ilyes Rezgui** | **ilyes-rezgui** |
| top-6-techniques-to-manage-context-length-in-llms | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| **top-llm-gateways** | **mahmoud-mabrouk** | **Ilyes Rezgui** (sole) | **ilyes-rezgui** |
| top-llm-observability-platforms | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| top-open-source-prompt-management-platforms | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |
| what-we-learned-building-a-prompt-management-system | mahmoud-mabrouk | Mahmoud Mabrouk | mahmoud-mabrouk |

### Posts that need their `author` frontmatter changed

**Ilyes Rezgui** (`ilyes-rezgui`) — 3 posts:

1. `the-ultimate-guide-for-chunking-strategies` — sole author on the live site
2. `top-llm-gateways` — sole author on the live site
3. `top-10-techniques-to-improve-rag-applications` — co-authored with Mahmoud; Ilyes listed on his author page

**Nizar Karkar** (`nizar-karkar`) — 1 post:

4. `how-to-evaluate-rag-metrics-evals-and-best-practices` — co-authored with Mahmoud; Nizar listed on his author page

No other posts need changes. The remaining 33 posts are correctly attributed to `mahmoud-mabrouk`.
