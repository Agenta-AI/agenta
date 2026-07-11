# Gumloop Competitive IA Research

**Researched:** 2026-06-25  
**Purpose:** Catalog page archetypes from a mature AI-automation dev-tool marketing site to inform Agenta's content model and IA for the next 6 months — without requiring a site rebuild.

---

## Summary — Archetype Checklist

| Archetype | Gumloop has it? | Agenta priority |
|---|---|---|
| Homepage | Yes | Done |
| Solutions pages (by department) | Yes — `/solutions/[dept]` x5 | High |
| Use-case pages (specific workflows) | Yes — 40+ `/use-cases/[slug]` | High |
| Comparison pages (`/vs/competitor`) | Yes — 7 dedicated landing pages | High |
| Blog (editorial + SEO) | Yes — 150+ posts, 5 categories | Medium |
| Blog: alternatives listicles | Yes — programmatic SEO pattern | Medium |
| Case studies / customer stories | Yes — `/blog/` + `/category/case-studies` | High |
| Templates / gallery | Yes — 250+ at `/templates` | Medium |
| Learning hub / university | Yes — `university.gumloop.com` | Low (phase 2) |
| Cohorts / live learning | Yes — `/cohorts` | Low (phase 2) |
| Changelog | Yes — `/changelog` | Medium |
| Pricing | Yes — `/pricing` | Done |
| Integrations / MCP directory | Yes — `/mcp` + 100+ per-integration pages | Medium |
| Wall of love / testimonials | Yes — `/love` | Low |
| Partner programs | Yes — `/partners/apply-*` | Low |
| Secondary product page | Yes — `/products/gumstack` | Low |
| Interactive product embed on marketing page | **No** — uses animated mocks only | See note |

---

## Archetype Details

### 1. Solutions Pages — `/solutions/[department]`

**URL pattern:** `gumloop.com/solutions/marketing`, `/solutions/sales`, `/solutions/operations`, `/solutions/engineering`, `/solutions/support`, `/solutions/security`

**What it is:** Department-level (horizontal) landing pages. Each frames the platform for a buying persona: "The AI agent platform for marketing teams." The page covers platform breadth — 100+ integrations, model flexibility, team sharing, enterprise security — rather than drilling into a single workflow.

**How it differs from a use-case page:** Use-case pages are vertical (one workflow: "SEO Automation"). Solutions pages are horizontal (all workflows a department might run). Solutions pages link to relevant use-case sub-pages and templates.

**Content model implications:**
```
Solution {
  slug: string                   // "marketing", "sales", etc.
  department: enum               // maps to icon + color
  hero_headline: string
  hero_subhead: string
  integration_highlights: Tag[]  // tools shown in hero
  feature_sections: {            // 6–8 accordion / tab items
    headline: string
    body: rich_text
    media: image | video
  }[]
  linked_use_cases: UseCase[]    // relation
  linked_templates: Template[]   // relation
  customer_logos: Logo[]
}
```

---

### 2. Use-Case Pages — `/use-cases/[slug]`

**URL pattern:** `gumloop.com/use-cases/seo-automation`, `/use-cases/lead-generation-agent`, `/use-cases/call-analysis-agent`, 40+ total

**What it is:** Long-form (~8 000 words) vertical landing pages for a specific workflow. Structure follows: hero → customer logos → tabbed workflow breakdown → before/after comparisons → feature deep-dives → security module → educational resources → templates gallery → CTA.

**Tabs on each page:** typically 3–5 workflow subtypes (e.g. "Keyword research / Competitor analysis / SEO audits / Content & optimization").

**The before/after pattern:** short 2-column prose blocks contrasting the manual way vs. the Gumloop way — these are high-conversion copy units.

**Content model implications:**
```
UseCase {
  slug: string
  title: string
  hero_headline: string
  department: enum               // for filtering
  workflow_tabs: {               // 3-5 tabs
    label: string
    content: rich_text
    media: image | video
  }[]
  before_after: {                // 3-6 rows
    before: string
    after: string
  }[]
  featured_templates: Template[] // relation, 3-6
  customer_logos: Logo[]
  seo_meta: { title, description }
}
```

**Scale note:** 40+ pages today. Gumloop generates one page per specific workflow keyword (SEO keyword research agent, SEO content refresh agent, AI internal linking agent, etc.). This is a programmatic SEO play — pages are data-driven from a small shared template with swapped copy blocks.

---

### 3. Comparison Pages — `/vs/[competitor]`

**URL pattern:** `gumloop.com/vs/zapier`, `/vs/n8n`, `/vs/relevance-ai`, `/vs/dust`, `/vs/chatgpt-agent`, `/vs/claude-cowork`, `/vs/glean`  
(Note: early evidence suggested `/compare/` but confirmed URL is `/vs/`)

**What it is:** Dedicated conversion landing pages, not editorial blog posts. Structure:
1. Positioning headline (e.g. "Zapier was built for deterministic workflows in a pre-AI era. Gumloop was built for AI agents from day one.")
2. Customer logo strip
3. "What Gumloop does that [Competitor] can't" — 5–6 prose sections with checkmark/X treatment
4. Feature comparison table — ~20 rows across Platform, AI Capabilities, Pricing, Security/Compliance, Support tiers
5. Expanded narrative sections (3)
6. Collapsible FAQ
7. Multiple CTAs throughout

**What is NOT on these pages:** No actual product screenshots or UI images. No neutral framing — these are explicitly one-sided. The comparison table uses prose cells rather than simple checkmarks.

**Blog companions:** Gumloop also runs editorial "gumloop vs. X" posts at `/blog/gumloop-vs-[competitor]` and "X alternatives" listicles at `/blog/[competitor]-alternatives`. These are SEO articles that funnel to the `/vs/` pages.

**Content model implications:**
```
Comparison {
  slug: string                        // competitor slug
  competitor_name: string
  competitor_logo: image
  positioning_headline: string
  capability_sections: {              // 5-6 rows
    our_capability: string
    their_limitation: string
  }[]
  feature_table_rows: {               // ~20 rows
    category: string
    feature: string
    ours: string
    theirs: string
  }[]
  faq_items: { question, answer }[]
  customer_logos: Logo[]
}
```

**SEO/scale note:** Seven pages now. Each competitor = one slug. The content structure is nearly identical across pages — this is a perfect candidate for a CMS collection where a non-engineer adds a new row to produce a new `/vs/` page.

---

### 4. Blog — `/blog/[slug]`

**URL pattern:** `gumloop.com/blog/series-b`, `/blog/human-in-the-loop`, `/blog/how-instacart-automated-high-value-outreach-with-gumloop`

**Categories visible on index:** Announcements, Guides, Use cases, Case studies, Resources

**Card metadata shown:** category label, read-time estimate, headline, excerpt, featured image. Notably: no author name or publication date on cards (dates appear inside posts).

**Sub-patterns within the blog:**

- **Announcement posts** — product launches, funding news
- **Guides** — how-to tutorials
- **Alternatives listicles** — `/blog/[competitor]-alternatives` (e.g. n8n alternatives, Zapier alternatives, Lindy alternatives, Botpress alternatives). Pattern: numbered list of 7–11 tools, each entry has logo, metadata row (Best for / Pricing / What I like), pros/cons bullets, pricing table, G2/Capterra ratings. Gumloop is #1 and gets 3–4× the copy of competitors. ~3 500–4 000 words. First-person voice ("I've tested..."). Strong SEO play.
- **Direct comparison posts** — `/blog/gumloop-vs-[competitor]` — shorter, landing-page style

**Content model implications:** Standard blog collection is sufficient. The alternatives listicles could be a distinct `ComparisonListicle` content type (with a `primary_tool`, list of `CompetitorEntry` structured blocks) but most teams just tag them and use rich text.

---

### 5. Case Studies — `/blog/[slug]` + index at `/category/case-studies`

**URL pattern:** `gumloop.com/blog/how-instacart-automated-high-value-outreach-with-gumloop`, `/blog/how-webflow-automated-all-social-media-listening-with-gumloop`

**What it is:** Designed case-study pages styled as editorial posts. Consistent structure:
1. Author + date header
2. Hero image (branded cover art)
3. **Highlights** block — 3 headline metrics with checkmarks (e.g. "Doubled New Customer Meetings", "NPS of 9.8 Among Pilot Users")
4. The Challenge (narrative)
5. The Solution (3 subsections)
6. The Outcome (metrics + narrative)
7. Conclusion + next steps
8. CTA section
9. "Read related articles" — 3 related case studies

**Customer quotes:** 2 named quotes per study, with attribution + title. No headshot photos in the Instacart example but other studies may vary.

**Index page:** Grid of cards — thumbnail, "Case studies" label, read-time, title, brief description. Pagination suggests 6+ studies. The index lives at `/category/case-studies` rather than a standalone `/customers` route.

**Content model implications:**
```
CaseStudy {
  company_name: string
  company_logo: image
  hero_image: image
  author: string
  published_date: date
  headline_metrics: {            // 3 items shown as highlights
    label: string
    value: string
  }[]
  challenge: rich_text
  solution: rich_text
  outcome: rich_text
  quotes: {
    text: string
    attribution: string
    title: string
    photo?: image
  }[]
  integration_icons: Tag[]       // tools used
  related_studies: CaseStudy[]   // relation, 3 items
  department_tags: enum[]
}
```

---

### 6. Templates Gallery — `/templates`

**URL pattern:** `gumloop.com/templates`, individual at `/templates/[slug]`, filtered at `/templates/solutions/[dept]`

**What it is:** A community + official gallery of 185–250+ pre-built agent workflows. Organized by solution category (Marketing, Sales, Operations, Engineering, Support). The gallery surfaces curated "Featured Agents," "Featured Workflows," "Recently Added" sections.

**Card metadata:** thumbnail, title, description, creator name + profile link, view count, creation date, tool icons.

**Template types:** Agents and Workflows are distinct sub-types with separate featured sections.

**Community angle:** Templates have "creators" — community members who build and publish. There are "Featured Creators" on the homepage. This drives a creator/partner flywheel.

**Content model implications:**
```
Template {
  slug: string
  title: string
  description: rich_text
  thumbnail: image
  template_type: enum            // "agent" | "workflow"
  solution_category: enum[]      // "marketing" | "sales" | etc.
  use_case_tags: Tag[]
  tool_integrations: Integration[] // relation
  creator: Creator               // relation (user or org)
  view_count: number
  published_date: date
  is_featured: boolean
  is_official: boolean
}
```

**Scale note:** 250+ pages with creator attribution and tool tagging = full programmatic SEO on template names + integration names.

---

### 7. University / Learning Hub — `university.gumloop.com`

**URL pattern:** Separate subdomain. Courses at `university.gumloop.com/getting-started-with-gumloop/what-is-gumloop`, use-case tutorials at `/use-case/data-analyst-agent`

**What it is:** A structured self-paced learning platform with:
- **Courses** — multi-lesson paths (e.g. "Getting Started" = 6 lessons, "AI Fundamentals" = 7 lessons, "Use Case Walkthroughs" = 5 use cases)
- **Videos** — feature demos (2–3 min each, e.g. "Human-in-the-Loop", "Teams")
- **Webinars** — live and recorded expert sessions
- **Cohorts** — 1-week guided group experiences (separate page at `gumloop.com/cohorts`, application via Airtable form, next cohort July 6 2026, completion earns 10 000 platform credits)

**Content model implications:**
```
Course {
  slug: string
  title: string
  description: string
  lesson_count: number
  lessons: {
    slug: string
    title: string
    duration_minutes: number
    content: rich_text | video_embed
    order: number
  }[]
}

Webinar {
  title: string
  date: datetime
  recording_url?: string
  is_upcoming: boolean
  registration_url?: string
}

Cohort {
  title: string
  start_date: date
  duration_days: number
  application_url: string
  credit_reward: number
}
```

---

### 8. Changelog — `/changelog`

**URL pattern:** `gumloop.com/changelog`

**Format:** Reverse-chronological timeline. Each entry has a version number (e.g. "10.2.0"), a date (Jun 22, 2026), and a geographic code name ("Revelstoke") — a naming convention Gumloop uses consistently. Within each entry: feature categories (agent improvements, platform improvements, MCP enhancements, bug fixes), each with 3–10 bullet items. Major launches get linked "Learn more" anchors to docs. No filtering, no individual entry permalink visible.

**Content model implications:**
```
ChangelogEntry {
  version: string                // semver
  date: date
  code_name: string              // optional, for character
  categories: {
    label: string
    items: {
      description: rich_text
      docs_link?: url
      is_major: boolean
    }[]
  }[]
}
```

---

### 9. Integrations / MCP Directory — `/mcp`

**URL pattern:** `gumloop.com/mcp` (directory), likely individual pages per integration

**What it is:** A directory of 100+ hosted MCP servers. The page headline: "Connect any AI agent to 100+ MCP servers, fully hosted, zero setup." Integrations include Airtable, Salesforce, HubSpot, Slack, Google Suite, GitHub, Zapier, Notion, Monday.com, Linear, Jira, and ~90 more.

**Scale note:** 100+ integration entries each likely have their own page. This is a high-value programmatic SEO surface — each integration page captures intent from "[tool] + AI automation" queries.

**Content model implications:**
```
Integration {
  slug: string
  name: string
  logo: image
  category: enum                 // "CRM" | "DevTools" | "Data" | etc.
  short_description: string
  long_description: rich_text
  connection_type: string        // "MCP" | "native" | "webhook"
  docs_url: url
  use_case_tags: Tag[]
  related_templates: Template[]  // relation
}
```

---

### 10. Pricing Page — `/pricing`

**Format:** 3 tiers (Free / Pro at $37/mo / Enterprise custom). Interactive billing toggle (monthly/annual, 20% discount). **Credit calculator slider** — lets visitors set their monthly credit volume (20k to 1.5M) and see costs. Feature comparison table across tiers (triggers, seats, concurrent runs, security features). Collapsible FAQ (credits, API keys, rollover, collaboration, enterprise). Enterprise "Contact sales" CTA.

**Content model:** Standard CMS page with hardcoded plan data (or a `Plan` collection if plans change frequently).

---

### 11. Wall of Love — `/love`

A testimonial aggregator page. Tagline: "Feedback from happy users. No phony testimonials." Content is heavily JS-rendered so structure was not fully retrievable, but the pattern is a masonry/grid of social proof cards sourced from Twitter/X and other platforms.

**Content model:** `Testimonial { text, attribution, source_platform, source_url, author_photo, author_title, company }`.

---

## Interactive "Gimmicks" — Does Gumloop Embed Live Product UI?

**Short answer: No.** Gumloop's marketing pages use sophisticated animated mocks rather than live product embeds:

- The Gumstack page shows an "activity dashboard" table but it is a designed static/animated component, not a live iframe into the product.
- Slack thread mockups on use-case pages are designed illustrations.
- The homepage "tasks automated to date" counter is a CSS/JS number animation, not a live metric pulled from the product API.
- The role-based access control grid is a static illustration.
- The "tool carousel" showing 100+ integrations is a CSS animation of logos.

Gumloop *does* build "Interfaces" — embeddable agent UIs that users can publish — but Gumloop does not use these on their own marketing pages. Community members have asked in the forum about embedding Gumloop interfaces on external sites, suggesting the feature exists but Gumloop does not dogfood it on gumloop.com.

**Implication for Agenta:** If Agenta wants to embed a live dashboard widget on a marketing page, this is a differentiator — no comparable AI dev-tool site does this today. The closest pattern in this space is Braintrust's `/assessment` page, which is an interactive evaluation-maturity quiz (a self-scoring tool that asks the user questions and shows them where they fall on a maturity curve). That is the best live example of "interactive content that converts" from a direct competitor.

---

## Programmatic SEO Patterns

Gumloop runs at least five distinct programmatic SEO surfaces:

| Pattern | URL shape | Volume | Intent |
|---|---|---|---|
| Comparison landing pages | `/vs/[competitor]` | ~7 pages | Bottom-funnel, high-intent switching |
| Use-case landing pages | `/use-cases/[workflow]` | 40+ pages | Mid-funnel, workflow-specific |
| Alternatives listicles | `/blog/[tool]-alternatives` | 15–20 posts | Top-funnel, brand + ranking |
| Templates | `/templates/[slug]` | 250+ pages | Product-led, tool + use-case keywords |
| MCP integrations | `/mcp/[tool]` | 100+ pages | Tool + "AI agent" intent |

All five follow the same model: a shared page template with swapped content blocks, designed to rank for "[tool/workflow] + AI automation" queries.

---

## Other Sites — Brief Comparison

### Vercel

Vercel's IA adds two archetypes Gumloop (and Agenta currently) lacks:

- **`/academy/`** — structured learning paths similar to Gumloop University but on the main domain, not a subdomain. Keeps SEO juice on vercel.com.
- **`/ai-gateway/models/[model-slug]`** — individual pages per AI model (e.g. GPT-4o, Claude 3.5) with pricing, latency, benchmark data. This is a programmatic SEO play on "[model name] pricing/benchmarks" queries. Agenta is well-positioned to build this given its model-management domain — a `/models/[provider]/[model]` directory would capture high-intent developer research traffic.

Vercel routes case studies through `/customers/[slug]` as a first-class section (not buried in the blog), which makes them more discoverable and gives them editorial weight.

### Langfuse (direct Agenta competitor)

Langfuse has a much thinner marketing site. Case studies live at `/faq/tag/case-studies` — buried in an FAQ section, not a dedicated archetype. There are no `/vs/` pages. There is no templates gallery, no university, no use-case pages. Their changelog is at `/changelog` (clean). Their primary discovery channel is the GitHub repo (star count, README), not SEO.

**The gap Agenta can exploit:** Langfuse has almost no SEO-oriented marketing content. Agenta building even a modest set of use-case pages (by role: prompt engineer, ML engineer, product manager) and one or two comparison pages (`/vs/langfuse`, `/vs/langsmith`) would immediately own search real estate that no direct competitor occupies.

### Braintrust (direct Agenta competitor)

Braintrust has one notable archetype neither Gumloop nor Langfuse has: **`/encyclopedia`** — a terminology reference (definitions of eval concepts, LLM terms). This is a high-value SEO and developer-trust play that compounds over time. They also have **`/foundations`** (an educational primer series) and **`/assessment`** (an interactive evaluation-maturity self-scoring quiz).

Braintrust's `/assessment` is the strongest example of "interactive gimmick on a marketing page" in this competitive space — it collects intent signals, personalizes a score, and gates a download or next step. This is closer to what Agenta wants (embedded live dashboard) but achieves the interactivity through a quiz rather than a live product embed.

---

## Content Model — What to Leave Room For (Priority Order)

When building Agenta's CMS schema, reserve the following collections from the start even if content doesn't exist yet:

1. **`UseCase`** — high priority, 10–20 pages by role/workflow (prompt engineering, RAG evaluation, A/B testing prompts, etc.)
2. **`Comparison`** — high priority, start with `/vs/langfuse`, `/vs/langsmith`, `/vs/braintrust`; ~5 rows in a CMS table generates 5 new ranking pages
3. **`CaseStudy`** — high priority, separate from blog; needs headline metrics array + quotes array as structured fields
4. **`Template`** — medium priority; a prompt template / evaluation template gallery is natural for Agenta's domain
5. **`Integration`** — medium priority, one page per supported LLM provider and framework (OpenAI, Anthropic, LangChain, LiteLLM, etc.)
6. **`ChangelogEntry`** — medium priority, already implied; make categories and `is_major` structured fields, not free text
7. **`Course` + `Lesson`** — low priority (phase 2); defer university subdomain until there is video content to fill it
8. **`Testimonial`** — low priority; a simple wall-of-love page can be added late with minimal schema
